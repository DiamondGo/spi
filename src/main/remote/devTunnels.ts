// Dev Tunnels implementation of the Transport interface, using the official TS SDK in-process
// (no devtunnel CLI). The relay only ever carries Noise ciphertext produced by secure.ts.
import { createHash } from 'crypto'
import { TunnelRelayTunnelHost, TunnelRelayTunnelClient } from '@microsoft/dev-tunnels-connections'
import { TunnelManagementHttpClient, ManagementApiVersions } from '@microsoft/dev-tunnels-management'
import { TunnelAccessScopes, type Tunnel } from '@microsoft/dev-tunnels-contracts'
import { LoopbackTransport, duplexStream, freeLoopbackPort, withTimeout, type ByteStream, type Listener, type Transport, type TransportAddress, type TransportStatus } from './transport'

export interface DevTunnelsAddress extends TransportAddress { kind: 'devtunnels'; tunnelId: string; clusterId: string; port: number; hostLabel?: string }
export interface HostTunnelRecord { tunnelId: string; clusterId: string; port: number }

export const REMOTE_LABEL = 'spi-remote'
/** Lets a client find its host again if the tunnel was recreated; reveals no host name. */
export function hostLabel(hostKey: Uint8Array): string {
  return 'spi-host-' + createHash('sha256').update('spi-remote-label/1').update(hostKey).digest('hex').slice(0, 24)
}

export class TunnelMissingError extends Error {
  constructor() { super('The host tunnel no longer exists (deleted or expired)'); this.name = 'TunnelMissingError' }
}

export function createManagementClient(userToken: () => Promise<string | null>, version: string): TunnelManagementHttpClient {
  return new TunnelManagementHttpClient({ name: 'spi', version }, ManagementApiVersions.Version20230927preview, userToken)
}

export function isAuthError(error: unknown): boolean {
  return /\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid_token/i.test(error instanceof Error ? error.message : String(error))
}

async function portIsFree(port: number): Promise<boolean> {
  try { const listener = await new LoopbackTransport(port).listen(() => {}); await listener.close(); return true } catch { return false }
}

/** Reuses the persisted host tunnel (recreating it if it expired) and makes sure its single port is bindable. */
export async function ensureHostTunnel(management: TunnelManagementHttpClient, saved: HostTunnelRecord | undefined, hostKey: Uint8Array): Promise<{ tunnel: Tunnel; port: number }> {
  const options = { tokenScopes: [TunnelAccessScopes.Host], includePorts: true }
  let tunnel = saved ? await management.getTunnel({ tunnelId: saved.tunnelId, clusterId: saved.clusterId }, options) : null
  if (!tunnel) {
    const port = await freeLoopbackPort()
    tunnel = await management.createTunnel({ labels: [REMOTE_LABEL, hostLabel(hostKey)], ports: [{ portNumber: port, protocol: 'auto' }] }, options)
    return { tunnel, port }
  }
  const existing = (tunnel.ports ?? []).map(p => p.portNumber)
  const current = saved?.port && existing.includes(saved.port) ? saved.port : existing[0]
  if (current && await portIsFree(current)) return { tunnel, port: current }
  const port = await freeLoopbackPort()
  await management.createTunnelPort(tunnel, { portNumber: port, protocol: 'auto' }, options)
  for (const old of existing) await management.deleteTunnelPort(tunnel, old, options).catch(() => false)
  return { tunnel: (await management.getTunnel(tunnel, options)) ?? tunnel, port }
}

/** Client side: locate a host whose tunnel was recreated, via its key-derived label. */
export async function findHostTunnel(management: TunnelManagementHttpClient, label: string): Promise<DevTunnelsAddress | null> {
  const found = await management.listTunnels(undefined, undefined, { labels: [label], includePorts: true })
  const tunnel = found.find(t => t.tunnelId && t.clusterId && t.ports?.length)
  if (!tunnel) return null
  return { kind: 'devtunnels', tunnelId: tunnel.tunnelId!, clusterId: tunnel.clusterId!, port: tunnel.ports![0].portNumber, hostLabel: label }
}

const statusMap: Record<string, TransportStatus> = { connecting: 'connecting', refreshingTunnelAccessToken: 'connecting', refreshingTunnelHostPublicKey: 'connecting', connected: 'connected' }
const connectionOptions = { enableRetry: true, enableReconnect: true, keepAliveIntervalInSeconds: 15 }
const CLIENT_CONNECT_TIMEOUT_MS = 30_000
interface RelayEntry { ready: Promise<TunnelRelayTunnelClient>; client?: TunnelRelayTunnelClient }

export class DevTunnelsTransport implements Transport {
  readonly kind = 'devtunnels'
  private readonly management: TunnelManagementHttpClient
  private readonly clients = new Map<string, RelayEntry>()
  private hostTunnel: { tunnel: Tunnel; port: number } | null = null

  constructor(management: TunnelManagementHttpClient) { this.management = management }

  /** Host side: the tunnel must already contain `port`; the SDK forwards it to 127.0.0.1:port. */
  forHost(tunnel: Tunnel, port: number): this { this.hostTunnel = { tunnel, port }; return this }

  async listen(onStream: (stream: ByteStream) => void): Promise<Listener> {
    if (!this.hostTunnel) throw new Error('forHost() must be called before listen()')
    const { tunnel, port } = this.hostTunnel
    const local = await new LoopbackTransport(port).listen(onStream)
    const host = new TunnelRelayTunnelHost(this.management)
    const listeners = new Set<(s: TransportStatus, d?: string) => void>()
    host.connectionStatusChanged(e => {
      for (const cb of listeners) cb(statusMap[e.status] ?? 'disconnected', e.disconnectError?.message)
    })
    try { await withTimeout(host.connect(tunnel, connectionOptions), 60_000, 'Timed out connecting to the Dev Tunnels relay') }
    catch (error) { await host.dispose().catch(() => {}); await local.close(); throw error }
    const address: DevTunnelsAddress = { kind: 'devtunnels', tunnelId: tunnel.tunnelId!, clusterId: tunnel.clusterId!, port, hostLabel: tunnel.labels?.find(l => l.startsWith('spi-host-')) }
    return {
      address,
      onStatus: cb => { listeners.add(cb); return () => listeners.delete(cb) },
      close: async () => { await host.dispose().catch(() => {}); await local.close() }
    }
  }

  async connect(address: TransportAddress, signal?: AbortSignal): Promise<ByteStream> {
    const a = address as DevTunnelsAddress
    if (a.kind !== 'devtunnels') throw new Error('Not a Dev Tunnels address')
    const key = `${a.clusterId}/${a.tunnelId}`
    try {
      const client = await withTimeout(this.relayClient(a, key), CLIENT_CONNECT_TIMEOUT_MS, 'The host is offline or unreachable', signal)
      await withTimeout(client.waitForForwardedPort(a.port), CLIENT_CONNECT_TIMEOUT_MS, 'The host is offline or unreachable', signal)
      return duplexStream(await withTimeout(client.connectToForwardedPort(a.port), CLIENT_CONNECT_TIMEOUT_MS, 'The host is offline or unreachable', signal))
    } catch (error) {
      // Never keep a half-connected relay session: the next attempt starts clean.
      await this.drop(key)
      throw error
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.keys()].map(key => this.drop(key)))
  }

  private async drop(key: string): Promise<void> {
    const entry = this.clients.get(key)
    this.clients.delete(key)
    // Dispose directly: awaiting a connect that the SDK keeps retrying could hang forever.
    await entry?.client?.dispose().catch(() => {})
  }

  private relayClient(a: DevTunnelsAddress, key: string): Promise<TunnelRelayTunnelClient> {
    const existing = this.clients.get(key)
    if (existing) return existing.ready.then(c => c.connectionStatus === 'connected' ? c : this.drop(key).then(() => this.relayClient(a, key)))
    const entry: RelayEntry = { ready: null! }
    entry.ready = (async () => {
      const tunnel = await this.management.getTunnel({ tunnelId: a.tunnelId, clusterId: a.clusterId }, { tokenScopes: [TunnelAccessScopes.Connect] })
      if (!tunnel) throw new TunnelMissingError()
      if (this.clients.get(key) !== entry) throw new Error('connection cancelled')
      const client = entry.client = new TunnelRelayTunnelClient(this.management)
      client.acceptLocalConnectionsForForwardedPorts = false
      await client.connect(tunnel, connectionOptions)
      return client
    })()
    entry.ready.catch(() => { if (this.clients.get(key) === entry) void this.drop(key) })
    this.clients.set(key, entry)
    return entry.ready
  }
}
