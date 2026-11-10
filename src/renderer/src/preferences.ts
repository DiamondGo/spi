import { useSyncExternalStore } from 'react'
import type { AppSettings } from '../../shared/types'
import { translate, type TextParams } from '../../shared/i18n'

let state: { settings: AppSettings; error: string } = {
  settings: { theme: 'dark', language: 'en', confirmOnExit: true }, error: ''
}
const listeners = new Set<() => void>()
function emit(): void { listeners.forEach(listener => listener()) }
function apply(settings: AppSettings): void {
  state = { settings, error: '' }
  document.documentElement.dataset.theme = settings.theme
  document.documentElement.lang = settings.language === 'zh' ? 'zh-CN' : 'en'
  emit()
}
let initial: Promise<void> | undefined
export function initializePreferences(): Promise<void> {
  if (!initial) initial = (async () => {
    let received = false
    window.spi.onAppSettingsChanged(settings => { received = true; apply(settings) })
    try { const settings = await window.spi.getAppSettings(); if (!received) apply(settings) }
    catch (e) { state = { ...state, error: String(e) }; emit() }
  })()
  return initial
}
export function usePreferences() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => state)
}
export function useT() {
  const { settings } = usePreferences()
  return (text: string, params?: TextParams) => translate(text, settings.language, params)
}
export function getT() {
  return (text: string, params?: TextParams) => translate(text, state.settings.language, params)
}
let saveQueue: Promise<unknown> = Promise.resolve()
export function updatePreferences(patch: Partial<AppSettings>): Promise<void> {
  const next = saveQueue.catch(() => {}).then(async () => {
    try { apply(await window.spi.updateAppSettings(patch)) }
    catch (e) { state = { ...state, error: String(e) }; emit(); throw e }
  })
  saveQueue = next
  return next
}
