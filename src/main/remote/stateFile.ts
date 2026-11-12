import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** Private (0600) atomic replace, so a crash never leaves a half-written device list or key. */
export function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = file + '.' + randomUUID() + '.tmp'
  try { writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 }); renameSync(temp, file) }
  finally { rmSync(temp, { force: true }) }
}
