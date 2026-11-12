import { useEffect, useState } from 'react'
import { PAIRING_TTL_MS, MAX_PAIRING_TTL_MS } from '../../../shared/pairing'
import type { RemoteAccountStatus, RemoteConnectionState, RemoteHostState } from '../../../shared/types'
import { useT } from '../preferences'
import { remoteErrorText, useRemoteStatus, useRemoteWindow } from '../remote'

const hostStateText: Record<RemoteHostState, string> = {
  off: '已关闭', starting: '正在连接中继…', online: '在线，等待设备连接', reconnecting: '正在重新连接中继…', error: '无法启动，稍后自动重试'
}
const accountText: Record<RemoteAccountStatus['state'], string> = {
  ready: 'GitHub CLI 已登录。两台电脑需要登录同一个 GitHub 账号。',
  missing: '未找到 GitHub CLI（gh）。远程访问依赖它：请安装后运行 gh auth login。',
  logged_out: 'GitHub CLI 尚未登录 github.com。请运行 gh auth login --hostname github.com。',
  failed: 'GitHub CLI 没有返回可用的登录凭据。请运行 gh auth status 检查。'
}
const connectionText: Record<RemoteConnectionState, string> = {
  connecting: '正在连接…', connected: '已连接', reconnecting: '正在重新连接…', rejected: '已被拒绝', closed: '未连接'
}

export function RemoteSettings(): React.JSX.Element {
  const t = useT()
  const remote = useRemoteWindow()
  if (remote) return <fieldset className="remote-settings">
    <legend>{t('远程访问')}</legend>
    <p className="settings-help">{t('此窗口连接到 {name}，会话、文件和终端都在那台电脑上运行。请在本机的 sPi 窗口中管理远程访问。', { name: remote.hostName })}</p>
  </fieldset>
  return <LocalRemoteSettings />
}

function LocalRemoteSettings(): React.JSX.Element {
  const t = useT()
  const { status, error: statusError } = useRemoteStatus()
  const [account, setAccount] = useState<RemoteAccountStatus | null>(null)
  const [storageProblem, setStorageProblem] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    window.spi.checkRemoteStorage().then(problem => { if (live) setStorageProblem(problem) }).catch(e => { if (live) setStorageProblem(remoteErrorText(e)) })
    return () => { live = false }
  }, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number; confirmed?: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const [lifetimeHours, setLifetimeHours] = useState(String(PAIRING_TTL_MS / 3_600_000))
  const [code, setCode] = useState('')
  const [now, setNow] = useState(Date.now())
  const relay = status?.relay

  async function checkAccount(): Promise<void> {
    setAccount(null)
    try { setAccount(await window.spi.checkRemoteAccount()) } catch (e) { setAccount({ state: 'failed', message: remoteErrorText(e) }) }
  }
  useEffect(() => { if (relay === 'devtunnels') void checkAccount() }, [relay])
  useEffect(() => {
    if (!pairing && !status?.host.pairingExpiresAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pairing, status?.host.pairingExpiresAt])
  // Status updates lag the createPairingCode reply, so a code is only hidden as used/cancelled after status has shown it.
  useEffect(() => {
    if (!pairing) return
    const live = status?.host.pairingExpiresAt === pairing.expiresAt
    if (now > pairing.expiresAt || (pairing.confirmed && !live)) setPairing(null)
    else if (live && !pairing.confirmed) setPairing({ ...pairing, confirmed: true })
  }, [now, pairing, status?.host.pairingExpiresAt])

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(remoteErrorText(e)) } finally { setBusy(false) }
  }
  if (!status) return <fieldset className="remote-settings"><legend>{t('远程访问')}</legend>{statusError ? <p role="alert" className="settings-error">{statusError}</p> : <p className="settings-help">{t('加载中…')}</p>}</fieldset>
  const unavailable = storageProblem !== null || (relay === 'devtunnels' && account?.state !== 'ready')
  const host = status.host
  const minutes = pairing ? Math.max(1, Math.ceil((pairing.expiresAt - now) / 60_000)) : 0
  const pendingExpiresAt = host.pairingExpiresAt && host.pairingExpiresAt > now ? host.pairingExpiresAt : undefined

  return <fieldset className="remote-settings" disabled={busy}>
    <legend>{t('远程访问')}</legend>
    <p className="settings-help">{t('通过 Microsoft Dev Tunnels 中继，在另一台电脑上打开本机的 sPi；内容在两台电脑之间端到端加密，中继只转发密文。')}</p>
    {storageProblem && <p role="alert" className="settings-error">{storageProblem}</p>}
    {relay === 'devtunnels' && <div className="remote-account" data-remote-account={account?.state ?? 'checking'}>
      <span>{t(!account ? '正在检查 GitHub CLI…' : accountText[account.state])}</span>
      <button type="button" onClick={() => void checkAccount()}>{t('重新检查')}</button>
    </div>}

    <h3>{t('允许其他设备访问本机')}</h3>
    <label className="app-settings-row settings-checkbox-row">
      <span>{t('开启远程访问')}</span>
      <input type="checkbox" data-setting="remoteHost" aria-label={t('开启远程访问')} checked={host.enabled} disabled={!host.enabled && unavailable} onChange={e => void run(async () => { await window.spi.setRemoteHostEnabled(e.target.checked); setPairing(null) })} />
    </label>
    <p className="settings-help" data-remote-host-state={host.state}>{t('状态：{state}', { state: t(hostStateText[host.state]) })}{host.error ? ' · ' + host.error : ''}</p>
    {host.enabled && <p className="settings-help">{t('同一时间只有一个远程连接拥有控制权，其余连接只能查看。先连接者获得控制权，断开后由最早在线的只读端接替。本机窗口不受限制。只配对你自己的设备。')}</p>}
    {host.enabled && !pairing && !pendingExpiresAt && <>
      <label className="app-settings-row" htmlFor="remote-pairing-hours">
        <span>{t('配对码有效期（小时）')}</span>
        <input id="remote-pairing-hours" data-setting="remotePairingHours" type="number" min="1" max={MAX_PAIRING_TTL_MS / 3_600_000} step="1" value={lifetimeHours} onChange={e => setLifetimeHours(e.target.value)} />
      </label>
      <p className="settings-help">{t('默认 1 小时，最长 60 天（1440 小时）。仅限本次运行；重启、关闭远程访问或取消后失效。有效期不影响已配对设备。')}</p>
      <button type="button" data-action="remote-add-device" disabled={host.state !== 'online' || !Number.isInteger(Number(lifetimeHours)) || Number(lifetimeHours) < 1 || Number(lifetimeHours) > MAX_PAIRING_TTL_MS / 3_600_000} onClick={() => void run(async () => { setPairing(await window.spi.createPairingCode(Number(lifetimeHours) * 3_600_000)); setCopied(false); setNow(Date.now()) })}>{t('添加设备…')}</button>
    </>}
    {pairing && <div className="remote-pairing">
      <label htmlFor="remote-pairing-code">{t('在另一台电脑的 sPi 设置中粘贴此配对码：')}</label>
      <textarea id="remote-pairing-code" data-remote-pairing-code readOnly rows={3} value={pairing.code} onFocus={e => e.currentTarget.select()} />
      <p className="settings-help">{t('到期时间：{date}', { date: new Date(pairing.expiresAt).toLocaleString() })}</p>
      <p className="settings-help">{t('{minutes} 分钟内有效，只能使用一次。请像密码一样保管，不要发到公开的地方。', { minutes })}</p>
      <div className="node-settings-actions">
        <button type="button" onClick={() => void navigator.clipboard.writeText(pairing.code).then(() => setCopied(true)).catch(e => setError(String(e)))}>{t(copied ? '已复制' : '复制配对码')}</button>
        <button type="button" onClick={() => void run(async () => { await window.spi.cancelPairingCode(); setPairing(null) })}>{t('取消')}</button>
      </div>
    </div>}
    {(host.enabled || host.devices.length > 0) && <>
      <h3>{t('设备列表')}</h3>
      <p className="settings-help">{t('待配对项会自动保留在此列表中，可稍后复制配对码到另一台电脑。完成配对后设备自动保存，无需确认或保存。当前同时支持一个待配对项。')}</p>
      <ul className="remote-list" aria-label={t('设备列表')}>
      {pendingExpiresAt && <li data-remote-pending-device>
        <span className="remote-name">{t('等待新设备配对')}</span>
        <span className="remote-state">{t('待配对')}</span>
        <span className="settings-help">{t('到期时间：{date}', { date: new Date(pendingExpiresAt).toLocaleString() })}</span>
        <button type="button" data-action="remote-view-pairing" onClick={() => void run(async () => {
          const current = await window.spi.getPairingCode()
          setNow(Date.now()); setPairing(current); setCopied(false)
          if (!current) setError(t('配对码已失效，请重新添加设备。'))
        })}>{t('查看配对码')}</button>
        <button type="button" data-action="remote-cancel-pending" onClick={() => void run(async () => { await window.spi.cancelPairingCode(); setPairing(null) })}>{t('取消')}</button>
      </li>}
      {!pendingExpiresAt && host.devices.length === 0 && <li>{t('尚无设备。点击“添加设备…”生成配对码。')}</li>}
      {host.devices.map(device => <li key={device.id} data-remote-device={device.id}>
        <span className="remote-name">{device.name}</span>
        <span className={`remote-state${device.connected ? ' connected' : ''}`}>{t(device.connected ? '已连接' : '已配对，未连接')}</span>
        {device.connected && <span className="remote-state" data-remote-device-access={device.access}>{t(device.access === 'control' ? '控制端' : '只读端')}</span>}
        <button type="button" onClick={() => { if (window.confirm(t('撤销“{name}”？该设备会立即断开，之后需要重新配对才能连接。', { name: device.name }))) void run(() => window.spi.revokeRemoteDevice(device.id)) }}>{t('撤销')}</button>
      </li>)}
      </ul>
    </>}

    <h3>{t('连接到其他电脑')}</h3>
    <label htmlFor="remote-pair-input">{t('配对码')}</label>
    <div className="remote-pair-row">
      <input id="remote-pair-input" data-setting="remotePairCode" type="text" autoComplete="off" spellCheck={false} value={code} placeholder="spi1.…" disabled={unavailable} onChange={e => setCode(e.target.value)} />
      <button type="button" data-action="remote-pair" disabled={!code.trim() || unavailable} onClick={() => void run(async () => { const entry = await window.spi.pairRemoteHost(code.trim()); setCode(''); await window.spi.connectRemoteHost(entry.id) })}>{t('配对并打开')}</button>
    </div>
    {status.hosts.length > 0 && <ul className="remote-list" aria-label={t('已配对的电脑')}>
      {status.hosts.map(entry => <li key={entry.id} data-remote-host={entry.id}>
        <span className="remote-name">{entry.name}</span>
        <span className={`remote-state${entry.connection === 'connected' ? ' connected' : ''}`} title={entry.detail}>{t(connectionText[entry.connection ?? 'closed'])}</span>
        <button type="button" data-action="remote-open" disabled={unavailable} onClick={() => void run(() => window.spi.connectRemoteHost(entry.id))}>{t('打开')}</button>
        <button type="button" onClick={() => { if (window.confirm(t('移除“{name}”？之后需要在那台电脑上生成新的配对码才能再连接。', { name: entry.name }))) void run(() => window.spi.forgetRemoteHost(entry.id)) }}>{t('移除')}</button>
      </li>)}
    </ul>}
    {error && <p role="alert" className="settings-error">{error}</p>}
  </fieldset>
}
