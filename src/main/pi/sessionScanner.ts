import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import os from 'os'
import type { SessionMeta } from '../../shared/types'

const SESSIONS_DIR = join(process.env.PI_CODING_AGENT_DIR || join(os.homedir(), '.pi', 'agent'), 'sessions')
const READ_CAP = 2 * 1024 * 1024 // 单个会话文件最多读 2MB 提取标题

/** cwd → 会话目录名：去掉开头 /，把 / \ : 换成 -，前后各加一个 - */
export function cwdSlug(cwd: string): string {
  return '--' + cwd.replace(/^\//, '').replace(/[\/\\:]/g, '-') + '--'
}

interface Header {
  id?: string
  timestamp?: string
  cwd?: string
}

/** 解析单个会话文件（容错：pi 可能正在追加写） */
async function parseSessionFile(path: string, fallbackCwd: string): Promise<SessionMeta | null> {
  try {
    const st = await stat(path)
    const buf = await readFile(path)
    const text = buf.subarray(0, READ_CAP).toString('utf8')

    let header: Header = {}
    let name: string | undefined
    let title: string | undefined

    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let rec: Record<string, unknown>
      try {
        rec = JSON.parse(line)
      } catch {
        continue
      }
      if (rec.type === 'session' && !header.id) {
        header = rec as Header
        continue
      }
      if (rec.type === 'session_info' && typeof rec.name === 'string') {
        name = rec.name // 取最后一个
        continue
      }
      if (rec.type === 'message' && !title) {
        const msg = rec.message as { role?: string; content?: unknown } | undefined
        if (msg?.role === 'user') title = extractUserText(msg.content)
      }
      if (header.id && name !== undefined && title !== undefined) break
    }

    return {
      path,
      id: header.id ?? path,
      cwd: header.cwd ?? fallbackCwd,
      createdAt: header.timestamp ?? new Date(st.mtimeMs).toISOString(),
      mtime: st.mtimeMs,
      name,
      title
    }
  } catch {
    return null
  }
}

/** 扫描某目录下的会话（按 mtime 倒序） */
export async function scanSessions(cwd: string): Promise<SessionMeta[]> {
  const dir = join(SESSIONS_DIR, cwdSlug(cwd))
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const results: SessionMeta[] = []
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue
    const meta = await parseSessionFile(join(dir, f), cwd)
    if (meta) results.push(meta)
  }
  results.sort((a, b) => b.mtime - a.mtime)
  return results
}

/** 跨目录扫描近期会话：先按 mtime 取最新 N 个文件，再解析（避免全量解析） */
export async function scanRecent(limit = 50): Promise<SessionMeta[]> {
  let subdirs: string[]
  try {
    subdirs = await readdir(SESSIONS_DIR)
  } catch {
    return []
  }

  // 收集所有文件 + mtime
  const candidates: Array<{ path: string; mtime: number }> = []
  for (const d of subdirs) {
    let files: string[]
    try {
      files = await readdir(join(SESSIONS_DIR, d))
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(SESSIONS_DIR, d, f)
      try {
        const st = await stat(path)
        candidates.push({ path, mtime: st.mtimeMs })
      } catch {}
    }
  }

  // 按 mtime 倒序取最新 N 个
  candidates.sort((a, b) => b.mtime - a.mtime)
  const top = candidates.slice(0, limit)

  const results: SessionMeta[] = []
  for (const c of top) {
    const meta = await parseSessionFile(c.path, '')
    if (meta) results.push(meta)
  }
  results.sort((a, b) => b.mtime - a.mtime)
  return results
}

function extractUserText(content: unknown): string | undefined {
  if (typeof content === 'string') return content.slice(0, 80)
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .filter(Boolean)
    if (parts.length) return parts.join(' ').slice(0, 80)
  }
  return undefined
}
