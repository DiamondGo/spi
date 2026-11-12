import { randomUUID } from 'crypto'
import { accessSync, constants, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { basename, isAbsolute, join } from 'path'
import { tmpdir, userInfo } from 'os'
import type { IPty, IPtyForkOptions, IDisposable } from 'node-pty'
import type { TerminalEvent, TerminalInfo, TerminalSnapshot } from '../shared/types'

type Spawn = (shell: string, args: string[], options: IPtyForkOptions) => IPty
const HISTORY_LIMIT = 1024 * 1024
const PACKET_LIMIT = 64 * 1024

export function defaultShell(platform = process.platform, env = process.env, accountShell = userInfo().shell): string {
  if (platform === 'win32') return env.ComSpec || 'cmd.exe'
  for (const candidate of [env.SHELL, accountShell, '/bin/bash', '/bin/sh']) {
    if (!candidate || !isAbsolute(candidate)) continue
    try { accessSync(candidate, constants.X_OK); if (statSync(candidate).isFile()) return candidate } catch {}
  }
  throw new Error('No executable default shell was found')
}
function removeRc(dir: string | undefined): void {
  if (!dir) return
  try { rmSync(dir, { recursive: true, force: true }) } catch (error) { console.error('[sPi terminal] temporary rc cleanup:', error) }
}
function spawnNative(shell: string, args: string[], options: IPtyForkOptions): IPty {
  // Lazy load so a native-module failure is shown in the terminal UI, not a whole-app crash.
  return (createRequire(join(__dirname, 'native-dependencies.cjs'))('node-pty') as typeof import('node-pty')).spawn(shell, args, options)
}

// Capture only the owned PTY's descendants, with start times to guard against PID reuse.
function identity(pid: number): string | null {
  try { const text = readFileSync(`/proc/${pid}/stat`, 'utf8'); return text.slice(text.lastIndexOf(')') + 2).split(' ')[19] } catch { return null }
}
function processTree(pid: number): Map<number, string> {
  const result = new Map<number, string>()
  const visit = (current: number) => {
    const started = identity(current)
    if (!started || result.has(current)) return
    result.set(current, started)
    try { readFileSync(`/proc/${current}/task/${current}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number).forEach(visit) } catch {}
  }
  visit(pid)
  return result
}
function signalOwned(pids: Map<number, string>, signal: NodeJS.Signals): void {
  for (const [pid, started] of [...pids].reverse()) {
    if (identity(pid) === started) { try { process.kill(pid, signal) } catch {} }
  }
}

interface Entry {
  info: TerminalInfo
  owner: string
  started: string | null
  pty: IPty
  history: string
  pending: string
  seq: number
  waiting: number
  attached: boolean
  timer?: ReturnType<typeof setTimeout>
  subscriptions: IDisposable[]
  rcDir?: string
}

export class TerminalManager {
  private entries = new Map<string, Entry>()
  private cleanup = new Map<ReturnType<typeof setTimeout>, () => void>()
  constructor(private emit: (owner: string, event: TerminalEvent) => void, private spawn: Spawn = spawnNative) {}

  private size(cols: number, rows: number): [number, number] {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) throw new Error('Invalid terminal size')
    return [Math.max(10, Math.min(500, Math.floor(cols))), Math.max(2, Math.min(200, Math.floor(rows)))]
  }
  open(sessionId: string, cwd: string, owner: string, cols: number, rows: number): TerminalInfo {
    const existing = this.entries.get(sessionId)
    if (existing) { this.owned(sessionId, existing.info.terminalId, owner); return { ...existing.info } }
    if (!statSync(cwd).isDirectory()) throw new Error('Terminal working directory does not exist')
    const [width, height] = this.size(cols, rows)
    const shell = defaultShell()
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'sPi', PWD: cwd }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_NO_ASAR
    delete env.ELECTRON_VITE_DEV_SERVER_URL
    delete env.SPI_PERMISSION_TOKEN
    // Respect bashrc, then enforce the requested cwd (user startup scripts can themselves cd).
    // The wrapper is private and temporary; never edit ~/.bashrc or interpolate cwd into shell code.
    let rcDir: string | undefined
    let args: string[] = []
    if (process.platform !== 'win32' && basename(realpathSync(shell)) === 'bash') {
      rcDir = mkdtempSync(join(tmpdir(), 'spi-terminal-rc-'))
      const rcFile = join(rcDir, 'bashrc')
      try { writeFileSync(rcFile, 'if [[ -f "$HOME/.bashrc" ]]; then source "$HOME/.bashrc"; fi\nbuiltin cd -- "$SPI_TERMINAL_CWD"\nunset SPI_TERMINAL_CWD\n', { mode: 0o600 }) }
      catch (error) { removeRc(rcDir); throw error }
      env.SPI_TERMINAL_CWD = cwd
      args = ['--rcfile', rcFile, '-i']
    }
    let pty: IPty
    try { pty = this.spawn(shell, args, { cwd, env, cols: width, rows: height, name: 'xterm-256color' }) }
    catch (error) { removeRc(rcDir); throw error }
    const info: TerminalInfo = { sessionId, terminalId: randomUUID(), cwd, shell, pid: pty.pid, cols: width, rows: height }
    const entry: Entry = { info, owner, started: identity(pty.pid), pty, history: '', pending: '', seq: 0, waiting: 0, attached: false, subscriptions: [], rcDir }
    this.entries.set(sessionId, entry)
    const emitter = pty as IPty & { on?: (event: string, listener: (error: Error) => void) => unknown }
    emitter.on?.('error', error => {
      if (this.entries.get(sessionId) === entry) this.emit(owner, { type: 'error', sessionId, terminalId: info.terminalId, message: error.message })
    })
    pty.pause()
    entry.subscriptions.push(pty.onData(data => {
      if (this.entries.get(sessionId) !== entry) return
      entry.history += data
      if (entry.history.length > HISTORY_LIMIT) {
        const tail = entry.history.slice(-HISTORY_LIMIT + 4)
        const line = tail.indexOf('\n')
        entry.history = '\x1b[0m' + tail.slice(line >= 0 ? line + 1 : 0)
      }
      entry.pending += data
      if (entry.pending.length >= PACKET_LIMIT) pty.pause()
      this.schedule(entry)
    }))
    entry.subscriptions.push(pty.onExit(({ exitCode }) => {
      if (this.entries.get(sessionId) !== entry) return
      this.entries.delete(sessionId)
      this.dispose(entry)
      this.emit(owner, { type: 'exit', sessionId, terminalId: info.terminalId, exitCode, reason: 'exit' })
    }))
    return { ...info }
  }

  private owned(sessionId: string, terminalId: string, owner: string): Entry {
    const entry = this.entries.get(sessionId)
    if (!entry || entry.info.terminalId !== terminalId || entry.owner !== owner) throw new Error('Terminal is closed or belongs to another window')
    return entry
  }
  private snapshot(entry: Entry): TerminalSnapshot { return { ...entry.info, history: entry.history, seq: entry.seq } }
  get(sessionId: string, owner: string): TerminalSnapshot | null {
    const entry = this.entries.get(sessionId)
    if (!entry) return null
    this.owned(sessionId, entry.info.terminalId, owner)
    return this.snapshot(entry)
  }
  attach(sessionId: string, terminalId: string, owner: string): TerminalSnapshot {
    const entry = this.owned(sessionId, terminalId, owner)
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    // Snapshot contains already-received output. New output uses higher sequence numbers.
    const snapshot = this.snapshot(entry)
    entry.pending = ''
    entry.waiting = 0
    entry.attached = true
    entry.pty.resume()
    return snapshot
  }
  write(sessionId: string, terminalId: string, owner: string, data: string): void {
    const entry = this.owned(sessionId, terminalId, owner)
    if (typeof data !== 'string' || data.length > 64 * 1024) throw new Error('Invalid terminal input')
    entry.pty.write(data)
  }
  resize(sessionId: string, terminalId: string, owner: string, cols: number, rows: number): void {
    const entry = this.owned(sessionId, terminalId, owner)
    const [width, height] = this.size(cols, rows)
    if (entry.info.cols === width && entry.info.rows === height) return
    entry.pty.resize(width, height)
    entry.info.cols = width
    entry.info.rows = height
  }
  ack(sessionId: string, terminalId: string, owner: string, seq: number): void {
    const entry = this.owned(sessionId, terminalId, owner)
    if (!entry.waiting || entry.waiting !== seq) return
    entry.waiting = 0
    if (entry.pending) this.schedule(entry)
    else entry.pty.resume()
  }
  private schedule(entry: Entry): void {
    if (!entry.attached || entry.waiting || entry.timer || !entry.pending) return
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      if (this.entries.get(entry.info.sessionId) !== entry || entry.waiting) return
      let end = Math.min(entry.pending.length, PACKET_LIMIT)
      const last = entry.pending.charCodeAt(end - 1)
      if (end > 1 && last >= 0xd800 && last <= 0xdbff) end-- // do not split a Unicode surrogate pair
      const data = entry.pending.slice(0, end)
      entry.pending = entry.pending.slice(data.length)
      entry.waiting = ++entry.seq
      entry.pty.pause()
      this.emit(entry.owner, { type: 'data', sessionId: entry.info.sessionId, terminalId: entry.info.terminalId, data, seq: entry.seq })
    }, 12)
  }
  private dispose(entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.subscriptions.forEach(s => s.dispose())
    removeRc(entry.rcDir)
  }
  close(sessionId: string, terminalId: string, owner?: string, force = false): void {
    const entry = this.entries.get(sessionId)
    if (!entry || entry.info.terminalId !== terminalId) return // late close must never kill a replacement shell
    if (owner !== undefined) this.owned(sessionId, terminalId, owner)
    this.entries.delete(sessionId)
    this.dispose(entry)
    const rootIsOwned = process.platform !== 'linux' || (entry.started !== null && identity(entry.info.pid) === entry.started)
    const pids = process.platform === 'linux' && rootIsOwned ? processTree(entry.info.pid) : new Map<number, string>()
    if (rootIsOwned) { try { entry.pty.kill() } catch {} }
    signalOwned(pids, 'SIGHUP')
    const kill = () => {
      if (process.platform === 'linux') signalOwned(pids, 'SIGKILL')
      // node-pty owns the console/process on other platforms; no system-wide name matching.
      else { try { entry.pty.kill() } catch {} }
    }
    if (force) kill()
    else {
      const timer = setTimeout(() => { this.cleanup.delete(timer); kill() }, 800)
      timer.unref()
      this.cleanup.set(timer, kill)
    }
    this.emit(entry.owner, { type: 'exit', sessionId, terminalId, reason: 'closed' })
  }
  closeSession(sessionId: string, force = false): void {
    const entry = this.entries.get(sessionId)
    if (entry) this.close(sessionId, entry.info.terminalId, undefined, force)
  }
  closeOwner(owner: string): void {
    for (const entry of [...this.entries.values()]) if (entry.owner === owner) this.closeSession(entry.info.sessionId, true)
  }
  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.closeSession(id, true)
    for (const [timer, kill] of this.cleanup) { clearTimeout(timer); kill() }
    this.cleanup.clear()
  }
}
