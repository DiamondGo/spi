import { useState, type ReactNode } from 'react'
import { restoreQueuedMessages, setPermissionSettingsOpen, useStore, type SessionUI } from '../store'
import type { PermissionDecision, SafePermissionMode } from '../../../shared/types'
import { Icon, IconControl } from './IconControl'
import { permissionLabels, usePermissionSnapshot } from '../permissions'
import { useT } from '../preferences'

export function usePermissionControls(active: SessionUI): { panels: ReactNode } {
  const t = useT()
  const labels = Object.fromEntries(Object.entries(permissionLabels).map(([key, text]) => [key, t(text)]))
  const { sessions } = useStore()
  const activeId = active.id
  const { state, error: loadError } = usePermissionSnapshot()
  const [error, setError] = useState('')
  const [view, setView] = useState({ sessionId: activeId, command: '' })
  const settings = active.permissionSettingsOpen ?? false
  const command = view.sessionId === activeId ? view.command : ''
  const setCommand = (text: string) => setView({ sessionId: activeId, command: text })
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError('')
    try { await fn() } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  function answer(sessionId: string, id: string, decision: PermissionDecision): void {
    if (decision === 'all' && !window.confirm(t('允许该会话的本次及后续全部工具调用？这不会影响其他会话，也不会修改 pi 配置。'))) return
    void run(() => window.spi.answerPermission(sessionId, id, decision))
  }
  const panels = (error || loadError || settings || state?.pending.length) ? (
    <section className="permissions" aria-label={t('sPi 执行权限详情')}>
      {(error || loadError) && <div role="alert" className="permission-error">{error || loadError}</div>}
      {settings && state && <div className="permission-settings">
        <div className="permission-panel-header"><strong>{t('权限设置 / 白名单')}</strong>
          <IconControl tooltip={t('关闭权限设置')}><button type="button" className="permission-panel-close" aria-label={t('关闭权限设置')} onClick={() => setPermissionSettingsOpen(activeId, false)}><Icon name="close" /></button></IconControl>
        </div>
        <p>{t('仅保存到 sPi 配置目录；不修改 ~/.pi 或项目的 pi 配置。所有工具（包括读取、写入、命令和嵌套调用）均需通过审批。已有 pi 扩展仍可能另外要求批准。')}</p>
        <label>{t('新建 / 重开会话的默认模式：')}
          <select title={t('默认执行权限')} value={state.defaultMode} disabled={busy} onChange={e => void run(() => window.spi.setDefaultPermissionMode(e.target.value as SafePermissionMode))}>
            {(['ask', 'remember', 'allowlist'] as const).map(mode => <option key={mode} value={mode}>{labels[mode]}</option>)}
          </select>
        </label>
        <p>{t('“单次允许”不会记忆；选择“本会话记住”才会放行后续相同调用。“每次询问”忽略所有已记忆项和白名单。全部允许仅本次打开有效。')}</p>
        <button disabled={busy} onClick={() => void run(() => window.spi.clearSessionPermissions(activeId))}>{t('清空当前会话记忆')}</button>
        <h4>{t('sPi 白名单（精确匹配，不支持前缀 / 通配符）')}</h4>
        <p>{t('规则限定工作目录和完整命令；其他工具限定完整参数。白名单仅在“白名单”模式生效。规则不会授权相似命令或其他目录。')}</p>
        <form onSubmit={e => { e.preventDefault(); void run(async () => { await window.spi.addPermissionRule(active.cwd, command); setCommand('') }) }}>
          <div className="permission-hint">{t('当前目录：{cwd}', { cwd: active.cwd })}</div>
          <textarea className="permission-command" aria-label={t('白名单完整命令')} placeholder={t('输入要放行的完整 bash 命令，例如 git status')} value={command} onChange={e => setCommand(e.target.value)} />
          <button disabled={busy || !command.trim()} type="submit">{t('添加当前目录规则')}</button>
        </form>
        <div className="permission-rule-list">
          {!state.rules.length && <p className="permission-hint">{t('白名单为空。')}</p>}
          {state.rules.map(rule => <div key={rule.id} className="permission-rule">
            <strong>{rule.tool}</strong> <span className="permission-hint">{rule.cwd}</span>
            <pre>{JSON.stringify(rule.input, null, 2)}</pre>
            <button disabled={busy} onClick={() => void run(() => window.spi.removePermissionRule(rule.id))}>{t('删除规则')}</button>
          </div>)}
        </div>
        <p className="permission-warning">{t('这是一道工具审批，不是操作系统沙箱；已允许的命令和可信扩展仍拥有当前用户权限。请勿放行可执行任意代码的工具或命令后，再依赖逐项审批限制其内部行为。')}</p>
      </div>}
      {!!state?.pending.length && <div className="permission-requests" aria-live="polite">
        {state.pending.map(req => <div className="permission-request" key={req.sessionId + req.id} data-request-id={req.id} data-session-id={req.sessionId}>
          <strong>{t('等待批准 · {tool}', { tool: req.tool })} {req.sessionId !== activeId ? t('（后台会话）') : ''}</strong>
          <span className="permission-hint">{t(' · 10 分钟未处理将拒绝')}</span>
          <div className="permission-hint">{t('会话：{name} · 工作目录：{cwd}', { name: sessions[req.sessionId]?.state?.sessionName || req.sessionId.slice(0, 8), cwd: req.cwd })}</div>
          <pre>{JSON.stringify(req.input, null, 2)}</pre>
          <div className="permission-actions">
            <button disabled={busy} onClick={() => answer(req.sessionId, req.id, 'deny')}>{t('拒绝')}</button>
            <button disabled={busy} onClick={() => answer(req.sessionId, req.id, 'once')}>{t('单次允许')}</button>
            <button disabled={busy} onClick={() => answer(req.sessionId, req.id, 'session')}>{t('本会话记住此调用')}</button>
            <button disabled={busy} onClick={() => answer(req.sessionId, req.id, 'whitelist')}>{t('加入 sPi 白名单并允许')}</button>
            <button className="permission-warning" disabled={busy} onClick={() => answer(req.sessionId, req.id, 'all')}>{t('本会话全部允许…')}</button>
            <button disabled={busy} onClick={() => void run(async () => { const queue = await window.spi.abortSession(req.sessionId); restoreQueuedMessages(req.sessionId, [...queue.steering, ...queue.followUp]) })}>{t('停止该会话')}</button>
          </div>
        </div>)}
      </div>}
    </section>
  ) : null
  return { panels }
}
