// What crosses the encrypted channel, and how host events are slimmed for a metered relay.
import type { RpcPeer } from './rpc'

export const PROTOCOL_VERSION = 1

/** Host events a remote window needs; everything else (settings, launch requests) stays per machine. */
export const REMOTE_EVENT_CHANNELS = new Set(['pi:event', 'session:closed', 'sessions:changed', 'yolo:changed', 'terminal:event'])

/** Calls a remote window answers on the client itself instead of forwarding to the host. */
export const CLIENT_LOCAL_CHANNELS = new Set(['settings:get', 'settings:update', 'app:quit', 'app:launch-request', 'app:ack-launch', 'layout:load', 'layout:save', 'node:choose-path'])

/** Session-scoped calls whose first argument is a session ID the caller is now watching. */
export const SESSION_SCOPED_CHANNELS = new Set([
  'session:close', 'session:prompt', 'session:check', 'session:recover', 'session:abort', 'session:get-state', 'session:get-messages',
  'session:answer-ui', 'session:models', 'session:thinking-levels', 'session:set-model', 'session:set-thinking', 'session:commands', 'session:pending-ui',
  'messages:submit', 'messages:get', 'messages:edit', 'messages:update', 'messages:finish-edit', 'messages:cancel', 'messages:resume',
  'sessions:generate-name', 'yolo:set', 'terminal:open', 'terminal:attach', 'terminal:get', 'terminal:close'
])

type Record_ = Record<string, unknown>

/**
 * The renderer consumes only the delta fields of message_update. Pi also attaches the whole
 * partial message to every delta, which makes streamed bytes grow quadratically with reply length.
 */
export function slimPiEvent(payload: unknown): unknown {
  const p = payload as { sessionId?: unknown; event?: Record_ }
  if (!p?.event || p.event.type !== 'message_update') return payload
  const { message: _message, ...event } = p.event
  const delta = event.assistantMessageEvent as Record_ | undefined
  if (delta && typeof delta === 'object') {
    const { partial: _partial, ...rest } = delta
    event.assistantMessageEvent = rest
  }
  return { ...p, event }
}

const TOOL_UPDATE_INTERVAL_MS = 250
const MAX_QUEUED_BYTES = 64 * 1024 * 1024

/**
 * Per-peer event sender. tool_execution_update carries the cumulative tool output, so only the
 * latest one per tool call is sent at most every 250 ms; tool_execution_end supersedes it.
 */
export class PeerOutbox {
  private readonly toolUpdates = new Map<string, { channel: string; payload: unknown }>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  constructor(private readonly peer: RpcPeer, private readonly onOverflow: () => void) {}

  emit(channel: string, payload: unknown): void {
    if (this.closed) return
    if (channel === 'pi:event') {
      const p = payload as { sessionId?: string; event?: { type?: string; toolCallId?: unknown } }
      const key = `${p.sessionId}\u0000${String(p.event?.toolCallId ?? '')}`
      if (p.event?.type === 'tool_execution_update') {
        this.toolUpdates.set(key, { channel, payload })
        this.timer ??= setTimeout(() => this.flush(), TOOL_UPDATE_INTERVAL_MS)
        return
      }
      if (p.event?.type === 'tool_execution_end') this.toolUpdates.delete(key)
      payload = slimPiEvent(payload)
    }
    this.write(channel, payload)
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.toolUpdates.clear()
  }

  private flush(): void {
    this.timer = null
    const updates = [...this.toolUpdates.values()]
    this.toolUpdates.clear()
    for (const update of updates) this.write(update.channel, update.payload)
  }

  private write(channel: string, payload: unknown): void {
    if (this.peer.channel.queuedBytes > MAX_QUEUED_BYTES) { this.close(); this.onOverflow(); return }
    void this.peer.emit('ipc.event', { channel, payload }).catch(() => {})
  }
}
