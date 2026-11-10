// Real Electron + real Pi RPC, with a synthetic permission-modes-compatible extension.
// All tool actions/model traffic/configuration are confined to the test workspace/profile.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async({app,waitFor,pass,workspace,artifacts,hashes,before})=>{
  const evaluate=expression=>app.eval(expression),snapshot=()=>evaluate('window.spi.getYoloState()')
  const id=Object.keys((await snapshot()).sessions)[0]
  assert.ok(id);await evaluate(`window.spi.setModel(${JSON.stringify(id)},'spi-test','fixture')`)
  const mode=async enabled=>{await waitFor(()=>evaluate(`!document.querySelector('input[data-control="yolo"]').disabled`),'YOLO ready');await evaluate(`(()=>{const e=document.querySelector('input[data-control="yolo"]');if(e.checked!==${enabled})e.click()})()`);await waitFor(async()=>(await snapshot()).sessions[id].enabled===enabled&&await evaluate(`document.querySelector('input[data-control="yolo"]').checked===${enabled}`),'YOLO switch synchronized')}
  const start=async(tool,input)=>{const n=await evaluate('window.__smokeEvents.length');await evaluate(`window.spi.sendPrompt(${JSON.stringify(id)},${JSON.stringify(JSON.stringify({tool,input}))},'normal')`);return n}
  const settled=n=>waitFor(()=>evaluate(`window.__smokeEvents.slice(${n}).some(e=>e.sessionId===${JSON.stringify(id)}&&e.event.type==='agent_settled')`),'extension fixture settled',15000)
  const live=()=>evaluate(`document.querySelectorAll('.dialog-card:not(.answered)').length`)
  const card=()=>waitFor(async()=>await live()>0,'manual extension dialog')
  const click=label=>evaluate(`(()=>{const d=document.querySelector('.dialog-card:not(.answered)');[...d.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()})()`)
  const autoCount=()=>evaluate(`document.querySelectorAll('[data-auto-approved="true"]').length`)
  let n=await start('bash',{command:'printf SPI_EXT_PENDING'});await card();assert.equal(await autoCount(),0)
  assert.ok(await evaluate(`document.querySelector('.dialog-card:not(.answered)').textContent.includes('permission-modes')`))
  await mode(true);await settled(n);await waitFor(async()=>await autoCount()===1,'pending dialog auto reply audit');assert.equal(await live(),0)
  pass('YOLO switch resolves a displayed compatible Pi approval once and retires its buttons')

  n=await start('bash',{command:'printf SPI_EXT_FUTURE'});await settled(n);assert.equal(await live(),0);assert.equal(await autoCount(),2)
  const answers=await evaluate(`window.__smokeEvents.filter(e=>e.event.method==='notify'&&String(e.event.message).startsWith('SPI_EXT_ANSWER')).map(e=>e.event.message)`)
  assert.ok(answers.length>=2&&answers.every(s=>s.endsWith(':Allow')))
  pass('YOLO auto-replies to future compatible bash approval with single Allow only')

  const file=path.join(workspace,'SPI_EXT_WRITE.txt');n=await start('write',{path:file,content:'SPI_AUTO_WRITE'});await settled(n)
  assert.equal(fs.readFileSync(file,'utf8'),'SPI_AUTO_WRITE');assert.equal(await autoCount(),3)
  pass('write approval with the bypass option still chooses single Allow, not persistent/bypass choices')

  n=await start('bash',{command:'printf SPI_EXT_GENERIC'});await card();assert.equal(await autoCount(),3)
  assert.ok(await evaluate(`document.querySelector('.dialog-card:not(.answered)').textContent.includes('需手动答复')`))
  await click('Block');await settled(n);assert.equal(await live(),0)
  pass('a generic deletion select with identical Allow buttons stays manual even with YOLO on')

  n=await start('bash',{command:'printf SPI_EXT_UNKNOWN'});await card();assert.equal(await autoCount(),3);await click('取消');await settled(n)
  pass('changed/unknown approval options stay manual and can be cancelled')

  const denied=path.join(workspace,'SPI_DIRECT_DENY.txt'),sh=s=>"'"+s.replaceAll("'","'\\''")+"'"
  n=await start('bash',{command:'printf denied > '+sh(denied)+' # SPI_EXT_DENY'});await settled(n)
  assert.equal(fs.existsSync(denied),false);assert.equal(await autoCount(),3)
  pass('YOLO does not override a direct Pi extension block')

  n=await start('bash',{command:'printf SPI_EXT_GENERIC_STOP'});await card();await evaluate(`window.spi.abortSession(${JSON.stringify(id)})`);await settled(n)
  await waitFor(async()=>await live()===0,'stop cancels extension dialog');assert.equal(await autoCount(),3)
  pass('Stop cancels a live Pi dialog without approving it or leaving stale buttons')

  await mode(false);n=await start('bash',{command:'printf SPI_EXT_MANUAL'});await card();assert.equal(await autoCount(),3);await click('Block');await settled(n)
  pass("YOLO off restores Pi's own manual compatible approvals")
  assert.equal(await evaluate('typeof window.spi.getPermissions'),'undefined');assert.equal((await snapshot()).sessions[id].enabled,false)
  assert.equal((await evaluate(`window.spi.getState(${JSON.stringify(id)})`)).model.provider,'spi-test')
  assert.deepEqual(hashes(),before);assert.equal(app.errors.length,0,JSON.stringify(app.errors))
  pass('no Pi settings, allowlist, model choice or renderer exceptions changed')
  const screenshot=await app.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'extension-auto-approval.png'),Buffer.from(screenshot.data,'base64'))
}
