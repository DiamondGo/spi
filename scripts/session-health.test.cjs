const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
// Production session paths are canonical; macOS /var is an alias of /private/var.
const root = path.resolve(__dirname, '..'), tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spi-health-')))
function load(relative, mocks = {}) {
  const file = path.join(tmp, path.basename(relative, '.ts') + '.cjs'), mod = new Module(file, module)
  mod.paths = module.paths; mod.require = name => name in mocks ? mocks[name] : name === '../../shared/sessionHealth' ? load('src/shared/sessionHealth.ts') : name === '../../shared/contextUsage' ? load('src/shared/contextUsage.ts') : require(name)
  mod._compile(ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, file)
  return mod.exports
}
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return {promise,resolve,reject} }
const tick = () => new Promise(resolve => setImmediate(resolve)), instances = []
let failNext = false
class FakePi {
  constructor(id, cwd, file, pi, extension, token) {
    this.id=id; this.cwd=cwd; this.file=file; this.hasExited=false; this.commands=[]
    this.child={stdin:{writable:true,write(){return true}}}; this.state={sessionFile:file,isStreaming:false}; this.fail=failNext; failNext=false
    instances.push(this)
    queueMicrotask(() => this.fail === true ? this.exit() : this.onEvent({type:'extension_ui_request',method:'notify',message:'spi-permission-ready:'+token}))
  }
  sendCommand(type, fields) {
    this.commands.push(type)
    if (this.hasExited) return Promise.reject(new Error('exited'))
    if (type==='get_state' && this.fail==='late') return Promise.reject(new Error('startup failed before late exit'))
    if (type==='get_state') return this.probe ? this.probe() : Promise.resolve({...this.state})
    if (type==='get_messages') return Promise.resolve({messages:[{role:'user',content:'saved history'}]})
    if (type==='prompt') { (this.prompts=this.prompts||[]).push(fields); return this.delivery ? this.delivery.promise : Promise.resolve({}) }
    return Promise.resolve({})
  }
  exit() { if(this.hasExited)return; this.hasExited=true; this.onExit(1) }
  close() { this.exit() }
  kill() { if(this.fail!=='late')this.exit() }
  async terminate() { if(this.termination) await this.termination.promise; this.exit() }
}
const { PiManager }=load('src/main/pi/piManager.ts', {'./piSession':{PiSession:FakePi}, './extensionUi':load('src/main/pi/extensionUi.ts'), './messageQueue':load('src/main/pi/messageQueue.ts')})
const { YoloPolicy }=load('src/main/pi/yolo.ts')
const extension=path.join(tmp,'bridge.mjs'), file=path.join(tmp,'saved.jsonl'); fs.writeFileSync(extension,'//fixture'); fs.writeFileSync(file,'{}\n')
const managers=[]; let count=0
async function setup() {
  const events=[], closed=[], yolo=new YoloPolicy(()=>{})
  const manager=new PiManager('fake',yolo,extension,e=>events.push(e),id=>closed.push(id),()=>true)
  managers.push(manager)
  const {sessionId:id}=await manager.open(tmp,file)
  return {manager,id,pi:instances.at(-1),events,closed,yolo}
}
async function check(name, fn) { await fn(); count++; console.log('PASS',name) }
;(async()=>{ try {
  await check('idle probes are single-flight and never send prompts or fetch entire history',async()=>{
    const {manager,id,pi}=await setup(), gate=deferred(); pi.probe=()=>gate.promise
    const a=manager.checkSession(id),b=manager.checkSession(id); assert.strictEqual(a,b)
    gate.resolve({...pi.state}); assert.equal((await a).status,'healthy')
    assert.equal(pi.commands.filter(x=>x==='get_state').length,2); assert.ok(!pi.commands.includes('prompt')); assert.ok(!pi.commands.includes('get_messages'))
  })
  await check('task starts replay ordered owner health without probing or accepting retired/dead writers',async()=>{
    const {manager,id,pi,events}=await setup(),commands=pi.commands.length
    pi.onEvent({type:'agent_start'})
    const first=events.filter(e=>e.event.type==='spi_session_health').at(-1).event.health
    assert.equal(first.status,'healthy');assert.ok(Number.isSafeInteger(first.revision));assert.equal(pi.commands.length,commands)
    pi.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'working'}})
    assert.equal(events.filter(e=>e.event.type==='spi_session_health').length,1)
    pi.onEvent({type:'agent_start'})
    const second=events.filter(e=>e.event.type==='spi_session_health').at(-1).event.health
    assert.ok(second.revision>first.revision);assert.equal(pi.commands.length,commands)
    await manager.getState(id)
    assert.equal(pi.commands.length,commands+1)
    assert.ok(events.filter(e=>e.event.type==='spi_session_health').at(-1).event.health.revision>second.revision)
    pi.exit();const n=events.length;pi.onEvent({type:'agent_start'});assert.equal(events.length,n)
    const result=await manager.recoverSession(id),snapshot=events.filter(e=>e.event.type==='spi_session_health').at(-1).event.health
    assert.deepEqual(result.health,snapshot);assert.equal(snapshot.status,'healthy');assert.ok(snapshot.revision>second.revision)
    const after=events.length;pi.onEvent({type:'agent_start'});assert.equal(events.length,after)
  })
  await check('opening/idle/running sessions schedule no health timers or unsolicited probes',async()=>{
    const set=global.setTimeout, clear=global.clearTimeout, timers=new Set()
    global.setTimeout=(...args)=>{const timer=set(...args);timers.add(timer);return timer}
    global.clearTimeout=timer=>{timers.delete(timer);return clear(timer)}
    try {
      const {pi}=await setup();assert.equal(timers.size,0)
      const n=pi.commands.length;pi.state.isStreaming=true;pi.onEvent({type:'agent_start'});await tick()
      assert.equal(timers.size,0);assert.equal(pi.commands.length,n)
    } finally {global.setTimeout=set;global.clearTimeout=clear}
  })
  await check('a user send repairs a missed settlement and wakes the stale busy queue without polling',async()=>{
    const {manager,id,pi,events}=await setup()
    pi.state.isStreaming=true; pi.onEvent({type:'agent_start'})
    pi.state.isStreaming=false // No agent_settled event reached sPi.
    manager.submitMessage(id,{clientId:'waiting',text:'next'}); await tick()
    assert.equal(pi.commands.filter(x=>x==='prompt').length,1)
    const calibrated=events.find(e=>e.event.type==='spi_session_health'&&e.event.state)
    assert.equal(calibrated.event.state.isStreaming,false); assert.equal(calibrated.event.messages[0].content,'saved history')
  })
  await check('timeout pauses outbox, alerts, and a successful probe never auto-resumes it',async()=>{
    const {manager,id,pi}=await setup()
    pi.state.isStreaming=true; pi.onEvent({type:'agent_start'}); manager.submitMessage(id,{clientId:'p',text:'keep'}); await tick()
    pi.probe=()=>Promise.reject(new Error('timeout'))
    assert.equal((await manager.checkSession(id)).status,'unresponsive')
    assert.equal(manager.getPendingMessages(id).paused,true)
    pi.probe=null; pi.state.isStreaming=false
    assert.equal((await manager.checkSession(id)).status,'healthy'); await tick()
    assert.ok(!pi.commands.includes('prompt')); assert.equal(manager.getPendingMessages(id).items[0].text,'keep')
    manager.resumePendingMessages(id); await tick(); assert.equal(pi.commands.filter(x=>x==='prompt').length,1)
  })
  await check('fresh work clears stale transport alerts but never resumes queued work or approval holds',async()=>{
    const {manager,id,pi,events,yolo}=await setup();yolo.setEnabled(id,true)
    pi.state.isStreaming=true;pi.onEvent({type:'agent_start'});manager.submitMessage(id,{clientId:'paused',text:'keep'});await tick()
    pi.probe=()=>Promise.reject(new Error('timeout'));await manager.checkSession(id)
    const n=pi.commands.length
    pi.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'working'}})
    assert.equal(events.filter(e=>e.event.type==='spi_session_health').at(-1).event.health.status,'healthy')
    assert.equal(pi.commands.length,n);assert.equal(manager.getPendingMessages(id).paused,true);assert.equal(manager.getPendingMessages(id).items[0].text,'keep')
    assert.equal(yolo.canAutoAllowExtension(id),false)
  })
  await check('a late probe failure cannot overwrite more recent agent output or pause a live task',async()=>{
    const {manager,id,pi,events,yolo}=await setup();yolo.setEnabled(id,true);pi.onEvent({type:'agent_start'})
    const gate=deferred();pi.probe=()=>gate.promise
    const request=manager.checkSession(id)
    pi.onEvent({type:'tool_execution_update',toolCallId:'tool',partialResult:{content:[]}})
    gate.reject(new Error('old timeout'));assert.equal((await request).status,'healthy')
    assert.ok(!events.some(e=>e.event.health?.status==='unresponsive'));assert.equal(manager.getPendingMessages(id).paused,false);assert.equal(yolo.canAutoAllowExtension(id),true)
  })
  await check('private notifications are not working-state evidence and late exited events cannot revive a tab',async()=>{
    const {manager,id,pi,events}=await setup();pi.probe=()=>Promise.reject(new Error('timeout'));await manager.checkSession(id)
    pi.onEvent({type:'extension_ui_request',method:'notify',message:'ordinary notification'})
    assert.equal(events.filter(e=>e.event.type==='spi_session_health').at(-1).event.health.status,'unresponsive')
    pi.exit();const n=events.length;pi.onEvent({type:'agent_start'});assert.equal(events.length,n)
    assert.equal((await manager.checkSession(id)).status,'exited')
  })
  await check('stdout activity cannot declare a closed RPC input stream healthy',async()=>{
    const {manager,id,pi,events}=await setup();pi.probe=()=>Promise.reject(new Error('pipe unavailable'));await manager.checkSession(id)
    pi.child.stdin.writable=false
    pi.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'old task output'}})
    assert.equal(events.filter(e=>e.event.type==='spi_session_health').at(-1).event.health.status,'unresponsive')
    assert.equal((await manager.checkSession(id)).status,'unresponsive')
  })
  await check('an idle send RPC failure triggers one diagnostic check and preserves the unsent message',async()=>{
    const {manager,id,pi,events}=await setup();pi.probe=()=>Promise.reject(new Error('RPC unavailable'))
    const n=pi.commands.filter(x=>x==='get_state').length
    manager.submitMessage(id,{clientId:'idle-fail',text:'do not lose'});await tick()
    assert.equal(pi.commands.filter(x=>x==='get_state').length,n+2) // Failed normal state query + diagnostic.
    assert.equal(events.at(-1).event.health.status,'unresponsive')
    assert.equal(manager.getPendingMessages(id).paused,true);assert.equal(manager.getPendingMessages(id).items[0].text,'do not lose')
    assert.ok(!pi.commands.includes('prompt'))
  })
  await check('an unconfirmed handoff triggers a diagnostic but never retries a possibly delivered prompt',async()=>{
    const {manager,id,pi,events}=await setup();pi.delivery=deferred()
    manager.submitMessage(id,{clientId:'handoff-fail',text:'only once'});await tick();pi.delivery.reject(new Error('ACK timeout'));await tick()
    assert.equal(pi.commands.filter(x=>x==='prompt').length,1)
    assert.equal(manager.getPendingMessages(id).paused,true);assert.equal(manager.getPendingMessages(id).items[0].status,'failed')
    assert.equal(events.at(-1).event.health.status,'healthy')
  })
  await check('unexpected exit keeps the tab/file/outbox; closing an exited tab still works',async()=>{
    const {manager,id,pi,events,closed}=await setup()
    pi.state.isStreaming=true; pi.onEvent({type:'agent_start'}); manager.submitMessage(id,{clientId:'q',text:'unsent'}); await tick()
    pi.exit(); assert.equal(manager.size,1); assert.equal(closed.length,0)
    assert.equal(events.at(-1).event.health.status,'exited'); assert.equal(manager.getPendingMessages(id).items[0].text,'unsent')
    await manager.close(id); assert.equal(manager.size,0); assert.deepEqual(closed,[id])
  })
  await check('steer injects into the live run instead of waiting in the outbox',async()=>{
    const {manager,id,pi}=await setup()
    pi.state.isStreaming=true; pi.onEvent({type:'agent_start'})
    const receipt=await manager.submitMessage(id,{clientId:'steer-live',text:'cut in',priority:true})
    assert.equal(receipt.id,'steer-live')
    assert.deepEqual(pi.prompts.at(-1),{message:'cut in',streamingBehavior:'steer'})
    assert.equal(manager.getPendingMessages(id).items.length,0)
  })
  await check('steer while idle starts a run directly without touching the outbox',async()=>{
    const {manager,id,pi}=await setup()
    const receipt=await manager.submitMessage(id,{clientId:'steer-idle',text:'start now',priority:true})
    assert.equal(receipt.id,'steer-idle')
    assert.deepEqual(pi.prompts.at(-1),{message:'start now',streamingBehavior:'steer'})
    assert.equal(manager.getPendingMessages(id).items.length,0)
  })
  await check('steer carries images through the native injection',async()=>{
    const {manager,id,pi}=await setup()
    pi.state.isStreaming=true; pi.onEvent({type:'agent_start'})
    await manager.submitMessage(id,{clientId:'steer-img',text:'look',images:[{data:'AQ==',mimeType:'image/png'}],priority:true})
    assert.deepEqual(pi.prompts.at(-1),{message:'look',streamingBehavior:'steer',images:[{type:'image',data:'AQ==',mimeType:'image/png'}]})
  })
  await check('getState reflects the native steering queue from queue_update events',async()=>{
    const {manager,id,pi}=await setup()
    assert.deepEqual((await manager.getState(id)).steering,[])
    pi.onEvent({type:'queue_update',steering:['a','b'],followUp:[]})
    const s1=await manager.getState(id)
    assert.deepEqual(s1.steering,['a','b']); assert.deepEqual(s1.followUp,[])
    pi.onEvent({type:'queue_update',steering:['b'],followUp:['c']})
    const s2=await manager.getState(id)
    assert.deepEqual(s2.steering,['b']); assert.deepEqual(s2.followUp,['c'])
  })
  await check('steer with an in-flight handoff keeps the outbox order instead of racing the drain',async()=>{
    const {manager,id,pi}=await setup(); pi.delivery=deferred()
    manager.submitMessage(id,{clientId:'fu',text:'held'}); await tick()
    assert.equal(manager.getPendingMessages(id).items[0].status,'dispatching')
    const receipt=await manager.submitMessage(id,{clientId:'steer-held',text:'cut in',priority:true})
    const items=manager.getPendingMessages(id).items
    assert.equal(items[1].id,receipt.id)
    assert.deepEqual(items.map(x=>x.text),['held','cut in'])
    assert.equal(items[1].priority,true)
    assert.ok(!pi.prompts.some(p=>p.streamingBehavior==='steer'))
    pi.delivery.resolve({disposition:'started'})
  })
  await check('steer with held outbox work queues at the front without a direct prompt',async()=>{
    const {manager,id,pi}=await setup()
    pi.state.isStreaming=true; pi.onEvent({type:'agent_start'})
    manager.submitMessage(id,{clientId:'fu',text:'held'}); await tick()
    const item=manager.getPendingMessages(id).items[0]
    manager.editPendingMessage(id,item.id,item.revision)
    pi.state.isStreaming=false // The run settled while the item is held for editing.
    const receipt=await manager.submitMessage(id,{clientId:'steer-edit',text:'cut in',priority:true})
    const items=manager.getPendingMessages(id).items
    assert.equal(items[0].id,receipt.id)
    assert.deepEqual(items.map(x=>x.text),['cut in','held'])
    assert.equal(items[0].priority,true)
    assert.ok(!(pi.prompts||[]).some(p=>p.streamingBehavior==='steer'))
  })
  await check('steer fails without queueing when the session is gone',async()=>{
    const {manager,id,pi}=await setup()
    pi.exit()
    await assert.rejects(manager.submitMessage(id,{clientId:'steer-dead',text:'lost',priority:true}))
    assert.equal(manager.getPendingMessages(id).items.length,0)
  })
  await check('recovery is single-flight, waits for old process exit, retains identity and pauses outbox with YOLO off',async()=>{
    const {manager,id,pi,yolo}=await setup(); yolo.setEnabled(id,true)
    pi.state.isStreaming=true; pi.onEvent({type:'agent_start'}); manager.submitMessage(id,{clientId:'q',text:'retain',images:[{data:'YQ==',mimeType:'image/png'}]}); await tick()
    pi.termination=deferred(); const n=instances.length,a=manager.recoverSession(id),b=manager.recoverSession(id)
    assert.strictEqual(a,b); await tick(); assert.equal(instances.length,n)
    pi.termination.resolve(); const recovered=await a,newPi=instances.at(-1)
    assert.equal(newPi.id,id); assert.equal(newPi.file,file); assert.equal(recovered.messages[0].content,'saved history')
    assert.equal(manager.getPendingMessages(id).items[0].text,'retain'); assert.equal(manager.getPendingMessages(id).items[0].images[0].data,'YQ==')
    assert.equal(manager.getPendingMessages(id).paused,true); assert.ok(!newPi.commands.includes('prompt')); assert.equal(yolo.snapshot().sessions[id].enabled,false)
    assert.equal((await manager.open(tmp,file)).sessionId,id)
  })
  await check('unconfirmed delivery remains failed after restart; late old ACK cannot remove it',async()=>{
    const {manager,id,pi}=await setup(); pi.delivery=deferred()
    manager.submitMessage(id,{clientId:'inflight',text:'possibly delivered'}); await tick()
    assert.equal(manager.getPendingMessages(id).items[0].status,'dispatching')
    await manager.recoverSession(id); pi.delivery.resolve({}); await tick()
    assert.equal(manager.getPendingMessages(id).items[0].status,'failed'); assert.equal(manager.getPendingMessages(id).paused,true)
    manager.resumePendingMessages(id); await tick(); assert.ok(!instances.at(-1).commands.includes('prompt'))
  })
  await check('failed restart keeps saved identity and queue for a second recovery attempt',async()=>{
    const {manager,id,pi}=await setup(); pi.exit(); failNext=true
    await assert.rejects(manager.recoverSession(id)); assert.equal(manager.size,1)
    assert.equal((await manager.checkSession(id)).status,'exited')
    assert.equal((await manager.recoverSession(id)).state.sessionFile,file)
  })
  await check('a failed replacement exiting after the recovery rejection remains recoverable; retired events are ignored',async()=>{
    const {manager,id}=await setup(); failNext='late'
    await assert.rejects(manager.recoverSession(id),/startup failed/)
    const failed=instances.at(-1)
    assert.doesNotThrow(()=>failed.onEvent({type:'agent_start'}))
    failed.exit();assert.equal(manager.size,1);assert.equal((await manager.checkSession(id)).status,'exited')
    assert.equal((await manager.recoverSession(id)).state.sessionFile,file)
  })
  await check('missing session files fail closed rather than creating a replacement conversation',async()=>{
    const {manager,id}=await setup(); fs.unlinkSync(file)
    const n=instances.length; await assert.rejects(manager.recoverSession(id),/会话文件/); assert.equal(instances.length,n)
    fs.writeFileSync(file,'{}\n')
  })
  await check('stale health replies cannot overwrite a restarted process or newer streaming events',async()=>{
    const {manager,id,pi,events}=await setup(); const gate=deferred(); pi.probe=()=>gate.promise
    const pending=manager.checkSession(id); await manager.recoverSession(id); const n=events.length
    gate.resolve({sessionFile:'/WRONG',isStreaming:true}); await pending
    assert.equal(events.length,n); assert.equal((await manager.getState(id)).sessionFile,file)
    const fresh=instances.at(-1), next=deferred(); fresh.probe=()=>next.promise
    const check=manager.checkSession(id); fresh.onEvent({type:'agent_start'}); next.resolve({sessionFile:file,isStreaming:false}); await check
    assert.equal(events.at(-1).event.state,undefined)
  })
  await check('prolonged event silence warns but never restarts or aborts a long tool',async()=>{
    const {manager,id,pi}=await setup(); pi.state.isStreaming=true; pi.onEvent({type:'agent_start'})
    const now=Date.now; Date.now=()=>now()+121000
    try { assert.equal((await manager.checkSession(id)).stalled,true); assert.equal(pi.hasExited,false); assert.ok(!pi.commands.includes('abort')) } finally {Date.now=now}
  })
  const store=load('src/renderer/src/store.ts',{react:{useSyncExternalStore(){}}})
  await check('recovery reply repairs a missed healthy event without overwriting newer work or a newer exit',async()=>{
    const previous=global.window;let gate=deferred();global.window={spi:{recoverSession:()=>gate.promise}}
    try{
      const id='missed-recovery';store.addSession(id,tmp,{sessionFile:file,isStreaming:false});store.setDraft(id,'keep draft');store.setPendingImages(id,[{data:'YQ==',mimeType:'image/png'}])
      store.updatePendingMessages({sessionId:id,version:1,paused:true,items:[]})
      store.applyEvent(id,{type:'spi_session_health',health:{status:'exited',checkedAt:1,revision:40}})
      let pending=store.recoverSession(id)
      store.applyEvent(id,{type:'spi_session_health',health:{status:'recovering',checkedAt:2,revision:41}})
      gate.resolve({health:{status:'healthy',checkedAt:3,revision:42},state:{sessionFile:file,isStreaming:false},messages:[{role:'user',content:'saved recovery history'}]});await pending
      let s=store.getStore().sessions[id];assert.equal(s.health.status,'healthy');assert.equal(s.items[0].text,'saved recovery history');assert.equal(s.draft,'keep draft');assert.equal(s.pendingImages.length,1);assert.equal(s.pendingQueue.paused,true)
      store.applyEvent(id,{type:'agent_start'});store.applyEvent(id,{type:'message_start',message:{role:'user',content:'after snapshot'}})
      store.applyEvent(id,{type:'spi_session_health',health:{status:'healthy',checkedAt:3,revision:42},state:{isStreaming:false},messages:[]})
      assert.equal(store.getStore().sessions[id].streaming,true);assert.equal(store.getStore().sessions[id].items.at(-1).text,'after snapshot')
      gate=deferred();pending=store.recoverSession(id)
      store.applyEvent(id,{type:'spi_session_health',health:{status:'healthy',checkedAt:4,revision:43}})
      store.applyEvent(id,{type:'agent_start'});store.applyEvent(id,{type:'message_start',message:{role:'user',content:'new work'}})
      gate.resolve({health:{status:'healthy',checkedAt:3,revision:42},state:{sessionFile:file,isStreaming:false},messages:[{role:'user',content:'old reply must not rewind'}]});await pending
      s=store.getStore().sessions[id];assert.equal(s.streaming,true);assert.equal(s.items.at(-1).text,'new work');assert.equal(s.health.revision,43)
      gate=deferred();pending=store.recoverSession(id)
      store.applyEvent(id,{type:'spi_session_health',health:{status:'exited',checkedAt:5,revision:44}})
      gate.resolve({health:{status:'healthy',checkedAt:4,revision:43},state:{isStreaming:false},messages:[]});await pending
      assert.equal(store.getStore().sessions[id].health.status,'exited')
    }finally{global.window=previous}
  })
  await check('check reply clears a missed healthy event, but never supersedes newer health',async()=>{
    const previous=global.window;let gate=deferred();global.window={spi:{checkSession:()=>gate.promise}}
    try{
      const id='missed-check';store.addSession(id,tmp,{isStreaming:true});store.setDraft(id,'keep')
      store.applyEvent(id,{type:'spi_session_health',health:{status:'exited',checkedAt:1,revision:50}})
      let pending=store.checkSession(id);gate.resolve({status:'healthy',checkedAt:2,revision:51});await pending
      assert.equal(store.getStore().sessions[id].health.status,'healthy');assert.equal(store.getStore().sessions[id].draft,'keep')
      gate=deferred();pending=store.checkSession(id);store.applyEvent(id,{type:'spi_session_health',health:{status:'exited',checkedAt:3,revision:53}})
      gate.resolve({status:'healthy',checkedAt:2,revision:52});await pending;assert.equal(store.getStore().sessions[id].health.status,'exited')
      // Old hosts without ordering are still supported, but their reply cannot beat a newer event.
      gate=deferred();pending=store.checkSession(id);store.applyEvent(id,{type:'spi_session_health',health:{status:'exited',checkedAt:4}})
      gate.resolve({status:'healthy',checkedAt:3});await pending;assert.equal(store.getStore().sessions[id].health.status,'exited')
    }finally{global.window=previous}
  })
  await check('renderer calibration and recovery keep draft, images and queue while replacing saved history',async()=>{
    store.addSession('ui',tmp,{sessionFile:file,isStreaming:true}); store.setDraft('ui','draft'); store.setPendingImages('ui',[{data:'YQ==',mimeType:'image/png'}])
    store.loadHistory('ui',[{kind:'assistant',done:false,blocks:[{kind:'text',text:'partial',done:false}]}])
    store.applyEvent('ui',{type:'spi_session_health',health:{status:'unresponsive',checkedAt:1}})
    store.applyEvent('ui',{type:'spi_session_health',health:{status:'healthy',checkedAt:2},state:{sessionFile:file,isStreaming:false},messages:[{role:'user',content:'restored'}]})
    const s=store.getStore().sessions.ui; assert.equal(s.streaming,false); assert.equal(s.draft,'draft'); assert.equal(s.pendingImages.length,1); assert.equal(s.items[0].text,'restored')
    store.applyEvent('ui',{type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'network unavailable'}})
    assert.equal(store.getStore().sessions.ui.error,'network unavailable')
  })
  await check('renderer progress clears old health/stalled/action errors without accumulating notices',async()=>{
    store.addSession('progress',tmp,{isStreaming:true});store.setDraft('progress','keep draft')
    for(let n=0;n<8;n++)store.applyEvent('progress',{type:'spi_session_health',health:{status:'unresponsive',checkedAt:n}})
    assert.equal(store.getStore().sessions.progress.items.length,0)
    store.setSessionHealthError('progress','old check failure')
    assert.doesNotThrow(()=>store.applyEvent('progress',{type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'resumed'}}))
    assert.equal(store.getStore().sessions.progress.health.status,'unresponsive') // Only the owner can confirm its input pipe is usable.
    store.applyEvent('progress',{type:'spi_session_health',health:{status:'healthy',checkedAt:9}})
    let s=store.getStore().sessions.progress;assert.equal(s.health.status,'healthy');assert.equal(s.healthError,undefined);assert.equal(s.draft,'keep draft')
    store.applyEvent('progress',{type:'spi_session_health',health:{status:'healthy',checkedAt:9,stalled:true}})
    store.applyEvent('progress',{type:'tool_execution_start',toolCallId:'t',toolName:'read',args:{}})
    assert.equal(store.getStore().sessions.progress.health.stalled,undefined)
    store.applyEvent('progress',{type:'spi_session_health',health:{status:'recovering',checkedAt:10}})
    store.applyEvent('progress',{type:'agent_start'});assert.equal(store.getStore().sessions.progress.health.status,'recovering')
    store.applyEvent('progress',{type:'spi_session_health',health:{status:'exited',checkedAt:11}})
    store.applyEvent('progress',{type:'agent_settled'});assert.equal(store.getStore().sessions.progress.health.status,'exited')
  })
  await check('successful model output clears only a prior model failure, not unrelated operation errors',async()=>{
    store.addSession('model',tmp,{isStreaming:true})
    store.applyEvent('model',{type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'old model failure'}})
    store.applyEvent('model',{type:'message_start',message:{role:'assistant',content:[]}})
    store.applyEvent('model',{type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'success'}})
    assert.equal(store.getStore().sessions.model.error,undefined)
    store.setSessionError('model','settings failure')
    store.applyEvent('model',{type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'working'}})
    assert.equal(store.getStore().sessions.model.error,'settings failure')
    store.setSessionError('model','retry failure','model');store.applyEvent('model',{type:'auto_retry_end',success:true})
    assert.equal(store.getStore().sessions.model.error,undefined)
  })
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),preferences={useT:()=>text=>text}
  const {SessionHealthBanner}=load('src/renderer/src/components/SessionHealthBanner.tsx',{'../store':store,'../preferences':preferences,'../remote':{useRemoteReadOnly:()=>false},'./SessionRecoveryDialog':{SessionRecoveryDialog:()=>null}})
  await check('recovery dialog is passive until confirmation, single-flight, retryable and read-only safe',async()=>{
    const previous=global.document;global.document={body:{}}
    try {
      let calls=0,closed=0,readOnly=false,gate=deferred(),values=[]
      const {SessionRecoveryDialog}=load('src/renderer/src/components/SessionRecoveryDialog.tsx',{
        react:{...React,useId:()=> 'recovery-test',useRef:value=>({current:value}),useEffect(){},useState:value=>[value,next=>values.push(next)]},
        'react-dom':{createPortal:element=>element},'../preferences':preferences,
        '../remote':{useRemoteReadOnly:()=>readOnly,remoteErrorText:String},
        '../store':{recoverSession:id=>{assert.equal(id,'recovery-ui');calls++;return gate.promise}}
      })
      const make=(disabled=false)=>SessionRecoveryDialog({sessionId:'recovery-ui',disabled,onClose:()=>closed++})
      const submit=dialog=>dialog.props.children.props.onSubmit({preventDefault(){}})
      const cancel=dialog=>dialog.props.children.props.children.at(-1).props.children[0].props.onClick()
      let dialog=make();assert.equal(calls,0);cancel(dialog);assert.equal(closed,1);assert.equal(calls,0)
      dialog=make();dialog.props.onCancel({preventDefault(){}});assert.equal(closed,2);assert.equal(calls,0)
      submit(make(true));readOnly=true;submit(make());readOnly=false;assert.equal(calls,0)
      dialog=make();submit(dialog);submit(dialog);assert.equal(calls,1)
      gate.reject(new Error('RECOVERY_FAILED_VISIBLE'));await tick();assert.ok(values.includes('Error: RECOVERY_FAILED_VISIBLE'));assert.equal(closed,2)
      gate=deferred();submit(dialog);assert.equal(calls,2);gate.resolve();await tick();assert.equal(closed,3)
      for(const file of ['SessionHealthBanner','SessionActions'])assert.ok(!fs.readFileSync(path.join(root,'src/renderer/src/components',file+'.tsx'),'utf8').includes('window.confirm'))
    } finally {global.document=previous}
  })
  const {ChatView}=load('src/renderer/src/components/ChatView.tsx',{'../store':store,'../preferences':preferences,'../ansi':{renderAnsi:text=>text},'../remote':{useRemoteReadOnly:()=>false},'../userMessageNavigation':load('src/renderer/src/userMessageNavigation.ts'),'./DiffView':{DiffView:()=>null},'./PendingMessages':{PendingMessages:()=>null}})
  const base={id:'render',cwd:tmp,items:[],streaming:false,submitting:false}
  const banner=patch=>renderToStaticMarkup(React.createElement(SessionHealthBanner,{session:{...base,...patch}}))
  await check('healthy sessions render no connection banner/buttons; every fault renders only one',()=>{
    assert.equal(banner({}),'');assert.equal(banner({health:{status:'healthy',checkedAt:1}}),'')
    for(const status of ['unresponsive','exited','recovering'])assert.equal((banner({health:{status,checkedAt:2}}).match(/class="session-health warning"/g)||[]).length,1)
    assert.equal(banner({health:{status:'healthy',stalled:true,checkedAt:2}}),'')
    const html=banner({health:{status:'healthy',checkedAt:3},healthError:'check action failed'})
    assert.ok(!html.includes('检查连接'));assert.ok(!html.includes('恢复会话'));assert.ok(html.includes('check action failed'))
  })
  await check('ordinary errors display once, without recovery controls or duplicate empty-chat errors',()=>{
    const session={...base,error:'ONE_MODEL_ERROR',health:{status:'healthy',checkedAt:1}}
    const html=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(SessionHealthBanner,{session}),React.createElement(ChatView,{session})))
    assert.equal((html.match(/ONE_MODEL_ERROR/g)||[]).length,1);assert.ok(!html.includes('检查连接'));assert.ok(!html.includes('恢复会话'))
    const duplicate=banner({health:{status:'unresponsive',checkedAt:2},error:'SAME_ERROR',healthError:'SAME_ERROR'})
    assert.equal((duplicate.match(/SAME_ERROR/g)||[]).length,1)
  })
  console.log(`RESULT PASS ${count} session health/recovery checks`)
} finally {for(const manager of managers)manager.closeAll();fs.rmSync(tmp,{recursive:true,force:true})} })().catch(error=>{console.error(error);process.exitCode=1})
