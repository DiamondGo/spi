import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi } from '../shared/types'

const api: IpcApi = {
  getLaunchRequest: () => ipcRenderer.invoke('app:launch-request'),
  acknowledgeLaunchRequest: id => ipcRenderer.invoke('app:ack-launch', id),
  onLaunchDirectory: cb => {
    const listener = () => cb()
    ipcRenderer.on('app:launch-directory', listener)
    return () => ipcRenderer.removeListener('app:launch-directory', listener)
  },
  openTerminal: (id, cols, rows) => ipcRenderer.invoke('terminal:open', id, cols, rows),
  attachTerminal: (id, terminalId) => ipcRenderer.invoke('terminal:attach', id, terminalId),
  getTerminal: id => ipcRenderer.invoke('terminal:get', id),
  writeTerminal: (id, terminalId, data) => ipcRenderer.send('terminal:write', id, terminalId, data),
  resizeTerminal: (id, terminalId, cols, rows) => ipcRenderer.send('terminal:resize', id, terminalId, cols, rows),
  acknowledgeTerminal: (id, terminalId, seq) => ipcRenderer.send('terminal:ack', id, terminalId, seq),
  closeTerminal: (id, terminalId) => ipcRenderer.invoke('terminal:close', id, terminalId),
  onTerminalEvent: cb => {
    const listener = (_e: unknown, event: unknown) => cb(event as never)
    ipcRenderer.on('terminal:event', listener)
    return () => ipcRenderer.removeListener('terminal:event', listener)
  },
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  updateAppSettings: patch => ipcRenderer.invoke('settings:update', patch),
  onAppSettingsChanged: cb => {
    const listener = (_e: unknown, settings: unknown) => cb(settings as never)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  getPermissions: () => ipcRenderer.invoke('permissions:get'),
  setPermissionMode: (id, mode) => ipcRenderer.invoke('permissions:mode', id, mode),
  setDefaultPermissionMode: mode => ipcRenderer.invoke('permissions:default', mode),
  answerPermission: (id, reqId, decision) => ipcRenderer.invoke('permissions:answer', id, reqId, decision),
  clearSessionPermissions: id => ipcRenderer.invoke('permissions:clear', id),
  addPermissionRule: (cwd, command) => ipcRenderer.invoke('permissions:add-rule', cwd, command),
  removePermissionRule: id => ipcRenderer.invoke('permissions:remove-rule', id),
  onPermissionsChanged: cb => {
    const listener = (_e: unknown, state: unknown) => cb(state as never)
    ipcRenderer.on('permissions:changed', listener)
    return () => ipcRenderer.removeListener('permissions:changed', listener)
  },
  getHome: () => ipcRenderer.invoke('app:home'),
  findPi: () => ipcRenderer.invoke('pi:find'),
  setPiPath: (p) => ipcRenderer.invoke('pi:set-path', p),
  listDirs: (path) => ipcRenderer.invoke('fs:list-dirs', path),
  scanSessions: (cwd) => ipcRenderer.invoke('sessions:scan', cwd),
  scanRecent: (limit) => ipcRenderer.invoke('sessions:scan-recent', limit),
  getPinned: () => ipcRenderer.invoke('pins:get'),
  togglePin: (p) => ipcRenderer.invoke('pins:toggle', p),
  loadLayout: () => ipcRenderer.invoke('layout:load'),
  saveLayout: (s) => ipcRenderer.invoke('layout:save', s),
  listFiles: (path) => ipcRenderer.invoke('fs:list-files', path),
  getCommands: (id) => ipcRenderer.invoke('session:commands', id),
  openSession: (opts) => ipcRenderer.invoke('session:open', opts),
  closeSession: (id) => ipcRenderer.invoke('session:close', id),
  sendPrompt: (id, text, mode, images) => ipcRenderer.invoke('session:prompt', id, text, mode, images),
  abortSession: (id) => ipcRenderer.invoke('session:abort', id),
  getState: (id) => ipcRenderer.invoke('session:get-state', id),
  getMessages: (id) => ipcRenderer.invoke('session:get-messages', id),
  answerExtensionUi: (id, reqId, payload) => ipcRenderer.invoke('session:answer-ui', id, reqId, payload),
  getAvailableModels: (id) => ipcRenderer.invoke('session:models', id),
  getAvailableThinkingLevels: (id) => ipcRenderer.invoke('session:thinking-levels', id),
  setModel: (id, provider, modelId) => ipcRenderer.invoke('session:set-model', id, provider, modelId),
  setThinkingLevel: (id, level) => ipcRenderer.invoke('session:set-thinking', id, level),
  onPiEvent: (cb) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload as never)
    ipcRenderer.on('pi:event', listener)
    return () => ipcRenderer.removeListener('pi:event', listener)
  },
  onSessionClosed: (cb) => {
    const listener = (_e: unknown, id: string) => cb(id)
    ipcRenderer.on('session:closed', listener)
    return () => ipcRenderer.removeListener('session:closed', listener)
  }
}

contextBridge.exposeInMainWorld('spi', api)
