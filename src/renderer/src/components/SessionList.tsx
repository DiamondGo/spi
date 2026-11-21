import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { SessionMeta } from '../../../shared/types'
import { openSession, setActive, useStore } from '../store'
import { sessionRows } from '../sessionRows'
import { HomeDirectory, usePathFormatter } from '../homePath'
import { Icon, IconControl } from './IconControl'
import { useT } from '../preferences'
import { useSessionActions } from './SessionActions'

interface Props {
  dir: string | null
  onOpen: (m: SessionMeta) => void
  onSelectDir: (dir: string) => void
}

export function SessionList({ dir, onOpen, onSelectDir }: Props) {
  const t = useT(), formatPath = usePathFormatter()
  const home = useContext(HomeDirectory)
  const { sessions, activeId, catalogRevision } = useStore()
  const actions = useSessionActions()
  const openKey = Object.values(sessions).filter(s => s.cwd === dir).map(s => s.id + ':' + s.state?.sessionFile + ':' + s.state?.sessionName + ':' + s.items.some(x => x.kind === 'user')).join(',')
  const [meta, setMeta] = useState<SessionMeta[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingPath, setEditingPath] = useState(false)
  const [pathDraft, setPathDraft] = useState('')
  const [jumpError, setJumpError] = useState<string | null>(null)
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++generation.current
    if (!dir) {
      setMeta([])
      return
    }
    try {
      const rows = await window.spi.scanSessions(dir)
      if (ticket !== generation.current) return
      setMeta(rows)
      setError(null)
    } catch (e) {
      if (ticket === generation.current) setError(String(e))
    }
  }, [dir])

  useEffect(() => {
    void refresh()
    return () => { generation.current++ }
  }, [refresh, openKey, catalogRevision])

  // 切换目录时清空多选；行消失时剪掉失效的选中项。
  useEffect(() => { setSelected(new Set()) }, [dir])
  const rows = sessionRows(meta, sessions, dir)
  useEffect(() => {
    setSelected(prev => {
      const valid = new Set(rows.map(r => r.path))
      const next = new Set([...prev].filter(p => valid.has(p)))
      return next.size === prev.size ? prev : next
    })
  }, [rows])

  async function newSession(): Promise<void> {
    if (!dir || creating) return
    setCreating(true)
    setError(null)
    try {
      await openSession(dir)
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  // 标题可编辑：输入路径回车后验证并跳转；目录不存在时提示错误并留在原目录。
  function startEditPath(): void {
    if (!dir) return
    setJumpError(null)
    setPathDraft(dir)
    setEditingPath(true)
  }
  async function commitPathJump(): Promise<void> {
    setEditingPath(false)
    const raw = pathDraft.trim()
    if (!raw || raw === dir) return
    // 支持 ~ 展开；其余按绝对路径处理。
    const target = raw === '~' ? home : raw.startsWith('~/') && home ? home + raw.slice(1) : raw
    try {
      await window.spi.listDirs(target)
      setJumpError(null)
      onSelectDir(target)
    } catch {
      setJumpError(t('无法打开目录：{path}', { path: target }))
    }
  }

  if (!dir) return <div className="session-list"><div className="placeholder">{t('选择一个目录')}</div></div>

  return (
    <div className="session-list">
      <div className="session-list-header">
        {editingPath ? (
          <input
            className="session-list-path-input"
            autoFocus
            spellCheck={false}
            value={pathDraft}
            onChange={event => setPathDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); void commitPathJump() }
              if (event.key === 'Escape') { event.preventDefault(); setEditingPath(false) }
            }}
            onBlur={() => setEditingPath(false)}
          />
        ) : (
          <span className="session-list-title" title={t('点击输入目录跳转')} onClick={startEditPath}>{formatPath(dir)}</span>
        )}
        <IconControl tooltip={creating ? t('正在新建会话…') : t('新建会话 · {dir}', { dir: formatPath(dir) })}>
          <button type="button" className="btn-new sidebar-icon-button" aria-label={t('新建会话')} aria-busy={creating} disabled={creating} onClick={newSession}>
            <Icon name={creating ? 'loading' : 'plus'} />
          </button>
        </IconControl>
      </div>
      {jumpError && <div className="session-error" role="alert">{jumpError} <button onClick={() => setJumpError(null)}>{t('关闭提示')}</button></div>}
      {error && <div className="session-error">{error}</div>}
      {rows.length === 0 && <div className="placeholder">{t('该目录没有 pi 会话')}</div>}
      {rows.map((m) => (
        <div key={m.path} className={`session-item${m.liveId === activeId ? ' active' : ''}${selected.has(m.path) ? ' selected' : ''}`} aria-current={m.liveId === activeId ? 'true' : undefined} aria-selected={selected.has(m.path) || undefined} data-session-path={m.path} onContextMenu={event => selected.size > 0 ? actions.menuMulti(event, rows.filter(r => selected.has(r.path)).map(r => ({ sessionId: r.liveId, path: r.path, cwd: r.cwd, label: r.name || r.title || '' }))) : actions.menu(event, { sessionId: m.liveId, path: m.path, cwd: m.cwd, label: m.name || m.title || '' })} title={formatPath(m.path)} tabIndex={0} onClick={event => {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            setSelected(prev => { const next = new Set(prev); if (next.has(m.path)) next.delete(m.path); else next.add(m.path); return next })
            return
          }
          setSelected(new Set())
          if (m.liveId) setActive(m.liveId); else onOpen(m)
        }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (m.liveId) setActive(m.liveId); else onOpen(m) } }}>
          <div className="session-item-title" onDoubleClick={event => { event.stopPropagation(); actions.rename({ sessionId: m.liveId, path: m.path, cwd: m.cwd, label: m.name || m.title || '' }) }}>{m.name || m.title || t('(无标题)')}</div>
          <div className="session-item-meta">{new Date(m.mtime).toLocaleString(document.documentElement.lang)}</div>
        </div>
      ))}
    </div>
  )
}
