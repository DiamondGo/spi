// Real renderer hit-testing: the outbox must not intercept navigation, even when expanded.
const assert=require('node:assert/strict')
module.exports=async function({app,waitFor,pass,snap,queue,expectedText}){
  const evaluate=expression=>app.eval(expression)
  const collapsed=value=>waitFor(()=>evaluate(`document.querySelector('.pending-messages')?.dataset.collapsed===${JSON.stringify(String(value))}`),'outbox collapsed '+value)
  async function click(selector){
    const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e?.getClientRects().length)return null;const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return{x,y,hit:h===e||e.contains(h)}})()`)
    assert.ok(p?.hit,'button is hidden or covered: '+selector+' '+JSON.stringify(p))
    for(const type of ['mousePressed','mouseReleased'])await app.send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:p.x,y:p.y})
  }
  const freeze=JSON.stringify(await queue())
  await evaluate(`(()=>{const host=document.querySelector('.chat-message-items'),f=document.createElement('div');f.dataset.pendingNavFixture='1';for(let i=0;i<5;i++){const m=document.createElement('div');m.dataset.userMessage='';m.style.height='600px';m.textContent='Pending navigation fixture '+i;f.append(m)}host.append(f)})()`)
  async function middle(){
    await evaluate(`(()=>{const e=document.querySelector('.chat-messages'),m=document.querySelector('[data-pending-nav-fixture]').children[1];e.scrollTop+=m.getBoundingClientRect().top-e.getBoundingClientRect().top+10;e.dispatchEvent(new Event('scroll',{bubbles:true}))})()`)
    await waitFor(()=>evaluate(`!!document.querySelector('.jump-bottom')&&[...document.querySelectorAll('.user-message-nav button')].every(e=>e.getClientRects().length>0)`),'both question arrows and return-to-latest visible')
  }
  async function geometry(){
    await middle()
    const value=await evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}},panel=document.querySelector('.pending-messages');return{panel:rect(panel),chat:rect(document.querySelector('.chat-view')),input:rect(document.querySelector('.input-options')),controls:[...document.querySelectorAll('.user-message-nav button,.jump-bottom')].map(rect),isCollapsed:panel.dataset.collapsed==='true'}})()`)
    for(const control of value.controls)assert.ok(!(value.panel.left<control.right&&value.panel.right>control.left&&value.panel.top<control.bottom&&value.panel.bottom>control.top),'outbox overlaps navigation: '+JSON.stringify(value))
    assert.ok(value.panel.left>=value.chat.left&&value.panel.right<=value.chat.right&&value.panel.top>=value.chat.top&&value.panel.bottom<=value.chat.bottom,JSON.stringify(value))
    assert.ok(value.panel.bottom<value.input.top,'dock belongs above delivery/terminal controls')
    if(value.isCollapsed){assert.ok(Math.abs(value.panel.left-value.chat.left-12)<2);assert.ok(value.chat.bottom-value.panel.bottom<12)}
    return value
  }
  async function navClicks(){
    await middle();const before=await evaluate(`document.querySelector('.chat-messages').scrollTop`)
    await click('[data-action="user-question-up"]')
    await waitFor(()=>evaluate(`document.querySelector('.chat-messages').scrollTop<${before}`),'uncovered Up navigates')
    await middle();const earlier=await evaluate(`document.querySelector('.chat-messages').scrollTop`)
    await click('[data-action="user-question-down"]')
    await waitFor(()=>evaluate(`document.querySelector('.chat-messages').scrollTop>${earlier}`),'uncovered Down navigates')
    await middle();await click('.jump-bottom')
    await waitFor(()=>evaluate(`(()=>{const e=document.querySelector('.chat-messages');return e.scrollHeight-e.scrollTop-e.clientHeight<2})()`),'uncovered Return to latest navigates')
  }
  // Keep the editor mounted, including unsaved image removal and selection, through both directions.
  await geometry();await navClicks()
  await click('[data-action="pending-minimize"]');await collapsed(true)
  assert.equal(await evaluate(`document.querySelector('.pending-message-list').getClientRects().length`),0)
  assert.ok(await evaluate(`document.querySelector('.pending-messages-summary').textContent.includes('正在编辑')`))
  await geometry();await navClicks();await snap('pending-panel-minimized')
  assert.equal(JSON.stringify(await queue()),freeze,'minimizing/navigation cannot touch queue version or editing lease')
  await click('[data-action="pending-expand"]');await collapsed(false)
  await waitFor(()=>evaluate(`document.activeElement===document.querySelector('.pending-editor textarea')`),'restored editor keyboard focus')
  assert.equal(await evaluate(`document.querySelector('.pending-editor textarea').value`),expectedText)
  assert.equal(await evaluate(`document.querySelectorAll('.pending-images img').length`),0,'unsaved image removal survives minimizing')
  await snap('pending-panel-restored-editor')
  pass('real mouse hit-tests: expanded/minimized outbox leaves both arrows and Return to latest clickable; unsaved text/images and editing lease survive')

  for(const theme of ['dark','light','high-contrast'])for(const language of ['en','zh']){
    await evaluate(`window.spi.updateAppSettings({theme:${JSON.stringify(theme)},language:${JSON.stringify(language)}})`)
    await waitFor(()=>evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}&&document.documentElement.lang===${JSON.stringify(language==='zh'?'zh-CN':'en')}`),'outbox theme/language')
    await app.send('Emulation.setDeviceMetricsOverride',{width:900,height:640,deviceScaleFactor:1,mobile:false})
    await geometry()
    await click('[data-action="pending-minimize"]');await collapsed(true);await geometry()
    await snap(`pending-panel-${theme}-${language}`)
    await click('[data-action="pending-expand"]');await collapsed(false)
    assert.equal(await evaluate(`document.querySelector('.pending-editor textarea').value`),expectedText)
  }
  // A very narrow chat column reserves a separate vertical slot for Return to latest.
  await app.send('Emulation.setDeviceMetricsOverride',{width:580,height:640,deviceScaleFactor:1,mobile:false})
  const narrow=await geometry();assert.ok(narrow.chat.right-narrow.chat.left<=280,'container-query branch must actually be exercised')
  await click('[data-action="pending-minimize"]');await collapsed(true);await geometry();await navClicks()
  await app.send('Emulation.setDeviceMetricsOverride',{width:900,height:640,deviceScaleFactor:1,mobile:false})
  await click('.terminal-toggle')
  await waitFor(()=>evaluate(`!!document.querySelector('.xterm-screen')`),'terminal open alongside dock')
  await geometry();await navClicks();await snap('pending-panel-terminal-minimized')
  await click('[data-action="pending-expand"]');await collapsed(false);await geometry()
  await app.send('Emulation.setDeviceMetricsOverride',{width:900,height:500,deviceScaleFactor:1,mobile:false})
  await evaluate(`document.querySelector('.terminal-panel').style.height='45vh'`)
  await waitFor(()=>evaluate(`document.querySelector('.chat-view').dataset.shortViewport==='true'`),'short chat viewport detected')
  const short=await geometry();assert.ok(short.chat.bottom-short.chat.top<180)
  await navClicks();await snap('pending-panel-short-viewport')
  await click('.terminal-toggle')
  await waitFor(()=>evaluate(`!document.querySelector('.terminal-panel')?.getClientRects().length`),'terminal hidden')
  await evaluate(`window.spi.updateAppSettings({theme:'dark',language:'zh'})`)
  await app.send('Emulation.clearDeviceMetricsOverride')
  await evaluate(`document.querySelector('[data-pending-nav-fixture]').remove();const e=document.querySelector('.chat-messages');e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll',{bubbles:true}))`)
  assert.equal(JSON.stringify(await queue()),freeze)
  assert.equal(await evaluate(`document.querySelector('.pending-editor textarea').value`),expectedText)
  pass('outbox dock remains clear of navigation across six themes/languages, narrow/short viewports and an open terminal without changing delivery or edits',{narrowChatWidth:narrow.chat.right-narrow.chat.left,shortChatHeight:short.chat.bottom-short.chat.top})
}
