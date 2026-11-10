import { useCallback, useEffect, useState } from 'react'
import type { SessionMeta } from '../../../shared/types'
import { openSession } from '../store'
import { Icon, IconControl } from './IconControl'
import { useT } from '../preferences'

interface Props {
  dir: string | null
  onOpen: (m: SessionMeta) => void
}

export function SessionList({ dir, onOpen }: Props) {
  const t = useT()
  const [meta, setMeta] = useState<SessionMeta[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    if (!dir) {
      setMeta([])
      return
    }
    try {
      setMeta(await window.spi.scanSessions(dir))
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [dir])

  useEffect(() => {
    refresh()
  }, [refresh])

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
        <span className="session-list-title" title={dir}>{dir}</span>
        <IconControl tooltip={creating ? t('正在新建会话…') : t('新建会话 · {dir}', { dir })}>
          <button type="button" className="btn-new sidebar-icon-button" aria-label={t('新建会话')} aria-busy={creating} disabled={creating} onClick={newSession}>
            <Icon name={creating ? 'loading' : 'plus'} />
          </button>
        </IconControl>
      </div>
      {error && <div className="session-error">{error}</div>}
      {meta.length === 0 && <div className="placeholder">{t('该目录没有 pi 会话')}</div>}
      {meta.map((m) => (
        <div key={m.path} className="session-item" data-session-path={m.path} title={m.path} onClick={() => onOpen(m)}>
          <div className="session-item-title">{m.name || m.title || t('(无标题)')}</div>
          <div className="session-item-meta">{new Date(m.mtime).toLocaleString(document.documentElement.lang)}</div>
        </div>
      ))}
    </div>
  )
}
