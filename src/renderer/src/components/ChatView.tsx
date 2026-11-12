import { useEffect, useRef, useState } from 'react'
import { answerDialog, type Item, type SessionUI } from '../store'
import { renderAnsi } from '../ansi'
import { DiffView } from './DiffView'
import { useT } from '../preferences'

interface Props {
  session: SessionUI
}

export function ChatView({ session }: Props) {
  const t = useT()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showJump, setShowJump] = useState(false)

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [session.items, autoScroll])

  function onScroll(el: HTMLDivElement): void {
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = gap < 60
    setAutoScroll(atBottom)
    setShowJump(!atBottom)
  }

  if (session.items.length === 0) {
    return (
      <div className="chat-messages">
        <div className="placeholder">
          {t('会话已就绪（{cwd}）。输入消息开始对话。', { cwd: session.cwd })}
        </div>
      </div>
    )
  }

  return (
    <div className="chat-messages" onScroll={(e) => onScroll(e.currentTarget)}>
      {session.items.map((it, i) => (
        <ItemView key={i} item={it} sessionId={session.id} />
      ))}
      <div ref={bottomRef} />
      {showJump && (
        <button
          className="jump-bottom"
          onClick={() => {
            setAutoScroll(true)
            bottomRef.current?.scrollIntoView()
          }}
        >
          {t('↓ 回到最新')}
        </button>
      )}
    </div>
  )
}

function ItemView({ item, sessionId }: { item: Item; sessionId: string }) {
  const t = useT()
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg user">
          <div className="msg-bubble" onCopy={copyHandler(item.text)}>{item.text}</div>
        </div>
      )
    case 'assistant':
      return (
        <div className="msg assistant">
          {item.blocks.map((b, i) => {
            if (b.kind === 'thinking') {
              return (
                <details key={i} className="thinking-block" open={!b.done}>
                  <summary>💭 {t(b.done ? '思考内容' : '思考中…')}</summary>
                  <pre className="thinking-text">{b.text}</pre>
                </details>
              )
            }
            if (b.kind === 'text') {
              return (
                <div key={i} className="assistant-text" onCopy={copyHandler(b.text)}>
                  {renderMarkdown(b.text)}
                  {b.done && <CopyBtn text={b.text} />}
                </div>
              )
            }
            return (
              <details key={i} className="toolcall-block">
                <summary>🔧 {b.name}</summary>
                <pre className="args-text">{b.argsText}</pre>
              </details>
            )
          })}
          {!item.done && <span className="streaming-cursor">▍</span>}
        </div>
      )
    case 'tool':
      return (
        <div className={`tool-card ${item.isError ? 'error' : ''}`}>
          <div className="tool-card-header">
            <span className="tool-name">{item.name}</span>
            <span className="tool-state">
              {t(item.state === 'running' ? '运行中…' : item.isError ? '失败' : '完成')}
              {item.durationMs !== undefined && ` · ${(item.durationMs / 1000).toFixed(1)}s`}
            </span>
          </div>
          {Object.keys(item.args).length > 0 && (
            <details className="tool-args">
              <summary>{t('参数')}</summary>
              <pre>{JSON.stringify(item.args, null, 2)}</pre>
            </details>
          )}
          {item.output && (
            <details className="tool-output" open={item.output.length < 500}>
              <summary>{t('输出（{count} 字符）', { count: item.output.length })}</summary>
              <pre className="tool-output-text">{renderAnsi(item.output)}</pre>
            </details>
          )}
          <DiffView args={item.args} toolName={item.name} />
        </div>
      )
    case 'status':
      return <div className="status-line">{t(item.text, item.params)}</div>
    case 'dialog':
      return <DialogCard item={item} sessionId={sessionId} />
    case 'raw':
      return (
        <details className="raw-block">
          <summary>{t('未识别事件')}</summary>
          <pre>{item.json}</pre>
        </details>
      )
  }
}

function DialogCard({ item, sessionId }: { item: Extract<Item, { kind: 'dialog' }>; sessionId: string }) {
  const t = useT()
  const [text, setText] = useState(item.prefill ?? '')
  const [error, setError] = useState('')
  const title = item.title ?? (item.approvalTool ? t('Pi 工具审批 · {tool}', { tool: item.approvalTool }) : item.method)

  async function answer(payload: { value?: string; confirmed?: boolean; cancelled?: boolean }, label: string): Promise<void> {
    try {
      await window.spi.answerExtensionUi(sessionId, item.reqId, payload)
      answerDialog(sessionId, item.reqId, label)
    } catch { setError(t('扩展询问已失效或答复发送失败')) }
  }

  if (item.answered) {
    const result = item.resolution === 'auto-allow' ? t('YOLO 已自动回复 Allow（仅本次）')
      : item.resolution === 'failed' ? t('答复发送失败，未确认允许')
        : item.resolution === 'cancelled' || item.resolution === 'expired' ? t('已取消或过期') : item.result ?? t('已答复')
    return <div className="dialog-card answered" data-auto-approved={item.resolution === 'auto-allow' || undefined}>{item.resolution === 'failed' ? '⚠' : '✅'} {title} → {result}</div>
  }

  return (
    <div className="dialog-card">
      <div className="permission-hint">{item.approvalAdapter ? t('Pi 工具审批 · permission-modes 兼容格式') : t('Pi 扩展询问（需手动答复）')}</div>
      <div className="dialog-title">{title}</div>
      {error && <div role="alert" className="permission-error">{error}</div>}
      {item.message && <div className="dialog-message">{item.message}</div>}
      {item.method === 'select' && (
        <div className="dialog-buttons">
          {(item.options ?? []).map((o) => (
            <button key={o} onClick={() => answer({ value: o }, o)}>{o}</button>
          ))}
          <button className="cancel" onClick={() => answer({ cancelled: true }, t('已取消'))}>{t('取消')}</button>
        </div>
      )}
      {item.method === 'confirm' && (
        <div className="dialog-buttons">
          <button onClick={() => answer({ confirmed: true }, t('是'))}>{t('是')}</button>
          <button onClick={() => answer({ confirmed: false }, t('否'))}>{t('否')}</button>
          <button className="cancel" onClick={() => answer({ cancelled: true }, t('已取消'))}>{t('取消')}</button>
        </div>
      )}
      {(item.method === 'input' || item.method === 'editor') && (
        <>
          {item.method === 'input' ? (
            <input className="dialog-input" placeholder={item.placeholder} value={text} onChange={(e) => setText(e.target.value)} />
          ) : (
            <textarea className="dialog-editor" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          )}
          <div className="dialog-buttons">
            <button onClick={() => answer({ value: text }, text || t('(空)'))}>{t('确定')}</button>
            <button className="cancel" onClick={() => answer({ cancelled: true }, t('已取消'))}>{t('取消')}</button>
          </div>
        </>
      )}
    </div>
  )
}

// 极简 Markdown 渲染：代码块 + 行内代码 + 加粗（第一版不做完整解析）
function renderMarkdown(text: string): React.ReactNode {
  const parts = text.split(/```/)
  return parts.map((p, i) => {
    if (i % 2 === 1) {
      const nl = p.indexOf('\n')
      const lang = nl >= 0 ? p.slice(0, nl).trim() : ''
      const code = nl >= 0 ? p.slice(nl + 1) : p
      return (
        <div key={i} className="code-block">
          {lang && <div className="code-lang">{lang}</div>}
          <pre>{code}</pre>
          <CopyBtn text={code} />
        </div>
      )
    }
    return <Inline key={i} text={p} />
  })
}

function Inline({ text }: { text: string }): React.ReactNode {
  // **bold** 和 `code`
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/
  const m = text.match(re)
  if (!m || m.index === undefined) return text
  const before = text.slice(0, m.index)
  const token = m[0]
  const after = text.slice(m.index + token.length)
  const nodes: React.ReactNode[] = []
  if (before) nodes.push(before)
  if (token.startsWith('**')) nodes.push(<strong key="b">{token.slice(2, -2)}</strong>)
  else nodes.push(<code key="c" className="inline-code">{token.slice(1, -1)}</code>)
  nodes.push(<Inline key="r" text={after} />)
  return nodes
}

function CopyBtn({ text }: { text: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="copy-btn"
      title={t(copied ? '已复制' : '复制')}
      aria-label={t(copied ? '已复制' : '复制')}
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

function copyHandler(text: string): React.ClipboardEventHandler<HTMLDivElement> {
  return (e) => {
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
  }
}
