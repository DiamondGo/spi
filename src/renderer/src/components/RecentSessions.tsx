import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionMeta } from '../../../shared/types'
import { Icon, IconControl } from './IconControl'
import { useT } from '../preferences'
import { setActive, useStore } from '../store'
import { sessionRows, type SessionRow } from '../sessionRows'
import { usePathFormatter } from '../homePath'
import { useSessionActions } from './SessionActions'

interface Props {
  onOpen: (m: SessionMeta) => void
}

export function RecentSessions({ onOpen }: Props) {
  const t = useT(), formatPath = usePathFormatter()
  const { sessions, activeId, catalogRevision } = useStore()
  const actions = useSessionActions()
  const openKey = Object.values(sessions).map(s => s.id + ':' + s.state?.sessionFile + ':' + s.state?.sessionName).join(',')
  const [recent, setRecent] = useState<SessionMeta[]>([])
  const [pinned, setPinned] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++generation.current
    try {
      const [r, p] = await Promise.all([window.spi.scanRecent(50), window.spi.getPinned()])
      if (ticket !== generation.current) return
      setRecent(r)
      setPinned(p)
      setError(null)
    } catch (e) {
      if (ticket === generation.current) setError(String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    return () => { generation.current++ }
  }, [refresh, openKey, catalogRevision])

  async function togglePin(m: SessionMeta): Promise<void> {
    const next = await window.spi.togglePin(m.path)
    setPinned(next)
  }

  // pin 的放顶部（保持 recent 的时间顺序），其余按时间
  const rows = sessionRows(recent, sessions)
  const pinnedMetas = rows.filter((m) => pinned.includes(m.path))
  const others = rows.filter((m) => !pinned.includes(m.path))

  function renderItem(m: SessionRow): React.ReactNode {
    const isPinned = pinned.includes(m.path)
    return (
      <div key={m.path} className={`session-item${m.liveId === activeId ? ' active' : ''}`} aria-current={m.liveId === activeId ? 'true' : undefined} data-session-path={m.path} onContextMenu={event => actions.menu(event, { sessionId: m.liveId, path: m.path, cwd: m.cwd, label: m.name || m.title || '' })} title={formatPath(m.cwd)} tabIndex={0} onClick={() => m.liveId ? setActive(m.liveId) : onOpen(m)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (m.liveId) setActive(m.liveId); else onOpen(m) } }}>
        <div className="session-item-row">
          <IconControl tooltip={t(isPinned ? '取消置顶' : '置顶会话')}>
            <button
              type="button"
              className={`pin-btn ${isPinned ? 'pinned' : ''}`}
              aria-label={t(isPinned ? '取消置顶' : '置顶会话')}
              aria-pressed={isPinned}
              onClick={(e) => {
                e.stopPropagation()
                void togglePin(m).catch(e => setError(String(e)))
              }}
            >
              <Icon name="pin" />
            </button>
          </IconControl>
          <div className="session-item-title" onDoubleClick={event => { event.stopPropagation(); actions.rename({ sessionId: m.liveId, path: m.path, cwd: m.cwd, label: m.name || m.title || '' }) }}>{m.name || m.title || t('(无标题)')}</div>
        </div>
        <div className="session-item-meta">
          {formatPath(m.cwd)} · {new Date(m.mtime).toLocaleString(document.documentElement.lang)}
        </div>
      </div>
    )
  }

  return (
    <div className="recent-list">
      {error && <div className="session-error">{error}</div>}
      {pinnedMetas.length > 0 && (
        <div className="recent-section-label" role="heading" aria-level={2} aria-label={t('置顶会话')}>
          <IconControl tooltip={t('置顶会话')}><span tabIndex={0}><Icon name="pin" /></span></IconControl>
        </div>
      )}
      {pinnedMetas.map(renderItem)}
      <div className="recent-section-label" role="heading" aria-level={2} aria-label={t('近期会话')}>
        <IconControl tooltip={t('近期会话')}><span tabIndex={0}><Icon name="history" /></span></IconControl>
      </div>
      {others.map(renderItem)}
      {rows.length === 0 && <div className="placeholder">{t('没有近期会话')}</div>}
    </div>
  )
}
