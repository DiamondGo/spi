// Run via: node scripts/smoke.cjs --advanced (uses the same isolated Electron harness).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function ({ app, waitFor, pass, fill, text, results, artifacts }) {
  const evaluate = expression => app.eval(expression)
  const delay = ms => new Promise(r => setTimeout(r, ms))
  const check = async (name, run) => {
    try { const details = await run(); pass(name, details) }
    catch (e) { results.push({ name, passed: false, error: e.message }); console.error('FAIL', name, e.message) }
  }
  const selectMode = async mode => {
    await evaluate(`(()=>{const s=document.querySelector('select[title="发送方式"]');s.value=${JSON.stringify(mode)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await delay(100)
  }
  const tab = async index => {
    await evaluate(`document.querySelectorAll('.session-tab')[${index}].click()`)
    await waitFor(() => evaluate(`document.querySelectorAll('.session-tab')[${index}].classList.contains('active')`), 'active tab '+index)
  }
  const enter = async message => {
    await fill(app, message)
    await evaluate(`document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
  }
  const events = () => evaluate('window.__smokeEvents')
  const eventAfter = async (start, type, id, predicate = 'true', timeout = 60000) => waitFor(async () => {
    const result = await evaluate(`window.__smokeEvents.slice(${start}).find(e=>e.event.type===${JSON.stringify(type)}${id ? `&&e.sessionId===${JSON.stringify(id)}` : ''}&&(${predicate}))`)
    if (result) return result
    await allowLegacyIfPresent()
    return false
  }, type, timeout)
  const state = id => evaluate(`window.spi.getState(${JSON.stringify(id)})`)
  let permissions = 0
  let legacyPermissions = 0
  const handledLegacy = new Set()
  const allowLegacyIfPresent = async () => {
    const requests = (await events()).filter(e => e.event.type === 'extension_ui_request' && e.event.method === 'select' && !handledLegacy.has(e.event.id))
    if (!requests.length) return
    const previous = await evaluate(`document.querySelector('.session-tab.active')?.dataset.sessionId`)
    for (const req of requests) {
      assert.match(req.event.title, /^Allow bash\? "sleep (5|12|20|60); printf SPI_[A-Z_]+"$/)
      await evaluate(`document.querySelector('.session-tab[data-session-id="${req.sessionId}"]').click()`)
      await waitFor(() => evaluate(`!!document.querySelector('.dialog-card:not(.answered)')`), 'external approval in its own tab')
      const dialog = await evaluate(`(()=>{const d=document.querySelector('.dialog-card:not(.answered)');return {title:d.querySelector('.dialog-title').textContent,options:[...d.querySelectorAll('button')].map(b=>b.textContent)}})()`)
      assert.equal(dialog.title, req.event.title)
      assert.ok(dialog.options.includes('Allow'), JSON.stringify(dialog))
      await evaluate(`(()=>{const d=document.querySelector('.dialog-card:not(.answered)');[...d.querySelectorAll('button')].find(b=>b.textContent==='Allow').click()})()`)
      await waitFor(() => evaluate(`!document.querySelector('.dialog-card:not(.answered)')`), 'external one-time permission answered')
      handledLegacy.add(req.event.id)
      legacyPermissions++
    }
    if (previous) await evaluate(`document.querySelector('.session-tab[data-session-id="${previous}"]').click()`)
  }
  const allowOnce = async index => {
    await tab(index)
    await waitFor(async () => {
      await allowLegacyIfPresent()
      return evaluate(`!!document.querySelector('.permission-request')`)
    }, 'sPi permission gate')
    const own = await evaluate(`window.spi.getPermissions()`)
    assert.equal(own.pending.length, 1)
    assert.equal(own.pending[0].tool, 'bash')
    assert.match(own.pending[0].input.command, /^sleep (5|12|20|60); printf SPI_[A-Z_]+$/)
    await evaluate(`(()=>{const d=document.querySelector('.permission-request');[...d.querySelectorAll('button')].find(b=>b.textContent==='单次允许').click()})()`)
    await waitFor(() => evaluate(`!document.querySelector('.permission-request')`), 'sPi one-time permission answered')
    await allowLegacyIfPresent()
    permissions++
  }

  // Local UI state isolation: no LLM request necessary.
  await selectMode('followUp')
  await evaluate(`document.querySelector('.btn-new').click()`)
  await waitFor(() => evaluate(`document.querySelectorAll('.session-tab').length===2`), 'second session')
  await check('new session uses normal mode, not previous tab mode', async () => {
    assert.equal(await evaluate(`document.querySelector('select[title="发送方式"]').value`), 'normal')
  })
  await selectMode('normal')
  await tab(0)
  await check('send mode is independent per session', async () => {
    assert.equal(await evaluate(`document.querySelector('select[title="发送方式"]').value`), 'followUp')
  })
  await selectMode('normal')
  await evaluate(`(()=>{const c=document.createElement('canvas');c.width=100;c.height=100;c.getContext('2d').fillStyle='red';c.getContext('2d').fillRect(0,0,100,100);return new Promise(resolve=>c.toBlob(blob=>{const dt=new DataTransfer();dt.items.add(new File([blob],'red.png',{type:'image/png'}));document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));resolve(true)}))})()`)
  await waitFor(() => evaluate(`document.querySelectorAll('.image-preview').length===1`), 'paste preview')
  await tab(1)
  await check('pending image is not exposed to another session', async () => {
    assert.equal(await evaluate(`document.querySelectorAll('.image-preview').length`), 0)
  })
  await tab(0)
  await check('pending image remains in its original session', async () => {
    assert.equal(await evaluate(`document.querySelectorAll('.image-preview').length`), 1)
  })
  await evaluate(`document.querySelector('.image-preview-remove')?.click()`)

  // Real parallel jobs. First tool sleeps long enough for a second pi to start its tool.
  let start = (await events()).length
  await enter('仅用 bash 执行 sleep 20; printf SPI_PARALLEL_A，然后只回复 SPI_A_DONE。不要读写文件。')
  const aStart = await eventAfter(start, 'tool_execution_start')
  const a = aStart.sessionId
  await allowOnce(0)
  await tab(1)
  await selectMode('normal')
  start = (await events()).length
  await enter('仅用 bash 执行 sleep 5; printf SPI_PARALLEL_B，然后只回复 SPI_B_DONE。不要读写文件。')
  const bStart = await eventAfter(start, 'tool_execution_start')
  const b = bStart.sessionId
  await allowOnce(1)
  await check('two distinct pi sessions execute tools concurrently', async () => {
    assert.notEqual(a, b)
    const states = await Promise.all([state(a), state(b)])
    assert.ok(states.every(s => s.isStreaming), JSON.stringify(states.map(s=>s.isStreaming)))
    return { a, b }
  })
  await eventAfter(start, 'agent_settled', b)
  await eventAfter(0, 'agent_settled', a)
  await tab(0)
  await waitFor(() => evaluate(`document.querySelector('.chat-messages').textContent.includes('SPI_A_DONE')`), 'A answer')
  assert.ok(!(await text(app, '.chat-messages')).includes('SPI_B_DONE'))
  await tab(1)
  await waitFor(() => evaluate(`document.querySelector('.chat-messages').textContent.includes('SPI_B_DONE')`), 'B answer')
  assert.ok(!(await text(app, '.chat-messages')).includes('SPI_A_DONE'))
  pass('parallel background output returns to the correct tab')

  await tab(0)
  const beforeModel = await evaluate(`document.querySelector('select[title="标题栏模型"]').value`)
  const target = await evaluate(`(()=>{const s=document.querySelector('select[title="标题栏模型"]');const o=[...s.options].find(o=>o.value!==s.value&&o.textContent.includes('gemini'));s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return o.value})()`)
  await waitFor(async () => { const s=await state(a);return s.model.provider+'/'+s.model.id===target }, 'backend model switched')
  await tab(1)
  await tab(0)
  await check('model selector stays in sync with pi after tab switch', async () => {
    assert.equal(await evaluate(`document.querySelector('select[title="标题栏模型"]').value`), target)
  })
  // Restore the actual backend to the original configured model before subsequent prompts.
  await evaluate(`(()=>{const s=document.querySelector('select[title="标题栏模型"]');s.value=${JSON.stringify(beforeModel)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await waitFor(async () => { const s=await state(a);return s.model.provider+'/'+s.model.id===beforeModel }, 'backend model restored')

  // Queue one follow-up and one steering message while a real tool is blocked.
  start = (await events()).length
  await selectMode('normal')
  await enter('仅用 bash 执行 sleep 12; printf SPI_PRIMARY_OUTPUT，然后只回复 SPI_PRIMARY_DONE。后续消息另行处理，不要读写文件。')
  await eventAfter(start, 'tool_execution_start', a)
  await allowOnce(0)
  await selectMode('followUp')
  await enter('只回复 SPI_FOLLOWUP_DONE，不要使用工具。')
  await eventAfter(start, 'queue_update', a, `e.event.followUp?.some(t=>t.includes('SPI_FOLLOWUP_DONE'))`)
  await selectMode('steer')
  await enter('只回复 SPI_STEER_DONE，不要使用工具。')
  await eventAfter(start, 'queue_update', a, `e.event.steering?.some(t=>t.includes('SPI_STEER_DONE'))`)
  pass('follow-up and steering are accepted while agent is running')
  await eventAfter(start, 'agent_settled', a, 'true', 90000)
  const delivered = (await events()).slice(start).filter(e=>e.sessionId===a&&e.event.type==='message_start'&&e.event.message?.role==='user')
    .map(e=>JSON.stringify(e.event.message.content))
  assert.equal(delivered.filter(t=>t.includes('SPI_FOLLOWUP_DONE')).length, 1, JSON.stringify(delivered))
  assert.equal(delivered.filter(t=>t.includes('SPI_STEER_DONE')).length, 1, JSON.stringify(delivered))
  assert.ok(delivered.findIndex(t=>t.includes('SPI_STEER_DONE')) < delivered.findIndex(t=>t.includes('SPI_FOLLOWUP_DONE')), 'steer must be delivered before follow-up')
  pass('queued messages delivered once in steer → follow-up order', { userMessages: delivered.length })

  // Stop a live tool, preserving queued text rather than silently discarding it.
  start = (await events()).length
  await selectMode('normal')
  await enter('仅用 bash 执行 sleep 60; printf SPI_MUST_NOT_FINISH，然后回复。不要读写文件。')
  await eventAfter(start, 'tool_execution_start', a)
  await allowOnce(0)
  await tab(1)
  const bRestart = (await events()).length
  await selectMode('normal')
  await enter('仅用 bash 执行 sleep 5; printf SPI_OTHER_SURVIVED，然后只回复 SPI_OTHER_DONE。不要读写文件。')
  await eventAfter(bRestart, 'tool_execution_start', b)
  await allowOnce(1)
  await tab(0)
  await selectMode('followUp')
  const queued = 'SPI_RETURN_QUEUED_TEXT：这条消息还未执行。'
  await enter(queued)
  await eventAfter(start, 'queue_update', a, `e.event.followUp?.some(t=>t.includes('SPI_RETURN_QUEUED_TEXT'))`)
  await selectMode('steer')
  const queuedSteer = 'SPI_RETURN_STEERING_TEXT：这条插话还未执行。'
  await enter(queuedSteer)
  await eventAfter(start, 'queue_update', a, `e.event.steering?.some(t=>t.includes('SPI_RETURN_STEERING_TEXT'))`)
  await fill(app, 'SPI_UNSENT_DRAFT')
  assert.equal((await state(b)).isStreaming, true)
  const stoppedAt = Date.now()
  await evaluate(`document.querySelector('.btn-stop').click()`)
  await eventAfter(start, 'agent_settled', a, 'true', 15000)
  assert.equal((await state(a)).isStreaming, false)
  assert.equal((await state(b)).isStreaming, true, 'Stopping A must not stop running B')
  assert.ok(Date.now()-stoppedAt<15000)
  const ended = (await events()).slice(start).filter(e=>e.sessionId===a&&e.event.type==='tool_execution_end')
  assert.ok(ended.some(e=>e.event.isError), 'Aborted tool must report interruption')
  assert.ok(!ended.some(e=>JSON.stringify(e.event.result).includes('SPI_MUST_NOT_FINISH')))
  pass('stop aborts a running tool promptly without affecting another session', { ms: Date.now()-stoppedAt })
  await check('stop restores cleared queue without overwriting unsent draft', async () => {
    const draft=await evaluate(`document.querySelector('textarea').value`)
    assert.ok(draft.includes(queued), draft)
    assert.ok(draft.includes(queuedSteer), draft)
    assert.ok(draft.includes('SPI_UNSENT_DRAFT'), draft)
  })
  await eventAfter(bRestart, 'agent_settled', b)
  await tab(1)
  assert.ok((await text(app, '.chat-messages')).includes('SPI_OTHER_DONE'))
  pass('other running session completes normally after stopping its peer')
  fs.writeFileSync(path.join(artifacts, 'advanced-events.json'), JSON.stringify(await events(), null, 2))
  assert.equal(app.errors.length, 0, JSON.stringify(app.errors))
  pass('sPi single-approval round-trips; external approvals remain single-use if present', { permissions, legacyPermissions })
  pass('advanced run: no renderer exceptions')
}
