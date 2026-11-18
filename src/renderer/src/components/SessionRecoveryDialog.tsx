import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { recoverSession } from '../store'
import { useT } from '../preferences'
import { remoteErrorText, useRemoteReadOnly } from '../remote'

/** Keep destructive recovery confirmation visible inside its owning window. */
export function SessionRecoveryDialog({ sessionId, disabled, onClose }: { sessionId: string; disabled: boolean; onClose(): void }): React.JSX.Element {
  const t = useT(), readOnly = useRemoteReadOnly(), heading = useId()
  const ref = useRef<HTMLDialogElement>(null), alive = useRef(true), locked = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    alive.current = true
    ref.current?.showModal()
    return () => { alive.current = false }
  }, [])
  async function confirm(): Promise<void> {
    if (disabled || readOnly || locked.current) return
    locked.current = true; setBusy(true); setError('')
    try { await recoverSession(sessionId); if (alive.current) onClose() }
    catch (failure) { if (alive.current) setError(remoteErrorText(failure)) }
    finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  return createPortal(<dialog ref={ref} className="session-action-dialog session-recovery-dialog" aria-labelledby={heading} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={event => { event.preventDefault(); void confirm() }}>
      <h2 id={heading}>{t('恢复会话')}</h2>
      <p>{t('恢复将终止当前 Pi 进程并重新加载已保存的会话。草稿和待发送消息会保留，队列保持暂停，不会自动重发。外部工具可能仍在运行，请先检查。继续？')}</p>
      {error && <div className="session-error" role="alert">{error}</div>}
      <div className="session-action-buttons">
        <button type="button" autoFocus disabled={busy} onClick={onClose}>{t('取消')}</button>
        <button type="submit" className="danger" disabled={busy || disabled || readOnly}>{t(busy ? '正在恢复会话…' : '确定恢复')}</button>
      </div>
    </form>
  </dialog>, document.body)
}
