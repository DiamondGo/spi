import { useRef, useState } from 'react'
import type { SessionUI } from '../store'
import { setDraft, setSendMode, setPendingImages, restoreQueuedMessages, type SendMode } from '../store'
import type { ImageRef } from '../../../shared/types'
import { useAutoHeightTextarea } from '../useAutoHeightTextarea'
import { Icon, IconControl, IconSelect } from './IconControl'
import { useT } from '../preferences'
import { openSessionTerminal, useTerminals } from '../terminals'

interface Props {
  session: SessionUI
}

interface Completion {
  type: 'file' | 'command'
  matches: string[]
  descriptions?: Record<string, string>
  selected: number
}

export function InputBar({ session }: Props) {
  const t = useT()
  const { sendMode: mode, pendingImages } = session
  const [sending, setSending] = useState(false)
  const terminals = useTerminals()
  const terminalOpen = Boolean(terminals.terminals[session.id])
  const [completion, setCompletion] = useState<Completion | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileCache = useRef<Record<string, Array<{ name: string; isDir: boolean }>>>({})

  useAutoHeightTextarea(taRef, session.draft, session.id)

  // ---- 补全逻辑 ----

  // 检测光标前最近的 @ 或 / 触发的 token
  function detectTrigger(value: string, pos: number): { type: 'file' | 'command'; prefix: string; start: number } | null {
    for (let i = pos - 1; i >= 0; i--) {
      const ch = value[i]
      if (ch === ' ' || ch === '\n') return null
      if (ch === '@' || ch === '/') {
        // 触发符必须在行首或空白后
        if (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\n') {
          return { type: ch === '@' ? 'file' : 'command', prefix: value.slice(i + 1, pos), start: i }
        }
        return null
      }
    }
    return null
  }

  async function updateCompletion(value: string, pos: number): Promise<void> {
    const trig = detectTrigger(value, pos)
    if (!trig) {
      setCompletion(null)
      return
    }
    if (trig.type === 'file') {
      const files = fileCache.current[session.cwd] ?? (await window.spi.listFiles(session.cwd).catch(() => []))
      fileCache.current[session.cwd] = files
      const matches = files
        .filter((f) => f.name.toLowerCase().startsWith(trig.prefix.toLowerCase()))
        .map((f) => (f.isDir ? f.name + '/' : f.name))
        .slice(0, 50)
      setCompletion({ type: 'file', matches, selected: 0 })
    } else {
      const cmds = await window.spi.getCommands(session.id).catch(() => [])
      const matches = cmds.filter((c) => c.name.toLowerCase().startsWith(trig.prefix.toLowerCase())).map((c) => c.name)
      const descriptions: Record<string, string> = {}
      for (const c of cmds) descriptions[c.name] = c.description ?? ''
      setCompletion({ type: 'command', matches, descriptions, selected: 0 })
    }
  }

  function applyCompletion(): void {
    if (!completion || completion.selected < 0 || !taRef.current) return
    const ta = taRef.current
    const value = ta.value
    const pos = ta.selectionStart
    const trig = detectTrigger(value, pos)
    if (!trig) return
    const match = completion.matches[completion.selected]
    if (!match) return
    const newValue = value.slice(0, trig.start) + match + ' ' + value.slice(pos)
    setDraft(session.id, newValue)
    setCompletion(null)
    // 恢复光标
    requestAnimationFrame(() => {
      const p = trig.start + match.length + 1
      ta.focus()
      ta.setSelectionRange(p, p)
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    const ta = e.currentTarget
    // 补全导航
    if (completion && completion.matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCompletion((c) => c && { ...c, selected: (c.selected + 1) % c.matches.length })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCompletion((c) => c && { ...c, selected: (c.selected - 1 + c.matches.length) % c.matches.length })
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        applyCompletion()
        return
      }
      if (e.key === 'Escape') {
        setCompletion(null)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // 有补全选中时 Enter 补全，否则发送
        if (completion.selected >= 0 && completion.matches[completion.selected]) {
          e.preventDefault()
          applyCompletion()
          return
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent & { isComposing?: boolean }).isComposing) {
      e.preventDefault()
      send()
    }
  }

  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const items = e.clipboardData?.items
    if (!items) return
    const images: ImageRef[] = []
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          const [data, mimeType] = decodeDataUrl(dataUrl)
          images.push({ data, mimeType })
        }
      }
    }
    if (images.length) {
      e.preventDefault()
      setPendingImages(session.id, (prev) => [...prev, ...images])
    }
  }

  async function send(): Promise<void> {
    const text = session.draft.trim()
    if ((!text && pendingImages.length === 0) || sending) return
    setSending(true)
    try {
      await window.spi.sendPrompt(session.id, text || t('(图片)'), mode, pendingImages.length ? pendingImages : undefined)
      setDraft(session.id, '')
      setPendingImages(session.id, [])
      setCompletion(null)
    } catch {
      if (mode !== 'normal') {
        try {
          await window.spi.sendPrompt(session.id, text || t('(图片)'), 'normal', pendingImages.length ? pendingImages : undefined)
          setDraft(session.id, '')
          setPendingImages(session.id, [])
          setCompletion(null)
        } catch {}
      }
    } finally {
      setSending(false)
    }
  }

  async function stop(): Promise<void> {
    try {
      const queue = await window.spi.abortSession(session.id)
      restoreQueuedMessages(session.id, [...queue.steering, ...queue.followUp])
    } catch {}
  }

  return (
    <div className="input-bar-wrap" data-session-id={session.id}>
      {completion && completion.matches.length > 0 && (
        <div className="completion-popup">
          {completion.matches.map((m, i) => (
            <div
              key={m}
              className={`completion-item ${i === completion.selected ? 'selected' : ''}`}
              onMouseDown={() => {
                setCompletion((c) => c && { ...c, selected: i })
                requestAnimationFrame(applyCompletion)
              }}
              onMouseEnter={() => setCompletion((c) => c && { ...c, selected: i })}
            >
              <span className="completion-text">{completion.type === 'file' ? m : '/' + m}</span>
              {completion.descriptions?.[m] && <span className="completion-desc">{completion.descriptions[m]}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="input-bar">
        <div className="input-options" aria-label={t('当前会话设置')}>
        <IconSelect label={t('发送方式')} detail={t({ normal: '普通发送', steer: '中途插话', followUp: '排队' }[mode])} icon={mode === 'normal' ? 'send' : mode === 'steer' ? 'steer' : 'queue'} value={mode} onChange={(e) => setSendMode(session.id, e.target.value as SendMode)}>
          <option value="normal">{t('普通发送')}</option>
          <option value="steer">{t('中途插话')}</option>
          <option value="followUp">{t('排队')}</option>
        </IconSelect>
        <IconControl tooltip={terminals.opening[session.id] ? t('正在打开终端…') : terminalOpen ? t('聚焦当前会话终端') : t('使用默认 shell 在 {cwd} 打开终端', { cwd: session.cwd })}>
          <button type="button" className={`terminal-toggle icon-button${terminalOpen ? ' active' : ''}`} aria-label={t('打开当前会话终端')} aria-pressed={terminalOpen} disabled={terminals.opening[session.id]} onClick={() => void openSessionTerminal(session.id)}><Icon name="terminal" /></button>
        </IconControl>
        </div>
        <div className="input-message">
        <textarea
          ref={taRef}
          value={session.draft}
          rows={1}
          placeholder={t('输入消息，@ 补全文件，/ 补全命令，粘贴图片，Enter 发送')}
          onChange={(e) => {
            setDraft(session.id, e.target.value)
            updateCompletion(e.target.value, e.target.selectionStart)
          }}
          onClick={(e) => updateCompletion(e.currentTarget.value, e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {session.streaming ? (
          <IconControl tooltip={t('停止当前会话（保留未发送及排队文字）')}>
            <button className="btn-stop icon-button" aria-label={t('停止当前会话')} onClick={stop}><Icon name="stop" /></button>
          </IconControl>
        ) : (
          <IconControl tooltip={t('发送消息 · Enter 发送，Shift+Enter 换行')}>
            <button className="btn-send icon-button" aria-label={t('发送消息')} onClick={send} disabled={!session.draft.trim() && pendingImages.length === 0 || sending}><Icon name="send" /></button>
          </IconControl>
        )}
        </div>
      </div>
      {pendingImages.length > 0 && (
        <div className="image-previews">
          {pendingImages.map((img, i) => (
            <div key={i} className="image-preview">
              <img src={`data:${img.mimeType};base64,${img.data}`} alt={t('粘贴的图片')} />
              <button
                className="image-preview-remove"
                onClick={() => setPendingImages(session.id, (prev) => prev.filter((_, j) => j !== i))}
                title={t('移除')} aria-label={t('移除')}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function decodeDataUrl(dataUrl: string): [string, string] {
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.*)$/)
  if (m) return [m[2], m[1]]
  return [dataUrl, 'image/png']
}
