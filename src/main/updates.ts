import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import os from 'node:os'
import type { AppUpdateState } from '../shared/types'

const OWNER = 'sPi-installer-v1'
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const MAX_OUTPUT = 2 * 1024 * 1024
export type InstallerRunner = (args: string[], progress?: (line: string) => void) => Promise<unknown>

/** Preserve a custom managed root; manual application bundles migrate without being overwritten. */
export function updateRoot(executable: string, platform = process.platform, home = os.homedir()): string {
  let directory = dirname(executable)
  for (let i = 0; i < 12; i++) {
    try {
      const marker = JSON.parse(readFileSync(join(directory, '.spi-owned.json'), 'utf8'))
      const base = realpathSync(directory) + sep
      const actual = realpathSync(executable)
      if (marker.owner === OWNER && actual.startsWith(base + 'releases' + sep)) return directory
    } catch { /* Unmanaged app, or still below the installation root. */ }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'sPi')
  return join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'spi')
}

/** Direct relaunches do not have a CLI parent to protect the running runtime from uninstall. */
export function trackManagedRuntime(executable = process.execPath): () => void {
  const root = updateRoot(executable)
  try {
    const marker = JSON.parse(readFileSync(join(root, '.spi-owned.json'), 'utf8'))
    if (marker.owner !== OWNER || !realpathSync(executable).startsWith(realpathSync(root) + sep + 'releases' + sep)) return () => {}
    const directory = join(root, '.running')
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('Invalid runtime records')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    let start: string | null = null
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${process.pid}/stat`, 'utf8')
      start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
    }
    const token = randomUUID(), record = join(directory, token + '.json')
    const temporary = join(root, '.running-record-' + token + '.tmp')
    try {
      writeFileSync(temporary, JSON.stringify({ pid: process.pid, start }), { flag: 'wx', mode: 0o600 })
      renameSync(temporary, record)
    } finally { rmSync(temporary, { force: true }) }
    return () => { try { rmSync(record, { force: true }) } catch { /* Already removed on shutdown. */ } }
  } catch (error) {
    // Unmanaged manual copies have no marker. Do not create or take ownership of their directories.
    if (existsSync(join(root, '.spi-owned.json'))) console.error('[sPi runtime record]', error)
    return () => {}
  }
}

/** Run only our bundled installer with the private Electron Node runtime, never npm or a shell. */
export function installerRunner(executable: string, installer: string): InstallerRunner {
  return (args, progress) => new Promise((accept, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_VITE_DEV_SERVER_URL', 'SPI_RELEASE_REPOSITORY', 'SPI_RELEASE_BASE_URL', 'SPI_RELEASE_API_URL', 'SPI_ALLOW_TEST_HTTP', 'SPI_INSTALL_ROOT', 'SPI_BIN_DIR']) delete env[name]
    const child = spawn(executable, [installer, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = '', stderr = '', pending = '', settled = false
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (error) reject(error); else accept(result)
    }
    const timer = setTimeout(() => { child.kill(); finish(new Error('Update installer timed out')) }, 65 * 60 * 1000)
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
      if (Buffer.byteLength(stdout) > MAX_OUTPUT) { child.kill(); finish(new Error('Invalid installer output')) }
    })
    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      stderr = (stderr + text).slice(-8192)
      pending = (pending + text).slice(-8192)
      const lines = pending.split(/\r?\n/); pending = lines.pop() || ''
      for (const line of lines) if (line.startsWith('[sPi] ')) progress?.(line.slice(6))
    })
    child.once('error', error => finish(error))
    child.once('close', code => {
      if (code !== 0) return finish(new Error(stderr.trim().slice(-2000) || 'Update installer failed'))
      try { finish(undefined, JSON.parse(stdout)) } catch { finish(new Error('Invalid installer response')) }
    })
  })
}

/** Prefer an existing owned command; never overwrite a user's unrelated PATH entry. */
export function updateBinDirectory(root: string, home = os.homedir()): string {
  try {
    const record = JSON.parse(readFileSync(join(root, 'install-state.json'), 'utf8'))
    if (record.owner === OWNER && Array.isArray(record.shims)) for (const item of record.shims) {
      if (typeof item.path !== 'string' || !item.path.endsWith(sep + 'spi')) continue
      try {
        const stat = lstatSync(item.path)
        if (stat.isFile() && !stat.isSymbolicLink() && createHash('sha256').update(readFileSync(item.path)).digest('hex') === item.sha256) return dirname(item.path)
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return dirname(item.path) }
    }
  } catch { /* No managed command yet. */ }
  const normal = join(home, '.local', 'bin')
  try { lstatSync(join(normal, 'spi')); return join(root, 'bin') } catch { return normal }
}

interface Options {
  version: string
  target: string
  root: string
  home?: string
  run: InstallerRunner
  changed: (state: AppUpdateState) => void
}

export class AppUpdates {
  private state: AppUpdateState
  private checking: Promise<AppUpdateState> | null = null
  private installing: Promise<AppUpdateState> | null = null
  private executable: string | null = null
  constructor(private options: Options) {
    this.state = { phase: 'idle', currentVersion: options.version, target: options.target, installRoot: options.root,
      commandPath: join(updateBinDirectory(options.root, options.home), 'spi') }
  }
  snapshot(): AppUpdateState { return { ...this.state } }
  get busy(): boolean { return this.state.phase === 'installing' }
  private publish(patch: Partial<AppUpdateState>): AppUpdateState {
    this.state = { ...this.state, ...patch }; this.options.changed(this.snapshot()); return this.snapshot()
  }
  check(): Promise<AppUpdateState> {
    if (this.installing) return this.installing
    if (this.executable) return Promise.resolve(this.snapshot())
    if (this.checking) return this.checking
    this.publish({ phase: 'checking', error: undefined })
    this.checking = this.options.run(['check-update', '--current-version', this.options.version, '--json']).then(value => {
      const result = value as Record<string, unknown> | null
      if (!result || result.currentVersion !== this.options.version || result.target !== this.options.target ||
        typeof result.version !== 'string' || !VERSION.test(result.version) || typeof result.available !== 'boolean' || typeof result.supported !== 'boolean' ||
        result.releaseUrl !== 'https://github.com/DiamondGo/spi/releases/tag/v' + result.version) throw new Error('Invalid update metadata')
      if (result.available && result.supported && (result.file !== `spi-${result.version}-${this.options.target}${this.options.target.startsWith('linux-') ? '.tar.gz' : '.zip'}` ||
        !Number.isSafeInteger(result.size) || Number(result.size) <= 0 || Number(result.size) > 700 * 1024 * 1024)) throw new Error('Invalid update archive metadata')
      return this.publish({ phase: result.available ? 'available' : 'current', version: result.version, available: result.available, supported: result.supported,
        size: result.size as number | undefined, checkedAt: Date.now(), progress: undefined, percent: undefined, error: undefined })
    }).catch(error => this.publish({ phase: 'error', error: String(error) })).finally(() => { this.checking = null })
    return this.checking
  }
  install(): Promise<AppUpdateState> {
    if (this.installing) return this.installing
    if (this.executable) return Promise.resolve(this.snapshot())
    if (this.checking || !this.state.available || !this.state.supported || !this.state.version) return Promise.reject(new Error('Check for a supported update first'))
    const version = this.state.version
    this.publish({ phase: 'installing', error: undefined, progress: undefined, percent: 0 })
    const binDirectory = updateBinDirectory(this.options.root, this.options.home)
    this.installing = this.options.run(['install', '--version', version, '--install-dir', this.options.root, '--bin-dir', binDirectory, '--json'], line => {
      const match = /\((\d+)%\)/.exec(line)
      this.publish({ progress: line, ...(match ? { percent: Math.min(100, Number(match[1])) } : {}) })
    }).then(value => {
      const result = value as Record<string, unknown> | null
      const directory = join(this.options.root, 'releases', version, this.options.target)
      if (!result || result.version !== version || result.target !== this.options.target || typeof result.entryPath !== 'string' ||
        typeof result.entry !== 'string' || !result.entry.startsWith('app/') || result.entry.split('/').includes('..') ||
        resolve(result.entryPath) !== resolve(directory, result.entry) || !statSync(result.entryPath).isFile() ||
        !realpathSync(result.entryPath).startsWith(realpathSync(directory) + sep)) throw new Error('Installed runtime validation failed')
      this.executable = result.entryPath
      return this.publish({ phase: 'ready', percent: 100, progress: undefined, error: undefined, commandPath: join(binDirectory, 'spi') })
    }).catch(error => this.publish({ phase: 'error', error: String(error) })).finally(() => { this.installing = null })
    return this.installing
  }
  /** Recheck presence and containment immediately before scheduling a restart. */
  restartExecutable(): string {
    if (this.state.phase !== 'ready' || !this.executable || !existsSync(this.executable) ||
      !realpathSync(this.executable).startsWith(realpathSync(join(this.options.root, 'releases', this.state.version!, this.options.target)) + sep)) throw new Error('No verified update is ready')
    return this.executable
  }
}
