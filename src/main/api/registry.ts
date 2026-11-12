// One table of main-process handlers shared by local windows (ipcMain) and paired remote
// devices (encrypted RPC). Handlers that only make sense on this machine opt out of remote use.
export type Caller =
  | { kind: 'local'; owner: string; sender: Electron.WebContents; mainFrame: boolean }
  | { kind: 'remote'; owner: string; deviceId: string }

type Invoke = (caller: Caller, ...args: any[]) => unknown
type Send = (caller: Caller, ...args: any[]) => void
interface Entry<T> { fn: T; remote: boolean }

export class ApiRegistry {
  private readonly invokes = new Map<string, Entry<Invoke>>()
  private readonly sends = new Map<string, Entry<Send>>()

  handle(channel: string, fn: Invoke, options: { remote?: boolean } = {}): void {
    if (this.invokes.has(channel)) throw new Error('Duplicate handler: ' + channel)
    this.invokes.set(channel, { fn, remote: options.remote ?? true })
  }

  on(channel: string, fn: Send, options: { remote?: boolean } = {}): void {
    if (this.sends.has(channel)) throw new Error('Duplicate listener: ' + channel)
    this.sends.set(channel, { fn, remote: options.remote ?? true })
  }

  get invokeChannels(): string[] { return [...this.invokes.keys()] }
  get sendChannels(): string[] { return [...this.sends.keys()] }

  /** Synchronous like the handler itself; ipcMain and the RPC layer both accept a value or a promise. */
  invoke(channel: string, caller: Caller, args: unknown[]): unknown {
    const entry = this.invokes.get(channel)
    if (!entry || (caller.kind === 'remote' && !entry.remote)) throw new Error('Unavailable operation: ' + channel)
    return entry.fn(caller, ...args)
  }

  send(channel: string, caller: Caller, args: unknown[]): void {
    const entry = this.sends.get(channel)
    if (!entry || (caller.kind === 'remote' && !entry.remote)) throw new Error('Unavailable operation: ' + channel)
    entry.fn(caller, ...args)
  }
}
