import { useState } from 'react'
import { recoverSession, setSessionError, setSessionHealthError, type SessionUI } from '../store'
import { useT } from '../preferences'

export function SessionHealthBanner({ session }: { session: SessionUI }) {
  const t = useT()
  const [checking, setChecking] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const status = session.health?.status ?? 'healthy'
  const busy = recovering || status === 'recovering'
  const warning = status !== 'healthy'
  const showHealth = warning || busy
  const notices = [...new Set([session.error, !showHealth ? session.healthError : undefined].filter((message): message is string => !!message))]
    .filter(message => !showHealth || message !== session.healthError)
  async function check(): Promise<void> {
    setChecking(true)
    try { await window.spi.checkSession(session.id) }
    catch (error) { setSessionHealthError(session.id, String(error)) }
    finally { setChecking(false) }
  }
  async function recover(): Promise<void> {
    if (!window.confirm(t('恢复将终止当前 Pi 进程并重新加载已保存的会话。草稿和待发送消息会保留，队列保持暂停，不会自动重发。外部工具可能仍在运行，请先检查。继续？'))) return
    setRecovering(true)
    try { await recoverSession(session.id) } catch {}
    finally { setRecovering(false) }
  }
  if (!showHealth && !notices.length) return null
  const label = busy ? '正在恢复会话…'
    : status === 'exited' ? 'Pi 进程已退出，可恢复原会话。'
      : 'Pi RPC 未响应，待发送队列已暂停。请检查或恢复会话。'
  return <>
    {showHealth && <div className="session-health warning" role={busy ? 'status' : 'alert'}>
      <div>{t(label)}</div>
      <div className="session-health-actions">
        <button type="button" disabled={checking || busy} onClick={() => void check()}>{t(checking ? '检查中…' : '检查连接')}</button>
        <button type="button" disabled={busy || session.submitting} onClick={() => void recover()}>{t(busy ? '正在恢复会话…' : '恢复会话')}</button>
      </div>
      {session.healthError && <div className="session-health-error">{session.healthError}</div>}
    </div>}
    {notices.length > 0 && <div className="session-error session-error-notice" role="alert">
      <div>{notices.map(message => <div key={message}>{message}</div>)}</div>
      <button type="button" aria-label={t('关闭提示')} onClick={() => { setSessionError(session.id, undefined); if (!showHealth) setSessionHealthError(session.id, undefined) }}>{t('关闭提示')}</button>
    </div>}
  </>
}
