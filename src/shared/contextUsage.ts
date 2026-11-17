export interface ContextUsage { tokens: number | null; contextWindow: number; percent: number | null }

/** Pi's current context estimate, NOT cumulative session token/cost statistics. */
export function contextUsageFromStats(stats: unknown): ContextUsage | null {
  const usage = (stats as { contextUsage?: Partial<ContextUsage> } | null)?.contextUsage
  if (!usage || typeof usage.contextWindow !== 'number' || !Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return null
  const tokens = usage.tokens
  if (tokens === null) return { tokens: null, contextWindow: usage.contextWindow, percent: null }
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) return null
  return { tokens, contextWindow: usage.contextWindow, percent: tokens / usage.contextWindow * 100 }
}

export const MAX_COMPACTION_INSTRUCTION_LENGTH = 16_000
export function compactionInstructions(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > MAX_COMPACTION_INSTRUCTION_LENGTH || value.includes('\0')) throw new Error('Invalid compaction instructions (maximum 16000 characters)')
  return value.trim() || undefined
}

export function compactionFailure(error: unknown): Error {
  const text = error instanceof Error ? error.message : ''
  if (/nothing to compact|session too small/i.test(text)) return new Error('Nothing to compact: the session is too small')
  if (/already compacted/i.test(text)) return new Error('This session is already compacted')
  if (/cancelled|canceled|aborted/i.test(text)) return new Error('Context compaction was cancelled')
  if (/timeout|timed out/i.test(text)) return new Error('Compaction response timed out; check session status before trying again')
  return new Error('Context compaction failed; check the Pi model, authentication and network before trying again')
}
