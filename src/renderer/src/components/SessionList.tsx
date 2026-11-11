import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionMeta } from '../../../shared/types'
import { openSession, setActive, useStore } from '../store'
import { sessionRows } from '../sessionRows'
import { usePathFormatter } from '../homePath'
import { Icon, IconControl } from './IconControl'
import { useT } from '../preferences'
import { useSessionActions } from './SessionActions'

interface Props {
  dir: string | null
  onOpen: (m: SessionMeta) => void
}

export function SessionList({ dir, onOpen }: Props) {
  const t = useT(), formatPath = usePathFormatter()
  const { sessions, activeId, catalogRevision } = useStore()
  const actions = useSessionActions()
  const openKey = Object.values(sessions).filter(s => s.cwd === dir).map(s => s.id + ':' + s.state?.sessionFile + ':' + s.state?.sessionName + ':' + s.items.some(x => x.kind === 'user')).join(',')
  const [meta, setMeta] = useState<SessionMeta[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++generation.current
    if (!dir) {
      setMeta([])
      return
    }
    try {
      const rows = await window.spi.scanSessions(dir)
      if (ticket !== generation.current) return
      setMeta(rows)
      setError(null)
    } catch (e) {
      if (ticket === generation.current) setError(String(e))
    }
  }, [dir])

  useEffect(() => {
    void refresh()
    return () => { generation.current++ }
  }, [refresh, openKey, catalogRevision])

  async function newSession(): Promise<void> {
    if (!dir || creating) return
    setCreating(true)
    setError(null)
    try {
      await openSession(dir)
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  if (!dir) return <div className="session-list"><div className="placeholder">{t('选择一个目录')}</div></div>

  return (
    <div className="session-list">
      <div className="session-list-header">
        <span className="session-list-title" title={formatPath(dir)}>{formatPath(dir)}</span>
        <IconControl tooltip={creating ? t('正在新建会话…') : t('新建会话 · {dir}', { dir: formatPath(dir) })}>
          <button type="button" className="btn-new sidebar-icon-button" aria-label={t('新建会话')} aria-busy={creating} disabled={creating} onClick={newSession}>
            <Icon name={creating ? 'loading' : 'plus'} />
          </button>
        </IconControl>
      </div>
      {error && <div className="session-error">{error}</div>}
      {sessionRows(meta, sessions, dir).length === 0 && <div className="placeholder">{t('该目录没有 pi 会话')}</div>}
      {sessionRows(meta, sessions, dir).map((m) => (
        <div key={m.path} className={`session-item${m.liveId === activeId ? ' active' : ''}`} aria-current={m.liveId === activeId ? 'true' : undefined} data-session-path={m.path} onContextMenu={event => actions.menu(event, { sessionId: m.liveId, path: m.path, cwd: m.cwd, label: m.name || m.title || '' })} title={formatPath(m.path)} tabIndex={0} onClick={() => m.liveId ? setActive(m.liveId) : onOpen(m)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (m.liveId) setActive(m.liveId); else onOpen(m) } }}>
          <div className="session-item-title" onDoubleClick={event => { event.stopPropagation(); actions.rename({ sessionId: m.liveId, path: m.path, cwd: m.cwd, label: m.name || m.title || '' }) }}>{m.name || m.title || t('(无标题)')}</div>
          <div className="session-item-meta">{new Date(m.mtime).toLocaleString(document.documentElement.lang)}</div>
        </div>
      ))}
    </div>
  )
}
