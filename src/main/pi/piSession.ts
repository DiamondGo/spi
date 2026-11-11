import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import type { PiRecord } from '../../shared/types'
import { piInvocation } from './piInvocation'

interface CommandResponse extends PiRecord {
  command: string
  success: boolean
  data?: unknown
  error?: string
}

/**
 * 一个 pi --mode rpc 子进程的封装。
 * - stdout 按 LF 分帧（不用 readline，避免 U+2028/U+2029 被当行边界）
 * - 命令带 uuid，响应按 id 关联
 * - 非响应记录（事件 / extension_ui_request）走 onEvent
 */
export class PiSession {
  readonly id: string
  readonly cwd: string
  readonly sessionPath?: string
  readonly child: ChildProcess
  onEvent: (e: PiRecord) => void = () => {}
  onExit: (code: number | null) => void = () => {}
  onStderr: (s: string) => void = () => {}

  private buffer = ''
  private pending = new Map<string, (r: CommandResponse) => void>()
  private exited = false
  private stderrTail = ''
  private exitFailure: Error | null = null

  get failureMessage(): string { return this.exitFailure?.message || 'Pi exited before the session became ready' }

  constructor(id: string, cwd: string, sessionPath: string | undefined, piPath: string, extensionPath: string, permissionToken: string, nodePath?: string | null) {
    this.id = id
    this.cwd = cwd
    this.sessionPath = sessionPath
    const args = ['--mode', 'rpc', '--extension', extensionPath]
    if (sessionPath) args.push('--session', sessionPath)
    const invocation = piInvocation(piPath, args, { ...process.env, SPI_PERMISSION_TOKEN: permissionToken }, nodePath)
    this.child = spawn(invocation.command, invocation.args, { cwd, env: invocation.env, windowsHide: true })

    this.child.stdin?.on('error', (error) => this.onStderr('pi stdin: ' + error.message))
    this.child.stdout?.on('data', (d: Buffer) => this.onData(d))
    this.child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      this.stderrTail = (this.stderrTail + text).slice(-4096)
      const s = text.trim()
      if (s) this.onStderr(s)
    })
    this.child.on('exit', (code, signal) => {
      console.error(`[pi:${this.id.slice(0, 8)}] exit code=${code}`)
      this.exited = true
      let reason = `Pi process exited (code ${code ?? 'none'}${signal ? ', signal ' + signal : ''}).`
      // Classify known startup failures; do not copy arbitrary extension stderr/credentials into IPC errors.
      if (/node[^\n]*(?:not found|No such file|not recognized)|(?:not found|No such file)[^\n]*node/i.test(this.stderrTail)) {
        reason += ' Node.js is missing from the Pi launcher environment. The GUI PATH may differ from your terminal; check the Pi launcher and login-shell Node.js >=22.19.'
      } else if (/Cannot find module|ERR_MODULE_NOT_FOUND|error while loading shared libraries/.test(this.stderrTail)) {
        reason += ' Pi or an extension dependency could not be loaded; check the local Pi startup diagnostic.'
      }
      this.exitFailure = new Error(reason)
      for (const cb of this.pending.values()) {
        cb({ type: 'response', command: 'exit', success: false, error: reason } as CommandResponse)
      }
      this.pending.clear()
      this.onExit(code)
    })
    this.child.on('error', (err) => {
      // spawn 失败（如 cwd 不存在会报 ENOENT）：立即拒绝所有等待中的命令，不能等 15s 超时
      const msg = `failed to launch pi: ${err.message}`
      this.onStderr(msg)
      if (this.exited) return
      this.exited = true
      this.exitFailure = new Error(msg)
      for (const cb of this.pending.values()) {
        cb({ type: 'response', command: 'exit', success: false, error: msg } as CommandResponse)
      }
      this.pending.clear()
      this.onExit(null)
    })
  }

  private onData(d: Buffer): void {
    this.buffer += d.toString('utf8')
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '')
      this.buffer = this.buffer.slice(idx + 1)
      if (!line.trim()) continue
      let rec: PiRecord
      try {
        rec = JSON.parse(line)
      } catch {
        continue // 半行/坏行跳过，等下一帧
      }
      if (rec.type === 'response' && rec.id) {
        const cb = this.pending.get(rec.id as string)
        if (cb) {
          this.pending.delete(rec.id as string)
          cb(rec as CommandResponse)
        }
      } else {
        this.onEvent(rec)
      }
    }
  }

  /** 发一条命令，等对应响应（data 或抛错） */
  sendCommand(type: string, fields: Record<string, unknown> = {}, timeoutMs = 15000): Promise<unknown> {
    if (this.exited) return Promise.reject(this.exitFailure || new Error(this.failureMessage))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`command timeout: ${type}`))
      }, timeoutMs)
      this.pending.set(id, (r) => {
        clearTimeout(timer)
        if (r.success) resolve(r.data)
        else reject(new Error(r.error || `command failed: ${type}`))
      })
      try {
        this.child.stdin?.write(JSON.stringify({ id, type, ...fields }) + '\n')
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e)
      }
    })
  }

  /** 有序退出：关 stdin，pi 清理后自行退出 */
  close(): void {
    try {
      this.child.stdin?.end()
    } catch {}
    setTimeout(() => {
      if (!this.exited) this.child.kill()
    }, 3000)
  }

  kill(): void {
    this.child.kill()
  }
}
