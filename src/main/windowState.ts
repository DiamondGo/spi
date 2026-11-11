import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import type { BrowserWindow, Rectangle } from 'electron'

export interface WindowState { bounds: Rectangle; maximized: boolean }
function validBounds(value: unknown): value is Rectangle {
  const b = value as Rectangle | undefined
  return !!b && [b.x, b.y, b.width, b.height].every(n => Number.isSafeInteger(n) && Math.abs(n) < 100000) && b.width >= 320 && b.height >= 240
}
export function fitWindow(bounds: Rectangle, areas: Rectangle[]): Rectangle {
  if (!areas.length) return bounds
  const overlap = (a: Rectangle) => Math.max(0, Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x)) * Math.max(0, Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y))
  const area = areas.reduce((best, next) => overlap(next) > overlap(best) ? next : best)
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height)
  return { x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))), width, height }
}
export function loadWindowState(file: string, areas: Rectangle[]): WindowState {
  const area = areas[0]
  const width = Math.min(1280, area?.width ?? 1280), height = Math.min(800, area?.height ?? 800)
  let state: WindowState = { bounds: { x: area ? Math.round(area.x + (area.width - width) / 2) : 0, y: area ? Math.round(area.y + (area.height - height) / 2) : 0, width, height }, maximized: false }
  try {
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      if (validBounds(data.bounds) && typeof data.maximized === 'boolean') state = data
    }
  } catch {}
  return { bounds: fitWindow(state.bounds, areas), maximized: state.maximized }
}
export function trackWindowState(win: BrowserWindow, file: string): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let maximized = win.isMaximized()
  const save = () => {
    clearTimeout(timer)
    if (win.isDestroyed() || win.isFullScreen()) return
    if (!win.isMinimized()) maximized = win.isMaximized()
    const bounds = win.getNormalBounds()
    if (!validBounds(bounds)) return
    const temp = file + '.' + randomUUID() + '.tmp'
    try { writeFileSync(temp, JSON.stringify({ bounds, maximized }), { mode: 0o600 }); renameSync(temp, file) }
    catch (error) { console.error('[sPi] Could not save window placement:', (error as Error).message) }
    finally { try { rmSync(temp, { force: true }) } catch {} }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(save, 300) }
  win.on('move', schedule); win.on('resize', schedule)
  win.on('maximize', () => { maximized = true; schedule() })
  win.on('unmaximize', () => { maximized = false; schedule() })
  win.on('close', save)
  win.on('closed', () => clearTimeout(timer))
}
