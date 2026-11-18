import { useState } from 'react'
import { checkSession, setSessionError, setSessionHealthError, type SessionUI } from '../store'
import { useT } from '../preferences'
import { useRemoteReadOnly } from '../remote'
import { SessionRecoveryDialog } from './SessionRecoveryDialog'

export function SessionHealthBanner({ session }: { session: SessionUI }) {
  const t = useT(), readOnly = useRemoteReadOnly()
  const [checking, setChecking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const status = session.health?.status ?? 'healthy'
  const busy = status === 'recovering'
  const warning = status !== 'healthy'
  const showHealth = warning || busy
  const notices = [...new Set([session.error, !showHealth ? session.healthError : undefined].filter((message): message is string => !!message))]
    .filter(message => !showHealth || message !== session.healthError)
  async function check(): Promise<void> {
    setChecking(true)
    try { await checkSession(session.id) }
    catch {}
    finally { setChecking(false) }
  }
  if (!showHealth && !notices.length && !confirming) return null
  const label = busy ? '正在恢复会话…'
    : status === 'exited' ? 'Pi 进程已退出，可恢复原会话。'
      : 'Pi RPC 未响应，待发送队列已暂停。请检查或恢复会话。'
  return <>
    {confirming && <SessionRecoveryDialog key={session.id} sessionId={session.id} disabled={busy || session.submitting} onClose={() => setConfirming(false)} />}
    {showHealth && <div className="session-health warning" role={busy ? 'status' : 'alert'}>
      <div>{t(label)}</div>
      <div className="session-health-actions">
        <button type="button" disabled={checking || busy} onClick={() => void check()}>{t(checking ? '检查中…' : '检查连接')}</button>
        <button type="button" disabled={busy || session.submitting || readOnly || confirming} onClick={() => setConfirming(true)}>{t(busy ? '正在恢复会话…' : '恢复会话')}</button>
      </div>
      {session.healthError && <div className="session-health-error">{session.healthError}</div>}
    </div>}
    {notices.length > 0 && <div className="session-error session-error-notice" role="alert">
      <div>{notices.map(message => <div key={message}>{message}</div>)}</div>
      <button type="button" aria-label={t('关闭提示')} onClick={() => { setSessionError(session.id, undefined); if (!showHealth) setSessionHealthError(session.id, undefined) }}>{t('关闭提示')}</button>
    </div>}
  </>
}
