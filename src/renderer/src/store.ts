import { useSyncExternalStore } from 'react'
import type { ImageRef, PendingMessagesSnapshot, PiState, SessionHealth, SessionCatalogChange } from '../../shared/types'
import type { TextParams } from '../../shared/i18n'
import { isSessionProgressEvent } from '../../shared/sessionHealth'

// ---- 展示项 ----

export type Block =
  | { kind: 'thinking'; text: string; done: boolean }
  | { kind: 'text'; text: string; done: boolean }
  | { kind: 'toolCall'; id: string; name: string; argsText: string; done: boolean }

export type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; blocks: Block[]; done: boolean }
  | {
      kind: 'tool'
      id: string
      name: string
      args: Record<string, unknown>
      state: 'running' | 'done'
      output: string
      isError: boolean
      durationMs?: number
    }
  | { kind: 'status'; text: string; params?: TextParams }
  | {
      kind: 'dialog'
      reqId: string
      method: string
      title?: string
      message?: string
      options?: string[]
      placeholder?: string
      prefill?: string
      answered: boolean
      result?: string
      approvalTool?: string
      approvalAdapter?: string
      resolution?: 'auto-allow' | 'manual' | 'cancelled' | 'expired' | 'failed'
    }
  | { kind: 'raw'; json: string }

export type SendMode = 'normal' | 'steer' | 'followUp'

export interface SessionUI {
  id: string
  cwd: string
  state: PiState | null
  items: Item[]
  streaming: boolean
  openedAt: number
  pendingQueue: PendingMessagesSnapshot
  submitting: boolean
  draft: string
  draftRevision: number
  sendMode: SendMode
  pendingImages: ImageRef[]
  error?: string
  errorKind?: 'model'
  healthError?: string
  health?: SessionHealth
}

interface Store {
  catalogRevision: number
  sessions: Record<string, SessionUI>
  activeId: string | null
  piPath: string | null
}

// ---- store 基础设施 ----

let store: Store = { catalogRevision: 0, sessions: {}, activeId: null, piPath: null }
const listeners = new Set<() => void>()

function setStore(patch: Partial<Store>): void {
  store = { ...store, ...patch }
  listeners.forEach((l) => l())
}

export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getStore(): Store {
  return store
}

export function useStore(): Store {
  return useSyncExternalStore(subscribe, getStore)
}

function patchSession(id: string, fn: (s: SessionUI) => SessionUI): void {
  const s = store.sessions[id]
  if (!s) return
  setStore({ sessions: { ...store.sessions, [id]: fn(s) } })
}

// ---- 会话生命周期 ----

export function addSession(id: string, cwd: string, state: PiState): boolean {
  // Reusing a backend session must never reset its draft, output, images or running state.
  if (store.sessions[id]) {
    setActive(id)
    return false
  }
  setStore({
    sessions: {
      ...store.sessions,
      [id]: { id, cwd, state, items: [], streaming: state.isStreaming, openedAt: Date.now(), pendingQueue: { sessionId: id, version: 0, paused: false, items: [] }, submitting: false, draft: '', draftRevision: 0, sendMode: 'normal', pendingImages: [] }
    },
    activeId: id
  })
  return true
}

const openingSessions = new Map<string, Promise<string>>()

/** Shared by directory/recent clicks and layout restore, including their initial history load. */
export function openSession(cwd: string, sessionPath?: string): Promise<string> {
  if (sessionPath) {
    const existing = Object.values(store.sessions).find(s => s.state?.sessionFile === sessionPath)
    if (existing) {
      setActive(existing.id)
      return Promise.resolve(existing.id)
    }
    const pending = openingSessions.get(sessionPath)
    if (pending) return pending.then(id => {
      if (!store.sessions[id]) return openSession(cwd, sessionPath)
      setActive(id)
      return id
    })
  }
  const request = (async () => {
    const { sessionId, state } = await window.spi.openSession({ cwd, sessionPath })
    if (addSession(sessionId, cwd, state)) {
      try { loadHistory(sessionId, messagesToItems(await window.spi.getMessages(sessionId))) } catch {}
      if (window.spi.getPendingMessages) { try { updatePendingMessages(await window.spi.getPendingMessages(sessionId)) } catch {} }
    }
    return sessionId
  })()
  if (!sessionPath) return request
  const shared = request.finally(() => {
    if (openingSessions.get(sessionPath) === shared) openingSessions.delete(sessionPath)
  })
  openingSessions.set(sessionPath, shared)
  return shared
}

/**
 * After a remote window reconnects it may have missed events: reload each session from the host.
 * Sessions the host no longer knows (it restarted) are reopened from their saved history under a
 * new ID, keeping the draft. Returns the IDs that were replaced so callers can drop their terminals.
 */
let resyncing: Promise<string[]> | null = null
let queuedResync: Promise<string[]> | null = null
const DISCONNECTED = /Not connected to the remote host|connection to the remote host was lost|no longer accepts this device/
export function resyncSessions(): Promise<string[]> {
  // A reconnect during a resync needs one more pass afterwards, not one per event.
  if (resyncing) return queuedResync ??= resyncing.then(() => { queuedResync = null; return resyncSessions() })
  const request = (async () => {
    const replaced: string[] = []
    for (const s of Object.values(store.sessions)) {
      try {
        const state = await window.spi.getState(s.id)
        if (!state) throw new Error('session not found')
        const [messages, pending, dialogs] = await Promise.all([window.spi.getMessages(s.id), window.spi.getPendingMessages(s.id), window.spi.getPendingDialogs(s.id)])
        const items = messagesToItems(messages)
        patchSession(s.id, cur => ({ ...cur, state, streaming: state.isStreaming, pendingQueue: pending, items: state.isStreaming ? items : items.map(it => it.kind === 'assistant' ? { ...it, done: true, blocks: it.blocks.map(b => ({ ...b, done: true })) } : it) }))
        for (const dialog of dialogs) applyEvent(s.id, dialog)
      } catch (error) {
        // Losing the link again is not "the host forgot this session"; the next reconnect resyncs.
        if (DISCONNECTED.test(String(error))) break
        if (!store.sessions[s.id]) continue
        replaced.push(s.id)
        removeSession(s.id)
        const file = s.state?.sessionFile
        if (!file) continue
        try {
          const id = await openSession(s.cwd, file)
          patchSession(id, cur => cur.draft || cur.pendingImages.length ? cur : { ...cur, draft: s.draft, draftRevision: cur.draftRevision + 1, pendingImages: s.pendingImages, sendMode: s.sendMode })
        } catch {}
      }
    }
    return replaced
  })()
  resyncing = request
  const clear = () => { if (resyncing === request) resyncing = null }
  request.then(clear, clear)
  return request
}

const openingDirectories = new Map<string, Promise<string>>()
export function openDirectory(cwd: string): Promise<string> {
  const existing = Object.values(store.sessions).find(s => s.cwd === cwd && s.id === store.activeId)
    ?? Object.values(store.sessions).find(s => s.cwd === cwd)
  if (existing) { setActive(existing.id); return Promise.resolve(existing.id) }
  const pending = openingDirectories.get(cwd)
  if (pending) return pending
  const request = openSession(cwd).finally(() => { if (openingDirectories.get(cwd) === request) openingDirectories.delete(cwd) })
  openingDirectories.set(cwd, request)
  return request
}

export function removeSession(id: string): void {
  submissions.delete(id); nonces.delete(id)
  const sessions = { ...store.sessions }
  delete sessions[id]
  setStore({ sessions, activeId: store.activeId === id ? null : store.activeId })
}

export function refreshSessionCatalog(change: SessionCatalogChange = {}): void {
  const sessions = { ...store.sessions }
  if (change.name !== undefined && change.path) for (const [id, session] of Object.entries(sessions)) {
    if (session.state?.sessionFile === change.path) sessions[id] = { ...session, state: { ...session.state, sessionName: change.name } }
  }
  setStore({ sessions, catalogRevision: store.catalogRevision + 1 })
}

export function setActive(id: string | null): void {
  setStore({ activeId: id })
}

const submissions = new Map<string, Promise<void>>()
const nonces = new Map<string, { text: string; images: ImageRef[]; priority: boolean; id: string; body: string }>()
export function updatePendingMessages(snapshot: PendingMessagesSnapshot): void {
  patchSession(snapshot.sessionId, s => snapshot.version < s.pendingQueue.version ? s : { ...s, pendingQueue: snapshot })
}
export function submitDraft(id: string, imageLabel: string): Promise<void> {
  const pending = submissions.get(id)
  if (pending) return pending
  const session = store.sessions[id]
  if (!session || (!session.draft.trim() && !session.pendingImages.length)) return Promise.resolve()
  if (session.health && session.health.status !== 'healthy') return Promise.reject(new Error('Session unavailable; check or recover it first'))
  const draftRevision = session.draftRevision
  const text = session.draft, images = session.pendingImages, priority = session.sendMode === 'steer'
  const previous = nonces.get(id)
  const reuse = previous && previous.text === text && previous.images === images && previous.priority === priority
  const nonce = reuse ? previous.id : crypto.randomUUID()
  const body = reuse ? previous.body : text.trim() || imageLabel
  nonces.set(id, { text, images, priority, id: nonce, body })
  patchSession(id, s => ({ ...s, submitting: true, error: undefined, errorKind: undefined }))
  const request = (async () => window.spi.submitMessage(id, { clientId: nonce, text: body, images, priority }))().then(() => {
    const sent = new Set(images)
    patchSession(id, s => ({ ...s, draft: s.draftRevision === draftRevision ? '' : s.draft, draftRevision: s.draftRevision + 1, pendingImages: s.pendingImages.filter(image => !sent.has(image)) }))
    nonces.delete(id)
  }).catch(error => { setSessionError(id, String(error)); throw error }).finally(() => {
    submissions.delete(id); patchSession(id, s => ({ ...s, submitting: false }))
  })
  submissions.set(id, request)
  return request
}

export function setDraft(id: string, draft: string): void {
  patchSession(id, (s) => ({ ...s, draft, draftRevision: s.draftRevision + 1 }))
}

export function setPiPath(p: string | null): void {
  setStore({ piPath: p })
}

export function setSessionState(id: string, state: PiState): void {
  patchSession(id, (s) => ({ ...s, state }))
}

export function restoreQueuedMessages(id: string, messages: string[]): void {
  if (!messages.length) return
  // Read the latest draft, not the snapshot captured when abort was requested.
  patchSession(id, (s) => ({ ...s, draft: [s.draft, ...messages].filter(Boolean).join('\n\n'), draftRevision: s.draftRevision + 1 }))
}

export function setSendMode(id: string, sendMode: SendMode): void {
  patchSession(id, (s) => ({ ...s, sendMode }))
}

export function setPendingImages(id: string, update: ImageRef[] | ((images: ImageRef[]) => ImageRef[])): void {
  patchSession(id, (s) => ({ ...s, pendingImages: typeof update === 'function' ? update(s.pendingImages) : update }))
}

const recoveries = new Map<string, Promise<void>>()
export function recoverSession(id: string): Promise<void> {
  const pending = recoveries.get(id)
  if (pending) return pending
  setSessionHealthError(id, undefined)
  const request = window.spi.recoverSession(id).then(() => {
    // The backend publishes history + state in one ordered event; do not overwrite newer events with an IPC reply.
    nonces.delete(id)
    setSessionError(id, undefined)
  }).catch(error => { setSessionHealthError(id, String(error)); throw error }).finally(() => { recoveries.delete(id) })
  recoveries.set(id, request)
  return request
}

export function setSessionError(id: string, error: string | undefined, errorKind?: 'model'): void {
  patchSession(id, (s) => ({ ...s, error, errorKind: error ? errorKind : undefined }))
}

export function setSessionHealthError(id: string, healthError: string | undefined): void {
  patchSession(id, s => ({ ...s, healthError }))
}

export function setStreaming(id: string, streaming: boolean): void {
  patchSession(id, (s) => ({ ...s, streaming }))
}

export function loadHistory(id: string, items: Item[]): void {
  patchSession(id, (s) => ({ ...s, items }))
}

// ---- 历史消息 → 展示项 ----

interface AgentMsg {
  role: string
  stopReason?: string
  errorMessage?: string
  content?: unknown
  toolName?: string
  toolCallId?: string
  isError?: boolean
  usage?: unknown
}

export function messagesToItems(messages: unknown[]): Item[] {
  const items: Item[] = []
  for (const m of messages) {
    const msg = m as AgentMsg
    switch (msg.role) {
      case 'user': {
        const text = extractText(msg.content)
        if (text) items.push({ kind: 'user', text })
        break
      }
      case 'assistant': {
        const blocks: Block[] = []
        const content = Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : []
        for (const c of content) {
          if (c.type === 'thinking') {
            blocks.push({ kind: 'thinking', text: String(c.thinking ?? c.text ?? ''), done: true })
          } else if (c.type === 'text') {
            blocks.push({ kind: 'text', text: String(c.text ?? ''), done: true })
          } else if (c.type === 'toolCall') {
            blocks.push({
              kind: 'toolCall',
              id: String(c.id ?? ''),
              name: String(c.name ?? ''),
              argsText: JSON.stringify(c.arguments ?? {}, null, 2),
              done: true
            })
          }
        }
        if (blocks.length) items.push({ kind: 'assistant', blocks, done: true })
        break
      }
      case 'toolResult': {
        items.push({
          kind: 'tool',
          id: String(msg.toolCallId ?? ''),
          name: String(msg.toolName ?? ''),
          args: {},
          state: 'done',
          output: extractText(msg.content),
          isError: Boolean(msg.isError)
        })
        break
      }
      default:
        break // system 等跳过
    }
  }
  return items
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

// ---- 实时事件 → 展示项 ----

interface StreamEvent {
  type: string
  contentIndex?: number
  delta?: string
  content?: string
  id?: string
  toolName?: string
  toolCall?: { id?: string; name?: string; arguments?: unknown }
}

export function applyEvent(id: string, event: Record<string, unknown>): void {
  const t = event.type
  const current = store.sessions[id]
  if (current && isSessionProgressEvent(event) && (!current.health || current.health.status === 'healthy')) {
    const delta = event.assistantMessageEvent as StreamEvent | undefined
    const message = event.message as AgentMsg | undefined
    const modelResponded = (t === 'message_update' && ['text_delta', 'text_end', 'thinking_delta', 'thinking_end', 'toolcall_start', 'toolcall_delta', 'toolcall_end'].includes(String(delta?.type)))
      || t === 'tool_execution_start' || (t === 'auto_retry_end' && event.success === true)
      || (t === 'message_end' && message?.role === 'assistant' && ['stop', 'toolUse', 'length'].includes(String(message.stopReason)))
    const heal = current.health?.stalled
    const clearModelError = current.errorKind === 'model' && modelResponded
    if (heal || current.healthError || clearModelError) patchSession(id, s => ({
      ...s, health: heal ? { status: 'healthy', checkedAt: Date.now() } : s.health, healthError: undefined,
      ...(clearModelError ? { error: undefined, errorKind: undefined } : {})
    }))
  }

  if (t === 'spi_session_health') {
    const health = event.health as SessionHealth
    const state = event.state as PiState | undefined
    const messages = event.messages as unknown[] | undefined
    patchSession(id, s => {
      const resync = !!messages && (s.streaming || (s.health && s.health.status !== 'healthy'))
      const items = resync ? messagesToItems(messages!) : s.items
      return {
        ...s, health, healthError: health.status === 'healthy' ? undefined : s.healthError, state: state ?? s.state,
        streaming: state ? state.isStreaming : health.status === 'exited' || health.status === 'recovering' ? false : s.streaming,
        items: (state && !state.isStreaming) || health.status === 'exited' || health.status === 'recovering'
          ? items.map(it => it.kind === 'assistant' ? { ...it, done: true, blocks: it.blocks.map(b => ({ ...b, done: true })) } : it) : items
      }
    })
    return
  }
  if (t === 'spi_pending_messages') {
    updatePendingMessages(event as unknown as PendingMessagesSnapshot)
    return
  }
  if (t === 'agent_start') {
    setStreaming(id, true)
    return
  }
  if (t === 'agent_settled') {
    patchSession(id, (s) => ({
      ...s,
      streaming: false,
      items: s.items.map((it) => (it.kind === 'assistant' ? { ...it, done: true } : it))
    }))
    return
  }
  // 结构性事件，无需展示
  if (t === 'turn_start' || t === 'turn_end' || t === 'agent_end') return
  if (t === 'message_start' || t === 'message_end') {
    const msg = event.message as AgentMsg | undefined
    if (!msg) return
    if (t === 'message_end' && msg.role === 'assistant' && msg.stopReason === 'error') {
      setSessionError(id, msg.errorMessage || 'Model request failed; check the network and try again', 'model')
    }
    if (msg.role === 'user' && t === 'message_start') {
      const text = extractText(msg.content)
      if (text) patchSession(id, (s) => ({ ...s, items: [...s.items, { kind: 'user', text }] }))
    } else if (msg.role === 'assistant' && t === 'message_start') {
      patchSession(id, (s) => ({
        ...s,
        items: [...s.items, { kind: 'assistant', blocks: [], done: false }]
      }))
    }
    // toolResult / system / message_end 不单独建项（工具卡片走 tool_execution_*）
    return
  }
  if (t === 'message_update') {
    const ev = event.assistantMessageEvent as StreamEvent | undefined
    if (!ev) return
    patchSession(id, (s) => {
      const items = [...s.items]
      const ai = items.length - 1
      const item = items[ai]
      if (!item || item.kind !== 'assistant') return s
      const blocks = [...item.blocks]
      const last = blocks[blocks.length - 1]

      switch (ev.type) {
        case 'thinking_start':
          blocks.push({ kind: 'thinking', text: '', done: false })
          break
        case 'thinking_delta':
          if (last?.kind === 'thinking') blocks[blocks.length - 1] = { ...last, text: last.text + (ev.delta ?? '') }
          else blocks.push({ kind: 'thinking', text: ev.delta ?? '', done: false })
          break
        case 'thinking_end':
          if (last?.kind === 'thinking') blocks[blocks.length - 1] = { kind: 'thinking', text: ev.content ?? last.text, done: true }
          break
        case 'text_start':
          blocks.push({ kind: 'text', text: '', done: false })
          break
        case 'text_delta':
          if (last?.kind === 'text') blocks[blocks.length - 1] = { ...last, text: last.text + (ev.delta ?? '') }
          else blocks.push({ kind: 'text', text: ev.delta ?? '', done: false })
          break
        case 'text_end':
          if (last?.kind === 'text') blocks[blocks.length - 1] = { kind: 'text', text: ev.content ?? last.text, done: true }
          break
        case 'toolcall_start':
          blocks.push({ kind: 'toolCall', id: ev.id ?? '', name: ev.toolName ?? '', argsText: '', done: false })
          break
        case 'toolcall_delta':
          if (last?.kind === 'toolCall') blocks[blocks.length - 1] = { ...last, argsText: last.argsText + (ev.delta ?? '') }
          break
        case 'toolcall_end':
          if (last?.kind === 'toolCall')
            blocks[blocks.length - 1] = {
              ...last,
              argsText: JSON.stringify(ev.toolCall?.arguments ?? {}, null, 2),
              done: true
            }
          break
        default:
          break
      }
      items[ai] = { ...item, blocks }
      return { ...s, items }
    })
    return
  }
  if (t === 'tool_execution_start') {
    patchSession(id, (s) => ({
      ...s,
      items: [
        ...s.items,
        {
          kind: 'tool',
          id: String(event.toolCallId ?? ''),
          name: String(event.toolName ?? ''),
          args: (event.args as Record<string, unknown>) ?? {},
          state: 'running',
          output: '',
          isError: false
        }
      ]
    }))
    return
  }
  if (t === 'tool_execution_update' || t === 'tool_execution_end') {
    const toolCallId = String(event.toolCallId ?? '')
    patchSession(id, (s) => ({
      ...s,
      items: s.items.map((it) => {
        if (it.kind !== 'tool' || it.id !== toolCallId) return it
        const partial = event.partialResult as { content?: Array<{ type?: string; text?: string }> } | undefined
        const final = event.result as { content?: Array<{ type?: string; text?: string }> } | undefined
        const src = t === 'tool_execution_end' ? final : partial
        const output = src?.content?.map((c) => c.text ?? '').join('') ?? it.output
        return {
          ...it,
          output,
          state: t === 'tool_execution_end' ? 'done' : 'running',
          isError: Boolean(event.isError),
          durationMs: event.durationMs as number | undefined
        }
      })
    }))
    return
  }
  if (t === 'session_info_changed') {
    patchSession(id, (s) => ({
      ...s,
      state: s.state ? { ...s.state, sessionName: typeof event.name === 'string' ? event.name : undefined } : s.state
    }))
    return
  }
  if (t === 'thinking_level_changed') {
    patchSession(id, (s) => ({
      ...s,
      state: s.state ? { ...s.state, thinkingLevel: String(event.level) } : s.state
    }))
    pushStatus(id, '思考级别 → {level}', { level: String(event.level) })
    return
  }
  if (t === 'compaction_start') {
    pushStatus(id, '上下文压缩开始（{reason}）', { reason: String(event.reason) })
    return
  }
  if (t === 'compaction_end') {
    pushStatus(id, '上下文压缩结束')
    return
  }
  if (t === 'auto_retry_start') {
    pushStatus(id, '自动重试 {attempt}/{max}：{message}', { attempt: String(event.attempt), max: String(event.maxAttempts), message: String(event.errorMessage) })
    return
  }
  if (t === 'auto_retry_end') {
    pushStatus(id, event.success ? '重试成功' : '重试失败：{message}', { message: String(event.finalError ?? '') })
    return
  }
  if (t === 'queue_update') {
    const q = event as { steering?: string[]; followUp?: string[] }
    const n = (q.steering?.length ?? 0) + (q.followUp?.length ?? 0)
    pushStatus(id, n ? '队列中 {count} 条待发消息' : '消息队列已清空', { count: n })
    return
  }
  if (t === 'spi_extension_ui_result') {
    const result = event as { id: string; resolution: 'auto-allow' | 'manual' | 'cancelled' | 'expired' | 'failed'; adapter?: string; tool?: string }
    if (typeof result.id !== 'string' || !['auto-allow', 'manual', 'cancelled', 'expired', 'failed'].includes(result.resolution)) return
    patchSession(id, s => {
      const existing = s.items.find(it => it.kind === 'dialog' && it.reqId === result.id)
      if (existing?.kind === 'dialog') {
        if (existing.answered) return s
        return { ...s, items: s.items.map(it => it === existing ? { ...existing, answered: true, resolution: result.resolution } : it) }
      }
      if (result.resolution !== 'auto-allow' && result.resolution !== 'failed') return s
      return { ...s, items: [...s.items, { kind: 'dialog', reqId: result.id, method: 'select', answered: true,
        approvalTool: result.tool, approvalAdapter: result.adapter, resolution: result.resolution }] }
    })
    return
  }
  if (t === 'extension_ui_request') {
    const req = event as {
      id: string
      method: string
      title?: string
      message?: string
      options?: string[]
      placeholder?: string
      prefill?: string
      spiToolApproval?: { adapter: string; tool: string }
    }
    if (['select', 'confirm', 'input', 'editor'].includes(req.method)) {
      patchSession(id, (s) => ({
        ...s,
        items: [
          ...s.items,
          {
            kind: 'dialog',
            reqId: req.id,
            method: req.method,
            title: req.title,
            message: req.message,
            options: req.options,
            placeholder: req.placeholder,
            prefill: req.prefill,
            approvalTool: req.spiToolApproval?.tool,
            approvalAdapter: req.spiToolApproval?.adapter,
            answered: false
          }
        ]
      }))
    } else {
      // fire-and-forget：notify / setStatus 等
      const n = event as { method: string; message?: string }
      if (n.method === 'notify') pushStatus(id, '[扩展] {message}', { message: n.message ?? '' })
    }
    return
  }
  if (t === 'extension_error') {
    pushStatus(id, '[扩展错误] {message}', { message: (event as { error?: string }).error ?? '' })
    return
  }
  // 未识别事件：原始 JSON 兜底，不丢内容
  pushRaw(id, JSON.stringify(event))
}

function pushStatus(id: string, text: string, params?: TextParams): void {
  patchSession(id, (s) => ({ ...s, items: [...s.items, { kind: 'status', text, params }] }))
}

function pushRaw(id: string, json: string): void {
  patchSession(id, (s) => ({ ...s, items: [...s.items, { kind: 'raw', json }] }))
}

export function answerDialog(id: string, reqId: string, result: string): void {
  patchSession(id, (s) => ({
    ...s,
    items: s.items.map((it) => (it.kind === 'dialog' && it.reqId === reqId ? { ...it, answered: true, result } : it))
  }))
}
