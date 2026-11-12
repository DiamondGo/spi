// JSON request/response/event protocol over a SecureChannel.
import type { SecureChannel } from './secure'

type Wire =
  | { t: 'req'; id: number; method: string; params?: unknown }
  | { t: 'res'; id: number; ok: true; result?: unknown }
  | { t: 'res'; id: number; ok: false; error: string }
  | { t: 'evt'; name: string; data?: unknown }

export type Handler = (params: unknown, peer: RpcPeer) => unknown | Promise<unknown>

export class RpcDisconnected extends Error {
  constructor(message = 'remote connection lost') { super(message); this.name = 'RpcDisconnected' }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class RpcPeer {
  readonly channel: SecureChannel
  readonly done: Promise<string>
  private readonly handlers: Record<string, Handler>
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private readonly eventListeners = new Set<(name: string, data: unknown) => void>()
  private readonly closeListeners = new Set<() => void>()
  private nextId = 1
  private isClosed = false

  constructor(channel: SecureChannel, handlers: Record<string, Handler> = {}) {
    this.channel = channel
    this.handlers = handlers
    this.done = this.pump()
  }

  get closed(): boolean { return this.isClosed }

  call(method: string, params?: unknown): Promise<unknown> {
    if (this.isClosed) return Promise.reject(new RpcDisconnected())
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ t: 'req', id, method, params }).catch(() => {})
    })
  }

  emit(name: string, data?: unknown): Promise<void> { return this.write({ t: 'evt', name, data }) }

  onEvent(cb: (name: string, data: unknown) => void): () => void {
    this.eventListeners.add(cb)
    return () => this.eventListeners.delete(cb)
  }

  /** Runs synchronously before in-flight calls are rejected, so owners can start reconnecting first. */
  onClose(cb: () => void): void { this.closeListeners.add(cb) }

  close(reason?: string): Promise<void> { return this.channel.close(reason) }

  private write(message: Wire): Promise<void> {
    if (this.isClosed) return Promise.reject(new RpcDisconnected())
    return this.channel.send(encoder.encode(JSON.stringify(message)))
  }

  private async pump(): Promise<string> {
    try {
      for await (const raw of this.channel.messages()) {
        let message: Wire
        try { message = JSON.parse(decoder.decode(raw)) } catch { await this.channel.close('malformed RPC message'); break }
        if (message.t === 'req') void this.dispatch(message)
        else if (message.t === 'res') {
          const waiter = this.pending.get(message.id)
          if (!waiter) continue
          this.pending.delete(message.id)
          if (message.ok) waiter.resolve(message.result)
          else waiter.reject(new Error(message.error))
        } else if (message.t === 'evt') for (const cb of this.eventListeners) cb(message.name, message.data)
      }
    } finally {
      this.isClosed = true
      for (const cb of this.closeListeners) cb()
      // In-flight calls are never silently replayed; the caller decides whether a retry is safe.
      for (const waiter of this.pending.values()) waiter.reject(new RpcDisconnected())
      this.pending.clear()
    }
    return this.channel.closed
  }

  private async dispatch(message: { id: number; method: string; params?: unknown }): Promise<void> {
    const handler = Object.hasOwn(this.handlers, message.method) ? this.handlers[message.method] : undefined
    try {
      if (!handler) throw new Error('unknown method: ' + message.method)
      const result = await handler(message.params, this)
      await this.write({ t: 'res', id: message.id, ok: true, result })
    } catch (error) {
      if (this.isClosed) return
      await this.write({ t: 'res', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }).catch(() => {})
    }
  }
}
