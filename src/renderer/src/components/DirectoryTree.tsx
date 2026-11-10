import { useEffect, useState } from 'react'
import type { SessionMeta } from '../../../shared/types'
import { Icon, IconControl } from './IconControl'
import { useT } from '../preferences'

interface Props {
  homeDir: string
  selected: string | null
  onSelect: (dir: string) => void
  sessionsByDir: Record<string, SessionMeta[]>
}

export function DirectoryTree({ homeDir, selected, onSelect, sessionsByDir }: Props) {
  const t = useT()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [children, setChildren] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  // 初始展开并加载 home
  useEffect(() => {
    if (homeDir) {
      setExpanded((e) => ({ ...e, [homeDir]: true }))
      loadChildren(homeDir)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeDir])

  async function loadChildren(path: string): Promise<void> {
    if (children[path]) return
    setLoading((l) => ({ ...l, [path]: true }))
    try {
      const dirs = await window.spi.listDirs(path)
      setChildren((c) => ({ ...c, [path]: dirs.sort() }))
    } catch {
      setChildren((c) => ({ ...c, [path]: [] }))
    } finally {
      setLoading((l) => ({ ...l, [path]: false }))
    }
  }

  async function toggle(path: string): Promise<void> {
    if (expanded[path]) {
      setExpanded((e) => ({ ...e, [path]: false }))
      return
    }
    setExpanded((e) => ({ ...e, [path]: true }))
    await loadChildren(path)
  }

  function renderChildren(path: string, depth: number): React.ReactNode {
    const dirs = children[path] ?? []
    return (
      <>
        {dirs.map((name) => {
          const childPath = `${path}/${name}`
          const meta = sessionsByDir[childPath]
          return (
            <div key={childPath}>
              <div
                className={`tree-node ${selected === childPath ? 'selected' : ''}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                title={childPath}
                onClick={() => onSelect(childPath)}
              >
                <IconControl tooltip={t(loading[childPath] ? '正在加载 {name}' : expanded[childPath] ? '收起 {name}' : '展开 {name}', { name })}>
                  <button type="button" className="tree-arrow" aria-label={t(expanded[childPath] ? '收起 {name}' : '展开 {name}', { name })} aria-expanded={Boolean(expanded[childPath])} aria-busy={Boolean(loading[childPath])} disabled={loading[childPath]} onClick={(e) => { e.stopPropagation(); void toggle(childPath) }}>
                    <Icon name={loading[childPath] ? 'loading' : expanded[childPath] ? 'chevron-down' : 'chevron-right'} />
                  </button>
                </IconControl>
                <span className="tree-name">{name}</span>
                {meta && meta.length > 0 && <span className="tree-badge">{meta.length}</span>}
              </div>
              {expanded[childPath] && renderChildren(childPath, depth + 1)}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <div className="dir-tree">
      <div
        className={`tree-node ${selected === homeDir ? 'selected' : ''}`}
        style={{ paddingLeft: 8 }}
        title={homeDir}
        onClick={() => onSelect(homeDir)}
      >
        <IconControl tooltip={t(loading[homeDir] ? '正在加载主目录' : expanded[homeDir] ? '收起主目录' : '展开主目录')}>
          <button type="button" className="tree-arrow" aria-label={t(expanded[homeDir] ? '收起主目录' : '展开主目录')} aria-expanded={Boolean(expanded[homeDir])} aria-busy={Boolean(loading[homeDir])} disabled={loading[homeDir]} onClick={(e) => { e.stopPropagation(); void toggle(homeDir) }}>
            <Icon name={loading[homeDir] ? 'loading' : expanded[homeDir] ? 'chevron-down' : 'chevron-right'} />
          </button>
        </IconControl>
        <span className="tree-name">~</span>
        {sessionsByDir[homeDir] && sessionsByDir[homeDir].length > 0 && (
          <span className="tree-badge">{sessionsByDir[homeDir].length}</span>
        )}
      </div>
      {expanded[homeDir] && renderChildren(homeDir, 1)}
    </div>
  )
}
