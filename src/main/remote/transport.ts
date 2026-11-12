// Transport abstraction: an untrusted, reliable, ordered byte stream between two peers.
// Encryption and authentication live above this layer (secure.ts), so any relay
// (Dev Tunnels, Tailscale, a self-hosted WebSocket relay) can implement it.
import net from 'net'
import type { Duplex } from 'stream'

export interface ByteStream {
  send(chunk: Uint8Array): Promise<void>
  recv(): AsyncIterable<Uint8Array>
  close(reason?: string): Promise<void>
  readonly closed: Promise<string>
}

export type TransportAddress = { kind: string; [key: string]: unknown }
export type TransportStatus = 'connecting' | 'connected' | 'disconnected'

export interface Listener {
  readonly address: TransportAddress
  onStatus(cb: (status: TransportStatus, detail?: string) => void): () => void
  close(): Promise<void>
}

export interface Transport {
  readonly kind: string
  listen(onStream: (stream: ByteStream) => void): Promise<Listener>
  connect(address: TransportAddress, signal?: AbortSignal): Promise<ByteStream>
  close?(): Promise<void>
}

export function duplexStream(duplex: Duplex): ByteStream {
  let resolveClosed!: (reason: string) => void
  const closed = new Promise<string>(resolve => { resolveClosed = resolve })
  let closeReason = 'closed by peer'
  duplex.once('close', () => resolveClosed(closeReason))
  duplex.once('error', (error: Error) => { closeReason = 'error: ' + error.message })
  return {
    closed,
    send: chunk => new Promise((resolve, reject) => {
      if (duplex.destroyed || duplex.writableEnded) return reject(new Error('stream closed'))
      duplex.write(chunk, error => error ? reject(error) : resolve())
    }),
    async *recv() {
      try { for await (const chunk of duplex) yield chunk instanceof Uint8Array ? chunk : Buffer.from(chunk) } catch { /* surfaced via closed */ }
    },
    close: async reason => {
      if (reason) closeReason = reason
      if (!duplex.destroyed) duplex.destroy()
      await closed
    }
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
      if (signal) {
        onAbort = () => reject(new Error('connection cancelled'))
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  ]).finally(() => { clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort) })
}

/** Plain TCP on 127.0.0.1: the endpoint Dev Tunnels forwards to, and the transport used by tests. */
export class LoopbackTransport implements Transport {
  readonly kind = 'loopback'
  private readonly port: number
  constructor(port = 0) { this.port = port }

  async listen(onStream: (stream: ByteStream) => void): Promise<Listener> {
    const sockets = new Set<net.Socket>()
    const server = net.createServer({ noDelay: true }, socket => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      onStream(duplexStream(socket))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: this.port, exclusive: true }, () => { server.off('error', reject); resolve() })
    })
    const port = (server.address() as net.AddressInfo).port
    return {
      address: { kind: this.kind, port },
      onStatus: () => () => {},
      // server.close() alone waits for every accepted connection to end on its own.
      close: () => new Promise<void>(resolve => { server.close(() => resolve()); for (const socket of sockets) socket.destroy() })
    }
  }

  async connect(address: TransportAddress, signal?: AbortSignal): Promise<ByteStream> {
    const port = Number(address.port)
    if (address.kind !== this.kind || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid loopback address')
    const socket = net.connect({ host: '127.0.0.1', port, noDelay: true })
    try {
      await withTimeout(new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) }), 10_000, 'connection timed out', signal)
    } catch (error) { socket.destroy(); throw error }
    return duplexStream(socket)
  }
}

export async function freeLoopbackPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0 }, () => resolve()) })
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}
