// Shared by the settings UI and the authoritative host-side validation.
export const PAIRING_TTL_MS = 60 * 60_000
export const MAX_PAIRING_TTL_MS = 60 * 24 * 60 * 60_000
export function validatePairingTtl(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 60_000 || value > MAX_PAIRING_TTL_MS) {
    throw new Error('Pairing code lifetime must be between 1 minute and 60 days')
  }
  return value
}
