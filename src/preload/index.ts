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
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onAppSettingsChanged: cb => {
    const listener = (_e: unknown, settings: unknown) => cb(settings as never)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  getYoloState: () => ipcRenderer.invoke('yolo:get'),
  setYolo: (id, enabled) => ipcRenderer.invoke('yolo:set', id, enabled),
  onYoloChanged: cb => {
    const listener = (_e: unknown, state: unknown) => cb(state as never)
    ipcRenderer.on('yolo:changed', listener)
    return () => ipcRenderer.removeListener('yolo:changed', listener)
  },
  getHome: () => ipcRenderer.invoke('app:home'),
  findPi: () => ipcRenderer.invoke('pi:find'),
  setPiPath: (p) => ipcRenderer.invoke('pi:set-path', p),
  getNodePath: () => ipcRenderer.invoke('node:get-path'),
  setNodePath: p => ipcRenderer.invoke('node:set-path', p),
  chooseNodePath: () => ipcRenderer.invoke('node:choose-path'),
  listDirs: (path) => ipcRenderer.invoke('fs:list-dirs', path),
  scanSessions: (cwd) => ipcRenderer.invoke('sessions:scan', cwd),
  scanRecent: (limit) => ipcRenderer.invoke('sessions:scan-recent', limit),
  renameSession: (target, name) => ipcRenderer.invoke('sessions:rename', target, name),
  generateSessionName: (id, language) => ipcRenderer.invoke('sessions:generate-name', id, language),
  deleteSession: target => ipcRenderer.invoke('sessions:delete', target),
  onSessionsChanged: cb => {
    const listener = (_event: unknown, change: unknown) => cb(change as never)
    ipcRenderer.on('sessions:changed', listener)
    return () => ipcRenderer.removeListener('sessions:changed', listener)
  },
  getPinned: () => ipcRenderer.invoke('pins:get'),
  togglePin: (p) => ipcRenderer.invoke('pins:toggle', p),
  loadLayout: () => ipcRenderer.invoke('layout:load'),
  saveLayout: (s) => ipcRenderer.invoke('layout:save', s),
  listFiles: (path) => ipcRenderer.invoke('fs:list-files', path),
  getCommands: (id) => ipcRenderer.invoke('session:commands', id),
  openSession: (opts) => ipcRenderer.invoke('session:open', opts),
  closeSession: (id) => ipcRenderer.invoke('session:close', id),
  checkSession: id => ipcRenderer.invoke('session:check', id),
  recoverSession: id => ipcRenderer.invoke('session:recover', id),
  sendPrompt: (id, text, mode, images) => ipcRenderer.invoke('session:prompt', id, text, mode, images),
  submitMessage: (id, message) => ipcRenderer.invoke('messages:submit', id, message),
  getPendingMessages: id => ipcRenderer.invoke('messages:get', id),
  editPendingMessage: (id, messageId, revision) => ipcRenderer.invoke('messages:edit', id, messageId, revision),
  updatePendingMessage: (id, messageId, revision, text, images) => ipcRenderer.invoke('messages:update', id, messageId, revision, text, images),
  finishEditingMessage: (id, messageId, revision) => ipcRenderer.invoke('messages:finish-edit', id, messageId, revision),
  cancelPendingMessage: (id, messageId, revision) => ipcRenderer.invoke('messages:cancel', id, messageId, revision),
  resumePendingMessages: id => ipcRenderer.invoke('messages:resume', id),
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
  },
  getPendingDialogs: id => ipcRenderer.invoke('session:pending-ui', id),
  getRemoteStatus: () => ipcRenderer.invoke('remote:status'),
  checkRemoteAccount: () => ipcRenderer.invoke('remote:check-account'),
  checkRemoteStorage: () => ipcRenderer.invoke('remote:check-storage'),
  setRemoteHostEnabled: enabled => ipcRenderer.invoke('remote:host-enable', enabled),
  createPairingCode: (ttlMs?: number) => ipcRenderer.invoke('remote:pairing-code', ttlMs),
  getPairingCode: () => ipcRenderer.invoke('remote:pairing-code-get'),
  listLiveSessions: () => ipcRenderer.invoke('sessions:live'),
  cancelPairingCode: () => ipcRenderer.invoke('remote:cancel-pairing'),
  revokeRemoteDevice: id => ipcRenderer.invoke('remote:revoke', id),
  pairRemoteHost: code => ipcRenderer.invoke('remote:pair', code),
  connectRemoteHost: id => ipcRenderer.invoke('remote:connect', id),
  forgetRemoteHost: id => ipcRenderer.invoke('remote:forget', id),
  onRemoteStatusChanged: cb => {
    const listener = (_e: unknown, status: unknown) => cb(status as never)
    ipcRenderer.on('remote:changed', listener)
    return () => ipcRenderer.removeListener('remote:changed', listener)
  },
  getRemoteWindow: () => ipcRenderer.invoke('remote:window-info'),
  onRemoteWindowChanged: cb => {
    const listener = (_e: unknown, info: unknown) => cb(info as never)
    ipcRenderer.on('remote:window-changed', listener)
    return () => ipcRenderer.removeListener('remote:window-changed', listener)
  }
}

contextBridge.exposeInMainWorld('spi', api)
