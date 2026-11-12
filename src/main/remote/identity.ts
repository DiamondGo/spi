// The device's static X25519 key, shared by the host and client roles. The private key is
// encrypted with the OS credential store (Electron safeStorage) before it touches disk.
import { generateKeyPair, keyPairFromPrivate, type KeyPair } from './noise'
import { readJson, writeJsonAtomic } from './stateFile'

export interface SecretStorage {
  /** Null when usable; otherwise a user-facing reason why keys cannot be protected. */
  problem(): string | null
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

export function electronSecretStorage(safeStorage: Electron.SafeStorage, platform = process.platform, allowPlaintextForTests = false): SecretStorage {
  return {
    problem() {
      if (allowPlaintextForTests) return null
      if (!safeStorage.isEncryptionAvailable()) return 'The system credential store is unavailable, so sPi cannot protect its remote access key.'
      if (platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return 'No system keyring (for example GNOME Keyring or KWallet) is available. Remote access is disabled so its key is never stored in plain text.'
      return null
    },
    encrypt: text => allowPlaintextForTests ? Buffer.from('test:' + text) : safeStorage.encryptString(text),
    decrypt: data => {
      if (!allowPlaintextForTests) return safeStorage.decryptString(data)
      const text = data.toString()
      if (!text.startsWith('test:')) throw new Error('Not a test key')
      return text.slice(5)
    }
  }
}

export function loadOrCreateIdentity(file: string, storage: SecretStorage): KeyPair {
  const problem = storage.problem()
  if (problem) throw new Error(problem)
  const saved = readJson(file) as { version?: unknown; key?: unknown } | null
  if (saved && saved.version === 1 && typeof saved.key === 'string') {
    let hex: string
    try { hex = storage.decrypt(Buffer.from(saved.key, 'base64')) } catch { throw new Error('The remote access key could not be decrypted by the system credential store. Re-pairing is required after resetting it.') }
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('The remote access key file is damaged.')
    return keyPairFromPrivate(Uint8Array.from(Buffer.from(hex, 'hex')))
  }
  if (saved) throw new Error('The remote access key file is damaged.')
  const identity = generateKeyPair()
  writeJsonAtomic(file, { version: 1, key: storage.encrypt(Buffer.from(identity.privateKey).toString('hex')).toString('base64') })
  return identity
}
