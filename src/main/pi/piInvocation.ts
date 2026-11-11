import { existsSync, readFileSync, statSync } from 'fs'
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'path'
import { execFileSync } from 'child_process'
import os from 'os'

// npm .cmd shims cannot be spawn()ed directly. Resolve their Node entry, never shell-interpolate arguments.
export function entryFromShim(file: string, text: string): string | null {
  const matches = text.matchAll(/%(?:dp0%|~dp0)[\\/]([^"\r\n]+?\.(?:cjs|mjs|js))(?=["\s]|$)/gi)
  for (const match of matches) {
    const entry = resolve(dirname(file), match[1].replace(/[\\/]/g, sep))
    if (existsSync(entry)) return entry
  }
  const install = resolve(dirname(file), '..', 'install')
  try {
    const version = readFileSync(join(install, 'current-version'), 'utf8').trim()
    if (/^[\w.+-]+$/.test(version) && !['.', '..'].includes(version)) {
      const entry = join(install, 'releases', version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
      if (existsSync(entry)) return entry
    }
  } catch {}
  return null
}

const verifiedNodes = new Map<string, string>()
function probeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env }
  // Probes/login startup must not receive the private RPC bridge token or run preload hooks.
  for (const key of ['ELECTRON_RUN_AS_NODE', 'SPI_PERMISSION_TOKEN', 'NODE_OPTIONS', 'NODE_PATH']) delete clean[key]
  return clean
}
function compatibleNode(file: string, env: NodeJS.ProcessEnv): boolean {
  try {
    if (!isAbsolute(file)) return false
    const info = statSync(file), stamp = info.mtimeMs + ':' + info.size
    if (!info.isFile()) return false
    if (verifiedNodes.get(file) === stamp) return true
    const text = execFileSync(file, ['--version'], { env: probeEnvironment(env), timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4096 }).toString()
    const match = text.match(/^v(\d+)\.(\d+)\.\d+\s*$/)
    if (!match || !(+match[1] > 22 || (+match[1] === 22 && +match[2] >= 19))) return false
    if (verifiedNodes.size >= 32) verifiedNodes.clear()
    verifiedNodes.set(file, stamp)
    return true
  } catch { return false }
}

/** Resolve Node for the child only. Finding a Pi path in a login shell is not enough:
 * desktop launchers and already-running GUIs can have a different/stale PATH. */
export function nodeForPi(file: string, env: NodeJS.ProcessEnv): string | null {
  const home = env.HOME || env.USERPROFILE || os.homedir()
  const win = process.platform === 'win32', name = win ? 'node.exe' : 'node'
  const candidates = [
    ...(env.PATH || env.Path || '').split(delimiter).filter(Boolean).map(p => join(p, name)),
    join(dirname(file), name),
    ...(win ? [
      join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'pi-node', 'current', 'node.exe'),
      join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'pi-node', 'current', 'bin', 'node.exe')
    ] : [join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'pi-node', 'current', 'bin', 'node')])
  ]
  for (const candidate of new Set(candidates)) if (compatibleNode(candidate, env)) return candidate
  if (win) return null
  const marker = '__SPI_NODE_PATH__'
  const shells = [env.SHELL, '/bin/bash', '/bin/sh'].filter((s): s is string => !!s && isAbsolute(s))
  for (const shell of new Set(shells)) {
    try {
      const output = execFileSync(shell, ['-lc', `printf '${marker}%s\\n' "$(command -v node 2>/dev/null)"`], {
        cwd: home, env: probeEnvironment(env), timeout: 3000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'ignore']
      }).toString()
      // Ignore profile banners; never interpolate the selected Pi path/arguments into a shell.
      const line = output.split('\n').reverse().find(s => s.startsWith(marker))
      const candidate = line?.slice(marker.length).replace(/\r$/, '')
      if (candidate && compatibleNode(candidate, env)) return candidate
    } catch {}
  }
  return null
}

export function validateNodePath(file: unknown, env: NodeJS.ProcessEnv = process.env): string {
  if (typeof file !== 'string' || !isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file) || !compatibleNode(file, env)) {
    throw new Error('Configured Node.js must be an absolute executable path with version >=22.19. Fix the path in Settings or clear it to use automatic detection.')
  }
  return file
}

export function piInvocation(file: string, args: string[], env: NodeJS.ProcessEnv, manualNode?: string | null): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const clean = { ...env }
  delete clean.ELECTRON_RUN_AS_NODE
  const node = manualNode ? validateNodePath(manualNode, clean) : nodeForPi(file, clean)
  if (node) {
    clean.PATH = dirname(node) + delimiter + (env.PATH || env.Path || '')
    if (process.platform === 'win32') delete clean.Path
  }
  if (process.platform === 'win32' && /\.cmd$/i.test(file)) {
    const entry = entryFromShim(file, readFileSync(file, 'utf8'))
    if (!entry) throw new Error('Cannot resolve Pi batch launcher. Select the actual Pi cli.js path.')
    if (!node) throw new Error('Pi requires Node.js >=22.19 on PATH or in the Pi-managed runtime directory')
    return { command: node, args: [entry, ...args], env: clean }
  }
  if (/\.[cm]?js$/i.test(file)) {
    if (!node) throw new Error('Node.js >=22.19 was not found in the GUI PATH, Pi-managed runtime or login shell. Select a working Pi launcher or launch sPi from your configured terminal.')
    return { command: node, args: [file, ...args], env: clean }
  }
  // Preserve shell/native launchers and their flags (including private Node setup).
  return { command: file, args, env: clean }
}
