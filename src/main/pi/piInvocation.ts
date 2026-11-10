import { existsSync, readFileSync } from 'fs'
import { delimiter, dirname, join, resolve, sep } from 'path'
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
export function piInvocation(file: string, args: string[], env: NodeJS.ProcessEnv): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (process.platform !== 'win32' || !/\.(cmd|[cm]?js)$/i.test(file)) return { command: file, args, env }
  const entry = /\.cmd$/i.test(file) ? entryFromShim(file, readFileSync(file, 'utf8')) : file
  if (!entry) throw new Error('Cannot resolve Pi batch launcher. Select the actual Pi cli.js path.')
  const candidates = [
    join(dirname(file), 'node.exe'),
    join(process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local'), 'pi-node', 'current', 'node.exe'),
    join(process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local'), 'pi-node', 'current', 'bin', 'node.exe'),
    ...(env.PATH || env.Path || '').split(delimiter).map(p => join(p, 'node.exe'))
  ]
  for (const command of candidates) {
    if (!existsSync(command)) continue
    try {
      const clean = { ...env }; delete clean.ELECTRON_RUN_AS_NODE
      const match = execFileSync(command, ['--version'], { env: clean, timeout: 5000, windowsHide: true }).toString().match(/^v(\d+)\.(\d+)/)
      if (match && (+match[1] > 22 || (+match[1] === 22 && +match[2] >= 19))) return { command, args: [entry, ...args], env: clean }
    } catch {}
  }
  throw new Error('Pi requires Node.js >=22.19 on PATH or in the Pi-managed runtime directory')
}
