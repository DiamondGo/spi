// Actual Electron + Pi, on a private display with an isolated loopback model.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async function({app,waitFor,pass,fill,workspace,artifacts,descendants}) {
  if(process.platform!=='linux') throw new Error('Signal-fault smoke currently requires Linux')
  const id=await app.eval(`document.querySelector('.session-tab.active').dataset.sessionId`), key=JSON.stringify(id)
  const state=()=>app.eval(`window.spi.getState(${key})`),queue=()=>app.eval(`window.spi.getPendingMessages(${key})`)
  const send=async text=>{await fill(app,text);await waitFor(()=>app.eval('!document.querySelector(".btn-send").disabled'),'send enabled');await app.eval('document.querySelector(".btn-send").click()')}
  const capture=async name=>{const image=await app.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(image.data,'base64'))}
  const prompt=JSON.stringify({tool:'read',input:{path:path.join(workspace,'smoke.txt')}})
  const ownedPi=()=>descendants(app.child.pid).filter(pid=>{try{return fs.readlinkSync(`/proc/${pid}/cwd`)===workspace && (/^(?:pi\x00|.*--mode\x00rpc)/.test(fs.readFileSync(`/proc/${pid}/cmdline`,'utf8')))}catch{return false}})
  const click=async(selector,text)=>{
    const point=await app.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent===${JSON.stringify(text)});if(!e||e.disabled)throw Error('Missing/enabled recovery control');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await app.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1})
    await app.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})
  }
  const openRecovery=async(menu=false)=>{
    if(menu){
      await app.eval(`(()=>{const e=document.querySelector('.session-tab.active'),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}))})()`)
      await waitFor(()=>app.eval(`!!document.querySelector('.context-menu')`),'session recovery menu')
      await click('.context-menu button','恢复会话')
    }else await click('.session-health button','恢复会话')
    await waitFor(()=>app.eval(`!!document.querySelector('.session-recovery-dialog[open]')`),'visible in-window recovery confirmation')
  }
  const recover=async(menu=false)=>{
    await openRecovery(menu)
    await click('.session-recovery-dialog button','确定恢复')
    await waitFor(()=>app.eval(`!document.querySelector('.session-health')&&!document.querySelector('.session-recovery-dialog')`),'recovered health banner and dialog removed',30000)
  }
  const manualCheck=async()=>{
    await app.eval(`(()=>{const e=document.querySelector('.session-tab.active'),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}))})()`)
    await waitFor(()=>app.eval(`!!document.querySelector('.context-menu')`),'session menu')
    await app.eval(`Array.from(document.querySelectorAll('.context-menu button')).find(b=>b.textContent==='检查连接').click()`)
  }
  await app.eval(`window.spi.setModel(${key},'spi-test','fixture')`)
  await send(prompt)
  await waitFor(()=>app.eval(`document.body.textContent.includes('SPI_FIXTURE_DONE')&&!document.querySelector('.btn-stop')`),'seed history saved')
  const file=(await state()).sessionFile;assert.ok(fs.existsSync(file))
  assert.equal(await app.eval(`document.querySelectorAll('.session-health').length`),0)
  await manualCheck()
  await waitFor(()=>app.eval(`window.__smokeEvents.some(e=>e.event.type==='spi_session_health'&&e.event.health.status==='healthy')`),'manual healthy probe')
  assert.equal(await app.eval(`document.querySelectorAll('.session-health').length`),0)
  pass('normal working sessions have no health banner; manual checks remain in the session context menu')
  await app.eval(`window.spi.updateAppSettings({language:'en'})`)
  await waitFor(()=>app.eval(`document.documentElement.lang==='en'`),'English UI')
  const views=[]
  for(const [name,width,height] of [['health-working-wide',1280,800],['health-working-small',900,640]]){
    await app.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
    const result=await app.eval(`({width:innerWidth,height:innerHeight,banners:document.querySelectorAll('.session-health').length,controls:document.querySelectorAll('.session-health-actions button').length})`)
    assert.equal(result.banners,0);assert.equal(result.controls,0);views.push({name,...result});await capture(name)
  }
  fs.writeFileSync(path.join(artifacts,'health-viewport-results.json'),JSON.stringify(views,null,2))
  await app.send('Emulation.clearDeviceMetricsOverride')
  await app.eval(`window.spi.updateAppSettings({language:'zh'})`)
  await waitFor(()=>app.eval(`document.documentElement.lang==='zh-CN'`),'Chinese UI restored')
  pass('healthy connection controls are absent in English at wide and compact desktop viewports')

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
  assert.equal(await app.eval(`document.querySelectorAll('.session-health').length`),1)
  assert.equal(await app.eval(`document.querySelector('.btn-send').disabled`),true)
  assert.equal(await app.eval(`document.querySelector('.input-bar textarea').value`),'SPI_UNSENT_DRAFT')
  pass('stopped Pi triggers bounded timeout warning and paused queue without losing draft')
  const screenshot=await app.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'session-health-unresponsive.png'),Buffer.from(screenshot.data,'base64'))

  process.kill(old,'SIGCONT')
  await app.eval(`window.spi.renameSession({sessionId:${key}},'RPC activity restored')`)
  await waitFor(()=>app.eval(`document.querySelectorAll('.session-health').length===0`),'fresh RPC work clears old warning')
  assert.equal((await queue()).paused,true);assert.equal((await queue()).items.length,1)
  await capture('health-resumed-no-banner')
  pass('fresh RPC activity automatically removes stale alerts without replaying or resuming the outbox')

  process.kill(old,'SIGSTOP')
  await manualCheck()
  await waitFor(()=>app.eval(`document.querySelector('.session-health')?.textContent.includes('Pi RPC 未响应')`),'manual context-menu check detects a new failure',15000)
  assert.equal(await app.eval(`document.querySelectorAll('.session-health').length`),1)
  const recoveryEvents=()=>app.eval(`window.__smokeEvents.filter(e=>e.event.type==='spi_session_health'&&e.event.health.status==='recovering').length`)
  const recoveriesBefore=await recoveryEvents(),queueBefore=await queue()
  await openRecovery()
  assert.equal(await app.eval(`document.activeElement.textContent`),'取消')
  for(const theme of ['dark','light','high-contrast'])for(const language of ['zh','en']){
    await app.eval(`window.spi.updateAppSettings(${JSON.stringify({theme,language})})`)
    await waitFor(()=>app.eval(`document.documentElement.dataset.theme===${JSON.stringify(theme)}&&document.documentElement.lang===${JSON.stringify(language==='zh'?'zh-CN':'en')}`),'recovery dialog theme/language')
    assert.ok(await app.eval(`document.querySelector('.session-recovery-dialog').textContent.includes(${JSON.stringify(language==='zh'?'外部工具可能仍在运行':'External tools may still be running')})`))
    await capture('recovery-dialog-'+theme+'-'+language)
  }
  for(const [width,height] of [[900,640],[640,360]]){
    await app.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
    const layout=await app.eval(`(()=>{const d=document.querySelector('.session-recovery-dialog'),b=d.querySelector('button[type="submit"]');b.scrollIntoView({block:'nearest'});const r=d.getBoundingClientRect(),p=b.getBoundingClientRect();return{fits:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,confirmVisible:p.top>=r.top&&p.bottom<=r.bottom}})()`)
    assert.ok(layout.fits&&layout.confirmVisible,JSON.stringify(layout));await capture('recovery-dialog-'+width+'x'+height)
  }
  await app.send('Emulation.clearDeviceMetricsOverride')
  await app.eval(`window.spi.updateAppSettings({theme:'dark',language:'zh'})`)
  await waitFor(()=>app.eval(`document.documentElement.lang==='zh-CN'`),'recovery Chinese restored')
  await click('.session-recovery-dialog button','取消')
  await waitFor(()=>app.eval(`!document.querySelector('.session-recovery-dialog')`),'recovery Cancel closes confirmation')
  assert.equal(await recoveryEvents(),recoveriesBefore);assert.deepEqual(await queue(),queueBefore);assert.deepEqual(ownedPi(),[old])
  await openRecovery()
  await app.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await app.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await waitFor(()=>app.eval(`!document.querySelector('.session-recovery-dialog')`),'recovery Escape closes confirmation')
  assert.equal(await recoveryEvents(),recoveriesBefore);assert.deepEqual(ownedPi(),[old])
  pass('real recovery clicks open an in-window confirmation in six theme/language combinations; Cancel/Escape never restart Pi or mutate the queue')
  await recover()
  assert.equal(await recoveryEvents(),recoveriesBefore+1)
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
  await recover(true);assert.equal((await state()).sessionFile,file)
  assert.equal(await app.eval(`document.querySelectorAll('.session-health').length`),0)
  pass('context-menu recovery uses the same real confirmation and restores an unexpectedly exited session')
  process.kill(ownedPi()[0],'SIGKILL')
  await waitFor(()=>app.eval(`document.querySelector('.session-health')?.textContent.includes('Pi 进程已退出')`),'retry fixture exited')
  const backup=file+'.recovery-fixture';fs.renameSync(file,backup)
  try{
    await openRecovery();await click('.session-recovery-dialog button','确定恢复')
    await waitFor(()=>app.eval(`document.querySelector('.session-recovery-dialog [role="alert"]')?.textContent.includes('会话文件尚未保存或已丢失')`),'visible recovery failure without closing dialog')
    assert.ok(await app.eval(`!document.querySelector('.session-recovery-dialog button[type="submit"]').disabled`))
  }finally{fs.renameSync(backup,file)}
  await click('.session-recovery-dialog button','确定恢复')
  await waitFor(()=>app.eval(`!document.querySelector('.session-recovery-dialog')&&!document.querySelector('.session-health')`),'recovery retry succeeds after fixture file restored',30000)
  assert.equal((await state()).sessionFile,file)
  assert.equal(app.errors.length,0,JSON.stringify(app.errors))
  pass('recovery failure stays visible in the dialog, remains retryable and clears only after successful recovery')
}
