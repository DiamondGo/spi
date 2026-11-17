import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppUpdateState } from '../../../shared/types'
import { useT } from '../preferences'
import { useRemoteWindow } from '../remote'
import { Icon, IconControl } from './IconControl'

function useAppUpdate(enabled = true) {
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    let alive = true, received = false
    const off = window.spi.onAppUpdateChanged(value => { received = true; if (alive) { setState(value); setError('') } })
    void window.spi.getAppUpdate().then(value => { if (alive && !received) setState(value) }).catch(e => { if (alive) setError(String(e)) })
    return () => { alive = false; off() }
  }, [enabled])
  async function action(kind: 'check' | 'install' | 'restart') {
    setError('')
    try {
      if (kind === 'restart') await window.spi.restartForUpdate()
      else setState(await (kind === 'check' ? window.spi.checkAppUpdate() : window.spi.installAppUpdate()))
    } catch (e) { setError(String(e)) }
  }
  return { state, error, action }
}

/** Application update operations are deliberately unavailable in remote-control windows. */
export function AppUpdateDetails(): React.JSX.Element {
  const t = useT()
  const remote = useRemoteWindow()
  const { state, error, action } = useAppUpdate(!remote)
  if (remote) return <p className="settings-help">{t('请在本机主窗口管理 sPi 更新。')}</p>
  const busy = state?.phase === 'checking' || state?.phase === 'installing'
  return <section className="app-update-details" aria-labelledby="app-update-title" data-update-phase={state?.phase || 'loading'}>
    <h3 id="app-update-title">{t('sPi 更新')}</h3>
    {state && <>
      <p>{t('当前版本：{version} · {target}', { version: state.currentVersion, target: state.target })}</p>
      <p role="status">{state.phase === 'ready' ? t('新版本 {version} 已安装，重启后生效。', { version: state.version! })
        : state.phase === 'installing' ? t('正在下载、校验并安装…')
        : state.phase === 'checking' ? t('正在检查 GitHub Releases…')
        : state.available ? t('发现新版本 {version}', { version: state.version! })
        : state.phase === 'current' ? t('当前已是最新稳定版。') : t('检查 GitHub 上的稳定版本。')}</p>
      {state.available && !state.supported && <p className="settings-error">{t('新版本暂未提供当前平台的安装包。')}</p>}
      {state.phase === 'installing' && <>
        <progress aria-label={t('更新进度')} max={100} value={state.percent || 0} />
        <p className="settings-help update-progress">{state.progress || t('正在准备安装…')}</p>
      </>}
      {state.size && state.phase !== 'ready' ? <p className="settings-help">{t('下载大小：{size} MiB', { size: (state.size / 1048576).toFixed(1) })}</p> : null}
      <p className="settings-help">{t('直接从 GitHub 下载当前系统与架构的安装包，校验后安装，不使用 npm。安装期间可继续使用；重启前会询问确认。')}</p>
      <p className="settings-help update-location">{t('安装目录：{path}', { path: state.installRoot })}</p>
      {state.commandPath && <p className="settings-help update-location">{t('启动命令：{path}', { path: state.commandPath })}</p>}
      <p className="settings-help">{t('手动解压的旧副本不会被覆盖。更新后请用新安装目录中的程序或上方的启动命令。')}</p>
      {state.target.startsWith('darwin-') && <p className="settings-help">{t('macOS 包仅有 ad-hoc 签名，未公证；请勿关闭系统安全保护。')}</p>}
    </>}
    {(error || state?.error) && <p className="settings-error" role="alert">{error || state?.error}</p>}
    <div className="app-update-actions">
      <button type="button" data-update-action="check" disabled={busy || state?.phase === 'ready'} onClick={() => void action('check')}>{t('检查更新')}</button>
      {state?.available && state.supported && state.phase !== 'ready' && <button type="button" data-update-action="install" disabled={busy} onClick={() => void action('install')}>{t(state.phase === 'error' ? '重试安装' : '下载并安装')}</button>}
      {state?.phase === 'ready' && <button type="button" data-update-action="restart" onClick={() => void action('restart')}>{t('重启生效')}</button>}
    </div>
  </section>
}

function UpdateDialog({ close }: { close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const t = useT()
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return createPortal(<dialog ref={ref} className="app-settings-dialog" aria-label={t('sPi 更新')} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="app-settings-content">
      <div className="update-dialog-close"><button type="button" className="settings-close" aria-label={t('关闭提示')} onClick={close}><Icon name="close" /></button></div>
      <AppUpdateDetails />
    </div>
  </dialog>, document.body)
}

export function AppUpdateNotice(): React.JSX.Element | null {
  const t = useT()
  const remote = useRemoteWindow()
  const { state } = useAppUpdate(!remote)
  const [open, setOpen] = useState(false)
  if (remote || !state?.available) return null
  const label = state.phase === 'ready' ? t('更新已安装，重启生效') : t('发现新版本 {version}', { version: state.version! })
  return <>
    <IconControl tooltip={label}><button type="button" className="tb-btn app-update-notice" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>!</button></IconControl>
    {open && <UpdateDialog close={() => setOpen(false)} />}
  </>
}
