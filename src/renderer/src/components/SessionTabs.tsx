import { setActive, useStore } from '../store'
import { useT } from '../preferences'
import { usePathFormatter } from '../homePath'

// 已打开会话的标签栏：切换不丢输出，可关闭
interface Props {
  onActivate?: (id: string) => void
}

export function SessionTabs({ onActivate }: Props) {
  const t = useT(), formatPath = usePathFormatter()
  const { sessions, activeId } = useStore()
  const ids = Object.keys(sessions)
  if (ids.length === 0) return null

  return (
    <div className="session-tabs">
      {ids.map((id) => {
        const s = sessions[id]
        const label = formatPath(s.cwd).split(/[/\\]/).filter(Boolean).slice(-2).join('/') || s.cwd
        return (
          <div
            key={id}
            data-session-id={id}
            className={`session-tab ${activeId === id ? 'active' : ''}`}
            title={formatPath(s.cwd)}
            onClick={() => {
              setActive(id)
              onActivate?.(id)
            }}
          >
            <span className={`state-dot ${s.streaming ? 'running' : ''}`} />
            <span className="session-tab-label">{label}</span>
            <button
              className="session-tab-close"
              onClick={(e) => {
                e.stopPropagation()
                if (!s.pendingQueue.items.length || window.confirm(t('关闭会话将丢弃 {count} 条待执行消息，确定关闭？', { count: s.pendingQueue.items.length }))) void window.spi.closeSession(id)
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
