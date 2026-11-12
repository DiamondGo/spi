// Binds the relay (Dev Tunnels, or plain loopback for isolated tests) to an account provider.
// Everything above this file only sees the Transport interface.
import { DevTunnelsTransport, createManagementClient, ensureHostTunnel, findHostTunnel, isAuthError, type DevTunnelsAddress, type HostTunnelRecord } from './devTunnels'
import { GitHubCliAuth, type GitHubCliState } from './githubCli'
import { LoopbackTransport, type Transport, type TransportAddress } from './transport'
import type { TunnelManagementHttpClient } from '@microsoft/dev-tunnels-management'

export interface AccountStatus { state: GitHubCliState; message?: string }

export interface RemoteBackend {
  readonly kind: 'devtunnels' | 'loopback'
  account(): Promise<AccountStatus>
  prepareHost(hostKey: Uint8Array, saved?: HostTunnelRecord): Promise<{ transport: Transport; record: HostTunnelRecord }>
  clientTransport(): Transport
  /** Finds a host whose relay address changed (tunnel recreated); null when it cannot. */
  rediscover(address: TransportAddress): Promise<TransportAddress | null>
  /** Translates relay errors (for example a rejected account token) into user-facing text. */
  explain(error: unknown): string
}

export class DevTunnelsBackend implements RemoteBackend {
  readonly kind = 'devtunnels'
  private management: TunnelManagementHttpClient | null = null
  private client: DevTunnelsTransport | null = null
  constructor(private readonly version: string, readonly gh = new GitHubCliAuth()) {}

  account(): Promise<AccountStatus> { return this.gh.status() }

  private api(): TunnelManagementHttpClient {
    this.management ??= createManagementClient(async () => 'github ' + await this.gh.token(), this.version)
    return this.management
  }

  async prepareHost(hostKey: Uint8Array, saved?: HostTunnelRecord): Promise<{ transport: Transport; record: HostTunnelRecord }> {
    await this.gh.token()
    const { tunnel, port } = await this.guard(() => ensureHostTunnel(this.api(), saved, hostKey))
    return { transport: new DevTunnelsTransport(this.api()).forHost(tunnel, port), record: { tunnelId: tunnel.tunnelId!, clusterId: tunnel.clusterId!, port } }
  }

  clientTransport(): Transport {
    this.client ??= new DevTunnelsTransport(this.api())
    return this.client
  }

  async rediscover(address: TransportAddress): Promise<TransportAddress | null> {
    const label = (address as DevTunnelsAddress).hostLabel
    if (address.kind !== 'devtunnels' || !label) return null
    return this.guard(() => findHostTunnel(this.api(), label))
  }

  explain(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    if (isAuthError(error)) return 'Dev Tunnels rejected the GitHub CLI account. Run "gh auth status" and make sure both computers use the same GitHub account.'
    if (/\b429\b|rate limit|quota/i.test(message)) return 'Dev Tunnels reported a rate or monthly data limit. Try again later.'
    return message.replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[redacted]')
  }

  private async guard<T>(action: () => Promise<T>): Promise<T> {
    try { return await action() }
    catch (error) { if (isAuthError(error)) this.gh.invalidate(); throw error }
  }
}

/** Test-only backend: no account, no relay. The host listens on 127.0.0.1. */
export class LoopbackBackend implements RemoteBackend {
  readonly kind = 'loopback'
  private readonly transport = new LoopbackTransport()
  async account(): Promise<AccountStatus> { return { state: 'ready' } }
  async prepareHost(_hostKey: Uint8Array, saved?: HostTunnelRecord): Promise<{ transport: Transport; record: HostTunnelRecord }> {
    const port = saved?.port ?? 0
    return { transport: new LoopbackTransport(port), record: { tunnelId: 'loopback', clusterId: 'loopback', port } }
  }
  clientTransport(): Transport { return this.transport }
  async rediscover(): Promise<TransportAddress | null> { return null }
  explain(error: unknown): string { return error instanceof Error ? error.message : String(error) }
}
