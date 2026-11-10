import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { AppSettings, AppTheme } from '../shared/types'

export const defaultSettings: AppSettings = { theme: 'dark', language: 'en', confirmOnExit: true }
export const themeChrome: Record<AppTheme, { color: string; symbolColor: string; background: string }> = {
  dark: { color: '#252525', symbolColor: '#bbbbbb', background: '#1e1e1e' },
  light: { color: '#f0f2f5', symbolColor: '#273142', background: '#ffffff' },
  'high-contrast': { color: '#000000', symbolColor: '#ffffff', background: '#000000' }
}

function valid(key: string, value: unknown): boolean {
  return key === 'theme' ? ['dark', 'light', 'high-contrast'].includes(value as string)
    : key === 'language' ? ['en', 'zh'].includes(value as string)
    : key === 'confirmOnExit' && typeof value === 'boolean'
}

export class SettingsStore {
  private settings = { ...defaultSettings }
  constructor(private file: string) {
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'))
        for (const key of Object.keys(defaultSettings) as Array<keyof AppSettings>) {
          if (valid(key, data?.[key])) Object.assign(this.settings, { [key]: data[key] })
        }
      } catch (e) { console.error('[sPi settings] Cannot read preferences; using safe defaults:', e) }
    }
  }
  get(): AppSettings { return { ...this.settings } }
  update(patch: Partial<AppSettings>): AppSettings {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.entries(patch).some(([key, value]) => !valid(key, value))) {
      throw new Error('Invalid sPi settings')
    }
    const next = { ...this.settings, ...patch }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 })
    renameSync(this.file + '.tmp', this.file)
    this.settings = next
    return this.get()
  }
}
