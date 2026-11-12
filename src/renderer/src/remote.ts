import { useEffect, useState, useSyncExternalStore } from 'react'
import type { RemoteStatusSnapshot, RemoteWindowInfo } from '../../shared/types'

// Remote windows run this same renderer; the main process answers their calls from the host.
let info: RemoteWindowInfo | null = null
const listeners = new Set<() => void>()
const resyncListeners = new Set<() => void>()
let initial: Promise<void> | undefined

export function initializeRemoteWindow(): Promise<void> {
  if (!initial) initial = (async () => {
    let received = false
    window.spi.onRemoteWindowChanged(next => {
      received = true
      info = next
      listeners.forEach(listener => listener())
      if (next.resync) resyncListeners.forEach(listener => listener())
    })
    try { const current = await window.spi.getRemoteWindow(); if (!received) info = current } catch {}
  })()
  return initial
}

export function useRemoteWindow(): RemoteWindowInfo | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => info)
}
export function isRemoteWindow(): boolean { return info !== null }
export function useRemoteReadOnly(): boolean {
  const remote = useRemoteWindow()
  return !!remote && remote.access !== 'control'
}
/** Runs after the window reconnected to its host and may have missed events. */
export function onRemoteResync(cb: () => void): () => void { resyncListeners.add(cb); return () => resyncListeners.delete(cb) }

/** IPC errors arrive wrapped as "Error invoking remote method '…': Error: …"; show only the cause. */
export function remoteErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '')
}

export function useRemoteStatus(enabled = true): { status: RemoteStatusSnapshot | null; error: string } {
  const [status, setStatus] = useState<RemoteStatusSnapshot | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    let live = true, received = false
    const off = window.spi.onRemoteStatusChanged(next => { received = true; if (live) { setStatus(next); setError('') } })
    window.spi.getRemoteStatus().then(next => { if (live && !received) setStatus(next) }).catch(e => { if (live) setError(String(e)) })
    return () => { live = false; off() }
  }, [enabled])
  return { status, error }
}
