import { useMemo, useState } from 'react'
import { setPermissionSettingsOpen, useStore } from '../store'
import { changePermissionMode, permissionLabels, usePermissionSnapshot } from '../permissions'
import { useSessionSettings } from '../sessionSettings'
import { usePreferences, useT } from '../preferences'
import type { PermissionMode } from '../../../shared/types'
import { TitleSelect } from './TitleSelect'
import { Icon, IconControl } from './IconControl'
import { AppSettingsPanel } from './AppSettingsPanel'

export function TitleBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }): React.JSX.Element {
  const t = useT()
  const { settings: appSettings } = usePreferences()
  const { sessions, activeId } = useStore()
  const { state: permissions, error: permissionError } = usePermissionSnapshot()
  const active = activeId ? sessions[activeId] : null
  const settings = useSessionSettings(active)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [permissionBusy, setPermissionBusy] = useState(false)
  const [permissionChangeError, setPermissionChangeError] = useState('')
  const isMac = navigator.userAgent.includes('Mac')
  const firstUser = active?.items.find(item => item.kind === 'user')
  const name = useMemo(() => {
    const named = active?.state?.sessionName?.trim()
    if (named) return named
    const text = firstUser?.kind === 'user' ? firstUser.text.replace(/\s+/g, ' ').trim() : ''
    const chars = Array.from(text)
    if (chars.length) return chars.slice(0, 80).join('') + (chars.length > 80 ? '…' : '')
    return active ? t('新会话 · {dir}', { dir: active.cwd.split(/[/\\]/).filter(Boolean).pop() || active.cwd }) : ''
  }, [active?.state?.sessionName, active?.cwd, firstUser, appSettings.language])
  const model = settings.model
  const policy = activeId ? permissions?.sessions[activeId] : null
  const permission = permissionError ? t('读取失败') : policy?.ready ? t(permissionLabels[policy.mode]) : t('加载中…')
  const thinking = active?.state?.thinkingLevel
  const thinkingText = thinking === 'off' ? t('关闭（off）') : thinking || t('未提供')
  const waiting = activeId && permissions?.pending.some(request => request.sessionId === activeId)
  const error = settings.error || permissionChangeError
  async function setPermission(mode: PermissionMode): Promise<void> {
    if (!activeId) return
    setPermissionBusy(true)
    setPermissionChangeError('')
    try { await changePermissionMode(activeId, mode) } catch (e) { setPermissionChangeError(String(e)) } finally { setPermissionBusy(false) }
  }

  return (
    <header className={`titlebar${isMac ? ' mac' : ''}`} data-session-id={activeId ?? ''}>
      <IconControl tooltip={t(sidebarOpen ? '收起侧栏' : '展开侧栏')}>
        <button type="button" className="tb-btn tb-icon-button sidebar-toggle" aria-label={t(sidebarOpen ? '收起侧栏' : '展开侧栏')} aria-expanded={sidebarOpen} onClick={onToggleSidebar}><Icon name="sidebar" /></button>
      </IconControl>
      <span className="tb-brand">sPi</span>
      <div className="tb-center">
        {active ? <span className="tb-name" title={t('会话：{name}\n工作目录：{cwd}', { name, cwd: active.cwd })}>{name}</span> : <span className="tb-name dim">{t('未打开会话')}</span>}
      </div>
      {active && <div className="tb-details">
        <TitleSelect label={t('模型')} text={t('模型：{name}', { name: model?.name || model?.id || t('未选择') })} detail={model ? `${model.name} · ${model.provider}/${model.id}` : undefined} className="tb-model" value={model ? `${model.provider}/${model.id}` : ''} disabled={settings.busy || !settings.models.length} onChange={e => void settings.changeModel(e.target.value)}>
          {!settings.models.length && <option value={model ? `${model.provider}/${model.id}` : ''}>{model?.name || t('加载中…')}</option>}
          {settings.models.map(m => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.name} · {m.provider}</option>)}
        </TitleSelect>
        <TitleSelect label={t('许可')} text={t('许可：{mode}', { mode: permission })} detail={permissionError || t('当前会话：{permission}', { permission })} className="tb-permission" value={policy?.mode ?? 'ask'} disabled={!policy?.ready || permissionBusy} warning={policy?.mode === 'all'} onChange={e => {
          if (e.target.value === '__settings') setPermissionSettingsOpen(active.id, true)
          else void setPermission(e.target.value as PermissionMode)
        }}>
          {Object.entries(permissionLabels).map(([value, text]) => <option key={value} value={value}>{t(text)}</option>)}
          <option value="__settings">{t('权限设置 / 白名单')}</option>
        </TitleSelect>
        <TitleSelect label={t('思考')} text={t('思考：{level}', { level: thinkingText })} className="tb-thinking" value={settings.level} disabled={settings.busy || !settings.levels.length || !(model?.reasoning || settings.levels.some(level => level !== 'off'))} onChange={e => void settings.changeLevel(e.target.value)}>
          {!settings.levels.length && <option value={settings.level}>{settings.level}</option>}
          {settings.levels.map(level => <option key={level} value={level}>{level === 'off' ? t('关闭（off）') : level}</option>)}
        </TitleSelect>
        <span className={`tb-field tb-status${waiting ? ' waiting' : active.streaming ? ' running' : ''}`} title={error || undefined}>{t(error ? '设置失败' : waiting ? '等待审批' : active.streaming ? '运行中' : '空闲')}</span>
      </div>}
      {active && <button className="tb-btn tb-close-session" title={t('关闭当前会话')} onClick={() => window.spi.closeSession(active.id)}>{t('关闭')}</button>}
      <IconControl tooltip={t('设置')}>
        <button type="button" className="tb-btn tb-icon-button app-settings-button" aria-label={t('设置')} aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}><Icon name="settings" /></button>
      </IconControl>
      {settingsOpen && <AppSettingsPanel onClose={() => setSettingsOpen(false)} />}
    </header>
  )
}
