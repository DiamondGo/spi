// Actual Electron + Pi, on a private display with an isolated loopback model.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async function({app,waitFor,pass,fill,workspace,artifacts,descendants}) {
  if(process.platform!=='linux') throw new Error('Signal-fault smoke currently requires Linux')
  const id=await app.eval(`document.querySelector('.session-tab.active').dataset.sessionId`), key=JSON.stringify(id)
  const state=()=>app.eval(`window.spi.getState(${key})`),queue=()=>app.eval(`window.spi.getPendingMessages(${key})`)
  const send=async text=>{await fill(app,text);await waitFor(()=>app.eval('!document.querySelector(".btn-send").disabled'),'send enabled');await app.eval('document.querySelector(".btn-send").click()')}
  const prompt=JSON.stringify({tool:'read',input:{path:path.join(workspace,'smoke.txt')}})
  const ownedPi=()=>descendants(app.child.pid).filter(pid=>{try{return fs.readlinkSync(`/proc/${pid}/cwd`)===workspace && (/^(?:pi\x00|.*--mode\x00rpc)/.test(fs.readFileSync(`/proc/${pid}/cmdline`,'utf8')))}catch{return false}})
  const recover=async()=>{
    await app.eval(`window.confirm=()=>true;[...document.querySelectorAll('.session-health button')].find(b=>b.textContent==='恢复会话').click()`)
    await waitFor(()=>app.eval(`document.querySelector('.session-health')?.textContent.includes('Pi RPC 正常')&&!document.querySelector('.session-health').classList.contains('warning')`),'recovered health',30000)
  }
  await app.eval(`window.spi.setModel(${key},'spi-test','fixture')`)
  await send(prompt)
  await waitFor(()=>app.eval(`document.body.textContent.includes('SPI_FIXTURE_DONE')&&!document.querySelector('.btn-stop')`),'seed history saved')
  const file=(await state()).sessionFile;assert.ok(fs.existsSync(file))
  await app.eval(`document.querySelector('.session-health button').click()`)
  await waitFor(()=>app.eval(`window.__smokeEvents.some(e=>e.event.type==='spi_session_health'&&e.event.health.status==='healthy')`),'manual healthy probe')
  pass('real Pi healthy probe, normal model/tool roundtrip and saved history')

  await send('SPI_HEALTH_HANG')
  await waitFor(()=>app.eval(`!!document.querySelector('.btn-stop')`),'isolated model request stalled')
  const pids=ownedPi();assert.equal(pids.length,1);const old=pids[0]
  const healthCount=()=>app.eval(`window.__smokeEvents.filter(e=>e.event.type==='spi_session_health').length`)
  const before=await healthCount()
  process.kill(old,'SIGSTOP')
  // No polling, including while busy: merely waiting past the old 15s interval does nothing.
  await new Promise(resolve=>setTimeout(resolve,16000))
  assert.equal(await healthCount(),before)
  pass('no idle/busy background health polling after the old 15-second interval')
  await send(prompt)
  await waitFor(async()=>(await queue()).items.length===1,'outbox message retained during request')
  await fill(app,'SPI_UNSENT_DRAFT')
  // No manual Check: the user's blocked send triggers one diagnostic.
  await waitFor(()=>app.eval(`document.querySelector('.session-health')?.textContent.includes('Pi RPC 未响应')`),'send-triggered RPC failure warning',15000)
  assert.equal((await queue()).paused,true)
  assert.equal(await app.eval(`document.querySelector('.btn-send').disabled`),true)
  assert.equal(await app.eval(`document.querySelector('.input-bar textarea').value`),'SPI_UNSENT_DRAFT')
  pass('stopped Pi triggers bounded timeout warning and paused queue without losing draft')
  const screenshot=await app.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'session-health-unresponsive.png'),Buffer.from(screenshot.data,'base64'))

  await recover()
  assert.equal(await app.eval(`document.querySelector('.session-tab.active').dataset.sessionId`),id)
  assert.equal((await state()).sessionFile,file)
  assert.equal(await app.eval(`document.querySelector('.input-bar textarea').value`),'SPI_UNSENT_DRAFT')
  assert.equal((await queue()).items.length,1);assert.equal((await queue()).paused,true)
  assert.ok(await app.eval(`document.body.textContent.includes('SPI_FIXTURE_DONE')`))
  assert.ok(!ownedPi().includes(old));assert.equal(ownedPi().length,1)
  pass('UI recovery kills the stopped writer, restores original history/identity and preserves paused outbox/draft')

  const pending=(await queue()).items[0]
  await app.eval(`window.spi.cancelPendingMessage(${key},${JSON.stringify(pending.id)},${pending.revision})`)
  await send(prompt)
  await waitFor(()=>app.eval(`!document.querySelector('.btn-stop')&&document.body.textContent.includes('SPI_FIXTURE_DONE')`),'recovered session usable')
  const next=ownedPi()[0];process.kill(next,'SIGKILL')
  await waitFor(()=>app.eval(`document.querySelector('.session-health')?.textContent.includes('Pi 进程已退出')`),'unexpected exit retained tab')
  assert.equal(await app.eval(`document.querySelectorAll('.session-tab').length`),1)
  await recover();assert.equal((await state()).sessionFile,file)
  assert.equal(app.errors.length,0,JSON.stringify(app.errors))
  pass('recovered session sends again; unexpected process death retains tab and can be recovered again')
}
