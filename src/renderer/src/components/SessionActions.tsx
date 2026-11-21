import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SessionTarget } from '../../../shared/types'
import { checkSession, getStore, openSession, refreshSessionCatalog } from '../store'
import { usePreferences, useT } from '../preferences'
import { ContextMenu, menuPosition, type MenuPosition } from './ContextMenu'
import { SessionRecoveryDialog } from './SessionRecoveryDialog'
import { useRemoteReadOnly } from '../remote'

export interface SessionActionTarget extends SessionTarget { cwd: string; label: string }
interface Actions {
  rename(target: SessionActionTarget): void
  menu(event: React.MouseEvent<HTMLElement>, target: SessionActionTarget): void
  menuMulti(event: React.MouseEvent<HTMLElement>, targets: SessionActionTarget[]): void
}
const Context = createContext<Actions>({ rename() {}, menu() {}, menuMulti() {} })
export function useSessionActions(): Actions { return useContext(Context) }
export function SessionActionsProvider({ children }: { children: ReactNode }) {
  const t = useT(), readOnly = useRemoteReadOnly()
  const [recovery, setRecovery] = useState<string | null>(null)
  const recoveringSession = recovery ? getStore().sessions[recovery] : undefined
  const [menu, setMenu] = useState<{ position: MenuPosition; target: SessionActionTarget; targets?: SessionActionTarget[] } | null>(null)
  const [dialog, setDialog] = useState<{ mode: 'rename' | 'delete'; targets: SessionActionTarget[]; ai?: boolean; key: number } | null>(null)
  const next = useRef(0)
  const closeMenu = useCallback(() => setMenu(null), [])
  const rename = useCallback((target: SessionActionTarget) => setDialog({ mode: 'rename', targets: [target], key: ++next.current }), [])
  const liveId = menu?.target.sessionId
  const live = liveId ? getStore().sessions[liveId] : undefined
  async function checkConnection(id: string): Promise<void> {
    try { await checkSession(id) }
    catch {}
  }
  // 多选时右键只给删除：重命名/AI 命名/检查连接/恢复都不适用于多个目标。
  const multiTargets = menu?.targets && menu.targets.length > 1 ? menu.targets : null
  const menuItems = multiTargets ? [
    { label: t('删除 {count} 个会话', { count: multiTargets.length }), danger: true, disabled: multiTargets.some(x => !x.path || x.path.startsWith('open:')), action: () => setDialog({ mode: 'delete', targets: multiTargets, key: ++next.current }) }
  ] : [
    { label: t('重命名会话'), action: () => rename(menu!.target) },
    { label: t('AI 生成名称'), action: () => setDialog({ mode: 'rename', targets: [menu!.target], ai: true, key: ++next.current }) },
    { label: t('删除会话'), danger: true, disabled: !menu!.target.path || menu!.target.path.startsWith('open:'), action: () => setDialog({ mode: 'delete', targets: [menu!.target], key: ++next.current }) },
    ...(liveId ? [
      { label: t('检查连接'), disabled: live?.health?.status === 'recovering', action: () => { void checkConnection(liveId) } },
      { label: t('恢复会话'), danger: true, disabled: readOnly || live?.health?.status === 'recovering' || live?.submitting, action: () => setRecovery(liveId) }
    ] : [])
  ]
  return <Context.Provider value={{ rename, menu: (event, target) => { event.preventDefault(); event.stopPropagation(); setMenu({ position: menuPosition(event), target }) }, menuMulti: (event, targets) => { event.preventDefault(); event.stopPropagation(); setMenu({ position: menuPosition(event), target: targets[0], targets }) } }}>
    {children}
    {menu && <ContextMenu position={menu.position} onClose={closeMenu} items={menuItems} />}
    {recovery && <SessionRecoveryDialog key={recovery} sessionId={recovery} disabled={!recoveringSession || !!recoveringSession.submitting || recoveringSession.health?.status === 'recovering'} onClose={() => setRecovery(null)} />}
    {dialog && <SessionActionDialog key={dialog.key} mode={dialog.mode} targets={dialog.targets} autoGenerate={dialog.ai} onClose={() => setDialog(null)} />}
  </Context.Provider>
}
function SessionActionDialog({ targets, mode, autoGenerate, onClose }: { targets: SessionActionTarget[]; mode: 'rename' | 'delete'; autoGenerate?: boolean; onClose: () => void }) {
  const t = useT(), { settings } = usePreferences()
  const target = targets[0]
  const multi = targets.length > 1
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
      if (mode === 'delete') {
        // 逐个删除：单个目标失败不阻断其余，最后汇总报错。
        const failed: string[] = []
        for (const item of targets) {
          try { await window.spi.deleteSession(item) }
          catch (e) { failed.push(`${item.label}：${String(e)}`) }
        }
        if (failed.length && alive.current) { setError(failed.slice(0, 3).join('；') + (failed.length > 3 ? `（另有 ${failed.length - 3} 个失败）` : '')); setBusy(false); return }
      } else {
        await window.spi.renameSession(target, name.trim())
      }
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
        {multi ? <>
          <p>{t('确定删除 {count} 个会话？', { count: targets.length })}</p>
          <ul className="session-delete-list">
            {targets.slice(0, 5).map(item => <li key={item.path || item.sessionId}>{item.label || t('(无标题)')}</li>)}
            {targets.length > 5 && <li>{t('… 等 {count} 个会话', { count: targets.length })}</li>}
          </ul>
        </> : <p>{t('确定删除会话“{name}”？', { name: target.label })}</p>}
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
