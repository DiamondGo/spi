import { lazy, Suspense } from 'react'
import { clearTerminalError, useTerminals } from '../terminals'
import { useT } from '../preferences'

const TerminalPanel = lazy(() => import('./TerminalPanel'))

export function TerminalDock({ activeId }: { activeId: string | null }): React.JSX.Element {
  const state = useTerminals()
  const t = useT()
  return <>
    <Suspense fallback={<div className="terminal-loading">{t('正在打开终端…')}</div>}>
      {Object.values(state.terminals).map(info => <TerminalPanel key={info.terminalId} info={info} visible={info.sessionId === activeId} error={state.errors[info.sessionId]} />)}
    </Suspense>
    {activeId && state.errors[activeId] && !state.terminals[activeId] && <div role="alert" className="terminal-error">
      {t('启动终端失败：{error}', { error: state.errors[activeId] })}
      <button onClick={() => clearTerminalError(activeId)}>{t('关闭提示')}</button>
    </div>}
  </>
}
