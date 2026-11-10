import { useId, useRef, useState, type ChangeEventHandler, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../preferences'

export type IconName = 'send' | 'steer' | 'queue' | 'model' | 'thinking' | 'shield' | 'shield-check' | 'shield-alert' | 'settings' | 'stop' | 'close' | 'folder' | 'history' | 'plus' | 'pin' | 'chevron-right' | 'chevron-down' | 'loading' | 'sidebar' | 'terminal'

export function Icon({ name }: { name: IconName }): React.JSX.Element {
  const paths: Record<IconName, ReactNode> = {
    send: <><path d="m21 3-7 18-4-7-7-4Z" /><path d="m10 14 5-5" /></>,
    steer: <><path d="M12 21V3m-6 6 6-6 6 6" /><path d="M4 18h3a5 5 0 0 0 5-5" /></>,
    queue: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
    model: <><rect x="6" y="6" width="12" height="12" rx="3" /><path d="M9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3" /><path d="M10 10h4v4h-4z" /></>,
    thinking: <><path d="M9 18h6m-6 3h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4Z" /><path d="M12 8v4" /></>,
    shield: <><path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5Z" /><path d="M10 9a2 2 0 1 1 3 2c-1 .5-1 1-1 2m0 3h.01" /></>,
    'shield-check': <><path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5Z" /><path d="m8 11 3 3 5-6" /></>,
    'shield-alert': <><path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5Z" /><path d="M12 7v6m0 3h.01" /></>,
    settings: <><path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3Z" /><circle cx="12" cy="12" r="3" /></>,
    stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
    history: <><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" /><path d="M12 7v5l3 2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    pin: <><path d="M9 3h6l-1 2v6l4 5H6l4-5V5Z" /><path d="M12 16v6" /></>,
    'chevron-right': <path d="m9 5 7 7-7 7" />,
    'chevron-down': <path d="m5 9 7 7 7-7" />,
    loading: <path d="M21 12a9 9 0 1 1-9-9" />,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3m6 1h4" /></>
  }
  return <svg className="control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>
}

// Portalled tooltip is not clipped by a scrollable composer, and also works for keyboard focus.
export function IconControl({ tooltip, children, className = '' }: { tooltip: string; children: ReactNode; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const id = useId()
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  function show(): void {
    const rect = ref.current?.getBoundingClientRect()
    if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), bottom: window.innerHeight - rect.top + 8 })
  }
  return (
    <span ref={ref} className={`icon-control ${className}`} onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocusCapture={show} onBlurCapture={() => setPosition(null)} onPointerDownCapture={() => setPosition(null)} onKeyDownCapture={() => setPosition(null)} aria-describedby={position ? id : undefined}>
      {children}
      {position && createPortal(<span className="control-tooltip" role="tooltip" id={id} style={position}>{tooltip}</span>, document.body)}
    </span>
  )
}

export function IconSelect({ label, detail, icon, value, onChange, disabled, warning, children, className = '' }: {
  label: string
  detail: string
  icon: IconName
  value: string
  onChange: ChangeEventHandler<HTMLSelectElement>
  disabled?: boolean
  warning?: boolean
  children: ReactNode
  className?: string
}): React.JSX.Element {
  const t = useT()
  return (
    <IconControl tooltip={t('{label}：{detail}', { label, detail })} className={`icon-select${warning ? ' permission-warning' : ''}`}>
      <Icon name={icon} />
      <select className={`selector ${className}`} title={label} aria-label={label} aria-description={detail} value={value} onChange={onChange} disabled={disabled}>
        {children}
      </select>
    </IconControl>
  )
}
