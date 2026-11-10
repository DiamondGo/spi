// Display only. Never feed abbreviated paths back into filesystem/launch APIs.
export function shortenHome(path: string, home: string): string {
  const windows = /^[a-z]:[\\/]/i.test(home) || home.startsWith('\\\\')
  const normalized = windows ? path.replaceAll('\\', '/') : path
  const base = (windows ? home.replaceAll('\\', '/') : home).replace(/\/+$/, '')
  if (base.length < 2) return path
  const source = windows ? normalized.toLowerCase() : normalized
  const prefix = windows ? base.toLowerCase() : base
  if (source === prefix) return '~'
  return source.startsWith(prefix + '/') ? '~' + normalized.slice(base.length) : path
}
export function sidebarSplit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(.1, Math.min(.9, value)) : .5
}
export function splitAtPointer(y: number, top: number, height: number): number {
  if (height <= 0) return .5
  const margin = Math.min(90 / height, .4)
  return Math.max(margin, Math.min(1 - margin, sidebarSplit((y - top) / height)))
}
