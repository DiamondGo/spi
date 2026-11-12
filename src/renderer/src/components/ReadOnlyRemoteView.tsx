import { useEffect, useState } from 'react'
import { addSession, getStore, loadHistory, messagesToItems, setActive, useStore } from '../store'
import { remoteErrorText, useRemoteWindow } from '../remote'
import { useT } from '../preferences'
import { ChatView } from './ChatView'

/** Passive observation: never opens a session, creates a PTY or restores a host layout. */
export function ReadOnlyRemoteView(): React.JSX.Element {
  const t = useT()
  const remote = useRemoteWindow()
  const { sessions, activeId } = useStore()
  const [liveIds, setLiveIds] = useState<string[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (remote?.state !== 'connected') return
    let cancelled = false
    const hydrated = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh(): Promise<void> {
      try {
        // Listing is a passive in-memory catalog; no periodic Pi RPC health probes.
        const live = await window.spi.listLiveSessions()
        if (cancelled) return
        setLiveIds(live.map(s => s.sessionId))
        for (const { sessionId, cwd } of live) {
          if (cancelled) return
          if (hydrated.has(sessionId) && getStore().sessions[sessionId]) continue
          const state = await window.spi.getState(sessionId)
          if (cancelled) return
          addSession(sessionId, cwd, state)
          const history = await window.spi.getMessages(sessionId)
          if (!cancelled) { loadHistory(sessionId, messagesToItems(history)); hydrated.add(sessionId) }
        }
        if (!cancelled) setError('')
      } catch (e) { if (!cancelled) setError(remoteErrorText(e)) }
      finally { if (!cancelled) timer = setTimeout(() => void refresh(), 2000) }
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [remote?.state, remote?.resync])
  const active = liveIds.includes(activeId ?? '') ? sessions[activeId!] : sessions[liveIds[0]]
  return <main className="chat" data-remote-read-only>
    {error && <div className="session-error" role="alert">{error}</div>}
    <nav className="session-tabs" aria-label={t('只读会话')}>
      {liveIds.map(id => <button type="button" key={id} className={`session-tab${active?.id === id ? ' active' : ''}`} onClick={() => setActive(id)}>{sessions[id]?.state?.sessionName || sessions[id]?.cwd || id}</button>)}
    </nav>
    {active ? <ChatView session={active} /> : <div className="chat-messages"><div className="placeholder">{t('只读：等待 host 打开会话。')}</div></div>}
  </main>
}
