import { useEffect, useState } from 'react'
import { useT } from '../preferences'
import { useRemoteWindow } from '../remote'

export function NodeSettings(): React.JSX.Element {
  const t = useT()
  const remote = useRemoteWindow()
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(false)
  useEffect(() => {
    let active = true
    window.spi.getNodePath().then(value => { if (active) { setDraft(value || ''); setSaved(value || '') } })
      .catch(e => { if (active) setError(String(e.message || e)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])
  async function save(value: string): Promise<void> {
    setBusy(true); setError(''); setNotice(false)
    try { await window.spi.setNodePath(value || null); setDraft(value); setSaved(value); setNotice(true) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  async function browse(): Promise<void> {
    setBusy(true); setError(''); setNotice(false)
    try { const value = await window.spi.chooseNodePath(); if (value) setDraft(value) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <fieldset className="node-settings" disabled={busy}>
    <legend>{t('Node.js 运行环境')}</legend>
    <label htmlFor="node-path">{t('Node.js 路径（可选）')}</label>
    <input id="node-path" data-setting="nodePath" type="text" autoComplete="off" spellCheck={false} value={draft} placeholder={t('留空时自动查找 Node.js')} onChange={e => { setDraft(e.target.value); setNotice(false); setError('') }} />
    <div className="node-settings-actions">
      {!remote && <button type="button" data-action="browse-node" onClick={() => void browse()}>{t('选择文件…')}</button>}
      <button type="button" data-action="save-node" disabled={draft === saved} onClick={() => void save(draft.trim())}>{t('保存 Node 路径')}</button>
      <button type="button" data-action="auto-node" disabled={!draft && !saved} onClick={() => void save('')}>{t('自动查找')}</button>
    </div>
    <p className="settings-help">{t('需要 Node.js ≥22.19。只影响之后新建或重新打开的会话，不重启已有会话。')}</p>
    <p className="settings-help">{t('自动查找会检查当前 PATH、Pi 自带运行环境和登录 shell；这里只保存 sPi 配置。')}</p>
    {remote && <p className="settings-help">{t('这是 {name} 上的设置，请填写那台电脑上的路径。', { name: remote.hostName })}</p>}
    {notice && <p role="status" className="settings-help">{t('Node 路径已保存，将用于之后打开的会话。')}</p>}
    {error && <p role="alert" className="settings-error">{error}</p>}
  </fieldset>
}
