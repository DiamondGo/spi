const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async function({app,waitFor,pass,fill,artifacts}){
 const evaluate=e=>app.eval(e),button='[data-control="context"]'
 const id=await evaluate('document.querySelector(".session-tab.active").dataset.sessionId')
 const records=()=>{const file=path.join(artifacts,'compactions.jsonl');return fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]}
 const capture=async name=>{const shot=await app.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(shot.data,'base64'))}
 await evaluate(`window.spi.setModel(${JSON.stringify(id)},'spi-test','fixture')`)
 await evaluate(`window.__contextSettled=0;window.spi.onPiEvent(e=>{if(e.event.type==='agent_settled')window.__contextSettled++})`)
 await waitFor(()=>evaluate(`!!document.querySelector('${button}') && !document.querySelector('${button}').disabled`),'context control ready')
 const geo=await evaluate(`(()=>{const a=document.querySelector('.tb-thinking').closest('.tb-choice').getBoundingClientRect(),b=document.querySelector('${button}').getBoundingClientRect();return{thinkingRight:a.right,contextLeft:b.left}})()`)
 assert.ok(geo.contextLeft>=geo.thinkingRight)
 await evaluate(`document.querySelector('${button}').click()`)
 await waitFor(()=>evaluate(`document.querySelector('.context-error')?.textContent.includes('too small')`),'empty-session error')
 assert.equal(records().length,0)
 await evaluate(`document.querySelector('.context-error button').click()`)
 pass('context indicator sits to the right of Thinking; empty compaction fails safely without a prompt')

 const send=async n=>{
  const before=await evaluate('window.__contextSettled')
  await fill(app,JSON.stringify({tool:'bash',input:{command:`i=0; while [ "$i" -lt 120 ]; do printf 'SPI_CONTEXT_${n} material for deterministic compaction line %s\\n' "$i"; i=$((i+1)); done`}}))
  await evaluate(`document.querySelector('.btn-send').click()`)
  await waitFor(()=>evaluate(`window.__contextSettled>${before}`),'fixture reply settled',60000)
 }
 await send(1);await send(2)
 const usage=await evaluate(`window.spi.getContextUsage(${JSON.stringify(id)})`)
 assert.ok(usage&&typeof usage.percent==='number')
 // The indicator intentionally coalesces reply/settled events for 150ms. A nonempty
 // value can still be the previous reply's estimate on faster native runners.
 await waitFor(()=>evaluate(`(()=>{const p=document.querySelector('${button}').dataset.contextPercent;return p!==''&&Math.abs(Number(p)-${usage.percent})<0.01})()`),'current context percent matches completed reply')
 const displayed=Number(await evaluate(`document.querySelector('${button}').dataset.contextPercent`))
 assert.ok(Math.abs(displayed-usage.percent)<0.01)
 const tooltip=await evaluate(`document.querySelector('.tb-context-wrap').title`)
 assert.ok(tooltip.includes(usage.tokens.toLocaleString())&&tooltip.includes(usage.contextWindow.toLocaleString()),tooltip)
 await capture('context-usage-dark')
 pass('graph/percentage and tooltip use Pi current context used/max, not cumulative tokens')

 await fill(app,'UNSENT_CONTEXT_DRAFT')
 await evaluate(`document.querySelector('${button}').click();document.querySelector('${button}').click()`)
 await waitFor(()=>evaluate(`!!document.querySelector('.compaction-summary') && !document.querySelector('${button}').disabled`),'left-click compaction completes',60000)
 assert.equal(records().length,1);assert.equal(records()[0].instructions,undefined)
 assert.equal(await evaluate(`document.querySelector('.input-bar textarea').value`),'UNSENT_CONTEXT_DRAFT')
 await waitFor(()=>evaluate(`document.querySelector('${button}').textContent==='—%'`),'post-compaction usage unknown')
 pass('left click runs one default compact RPC, preserves draft, shows summary and never invents zero usage')

 await send(3);await send(4)
 const rightClick=async()=>{const r=await evaluate(`(()=>{const r=document.querySelector('${button}').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await app.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',clickCount:1,...r});await app.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',clickCount:1,...r});await waitFor(()=>evaluate(`!!document.querySelector('[role="menuitem"]')`),'context menu');await evaluate(`document.querySelector('[role="menuitem"]').click()`);await waitFor(()=>evaluate(`!!document.querySelector('#compaction-instructions')`),'instruction dialog')}
 await rightClick()
 await evaluate(`document.querySelector('.compaction-dialog button[type="button"]').click()`)
 assert.equal(records().length,1)
 await rightClick()
 const instructions='保留关键决策和 TODO。\n/compact is literal instruction data'
 await evaluate(`(()=>{const e=document.querySelector('#compaction-instructions');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(instructions)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 await capture('context-compaction-instructions')
 await evaluate(`document.querySelector('.compaction-dialog button[type="submit"]').click()`)
 await waitFor(()=>evaluate(`document.querySelector('.compaction-summary')?.textContent.includes('保留关键决策') && !document.querySelector('${button}').disabled`),'custom compaction',60000)
 assert.equal(records().length,2);assert.equal(records()[1].instructions,instructions)
 pass('right-click opens an instruction dialog; Cancel is passive and Confirm forwards exact instruction text')
 for(const theme of ['light','high-contrast']){
  await evaluate(`window.spi.updateAppSettings({theme:${JSON.stringify(theme)}})`)
  await waitFor(()=>evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`),'theme applied')
  await app.send('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:1,mobile:false})
  const visible=await evaluate(`(()=>{const r=document.querySelector('${button}').getBoundingClientRect();return r.width>0&&r.right<=innerWidth&&r.top>=0})()`)
  assert.equal(visible,true);await capture('context-usage-'+theme)
 }
 pass('context control and instruction UI remain usable in all themes and a narrower desktop viewport')
 assert.equal(app.errors.length,0,JSON.stringify(app.errors))
}
