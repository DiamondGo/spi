import { useEffect, useState } from 'react'
import { DirectoryTree } from './components/DirectoryTree'
import { SessionList } from './components/SessionList'
import { RecentSessions } from './components/RecentSessions'
import { ChatView } from './components/ChatView'
import { InputBar } from './components/InputBar'
import { SessionTabs } from './components/SessionTabs'
import { TitleBar } from './components/TitleBar'
import { TerminalDock } from './components/TerminalDock'
import { forgetTerminalSession, subscribeTerminalState } from './terminals'
import { Icon, IconControl } from './components/IconControl'
import { applyEvent, getStore, openDirectory, openSession, removeSession, setActive, setPiPath, useStore } from './store'
import type { SessionMeta } from '../../shared/types'
import { useT } from './preferences'

type ViewMode = 'dir' | 'recent'

export default function App() {
  const t = useT()
  const { sessions, activeId, piPath } = useStore()
  const [viewMode, setViewMode] = useState<ViewMode>('dir')
  const [selectedDir, setSelectedDir] = useState<string | null>(null)
  const [homeDir, setHomeDir] = useState<string>('/')
  const [metaCache, setMetaCache] = useState<Record<string, SessionMeta[]>>({})
  const [manualPath, setManualPath] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [openError, setOpenError] = useState('')
  const [restored, setRestored] = useState(false)

  // 持久化当前布局（视图模式 + 选中目录 + 打开的会话）
  function persist(): void {
    if (!restored) return
    const s = getStore()
    const layout = {
      viewMode,
      selectedDir,
      sessions: Object.values(s.sessions).map((x) => ({
        cwd: x.cwd,
        sessionPath: x.state?.sessionFile
      }))
    }
    window.spi.saveLayout(layout).catch(() => {})
  }

  useEffect(() => {
    window.spi.getHome().then(setHomeDir).catch(() => {})
  }, [])

  useEffect(() => {
    window.spi.findPi().then((p) => setPiPath(p))
    const offTerminal = subscribeTerminalState()
    const offEvent = window.spi.onPiEvent(({ sessionId, event }) => applyEvent(sessionId, event))
    const offClosed = window.spi.onSessionClosed((id) => {
      // 关闭活动会话时，自动切到另一个已打开的会话
      const s = getStore()
      const wasActive = s.activeId === id
      removeSession(id)
      forgetTerminalSession(id)
      if (wasActive) {
        const remaining = Object.keys(getStore().sessions)
        if (remaining.length) setActive(remaining[0])
      }
    })
    return () => {
      offTerminal()
      offEvent()
      offClosed()
    }
  }, [])

  const active = activeId ? sessions[activeId] : null

  // 启动时恢复上次的布局 + 重开会话
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const layout = await window.spi.loadLayout()
      if (cancelled) return
      if (layout.viewMode === 'dir' || layout.viewMode === 'recent') setViewMode(layout.viewMode)
      if (layout.selectedDir) setSelectedDir(layout.selectedDir)
      // 重开上次的会话
      for (const s of layout.sessions ?? []) {
        if (cancelled) break
        try {
          // Shared opens populate the store themselves; a remount may adopt the same request.
          // Window/application cleanup, not an obsolete effect, owns the underlying process.
          await openSession(s.cwd, s.sessionPath)
        } catch (error) {
          if (!cancelled) setOpenError(t('无法恢复 {cwd}：{error}', { cwd: s.cwd, error: String(error) }))
        }
      }
      if (!cancelled) setRestored(true)
    })()
    return () => { cancelled = true }
  }, [])

  // 布局/会话变化时持久化（依赖会话 ID 列表，避免每次事件都写文件）
  const sessionIds = Object.keys(sessions).join(',')
  useEffect(() => {
    persist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedDir, sessionIds, restored])

  useEffect(() => {
    if (!restored) return
    let cancelled = false
    let busy = false
    let rerun = false
    async function drain(): Promise<void> {
      if (busy) { rerun = true; return }
      busy = true
      try {
        while (!cancelled) {
          const request = await window.spi.getLaunchRequest()
          if (!request || cancelled) break
          try {
            setViewMode('dir')
            setSelectedDir(request.cwd)
            await openDirectory(request.cwd)
          } catch (error) { if (!cancelled) setOpenError(String(error)) }
          if (!cancelled) await window.spi.acknowledgeLaunchRequest(request.id)
        }
      } catch (error) { if (!cancelled) setOpenError(String(error)) }
      finally {
        busy = false
        if (rerun && !cancelled) { rerun = false; void drain() }
      }
    }
    const off = window.spi.onLaunchDirectory(() => { void drain() })
    void drain()
    return () => { cancelled = true; off() }
  }, [restored])

  async function handleSelectDir(dir: string): Promise<void> {
    setSelectedDir(dir)
    try {
      const meta = await window.spi.scanSessions(dir)
      setMetaCache((c) => ({ ...c, [dir]: meta }))
    } catch {}
  }

  // 打开一个会话（来自目录列表或近期列表）
  async function openSessionMeta(m: SessionMeta): Promise<void> {
    setOpenError('')
    try {
      await openSession(m.cwd, m.path)
      // 左栏是目录模式时，自动切到该会话的目录
      if (viewMode === 'dir') setSelectedDir(m.cwd)
    } catch (e) {
      setOpenError(String(e))
    }
  }

  // 切换标签时，左栏是目录模式则自动切到该会话的目录
  function handleTabActivate(id: string): void {
    if (viewMode === 'dir') {
      const s = getStore().sessions[id]
      if (s) setSelectedDir(s.cwd)
    }
  }

  return (
    <div className="app-root">
      <TitleBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
      {openError && <div className="session-error" role="alert">{openError} <button onClick={() => setOpenError('')}>{t('关闭提示')}</button></div>}
      <div className="layout">
      {sidebarOpen && (
      <aside className="sidebar">
        <div className="sidebar-mode-toggle">
          <IconControl tooltip={t('目录 · 按工作目录浏览会话')}>
            <button type="button" className={`sidebar-icon-button${viewMode === 'dir' ? ' active' : ''}`} aria-label={t('目录')} aria-pressed={viewMode === 'dir'} onClick={() => setViewMode('dir')}>
              <Icon name="folder" />
            </button>
          </IconControl>
          <IconControl tooltip={t('近期 · 浏览最近使用的会话')}>
            <button type="button" className={`sidebar-icon-button${viewMode === 'recent' ? ' active' : ''}`} aria-label={t('近期')} aria-pressed={viewMode === 'recent'} onClick={() => setViewMode('recent')}>
              <Icon name="history" />
            </button>
          </IconControl>
        </div>
        {viewMode === 'dir' ? (
          <>
            <div className="sidebar-section">
              <DirectoryTree
                homeDir={homeDir}
                selected={selectedDir}
                onSelect={handleSelectDir}
                sessionsByDir={metaCache}
              />
            </div>
            <div className="sidebar-section session-pane">
              <SessionList dir={selectedDir} onOpen={openSessionMeta} />
            </div>
          </>
        ) : (
          <div className="sidebar-section">
            <RecentSessions onOpen={openSessionMeta} />
          </div>
        )}
      </aside>
      )}
      <main className="chat">
        {piPath === null ? (
          <div className="pi-missing">
            <div>{t('未找到 pi。请手动指定路径：')}</div>
            <div className="pi-missing-row">
              <input
                value={manualPath}
                placeholder="/path/to/pi"
                onChange={(e) => setManualPath(e.target.value)}
              />
              <button
                onClick={async () => {
                  await window.spi.setPiPath(manualPath)
                  const p = await window.spi.findPi()
                  setPiPath(p)
                }}
                disabled={!manualPath}
              >
                {t('保存')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <SessionTabs onActivate={handleTabActivate} />
            {active ? (
              <>
                <ChatView session={active} />
                <TerminalDock activeId={activeId} />
                <InputBar session={active} />
              </>
            ) : (
              <div className="chat-messages">
                <div className="placeholder">
                  {t('从左侧选择一个目录或近期会话，或新建会话。')}
                </div>
              </div>
            )}
          </>
        )}
      </main>
      </div>
    </div>
  )
}
