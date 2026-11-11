import { createHash, randomUUID } from 'crypto'
import type { ImageRef, MessageSubmission, PendingMessage, PendingMessagesSnapshot, PiState } from '../../shared/types'

interface QueueState {
  items: PendingMessage[]; version: number; paused: boolean; draining: boolean; waiting: boolean; busy: boolean; activeRun: boolean; settled: number
  receipts: Map<string, { id: string; hash: string }>
}
interface Dependencies {
  state(id: string): Promise<PiState>
  deliver(id: string, message: PendingMessage): Promise<unknown>
  changed(snapshot: PendingMessagesSnapshot): void
  failed?(id: string): void
}
const MAX_BYTES = 32 * 1024 * 1024
function content(text: unknown, images: unknown): { text: string; images: ImageRef[] } {
  if (typeof text !== 'string' || text.length > 1024 * 1024 || !Array.isArray(images) || images.length > 20) throw new Error('无效的待发送消息')
  let bytes = Buffer.byteLength(text)
  const checked = images.map(image => {
    if (!image || typeof image.data !== 'string' || typeof image.mimeType !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(image.mimeType) || !/^[a-z0-9+/]*={0,2}$/i.test(image.data)) throw new Error('无效的图片')
    bytes += image.data.length
    return { data: image.data, mimeType: image.mimeType }
  })
  if ((!text.trim() && !checked.length) || bytes > MAX_BYTES) throw new Error('消息为空或过大')
  return { text, images: checked }
}
export class MessageQueue {
  private sessions = new Map<string, QueueState>()
  constructor(private deps: Dependencies) {}
  open(id: string): void { this.sessions.set(id, { items: [], version: 0, paused: false, draining: false, waiting: false, busy: false, activeRun: false, settled: 0, receipts: new Map() }) }
  close(id: string): void { this.sessions.delete(id) }
  /** Detach in-flight drains so late acknowledgements cannot mutate a recovered queue. */
  freeze(id: string): void {
    const s = this.session(id)
    const items = structuredClone(s.items).map(item => item.status === 'dispatching'
      ? { ...item, status: 'failed' as const, revision: item.revision + 1, error: '交付未确认，请查看对话后再决定是否重试' }
      : item)
    this.sessions.set(id, { ...s, items, receipts: new Map(s.receipts), paused: true, draining: false, waiting: false, busy: false, activeRun: false })
    this.emit(id)
  }
  /** A successful state probe can repair a missed settled event, but never resumes a paused queue. */
  reconcile(id: string, state: PiState): void {
    const s = this.session(id)
    if (s.draining) return
    s.busy = state.isStreaming || !!state.isCompacting
    s.activeRun = state.isStreaming
    if (!s.busy) { s.waiting = false; s.settled++; void this.drain(id, s) }
  }
  needsCalibration(id: string): boolean {
    const s = this.session(id)
    return !s.paused && !s.draining && (s.busy || s.waiting)
  }
  get pendingCount(): number { return [...this.sessions.values()].reduce((n, s) => n + s.items.length, 0) }
  private session(id: string): QueueState { const s = this.sessions.get(id); if (!s) throw new Error('session not found'); return s }
  snapshot(id: string): PendingMessagesSnapshot { const s = this.session(id); return { sessionId: id, version: s.version, paused: s.paused, items: structuredClone(s.items) } }
  private emit(id: string): void { const s = this.sessions.get(id); if (s) { s.version++; this.deps.changed(this.snapshot(id)) } }
  submit(id: string, submission: MessageSubmission): { id: string } {
    const s = this.session(id)
    if (!submission || typeof submission.clientId !== 'string' || !/^[a-z0-9_-]{1,160}$/i.test(submission.clientId) || (submission.priority !== undefined && typeof submission.priority !== 'boolean')) throw new Error('无效的消息标识')
    const value = content(submission.text, submission.images ?? [])
    const hash = createHash('sha256').update(JSON.stringify([value, !!submission.priority])).digest('hex')
    const prior = s.receipts.get(submission.clientId)
    if (prior) { if (prior.hash !== hash) throw new Error('消息标识已用于其他内容'); return { id: prior.id } }
    if (s.items.length >= 50 || this.size(s.items) + this.size([value]) > MAX_BYTES) throw new Error('待发送队列已满')
    if (!s.items.length) s.paused = false
    const item: PendingMessage = { ...value, id: randomUUID(), revision: 1, priority: !!submission.priority, status: 'pending' }
    // Follow up appends; each new steer jumps to the front of the buffer.
    // The one message already being handed to Pi is never displaced.
    const at = item.priority ? (s.items[0]?.status === 'dispatching' ? 1 : 0) : -1
    if (at < 0) s.items.push(item); else s.items.splice(at, 0, item)
    s.receipts.set(submission.clientId, { id: item.id, hash })
    if (s.receipts.size > 1024) s.receipts.delete(s.receipts.keys().next().value!)
    this.emit(id); void this.drain(id, s)
    return { id: item.id }
  }
  private size(items: Array<{ text: string; images: ImageRef[] }>): number { return items.reduce((sum, x) => sum + Buffer.byteLength(x.text) + x.images.reduce((n, i) => n + i.data.length, 0), 0) }
  private mutable(id: string, messageId: string, revision: number): [QueueState, PendingMessage] {
    const s = this.session(id), item = s.items.find(x => x.id === messageId)
    if (!item || item.revision !== revision) throw new Error('待发送消息已变化，请重新操作')
    if (item.status === 'dispatching') throw new Error('消息已交付 Pi，不能再修改或取消')
    return [s, item]
  }
  edit(id: string, messageId: string, revision: number): void { const [, item] = this.mutable(id, messageId, revision); item.status = 'editing'; item.revision++; this.emit(id) }
  update(id: string, messageId: string, revision: number, text: string, images: ImageRef[]): void {
    const [s, item] = this.mutable(id, messageId, revision), value = content(text, images)
    if (this.size(s.items.filter(x => x !== item)) + this.size([value]) > MAX_BYTES) throw new Error('待发送队列已满')
    Object.assign(item, value, { status: 'pending', error: undefined, revision: item.revision + 1 })
    this.emit(id); void this.drain(id, s)
  }
  finishEditing(id: string, messageId: string, revision: number): void {
    const [s, item] = this.mutable(id, messageId, revision)
    item.status = item.error ? 'failed' : 'pending'; item.revision++; this.emit(id); void this.drain(id, s)
  }
  cancel(id: string, messageId: string, revision: number): void {
    const [s, item] = this.mutable(id, messageId, revision); s.items.splice(s.items.indexOf(item), 1)
    if (!s.items.length) s.paused = false
    this.emit(id); void this.drain(id, s)
  }
  pause(id: string): void { const s = this.sessions.get(id); if (s) { s.paused = true; this.emit(id) } }
  resume(id: string): void { const s = this.session(id); s.paused = false; this.emit(id); void this.drain(id, s) }
  block(id: string): void { const s = this.sessions.get(id); if (s) s.busy = true }
  wake(id: string): void { const s = this.sessions.get(id); if (s && !s.waiting && !s.activeRun) { s.busy = false; void this.drain(id, s) } }
  activity(id: string, busy: boolean): void {
    const s = this.sessions.get(id); if (!s) return
    s.busy = busy; s.activeRun = busy
    if (!busy) { s.waiting = false; s.settled++; void this.drain(id, s) }
  }
  private async drain(id: string, s: QueueState): Promise<void> {
    if (s.draining || s.paused || s.waiting || s.busy || !s.items.length || this.sessions.get(id) !== s) return
    s.draining = true
    try {
      while (this.sessions.get(id) === s && !s.paused && !s.waiting && !s.busy && s.items.length) {
        if (s.items[0].status !== 'pending') break
        // While checking Pi, edits/cancels remain possible. Re-read the head after await.
        const epoch = s.settled
        const state = await this.deps.state(id)
        if (state.isStreaming || state.isCompacting) { if (s.settled !== epoch) continue; s.busy = true; if (state.isStreaming) s.activeRun = true; break }
        if (this.sessions.get(id) !== s || s.paused || s.busy) break
        const item = s.items[0]
        if (!item || item.status !== 'pending') break
        item.status = 'dispatching'; item.revision++; this.emit(id)
        const settled = s.settled
        try {
          // No streamingBehavior: never secretly create an uneditable native Pi queue.
          const result = await this.deps.deliver(id, structuredClone(item)) as { disposition?: string } | undefined
          if (this.sessions.get(id) !== s) return
          s.items = s.items.filter(x => x !== item)
          s.waiting = result?.disposition !== 'handled' && s.settled === settled
          if (!result?.disposition && !s.busy && s.waiting) {
            try { const current = await this.deps.state(id); if (!current.isStreaming && !current.isCompacting) s.waiting = false }
            catch {
              if (this.sessions.get(id) !== s) return
              s.paused = true; s.waiting = false; this.deps.failed?.(id)
            }
          }
          this.emit(id)
        } catch {
          if (this.sessions.get(id) !== s) return
          item.status = 'failed'; item.revision++; item.error = '交付未确认，请查看对话后再决定是否重试'; s.paused = true; this.emit(id); this.deps.failed?.(id); break
        }
      }
    } catch {
      if (this.sessions.get(id) === s) { s.paused = true; this.emit(id); this.deps.failed?.(id) }
    } finally { s.draining = false }
  }
}
