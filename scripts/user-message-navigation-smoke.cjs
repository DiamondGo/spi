const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async function({app,waitFor,pass,fill,artifacts}){
  const evaluate=expression=>app.eval(expression)
  const capture=async name=>{
    const image=await app.send('Page.captureScreenshot',{format:'png'})
    fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(image.data,'base64'))
    fs.writeFileSync(path.join(artifacts,name+'-viewport.json'),JSON.stringify((await app.send('Page.getLayoutMetrics')).cssLayoutViewport))
  }
  const id=await evaluate('document.querySelector(".session-tab.active").dataset.sessionId')
  await evaluate(`window.spi.setModel(${JSON.stringify(id)},'spi-test','fixture')`)
  await evaluate(`window.__navSettled=0;window.spi.onPiEvent(e=>{if(e.event.type==='agent_settled')window.__navSettled++})`)
  const visible=direction=>evaluate(`!!document.querySelector('[data-action="user-question-${direction}"]')?.getClientRects().length`)
  const snapshot=()=>evaluate(`(()=>{const e=document.querySelector('.chat-view .chat-messages'),r=e.getBoundingClientRect(),padding=parseFloat(getComputedStyle(e).paddingTop),starts=[...e.querySelectorAll('[data-user-message]')].map(m=>m.getBoundingClientRect().top-r.top-e.clientTop+e.scrollTop),above=starts.map((top,i)=>({top,i})).filter(m=>m.top<e.scrollTop-2).at(-1)?.i??null,below=starts.findIndex(top=>top>=e.scrollTop+e.clientHeight);return{starts,above,below:below<0?null:below,top:e.scrollTop,height:e.clientHeight,scrollHeight:e.scrollHeight,padding}})()`)
  const sync=async()=>{await waitFor(async()=>{const s=await snapshot();return(await visible('up'))===(s.above!==null)&&(await visible('down'))===(s.below!==null)},'question arrows match viewport')}
  const jump=async direction=>{
    await sync()
    const before=await snapshot(),index=direction==='up'?before.above:before.below
    assert.notEqual(index,null)
    const expected=Math.max(0,Math.min(before.starts[index]-before.padding,before.scrollHeight-before.height))
    await evaluate(`document.querySelector('[data-action="user-question-${direction}"]').click()`)
    await waitFor(async()=>Math.abs((await snapshot()).top-expected)<2,'question aligned at top')
    await sync()
    return index
  }
  const submit=async command=>{
    await fill(app,JSON.stringify({tool:'bash',input:{command}}))
    await waitFor(()=>evaluate('!document.querySelector(".btn-send").disabled'),'send ready')
    await evaluate('document.querySelector(".btn-send").click()')
  }
  await sync();assert.equal(await visible('up'),false);assert.equal(await visible('down'),false)
  pass('empty chat hides both user-question arrows')
  for(let i=1;i<=4;i++){
    await submit(`i=1; while [ "$i" -le 100 ]; do printf 'SPI_NAV_OUTPUT_${i} line %s\\n' "$i"; i=$((i+1)); done`)
    await waitFor(()=>evaluate(`window.__navSettled>=${i}`),'fixture reply settled',60000)
  }
  await evaluate(`document.querySelectorAll('.tool-output').forEach(e=>e.open=true)`)
  await waitFor(async()=>{const s=await snapshot();return s.starts.length===4&&s.scrollHeight>s.height*2},'long multi-question transcript')
  await evaluate(`const e=document.querySelector('.chat-view .chat-messages');e.scrollTop=e.scrollHeight`)
  await sync();assert.equal(await visible('up'),true);assert.equal(await visible('down'),false)
  const last=await jump('up');assert.ok(last>=1)
  while(await visible('up'))await jump('up')
  assert.equal((await snapshot()).top,0);assert.equal(await visible('down'),true)
  pass('Up walks backward through offscreen questions without repeatedly selecting the aligned question')
  const next=await jump('down');assert.ok(next>0)
  await evaluate(`(()=>{const e=document.querySelector('.chat-view .chat-messages'),m=e.querySelectorAll('[data-user-message]')[1];e.scrollTop+=m.getBoundingClientRect().top-e.getBoundingClientRect().top-parseFloat(getComputedStyle(e).paddingTop)})()`)
  const position=()=>evaluate(`(()=>{const n=document.querySelector('.user-message-nav').getBoundingClientRect(),c=document.querySelector('.chat-view .chat-messages').getBoundingClientRect(),u=document.querySelector('[data-action="user-question-up"]').getBoundingClientRect(),d=document.querySelector('[data-action="user-question-down"]').getBoundingClientRect(),i=document.querySelector('.input-bar-wrap').getBoundingClientRect();return{right:n.right,bottom:n.bottom,chatRight:c.right,chatBottom:c.bottom,upBottom:u.bottom,downTop:d.top,inputTop:i.top}})()`)
  await sync();assert.equal(await visible('up'),true);assert.equal(await visible('down'),true)
  const p=await position();assert.ok(p.upBottom<p.downTop);assert.ok(p.right<p.chatRight&&p.bottom<=p.chatBottom&&p.bottom<p.inputTop)
  await capture('user-question-navigation-default')
  await jump('down')
  const after=await position();assert.ok(Math.abs(p.right-after.right)<1&&Math.abs(p.bottom-after.bottom)<1,'floating arrows do not move with content')
  pass('arrows float beside the scrollbar above the composer; Up always occupies the upper slot')
  while(await visible('down'))await jump('down')
  assert.equal(await visible('down'),false)
  pass('Down walks forward to the last offscreen question and disappears at the end')

  await evaluate(`document.querySelector('.jump-bottom')?.click()`)
  await submit("printf 'SPI_NAV_STREAM_START\\n'; sleep 2; printf 'SPI_NAV_STREAM_END\\n'")
  await waitFor(()=>evaluate(`document.querySelectorAll('[data-user-message]').length===5`),'streaming user question')
  await sync();await jump('up')
  const frozen=(await snapshot()).top
  await waitFor(()=>evaluate('window.__navSettled>=5'),'streaming finished',60000)
  assert.ok(Math.abs((await snapshot()).top-frozen)<2,'streaming must not pull question navigation back to the bottom')
  await sync()
  pass('new streaming output does not pull a navigated question back to the latest output')

  await evaluate(`document.querySelector('.chat-view .chat-messages').scrollTop=0`)
  await sync()
  await app.send('Emulation.setDeviceMetricsOverride',{width:1000,height:650,deviceScaleFactor:1,mobile:false})
  await sync()
  await evaluate(`document.querySelectorAll('.tool-output').forEach(e=>e.open=false)`)
  await sync()
  await evaluate(`document.querySelectorAll('.tool-output').forEach(e=>e.open=true)`)
  await sync();await jump('down')
  await capture('user-question-navigation')
  pass('viewport resizing and collapsed/expanded tool outputs update arrow visibility and targets')
  for(const theme of ['light','high-contrast']){
    await evaluate(`window.spi.updateAppSettings({theme:${JSON.stringify(theme)}})`)
    await waitFor(()=>evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`),'theme applied')
    await sync();await capture('user-question-navigation-'+theme)
  }
  pass('floating question controls retain their layout in dark, light and high-contrast themes')
  await evaluate(`document.querySelector('.btn-new').click()`)
  await waitFor(()=>evaluate(`document.querySelector('.session-tab.active')?.dataset.sessionId!==${JSON.stringify(id)} && !document.querySelector('[data-user-message]')`),'switch to empty session')
  await sync();assert.equal(await visible('up'),false);assert.equal(await visible('down'),false)
  await evaluate(`document.querySelector('.session-tab[data-session-id="'+${JSON.stringify(id)}+'"]').click()`)
  await waitFor(()=>evaluate(`document.querySelectorAll('[data-user-message]').length===5`),'restore original transcript')
  await sync()
  pass('switching sessions clears stale arrows and recomputes navigation for the restored transcript')
  assert.equal(app.errors.length,0,JSON.stringify(app.errors))
}
