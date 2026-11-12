// One-time pairing codes. A code is carried out-of-band by the user (never through the relay)
// and contains the relay address, the host's static Noise key and a one-time 32-byte PSK.
import { createHash } from 'crypto'
import { randomSecret } from './noise'
import type { TransportAddress } from './transport'

import { PAIRING_TTL_MS, validatePairingTtl } from '../../shared/pairing'
export { PAIRING_TTL_MS, MAX_PAIRING_TTL_MS } from '../../shared/pairing'
export const PAIRING_ATTEMPTS = 3
const PREFIX = 'spi1.'

export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')
export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'base64url'))
/** Short, human-comparable key identifier; safe to display and log. */
export function keyFingerprint(key: Uint8Array): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16).replace(/(.{4})(?!$)/g, '$1-')
}

export interface PairingCode { address: TransportAddress; hostKey: Uint8Array; psk: Uint8Array; expiresAt: number }

function validAddress(value: unknown): value is TransportAddress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const a = value as Record<string, unknown>
  const port = Number(a.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false
  if (a.kind === 'loopback') return Object.keys(a).every(k => k === 'kind' || k === 'port')
  if (a.kind !== 'devtunnels') return false
  const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v)
  return id(a.tunnelId) && id(a.clusterId) && (a.hostLabel === undefined || (typeof a.hostLabel === 'string' && /^[\w-]{1,50}$/.test(a.hostLabel)))
}

export function encodePairingCode(code: PairingCode): string {
  return PREFIX + Buffer.from(JSON.stringify({ a: code.address, k: toBase64(code.hostKey), p: toBase64(code.psk), x: code.expiresAt })).toString('base64url')
}

export function decodePairingCode(text: unknown): PairingCode {
  if (typeof text !== 'string') throw new Error('Invalid pairing code')
  const trimmed = text.replace(/\s+/g, '')
  if (!trimmed.startsWith(PREFIX) || trimmed.length > 4096) throw new Error('This is not an sPi pairing code')
  let raw: { a?: unknown; k?: unknown; p?: unknown; x?: unknown }
  try { raw = JSON.parse(Buffer.from(trimmed.slice(PREFIX.length), 'base64url').toString('utf8')) } catch { throw new Error('The pairing code is damaged; copy it again') }
  if (!raw || typeof raw.k !== 'string' || typeof raw.p !== 'string' || typeof raw.x !== 'number' || !validAddress(raw.a)) throw new Error('The pairing code is damaged; copy it again')
  const hostKey = fromBase64(raw.k), psk = fromBase64(raw.p)
  if (hostKey.length !== 32 || psk.length !== 32) throw new Error('The pairing code is damaged; copy it again')
  return { address: raw.a, hostKey, psk, expiresAt: raw.x }
}

/** Host-side single active offer: configurable lifetime, one use, 3 failed handshakes. */
export class PairingOffer {
  readonly psk = randomSecret()
  readonly expiresAt: number
  private attemptsLeft = PAIRING_ATTEMPTS
  private inFlight = false
  private finished = false
  constructor(now = Date.now(), ttlMs: unknown = PAIRING_TTL_MS) { this.expiresAt = now + validatePairingTtl(ttlMs) }

  get active(): boolean { return !this.finished && Date.now() <= this.expiresAt }
  /** Claims the PSK for one handshake at a time; concurrent attempts are refused. */
  claim(): Uint8Array | null {
    if (!this.active || this.inFlight) return null
    this.inFlight = true
    return this.psk
  }
  release(): void { this.inFlight = false }
  failed(): void { if (--this.attemptsLeft <= 0) this.finished = true }
  consume(): void { this.finished = true }
}
