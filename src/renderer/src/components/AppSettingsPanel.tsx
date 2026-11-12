import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppLanguage, AppSettings, AppTheme } from '../../../shared/types'
import { updatePreferences, usePreferences, useT } from '../preferences'
import { Icon, IconControl } from './IconControl'
import { NodeSettings } from './NodeSettings'
import { RemoteSettings } from './RemoteSettings'

export function AppSettingsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { settings, error } = usePreferences()
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { dialog?.close() }
  }, [])
  async function save(patch: Partial<AppSettings>): Promise<void> {
    setBusy(true)
    try { await updatePreferences(patch) } catch { /* visible in preference error state */ }
    finally { setBusy(false) }
  }
  return createPortal(
    <dialog ref={ref} className="app-settings-dialog" aria-labelledby="app-settings-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="app-settings-content">
        <header className="app-settings-header">
          <h2 id="app-settings-title">{t('设置')}</h2>
          <IconControl tooltip={t('关闭设置')}><button type="button" className="settings-close" aria-label={t('关闭设置')} onClick={onClose}><Icon name="close" /></button></IconControl>
        </header>
        <label className="app-settings-row">
          <span>{t('主题')}</span>
          <select data-setting="theme" aria-label={t('主题')} value={settings.theme} disabled={busy} onChange={event => void save({ theme: event.target.value as AppTheme })}>
            <option value="dark">{t('深色')}</option>
            <option value="light">{t('浅色')}</option>
            <option value="high-contrast">{t('高对比度')}</option>
          </select>
        </label>
        <label className="app-settings-row">
          <span>{t('语言')}</span>
          <select data-setting="language" aria-label={t('语言')} value={settings.language} disabled={busy} onChange={event => void save({ language: event.target.value as AppLanguage })}>
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </label>
        <label className="app-settings-row settings-checkbox-row">
          <span>{t('退出前确认')}</span>
          <input type="checkbox" data-setting="confirmOnExit" aria-label={t('退出前确认')} checked={settings.confirmOnExit} disabled={busy} onChange={event => void save({ confirmOnExit: event.target.checked })} />
        </label>
        <p className="settings-help">{t('退出时询问是否确认；退出会中止当前打开的会话。')}</p>
        <p className="settings-help">{busy ? t('保存中…') : t('设置会自动保存，只影响 sPi，不修改 pi 配置。')}</p>
        {error && <p role="alert" className="settings-error">{error}</p>}
        <NodeSettings />
        <RemoteSettings />
      </div>
    </dialog>, document.body
  )
}
