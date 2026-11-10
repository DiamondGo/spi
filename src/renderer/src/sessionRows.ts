import type { SessionMeta } from '../../shared/types'
import type { SessionUI } from './store'
export interface SessionRow extends SessionMeta { liveId?: string }
function fileKey(file: string): string { const win = /^[a-z]:[\\/]/i.test(file); const path = (win ? file.replaceAll('\\', '/') : file).replace(/\/\.\//g, '/'); return win ? path.toLowerCase() : path }
export function sameSession(session: SessionUI, meta: SessionMeta): boolean {
  if (session.state?.sessionFile) return fileKey(session.state.sessionFile) === fileKey(meta.path)
  return !!session.state?.sessionId && session.state.sessionId === meta.id
}
export function sessionRows(meta: SessionMeta[], sessions: Record<string, SessionUI>, cwd?: string | null): SessionRow[] {
  const opened = Object.values(sessions).filter(s => !cwd || s.cwd === cwd)
  const result: SessionRow[] = meta.map(m => ({ ...m, liveId: opened.find(s => sameSession(s, m))?.id }))
  for (const s of opened) {
    let row = result.find(m => m.liveId === s.id)
    if (!row) { row = { path: s.state?.sessionFile || 'open:' + s.id, id: s.state?.sessionId || s.id, cwd: s.cwd, createdAt: new Date(s.openedAt).toISOString(), mtime: s.openedAt, liveId: s.id }; result.push(row) }
    const first = s.items.find(item => item.kind === 'user')
    row.name = s.state?.sessionName || row.name
    row.title = first?.kind === 'user' ? first.text.slice(0, 120) : row.title
  }
  return result.sort((a, b) => b.mtime - a.mtime)
}
