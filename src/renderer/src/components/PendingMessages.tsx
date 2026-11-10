import { useState } from 'react'
import type { PendingMessage, PendingMessagesSnapshot } from '../../../shared/types'
import { useT } from '../preferences'

function Row({ item, sessionId }: { item: PendingMessage; sessionId: string }) {
  const t = useT(), [text, setText] = useState(item.text), [images, setImages] = useState(item.images)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [editingRevision, setEditingRevision] = useState(item.revision)
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  const locked = item.status === 'dispatching'
  return <div className="pending-message" data-message-id={item.id} data-status={item.status}>
    <div className="pending-message-heading"><span>{t(item.status === 'editing' ? '编辑待发送消息' : locked ? '正在交付 Pi…' : item.status === 'failed' ? '交付未确认' : '待执行')}{item.priority ? ' · ' + t('优先') : ''}</span>
      <div className="pending-message-actions">
        {item.status !== 'editing' && <button type="button" disabled={locked || busy} onClick={() => { setText(item.text); setImages(item.images); setEditingRevision(item.revision + 1); void run(() => window.spi.editPendingMessage(sessionId, item.id, item.revision)) }}>{t('修改')}</button>}
        <button type="button" disabled={locked || busy} onClick={() => void run(() => window.spi.cancelPendingMessage(sessionId, item.id, item.status === 'editing' ? editingRevision : item.revision))}>{t('取消')}</button>
      </div>
    </div>
    {item.status === 'editing' ? <div className="pending-editor">
      <textarea aria-label={t('待发送消息内容')} value={text} onChange={e => setText(e.target.value)} rows={3} />
      {images.length > 0 && <div className="pending-images">{images.map((image, i) => <button type="button" key={i} aria-label={t('移除图片 {index}', { index: i + 1 })} onClick={() => setImages(current => current.filter((_, n) => n !== i))}><img src={`data:${image.mimeType};base64,${image.data}`} alt={t('粘贴的图片')} /> ×</button>)}</div>}
      <div className="pending-message-actions"><button type="button" disabled={busy || (!text.trim() && !images.length)} onClick={() => void run(() => window.spi.updatePendingMessage(sessionId, item.id, editingRevision, text, images))}>{t('保存修改')}</button><button type="button" disabled={busy} onClick={() => void run(() => window.spi.finishEditingMessage(sessionId, item.id, editingRevision))}>{t('放弃修改')}</button></div>
    </div> : <div className="pending-message-preview">{item.text}{item.images.length ? ` · ${t('{count} 张图片', { count: item.images.length })}` : ''}</div>}
    {item.error && <div className="pending-message-error">{t('交付未确认，请先检查对话；修改或移除记录不会撤回已交付的内容。')}</div>}
    {error && <div role="alert" className="pending-message-error">{error}</div>}
  </div>
}
export function PendingMessages({ snapshot }: { snapshot: PendingMessagesSnapshot }) {
  const t = useT(), [error, setError] = useState('')
  if (!snapshot.items.length) return null
  return <section className="pending-messages" aria-label={t('待执行消息')} data-paused={snapshot.paused}>
    <div className="pending-messages-header"><strong>{t('待执行消息')} · {snapshot.items.length}</strong>{snapshot.paused && <span>{t('已暂停')} <button type="button" onClick={() => { setError(''); void window.spi.resumePendingMessages(snapshot.sessionId).catch(e => setError(String(e))) }}>{t('继续队列')}</button></span>}</div>
    {error && <div role="alert" className="pending-message-error">{error}</div>}
    <div className="pending-message-list">{snapshot.items.map(item => <Row key={item.id} item={item} sessionId={snapshot.sessionId} />)}</div>
  </section>
}
