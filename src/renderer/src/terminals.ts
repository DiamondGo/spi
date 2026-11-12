import { useSyncExternalStore } from 'react'
import type { TerminalInfo } from '../../shared/types'
import { getStore } from './store'

type TerminalView = TerminalInfo & { focusRequest: number; hidden: boolean; attachment?: number }
let state: { terminals: Record<string, TerminalView>; opening: Record<string, boolean>; errors: Record<string, string> } = { terminals: {}, opening: {}, errors: {} }
const listeners = new Set<() => void>()
const requests = new Map<string, Promise<void>>()
const exited = new Set<string>()
function emit(): void { listeners.forEach(listener => listener()) }
export function useTerminals() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => state)
}
export function subscribeTerminalState(): () => void {
  return window.spi.onTerminalEvent(event => {
    const current = state.terminals[event.sessionId]
    if (event.type === 'exit') {
      exited.add(event.terminalId)
      if (exited.size > 100) exited.delete(exited.values().next().value!)
      if (current?.terminalId === event.terminalId) forgetTerminalSession(event.sessionId)
    } else if (event.type === 'error' && current?.terminalId === event.terminalId) {
      state = { ...state, errors: { ...state.errors, [event.sessionId]: event.message } }; emit()
    }
  })
}
export function forgetTerminalSession(id: string): void {
  const terminals = { ...state.terminals }, errors = { ...state.errors }, opening = { ...state.opening }
  delete terminals[id]; delete errors[id]; delete opening[id]
  state = { terminals, errors, opening }; emit()
}
export function clearTerminalError(id: string): void {
  const errors = { ...state.errors }; delete errors[id]; state = { ...state, errors }; emit()
}
export function openSessionTerminal(id: string): Promise<void> {
  const current = state.terminals[id]
  if (current) {
    state = { ...state, terminals: { ...state.terminals, [id]: { ...current, hidden: false, focusRequest: current.focusRequest + 1 } } }; emit()
    return Promise.resolve()
  }
  const pending = requests.get(id)
  if (pending) return pending
  state = { ...state, opening: { ...state.opening, [id]: true }, errors: { ...state.errors, [id]: '' } }; emit()
  const request = (async () => {
    try {
      const info = await window.spi.openTerminal(id, 80, 12)
      if (!getStore().sessions[id]) { await window.spi.closeTerminal(id, info.terminalId); return }
      if (exited.has(info.terminalId)) throw new Error('The shell exited during startup')
      state = { ...state, terminals: { ...state.terminals, [id]: { ...info, hidden: false, focusRequest: 1 } } }; emit()
    } catch (error) {
      if (getStore().sessions[id]) { state = { ...state, errors: { ...state.errors, [id]: String(error) } }; emit() }
    } finally {
      requests.delete(id)
      const opening = { ...state.opening }; delete opening[id]; state = { ...state, opening }; emit()
    }
  })()
  requests.set(id, request)
  return request
}
/**
 * Remounts every terminal view so it attaches again: a fresh snapshot replaces output missed while
 * disconnected. Terminals the host closed meanwhile (it restarted or the grace period ran out) are dropped.
 */
export async function reattachTerminals(): Promise<void> {
  for (const [id, view] of Object.entries(state.terminals)) {
    let live: string | undefined
    try { live = (await window.spi.getTerminal(id))?.terminalId } catch { return }
    const current = state.terminals[id]
    if (!current || current.terminalId !== view.terminalId) continue
    if (live !== view.terminalId) { forgetTerminalSession(id); continue }
    state = { ...state, terminals: { ...state.terminals, [id]: { ...current, attachment: (current.attachment ?? 0) + 1 } } }; emit()
  }
}
export function hideSessionTerminal(id: string): void {
  const current = state.terminals[id]
  if (!current) return
  state = { ...state, terminals: { ...state.terminals, [id]: { ...current, hidden: true } } }; emit()
}
export function toggleSessionTerminal(id: string): Promise<void> {
  if (state.terminals[id] && !state.terminals[id].hidden) { hideSessionTerminal(id); return Promise.resolve() }
  return openSessionTerminal(id)
}
export async function closeSessionTerminal(id: string, terminalId: string): Promise<void> {
  try {
    await window.spi.closeTerminal(id, terminalId)
    if (state.terminals[id]?.terminalId === terminalId) forgetTerminalSession(id)
  } catch (error) { state = { ...state, errors: { ...state.errors, [id]: String(error) } }; emit() }
}
