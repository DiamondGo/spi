// Host role: publishes this sPi through the relay to paired devices only. A connected device
// gets the same API as a local window (including terminals and YOLO), so pairing is explicit,
// revocable and visible.
import { join } from 'path'
import type { KeyPair } from './noise'
import { serverHandshake } from './secure'
import { RpcPeer } from './rpc'
import { PairingOffer, encodePairingCode, fromBase64, keyFingerprint, toBase64 } from './pairing'
import { PeerOutbox, PROTOCOL_VERSION, SESSION_SCOPED_CHANNELS } from './protocol'
import type { RemoteBackend } from './backend'
import type { HostTunnelRecord } from './devTunnels'
import type { ByteStream, Listener, Transport } from './transport'
import { readJson, writeJsonAtomic } from './stateFile'
import type { RemoteHostSnapshot, RemoteHostState } from '../../shared/types'

export interface RemoteCaller { kind: 'remote'; deviceId: string; owner: string }

export interface HostDependencies {
  dataDir: string
  backend: RemoteBackend
  identity(): KeyPair
  hostName(): string
  invoke(channel: string, caller: RemoteCaller, args: unknown[]): unknown
  send(channel: string, caller: RemoteCaller, args: unknown[]): void
  /** The device's terminals may be closed: it left intentionally, was revoked, or stayed away too long. */
  ownerGone(owner: string): void
  changed(): void
  log?(message: string): void
}

interface DeviceRecord { key: string; name: string; pairedAt: number; lastSeenAt?: number }
interface HostConfig { version: 1; enabled: boolean; tunnel?: HostTunnelRecord; devices: DeviceRecord[] }
interface PeerInfo { deviceId: string; caller: RemoteCaller; outbox: PeerOutbox; sessions: Set<string> }

const OWNER_GRACE_MS = 2 * 60_000
const RETRY_MIN_MS = 15_000
const RETRY_MAX_MS = 5 * 60_000

function sanitizeName(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : ''
  return Array.from(text).slice(0, 64).join('') || 'Unnamed device'
}

export class RemoteHostService {
  private config: HostConfig
  private state: RemoteHostState = 'off'
  private error: string | undefined
  private transport: Transport | null = null
  private listener: Listener | null = null
  private offer: PairingOffer | null = null
  private readonly peers = new Map<RpcPeer, PeerInfo>()
  private readonly ownerTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = RETRY_MIN_MS
  private generation = 0
  private readonly file: string

  constructor(private readonly deps: HostDependencies) {
    this.file = join(deps.dataDir, 'spi-remote-host.json')
    const saved = readJson(this.file) as Partial<HostConfig> | null
    const devices = Array.isArray(saved?.devices) ? saved!.devices.filter(d => d && typeof d.key === 'string' && fromBase64(d.key).length === 32) : []
    this.config = { version: 1, enabled: saved?.enabled === true, tunnel: saved?.tunnel, devices }
  }

  get connectedDevices(): number { return new Set([...this.peers.values()].map(p => p.deviceId)).size }

  /** Resumes hosting after an app restart if it was left enabled. */
  resume(): void { if (this.config.enabled) void this.start() }

  snapshot(): RemoteHostSnapshot {
    const online = new Set([...this.peers.values()].map(p => p.deviceId))
    return {
      enabled: this.config.enabled, state: this.state, error: this.error,
      devices: this.config.devices.map(d => ({ id: keyFingerprint(fromBase64(d.key)), name: d.name, pairedAt: d.pairedAt, lastSeenAt: d.lastSeenAt, connected: online.has(keyFingerprint(fromBase64(d.key))) })),
      pairingExpiresAt: this.offer?.active ? this.offer.expiresAt : undefined
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) this.deps.identity()
    this.config.enabled = enabled
    this.save()
    if (enabled) await this.start()
    else await this.stop()
  }

  createPairingCode(): { code: string; expiresAt: number } {
    if (this.state !== 'online' || !this.listener) throw new Error('Remote access is not online yet')
    this.offer = new PairingOffer()
    const code = encodePairingCode({ address: this.listener.address, hostKey: this.deps.identity().publicKey, psk: this.offer.psk, expiresAt: this.offer.expiresAt })
    this.deps.changed()
    return { code, expiresAt: this.offer.expiresAt }
  }

  cancelPairing(): void { this.offer = null; this.deps.changed() }

  revoke(deviceId: string): void {
    const before = this.config.devices.length
    this.config.devices = this.config.devices.filter(d => keyFingerprint(fromBase64(d.key)) !== deviceId)
    if (this.config.devices.length === before) throw new Error('Device not found')
    this.save()
    for (const [peer, info] of this.peers) if (info.deviceId === deviceId) void peer.close('device revoked')
    this.releaseOwner('remote:' + deviceId)
    this.deps.changed()
  }

  /** Host-data events: every connected device, except pi events for sessions it never opened. */
  broadcast(channel: string, payload: unknown): void {
    const sessionId = channel === 'pi:event' ? (payload as { sessionId?: unknown })?.sessionId : undefined
    for (const info of this.peers.values()) {
      if (typeof sessionId === 'string' && !info.sessions.has(sessionId)) continue
      if (channel === 'session:closed' && typeof payload === 'string') info.sessions.delete(payload)
      info.outbox.emit(channel, payload)
    }
  }

  sendToOwner(owner: string, channel: string, payload: unknown): void {
    for (const info of this.peers.values()) if (info.caller.owner === owner) info.outbox.emit(channel, payload)
  }

  async stop(): Promise<void> {
    this.generation++
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.offer = null
    const listener = this.listener, transport = this.transport
    this.listener = null; this.transport = null
    await listener?.close().catch(() => {})
    await Promise.all([...this.peers.keys()].map(peer => peer.close('host stopped')))
    await transport?.close?.().catch(() => {})
    for (const device of this.config.devices) this.releaseOwner('remote:' + keyFingerprint(fromBase64(device.key)))
    this.setState('off')
  }

  private async start(): Promise<void> {
    if (this.listener || this.state === 'starting') return
    const generation = ++this.generation
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.setState('starting')
    try {
      const identity = this.deps.identity()
      const { transport, record } = await this.deps.backend.prepareHost(identity.publicKey, this.config.tunnel)
      if (generation !== this.generation) { await transport.close?.(); return }
      const listener = await transport.listen(stream => void this.accept(stream))
      if (generation !== this.generation) { await listener.close(); await transport.close?.(); return }
      this.transport = transport; this.listener = listener
      this.config.tunnel = { ...record, port: Number(listener.address.port) || record.port }
      this.save()
      listener.onStatus((status, detail) => {
        if (generation !== this.generation) return
        if (status === 'connected') this.setState('online')
        else this.setState('reconnecting', detail ? this.deps.backend.explain(new Error(detail)) : undefined)
      })
      this.retryDelay = RETRY_MIN_MS
      this.setState('online')
    } catch (error) {
      if (generation !== this.generation) return
      this.setState('error', this.deps.backend.explain(error))
      this.deps.log?.('remote host start failed: ' + this.deps.backend.explain(error))
      if (this.config.enabled) {
        this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.config.enabled && !this.listener) void this.start() }, this.retryDelay)
        this.retryTimer.unref?.()
        this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS)
      }
    }
  }

  private setState(state: RemoteHostState, error?: string): void {
    this.state = state
    this.error = state === 'online' || state === 'off' ? undefined : error ?? this.error
    this.deps.changed()
  }

  private save(): void { writeJsonAtomic(this.file, this.config) }

  private device(key: Uint8Array): DeviceRecord | undefined {
    const encoded = toBase64(key)
    return this.config.devices.find(d => d.key === encoded)
  }

  private async accept(stream: ByteStream): Promise<void> {
    const generation = this.generation
    const offer = this.offer
    let claimed = false
    let channel
    try {
      ({ channel } = await serverHandshake(stream, {
        identity: this.deps.identity(),
        isPaired: key => !!this.device(key),
        pairingPsk: () => {
          const psk = offer && offer === this.offer ? offer.claim() : null
          claimed = !!psk
          return psk
        },
        onPairingFailed: () => { offer?.failed(); this.deps.changed() },
        onPaired: key => {
          offer?.consume()
          if (this.offer === offer) this.offer = null
          if (!this.device(key)) this.config.devices.push({ key: toBase64(key), name: 'Unnamed device', pairedAt: Date.now() })
          this.save()
        }
      }))
    } catch (error) {
      this.deps.log?.('remote handshake rejected: ' + (error instanceof Error ? error.message : String(error)))
      return
    } finally { if (claimed) offer?.release() }
    if (generation !== this.generation || !this.listener) { await channel.close('host stopped'); return }
    const deviceId = keyFingerprint(channel.peerKey)
    const caller: RemoteCaller = { kind: 'remote', deviceId, owner: 'remote:' + deviceId }
    let info: PeerInfo
    const peer = new RpcPeer(channel, {
      'remote.hello': params => {
        const record = this.device(channel.peerKey)
        if (record) { record.name = sanitizeName((params as { deviceName?: unknown })?.deviceName); record.lastSeenAt = Date.now(); this.save() }
        this.deps.changed()
        return { protocol: PROTOCOL_VERSION, hostName: this.deps.hostName(), deviceId }
      },
      'remote.bye': () => { this.releaseOwner(caller.owner); return true },
      'ipc.invoke': async params => {
        const { channel: name, args } = (params ?? {}) as { channel?: unknown; args?: unknown }
        if (typeof name !== 'string' || !Array.isArray(args) || args.length > 8) throw new Error('Invalid remote call')
        if (!this.device(channel.peerKey)) throw new Error('This device is no longer paired')
        if (SESSION_SCOPED_CHANNELS.has(name) && typeof args[0] === 'string') info.sessions.add(args[0])
        const result = await this.deps.invoke(name, caller, args)
        if (name === 'session:open') { const id = (result as { sessionId?: unknown })?.sessionId; if (typeof id === 'string') info.sessions.add(id) }
        return result
      }
    })
    info = { deviceId, caller, sessions: new Set(), outbox: new PeerOutbox(peer, () => void peer.close('connection too slow')) }
    peer.onEvent((name, data) => {
      if (name !== 'ipc.send' || !this.device(channel.peerKey)) return
      const { channel: target, args } = (data ?? {}) as { channel?: unknown; args?: unknown }
      if (typeof target !== 'string' || !Array.isArray(args) || args.length > 8) return
      try { this.deps.send(target, caller, args) } catch {}
    })
    peer.onClose(() => {
      info.outbox.close()
      this.peers.delete(peer)
      if (![...this.peers.values()].some(p => p.deviceId === deviceId)) this.scheduleOwnerRelease(caller.owner)
      this.deps.changed()
    })
    this.peers.set(peer, info)
    this.cancelOwnerRelease(caller.owner)
    this.deps.changed()
  }

  private scheduleOwnerRelease(owner: string): void {
    this.cancelOwnerRelease(owner)
    const timer = setTimeout(() => { this.ownerTimers.delete(owner); this.deps.ownerGone(owner) }, OWNER_GRACE_MS)
    timer.unref?.()
    this.ownerTimers.set(owner, timer)
  }
  private cancelOwnerRelease(owner: string): void {
    const timer = this.ownerTimers.get(owner)
    if (timer) clearTimeout(timer)
    this.ownerTimers.delete(owner)
  }
  private releaseOwner(owner: string): void { this.cancelOwnerRelease(owner); this.deps.ownerGone(owner) }
}
