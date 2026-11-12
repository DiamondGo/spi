// Authenticated encrypted message channel over an untrusted ByteStream.
// Wire format: every frame is a 2-byte big-endian length followed by that many bytes.
// Frame 0 is a cleartext 2-byte hello [version, mode]; it is bound into the Noise prologue,
// so a relay that rewrites it only causes the handshake to fail.
import { HandshakeState, MAX_MESSAGE, bytesEqual, type CipherState, type KeyPair } from './noise'
import type { ByteStream } from './transport'

const VERSION = 1
export const MODE_PAIR = 1
export const MODE_RESUME = 2
const PROLOGUE = new TextEncoder().encode('spi-remote/1')
const HANDSHAKE_TIMEOUT_MS = 10_000
const CHUNK = MAX_MESSAGE - 16 - 1
const MAX_APP_MESSAGE = 32 * 1024 * 1024
const EMPTY = new Uint8Array(0)

class FrameReader {
  private buffer = new Uint8Array(0)
  private readonly source: AsyncIterator<Uint8Array>
  constructor(stream: ByteStream) { this.source = stream.recv()[Symbol.asyncIterator]() }
  async next(): Promise<Uint8Array | null> {
    for (;;) {
      if (this.buffer.length >= 2) {
        const length = (this.buffer[0] << 8) | this.buffer[1]
        if (this.buffer.length >= 2 + length) {
          const frame = this.buffer.slice(2, 2 + length)
          this.buffer = this.buffer.slice(2 + length)
          return frame
        }
      }
      const { value, done } = await this.source.next()
      if (done) return null
      const merged = new Uint8Array(this.buffer.length + value.length)
      merged.set(this.buffer); merged.set(value, this.buffer.length)
      this.buffer = merged
    }
  }
}

async function writeFrame(stream: ByteStream, frame: Uint8Array): Promise<void> {
  if (frame.length > MAX_MESSAGE) throw new Error('frame too large')
  const out = new Uint8Array(2 + frame.length)
  out[0] = frame.length >> 8; out[1] = frame.length & 0xff
  out.set(frame, 2)
  await stream.send(out)
}

function prologue(hello: Uint8Array): Uint8Array {
  const out = new Uint8Array(PROLOGUE.length + hello.length)
  out.set(PROLOGUE); out.set(hello, PROLOGUE.length)
  return out
}

function handshakeDeadline<T>(promise: Promise<T>, stream: ByteStream, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timer = setTimeout(() => { void stream.close(what + ' timed out'); reject(new Error(what + ' timed out')) }, HANDSHAKE_TIMEOUT_MS) })
  ]).finally(() => clearTimeout(timer))
}

export class SecureChannel {
  readonly peerKey: Uint8Array
  readonly handshakeHash: Uint8Array
  readonly closed: Promise<string>
  /** Bytes put on / taken off the wire, including framing and AEAD overhead. */
  bytesSent = 0
  bytesReceived = 0
  /** Application bytes accepted by send() but not yet written; lets owners shed slow peers. */
  queuedBytes = 0
  private readonly stream: ByteStream
  private readonly reader: FrameReader
  private readonly sendCipher: CipherState
  private readonly recvCipher: CipherState
  private sendQueue: Promise<void> = Promise.resolve()

  constructor(stream: ByteStream, reader: FrameReader, send: CipherState, recv: CipherState, peerKey: Uint8Array, handshakeHash: Uint8Array) {
    this.stream = stream; this.reader = reader
    this.sendCipher = send; this.recvCipher = recv
    this.peerKey = peerKey; this.handshakeHash = handshakeHash
    this.closed = stream.closed
  }

  /** Sends one application message of any size; chunks never interleave with other messages. */
  send(message: Uint8Array): Promise<void> {
    if (message.length > MAX_APP_MESSAGE) return Promise.reject(new Error('message too large'))
    const run = async () => {
      let offset = 0
      do {
        const end = Math.min(offset + CHUNK, message.length)
        const plain = new Uint8Array(1 + end - offset)
        plain[0] = end === message.length ? 1 : 0
        plain.set(message.subarray(offset, end), 1)
        const frame = this.sendCipher.encryptWithAd(EMPTY, plain)
        this.bytesSent += frame.length + 2
        await writeFrame(this.stream, frame)
        offset = end
      } while (offset < message.length)
    }
    this.queuedBytes += message.length
    const result = this.sendQueue.then(run).finally(() => { this.queuedBytes -= message.length })
    this.sendQueue = result.catch(() => {})
    return result
  }

  async *messages(): AsyncIterable<Uint8Array> {
    let parts: Uint8Array[] = []
    let size = 0
    for (;;) {
      const frame = await this.reader.next()
      if (!frame) return
      this.bytesReceived += frame.length + 2
      let plain: Uint8Array
      // Any authentication failure is fatal: never resynchronise on a tampered stream.
      try { plain = this.recvCipher.decryptWithAd(EMPTY, frame) } catch { await this.stream.close('decryption failed'); return }
      if (plain.length < 1) { await this.stream.close('malformed frame'); return }
      size += plain.length - 1
      if (size > MAX_APP_MESSAGE) { await this.stream.close('message too large'); return }
      parts.push(plain.subarray(1))
      if (plain[0] === 1) {
        const out = new Uint8Array(size)
        let offset = 0
        for (const p of parts) { out.set(p, offset); offset += p.length }
        parts = []; size = 0
        yield out
      }
    }
  }

  close(reason?: string): Promise<void> { return this.stream.close(reason) }
}

/** The host closed mid-handshake: either it rejected this device or the relay dropped. */
export class HandshakeClosed extends Error {
  constructor() { super('host closed the connection during handshake'); this.name = 'HandshakeClosed' }
}

// Handshake payloads stay empty: in XXpsk3 the first message is keyed only by the
// ephemeral, so anything there would be readable by the relay. Metadata goes over the channel.
export type ClientHandshake =
  | { mode: 'pair'; identity: KeyPair; hostKey: Uint8Array; psk: Uint8Array }
  | { mode: 'resume'; identity: KeyPair; hostKey: Uint8Array }

export async function clientHandshake(stream: ByteStream, opts: ClientHandshake): Promise<SecureChannel> {
  const hello = Uint8Array.of(VERSION, opts.mode === 'pair' ? MODE_PAIR : MODE_RESUME)
  const reader = new FrameReader(stream)
  const run = async () => {
    await writeFrame(stream, hello)
    const hs = new HandshakeState(opts.mode === 'pair'
      ? { pattern: 'XXpsk3', initiator: true, prologue: prologue(hello), s: opts.identity, rs: opts.hostKey, psk: opts.psk }
      : { pattern: 'IK', initiator: true, prologue: prologue(hello), s: opts.identity, rs: opts.hostKey })
    while (!hs.complete) {
      if (hs.isMyTurn) await writeFrame(stream, hs.writeMessage())
      else {
        const frame = await reader.next()
        if (!frame) throw new HandshakeClosed()
        hs.readMessage(frame)
      }
    }
    const r = hs.finish()
    if (!bytesEqual(r.remoteStatic, opts.hostKey)) throw new Error('host key mismatch')
    return new SecureChannel(stream, reader, r.send, r.recv, r.remoteStatic, r.handshakeHash)
  }
  try { return await handshakeDeadline(run(), stream, 'handshake') } catch (error) { await stream.close('handshake failed'); throw error }
}

export interface ServerPolicy {
  identity: KeyPair
  /** IK: return true only for paired, non-revoked client keys. */
  isPaired(clientKey: Uint8Array): boolean
  /** Pairing: return the active one-time PSK, or null when no pairing offer is open. */
  pairingPsk(): Uint8Array | null
  onPairingFailed(): void
  onPaired(clientKey: Uint8Array): void
}

export async function serverHandshake(stream: ByteStream, policy: ServerPolicy): Promise<{ channel: SecureChannel; mode: 'pair' | 'resume' }> {
  const reader = new FrameReader(stream)
  const run = async () => {
    const hello = await reader.next()
    if (!hello || hello.length !== 2 || hello[0] !== VERSION || (hello[1] !== MODE_PAIR && hello[1] !== MODE_RESUME)) throw new Error('bad hello')
    const pairing = hello[1] === MODE_PAIR
    const psk = pairing ? policy.pairingPsk() : null
    if (pairing && !psk) throw new Error('no pairing offer is open')
    const hs = new HandshakeState(pairing
      ? { pattern: 'XXpsk3', initiator: false, prologue: prologue(hello), s: policy.identity, psk: psk! }
      : { pattern: 'IK', initiator: false, prologue: prologue(hello), s: policy.identity })
    while (!hs.complete) {
      if (hs.isMyTurn) await writeFrame(stream, hs.writeMessage())
      else {
        const frame = await reader.next()
        if (!frame) throw new Error('client closed during handshake')
        try { hs.readMessage(frame) } catch (error) { if (pairing) policy.onPairingFailed(); throw error }
        // Unknown keys get no reply at all, so an unpaired peer learns nothing.
        if (!pairing && !policy.isPaired(hs.remoteStaticKey!)) throw new Error('client key is not paired')
      }
    }
    const r = hs.finish()
    if (pairing) policy.onPaired(r.remoteStatic)
    return { channel: new SecureChannel(stream, reader, r.send, r.recv, r.remoteStatic, r.handshakeHash), mode: pairing ? 'pair' as const : 'resume' as const }
  }
  try { return await handshakeDeadline(run(), stream, 'handshake') } catch (error) { await stream.close('handshake rejected'); throw error }
}
