import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, screen, shell } from 'electron'
import { join, resolve } from 'path'
import { realpathSync } from 'fs'
import os from 'os'
import { readdir } from 'fs/promises'
import { findPi, saveManualPiPath, loadManualNodePath, saveManualNodePath, loadPinned, togglePinned, loadLayout, saveLayout, type LayoutState } from './pi/piFinder'
import { scanSessions, scanRecent } from './pi/sessionScanner'
import { PiManager } from './pi/piManager'
import { YoloPolicy } from './pi/yolo'
import type { AppSettings, ImageRef, MessageSubmission, RemoteStatusSnapshot, RemoteWindowInfo, SessionTarget, SessionCatalogChange } from '../shared/types'
import { SettingsStore, themeChrome } from './settings'
import { QuitController } from './quitController'
import { translate } from '../shared/i18n'
import { TerminalManager } from './terminalManager'
import { launchDirectory } from './launchRequests'
import { randomUUID } from 'crypto'
import { loadWindowState, trackWindowState } from './windowState'
import { checkedSessionFile, renameSessionFile, sessionName } from './pi/sessionFiles'
import { ApiRegistry, type Caller } from './api/registry'
import { DevTunnelsBackend, LoopbackBackend, type RemoteBackend } from './remote/backend'
import { electronSecretStorage, loadOrCreateIdentity, type SecretStorage } from './remote/identity'
import { RemoteHostService } from './remote/hostService'
import { RemoteClientService, type RemoteConnection } from './remote/clientService'
import { CLIENT_LOCAL_CHANNELS } from './remote/protocol'
import type { KeyPair } from './remote/noise'

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

// ---- Windows: local windows show this computer; remote windows show a paired host ----
interface RemoteWindow { hostId: string; win: BrowserWindow; connection: RemoteConnection; resync: boolean }
const remoteWindows = new Map<number, RemoteWindow>()
function liveWindows(): BrowserWindow[] { return BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !w.webContents.isDestroyed()) }
function localWindows(): BrowserWindow[] { return liveWindows().filter(w => !remoteWindows.has(w.webContents.id)) }
function sendLocal(channel: string, payload?: unknown): void { for (const win of localWindows()) win.webContents.send(channel, payload) }
/** Host data (sessions, Pi events): local windows plus connected remote devices. */
function publish(channel: string, payload: unknown): void {
  sendLocal(channel, payload)
  remoteHost?.broadcast(channel, payload)
}

let launchRequest: { id: string; cwd: string } | null = null
function queueLaunch(argv: string[], cwd: string): void {
  try {
    const directory = launchDirectory(argv, cwd)
    if (directory) {
      launchRequest = { id: randomUUID(), cwd: directory }
      sendLocal('app:launch-directory')
    }
  } catch { console.error('[sPi] Invalid directory request; use --cwd=DIR with an existing directory') }
}
if (ownsInstance) {
  queueLaunch(process.argv, process.cwd())
  app.on('second-instance', (_event, argv, cwd) => {
    queueLaunch(argv, cwd)
    const win = localWindows()[0] ?? liveWindows()[0]
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  })
}

let manager: PiManager | null = null
let managerPromise: Promise<PiManager> | null = null
let terminalManager: TerminalManager | null = null
function getTerminals(): TerminalManager {
  if (!terminalManager) terminalManager = new TerminalManager((owner, event) => {
    if (owner.startsWith('remote:')) { remoteHost?.sendToOwner(owner, 'terminal:event', event); return }
    const win = localWindows().find(w => 'local:' + w.webContents.id === owner)
    if (win) win.webContents.send('terminal:event', event)
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
  for (const win of liveWindows()) {
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
    if (remoteHost?.connectedDevices) options.detail += '\n' + t('{count} 台远程设备已连接，退出后将断开。', { count: remoteHost.connectedDevices })
    const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
    return result.response === 0
  },
  () => {
    terminalManager?.closeAll(); manager?.closeAll()
    void remoteHost?.stop().catch(() => {}); void remoteClient?.closeAll().catch(() => {})
    // Let a prevented native close/before-quit event unwind before re-entering
    // Cocoa's termination path (notably when confirmation is disabled).
    traceLifecycle('quit-committed')
    setImmediate(() => { traceLifecycle('quit-dispatched'); app.quit() })
  }
)
function requestQuit(): void { void quitting.request().catch(error => console.error('[sPi quit]', error)) }
let yoloPolicy: YoloPolicy | null = null

function getYoloPolicy(): YoloPolicy {
  if (!yoloPolicy) yoloPolicy = new YoloPolicy(state => publish('yolo:changed', state))
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
        (e) => publish('pi:event', e),
        (sessionId) => {
          terminalManager?.closeSession(sessionId)
          publish('session:closed', sessionId)
        },
        // A connected remote device is a live UI too: approvals stay answerable from it.
        () => localWindows().some(w => !w.webContents.isCrashed() && w.webContents.getOSProcessId() > 0) || (remoteHost?.connectedDevices ?? 0) > 0,
        loadManualNodePath
      )
      return manager
    })().catch(error => { managerPromise = null; throw error })
  }
  return managerPromise
}

// ---- Remote access (off until enabled; never contacts any service before that) ----
// Dev builds only: 'loopback' replaces the relay with 127.0.0.1; 'devtunnels' keeps the real relay.
// Both keep keys in plain text inside the throwaway test profile instead of the OS keyring.
const remoteTestMode = !app.isPackaged && ['loopback', 'devtunnels'].includes(process.env.SPI_TEST_REMOTE ?? '') ? process.env.SPI_TEST_REMOTE : null
let remoteBackend: RemoteBackend | null = null
let secretStorage: SecretStorage | null = null
let identity: KeyPair | null = null
let remoteHost: RemoteHostService | null = null
let remoteClient: RemoteClientService | null = null
let remoteChangeTimer: ReturnType<typeof setTimeout> | null = null
function getBackend(): RemoteBackend {
  remoteBackend ??= remoteTestMode === 'loopback' ? new LoopbackBackend() : new DevTunnelsBackend(app.getVersion())
  return remoteBackend
}
function getSecretStorage(): SecretStorage {
  secretStorage ??= electronSecretStorage(safeStorage, process.platform, remoteTestMode !== null)
  return secretStorage
}
function getIdentity(): KeyPair {
  identity ??= loadOrCreateIdentity(join(app.getPath('userData'), 'spi-remote-identity.json'), getSecretStorage())
  return identity
}
function remoteLog(message: string): void { console.error('[sPi remote] ' + message) }
function remoteChanged(): void {
  if (remoteChangeTimer) return
  remoteChangeTimer = setTimeout(() => {
    remoteChangeTimer = null
    if (remoteHost && remoteClient) sendLocal('remote:changed', remoteStatus())
    for (const remote of remoteWindows.values()) sendRemoteWindowInfo(remote)
  }, 50)
}
function getRemoteHost(): RemoteHostService {
  remoteHost ??= new RemoteHostService({
    dataDir: app.getPath('userData'), backend: getBackend(), identity: getIdentity, hostName: () => os.hostname(),
    invoke: (channel, caller, args) => api.invoke(channel, caller, args),
    send: (channel, caller, args) => api.send(channel, caller, args),
    ownerGone: owner => terminalManager?.closeOwner(owner),
    changed: remoteChanged, log: remoteLog
  })
  return remoteHost
}
function getRemoteClient(): RemoteClientService {
  remoteClient ??= new RemoteClientService({ dataDir: app.getPath('userData'), backend: getBackend(), identity: getIdentity, deviceName: () => os.hostname(), changed: remoteChanged, log: remoteLog })
  return remoteClient
}
let remoteStorageProblem: string | undefined
/** Keychain access may require human OS approval. Never probe it merely to draw a badge. */
function checkRemoteStorage(): string | null {
  const problem = getSecretStorage().problem()
  remoteStorageProblem = problem ?? undefined
  remoteChanged()
  return problem
}
function remoteStatus(): RemoteStatusSnapshot {
  return { relay: getBackend().kind, storageProblem: remoteStorageProblem, host: getRemoteHost().snapshot(), hosts: getRemoteClient().hosts() }
}
function remoteWindowInfo(remote: RemoteWindow): RemoteWindowInfo {
  const { connection } = remote
  return { hostId: remote.hostId, hostName: connection.hostName, state: connection.state, access: connection.access, detail: connection.detail, reason: connection.reason, resync: remote.resync || undefined }
}
function sendRemoteWindowInfo(remote: RemoteWindow): void {
  if (!remote.win.webContents.isDestroyed()) remote.win.webContents.send('remote:window-changed', remoteWindowInfo(remote))
  remote.resync = false
}

function windowOptions(title?: string): Electron.BrowserWindowConstructorOptions {
  const settings = getSettings().get()
  nativeTheme.themeSource = settings.theme === 'light' ? 'light' : 'dark'
  const chrome = themeChrome[settings.theme]
  return {
    show: false,
    title,
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
  }
}
function loadRenderer(win: BrowserWindow): void {
  const devServerUrl = process.env['ELECTRON_VITE_DEV_SERVER_URL']
  if (devServerUrl) win.loadURL(devServerUrl)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}
function confirmLastWindowClose(win: BrowserWindow): void {
  win.on('close', event => {
    traceLifecycle('close')
    // Prevent destruction first: Cancel must leave the current window and sessions usable.
    if (!quitting.allowed && BrowserWindow.getAllWindows().length === 1) { event.preventDefault(); requestQuit() }
  })
}

function createWindow(): void {
  const windowFile = join(app.getPath('userData'), 'spi-window.json')
  const placement = loadWindowState(windowFile, screen.getAllDisplays().map(display => display.workArea))
  const win = new BrowserWindow({ ...placement.bounds, ...windowOptions() })
  trackWindowState(win, windowFile)
  win.on('ready-to-show', () => { if (placement.maximized) win.maximize(); win.show() })
  const owner = 'local:' + win.webContents.id
  win.on('closed', () => { traceLifecycle('closed'); terminalManager?.closeOwner(owner) })
  win.webContents.on('render-process-gone', () => terminalManager?.closeOwner(owner))
  confirmLastWindowClose(win)
  loadRenderer(win)
}

const openingRemote = new Map<string, Promise<void>>()
function openRemoteWindow(hostId: string): Promise<void> {
  const existing = [...remoteWindows.values()].find(remote => remote.hostId === hostId)
  if (existing) { if (existing.win.isMinimized()) existing.win.restore(); existing.win.show(); existing.win.focus(); return Promise.resolve() }
  const pending = openingRemote.get(hostId)
  if (pending) return pending
  const request = (async () => {
    const connection = await getRemoteClient().connect(hostId)
    const win = new BrowserWindow({ width: 1200, height: 800, ...windowOptions('sPi — ' + connection.hostName) })
    const id = win.webContents.id
    const remote: RemoteWindow = { hostId, win, connection, resync: false }
    remoteWindows.set(id, remote)
    const offEvent = connection.onEvent((channel, payload) => { if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload) })
    const offState = connection.onState(resync => { if (resync) remote.resync = true; sendRemoteWindowInfo(remote) })
    win.on('ready-to-show', () => win.show())
    win.on('closed', () => {
      remoteWindows.delete(id); offEvent(); offState()
      void getRemoteClient().disconnect(hostId).catch(() => {})
    })
    confirmLastWindowClose(win)
    loadRenderer(win)
  })().finally(() => openingRemote.delete(hostId))
  openingRemote.set(hostId, request)
  return request
}

// ---- Handler table: local windows and paired remote devices share it ----
const api = new ApiRegistry()
const localOnly = { remote: false }
function localSender(caller: Caller): Electron.WebContents {
  if (caller.kind !== 'local' || !caller.sender || caller.sender.isDestroyed() || !localWindows().some(win => win.webContents === caller.sender)) throw new Error('Application window is closed')
  return caller.sender
}
function requireAppWindow(caller: Caller): void {
  if (caller.kind === 'remote') return
  if (!caller.sender || caller.sender.isDestroyed() || !localWindows().some(win => win.webContents === caller.sender) || !caller.mainFrame) throw new Error('Session operation requires the application window')
}

api.handle('app:quit', caller => { localSender(caller); return quitting.request() }, localOnly)
api.handle('app:launch-request', () => launchRequest, localOnly)
api.handle('app:ack-launch', (_caller, id: string) => { if (launchRequest?.id === id) launchRequest = null }, localOnly)
api.handle('terminal:open', (caller, id: string, cols: number, rows: number) => {
  if (caller.kind === 'local') try { localSender(caller) } catch { throw new Error('Terminal window is closed') }
  if (!manager) throw new Error('session not found')
  return getTerminals().open(id, manager.getCwd(id), caller.owner, cols, rows)
})
api.handle('terminal:attach', (caller, id: string, terminalId: string) => getTerminals().attach(id, terminalId, caller.owner))
api.handle('terminal:get', (caller, id: string) => getTerminals().get(id, caller.owner))
api.handle('terminal:close', (caller, id: string, terminalId: string) => getTerminals().close(id, terminalId, caller.owner))
for (const method of ['write', 'resize', 'ack'] as const) {
  api.on(`terminal:${method}`, (caller, id: string, terminalId: string, a: string | number, b?: number) => {
    try {
      if (method === 'write') getTerminals().write(id, terminalId, caller.owner, a as string)
      else if (method === 'resize') getTerminals().resize(id, terminalId, caller.owner, a as number, b as number)
      else getTerminals().ack(id, terminalId, caller.owner, a as number)
    } catch (error) {
      const event = { type: 'error', sessionId: id, terminalId, message: String(error) }
      if (caller.kind === 'remote') remoteHost?.sendToOwner(caller.owner, 'terminal:event', event)
      else if (!caller.sender.isDestroyed()) caller.sender.send('terminal:event', event)
    }
  })
}
api.handle('settings:get', () => getSettings().get(), localOnly)
api.handle('settings:update', (_caller, patch: Partial<AppSettings>) => {
  const settings = getSettings().update(patch)
  applyWindowTheme(settings)
  // Appearance is per computer, so remote windows on this computer follow it too.
  for (const win of liveWindows()) win.webContents.send('settings:changed', settings)
  return settings
}, localOnly)
api.handle('yolo:get', () => getYoloPolicy().snapshot())
api.handle('yolo:set', (_caller, id: string, enabled: boolean) => getYoloPolicy().setEnabled(id, enabled))
api.handle('app:home', () => os.homedir())
api.handle('pi:find', () => findPi())
api.handle('pi:set-path', (_caller, p: string) => saveManualPiPath(p))
api.handle('node:get-path', () => loadManualNodePath())
api.handle('node:set-path', (_caller, p: unknown) => saveManualNodePath(p))
api.handle('node:choose-path', async caller => {
  const owner = BrowserWindow.fromWebContents(localSender(caller))
  if (!owner || owner.isDestroyed()) throw new Error('Node.js file selection requires its owning sPi window')
  const result = await dialog.showOpenDialog(owner, { title: 'Select Node.js executable', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Node.js', extensions: ['exe'] }] } : {}) })
  return result.canceled ? null : result.filePaths[0] || null
}, localOnly)

api.handle('fs:list-dirs', async (_caller, path: string) => {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
})
api.handle('fs:list-files', async (_caller, path: string) => {
  const entries = await readdir(path, { withFileTypes: true })
  return entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    .slice(0, 200)
})

const sessionFileLocks = new Set<string>()
function fileKey(file: string): string { try { return realpathSync(file) } catch { return resolve(file) } }
function catalogChanged(change: SessionCatalogChange): void { publish('sessions:changed', change) }
function targetFile(target: SessionTarget): string {
  if (!target || typeof target !== 'object') throw new Error('Invalid session target')
  const file = target.sessionId ? manager?.sessionFile(target.sessionId) : target.path
  if (typeof file !== 'string' || !file) throw new Error('Session has no saved history file')
  return fileKey(file)
}
async function mutateSession(target: SessionTarget, action: (file: string) => Promise<void>): Promise<void> {
  const file = targetFile(target)
  if (sessionFileLocks.has(file)) throw new Error('Session file operation already in progress')
  sessionFileLocks.add(file)
  try { await action(file) } finally { sessionFileLocks.delete(file) }
}
api.handle('sessions:rename', async (caller, target: SessionTarget, value: unknown) => {
  requireAppWindow(caller)
  const name = sessionName(value)
  await mutateSession(target, async file => {
    const id = manager?.sessionForFile(file)
    if (id && manager!.sessionInTransition(id)) throw new Error('Session operation in progress')
    if (id && manager!.sessionAlive(id)) await manager!.renameSession(id, name)
    else await renameSessionFile(await checkedSessionFile(file), name)
    catalogChanged({ path: file, name })
  })
})
api.handle('sessions:generate-name', async (caller, id: string, language: unknown) => {
  requireAppWindow(caller)
  if (language !== 'zh' && language !== 'en') throw new Error('Invalid language')
  return (await getManager()).generateSessionName(id, language)
})
api.handle('sessions:delete', async (caller, target: SessionTarget) => {
  requireAppWindow(caller)
  await mutateSession(target, async file => {
    await checkedSessionFile(file)
    const remove = async () => { await checkedSessionFile(file); await shell.trashItem(file) }
    if (manager) await manager.deleteSessionFile(file, remove)
    else await remove()
    try {
      if (loadPinned().includes(file)) togglePinned(file)
      const layout = loadLayout()
      saveLayout({ ...layout, sessions: layout.sessions?.filter(session => !session.sessionPath || fileKey(session.sessionPath) !== file) })
    } catch { console.error('[sPi] History was trashed, but session shortcuts could not be updated') }
    catalogChanged({ path: file })
  })
})
api.handle('sessions:live', () => manager?.listSessions() ?? [])
api.handle('sessions:scan', (_caller, cwd: string) => scanSessions(cwd))
api.handle('sessions:scan-recent', (_caller, limit?: number) => scanRecent(limit ?? 50))
api.handle('pins:get', () => loadPinned())
api.handle('pins:toggle', (_caller, p: string) => togglePinned(p))
api.handle('layout:load', () => loadLayout(), localOnly)
api.handle('layout:save', (_caller, s: LayoutState) => saveLayout(s), localOnly)

api.handle('session:open', async (_caller, opts: { cwd: string; sessionPath?: string }) => {
  const m = await getManager()
  if (opts.sessionPath && sessionFileLocks.has(fileKey(opts.sessionPath))) throw new Error('Session file operation in progress')
  return m.open(opts.cwd, opts.sessionPath)
})
api.handle('session:close', (_caller, id: string) => { terminalManager?.closeSession(id); return manager?.close(id) })
api.handle('session:prompt', (_caller, id: string, text: string, mode: 'normal' | 'steer' | 'followUp', images?: Array<{ data: string; mimeType: string }>) =>
  manager?.sendPrompt(id, text, mode, images)
)
api.handle('session:check', async (_caller, id: string) => (await getManager()).checkSession(id))
api.handle('session:recover', async (_caller, id: string) => (await getManager()).recoverSession(id))
api.handle('session:abort', (_caller, id: string) => manager?.abort(id))
api.handle('session:get-state', (_caller, id: string) => manager?.getState(id))
api.handle('session:get-messages', (_caller, id: string) => manager?.getMessages(id))
api.handle('session:pending-ui', (_caller, id: string) => manager?.getPendingExtensionUi(id) ?? [])
api.handle('session:answer-ui', (_caller, id: string, reqId: string, payload: { value?: string; confirmed?: boolean; cancelled?: boolean }) =>
  manager?.answerExtensionUi(id, reqId, payload)
)
api.handle('session:models', (_caller, id: string) => manager?.getAvailableModels(id))
api.handle('session:thinking-levels', (_caller, id: string) => manager?.getAvailableThinkingLevels(id))
api.handle('session:set-model', (_caller, id: string, provider: string, modelId: string) =>
  manager?.setModel(id, provider, modelId)
)
api.handle('session:set-thinking', (_caller, id: string, level: string) =>
  manager?.setThinkingLevel(id, level)
)
api.handle('session:commands', (_caller, id: string) => manager?.getCommands(id))
api.handle('messages:submit', async (_caller, id: string, message: MessageSubmission) => (await getManager()).submitMessage(id, message))
api.handle('messages:get', async (_caller, id: string) => (await getManager()).getPendingMessages(id))
api.handle('messages:edit', async (_caller, id: string, messageId: string, revision: number) => (await getManager()).editPendingMessage(id, messageId, revision))
api.handle('messages:update', async (_caller, id: string, messageId: string, revision: number, text: string, images: ImageRef[]) => (await getManager()).updatePendingMessage(id, messageId, revision, text, images))
api.handle('messages:finish-edit', async (_caller, id: string, messageId: string, revision: number) => (await getManager()).finishEditingMessage(id, messageId, revision))
api.handle('messages:cancel', async (_caller, id: string, messageId: string, revision: number) => (await getManager()).cancelPendingMessage(id, messageId, revision))
api.handle('messages:resume', async (_caller, id: string) => (await getManager()).resumePendingMessages(id))

api.handle('remote:status', () => remoteStatus(), localOnly)
api.handle('remote:check-account', () => getBackend().account(), localOnly)
api.handle('remote:check-storage', () => checkRemoteStorage(), localOnly)
api.handle('remote:host-enable', async (_caller, enabled: unknown) => { await getRemoteHost().setEnabled(enabled === true); return remoteStatus() }, localOnly)
api.handle('remote:pairing-code-get', () => getRemoteHost().getPairingCode(), localOnly)
api.handle('remote:pairing-code', (_e, ttlMs: unknown) => getRemoteHost().createPairingCode(ttlMs), localOnly)
api.handle('remote:cancel-pairing', () => getRemoteHost().cancelPairing(), localOnly)
api.handle('remote:revoke', (_caller, deviceId: unknown) => { if (typeof deviceId !== 'string') throw new Error('Invalid device'); getRemoteHost().revoke(deviceId) }, localOnly)
api.handle('remote:pair', (_caller, code: unknown) => getRemoteClient().pair(code), localOnly)
api.handle('remote:connect', (_caller, hostId: unknown) => { if (typeof hostId !== 'string') throw new Error('Invalid host'); return openRemoteWindow(hostId) }, localOnly)
api.handle('remote:forget', async (_caller, hostId: unknown) => {
  if (typeof hostId !== 'string') throw new Error('Invalid host')
  for (const remote of [...remoteWindows.values()]) if (remote.hostId === hostId) remote.win.destroy()
  await getRemoteClient().forget(hostId)
}, localOnly)
api.handle('remote:window-info', () => null, localOnly)

// ---- ipcMain binding: remote windows are answered by their host, except per-computer calls ----
function localCaller(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent | undefined): Caller {
  const sender = event?.sender
  return { kind: 'local', owner: 'local:' + sender?.id, sender: sender!, mainFrame: !!sender && event!.senderFrame === sender.mainFrame }
}
async function remoteWindowInvoke(remote: RemoteWindow, event: Electron.IpcMainInvokeEvent, channel: string, args: unknown[]): Promise<unknown> {
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('Remote operation requires the application window')
  if (channel === 'remote:window-info') return remoteWindowInfo(remote)
  if (channel.startsWith('remote:')) throw new Error('Manage remote access from a local sPi window')
  if (!CLIENT_LOCAL_CHANNELS.has(channel)) return remote.connection.invoke(channel, args)
  switch (channel) {
    case 'settings:get': case 'settings:update': return api.invoke(channel, localCaller(event), args)
    case 'app:launch-request': return null
    case 'app:ack-launch': return undefined
    case 'app:quit': remote.win.close(); return true
    case 'layout:load': return getRemoteClient().loadLayout(remote.hostId)
    case 'layout:save': {
      const layout = args[0]
      if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw new Error('Invalid layout')
      return getRemoteClient().saveLayout(remote.hostId, layout as LayoutState)
    }
    default: throw new Error('File selection is unavailable in a remote window; type the path that exists on the host')
  }
}
for (const channel of api.invokeChannels) {
  ipcMain.handle(channel, (event, ...args) => {
    const remote = event?.sender && remoteWindows.get(event.sender.id)
    return remote ? remoteWindowInvoke(remote, event, channel, args) : api.invoke(channel, localCaller(event), args)
  })
}
for (const channel of api.sendChannels) {
  ipcMain.on(channel, (event, ...args) => {
    const remote = event?.sender && remoteWindows.get(event.sender.id)
    if (remote) { if (event.senderFrame === event.sender.mainFrame) remote.connection.send(channel, args); return }
    try { api.send(channel, localCaller(event), args) } catch (error) { console.error('[sPi ipc]', error) }
  })
}

app.whenReady().then(() => {
  if (!ownsInstance) return
  if (process.platform === 'darwin') app.dock?.setIcon(appIcon)
  createWindow()
  try {
    const host = getRemoteHost()
    if (host.snapshot().enabled && !checkRemoteStorage()) host.resume()
  } catch (error) { remoteLog(String(error)) }
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
