// Real GUI verification of the two-state YOLO contract; no external model/profile.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async function({app,launch,stop,waitFor,pass,fill,workspace,profile,artifacts,hashes,before}){
  const evaluate=expression=>app.eval(expression),snapshot=()=>evaluate('window.spi.getYoloState()')
  let id=Object.keys((await snapshot()).sessions)[0]
  const active=()=>evaluate(`document.querySelector('.session-tab.active')?.dataset.sessionId`)
  const settled=n=>waitFor(()=>evaluate(`window.__smokeEvents.slice(${n}).some(e=>e.sessionId===${JSON.stringify(id)}&&e.event.type==='agent_settled')`),'local fixture settled',15000)
  const start=async(tool,input)=>{const n=await evaluate('window.__smokeEvents.length');await evaluate(`window.spi.sendPrompt(${JSON.stringify(id)},${JSON.stringify(JSON.stringify({tool,input}))},'normal')`);return n}
  const toggle=async enabled=>{await waitFor(async()=>{const current=(await snapshot()).sessions[id].enabled;return evaluate(`(()=>{const e=document.querySelector('input[data-control="yolo"]');return e&&!e.disabled&&e.checked===${current}})()`)},'YOLO control ready');await evaluate(`(()=>{const e=document.querySelector('input[data-control="yolo"]');if(e.checked!==${enabled})e.click()})()`);await waitFor(async()=>(await snapshot()).sessions[id].enabled===enabled&&await evaluate(`document.querySelector('input[data-control="yolo"]').checked===${enabled}`),'YOLO synchronized')}
  const capture=async name=>{const image=await app.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(image.data,'base64'))}
  assert.deepEqual((await snapshot()).sessions[id],{enabled:false,ready:true})
  assert.equal(await evaluate(`document.querySelectorAll('.tb-details select').length`),2)
  assert.equal(await evaluate(`document.querySelectorAll('.tb-yolo input[role="switch"]').length`),1)
  assert.equal(await evaluate(`document.querySelector('.tb-yolo').textContent.trim()`),'YOLO')
  assert.equal(await evaluate(`!!document.querySelector('[data-control="permission"],.permissions,.permission-request')`),false)
  assert.equal(await evaluate(`typeof window.spi.getPermissions`),'undefined')
  pass('header has two selectors and one unchecked YOLO switch, without the old Permissions API/panel')

  await evaluate(`window.spi.setModel(${JSON.stringify(id)},'spi-test','fixture')`)
  const normal=path.join(workspace,'normal-pi-approved.txt')
  let n=await start('write',{path:normal,content:'PI_APPROVED_WITH_YOLO_OFF'});await settled(n)
  assert.equal(fs.readFileSync(normal,'utf8'),'PI_APPROVED_WITH_YOLO_OFF')
  assert.equal(await evaluate(`!!document.querySelector('.permission-request,.dialog-card:not(.answered)')`),false)
  pass('YOLO off does not add an sPi approval: a Pi-approved write runs directly')

  const command=async policy=>{const n=await evaluate('window.__smokeEvents.length');await evaluate(`window.spi.sendPrompt(${JSON.stringify(id)},${JSON.stringify('/fixture-policy '+policy)},'normal')`);await waitFor(()=>evaluate(`window.__smokeEvents.slice(${n}).some(e=>e.event.message===${JSON.stringify('SPI_POLICY:'+policy)})`),'Pi fixture policy '+policy)}
  await command('bypass');n=await start('bash',{command:'printf SPI_EXT_PI_BYPASS'});await settled(n)
  assert.equal(await evaluate(`document.querySelectorAll('[data-auto-approved="true"]').length`),0)
  assert.equal(await evaluate(`document.querySelectorAll('.dialog-card:not(.answered)').length`),0)
  await command('deny');const denied=path.join(workspace,'pi-policy-denied.txt')
  n=await start('bash',{command:'printf denied > '+JSON.stringify(denied)+' # SPI_EXT_PI_POLICY'});await settled(n);assert.equal(fs.existsSync(denied),false)
  await command('ask')
  pass('YOLO off follows Pi session policy: bypass stays allowed, deny stays blocked, and ask remains Pi-owned')

  const hit=await evaluate(`(()=>{const r=document.querySelector('input[aria-label="YOLO"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  for(const type of ['mousePressed','mouseReleased'])await app.send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...hit})
  await waitFor(async()=>(await snapshot()).sessions[id].enabled===true,'native mouse enables YOLO')
  await toggle(true) // wait for the IPC/React update to re-enable the native input
  await evaluate(`document.querySelector('input[aria-label="YOLO"]').focus()`)
  for(const type of ['keyDown','keyUp'])await app.send('Input.dispatchKeyEvent',{type,key:' ',code:'Space',windowsVirtualKeyCode:32})
  await waitFor(async()=>(await snapshot()).sessions[id].enabled===false,'Space turns YOLO off')
  await toggle(true)
  assert.equal(await evaluate(`document.querySelector('.tb-yolo').classList.contains('enabled')`),true)
  pass('YOLO has native checkbox mouse/Space behavior and an enabled visual state, without a confirmation modal')

  const first=id;await evaluate(`document.querySelector('.btn-new').click()`);await waitFor(async()=>Object.keys((await snapshot()).sessions).length===2&&(await active())!==first,'peer session')
  const peer=await active();assert.equal((await snapshot()).sessions[peer].enabled,false);assert.equal(await evaluate(`document.querySelector('input[aria-label="YOLO"]').checked`),false)
  await evaluate(`document.querySelector('.session-tab[data-session-id="${first}"]').click()`)
  assert.equal(await evaluate(`document.querySelector('input[aria-label="YOLO"]').checked`),true)
  await evaluate(`document.querySelector('.session-tab[data-session-id="${peer}"] .session-tab-close').click()`)
  await waitFor(async()=>Object.keys((await snapshot()).sessions).length===1,'peer closed');await toggle(false)
  pass('YOLO is isolated per tab; switching and closing a peer do not change the first session')

  const title='YOLO 开关：长标题保持单行，模型与思考选择器不挤占开关。'.repeat(4)
  await evaluate(`window.spi.sendPrompt(${JSON.stringify(id)},${JSON.stringify('/spi-title '+title)},'normal')`)
  await waitFor(()=>evaluate(`document.querySelector('.tb-name').textContent===${JSON.stringify(title)}`),'long title')
  for(const [width,height]of [[1280,800],[900,640]]){
    await app.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
    const layout=await evaluate(`(()=>{const r=document.querySelector('.tb-yolo').getBoundingClientRect(),n=document.querySelector('.tb-name'),header=document.querySelector('.titlebar').getBoundingClientRect();return{height:header.height,yolo:r.height,left:r.left,right:r.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,clipped:n.scrollWidth>n.clientWidth,drag:getComputedStyle(document.querySelector('.tb-yolo')).webkitAppRegion}})()`)
    assert.equal(layout.height,40);assert.equal(layout.yolo,28);assert.equal(layout.overflow,false);assert.equal(layout.clipped,true);assert.equal(layout.drag,'no-drag');assert.ok(layout.left>=0&&layout.right<width-130)
    await capture('yolo-header-'+width)
    await toggle(true);await capture('yolo-header-on-'+width);await toggle(false)
  }
  await app.send('Emulation.clearDeviceMetricsOverride');await evaluate(`window.spi.sendPrompt(${JSON.stringify(id)},'/spi-title','normal')`)
  await require('./sidebar-layout-smoke.cjs')({app,waitFor,pass,artifacts})
  pass('YOLO remains visible and non-draggable in the 40px ellipsized title bar at 1280/900px')

  await require('./extension-ui-smoke.cjs')({app,waitFor,pass,workspace,artifacts,hashes,before})
  id=await require('./session-dedup-smoke.cjs')({app,waitFor,pass,fill,workspace,currentId:id})
  await toggle(true);await waitFor(()=>evaluate('window.spi.loadLayout().then(x=>x.sessions.length===1)'),'layout saved')
  await stop(app);app=await launch();id=Object.keys((await snapshot()).sessions)[0]
  assert.ok(id);assert.equal((await snapshot()).sessions[id].enabled,false);assert.equal(await evaluate(`document.querySelector('input[aria-label="YOLO"]').checked`),false)
  assert.deepEqual(hashes(),before);assert.equal(app.errors.length,0,JSON.stringify(app.errors))
  pass('reopening defaults YOLO off; legacy sPi permissions and Pi settings remain untouched')
  await capture('yolo-final');await stop(app)
}
