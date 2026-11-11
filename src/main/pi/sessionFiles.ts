import { createReadStream } from 'fs'
import { appendFile, lstat, open, realpath } from 'fs/promises'
import { createInterface } from 'readline'
import { dirname, extname, relative, resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import os from 'os'
import { join } from 'path'

export function sessionRoot(): string { return join(process.env.PI_CODING_AGENT_DIR || join(os.homedir(), '.pi', 'agent'), 'sessions') }
export function sessionName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Session name must contain 1–120 characters on one line')
  return value.trim()
}
/** Mutation is restricted to actual Pi session files, never arbitrary renderer-supplied paths/symlinks. */
export async function checkedSessionFile(value: unknown): Promise<string> {
  if (typeof value !== 'string' || extname(value) !== '.jsonl') throw new Error('Invalid session file')
  const file = resolve(value), info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid session file')
  const [root, actual, parent] = await Promise.all([realpath(sessionRoot()), realpath(file), realpath(dirname(file))])
  const rel = relative(root, actual)
  if (actual !== file || parent !== dirname(file) || rel.startsWith('..' + sep) || rel === '..' || rel.split(sep).length !== 2) throw new Error('Session file is outside the Pi session directory')
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(8192), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const line = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0]
    const header = JSON.parse(line)
    if (header.type !== 'session' || typeof header.id !== 'string' || typeof header.cwd !== 'string') throw new Error('Invalid Pi session header')
  } finally { await handle.close() }
  return file
}
/** Closed sessions only; live sessions must use set_session_name so Pi's in-memory tree stays current. */
export async function renameSessionFile(file: string, value: unknown): Promise<string> {
  const name = sessionName(value)
  await checkedSessionFile(file)
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  let parentId: string | null = null
  try { for await (const line of lines) { if (!line.trim()) continue; const record = JSON.parse(line); if (record.type !== 'session' && typeof record.id === 'string') parentId = record.id } }
  finally { lines.close() }
  // A leading LF also separates a complete last record that lacked its final newline.
  await appendFile(file, '\n' + JSON.stringify({ type: 'session_info', id: randomUUID().replaceAll('-', '').slice(0, 8), parentId, timestamp: new Date().toISOString(), name }) + '\n', 'utf8')
  return name
}
