import { useCallback, useEffect, useState } from 'react'
import type { SessionMeta } from '../../../shared/types'
import { Icon, IconControl } from './IconControl'
import { useT } from '../preferences'

interface Props {
  onOpen: (m: SessionMeta) => void
}

export function RecentSessions({ onOpen }: Props) {
  const t = useT()
  const [recent, setRecent] = useState<SessionMeta[]>([])
  const [pinned, setPinned] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([window.spi.scanRecent(50), window.spi.getPinned()])
      setRecent(r)
      setPinned(p)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function togglePin(m: SessionMeta): Promise<void> {
    const next = await window.spi.togglePin(m.path)
    setPinned(next)
  }

  // pin 的放顶部（保持 recent 的时间顺序），其余按时间
  const pinnedMetas = recent.filter((m) => pinned.includes(m.path))
  const others = recent.filter((m) => !pinned.includes(m.path))

  function renderItem(m: SessionMeta): React.ReactNode {
    const isPinned = pinned.includes(m.path)
    return (
      <div key={m.path} className="session-item" data-session-path={m.path} title={m.cwd} onClick={() => onOpen(m)}>
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
          <div className="session-item-title">{m.name || m.title || t('(无标题)')}</div>
        </div>
        <div className="session-item-meta">
          {m.cwd} · {new Date(m.mtime).toLocaleString(document.documentElement.lang)}
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
      {recent.length === 0 && <div className="placeholder">{t('没有近期会话')}</div>}
    </div>
  )
}
