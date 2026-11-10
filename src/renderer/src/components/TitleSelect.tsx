import type { ChangeEventHandler, ReactNode } from 'react'
import { useT } from '../preferences'

// A textual, button-shaped native select. Its popup remains keyboard/screen-reader accessible.
export function TitleSelect({ label, text, detail, className, value, disabled, warning, onChange, children }: {
  label: string
  text: string
  detail?: string
  className: string
  value: string
  disabled?: boolean
  warning?: boolean
  onChange: ChangeEventHandler<HTMLSelectElement>
  children: ReactNode
}): React.JSX.Element {
  const t = useT()
  return (
    <label className={`tb-choice${warning ? ' permission-warning' : ''}`} title={detail || text}>
      <span className={`tb-field ${className}${warning ? ' permission-warning' : ''}`}>{text}</span>
      <select className="tb-native-select" data-control={className.replace('tb-', '')} title={t('标题栏{label}', { label })} aria-label={t('标题栏{label}', { label })} aria-description={detail || text} value={value} disabled={disabled} onChange={onChange}>
        {children}
      </select>
    </label>
  )
}
