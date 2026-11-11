import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { validateNodePath } from './piInvocation'
import { join } from 'path'

// 手动指定的 pi 路径保存在 GUI 自己的本地文件里，不碰 ~/.pi
function configPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'spi-config.json')
}

export function loadManualPiPath(): string | null {
  try {
    const cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
    return typeof cfg.piPath === 'string' ? cfg.piPath : null
  } catch {
    return null
  }
}

export function saveManualPiPath(p: string): void {
  let cfg: Record<string, unknown> = {}
  try {
    cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {}
  cfg.piPath = p
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}

export function loadManualNodePath(): string | null {
  try { const value = JSON.parse(readFileSync(configPath(), 'utf8')).nodePath; return typeof value === 'string' && value ? value : null }
  catch { return null }
}

export function saveManualNodePath(value: unknown): void {
  if (value !== null && value !== '' && typeof value !== 'string') throw new Error('Invalid Node.js path')
  const selected = value === null || value === '' ? null : validateNodePath(value)
  const file = configPath()
  let cfg: Record<string, unknown> = {}
  try { const data = JSON.parse(readFileSync(file, 'utf8')); if (data && typeof data === 'object' && !Array.isArray(data)) cfg = data } catch {}
  if (selected) cfg.nodePath = selected
  else delete cfg.nodePath
  const temp = file + '.' + randomUUID() + '.tmp'
  try { writeFileSync(temp, JSON.stringify(cfg, null, 2), { mode: 0o600 }); renameSync(temp, file) }
  finally { rmSync(temp, { force: true }) }
}

// pin 的会话路径列表（存 GUI 自己的配置，不碰 ~/.pi）
export function loadPinned(): string[] {
  try {
    const cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
    return Array.isArray(cfg.pinned) ? (cfg.pinned as string[]) : []
  } catch {
    return []
  }
}

export function togglePinned(p: string): string[] {
  let cfg: Record<string, unknown> = {}
  try {
    cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {}
  const pinned = Array.isArray(cfg.pinned) ? (cfg.pinned as string[]) : []
  cfg.pinned = pinned.includes(p) ? pinned.filter((x) => x !== p) : [...pinned, p]
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
  return cfg.pinned as string[]
}

// 布局状态：视图模式 + 选中目录 + 打开的会话（存 GUI 自己的配置）
export interface LayoutState {
  viewMode?: string
  selectedDir?: string | null
  sidebarSplit?: number
  sessions?: Array<{ cwd: string; sessionPath?: string }>
}

export function loadLayout(): LayoutState {
  try {
    const cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
    const layout = (cfg.layout as LayoutState) ?? {}
    // 过滤掉 cwd 已不存在的会话（如目录被改名/删除），避免每次启动都尝试重开并报错
    if (Array.isArray(layout.sessions)) {
      layout.sessions = layout.sessions.filter((s) => s.cwd && existsSync(s.cwd))
    }
    if (layout.selectedDir && !existsSync(layout.selectedDir)) {
      layout.selectedDir = null
    }
    return layout
  } catch {
    return {}
  }
}

export function saveLayout(s: LayoutState): void {
  let cfg: Record<string, unknown> = {}
  try {
    cfg = JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {}
  cfg.layout = s
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}

function run(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

/**
 * 找 pi：
 * 1. 手动指定的路径
 * 2. 当前 PATH（which pi）
 * 3. 用户登录 shell 的 PATH（nvm / npm 全局等场景）
 */
export async function findPi(): Promise<string | null> {
  const manual = loadManualPiPath()
  if (manual && existsSync(manual)) return manual

  try {
    const p = await run(process.platform === 'win32' ? 'where' : 'which', [process.platform === 'win32' ? 'pi.cmd' : 'pi'])
    const first = p.split('\n')[0]
    if (first && existsSync(first)) return first
  } catch {}

  // 登录 shell 解析（桌面启动拿不到终端 PATH 的兜底）
  try {
    let p: string
    if (process.platform === 'win32') {
      p = await run('powershell', ['-NoProfile', '-Command', '(Get-Command pi -ErrorAction SilentlyContinue).Source'], 8000)
    } else {
      p = await run('bash', ['-lc', 'command -v pi'], 8000)
    }
    const first = p.split('\n')[0]?.trim()
    if (first && existsSync(first)) return first
  } catch {}

  return null
}
