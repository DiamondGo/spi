import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { useYoloSnapshot } from '../yolo'
import { useSessionSettings } from '../sessionSettings'
import { usePreferences, useT } from '../preferences'
import { TitleSelect } from './TitleSelect'
import { Icon, IconControl } from './IconControl'
import { AppSettingsPanel } from './AppSettingsPanel'

export function TitleBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }): React.JSX.Element {
  const t = useT()
  const { settings: appSettings } = usePreferences()
  const { sessions, activeId } = useStore()
  const { state: yolo, error: yoloError } = useYoloSnapshot()
  const active = activeId ? sessions[activeId] : null
  const settings = useSessionSettings(active)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [yoloBusy, setYoloBusy] = useState(false)
  const [yoloChangeError, setYoloChangeError] = useState('')
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
  const policy = activeId ? yolo?.sessions[activeId] : null
  const thinking = active?.state?.thinkingLevel
  const thinkingText = thinking === 'off' ? t('关闭（off）') : thinking || t('未提供')
  const waiting = active?.items.some(item => item.kind === 'dialog' && !item.answered)
  const error = settings.error || yoloChangeError || yoloError
  async function setYolo(enabled: boolean): Promise<void> {
    if (!activeId) return
    setYoloBusy(true)
    setYoloChangeError('')
    try { await window.spi.setYolo(activeId, enabled) } catch (e) { setYoloChangeError(String(e)) } finally { setYoloBusy(false) }
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
        <label className={`tb-yolo${policy?.enabled ? ' enabled' : ''}`} title={yoloError || t(policy?.enabled ? 'YOLO 开启：自动单次 Allow 兼容的 Pi 工具审批；其他确认和直接拒绝仍有效。' : 'YOLO 关闭：不自动代答，遵循 Pi 当前会话设置；不额外增加 sPi 审批。')}>
          <input type="checkbox" role="switch" aria-label="YOLO" data-control="yolo" checked={policy?.enabled ?? false} disabled={!policy?.ready || yoloBusy || !!yoloError} onChange={e => void setYolo(e.target.checked)} />
          <span>YOLO</span>
        </label>
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
