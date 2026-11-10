import type { YoloSnapshot } from '../../shared/types'

// A session-local automation switch, NOT another permission policy. Both states
// delegate tool decisions to Pi; the bridge only enforces readiness/Stop/liveness.
// Legacy spi-permissions.json is deliberately neither read nor modified.
export class YoloPolicy {
  private sessions = new Map<string, { enabled: boolean; ready: boolean; stopping: boolean }>()
  private observers = new Set<() => void>()
  constructor(private changed: (state: YoloSnapshot) => void) {}

  snapshot(): YoloSnapshot {
    return { sessions: Object.fromEntries([...this.sessions].map(([id, s]) => [id, { enabled: s.enabled, ready: s.ready }])) }
  }
  subscribe(listener: () => void): () => void { this.observers.add(listener); return () => this.observers.delete(listener) }
  private emit(): void { this.changed(this.snapshot()); for (const observer of this.observers) observer() }
  private session(id: string) { const s = this.sessions.get(id); if (!s) throw new Error('session not found'); return s }
  open(id: string): void { this.sessions.set(id, { enabled: false, ready: false, stopping: false }); this.emit() }
  ready(id: string): void { this.session(id).ready = true; this.emit() }
  isReady(id: string): boolean { return !!this.sessions.get(id)?.ready }
  setEnabled(id: string, enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new Error('YOLO must be a boolean')
    this.session(id).enabled = enabled
    this.emit()
  }
  begin(id: string): void { this.session(id).stopping = false }
  hold(id: string): void { this.session(id).stopping = true }
  stop(id: string): void { this.hold(id) }
  close(id: string): void { this.sessions.delete(id); this.emit() }
  canAutoAllowExtension(id: string): boolean { const s = this.sessions.get(id); return !!s?.ready && !s.stopping && s.enabled }
  allowsExecution(id: string, cwd: unknown, tool: unknown, input: unknown): boolean {
    const s = this.sessions.get(id)
    if (!s?.ready || s.stopping || typeof cwd !== 'string' || !cwd || typeof tool !== 'string' || !tool ||
        !input || typeof input !== 'object' || Array.isArray(input)) return false
    try { return JSON.stringify(input).length <= 1024 * 1024 } catch { return false }
  }
}
