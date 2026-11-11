import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalEvent, TerminalInfo } from '../../../shared/types'
import { usePreferences, useT } from '../preferences'
import { closeSessionTerminal, hideSessionTerminal } from '../terminals'
import { Icon, IconControl } from './IconControl'
import { usePathFormatter } from '../homePath'
import { ContextMenu, menuPosition, type MenuPosition } from './ContextMenu'

function terminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const value = (name: string) => css.getPropertyValue(name).trim()
  const light = document.documentElement.dataset.theme === 'light'
  const high = document.documentElement.dataset.theme === 'high-contrast'
  const colors = light
    ? ['#1b2533', '#9f172a', '#226832', '#754900', '#145dcc', '#7b2190', '#006b75', '#475569']
    : high ? ['#ffffff', '#ff8686', '#00ff66', '#ffff00', '#66b3ff', '#ff8fff', '#00ffff', '#ffffff']
      : ['#999999', '#ff8686', '#98c379', '#e5c07b', '#6da7ff', '#d69df0', '#66c5d6', '#dddddd']
  return {
    background: value('--bg'), foreground: value('--fg'), cursor: value('--focus'),
    selectionBackground: high ? value('--accent') : value('--selected'), selectionForeground: high ? '#000000' : value('--fg'),
    black: colors[0], red: colors[1], green: colors[2], yellow: colors[3], blue: colors[4], magenta: colors[5], cyan: colors[6], white: colors[7],
    brightBlack: colors[0], brightRed: colors[1], brightGreen: colors[2], brightYellow: colors[3], brightBlue: colors[4], brightMagenta: colors[5], brightCyan: colors[6], brightWhite: colors[7]
  }
}

export default function TerminalPanel({ info, visible, error }: { info: TerminalInfo & { focusRequest: number }; visible: boolean; error?: string }): React.JSX.Element {
  const t = useT(), formatPath = usePathFormatter()
  const { settings } = usePreferences()
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fitNow = useRef<() => void>(() => {})
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const lastFocus = useRef(0)
  const [localError, setLocalError] = useState('')
  const [menu, setMenu] = useState<{ position: MenuPosition; selection: string } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  useEffect(() => { if (!visible) closeMenu() }, [visible, closeMenu])
  async function paste(): Promise<void> {
    try { const text = await navigator.clipboard.readText(); if (visibleRef.current) { terminal.current?.paste(text); terminal.current?.focus() } }
    catch (error) { setLocalError(String(error)) }
  }

  useEffect(() => {
    if (!host.current) return
    let disposed = false, ready = false, seq = 0, frame = 0
    const queued: Array<Extract<TerminalEvent, { type: 'data' }>> = []
    const term = new Terminal({
      cols: 80, rows: 12, scrollback: 2000, fontSize: 14,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      cursorBlink: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      screenReaderMode: true, theme: terminalTheme(), linkHandler: { activate: () => {} }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    terminal.current = term
    // Terminal bytes are never HTML or an instruction to access the clipboard / open a browser.
    const osc52 = term.parser.registerOscHandler(52, () => true)
    const input = term.onData(data => {
      for (let offset = 0; offset < data.length;) {
        let end = Math.min(data.length, offset + 16384)
        const last = data.charCodeAt(end - 1)
        if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--
        window.spi.writeTerminal(info.sessionId, info.terminalId, data.slice(offset, end))
        offset = end
      }
    })
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true
      if (event.key.toLowerCase() === 'c') {
        if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection()).catch(e => { if (!disposed) setLocalError(String(e)) })
        return false
      }
      if (event.key.toLowerCase() === 'v') {
        void navigator.clipboard.readText().then(text => { if (!disposed) term.paste(text) }).catch(e => { if (!disposed) setLocalError(String(e)) })
        return false
      }
      return true
    })
    const receive = (event: Extract<TerminalEvent, { type: 'data' }>) => {
      if (event.seq <= seq) { window.spi.acknowledgeTerminal(info.sessionId, info.terminalId, event.seq); return }
      seq = event.seq
      term.write(event.data, () => { if (!disposed) window.spi.acknowledgeTerminal(info.sessionId, info.terminalId, event.seq) })
    }
    const off = window.spi.onTerminalEvent(event => {
      if (disposed || event.sessionId !== info.sessionId || event.terminalId !== info.terminalId || event.type !== 'data') return
      if (ready) receive(event)
      else queued.push(event)
    })
    fitNow.current = () => {
      if (disposed || !host.current || !visibleRef.current || host.current.clientWidth === 0 || host.current.clientHeight === 0) return
      fit.fit()
      term.refresh(0, term.rows - 1)
      window.spi.resizeTerminal(info.sessionId, info.terminalId, term.cols, term.rows)
    }
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitNow.current())
    })
    resize.observe(host.current)
    void window.spi.attachTerminal(info.sessionId, info.terminalId).then(snapshot => {
      if (disposed) return
      seq = snapshot.seq
      const initialized = () => {
        if (disposed) return
        ready = true
        queued.forEach(receive)
        queued.length = 0
        fitNow.current()
      }
      if (snapshot.history) term.write(snapshot.history, initialized)
      else initialized()
    }).catch(e => { if (!disposed) setLocalError(String(e)) })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect(); off(); input.dispose(); osc52.dispose(); term.dispose()
      terminal.current = null
      fitNow.current = () => {}
    }
  }, [info.terminalId])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!visible) return
      fitNow.current()
      if (lastFocus.current !== info.focusRequest) { terminal.current?.focus(); lastFocus.current = info.focusRequest }
    })
    return () => cancelAnimationFrame(frame)
  }, [visible, info.focusRequest])
  useEffect(() => { if (terminal.current) terminal.current.options.theme = terminalTheme() }, [settings.theme])

  return (
    <section className="terminal-panel" hidden={!visible} data-session-id={info.sessionId} data-terminal-id={info.terminalId} aria-label={t('终端：{cwd}', { cwd: formatPath(info.cwd) })}>
      <header className="terminal-header">
        <strong>{t('终端')}</strong>
        <span className="terminal-shell" title={formatPath(info.shell)}>{info.shell.split(/[/\\]/).pop()}</span>
        <span className="terminal-cwd" title={formatPath(info.cwd)}>{formatPath(info.cwd)}</span>
        <IconControl tooltip={t('隐藏终端')}><button type="button" className="terminal-hide" aria-label={t('隐藏终端')} onClick={() => hideSessionTerminal(info.sessionId)}>−</button></IconControl>
        <IconControl tooltip={t('关闭终端')}><button type="button" className="terminal-close" aria-label={t('关闭终端')} onClick={() => void closeSessionTerminal(info.sessionId, info.terminalId)}><Icon name="close" /></button></IconControl>
      </header>
      {(error || localError) && <div role="alert" className="terminal-error">{error || localError}</div>}
      <div className="terminal-body" ref={host} onContextMenu={event => { event.preventDefault(); setMenu({ position: menuPosition(event), selection: terminal.current?.getSelection() || '' }) }} />
      {menu && visible && <ContextMenu position={menu.position} onClose={closeMenu} items={[
        { label: t('复制'), disabled: !menu.selection, action: () => { void navigator.clipboard.writeText(menu.selection).then(() => { if (visibleRef.current) terminal.current?.focus() }).catch(error => setLocalError(String(error))) } },
        { label: t('粘贴'), action: () => { void paste() } },
        { label: t('全选'), action: () => { terminal.current?.selectAll(); terminal.current?.focus() } },
        { label: t('清屏'), action: () => { terminal.current?.clear(); terminal.current?.focus() } },
        { label: t('隐藏终端'), action: () => hideSessionTerminal(info.sessionId) },
        { label: t('关闭终端'), danger: true, action: () => { void closeSessionTerminal(info.sessionId, info.terminalId) } }
      ]} />}
    </section>
  )
}
