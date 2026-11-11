const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process')
module.exports=async function({app,launch,stop,waitFor,pass,fill,workspace,profile,artifacts}) {
  const evaluate=expression=>app.eval(expression)
  let id=await evaluate(`document.querySelector('.session-tab.active').dataset.sessionId`)
  const session=()=>evaluate(`window.spi.getState(${JSON.stringify(id)})`)
  const clickMenu=async label=>{await waitFor(()=>evaluate(`!!document.querySelector('.context-menu')`),'context menu');await evaluate(`Array.from(document.querySelectorAll('.context-menu button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`)}
  const context=async selector=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+20,clientY:r.y+10}))})()`)
  const inputName=async name=>evaluate(`(()=>{const e=document.querySelector('.session-action-dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(name)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const saveName=async name=>{await waitFor(()=>evaluate(`!!document.querySelector('.session-action-dialog input')`),'rename dialog');await inputName(name);await evaluate(`document.querySelector('.session-action-dialog button[type=submit]').click()`);await waitFor(()=>evaluate(`!document.querySelector('.session-action-dialog')`),'name saved')}
  const prompt=JSON.stringify({tool:'read',input:{path:path.join(workspace,'smoke.txt')}})
  await evaluate(`window.spi.setModel(${JSON.stringify(id)},'spi-test','fixture')`)
  await fill(app,prompt);await evaluate(`document.querySelector('.btn-send').click()`)
  await waitFor(()=>evaluate(`document.body.textContent.includes('SPI_FIXTURE_DONE')&&!document.querySelector('.btn-stop')`),'seed history')
  const file=(await session()).sessionFile
  await evaluate(`document.querySelector('.session-tab-label').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
  await saveName('手工命名一')
  await waitFor(()=>evaluate(`document.querySelector('.session-tab-label').textContent==='手工命名一'&&document.querySelector('.session-item.active .session-item-title')?.textContent==='手工命名一'`),'list and tab name synchronized')
  assert.equal((await session()).sessionName,'手工命名一')
  await context('.session-item.active');await clickMenu('重命名会话');await saveName('手工命名二')
  assert.equal((await evaluate(`window.spi.scanSessions(${JSON.stringify(workspace)})`))[0].name,'手工命名二')
  pass('tab double-click and session-row context menu rename persist the latest native Pi name in both list and tab')

  const before=await evaluate(`window.spi.getMessages(${JSON.stringify(id)}).then(m=>m.length)`)
  await context('.session-tab.active');await clickMenu('AI 生成名称')
  await waitFor(()=>evaluate(`document.querySelector('.session-action-dialog input')?.value==='会话操作与终端优化'&&!document.querySelector('.session-action-dialog input').disabled`),'AI title preview',45000)
  assert.equal((await session()).sessionName,'手工命名二')
  assert.equal(await evaluate(`window.spi.getMessages(${JSON.stringify(id)}).then(m=>m.length)`),before)
  await evaluate(`document.querySelector('.session-action-dialog button[type=submit]').click()`)
  await waitFor(()=>evaluate(`document.querySelector('.session-tab-label')?.textContent==='会话操作与终端优化'`),'suggested name saved')
  pass('AI naming uses the real session model without adding chat entries; preview does not rename until Save')

  await evaluate(`document.querySelector('.session-tab-close').click()`)
  await waitFor(()=>evaluate(`!document.querySelector('.session-tab')`),'session closed')
  await context('.session-list .session-item');await clickMenu('重命名会话');await saveName('离线历史新名称')
  assert.equal(await evaluate(`document.querySelectorAll('.session-tab').length`),0)
  assert.equal((await evaluate(`window.spi.scanSessions(${JSON.stringify(workspace)})`))[0].name,'离线历史新名称')
  await waitFor(()=>evaluate(`document.querySelector('.session-list .session-item-title')?.textContent==='离线历史新名称'`),'offline name refreshed')
  await evaluate(`document.querySelector('.session-list .session-item').click()`)
  await waitFor(()=>evaluate(`document.querySelector('.session-tab-label')?.textContent==='离线历史新名称'`),'renamed history reopened')
  id=await evaluate(`document.querySelector('.session-tab.active').dataset.sessionId`)
  pass('closed history can be renamed without opening a Pi process; reopening restores the saved name')

  await evaluate(`document.querySelector('.terminal-toggle').click()`)
  await waitFor(()=>evaluate(`!!document.querySelector('.terminal-panel:not([hidden])')`),'terminal opened')
  const terminal=await evaluate(`window.spi.getTerminal(${JSON.stringify(id)})`)
  await evaluate(`document.querySelector('.terminal-toggle').click()`)
  await waitFor(()=>evaluate(`!document.querySelector('.terminal-panel:not([hidden])')`),'terminal hidden')
  assert.equal((await evaluate(`window.spi.getTerminal(${JSON.stringify(id)})`)).pid,terminal.pid)
  await evaluate(`document.querySelector('.terminal-toggle').click()`)
  await waitFor(()=>evaluate(`!!document.querySelector('.terminal-panel:not([hidden])')`),'same terminal shown')
  assert.equal((await evaluate(`window.spi.getTerminal(${JSON.stringify(id)})`)).pid,terminal.pid)
  pass('terminal toolbar toggles visibility and retains the same live PTY')

  await context('.session-list .session-item.active');await clickMenu('删除会话')
  await waitFor(()=>evaluate(`!!document.querySelector('.session-action-dialog')`),'delete confirmation')
  await evaluate(`document.querySelector('.session-action-dialog button[type=button]').click()`)
  assert.ok(fs.existsSync(file));assert.equal((await session()).sessionFile,file)
  await context('.session-tab.active');await clickMenu('删除会话')
  await evaluate(`document.querySelector('.session-action-dialog button[type=submit]').click()`)
  await waitFor(()=>!fs.existsSync(file),'history moved to trash')
  await waitFor(()=>evaluate(`!document.querySelector('.session-tab')&&!document.querySelector('.terminal-panel')&&!document.querySelector('.session-action-dialog')`),'deleted tab/terminal retired')
  assert.ok(fs.existsSync(path.join(workspace,'smoke.txt')))
  const trash=path.join(artifacts,'xdg-data/Trash/files');assert.ok(fs.existsSync(trash));assert.ok(fs.readdirSync(trash).some(f=>f.endsWith('.jsonl')))
  pass('Delete asks for confirmation; Cancel retains history; confirmed deletion trashes history and closes its Pi/terminal only')

  // Electron's CDP does not expose Browser.setWindowBounds; move only our owned X11 window.
  assert.equal(process.env.SPI_TEST_VIRTUAL_DISPLAY,'1')
  const tree=execFileSync('xwininfo',['-root','-tree'],{encoding:'utf8'})
  const owned=[...tree.matchAll(/^\s*(0x[0-9a-f]+)\s/gm)].map(match=>match[1]).find(id=>{try{return execFileSync('xprop',['-id',id,'_NET_WM_PID'],{encoding:'utf8'}).includes('= '+app.child.pid+'\n')}catch{return false}})
  assert.ok(owned)
  const bounds={left:130,top:95,width:1090,height:720}
  execFileSync('python3',['-c',`import ctypes,sys
x=ctypes.CDLL('libX11.so.6');x.XOpenDisplay.restype=ctypes.c_void_p
x.XMoveResizeWindow.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_int,ctypes.c_uint,ctypes.c_uint]
x.XSync.argtypes=[ctypes.c_void_p,ctypes.c_int];x.XCloseDisplay.argtypes=[ctypes.c_void_p]
d=x.XOpenDisplay(None);assert d
x.XMoveResizeWindow(d,int(sys.argv[1],16),130,95,1090,720);x.XSync(d,0);x.XCloseDisplay(d)`,owned])
  const windowFile=path.join(profile,'spi-window.json')
  await waitFor(()=>{try{const state=JSON.parse(fs.readFileSync(windowFile));return state.bounds.x===130&&state.bounds.y===95&&state.bounds.width===1090&&state.bounds.height===720}catch{return false}},'window geometry persisted')
  assert.equal(app.errors.length,0,JSON.stringify(app.errors))
  await stop(app);app=await launch({waitForSession:false})
  const restored=await app.eval(`({left:screenX,top:screenY,width:outerWidth,height:outerHeight})`)
  assert.deepEqual(restored,bounds)
  pass('real Electron window restores its previous position and dimensions after restart')
  await stop(app)
}
