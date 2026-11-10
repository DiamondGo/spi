import { performance } from 'perf_hooks'
import type { PiRecord } from '../../shared/types'

export interface ToolApproval {
  adapter: 'permission-modes'
  tool: string
}

const commonOptions = ['Allow', 'Allow always (this project)', 'Allow always (global)', 'Block']
const writeOptions = [...commonOptions.slice(0, 3), 'Allow all (enable bypass)', 'Block']
const dialogMethods = new Set(['select', 'confirm', 'input', 'editor'])
const MAX_PENDING = 128
const MAX_RECENT = 2048
const APPROVAL_TTL = 10 * 60 * 1000

// Format compatibility only: Pi RPC does not authenticate the originating extension.
// Never infer approval from an Allow button alone, or match forwarded subagent asks.
export function recognizeToolApproval(request: PiRecord): ToolApproval | null {
  if (request.type !== 'extension_ui_request' || request.method !== 'select' ||
      typeof request.title !== 'string' || request.title.length > 1024 * 1024 ||
      request.message !== undefined || request.prefill !== undefined || request.placeholder !== undefined ||
      !Array.isArray(request.options)) return null
  const options = request.options
  const same = (expected: string[]) => options.length === expected.length && expected.every((o, i) => options[i] === o)
  const common = /^Allow (bash|read|write|edit|grep|find|ls)\? ([\s\S]+)$/.exec(request.title)
  if (common && common[2].trim() && same(commonOptions)) return { adapter: 'permission-modes', tool: common[1] }
  const write = /^Allow (edit|write) on ([\s\S]+)\?$/.exec(request.title)
  if (write && write[2].trim() && same(writeOptions)) return { adapter: 'permission-modes', tool: write[1] }
  return null
}

type Response = { type: 'extension_ui_response'; id: string; value?: string; confirmed?: boolean; cancelled?: boolean }
type Payload = { value?: string; confirmed?: boolean; cancelled?: boolean }
type Resolution = 'auto-allow' | 'manual' | 'cancelled' | 'expired' | 'failed'
interface Pending {
  request: PiRecord
  approval: ToolApproval | null
  deadline?: number
  timer?: ReturnType<typeof setTimeout>
}
interface Dependencies {
  canAutoAllow(sessionId: string): boolean
  canAnswer(sessionId: string): boolean
  send(sessionId: string, response: Response): void
  publish(sessionId: string, event: PiRecord): void
}

// Own all dialog IDs in the main process so manual/automatic/expired answers race
// through one single-use path. There is no UI clicking and no persistent allow rule.
export class ExtensionUi {
  private pending = new Map<string, Map<string, Pending>>()
  private recent = new Map<string, Set<string>>()
  constructor(private deps: Dependencies) {}

  receive(sessionId: string, event: PiRecord): boolean {
    if (event.type !== 'extension_ui_request' || !dialogMethods.has(String(event.method))) return false
    if (typeof event.id !== 'string' || !event.id || event.id.length > 256) return true
    const id = event.id
    const entries = this.pending.get(sessionId) ?? new Map<string, Pending>()
    if (entries.has(id) || this.recent.get(sessionId)?.has(id)) return true
    this.pending.set(sessionId, entries)
    const approval = recognizeToolApproval(event)
    const request = { ...structuredClone(event), spiToolApproval: approval ?? undefined }
    const p: Pending = { request, approval }
    entries.set(id, p)
    const timeout = typeof event.timeout === 'number' && Number.isFinite(event.timeout) && event.timeout >= 0
      ? Math.min(event.timeout, 2147483647) : undefined
    // Invalid timeout metadata is never eligible for automatic approval.
    if (event.timeout !== undefined && timeout === undefined) p.approval = null
    const ttl = approval ? Math.min(timeout ?? APPROVAL_TTL, APPROVAL_TTL) : timeout
    if (ttl !== undefined) {
      p.deadline = performance.now() + ttl
      p.timer = setTimeout(() => this.finish(sessionId, id, p, { type: 'extension_ui_response', id, cancelled: true }, 'expired'), ttl)
      p.timer.unref?.()
    }
    if (entries.size > MAX_PENDING) {
      this.finish(sessionId, id, p, { type: 'extension_ui_response', id, cancelled: true }, 'cancelled')
    } else if (p.deadline !== undefined && p.deadline <= performance.now()) {
      this.finish(sessionId, id, p, { type: 'extension_ui_response', id, cancelled: true }, 'expired')
    } else if (!this.autoAllow(sessionId, id, p)) {
      this.deps.publish(sessionId, request)
    }
    return true
  }

  refresh(): void {
    for (const [sessionId, entries] of [...this.pending]) {
      for (const [id, p] of [...entries]) this.autoAllow(sessionId, id, p)
    }
  }

  private autoAllow(sessionId: string, id: string, p: Pending): boolean {
    if (!p.approval || !this.deps.canAutoAllow(sessionId)) return false
    if (p.deadline !== undefined && p.deadline <= performance.now()) {
      this.finish(sessionId, id, p, { type: 'extension_ui_response', id, cancelled: true }, 'expired')
    } else {
      this.finish(sessionId, id, p, { type: 'extension_ui_response', id, value: 'Allow' }, 'auto-allow')
    }
    return true
  }

  answer(sessionId: string, id: string, payload: Payload): void {
    const p = this.pending.get(sessionId)?.get(id)
    if (!p || !this.deps.canAnswer(sessionId)) throw new Error('扩展询问已取消、过期或会话已停止')
    if (p.deadline !== undefined && p.deadline <= performance.now()) {
      this.finish(sessionId, id, p, { type: 'extension_ui_response', id, cancelled: true }, 'expired')
      throw new Error('扩展询问已取消、过期或会话已停止')
    }
    const response: Response = { type: 'extension_ui_response', id }
    if (payload.cancelled === true) response.cancelled = true
    else if (p.request.method === 'confirm' && typeof payload.confirmed === 'boolean') response.confirmed = payload.confirmed
    else if (['select', 'input', 'editor'].includes(String(p.request.method)) && typeof payload.value === 'string' && payload.value.length <= 1024 * 1024) {
      if (p.request.method === 'select' && (!Array.isArray(p.request.options) || !p.request.options.includes(payload.value))) throw new Error('无效的扩展选项')
      response.value = payload.value
    } else throw new Error('无效的扩展答复')
    this.finish(sessionId, id, p, response, payload.cancelled ? 'cancelled' : 'manual', true)
  }

  cancel(sessionId: string): void {
    for (const [id, p] of [...(this.pending.get(sessionId) ?? [])]) {
      this.finish(sessionId, id, p, { type: 'extension_ui_response', id, cancelled: true }, 'cancelled')
    }
  }
  forget(sessionId: string): void {
    for (const p of this.pending.get(sessionId)?.values() ?? []) clearTimeout(p.timer)
    this.pending.delete(sessionId)
    this.recent.delete(sessionId)
  }
  private finish(sessionId: string, id: string, p: Pending, response: Response, resolution: Resolution, rethrow = false): void {
    const entries = this.pending.get(sessionId)
    if (entries?.get(id) !== p) return
    entries.delete(id)
    if (!entries.size) this.pending.delete(sessionId)
    clearTimeout(p.timer)
    const recent = this.recent.get(sessionId) ?? new Set<string>()
    recent.add(id)
    if (recent.size > MAX_RECENT) recent.delete(recent.values().next().value!)
    this.recent.set(sessionId, recent)
    let failed = false
    try { this.deps.send(sessionId, response) } catch { failed = true }
    // Never echo command bodies, paths, input/editor values or authentication data.
    this.deps.publish(sessionId, {
      type: 'spi_extension_ui_result', id, resolution: failed ? 'failed' : resolution,
      ...(p.approval ? { adapter: p.approval.adapter, tool: p.approval.tool } : {})
    })
    if (failed && rethrow) throw new Error('扩展答复发送失败')
  }
}
