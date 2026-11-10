import { randomUUID } from 'crypto'
import { existsSync, realpathSync } from 'fs'
import { resolve } from 'path'
import type { PiEventPayload, PiQueue, PiState } from '../../shared/types'
import { PiSession } from './piSession'
import { Permissions } from './permissions'
import { ExtensionUi } from './extensionUi'

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

  constructor(
    private piPath: string,
    readonly permissions: Permissions,
    private extensionPath: string,
    private emitEvent: (e: PiEventPayload) => void,
    private emitClosed: (sessionId: string) => void,
    private hasUi: () => boolean = () => false
  ) {
    const canAnswer = (id: string) => {
      try { return this.sessions.has(id) && !this.closing.has(id) && !this.suspending.has(id) && this.hasUi() && this.permissions.isReady(id) }
      catch { return false }
    }
    this.extensionUi = new ExtensionUi({
      canAnswer,
      canAutoAllow: id => canAnswer(id) && this.permissions.canAutoAllowExtension(id),
      send: (id, response) => {
        const stream = this.sessions.get(id)?.child.stdin
        if (!stream || stream.destroyed || stream.writableEnded || stream.writable === false) throw new Error('pi UI response stream unavailable')
        stream.write(JSON.stringify(response) + '\n')
      },
      publish: (sessionId, event) => this.emitEvent({ sessionId, event })
    })
    this.permissions.subscribe(() => this.extensionUi.refresh())
  }

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

  private async startSession(cwd: string, sessionPath?: string): Promise<{ sessionId: string; state: PiState }> {
    // cwd 不存在时 spawn 会报 ENOENT（Node 行为），提前给出可读错误
    if (!existsSync(cwd)) throw new Error(`目录不存在: ${cwd}`)
    if (!existsSync(this.extensionPath)) throw new Error('sPi 权限扩展缺失，拒绝启动: ' + this.extensionPath)
    const id = randomUUID()
    const token = randomUUID()
    this.permissions.open(id)
    let s: PiSession
    try { s = new PiSession(id, cwd, sessionPath, this.piPath, this.extensionPath, token) }
    catch (error) { this.permissions.close(id); throw error }
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    const timer = setTimeout(() => rejectReady(new Error('sPi 权限扩展未就绪，拒绝使用无保护的会话')), 15000)
    s.onEvent = (e) => {
      if (e.type === 'extension_ui_request') {
        if (e.method === 'notify' && e.message === 'spi-permission-ready:' + token) {
          this.permissions.ready(id)
          resolveReady()
          return
        }
        if (e.method === 'select' && typeof e.title === 'string' && e.title.startsWith('spi-permission:' + token + ':')) {
          const reqId = String(e.id)
          const reply = (allow: boolean) => {
            s.child.stdin?.write(JSON.stringify({ type: 'extension_ui_response', id: reqId, value: allow ? 'allow' : 'deny' }) + '\n')
          }
          try {
            const request = JSON.parse(e.title.slice(('spi-permission:' + token + ':').length))
            this.permissions.request(id, reqId, request.cwd, request.tool, request.input, reply)
          } catch (error) {
            console.error('[sPi permissions]', error)
            reply(false)
          }
          return
        }
      }
      if (e.type === 'agent_start') this.permissions.begin(id)
      if (e.type === 'agent_settled') { this.extensionUi.cancel(id); this.permissions.cancel(id) }
      // Internal approval results must never be forgeable through regular pi records.
      if (String(e.type).startsWith('spi_permission') || String(e.type).startsWith('spi_extension')) return
      if (this.extensionUi.receive(id, e)) return
      this.emitEvent({ sessionId: id, event: e })
    }
    s.onStderr = (t) => console.error(`[pi:${id.slice(0, 8)}] stderr:`, t)
    s.onExit = () => {
      rejectReady(new Error('pi exited before permissions became ready'))
      this.closing.add(id)
      this.extensionUi.cancel(id)
      this.extensionUi.forget(id)
      this.permissions.close(id)
      this.sessions.delete(id)
      this.sessionFiles.delete(id)
      this.closing.delete(id)
      this.suspending.delete(id)
      this.emitClosed(id)
    }
    this.sessions.set(id, s)
    try {
      const [state] = await Promise.all([s.sendCommand('get_state') as Promise<PiState>, ready])
      if (this.sessions.get(id) !== s || this.closing.has(id)) throw new Error('session closed while opening')
      const file = state.sessionFile || sessionPath
      if (file) this.sessionFiles.set(id, sessionFileKey(cwd, file))
      return { sessionId: id, state }
    } catch (error) {
      this.closing.add(id)
      this.extensionUi.cancel(id)
      this.extensionUi.forget(id)
      this.permissions.close(id)
      this.sessions.delete(id)
      this.sessionFiles.delete(id)
      s.kill()
      this.closing.delete(id)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async close(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) return
    this.closing.add(sessionId)
    this.permissions.stop(sessionId)
    this.extensionUi.cancel(sessionId)
    try {
      await s.sendCommand('abort', {}, 3000)
    } catch {}
    s.close()
  }

  closeAll(): void {
    // Freeze every session before any permission observer can run during shutdown.
    for (const id of this.sessions.keys()) { this.closing.add(id); this.permissions.hold(id) }
    for (const [id, s] of this.sessions) { this.permissions.stop(id); this.extensionUi.cancel(id); s.close() }
  }

  async sendPrompt(sessionId: string, text: string, mode: 'normal' | 'steer' | 'followUp', images?: Array<{ data: string; mimeType: string }>): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
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
    const s = this.sessions.get(sessionId)
    let queue: PiQueue = { steering: [], followUp: [] }
    if (!s) return queue
    // Freeze approvals first, but don't resolve the dialog until queued messages have been removed.
    this.suspending.set(sessionId, (this.suspending.get(sessionId) ?? 0) + 1)
    this.permissions.hold(sessionId)
    // Esc 行为：先清队列再中止，将尚未执行的文本返回给渲染进程恢复草稿。
    try {
      try { queue = (await s.sendCommand('clear_queue', {}, 3000)) as PiQueue } catch {}
      this.extensionUi.cancel(sessionId)
      this.permissions.cancel(sessionId)
      await s.sendCommand('abort')
      return queue
    } finally {
      const remaining = (this.suspending.get(sessionId) ?? 1) - 1
      if (remaining > 0) this.suspending.set(sessionId, remaining)
      else this.suspending.delete(sessionId)
    }
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
    return state
  }

  async getMessages(sessionId: string): Promise<unknown[]> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    const data = (await s.sendCommand('get_messages')) as { messages: unknown[] }
    return data.messages
  }

  async answerExtensionUi(
    sessionId: string,
    id: string,
    payload: { value?: string; confirmed?: boolean; cancelled?: boolean }
  ): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    if (this.permissions.snapshot().pending.some(p => p.sessionId === sessionId && p.id === id)) {
      throw new Error('sPi 权限审批必须使用专用审批接口')
    }
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
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('session not found')
    await s.sendCommand('set_model', { provider, modelId })
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
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

  get size(): number {
    return this.sessions.size
  }
}
