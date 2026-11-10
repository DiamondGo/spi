import { useRef, type ReactNode } from 'react'
import { sidebarSplit, splitAtPointer } from '../pathFormat'
import { useT } from '../preferences'
export function SidebarSplit({ value, onChange, children }: { value: number; onChange(value: number): void; children: [ReactNode, ReactNode] }) {
  const host = useRef<HTMLDivElement>(null)
  const t = useT()
  const ratio = sidebarSplit(value)
  return <div className="sidebar-split" ref={host} style={{ gridTemplateRows: `minmax(min(80px, 40%), ${ratio}fr) 7px minmax(min(90px, 40%), ${1 - ratio}fr)` }}>
    {children[0]}
    <div className="sidebar-resizer" role="separator" aria-orientation="horizontal" aria-label={t('调整目录与会话列表高度')} aria-valuemin={10} aria-valuemax={90} aria-valuenow={Math.round(ratio * 100)} tabIndex={0}
      onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId) || !host.current) return; const r = host.current.getBoundingClientRect(); onChange(splitAtPointer(e.clientY, r.top, r.height)) }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }}
      onDoubleClick={() => onChange(.5)}
      onKeyDown={e => { if (['ArrowUp','ArrowDown','Home'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? .5 : sidebarSplit(ratio + (e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? .1 : .02)); const r = host.current?.getBoundingClientRect(); onChange(r ? splitAtPointer(r.top + next * r.height, r.top, r.height) : next) } }} />
    {children[1]}
  </div>
}
