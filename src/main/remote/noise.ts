// Minimal Noise Protocol Framework (revision 34) implementation for exactly two
// patterns: Noise_XXpsk3_25519_ChaChaPoly_BLAKE2s (first pairing, one-time PSK) and
// Noise_IK_25519_ChaChaPoly_BLAKE2s (client pinned the host key; the host checks the
// encrypted client key against its paired-device list, so no cleartext device ID is sent).
// Correctness is pinned by the cacophony test vectors (scripts/remote-noise.test.cjs).
import { x25519 } from '@noble/curves/ed25519.js'
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { blake2s } from '@noble/hashes/blake2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { randomBytes } from 'crypto'

const HASHLEN = 32
const DHLEN = 32
const TAGLEN = 16
export const MAX_MESSAGE = 65535
const EMPTY = new Uint8Array(0)

export type PatternName = 'XXpsk3' | 'IK'
export interface KeyPair { publicKey: Uint8Array; privateKey: Uint8Array }

type Token = 'e' | 's' | 'ee' | 'es' | 'se' | 'ss' | 'psk'
interface Pattern { initiatorPre: Token[]; responderPre: Token[]; messages: Token[][]; psk: boolean }
const PATTERNS: Record<PatternName, Pattern> = {
  XXpsk3: { initiatorPre: [], responderPre: [], messages: [['e'], ['e', 'ee', 's', 'es'], ['s', 'se', 'psk']], psk: true },
  IK: { initiatorPre: [], responderPre: ['s'], messages: [['e', 'es', 's', 'ss'], ['e', 'ee', 'se']], psk: false }
}

export function generateKeyPair(): KeyPair {
  const privateKey = x25519.utils.randomSecretKey()
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) }
}
export function keyPairFromPrivate(privateKey: Uint8Array): KeyPair {
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}
function hkdf(ck: Uint8Array, ikm: Uint8Array, outputs: 2 | 3): Uint8Array[] {
  const tempKey = hmac(blake2s, ck, ikm)
  const out1 = hmac(blake2s, tempKey, Uint8Array.of(1))
  const out2 = hmac(blake2s, tempKey, concat(out1, Uint8Array.of(2)))
  if (outputs === 2) return [out1, out2]
  return [out1, out2, hmac(blake2s, tempKey, concat(out2, Uint8Array.of(3)))]
}
function dh(kp: KeyPair, pub: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(kp.privateKey, pub)
}

export class CipherState {
  private k: Uint8Array | null = null
  private n = 0n
  constructor(key?: Uint8Array) { if (key) this.k = key }
  hasKey(): boolean { return this.k !== null }
  private nonce(): Uint8Array {
    if (this.n >= 0xffffffffffffffffn) throw new Error('Noise nonce exhausted')
    const nonce = new Uint8Array(12)
    new DataView(nonce.buffer).setBigUint64(4, this.n, true)
    return nonce
  }
  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (!this.k) return plaintext
    const out = chacha20poly1305(this.k, this.nonce(), ad).encrypt(plaintext)
    this.n++
    return out
  }
  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (!this.k) return ciphertext
    // Nonce advances only after successful authentication, per the spec.
    const out = chacha20poly1305(this.k, this.nonce(), ad).decrypt(ciphertext)
    this.n++
    return out
  }
}

class SymmetricState {
  ck: Uint8Array
  h: Uint8Array
  cipher = new CipherState()
  constructor(protocolName: string) {
    const name = new TextEncoder().encode(protocolName)
    if (name.length <= HASHLEN) { this.h = new Uint8Array(HASHLEN); this.h.set(name) } else this.h = blake2s(name)
    this.ck = this.h
  }
  mixKey(ikm: Uint8Array): void {
    const [ck, k] = hkdf(this.ck, ikm, 2)
    this.ck = ck; this.cipher = new CipherState(k)
  }
  mixHash(data: Uint8Array): void { this.h = blake2s(concat(this.h, data)) }
  mixKeyAndHash(ikm: Uint8Array): void {
    const [ck, th, k] = hkdf(this.ck, ikm, 3)
    this.ck = ck; this.mixHash(th); this.cipher = new CipherState(k)
  }
  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ct = this.cipher.encryptWithAd(this.h, plaintext)
    this.mixHash(ct)
    return ct
  }
  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const pt = this.cipher.decryptWithAd(this.h, ciphertext)
    this.mixHash(ciphertext)
    return pt
  }
  split(): [CipherState, CipherState] {
    const [k1, k2] = hkdf(this.ck, EMPTY, 2)
    return [new CipherState(k1), new CipherState(k2)]
  }
}

export interface HandshakeOptions {
  pattern: PatternName
  initiator: boolean
  prologue: Uint8Array
  s: KeyPair
  rs?: Uint8Array
  psk?: Uint8Array
  /** Test-vector hook only; production code always generates a fresh ephemeral. */
  e?: KeyPair
}

export interface HandshakeResult {
  send: CipherState
  recv: CipherState
  handshakeHash: Uint8Array
  remoteStatic: Uint8Array
}

export class HandshakeState {
  private readonly ss: SymmetricState
  private readonly pattern: Pattern
  private readonly initiator: boolean
  private readonly s: KeyPair
  private e: KeyPair | undefined
  private rs: Uint8Array | undefined
  private re: Uint8Array | undefined
  private readonly psk: Uint8Array | undefined
  private index = 0
  private result: HandshakeResult | null = null

  constructor(opts: HandshakeOptions) {
    this.pattern = PATTERNS[opts.pattern]
    this.initiator = opts.initiator
    this.s = opts.s
    this.e = opts.e
    this.rs = opts.rs
    this.psk = opts.psk
    if (this.pattern.psk && opts.psk?.length !== 32) throw new Error('Noise PSK must be 32 bytes')
    if (opts.pattern === 'IK' && opts.initiator && opts.rs?.length !== DHLEN) throw new Error('IK initiator requires the pinned responder key')
    this.ss = new SymmetricState(`Noise_${opts.pattern}_25519_ChaChaPoly_BLAKE2s`)
    this.ss.mixHash(opts.prologue)
    for (const t of this.pattern.initiatorPre) if (t === 's') this.ss.mixHash(this.initiator ? this.s.publicKey : this.rs!)
    for (const t of this.pattern.responderPre) if (t === 's') this.ss.mixHash(this.initiator ? this.rs! : this.s.publicKey)
  }

  get complete(): boolean { return this.result !== null }
  /** Remote static key once received (or pinned); responders authorize it before replying. */
  get remoteStaticKey(): Uint8Array | undefined { return this.rs }
  /** True when it is this side's turn to call writeMessage. */
  get isMyTurn(): boolean { return !this.complete && (this.index % 2 === 0) === this.initiator }

  writeMessage(payload: Uint8Array = EMPTY): Uint8Array {
    if (!this.isMyTurn) throw new Error('Noise handshake out of order')
    const parts: Uint8Array[] = []
    for (const token of this.pattern.messages[this.index]) {
      switch (token) {
        case 'e':
          if (!this.e) this.e = generateKeyPair()
          parts.push(this.e.publicKey)
          this.ss.mixHash(this.e.publicKey)
          if (this.pattern.psk) this.ss.mixKey(this.e.publicKey)
          break
        case 's': parts.push(this.ss.encryptAndHash(this.s.publicKey)); break
        case 'psk': this.ss.mixKeyAndHash(this.psk!); break
        default: this.ss.mixKey(this.dhToken(token))
      }
    }
    parts.push(this.ss.encryptAndHash(payload))
    this.advance()
    const message = concat(...parts)
    if (message.length > MAX_MESSAGE) throw new Error('Noise message too large')
    return message
  }

  readMessage(message: Uint8Array): Uint8Array {
    if (this.complete || this.isMyTurn) throw new Error('Noise handshake out of order')
    let offset = 0
    const take = (n: number) => {
      if (offset + n > message.length) throw new Error('Noise handshake message truncated')
      const out = message.subarray(offset, offset + n); offset += n; return out
    }
    for (const token of this.pattern.messages[this.index]) {
      switch (token) {
        case 'e':
          this.re = take(DHLEN).slice()
          this.ss.mixHash(this.re)
          if (this.pattern.psk) this.ss.mixKey(this.re)
          break
        case 's': {
          const rs = this.ss.decryptAndHash(take(this.ss.cipher.hasKey() ? DHLEN + TAGLEN : DHLEN))
          if (this.rs && !bytesEqual(this.rs, rs)) throw new Error('Remote static key does not match the pinned key')
          this.rs = rs
          break
        }
        case 'psk': this.ss.mixKeyAndHash(this.psk!); break
        default: this.ss.mixKey(this.dhToken(token))
      }
    }
    const payload = this.ss.decryptAndHash(message.subarray(offset))
    this.advance()
    return payload
  }

  finish(): HandshakeResult {
    if (!this.result) throw new Error('Noise handshake is not complete')
    return this.result
  }

  private dhToken(token: Token): Uint8Array {
    const need = (v: KeyPair | Uint8Array | undefined, what: string) => { if (!v) throw new Error('Noise missing ' + what); return v }
    switch (token) {
      case 'ee': return dh(need(this.e, 'e') as KeyPair, need(this.re, 're') as Uint8Array)
      case 'ss': return dh(this.s, need(this.rs, 'rs') as Uint8Array)
      case 'es': return this.initiator ? dh(need(this.e, 'e') as KeyPair, need(this.rs, 'rs') as Uint8Array) : dh(this.s, need(this.re, 're') as Uint8Array)
      case 'se': return this.initiator ? dh(this.s, need(this.re, 're') as Uint8Array) : dh(need(this.e, 'e') as KeyPair, need(this.rs, 'rs') as Uint8Array)
      default: throw new Error('Not a DH token: ' + token)
    }
  }

  private advance(): void {
    this.index++
    if (this.index < this.pattern.messages.length) return
    const [c1, c2] = this.ss.split()
    this.result = {
      send: this.initiator ? c1 : c2,
      recv: this.initiator ? c2 : c1,
      handshakeHash: this.ss.h,
      remoteStatic: this.rs!
    }
  }
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export function randomSecret(): Uint8Array { return new Uint8Array(randomBytes(32)) }
