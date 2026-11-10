// 主进程 / preload / 渲染进程共用的类型

export interface PiModel {
  id: string
  name: string
  api: string
  provider: string
  baseUrl?: string
  reasoning: boolean
  input: string[]
  contextWindow?: number
  maxTokens?: number
  cost?: Record<string, number>
}

export interface PiState {
  model?: PiModel
  thinkingLevel?: string
  isStreaming: boolean
  isCompacting?: boolean
  sessionFile?: string
  sessionId?: string
  sessionName?: string
  messageCount?: number
  pendingMessageCount?: number
}

export interface SessionMeta {
  path: string
  id: string
  cwd: string
  createdAt: string
  mtime: number
  name?: string
  title?: string
}

// pi 的原始 JSONL 记录（事件或响应）
export type PiRecord = { type: string; [key: string]: unknown }

export interface PiEventPayload {
  sessionId: string
  event: PiRecord
}

export interface ImageRef {
  data: string // base64
  mimeType: string
}

export interface PiQueue {
  steering: string[]
  followUp: string[]
}

export interface LayoutState {
  viewMode?: string
  selectedDir?: string | null
  sessions?: Array<{ cwd: string; sessionPath?: string }>
}

export type PermissionMode = 'ask' | 'remember' | 'allowlist' | 'all'
export type SafePermissionMode = Exclude<PermissionMode, 'all'>
export type PermissionDecision = 'deny' | 'once' | 'session' | 'whitelist' | 'all'

export interface PermissionRule {
  id: string
  cwd: string
  tool: string
  input: Record<string, unknown>
}
export interface PermissionRequest extends PermissionRule {
  sessionId: string
}
export interface PermissionSnapshot {
  defaultMode: SafePermissionMode
  rules: PermissionRule[]
  sessions: Record<string, { mode: PermissionMode; remembered: number; ready: boolean }>
  pending: PermissionRequest[]
}

export type AppTheme = 'dark' | 'light' | 'high-contrast'
export type AppLanguage = 'en' | 'zh'
export interface AppSettings {
  theme: AppTheme
  language: AppLanguage
  confirmOnExit: boolean
}

export interface TerminalInfo {
  sessionId: string
  terminalId: string
  cwd: string
  shell: string
  pid: number
  cols: number
  rows: number
}
export interface TerminalSnapshot extends TerminalInfo { history: string; seq: number }
export type TerminalEvent =
  | { type: 'data'; sessionId: string; terminalId: string; seq: number; data: string }
  | { type: 'exit'; sessionId: string; terminalId: string; exitCode?: number; reason: 'exit' | 'closed' }
  | { type: 'error'; sessionId: string; terminalId: string; message: string }

// 渲染进程可调用的 API（preload 暴露）
export interface IpcApi {
  getLaunchRequest(): Promise<{ id: string; cwd: string } | null>
  acknowledgeLaunchRequest(id: string): Promise<void>
  onLaunchDirectory(cb: () => void): () => void
  openTerminal(sessionId: string, cols: number, rows: number): Promise<TerminalInfo>
  attachTerminal(sessionId: string, terminalId: string): Promise<TerminalSnapshot>
  getTerminal(sessionId: string): Promise<TerminalSnapshot | null>
  writeTerminal(sessionId: string, terminalId: string, data: string): void
  resizeTerminal(sessionId: string, terminalId: string, cols: number, rows: number): void
  acknowledgeTerminal(sessionId: string, terminalId: string, seq: number): void
  closeTerminal(sessionId: string, terminalId: string): Promise<void>
  onTerminalEvent(cb: (event: TerminalEvent) => void): () => void
  getAppSettings(): Promise<AppSettings>
  updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  quitApp(): Promise<boolean>
  onAppSettingsChanged(cb: (settings: AppSettings) => void): () => void
  getPermissions(): Promise<PermissionSnapshot>
  setPermissionMode(id: string, mode: PermissionMode): Promise<void>
  setDefaultPermissionMode(mode: SafePermissionMode): Promise<void>
  answerPermission(id: string, requestId: string, decision: PermissionDecision): Promise<void>
  clearSessionPermissions(id: string): Promise<void>
  addPermissionRule(cwd: string, command: string): Promise<void>
  removePermissionRule(id: string): Promise<void>
  onPermissionsChanged(cb: (state: PermissionSnapshot) => void): () => void
  getHome(): Promise<string>
  findPi(): Promise<string | null>
  setPiPath(p: string): Promise<void>
  listDirs(path: string): Promise<string[]>
  scanSessions(cwd: string): Promise<SessionMeta[]>
  scanRecent(limit?: number): Promise<SessionMeta[]>
  getPinned(): Promise<string[]>
  togglePin(p: string): Promise<string[]>
  loadLayout(): Promise<LayoutState>
  saveLayout(s: LayoutState): Promise<void>
  listFiles(path: string): Promise<Array<{ name: string; isDir: boolean }>>
  getCommands(sessionId: string): Promise<Array<{ name: string; description?: string; source: string }>>
  openSession(opts: { cwd: string; sessionPath?: string }): Promise<{ sessionId: string; state: PiState }>
  closeSession(sessionId: string): Promise<void>
  sendPrompt(sessionId: string, text: string, mode: 'normal' | 'steer' | 'followUp', images?: ImageRef[]): Promise<void>
  abortSession(sessionId: string): Promise<PiQueue>
  getState(sessionId: string): Promise<PiState>
  getMessages(sessionId: string): Promise<unknown[]>
  answerExtensionUi(sessionId: string, id: string, payload: { value?: string; confirmed?: boolean; cancelled?: boolean }): Promise<void>
  getAvailableModels(sessionId: string): Promise<PiModel[]>
  getAvailableThinkingLevels(sessionId: string): Promise<string[]>
  setModel(sessionId: string, provider: string, modelId: string): Promise<void>
  setThinkingLevel(sessionId: string, level: string): Promise<void>
  onPiEvent(cb: (e: PiEventPayload) => void): () => void
  onSessionClosed(cb: (sessionId: string) => void): () => void
}
