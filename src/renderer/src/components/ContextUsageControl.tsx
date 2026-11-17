import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContextUsage } from '../../../shared/types'
import { MAX_COMPACTION_INSTRUCTION_LENGTH } from '../../../shared/contextUsage'
import type { SessionUI } from '../store'
import { useT } from '../preferences'
import { onRemoteResync, remoteErrorText, useRemoteReadOnly, useRemoteWindow } from '../remote'
import { ContextMenu, menuPosition, type MenuPosition } from './ContextMenu'

export function ContextUsageControl({ session }: { session: SessionUI }): React.JSX.Element {
  const t = useT(), readOnly = useRemoteReadOnly(), remote = useRemoteWindow()
  const [usage, setUsage] = useState<ContextUsage | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [menu, setMenu] = useState<MenuPosition | null>(null), [dialog, setDialog] = useState(false)
  const alive = useRef(true), locked = useRef(false)
  const closeMenu = useCallback(() => setMenu(null), [])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let disposed = false, inFlight = false, dirty = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setUsage(null)
    const available = !session.health || session.health.status === 'healthy'
    const refresh = async (): Promise<void> => {
      if (disposed || !available) return
      if (inFlight) { dirty = true; return }
      inFlight = true; dirty = false
      try { const next = await window.spi.getContextUsage(session.id); if (!disposed) setUsage(next) }
      catch { if (!disposed) setUsage(null) }
      finally { inFlight = false; if (dirty && !disposed) schedule() }
    }
    const schedule = (): void => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 150) }
    const off = window.spi.onPiEvent(({ sessionId, event }) => {
      if (sessionId === session.id && ['message_end', 'agent_settled', 'compaction_end', 'spi_session_compacted', 'model_changed', 'thinking_level_changed', 'spi_session_health'].includes(event.type)) schedule()
    })
    const offResync = onRemoteResync(schedule)
    void refresh()
    return () => { disposed = true; clearTimeout(timer); off(); offResync() }
  }, [session.id, session.state?.model?.id, session.state?.model?.provider, session.state?.thinkingLevel, session.health?.status])

  const waitingForDialog = session.items.some(item => item.kind === 'dialog' && !item.answered)
  const unavailable = waitingForDialog || readOnly || (remote !== null && remote.state !== 'connected') || session.streaming || !!session.state?.isStreaming || !!session.state?.isCompacting || !!session.submitting || !!session.pendingQueue.items.length || (!!session.health && session.health.status !== 'healthy')
  const disabled = unavailable || busy
  const max = usage?.contextWindow ?? session.state?.model?.contextWindow
  const used = usage?.tokens
  const percent = usage?.percent
  const label = percent === null || percent === undefined ? '—%' : `${Math.round(percent * 10) / 10}%`
  const title = t('Context 用量：{used} / {max} tokens（估算）', {
    used: typeof used === 'number' ? used.toLocaleString() : t('未知'),
    max: typeof max === 'number' && Number.isFinite(max) && max > 0 ? max.toLocaleString() : t('未知')
  }) + '\n' + t('左键：压缩上下文；右键：输入压缩指令。压缩可能产生模型请求。')
    + (used === null || usage === null ? '\n' + t('Pi 尚未提供用量；压缩后可能需要等待下一次模型回复。') : '')
    + (readOnly ? '\n' + t('只读端不能压缩上下文。') : unavailable ? '\n' + t('请等待会话空闲、待执行消息处理完成后再压缩。') : '')
  async function compact(instructions?: string): Promise<void> {
    if (disabled || locked.current) return
    locked.current = true; setBusy(true); setError('')
    try { await window.spi.compactSession(session.id, instructions) }
    catch (e) { if (alive.current) setError(remoteErrorText(e)) }
    finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  return <>
    <span className="tb-context-wrap" title={title}>
      <button type="button" className={`tb-context${busy || session.state?.isCompacting ? ' compacting' : ''}`} data-control="context" data-context-percent={percent ?? ''} aria-label={title} aria-busy={busy || !!session.state?.isCompacting} disabled={disabled} onClick={() => void compact()} onContextMenu={event => {
        event.preventDefault()
        if (!disabled) setMenu(menuPosition(event))
      }}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle className="context-track" cx="12" cy="12" r="9" />
          <circle className="context-fill" cx="12" cy="12" r="9" pathLength="100" strokeDasharray={typeof percent === 'number' ? `${Math.max(0, Math.min(100, percent))} 100` : '3 5'} transform="rotate(-90 12 12)" />
        </svg>
        <span>{busy || session.state?.isCompacting ? '…' : label}</span>
      </button>
      {error && <span className="context-error" role="alert">{error}<button type="button" aria-label={t('关闭提示')} onClick={() => setError('')}>×</button></span>}
    </span>
    {menu && <ContextMenu position={menu} onClose={closeMenu} items={[{ label: t('输入压缩指令…'), disabled, action: () => setDialog(true) }]} />}
    {dialog && <CompactionDialog disabled={disabled} onClose={() => setDialog(false)} onConfirm={instructions => { setDialog(false); void compact(instructions) }} />}
  </>
}

function CompactionDialog({ disabled, onClose, onConfirm }: { disabled: boolean; onClose(): void; onConfirm(instructions: string): void }): React.JSX.Element {
  const t = useT(), ref = useRef<HTMLDialogElement>(null)
  const [instructions, setInstructions] = useState('')
  useEffect(() => { ref.current?.showModal() }, [])
  return createPortal(<dialog ref={ref} className="session-action-dialog compaction-dialog" aria-labelledby="compaction-heading" onCancel={event => { event.preventDefault(); onClose() }}>
    <form onSubmit={event => { event.preventDefault(); if (!disabled) onConfirm(instructions) }}>
      <h2 id="compaction-heading">{t('压缩上下文')}</h2>
      <label htmlFor="compaction-instructions">{t('压缩指令（可选）')}</label>
      <textarea id="compaction-instructions" autoFocus rows={5} maxLength={MAX_COMPACTION_INSTRUCTION_LENGTH} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder={t('例如：保留当前任务、关键决策和未完成事项。')} />
      <p>{t('确认后执行 /compact [instruction]。留空则使用默认压缩；可能产生模型请求。不会发送为普通聊天消息。')}</p>
      <div className="session-action-buttons"><button type="button" onClick={onClose}>{t('取消')}</button><button type="submit" disabled={disabled}>{t('确定压缩')}</button></div>
    </form>
  </dialog>, document.body)
}
