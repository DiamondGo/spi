const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
const root = path.resolve(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spi-health-'))
function load(relative, mocks = {}) {
  const file = path.join(tmp, path.basename(relative, '.ts') + '.cjs'), mod = new Module(file, module)
  mod.paths = module.paths; mod.require = name => name in mocks ? mocks[name] : require(name)
  mod._compile(ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, file)
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
  sendCommand(type) {
    this.commands.push(type)
    if (this.hasExited) return Promise.reject(new Error('exited'))
    if (type==='get_state' && this.fail==='late') return Promise.reject(new Error('startup failed before late exit'))
    if (type==='get_state') return this.probe ? this.probe() : Promise.resolve({...this.state})
    if (type==='get_messages') return Promise.resolve({messages:[{role:'user',content:'saved history'}]})
    if (type==='prompt') return this.delivery ? this.delivery.promise : Promise.resolve({})
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
    const calibrated=events.find(e=>e.event.type==='spi_session_health')
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
  await check('renderer calibration and recovery keep draft, images and queue while replacing saved history',async()=>{
    store.addSession('ui',tmp,{sessionFile:file,isStreaming:true}); store.setDraft('ui','draft'); store.setPendingImages('ui',[{data:'YQ==',mimeType:'image/png'}])
    store.loadHistory('ui',[{kind:'assistant',done:false,blocks:[{kind:'text',text:'partial',done:false}]}])
    store.applyEvent('ui',{type:'spi_session_health',health:{status:'unresponsive',checkedAt:1}})
    store.applyEvent('ui',{type:'spi_session_health',health:{status:'healthy',checkedAt:2},state:{sessionFile:file,isStreaming:false},messages:[{role:'user',content:'restored'}]})
    const s=store.getStore().sessions.ui; assert.equal(s.streaming,false); assert.equal(s.draft,'draft'); assert.equal(s.pendingImages.length,1); assert.equal(s.items[0].text,'restored')
    store.applyEvent('ui',{type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'network unavailable'}})
    assert.equal(store.getStore().sessions.ui.error,'network unavailable')
  })
  console.log(`RESULT PASS ${count} session health/recovery checks`)
} finally {for(const manager of managers)manager.closeAll();fs.rmSync(tmp,{recursive:true,force:true})} })().catch(error=>{console.error(error);process.exitCode=1})
