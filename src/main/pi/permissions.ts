import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { PermissionDecision, PermissionMode, PermissionRequest, PermissionRule, PermissionSnapshot, SafePermissionMode } from '../../shared/types'

const modes = ['ask', 'remember', 'allowlist', 'all']
const decisions = ['deny', 'once', 'session', 'whitelist', 'all']
const MAX_INPUT = 1024 * 1024

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// No shell prefix/glob matching. A changed command, compound command, cwd or write body needs approval.
export function permissionKey(cwd: string, tool: string, input: Record<string, unknown>): string {
  const args = { ...input }
  if (tool === 'bash' || tool === 'powershell' || tool === 'user_bash') delete args.timeout
  return createHash('sha256').update(canonical([cwd, tool, args])).digest('hex')
}

type Reply = (allow: boolean) => void
type Pending = { request: PermissionRequest; reply: Reply; timer: ReturnType<typeof setTimeout> }

export class Permissions {
  private defaultMode: SafePermissionMode = 'ask'
  private rules: PermissionRule[] = []
  private sessions = new Map<string, { mode: PermissionMode; keys: Set<string>; ready: boolean; stopping: boolean }>()
  private pending = new Map<string, Pending>()

  constructor(private file: string, private changed: (state: PermissionSnapshot) => void) {
    // A corrupt permission file is an error, never a reason to silently enable unrestricted tools.
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      if (!['ask', 'remember', 'allowlist'].includes(data.defaultMode) || !Array.isArray(data.rules)) {
        throw new Error('sPi 权限配置无效，请检查 ' + file)
      }
      this.defaultMode = data.defaultMode
      this.rules = data.rules.map((rule: PermissionRule) => {
        this.validateRule(rule)
        return rule
      })
    }
  }

  private validateRule(rule: PermissionRule): void {
    if (!rule || typeof rule.id !== 'string' || !rule.id || typeof rule.cwd !== 'string' || !rule.cwd ||
        typeof rule.tool !== 'string' || !rule.tool || !rule.input || typeof rule.input !== 'object' ||
        Array.isArray(rule.input) || JSON.stringify(rule.input).length > MAX_INPUT) throw new Error('无效的权限规则')
  }

  private save(rules = this.rules, defaultMode = this.defaultMode): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify({ defaultMode, rules }, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
    this.rules = rules
    this.defaultMode = defaultMode
  }

  snapshot(): PermissionSnapshot {
    return {
      defaultMode: this.defaultMode,
      rules: structuredClone(this.rules),
      sessions: Object.fromEntries([...this.sessions].map(([id, s]) => [id, { mode: s.mode, remembered: s.keys.size, ready: s.ready }])),
      pending: [...this.pending.values()].map(p => structuredClone(p.request))
    }
  }
  private emit(): void { this.changed(this.snapshot()) }
  open(id: string): void {
    this.sessions.set(id, { mode: this.defaultMode, keys: new Set(), ready: false, stopping: false })
    this.emit()
  }
  ready(id: string): void { this.session(id).ready = true; this.emit() }
  private session(id: string) {
    const s = this.sessions.get(id)
    if (!s) throw new Error('session not found')
    return s
  }
  begin(id: string): void { this.session(id).stopping = false }
  hold(id: string): void { this.session(id).stopping = true }
  stop(id: string): void { this.hold(id); this.cancel(id) }
  close(id: string): void { this.cancel(id); this.sessions.delete(id); this.emit() }
  cancel(id: string): void {
    for (const p of [...this.pending.values()]) if (p.request.sessionId === id) this.finish(p, false)
  }
  clear(id: string): void { this.session(id).keys.clear(); this.emit() }
  setDefault(mode: SafePermissionMode): void {
    if (!['ask', 'remember', 'allowlist'].includes(mode)) throw new Error('默认模式不能全部允许')
    this.save(this.rules, mode)
    this.emit()
  }
  setMode(id: string, mode: PermissionMode): void {
    if (!modes.includes(mode)) throw new Error('无效的权限模式')
    this.session(id).mode = mode
    // Mode changes only affect future requests. Existing requests still need explicit approval.
    this.emit()
  }
  addRule(cwd: string, command: string): void {
    if (typeof command !== 'string' || !command.trim()) throw new Error('命令不能为空')
    this.storeRule({ id: randomUUID(), cwd, tool: 'bash', input: { command } })
    this.emit()
  }
  private storeRule(rule: PermissionRule): void {
    this.validateRule(rule)
    const key = permissionKey(rule.cwd, rule.tool, rule.input)
    if (!this.rules.some(r => permissionKey(r.cwd, r.tool, r.input) === key)) {
      if (this.rules.length >= 500) throw new Error('白名单最多 500 条')
      this.save([...this.rules, rule])
    }
  }
  removeRule(id: string): void { this.save(this.rules.filter(r => r.id !== id)); this.emit() }

  request(sessionId: string, id: string, cwd: string, tool: string, input: Record<string, unknown>, reply: Reply): void {
    const s = this.session(sessionId)
    const request = { sessionId, id, cwd, tool, input }
    this.validateRule(request)
    if (!s.ready || s.stopping) { reply(false); return }
    const key = permissionKey(cwd, tool, input)
    if (s.mode === 'all' ||
        (s.mode !== 'ask' && s.keys.has(key)) ||
        (s.mode === 'allowlist' && this.rules.some(r => permissionKey(r.cwd, r.tool, r.input) === key))) {
      reply(true)
      return
    }
    const pendingKey = sessionId + ':' + id
    if (this.pending.has(pendingKey)) throw new Error('重复的审批请求')
    const p: Pending = { request, reply, timer: setTimeout(() => this.finish(p, false), 10 * 60 * 1000) }
    this.pending.set(pendingKey, p)
    this.emit()
  }
  answer(sessionId: string, id: string, decision: PermissionDecision): void {
    if (!decisions.includes(decision)) throw new Error('无效的审批选项')
    const p = this.pending.get(sessionId + ':' + id)
    if (!p) throw new Error('审批已取消或过期')
    const s = this.session(sessionId)
    if (s.stopping) { this.finish(p, false); return }
    const { cwd, tool, input } = p.request
    if (decision === 'whitelist') {
      // Persist before approving; failure must leave the request unapproved.
      this.storeRule({ id: randomUUID(), cwd, tool, input })
      s.mode = 'allowlist'
    }
    if (decision === 'session') {
      s.keys.add(permissionKey(cwd, tool, input))
      if (s.mode === 'ask') s.mode = 'remember'
    }
    if (decision === 'all') s.mode = 'all'
    this.finish(p, decision !== 'deny')
  }
  private finish(p: Pending, allow: boolean): void {
    const key = p.request.sessionId + ':' + p.request.id
    if (!this.pending.delete(key)) return
    clearTimeout(p.timer)
    p.reply(allow)
    this.emit()
  }
}
