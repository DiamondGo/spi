// Cross-platform recovery confirmation against real Electron/Pi; no native-dialog stubs or signals.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async({app,waitFor,fill,workspace,artifacts,pass})=>{
  const id=await app.eval(`document.querySelector('.session-tab.active').dataset.sessionId`),key=JSON.stringify(id)
  const click=async(selector,text)=>{
    const p=await app.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent===${JSON.stringify(text)});if(!e||e.disabled)throw Error('Recovery control unavailable');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await app.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await app.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1})
  }
  const state=()=>app.eval(`window.spi.getState(${key})`),queue=()=>app.eval(`window.spi.getPendingMessages(${key})`)
  const exit=async()=>{
    // Registered only by this private fixture. It exits its own Pi, never an arbitrary PID.
    await app.eval(`window.spi.sendPrompt(${key},'/fixture-exit','normal').catch(()=>{})`)
    await waitFor(()=>app.eval(`document.querySelector('.session-health')?.textContent.includes('Pi 进程已退出')`),'fixture Pi exit retained in UI')
  }
  const open=async(menu=false)=>{
    if(menu){await app.eval(`(()=>{const e=document.querySelector('.session-tab.active'),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+8,clientY:r.y+8}))})()`);await waitFor(()=>app.eval(`!!document.querySelector('.context-menu')`),'recovery menu');await click('.context-menu button','恢复会话')}
    else await click('.session-health button','恢复会话')
    await waitFor(()=>app.eval(`!!document.querySelector('.session-recovery-dialog[open]')`),'in-window recovery confirmation')
  }
  const confirm=async()=>{await click('.session-recovery-dialog button','确定恢复');await waitFor(()=>app.eval(`!document.querySelector('.session-health')&&!document.querySelector('.session-recovery-dialog')`),'healthy UI after confirmed recovery',35000)}
  await app.eval(`window.spi.setModel(${key},'spi-test','fixture')`)
  const prompt=JSON.stringify({tool:'read',input:{path:path.join(workspace,'smoke.txt')}})
  await app.eval(`window.spi.sendPrompt(${key},${JSON.stringify(prompt)},'normal')`)
  await waitFor(()=>app.eval(`document.body.textContent.includes('SPI_FIXTURE_DONE')&&!document.querySelector('.btn-stop')`),'saved fixture history')
  const file=(await state()).sessionFile;assert.ok(fs.existsSync(file));await fill(app,'SPI_RECOVERY_DRAFT_KEEP')
  await exit();const pending=await queue();await open()
  assert.equal(await app.eval(`document.activeElement.textContent`),'取消')
  await click('.session-recovery-dialog button','取消');await waitFor(()=>app.eval(`!document.querySelector('.session-recovery-dialog')`),'cancel closes modal')
  assert.ok(await app.eval(`!!document.querySelector('.session-health')`));assert.deepEqual(await queue(),pending)
  await open();await app.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await app.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await waitFor(()=>app.eval(`!document.querySelector('.session-recovery-dialog')`),'Escape cancels recovery')
  await open();await confirm();assert.equal((await state()).sessionFile,file)
  assert.equal(await app.eval(`document.querySelector('.input-bar textarea').value`),'SPI_RECOVERY_DRAFT_KEEP');assert.equal((await queue()).paused,true)
  pass('real banner confirmation, passive Cancel/Escape and successful recovery clear stale banner while preserving draft/history and paused queue')
  await exit();await open(true);const backup=file+'.recovery-backup';fs.renameSync(file,backup)
  try{await click('.session-recovery-dialog button','确定恢复');await waitFor(()=>app.eval(`document.querySelector('.session-recovery-dialog [role="alert"]')?.textContent.includes('会话文件尚未保存或已丢失')`),'visible retryable recovery failure')}finally{fs.renameSync(backup,file)}
  await confirm();assert.equal((await state()).sessionFile,file)
  assert.equal(await app.eval(`document.querySelector('.input-bar textarea').value`),'SPI_RECOVERY_DRAFT_KEEP')
  pass('real context-menu confirmation exposes recovery error and retries successfully without retaining exit warning')
  const revisions=await app.eval(`window.__smokeEvents.filter(e=>e.event.type==='spi_session_health').map(e=>e.event.health.revision)`)
  assert.ok(revisions.length>=4);for(let i=1;i<revisions.length;i++)assert.ok(revisions[i]>revisions[i-1],JSON.stringify(revisions))
  const screenshot=await app.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'session-recovery-healthy.png'),Buffer.from(screenshot.data,'base64'))
  assert.equal(app.errors.length,0,JSON.stringify(app.errors))
  pass('owner health revisions remain monotonic across genuine Pi restarts')
}
