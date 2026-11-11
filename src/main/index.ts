import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import os from 'os'
import { readdir } from 'fs/promises'
import { findPi, saveManualPiPath, loadManualNodePath, saveManualNodePath, loadPinned, togglePinned, loadLayout, saveLayout, type LayoutState } from './pi/piFinder'
import { scanSessions, scanRecent } from './pi/sessionScanner'
import { PiManager } from './pi/piManager'
import { YoloPolicy } from './pi/yolo'
import type { AppSettings, ImageRef, MessageSubmission } from '../shared/types'
import { SettingsStore, themeChrome } from './settings'
import { QuitController } from './quitController'
import { translate } from '../shared/i18n'
import { TerminalManager } from './terminalManager'
import { launchDirectory } from './launchRequests'
import { randomUUID } from 'crypto'

// Keep userData stable regardless of the npm launcher's scoped package name.
app.setName('spi')
if (process.platform === 'linux') app.setDesktopName('spi.desktop')
const appIcon = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../build/icons/icon.png')
const ownsInstance = app.requestSingleInstanceLock()
// A secondary macOS process may never reach whenReady after losing the lock.
// It owns no sessions/windows and must not enter the primary quit-confirmation flow.
if (!ownsInstance) app.exit(0)
let launchRequest: { id: string; cwd: string } | null = null
function queueLaunch(argv: string[], cwd: string): void {
  try {
    const directory = launchDirectory(argv, cwd)
    if (directory) {
      launchRequest = { id: randomUUID(), cwd: directory }
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('app:launch-directory')
    }
  } catch { console.error('[sPi] Invalid directory request; use --cwd=DIR with an existing directory') }
}
if (ownsInstance) {
  queueLaunch(process.argv, process.cwd())
  app.on('second-instance', (_event, argv, cwd) => {
    queueLaunch(argv, cwd)
    const win = BrowserWindow.getAllWindows()[0]
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  })
}

let manager: PiManager | null = null
let managerPromise: Promise<PiManager> | null = null
let terminalManager: TerminalManager | null = null
function getTerminals(): TerminalManager {
  if (!terminalManager) terminalManager = new TerminalManager((owner, event) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.id === owner)
    if (win && !win.webContents.isDestroyed()) win.webContents.send('terminal:event', event)
  })
  return terminalManager
}
let settingsStore: SettingsStore | null = null
function getSettings(): SettingsStore {
  if (!settingsStore) settingsStore = new SettingsStore(join(app.getPath('userData'), 'spi-settings.json'))
  return settingsStore
}
function applyWindowTheme(settings: AppSettings): void {
  nativeTheme.themeSource = settings.theme === 'light' ? 'light' : 'dark'
  const chrome = themeChrome[settings.theme]
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(chrome.background)
    if (process.platform !== 'darwin') win.setTitleBarOverlay({ color: chrome.color, symbolColor: chrome.symbolColor, height: 40 })
  }
}
function traceLifecycle(event: string): void {
  if (process.env.SPI_TEST_LIFECYCLE === '1') console.log('[sPi lifecycle] ' + event)
}
const quitting = new QuitController(
  () => getSettings().get().confirmOnExit,
  async () => {
    const language = getSettings().get().language
    const t = (text: string, params = {}) => translate(text, language, params)
    const options: Electron.MessageBoxOptions = {
      type: 'warning', title: t('退出 sPi'), message: t('确定退出 sPi 吗？'),
      detail: manager?.size ? t('还有 {count} 个已打开的会话。退出将中止这些会话，已产生的内容会保存在会话文件中。', { count: manager.size }) : t('应用程序将关闭。'),
      buttons: [t('退出'), t('取消')], defaultId: 1, cancelId: 1, noLink: true
    }
    if (manager?.pendingMessageCount) options.detail += '\n' + t('另有 {count} 条未交付消息仅缓存在内存中，退出将丢失。', { count: manager.pendingMessageCount })
    const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
    return result.response === 0
  },
  () => {
    terminalManager?.closeAll(); manager?.closeAll()
    // Let a prevented native close/before-quit event unwind before re-entering
    // Cocoa's termination path (notably when confirmation is disabled).
    traceLifecycle('quit-committed')
    setImmediate(() => { traceLifecycle('quit-dispatched'); app.quit() })
  }
)
function requestQuit(): void { void quitting.request().catch(error => console.error('[sPi quit]', error)) }
let yoloPolicy: YoloPolicy | null = null

function getYoloPolicy(): YoloPolicy {
  if (!yoloPolicy) yoloPolicy = new YoloPolicy(state => {
    BrowserWindow.getAllWindows().filter(w => !w.webContents.isDestroyed()).forEach(w => w.webContents.send('yolo:changed', state))
  })
  return yoloPolicy
}

async function getManager(): Promise<PiManager> {
  if (manager) return manager
  // Concurrent opens must share one manager; otherwise the first child can become orphaned.
  if (!managerPromise) {
    managerPromise = (async () => {
      const piPath = await findPi()
      if (!piPath) throw new Error('pi not found')
      manager = new PiManager(
        piPath,
        getYoloPolicy(),
        app.isPackaged ? join(process.resourcesPath, 'spi-permission-extension.mjs') : join(__dirname, 'permissionExtension.js'),
        (e) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('pi:event', e)),
        (sessionId) => {
          terminalManager?.closeSession(sessionId)
          BrowserWindow.getAllWindows().forEach(w => w.webContents.send('session:closed', sessionId))
        },
        () => BrowserWindow.getAllWindows().some(w => !w.webContents.isDestroyed() && !w.webContents.isCrashed() && w.webContents.getOSProcessId() > 0),
        loadManualNodePath
      )
      return manager
    })().catch(error => { managerPromise = null; throw error })
  }
  return managerPromise
}

function createWindow(): void {
  const settings = getSettings().get()
  nativeTheme.themeSource = settings.theme === 'light' ? 'light' : 'dark'
  const chrome = themeChrome[settings.theme]
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    icon: appIcon,
    backgroundColor: chrome.background,
    // 自定义标题栏：隐藏原生标题栏，Win/Linux 用 overlay 保留最小化/最大化/关闭
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : { color: chrome.color, symbolColor: chrome.symbolColor, height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win.show())
  const owner = win.webContents.id
  win.on('closed', () => { traceLifecycle('closed'); terminalManager?.closeOwner(owner) })
  win.webContents.on('render-process-gone', () => terminalManager?.closeOwner(owner))
  win.on('close', event => {
    traceLifecycle('close')
    // Prevent destruction first: Cancel must leave the current window and sessions usable.
    if (!quitting.allowed && BrowserWindow.getAllWindows().length === 1) { event.preventDefault(); requestQuit() }
  })

  const devServerUrl = process.env['ELECTRON_VITE_DEV_SERVER_URL']
  if (devServerUrl) win.loadURL(devServerUrl)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// ---- IPC 白名单 ----
ipcMain.handle('app:quit', event => {
  if (event.sender.isDestroyed() || !BrowserWindow.getAllWindows().some(win => win.webContents === event.sender)) throw new Error('Application window is closed')
  return quitting.request()
})
ipcMain.handle('app:launch-request', () => launchRequest)
ipcMain.handle('app:ack-launch', (_event, id: string) => { if (launchRequest?.id === id) launchRequest = null })
ipcMain.handle('terminal:open', (event, id: string, cols: number, rows: number) => {
  if (event.sender.isDestroyed() || !BrowserWindow.getAllWindows().some(win => win.webContents.id === event.sender.id)) throw new Error('Terminal window is closed')
  if (!manager) throw new Error('session not found')
  return getTerminals().open(id, manager.getCwd(id), event.sender.id, cols, rows)
})
ipcMain.handle('terminal:attach', (event, id: string, terminalId: string) => getTerminals().attach(id, terminalId, event.sender.id))
ipcMain.handle('terminal:get', (event, id: string) => getTerminals().get(id, event.sender.id))
ipcMain.handle('terminal:close', (event, id: string, terminalId: string) => getTerminals().close(id, terminalId, event.sender.id))
for (const method of ['write', 'resize', 'ack'] as const) {
  ipcMain.on(`terminal:${method}`, (event, id: string, terminalId: string, a: string | number, b?: number) => {
    try {
      if (method === 'write') getTerminals().write(id, terminalId, event.sender.id, a as string)
      else if (method === 'resize') getTerminals().resize(id, terminalId, event.sender.id, a as number, b as number)
      else getTerminals().ack(id, terminalId, event.sender.id, a as number)
    } catch (error) {
      if (!event.sender.isDestroyed()) event.sender.send('terminal:event', { type: 'error', sessionId: id, terminalId, message: String(error) })
    }
  })
}
ipcMain.handle('settings:get', () => getSettings().get())
ipcMain.handle('settings:update', (_e, patch: Partial<AppSettings>) => {
  const settings = getSettings().update(patch)
  applyWindowTheme(settings)
  BrowserWindow.getAllWindows().forEach(win => win.webContents.send('settings:changed', settings))
  return settings
})
ipcMain.handle('yolo:get', () => getYoloPolicy().snapshot())
ipcMain.handle('yolo:set', (_e, id: string, enabled: boolean) => getYoloPolicy().setEnabled(id, enabled))
ipcMain.handle('app:home', () => os.homedir())
ipcMain.handle('pi:find', () => findPi())
ipcMain.handle('pi:set-path', (_e, p: string) => saveManualPiPath(p))
ipcMain.handle('node:get-path', () => loadManualNodePath())
ipcMain.handle('node:set-path', (_e, p: unknown) => saveManualNodePath(p))
ipcMain.handle('node:choose-path', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || owner.isDestroyed()) throw new Error('Node.js file selection requires its owning sPi window')
  const result = await dialog.showOpenDialog(owner, { title: 'Select Node.js executable', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Node.js', extensions: ['exe'] }] } : {}) })
  return result.canceled ? null : result.filePaths[0] || null
})

ipcMain.handle('fs:list-dirs', async (_e, path: string) => {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
})
ipcMain.handle('fs:list-files', async (_e, path: string) => {
  const entries = await readdir(path, { withFileTypes: true })
  return entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    .slice(0, 200)
})

ipcMain.handle('sessions:scan', (_e, cwd: string) => scanSessions(cwd))
ipcMain.handle('sessions:scan-recent', (_e, limit?: number) => scanRecent(limit ?? 50))
ipcMain.handle('pins:get', () => loadPinned())
ipcMain.handle('pins:toggle', (_e, p: string) => togglePinned(p))
ipcMain.handle('layout:load', () => loadLayout())
ipcMain.handle('layout:save', (_e, s: LayoutState) => saveLayout(s))

ipcMain.handle('session:open', async (_e, opts: { cwd: string; sessionPath?: string }) => {
  const m = await getManager()
  return m.open(opts.cwd, opts.sessionPath)
})
ipcMain.handle('session:close', (_e, id: string) => { terminalManager?.closeSession(id); return manager?.close(id) })
ipcMain.handle('session:prompt', (_e, id: string, text: string, mode: 'normal' | 'steer' | 'followUp', images?: Array<{ data: string; mimeType: string }>) =>
  manager?.sendPrompt(id, text, mode, images)
)
ipcMain.handle('session:abort', (_e, id: string) => manager?.abort(id))
ipcMain.handle('session:get-state', (_e, id: string) => manager?.getState(id))
ipcMain.handle('session:get-messages', (_e, id: string) => manager?.getMessages(id))
ipcMain.handle('session:answer-ui', (_e, id: string, reqId: string, payload: { value?: string; confirmed?: boolean; cancelled?: boolean }) =>
  manager?.answerExtensionUi(id, reqId, payload)
)
ipcMain.handle('session:models', (_e, id: string) => manager?.getAvailableModels(id))
ipcMain.handle('session:thinking-levels', (_e, id: string) => manager?.getAvailableThinkingLevels(id))
ipcMain.handle('session:set-model', (_e, id: string, provider: string, modelId: string) =>
  manager?.setModel(id, provider, modelId)
)
ipcMain.handle('session:set-thinking', (_e, id: string, level: string) =>
  manager?.setThinkingLevel(id, level)
)
ipcMain.handle('session:commands', (_e, id: string) => manager?.getCommands(id))
ipcMain.handle('messages:submit', async (_e, id: string, message: MessageSubmission) => (await getManager()).submitMessage(id, message))
ipcMain.handle('messages:get', async (_e, id: string) => (await getManager()).getPendingMessages(id))
ipcMain.handle('messages:edit', async (_e, id: string, messageId: string, revision: number) => (await getManager()).editPendingMessage(id, messageId, revision))
ipcMain.handle('messages:update', async (_e, id: string, messageId: string, revision: number, text: string, images: ImageRef[]) => (await getManager()).updatePendingMessage(id, messageId, revision, text, images))
ipcMain.handle('messages:finish-edit', async (_e, id: string, messageId: string, revision: number) => (await getManager()).finishEditingMessage(id, messageId, revision))
ipcMain.handle('messages:cancel', async (_e, id: string, messageId: string, revision: number) => (await getManager()).cancelPendingMessage(id, messageId, revision))
ipcMain.handle('messages:resume', async (_e, id: string) => (await getManager()).resumePendingMessages(id))

app.whenReady().then(() => {
  if (!ownsInstance) return
  if (process.platform === 'darwin') app.dock?.setIcon(appIcon)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  traceLifecycle('window-all-closed')
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', event => {
  traceLifecycle('before-quit')
  if (!quitting.allowed) { event.preventDefault(); requestQuit() }
})
