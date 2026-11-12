import { randomUUID } from 'crypto'
import { existsSync, realpathSync } from 'fs'
import { resolve } from 'path'
import type { ImageRef, MessageSubmission, PiEventPayload, PiQueue, PiRecord, PiState, SessionHealth, SessionNameErrorCode } from '../../shared/types'
import { PiSession } from './piSession'
import { YoloPolicy } from './yolo'
import { ExtensionUi } from './extensionUi'
import { MessageQueue } from './messageQueue'
import { isSessionProgressEvent } from '../../shared/sessionHealth'

const namingErrors: Record<SessionNameErrorCode, string> = {
  not_ready: 'The session UI is not ready. Reopen or recover the session.',
  no_model: 'Select a model in this session before suggesting a name.',
  unsupported: 'This Pi version lacks the model/history API required for AI naming. Update Pi and reopen the session.',
  busy: 'Wait for the session to finish before suggesting a name.',
  empty_history: 'There is no user/assistant text to summarize. Start a conversation first.',
  timeout: 'The naming request timed out (model calls are limited to 30 seconds). Try again later.',
  cancelled: 'The naming request was cancelled or the session was closed.',
  auth: 'The selected model provider rejected authentication/permission. Check its credentials in Pi.',
  rate_limit: 'The selected model provider reported a rate/quota limit. Try again later.',
  context_limit: 'The selected model rejected the transcript size/context limit.',
  request_options: 'The selected model rejected the naming request parameters (reasoning/output settings). Check its Pi model compatibility configuration.',
  model_unavailable: 'The selected model or API endpoint is unavailable. Check the provider/model configuration in Pi.',
  network: 'The model request could not reach the provider. Check the network/connection settings.',
  output_limit: 'The model exhausted its output budget without a title (possibly thinking-only output). Check the model output limit.',
  empty_response: 'The model returned no usable text title.',
  provider_error: 'The selected model provider failed the naming request. Check its status or try again later.'
}

function sessionFileKey(cwd: string, file: string): string {
  const absolute = resolve(cwd, file)
  try { return realpathSync(absolute) } catch { return absolute }
}

export class PiManager {
  private sessions = new Map<string, PiSession>()
  private closing = new Set<string>()
  private suspending = new Map<string, number>()
  private sessionFiles = new Map<string, string>()
  private opening = new Map<string, Promise<{ sessionId: string; state: PiState }>>()
  private extensionUi: ExtensionUi
  private messages: MessageQueue
  private health = new Map<string, SessionHealth>()
  private activity = new Map<string, { at: number; revision: number; progress: number }>()
  private checking = new Map<string, Promise<SessionHealth>>()
  private recovering = new Map<string, Promise<{ state: PiState; messages: unknown[] }>>()
  private shuttingDown = false
  private running = new Set<string>()
  private deleting = new Set<string>()
  private naming = new Map<string, Promise<string>>()
  private titleResults = new Map<string, { session: PiSession; resolve: (name: string) => void; reject: (error: Error) => void }>()

  constructor(
    private piPath: string,
    readonly yolo: YoloPolicy,
    private extensionPath: string,
    private emitEvent: (e: PiEventPayload) => void,
    private emitClosed: (sessionId: string) => void,
    private hasUi: () => boolean = () => false,
    private nodePath: () => string | null = () => null
  ) {
    const canAnswer = (id: string) => {
      try { return this.sessions.has(id) && !this.closing.has(id) && !this.deleting.has(id) && !this.recovering.has(id) && this.health.get(id)?.status !== 'unresponsive' && this.health.get(id)?.status !== 'exited' && !this.suspending.has(id) && this.hasUi() && this.yolo.isReady(id) }
      catch { return false }
    }
    this.extensionUi = new ExtensionUi({
      canAnswer,
      canAutoAllow: id => canAnswer(id) && this.yolo.canAutoAllowExtension(id),
      send: (id, response) => {
        const stream = this.sessions.get(id)?.child.stdin
        if (!stream || stream.destroyed || stream.writableEnded || stream.writable === false) throw new Error('pi UI response stream unavailable')
        stream.write(JSON.stringify(response) + '\n')
      },
      publish: (sessionId, event) => this.emitEvent({ sessionId, event })
    })
    this.yolo.subscribe(() => this.extensionUi.refresh())
    this.messages = new MessageQueue({
      state: id => this.getState(id),
      deliver: (id, message) => {
        const session = this.sessions.get(id)
        if (!session || this.closing.has(id) || !this.uiAvailable()) throw new Error('session unavailable')
        return session.sendCommand('prompt', { message: message.text, ...(message.images.length ? { images: message.images.map(image => ({ type: 'image', ...image })) } : {}) })
      },
      changed: snapshot => this.emitEvent({ sessionId: snapshot.sessionId, event: { type: 'spi_pending_messages', ...snapshot } }),
      failed: id => { void this.checkSession(id).catch(() => {}) }
    })
  }

  private uiAvailable(): boolean { try { return this.hasUi() } catch { return false } }

  async open(cwd: string, sessionPath?: string): Promise<{ sessionId: string; state: PiState }> {
    // Only existing session files have an identity. New sessions in the same cwd stay independent.
    if (!sessionPath) return this.startSession(cwd)
    const key = sessionFileKey(cwd, sessionPath)
    const pending = this.opening.get(key)
    if (pending) return pending
    for (const [id, file] of this.sessionFiles) {
      if (file !== key) continue
      if (this.closing.has(id)) throw new Error('session is closing')
      const state = await this.getState(id)
      // An extension may have switched this pi process to another session file.
      if (this.sessionFiles.get(id) === key) return { sessionId: id, state }
      return this.open(cwd, sessionPath)
    }
    const request = this.startSession(cwd, key)
    this.opening.set(key, request)
    try { return await request }
    finally { if (this.opening.get(key) === request) this.opening.delete(key) }
  }

  private async startSession(cwd: string, sessionPath?: string, reuseId?: string): Promise<{ sessionId: string; state: PiState }> {
    if (this.shuttingDown) throw new Error('sPi is shutting down')
    // cwd 不存在时 spawn 会报 ENOENT（Node 行为），提前给出可读错误
    if (!existsSync(cwd)) throw new Error(`目录不存在: ${cwd}`)
    if (!existsSync(this.extensionPath)) throw new Error('sPi 会话扩展缺失，拒绝启动: ' + this.extensionPath)
    const id = reuseId || randomUUID()
    const token = randomUUID()
    this.yolo.open(id)
    if (!reuseId) this.messages.open(id)
    let started = false
    let retired = false
    let s: PiSession
    try { s = new PiSession(id, cwd, sessionPath, this.piPath, this.extensionPath, token, this.nodePath()) }
    catch (error) { this.yolo.close(id); if (!reuseId) this.messages.close(id); throw error }
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    const timer = setTimeout(() => rejectReady(new Error('sPi 会话扩展未就绪，拒绝启动会话')), 15000)
    s.onEvent = (e) => {
      if (retired || this.sessions.get(id) !== s || s.hasExited) return
      const prior = this.activity.get(id)
      const progress = isSessionProgressEvent(e)
      this.activity.set(id, { at: Date.now(), revision: (prior?.revision ?? 0) + 1, progress: (prior?.progress ?? 0) + (progress ? 1 : 0) })
      if (progress) this.markResponsive(id, s, true)
      if (e.type === 'extension_ui_request') {
        if (e.method === 'notify' && typeof e.message === 'string' && e.message.startsWith('spi-title-result:' + token + ':')) {
          try {
            const result = JSON.parse(e.message.slice(('spi-title-result:' + token + ':').length))
            const pending = this.titleResults.get(result.requestId)
            if (pending?.session === s) {
              if (typeof result.name === 'string' && result.name.trim() && result.name.length <= 120 && !/[\x00-\x1f\x7f]/.test(result.name)) pending.resolve(result.name.trim())
              else {
                const code = typeof result.errorCode === 'string' && Object.hasOwn(namingErrors, result.errorCode) ? result.errorCode as SessionNameErrorCode : undefined
                pending.reject(new Error(code ? `AI naming failed [${code}]: ${namingErrors[code]}` : 'AI naming failed; check the session model/network and try again'))
              }
            }
          } catch {}
          return
        }
        if (e.method === 'notify' && e.message === 'spi-permission-ready:' + token) {
          this.yolo.ready(id)
          resolveReady()
          return
        }
        if (e.method === 'select' && typeof e.title === 'string' && e.title.startsWith('spi-permission:' + token + ':')) {
          const reqId = String(e.id)
          const reply = (allow: boolean) => {
            s.child.stdin?.write(JSON.stringify({ type: 'extension_ui_response', id: reqId, value: allow ? 'allow' : 'deny' }) + '\n')
          }
          try {
            if (!this.uiAvailable() || this.closing.has(id) || this.deleting.has(id) || this.recovering.has(id) || this.health.get(id)?.status === 'unresponsive') { reply(false); return }
            const request = JSON.parse(e.title.slice(('spi-permission:' + token + ':').length))
            reply(this.yolo.allowsExecution(id, request.cwd, request.tool, request.input))
          } catch (error) {
            console.error('[sPi session bridge]', error)
            reply(false)
          }
          return
        }
      }
      if (e.type === 'agent_start') { this.running.add(id); this.yolo.begin(id); this.messages.activity(id, true) }
      if (e.type === 'agent_settled') { this.running.delete(id); this.extensionUi.cancel(id); this.messages.activity(id, false) }
      if (e.type === 'compaction_start') this.messages.block(id)
      if (e.type === 'compaction_end') this.messages.wake(id)
      // Internal approval results must never be forgeable through regular pi records.
      if (String(e.type).startsWith('spi_')) return
      if (this.extensionUi.receive(id, e)) return
      this.emitEvent({ sessionId: id, event: e })
    }
    s.onStderr = (t) => console.error(`[pi:${id.slice(0, 8)}] stderr:`, t)
    s.onExit = () => {
      rejectReady(new Error(s.failureMessage || 'Pi exited before the session became ready'))
      if (this.sessions.get(id) !== s) return
      this.extensionUi.cancel(id)
      this.extensionUi.forget(id)
      for (const pending of this.titleResults.values()) if (pending.session === s) pending.reject(new Error('Pi session exited during AI naming'))
      this.yolo.close(id)
      if ((started || reuseId) && !this.closing.has(id) && !this.shuttingDown) {
        // Keep the tab, file identity and outbox available for explicit recovery.
        this.messages.freeze(id)
        if (!this.recovering.has(id)) this.publishHealth(id, { status: 'exited', checkedAt: Date.now() })
        return
      }
      if (!reuseId) this.messages.close(id)
      this.sessions.delete(id)
      this.sessionFiles.delete(id)
      this.closing.delete(id)
      this.suspending.delete(id)
      this.health.delete(id)
      this.activity.delete(id)
      this.running.delete(id)
      if (started || reuseId) this.emitClosed(id)
    }
    this.sessions.set(id, s)
    try {
      const [state] = await Promise.all([s.sendCommand('get_state') as Promise<PiState>, ready])
      if (this.sessions.get(id) !== s || this.closing.has(id)) throw new Error('session closed while opening')
      const file = state.sessionFile || sessionPath
      if (file) this.sessionFiles.set(id, sessionFileKey(cwd, file))
      started = true
      this.activity.set(id, { at: Date.now(), revision: 0, progress: 0 })
      if (!reuseId) this.health.set(id, { status: 'healthy', checkedAt: Date.now() })
      return { sessionId: id, state }
    } catch (error) {
      retired = true
      this.closing.add(id)
      this.extensionUi.cancel(id)
      this.extensionUi.forget(id)
      if (!reuseId) this.messages.close(id)
      this.yolo.close(id)
      // Keep the failed child tracked for recovery; it must exit before another writer starts.
      if (!reuseId) {
        this.sessions.delete(id); this.sessionFiles.delete(id)
        this.health.delete(id); this.activity.delete(id); this.running.delete(id)
      }
      s.kill()
      this.closing.delete(id)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private publishHealth(id: string, health: SessionHealth, state?: PiState, messages?: unknown[]): SessionHealth {
    this.health.set(id, health)
    this.emitEvent({ sessionId: id, event: { type: 'spi_session_health', health, state, messages } })
    return health
  }

  private rpcWritable(session: PiSession): boolean {
    const input = session.child.stdin
    return !!input && !input.destroyed && !input.writableEnded && input.writable !== false
  }

  private markResponsive(id: string, session: PiSession, progressed = false): SessionHealth | undefined {
    if (this.sessions.get(id) !== session || session.hasExited || !this.rpcWritable(session) || this.closing.has(id) || this.recovering.has(id) || this.deleting.has(id) || this.shuttingDown) return
    const health = this.health.get(id)
    if (health?.status === 'unresponsive' || (health?.status === 'healthy' && health.stalled && progressed)) {
      // This only clears stale transport warnings. Never replay work, resume the outbox or release Stop/approval holds.
      return this.publishHealth(id, { status: 'healthy', checkedAt: Date.now() })
    }
  }

  /** On-demand only: explicit checks, send failures or user submissions blocked by a stale busy state. */
  checkSession(id: string): Promise<SessionHealth> {
    const pending = this.checking.get(id)
    if (pending) return pending
    const session = this.sessions.get(id)
    if (!session || this.closing.has(id) || this.shuttingDown) return Promise.reject(new Error('session unavailable'))
    if (this.recovering.has(id)) return Promise.resolve(this.health.get(id)!)
    if (session.hasExited) return Promise.resolve(this.publishHealth(id, { status: 'exited', checkedAt: Date.now() }))
    const revision = this.activity.get(id)?.revision
    const progress = this.activity.get(id)?.progress ?? 0
    const request = (async () => {
      try {
        const state = await session.sendCommand('get_state', {}, 5000) as PiState
        if (this.sessions.get(id) !== session || this.recovering.has(id) || this.closing.has(id) || this.shuttingDown) return this.health.get(id) || { status: 'exited' as const, checkedAt: Date.now() }
        if (state.sessionFile) this.sessionFiles.set(id, sessionFileKey(session.cwd, state.sessionFile))
        // Events occurring while the probe was in flight outrank its snapshot.
        if (this.activity.get(id)?.revision !== revision) return this.publishHealth(id, { status: 'healthy', checkedAt: Date.now() })
        let messages: unknown[] | undefined
        if (!state.isStreaming && !state.isCompacting && (this.running.has(id) || this.health.get(id)?.status !== 'healthy')) {
          const data = await session.sendCommand('get_messages', {}, 5000) as { messages: unknown[] }
          if (this.sessions.get(id) !== session || this.recovering.has(id) || this.closing.has(id) || this.shuttingDown || this.activity.get(id)?.revision !== revision) return this.health.get(id) || { status: 'healthy' as const, checkedAt: Date.now() }
          messages = data.messages
        }
        const stalled = (state.isStreaming || !!state.isCompacting) && Date.now() - (this.activity.get(id)?.at ?? Date.now()) > 120000
        // Publish before a queue wake can produce new events, never after it.
        const health = this.publishHealth(id, { status: 'healthy', checkedAt: Date.now(), stalled }, state, messages)
        if (!state.isStreaming && !state.isCompacting) this.running.delete(id)
        this.messages.reconcile(id, state)
        return health
      } catch {
        if (this.sessions.get(id) !== session || this.recovering.has(id) || this.closing.has(id) || this.shuttingDown) return this.health.get(id) || { status: 'exited' as const, checkedAt: Date.now() }
        // A probe issued before fresh work must not resurrect an old failure or stop a live task.
        if (!session.hasExited && this.rpcWritable(session) && (this.activity.get(id)?.progress ?? 0) !== progress) {
          return this.markResponsive(id, session, true) || this.health.get(id) || { status: 'healthy', checkedAt: Date.now() }
        }
        this.messages.freeze(id)
        if (this.yolo.isReady(id)) this.yolo.hold(id)
        this.extensionUi.cancel(id)
        return this.publishHealth(id, { status: session.hasExited ? 'exited' : 'unresponsive', checkedAt: Date.now() })
      }
    })().finally(() => { if (this.checking.get(id) === request) this.checking.delete(id) })
    this.checking.set(id, request)
    return request
  }

  /** Explicit, destructive restart. No prompt or tool is replayed automatically. */
  recoverSession(id: string): Promise<{ state: PiState; messages: unknown[] }> {
    const pending = this.recovering.get(id)
    if (pending) return pending
    const old = this.sessions.get(id)
    const file = this.sessionFiles.get(id)
    if (!old || this.closing.has(id) || this.deleting.has(id) || this.shuttingDown) return Promise.reject(new Error('session unavailable'))
    if (!file || !existsSync(file)) return Promise.reject(new Error('会话文件尚未保存或已丢失，无法安全恢复；请保留草稿后新建会话'))
    // Schedule the work after registering the lock, including synchronous exit callbacks.
    const request = Promise.resolve().then(async () => {
      this.publishHealth(id, { status: 'recovering', checkedAt: Date.now() })
      this.messages.freeze(id)
      if (this.yolo.isReady(id)) this.yolo.hold(id)
      this.extensionUi.cancel(id)
      try {
        await old.terminate()
        if (this.shuttingDown) throw new Error('sPi is shutting down')
        this.extensionUi.forget(id)
        const { state } = await this.startSession(old.cwd, file, id)
        this.running.delete(id)
        const messages = await this.getMessages(id)
        this.publishHealth(id, { status: 'healthy', checkedAt: Date.now() }, state, messages)
        return { state, messages }
      } catch (error) {
        // A failed replacement stays tracked and can be terminated on the next attempt.
        if (!this.sessions.has(id)) this.sessions.set(id, old)
        this.sessionFiles.set(id, file)
        this.publishHealth(id, { status: this.sessions.get(id)?.hasExited ? 'exited' : 'unresponsive', checkedAt: Date.now() })
        throw error
      }
    }).finally(() => { this.recovering.delete(id) })
    this.recovering.set(id, request)
    return request
  }

  async close(sessionId: string): Promise<void> {
    if (this.recovering.has(sessionId)) throw new Error('Session is recovering; please wait')
    const s = this.sessions.get(sessionId)
    if (!s) return
    this.closing.add(sessionId)
    if (s.hasExited) {
      this.sessions.delete(sessionId); this.sessionFiles.delete(sessionId)
      this.messages.close(sessionId); this.yolo.close(sessionId)
      this.health.delete(sessionId); this.activity.delete(sessionId); this.running.delete(sessionId); this.closing.delete(sessionId)
      this.emitClosed(sessionId)
      return
    }
    this.messages.close(sessionId)
    if (this.yolo.isReady(sessionId)) this.yolo.stop(sessionId)
    this.extensionUi.cancel(sessionId)
    try {
      await s.sendCommand('abort', {}, 3000)
    } catch {}
    s.close()
  }

  closeAll(): void {
    this.shuttingDown = true
    // Freeze every session before any permission observer can run during shutdown.
    for (const id of this.sessions.keys()) { this.closing.add(id); if (this.yolo.isReady(id)) this.yolo.hold(id) }
    for (const [id, s] of this.sessions) { this.messages.close(id); if (this.yolo.isReady(id)) this.yolo.stop(id); this.extensionUi.cancel(id); s.close() }
  }

  async sendPrompt(sessionId: string, text: string, mode: 'normal' | 'steer' | 'followUp', images?: Array<{ data: string; mimeType: string }>): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    if (this.recovering.has(sessionId) || this.deleting.has(sessionId) || this.health.get(sessionId)?.status !== 'healthy') throw new Error('Session unavailable; check or recover it first')
    // RPC 要求每个图片对象带 type:"image"
    const imgField = images?.length
      ? { images: images.map((im) => ({ type: 'image', data: im.data, mimeType: im.mimeType })) }
      : {}
    if (mode === 'followUp') {
      await s.sendCommand('follow_up', { message: text, ...imgField })
    } else if (mode === 'steer') {
      await s.sendCommand('prompt', { message: text, streamingBehavior: 'steer', ...imgField })
    } else {
      await s.sendCommand('prompt', { message: text, ...imgField })
    }
  }

  async abort(sessionId: string): Promise<PiQueue> {
    if (this.recovering.has(sessionId)) throw new Error('Session is recovering; please wait')
    const s = this.sessions.get(sessionId)
    let queue: PiQueue = { steering: [], followUp: [] }
    if (!s) return queue
    // Freeze approvals first, but don't resolve the dialog until queued messages have been removed.
    this.messages.pause(sessionId)
    this.suspending.set(sessionId, (this.suspending.get(sessionId) ?? 0) + 1)
    this.yolo.hold(sessionId)
    // Esc 行为：先清队列再中止，将尚未执行的文本返回给渲染进程恢复草稿。
    try {
      try { queue = (await s.sendCommand('clear_queue', {}, 3000)) as PiQueue } catch {}
      this.extensionUi.cancel(sessionId)
      await s.sendCommand('abort')
      return queue
    } finally {
      const remaining = (this.suspending.get(sessionId) ?? 1) - 1
      if (remaining > 0) this.suspending.set(sessionId, remaining)
      else this.suspending.delete(sessionId)
    }
  }

  submitMessage(id: string, message: MessageSubmission): { id: string } {
    this.getCwd(id)
    if (!this.yolo.isReady(id) || !this.uiAvailable() || this.deleting.has(id) || this.recovering.has(id) || this.health.get(id)?.status === 'unresponsive' || this.health.get(id)?.status === 'exited') throw new Error('会话尚未就绪，请检查或恢复会话')
    const calibrate = this.messages.needsCalibration(id)
    const receipt = this.messages.submit(id, message)
    // An actual user send must not disappear into a queue whose settled event was lost.
    // Idle sends already query state in drain(); probe separately only if they are blocked.
    if (calibrate) void this.checkSession(id).catch(() => {})
    return receipt
  }
  getPendingMessages(id: string) { return this.messages.snapshot(id) }
  editPendingMessage(id: string, messageId: string, revision: number): void { this.messages.edit(id, messageId, revision) }
  updatePendingMessage(id: string, messageId: string, revision: number, text: string, images: ImageRef[]): void { this.messages.update(id, messageId, revision, text, images) }
  finishEditingMessage(id: string, messageId: string, revision: number): void { this.messages.finishEditing(id, messageId, revision) }
  cancelPendingMessage(id: string, messageId: string, revision: number): void { this.messages.cancel(id, messageId, revision) }
  resumePendingMessages(id: string): void {
    if (this.recovering.has(id) || this.health.get(id)?.status !== 'healthy') throw new Error('请先检查或恢复会话')
    this.messages.resume(id)
    if (this.messages.needsCalibration(id)) void this.checkSession(id).catch(() => {})
  }

  sessionInTransition(id: string): boolean { return this.recovering.has(id) || this.deleting.has(id) || this.closing.has(id) }
  sessionAlive(id: string): boolean { const session = this.sessions.get(id); return !!session && !session.hasExited }
  sessionFile(id: string): string | undefined { return this.sessionFiles.get(id) || this.sessions.get(id)?.sessionPath }
  sessionForFile(file: string): string | undefined {
    const key = sessionFileKey('.', file)
    for (const [id, session] of this.sessions) if (this.sessionFiles.get(id) === key || (!this.sessionFiles.has(id) && session.sessionPath && sessionFileKey(session.cwd, session.sessionPath) === key)) return id
    return undefined
  }
  async renameSession(id: string, name: string): Promise<void> {
    if (!name.trim() || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid session name')
    if (this.recovering.has(id) || this.deleting.has(id) || this.closing.has(id)) throw new Error('Session is unavailable')
    const session = this.sessions.get(id)
    if (!session) throw new Error('session not found')
    await session.sendCommand('set_session_name', { name: name.trim() })
  }
  async deleteSessionFile(file: string, remove: () => Promise<void>): Promise<void> {
    const id = this.sessionForFile(file)
    if (id && (this.recovering.has(id) || this.deleting.has(id) || this.closing.has(id))) throw new Error('Session is unavailable')
    if (id) this.deleting.add(id)
    try {
      if (id) {
        this.messages.freeze(id)
        if (this.yolo.isReady(id)) this.yolo.hold(id)
        this.extensionUi.cancel(id)
        await this.sessions.get(id)!.terminate()
      }
      await remove()
      // A failed trash operation keeps the exited tab, draft and outbox recoverable.
      if (id) await this.close(id)
    } finally { if (id) this.deleting.delete(id) }
  }
  generateSessionName(id: string, language: 'zh' | 'en'): Promise<string> {
    const pending = this.naming.get(id)
    if (pending) return pending
    const session = this.sessions.get(id)
    if (!session || this.recovering.has(id) || this.deleting.has(id) || this.closing.has(id) || this.shuttingDown) return Promise.reject(new Error('Session unavailable'))
    const request = (async () => {
      const state = await this.getState(id)
      if (state.isStreaming || state.isCompacting) throw new Error('Wait for the session to finish before AI naming')
      const commands = await session.sendCommand('get_commands') as { commands: Array<{ name: string; sourceInfo?: { path?: string } }> }
      const command = commands.commands.find(item => item.name.startsWith('spi-session-title-bridge') && item.sourceInfo?.path && sessionFileKey('.', item.sourceInfo.path) === sessionFileKey('.', this.extensionPath))
      if (!command) throw new Error('This Pi version does not provide the sPi AI naming bridge')
      if (this.sessions.get(id) !== session || session.hasExited || this.deleting.has(id) || this.recovering.has(id)) throw new Error('Session changed')
      const requestId = randomUUID()
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = new Promise<string>((resolve, reject) => {
        this.titleResults.set(requestId, { session, resolve, reject })
        timer = setTimeout(() => reject(new Error('AI naming timed out')), 40000)
      })
      try {
        const [name] = await Promise.all([result, session.sendCommand('prompt', { message: '/' + command.name + ' ' + JSON.stringify({ requestId, language }) }, 40000)])
        return name
      } finally { clearTimeout(timer); this.titleResults.delete(requestId) }
    })().finally(() => this.naming.delete(id))
    this.naming.set(id, request)
    return request
  }

  getCwd(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    if (!session || this.closing.has(sessionId)) throw new Error('session not found or closing')
    return session.cwd
  }

  async getState(sessionId: string): Promise<PiState> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    const state = (await s.sendCommand('get_state')) as PiState
    if (this.sessions.get(sessionId) !== s || this.closing.has(sessionId)) throw new Error('session is closing')
    if (state.sessionFile) this.sessionFiles.set(sessionId, sessionFileKey(s.cwd, state.sessionFile))
    this.markResponsive(sessionId, s)
    return state
  }

  async getMessages(sessionId: string): Promise<unknown[]> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    const data = (await s.sendCommand('get_messages')) as { messages: unknown[] }
    if (this.sessions.get(sessionId) !== s || s.hasExited || this.closing.has(sessionId)) throw new Error('session changed while reading history')
    return data.messages
  }

  getPendingExtensionUi(sessionId: string): PiRecord[] {
    if (!this.sessions.has(sessionId)) throw new Error('session not found')
    return this.extensionUi.pendingRequests(sessionId)
  }

  async answerExtensionUi(
    sessionId: string,
    id: string,
    payload: { value?: string; confirmed?: boolean; cancelled?: boolean }
  ): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    this.extensionUi.answer(sessionId, id, payload)
  }

  async getAvailableModels(sessionId: string): Promise<unknown[]> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    const data = (await s.sendCommand('get_available_models')) as { models: unknown[] }
    return data.models
  }

  async getAvailableThinkingLevels(sessionId: string): Promise<string[]> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    const data = (await s.sendCommand('get_available_thinking_levels')) as { levels: string[] }
    return data.levels
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
    if (this.recovering.has(sessionId)) throw new Error('Session is recovering; please wait')
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    await s.sendCommand('set_model', { provider, modelId })
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    if (this.recovering.has(sessionId)) throw new Error('Session is recovering; please wait')
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    await s.sendCommand('set_thinking_level', { level })
  }

  async getCommands(sessionId: string): Promise<Array<{ name: string; description?: string; source: string }>> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    const data = (await s.sendCommand('get_commands')) as { commands: Array<{ name: string; description?: string; source: string }> }
    return data.commands
  }

  get pendingMessageCount(): number { return this.messages.pendingCount }

  get size(): number {
    return this.sessions.size
  }
}
