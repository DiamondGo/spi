// Client role: pairs with hosts and keeps one encrypted connection per host for its remote window.
import { join } from 'path'
import { bytesEqual, type KeyPair } from './noise'
import { clientHandshake, HandshakeClosed } from './secure'
import { RpcPeer, RpcDisconnected } from './rpc'
import { decodePairingCode, fromBase64, keyFingerprint, toBase64 } from './pairing'
import { PROTOCOL_VERSION, REMOTE_EVENT_CHANNELS } from './protocol'
import type { RemoteBackend } from './backend'
import { TunnelMissingError } from './devTunnels'
import type { TransportAddress } from './transport'
import { readJson, writeJsonAtomic } from './stateFile'
import type { LayoutState, RemoteAccessRole, RemoteConnectionState, RemoteHostEntry, RemoteRejectReason } from '../../shared/types'

interface HostRecord { id: string; name: string; hostKey: string; address: TransportAddress; pairedAt: number }
interface ClientConfig { version: 1; hosts: HostRecord[]; layouts: Record<string, LayoutState> }

export interface ClientDependencies {
  dataDir: string
  backend: RemoteBackend
  identity(): KeyPair
  deviceName(): string
  changed(): void
  log?(message: string): void
}

const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000
const FIRST_CONNECT_TIMEOUT_MS = 45_000

function hello(peer: RpcPeer, deviceName: string): Promise<{ hostName: string; protocol: number; access: RemoteAccessRole }> {
  return peer.call('remote.hello', { deviceName, protocol: PROTOCOL_VERSION }).then(result => {
    const r = result as { hostName?: unknown; protocol?: unknown; access?: unknown }
    if (r?.protocol !== PROTOCOL_VERSION) throw new Error('The host runs an incompatible sPi version; update both computers')
    if (r.access !== 'control' && r.access !== 'read-only') throw new Error('The host runs an incompatible sPi version; update both computers')
    return { access: r.access, hostName: typeof r.hostName === 'string' && r.hostName.trim() ? r.hostName.trim().slice(0, 64) : 'sPi host', protocol: r.protocol }
  })
}

export class RemoteClientService {
  private config: ClientConfig
  private readonly connections = new Map<string, RemoteConnection>()
  private readonly file: string

  constructor(private readonly deps: ClientDependencies) {
    this.file = join(deps.dataDir, 'spi-remote-hosts.json')
    const saved = readJson(this.file) as Partial<ClientConfig> | null
    const hosts = Array.isArray(saved?.hosts) ? saved!.hosts.filter(h => h && typeof h.id === 'string' && typeof h.hostKey === 'string' && h.address && typeof h.address.kind === 'string') : []
    const layouts = saved?.layouts && typeof saved.layouts === 'object' ? saved.layouts : {}
    this.config = { version: 1, hosts, layouts }
  }

  hosts(): RemoteHostEntry[] {
    return this.config.hosts.map(h => {
      const c = this.connections.get(h.id)
      return { id: h.id, name: h.name, pairedAt: h.pairedAt, connection: c?.state, detail: c?.detail, reason: c?.reason }
    })
  }

  host(id: string): HostRecord {
    const host = this.config.hosts.find(h => h.id === id)
    if (!host) throw new Error('Unknown remote host')
    return host
  }

  async pair(codeText: unknown): Promise<RemoteHostEntry> {
    const code = decodePairingCode(codeText)
    if (Date.now() > code.expiresAt) throw new Error('This pairing code has expired; create a new one on the host')
    const identity = this.deps.identity()
    if (bytesEqual(code.hostKey, identity.publicKey)) throw new Error('This pairing code belongs to this computer')
    const stream = await this.deps.backend.clientTransport().connect(code.address)
    let peer: RpcPeer | null = null
    try {
      const channel = await clientHandshake(stream, { mode: 'pair', identity, hostKey: code.hostKey, psk: code.psk })
      peer = new RpcPeer(channel)
      const { hostName } = await hello(peer, this.deps.deviceName())
      const id = keyFingerprint(code.hostKey)
      const record: HostRecord = { id, name: hostName, hostKey: toBase64(code.hostKey), address: code.address, pairedAt: Date.now() }
      this.config.hosts = [...this.config.hosts.filter(h => h.id !== id), record]
      this.save()
      this.deps.changed()
      return { id, name: hostName, pairedAt: record.pairedAt }
    } catch (error) {
      // A wrong PSK only fails on the host (XXpsk3 mixes it into the last message), so the client sees the host hang up right after.
      if (error instanceof HandshakeClosed || error instanceof RpcDisconnected) throw new Error('The host refused this pairing code (already used, expired or cancelled); create a new one')
      throw new Error(this.deps.backend.explain(error))
    } finally {
      await (peer ? peer.close('pairing complete') : stream.close('pairing failed')).catch(() => {})
    }
  }

  async forget(id: string): Promise<void> {
    await this.connections.get(id)?.close(true)
    this.connections.delete(id)
    this.config.hosts = this.config.hosts.filter(h => h.id !== id)
    delete this.config.layouts[id]
    this.save()
    this.deps.changed()
  }

  /** Connected (first handshake done) connection for a remote window; reused while open. */
  async connect(id: string): Promise<RemoteConnection> {
    const existing = this.connections.get(id)
    if (existing && existing.state !== 'closed' && existing.state !== 'rejected') return existing
    const connection = new RemoteConnection(this.host(id), this.deps, (address, name) => {
      const host = this.config.hosts.find(h => h.id === id)
      if (!host) return
      if (address) host.address = address
      if (name) host.name = name
      this.save()
    })
    this.connections.set(id, connection)
    connection.onState(() => this.deps.changed())
    try { await connection.ready(FIRST_CONNECT_TIMEOUT_MS) }
    catch (error) { await connection.close(false); this.connections.delete(id); this.deps.changed(); throw error }
    return connection
  }

  async disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id)
    this.connections.delete(id)
    await connection?.close(true)
    this.deps.changed()
  }

  loadLayout(id: string): LayoutState { this.host(id); return this.config.layouts[id] ?? {} }
  saveLayout(id: string, layout: LayoutState): void {
    this.host(id)
    this.config.layouts[id] = layout
    this.save()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.connections.values()].map(c => c.close(true)))
    this.connections.clear()
  }

  private save(): void { writeJsonAtomic(this.file, this.config) }
}

/**
 * One reconnecting encrypted session to a paired host. Calls made while disconnected fail at
 * once and calls in flight at a disconnect are never replayed; the window resynchronises instead.
 */
const REJECTED_DETAIL: Record<RemoteRejectReason, string> = {
  revoked: 'The host no longer accepts this device (revoked or remote access was reset). Pair again.',
  key_changed: 'The host key changed. This may be an attack or a reinstalled host; pair again only if you trust it.',
  incompatible: 'The host runs an incompatible sPi version; update both computers'
}

export class RemoteConnection {
  state: RemoteConnectionState = 'connecting'
  access: RemoteAccessRole = 'read-only'
  detail: string | undefined
  reason: RemoteRejectReason | undefined
  hostName: string
  readonly hostId: string
  private peer: RpcPeer | null = null
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private delay = RETRY_MIN_MS
  private rejectedHandshakes = 0
  private attempt: AbortController | null = null
  private everConnected = false
  private readonly stateListeners = new Set<(resync: boolean) => void>()
  private readonly eventListeners = new Set<(channel: string, payload: unknown) => void>()
  private readonly firstConnect: Promise<void>
  private settleFirst!: (error?: Error) => void

  constructor(private host: HostRecord, private readonly deps: ClientDependencies, private readonly update: (address?: TransportAddress, name?: string) => void) {
    this.hostId = host.id
    this.hostName = host.name
    this.firstConnect = new Promise<void>((resolve, reject) => { this.settleFirst = error => error ? reject(error) : resolve() })
    this.firstConnect.catch(() => {})
    void this.connect()
  }

  ready(timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout>
    return Promise.race([
      this.firstConnect,
      new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error(this.detail || 'The host is offline or unreachable')), timeoutMs) })
    ]).finally(() => clearTimeout(timer))
  }

  onState(cb: (resync: boolean) => void): () => void { this.stateListeners.add(cb); return () => this.stateListeners.delete(cb) }
  onEvent(cb: (channel: string, payload: unknown) => void): () => void { this.eventListeners.add(cb); return () => this.eventListeners.delete(cb) }

  invoke(channel: string, args: unknown[]): Promise<unknown> {
    const peer = this.peer
    if (!peer || this.state !== 'connected') return Promise.reject(new Error(this.state === 'rejected' ? this.detail || 'The host no longer accepts this device' : 'Not connected to the remote host; reconnecting…'))
    return peer.call('ipc.invoke', { channel, args }).catch(error => {
      if (error instanceof RpcDisconnected) throw new Error('The connection to the remote host was lost before it answered; the request may or may not have run')
      throw error
    })
  }

  send(channel: string, args: unknown[]): void {
    if (this.peer && this.state === 'connected') void this.peer.emit('ipc.send', { channel, args }).catch(() => {})
  }

  /** intentional=true tells the host it may close this device's terminals right away. */
  async close(intentional: boolean): Promise<void> {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.attempt?.abort()
    const peer = this.peer
    this.peer = null
    if (peer && intentional) await Promise.race([peer.call('remote.bye').catch(() => {}), new Promise(r => setTimeout(r, 1500))])
    await peer?.close('client closing').catch(() => {})
    this.setState('closed', undefined, false)
    this.settleFirst(new Error('Connection closed'))
  }

  private setState(state: RemoteConnectionState, detail?: string, resync = false): void {
    this.state = state
    this.detail = detail
    for (const cb of this.stateListeners) cb(resync)
  }

  private schedule(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => { this.timer = null; void this.connect() }, this.delay)
    this.delay = Math.min(this.delay * 2, RETRY_MAX_MS)
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    const hostKey = fromBase64(this.host.hostKey)
    const attempt = this.attempt = new AbortController()
    let peer: RpcPeer | null = null
    try {
      const transport = this.deps.backend.clientTransport()
      let stream
      try { stream = await transport.connect(this.host.address, attempt.signal) }
      catch (error) {
        if (!(error instanceof TunnelMissingError)) throw error
        const found = await this.deps.backend.rediscover(this.host.address)
        if (!found) throw error
        this.host = { ...this.host, address: found }
        this.update(found)
        stream = await transport.connect(found, attempt.signal)
      }
      if (this.stopped) { await stream.close('client closing'); return }
      const channel = await clientHandshake(stream, { mode: 'resume', identity: this.deps.identity(), hostKey })
      peer = new RpcPeer(channel)
      peer.onEvent((name, data) => {
        if (name === 'remote.access') {
          const access = (data as { access?: unknown })?.access
          if (access === 'control' || access === 'read-only') {
            this.access = access
            if (this.state === 'connected') this.setState('connected', undefined, true)
          }
          return
        }
        if (name !== 'ipc.event') return
        const { channel: target, payload } = (data ?? {}) as { channel?: unknown; payload?: unknown }
        if (typeof target === 'string' && REMOTE_EVENT_CHANNELS.has(target)) for (const cb of this.eventListeners) cb(target, payload)
      })
      const { hostName, access } = await hello(peer, this.deps.deviceName())
      this.access = access
      if (this.stopped) { await peer.close('client closing'); return }
      if (hostName !== this.hostName) { this.hostName = hostName; this.update(undefined, hostName) }
      const current = peer
      peer.onClose(() => {
        if (this.peer !== current) return
        this.peer = null
        if (this.stopped) return
        this.setState('reconnecting', 'Connection lost; reconnecting…')
        this.delay = RETRY_MIN_MS
        this.schedule()
      })
      if (current.closed) throw new Error('Connection lost during setup')
      this.peer = current
      this.rejectedHandshakes = 0
      this.delay = RETRY_MIN_MS
      const resync = this.everConnected
      this.everConnected = true
      this.setState('connected', undefined, resync)
      this.settleFirst()
    } catch (error) {
      await peer?.close('setup failed').catch(() => {})
      if (this.stopped) return
      const message = error instanceof Error ? error.message : String(error)
      // A pinned-key mismatch is never transient. Repeated mid-handshake closes mean the host
      // no longer accepts this device; a single one may be a relay drop.
      if (error instanceof HandshakeClosed) this.rejectedHandshakes++
      else this.rejectedHandshakes = 0
      if (/key mismatch|pinned key|incompatible sPi/.test(message) || this.rejectedHandshakes >= 3) {
        this.reason = this.rejectedHandshakes >= 3 ? 'revoked' : message.includes('incompatible') ? 'incompatible' : 'key_changed'
        const detail = REJECTED_DETAIL[this.reason]
        this.stopped = true
        this.setState('rejected', detail)
        this.settleFirst(new Error(detail))
        return
      }
      this.setState(this.everConnected ? 'reconnecting' : 'connecting', this.deps.backend.explain(error))
      this.deps.log?.('remote connect failed: ' + this.deps.backend.explain(error))
      this.schedule()
    }
  }
}
