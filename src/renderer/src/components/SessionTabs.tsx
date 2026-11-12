import { setActive, setSessionError, useStore } from '../store'
import { useT } from '../preferences'
import { usePathFormatter } from '../homePath'
import { useSessionActions } from './SessionActions'

// 已打开会话的标签栏：切换不丢输出，可关闭
interface Props {
  onActivate?: (id: string) => void
}

export function SessionTabs({ onActivate }: Props) {
  const t = useT(), formatPath = usePathFormatter()
  const { sessions, activeId } = useStore()
  const actions = useSessionActions()
  const ids = Object.keys(sessions)
  if (ids.length === 0) return null

  return (
    <div className="session-tabs">
      {ids.map((id) => {
        const s = sessions[id]
        const label = s.state?.sessionName || formatPath(s.cwd).split(/[/\\]/).filter(Boolean).slice(-2).join('/') || s.cwd
        const target = { sessionId: id, path: s.state?.sessionFile, cwd: s.cwd, label: s.state?.sessionName || '' }
        return (
          <div
            key={id}
            data-session-id={id}
            className={`session-tab ${activeId === id ? 'active' : ''}`}
            title={s.state?.sessionName ? label + '\n' + formatPath(s.cwd) : formatPath(s.cwd)}
            onContextMenu={event => actions.menu(event, { ...target, label })}
            onClick={() => {
              setActive(id)
              onActivate?.(id)
            }}
          >
            <span className={`state-dot ${s.health && (s.health.status !== 'healthy' || s.health.stalled) ? 'warning' : s.streaming ? 'running' : ''}`} title={s.health?.stalled ? t('Pi RPC 正常，但任务已超过两分钟没有新事件。可能在等待网络或工具；不会自动重启。') : undefined} />
            <span className="session-tab-label" onDoubleClick={event => { event.stopPropagation(); actions.rename(target) }}>{label}</span>
            <button
              className="session-tab-close"
              disabled={s.health?.status === 'recovering'}
              onClick={(e) => {
                e.stopPropagation()
                if (!s.pendingQueue.items.length || window.confirm(t('关闭会话将丢弃 {count} 条待执行消息，确定关闭？', { count: s.pendingQueue.items.length }))) void window.spi.closeSession(id).catch(error => setSessionError(id, String(error)))
              }}
              title={t('关闭会话')} aria-label={t('关闭会话')}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
