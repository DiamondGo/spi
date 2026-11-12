import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SessionTarget } from '../../../shared/types'
import { getStore, openSession, recoverSession, refreshSessionCatalog, setSessionHealthError } from '../store'
import { usePreferences, useT } from '../preferences'
import { ContextMenu, menuPosition, type MenuPosition } from './ContextMenu'

export interface SessionActionTarget extends SessionTarget { cwd: string; label: string }
interface Actions {
  rename(target: SessionActionTarget): void
  menu(event: React.MouseEvent<HTMLElement>, target: SessionActionTarget): void
}
const Context = createContext<Actions>({ rename() {}, menu() {} })
export function useSessionActions(): Actions { return useContext(Context) }
export function SessionActionsProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [menu, setMenu] = useState<{ position: MenuPosition; target: SessionActionTarget } | null>(null)
  const [dialog, setDialog] = useState<{ mode: 'rename' | 'delete'; target: SessionActionTarget; ai?: boolean; key: number } | null>(null)
  const next = useRef(0)
  const closeMenu = useCallback(() => setMenu(null), [])
  const rename = useCallback((target: SessionActionTarget) => setDialog({ mode: 'rename', target, key: ++next.current }), [])
  const liveId = menu?.target.sessionId
  const live = liveId ? getStore().sessions[liveId] : undefined
  async function checkConnection(id: string): Promise<void> {
    setSessionHealthError(id, undefined)
    try { await window.spi.checkSession(id) }
    catch (error) { setSessionHealthError(id, String(error)) }
  }
  async function recoverConnection(id: string): Promise<void> {
    if (!window.confirm(t('恢复将终止当前 Pi 进程并重新加载已保存的会话。草稿和待发送消息会保留，队列保持暂停，不会自动重发。外部工具可能仍在运行，请先检查。继续？'))) return
    try { await recoverSession(id) } catch {}
  }
  return <Context.Provider value={{ rename, menu: (event, target) => { event.preventDefault(); event.stopPropagation(); setMenu({ position: menuPosition(event), target }) } }}>
    {children}
    {menu && <ContextMenu position={menu.position} onClose={closeMenu} items={[
      { label: t('重命名会话'), action: () => rename(menu.target) },
      { label: t('AI 生成名称'), action: () => setDialog({ mode: 'rename', target: menu.target, ai: true, key: ++next.current }) },
      { label: t('删除会话'), danger: true, disabled: !menu.target.path || menu.target.path.startsWith('open:'), action: () => setDialog({ mode: 'delete', target: menu.target, key: ++next.current }) },
      ...(liveId ? [
        { label: t('检查连接'), disabled: live?.health?.status === 'recovering', action: () => { void checkConnection(liveId) } },
        { label: t('恢复会话'), danger: true, disabled: live?.health?.status === 'recovering' || live?.submitting, action: () => { void recoverConnection(liveId) } }
      ] : [])
    ]} />}
    {dialog && <SessionActionDialog key={dialog.key} mode={dialog.mode} target={dialog.target} autoGenerate={dialog.ai} onClose={() => setDialog(null)} />}
  </Context.Provider>
}
function SessionActionDialog({ target, mode, autoGenerate, onClose }: { target: SessionActionTarget; mode: 'rename' | 'delete'; autoGenerate?: boolean; onClose: () => void }) {
  const t = useT(), { settings } = usePreferences()
  const ref = useRef<HTMLDialogElement>(null), alive = useRef(true)
  const [name, setName] = useState(target.label.slice(0, 120))
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { alive.current = true; ref.current?.showModal(); return () => { alive.current = false } }, [])
  async function generate(): Promise<void> {
    setBusy(true); setError('')
    try {
      const id = target.sessionId || await openSession(target.cwd, target.path)
      const result = await window.spi.generateSessionName(id, settings.language)
      if (alive.current) setName(result)
    } catch (error) { if (alive.current) setError(String(error)) }
    finally { if (alive.current) setBusy(false) }
  }
  useEffect(() => { if (autoGenerate) void generate() }, [])
  async function save(): Promise<void> {
    setBusy(true); setError('')
    try {
      if (mode === 'delete') await window.spi.deleteSession(target)
      else await window.spi.renameSession(target, name.trim())
      refreshSessionCatalog(mode === 'rename' ? { path: target.path, name: name.trim() } : {})
      onClose()
    } catch (error) { if (alive.current) { setError(String(error)); setBusy(false) } }
  }
  return <dialog ref={ref} className="session-action-dialog" aria-labelledby="session-action-heading" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <h2 id="session-action-heading">{t(mode === 'delete' ? '删除会话' : '重命名会话')}</h2>
      {mode === 'rename' ? <>
        <label>{t('会话名称')}<input autoFocus maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <p>{t('AI 命名使用该会话当前模型和对话摘要，产生一次模型请求，不执行工具、不写入聊天；生成后可修改再保存。历史会话会先打开。')}</p>
        <button type="button" disabled={busy} onClick={() => void generate()}>{t(busy ? '处理中…' : 'AI 生成名称')}</button>
      </> : <>
        <p>{t('确定删除会话“{name}”？', { name: target.label })}</p>
        <p>{t('会话历史将移入系统回收站；正在运行的 Pi 和终端会关闭，草稿及待发送消息将丢弃。项目文件不会删除。')}</p>
      </>}
      {error && <div className="session-error" role="alert">{error}</div>}
      <div className="session-action-buttons">
        <button type="button" disabled={busy} onClick={onClose}>{t('取消')}</button>
        <button type="submit" className={mode === 'delete' ? 'danger' : undefined} disabled={busy || (mode === 'rename' && !name.trim())}>{t(busy ? '处理中…' : mode === 'delete' ? '移入回收站' : '保存名称')}</button>
      </div>
    </form>
  </dialog>
}
