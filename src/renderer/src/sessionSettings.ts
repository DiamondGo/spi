import { useEffect, useState } from 'react'
import type { PiModel } from '../../shared/types'
import { setSessionState, type SessionUI } from './store'

// Header and composer edit the same authoritative per-session pi state.
export function useSessionSettings(session: SessionUI | null) {
  const id = session?.id
  const model = session?.state?.model ?? null
  const level = session?.state?.thinkingLevel ?? 'off'
  // Keep known choices across tab switches; never temporarily replace the current model with ''.
  const [models, setModels] = useState<Record<string, PiModel[]>>({})
  const [levels, setLevels] = useState<Record<string, string[]>>({})
  const [statuses, setStatuses] = useState<Record<string, { busy: boolean; error: string }>>({})
  const key = `${id}:${model?.provider}/${model?.id}`
  const status = id ? statuses[id] : undefined

  function setError(sessionId: string, error: string): void {
    setStatuses(previous => ({ ...previous, [sessionId]: { busy: previous[sessionId]?.busy ?? false, error } }))
  }

  useEffect(() => {
    let live = true
    if (id) window.spi.getAvailableModels(id).then(values => {
      if (live) setModels(previous => ({ ...previous, [id]: values }))
    }).catch(e => { if (live) setError(id, String(e)) })
    return () => { live = false }
  }, [id])

  useEffect(() => {
    let live = true
    if (id) window.spi.getAvailableThinkingLevels(id).then(values => {
      if (live) setLevels(previous => ({ ...previous, [key]: values }))
    }).catch(e => { if (live) setError(id, String(e)) })
    return () => { live = false }
  }, [id, key])

  async function update(action: (sessionId: string) => Promise<void>): Promise<void> {
    if (!id) return
    setStatuses(previous => ({ ...previous, [id]: { busy: true, error: '' } }))
    try {
      await action(id)
      // Pi clamps the thinking level on a model change. Don't impose a second GUI fallback.
      setSessionState(id, await window.spi.getState(id))
    } catch (e) { setError(id, String(e)) } finally {
      setStatuses(previous => ({ ...previous, [id]: { busy: false, error: previous[id]?.error ?? '' } }))
    }
  }

  return {
    models: id ? models[id] ?? [] : [],
    levels: levels[key] ?? [],
    model,
    level,
    busy: status?.busy ?? false,
    error: status?.error ?? '',
    changeModel: async (value: string) => {
      const [provider, ...rest] = value.split('/')
      if (!provider || !rest.join('/')) return
      await update(sessionId => window.spi.setModel(sessionId, provider, rest.join('/')))
    },
    changeLevel: (value: string) => update(sessionId => window.spi.setThinkingLevel(sessionId, value))
  }
}
