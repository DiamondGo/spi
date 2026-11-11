import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem { label: string; action: () => void; disabled?: boolean; danger?: boolean }
export interface MenuPosition { x: number; y: number }
export function menuPosition(event: React.MouseEvent<HTMLElement>): MenuPosition {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: rect.left + 8, y: rect.top + 8 }
}
export function ContextMenu({ position, items, onClose }: { position: MenuPosition; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(position)
  useLayoutEffect(() => {
    const menu = ref.current!
    const previous = document.activeElement as HTMLElement | null
    const bounds = menu.getBoundingClientRect()
    setAt({ x: Math.max(4, Math.min(position.x, innerWidth - bounds.width - 4)), y: Math.max(4, Math.min(position.y, innerHeight - bounds.height - 4)) })
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (event: Event) => { if (!menu.contains(event.target as Node)) onClose() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); previous?.focus() } }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [position, onClose])
  return createPortal(<div ref={ref} role="menu" className="context-menu" style={{ left: at.x, top: at.y }} onContextMenu={e => e.preventDefault()} onKeyDown={event => {
    if (event.key === 'Tab') { onClose(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }}>
    {items.map(item => <button type="button" role="menuitem" key={item.label} disabled={item.disabled} className={item.danger ? 'danger' : undefined} onClick={() => { onClose(); item.action() }}>{item.label}</button>)}
  </div>, document.body)
}
