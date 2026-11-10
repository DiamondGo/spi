const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spi-sessions-unit-'))
let checks = 0
const instances = []
const controls = { hold: false, failNext: false }
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
function load(relative, mocks = {}) {
  const filename = path.join(tmp, path.basename(relative, '.ts') + '.cjs')
  const mod = new Module(filename, module)
  mod.paths = module.paths
  mod.require = name => name in mocks ? mocks[name] : require(name)
  mod._compile(ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename)
  return mod.exports
}
class FakePiSession {
  constructor(id, cwd, file, pi, extension, token) {
    this.id=id; this.cwd=cwd; this.token=token; this.child={stdin:{write(){}}}; this.onEvent=()=>{}; this.onExit=()=>{}
    this.state={sessionFile:file || path.join(tmp, 'new-'+id+'.jsonl'),isStreaming:false}
    this.initial=deferred(); this.fail=controls.failNext; controls.failNext=false
    instances.push(this)
    if (!controls.hold) queueMicrotask(()=>this.ready())
  }
  ready() {
    if (this.exited) return
    if (this.fail) { this.exit(); return }
    this.onEvent({type:'extension_ui_request',method:'notify',message:'spi-permission-ready:'+this.token})
    this.initial.resolve()
  }
  sendCommand(command) {
    if (command==='get_state') return this.initial.promise.then(()=>({...this.state}))
    return Promise.resolve({})
  }
  exit() { if(this.exited)return; this.exited=true; this.initial.reject(new Error('pi exited')); this.onExit(0) }
  close() { this.exit() }
  kill() { this.exit() }
}
const { PiManager } = load('src/main/pi/piManager.ts', {'./piSession':{PiSession:FakePiSession}})
const { Permissions } = load('src/main/pi/permissions.ts')
const extension = path.join(tmp, 'gate.mjs'), file = path.join(tmp, 'history.jsonl')
fs.writeFileSync(extension,'// fixture'); fs.writeFileSync(file,'{}\n')
const managers=[]
function manager() {
  controls.hold=false; controls.failNext=false
  const p=new Permissions(path.join(tmp, 'permissions-'+managers.length+'.json'),()=>{})
  const m=new PiManager('fake-pi',p,extension,()=>{},()=>{}); managers.push(m); return m
}
async function check(name, fn) {
  await fn(); checks++; console.log('PASS',name)
  for(const m of managers)m.closeAll()
}
async function main() {
  await check('backend reuses an opened file and preserves session permissions',async()=>{
    const m=manager(), n=instances.length, a=await m.open(tmp,file)
    m.permissions.setMode(a.sessionId,'remember')
    const b=await m.open(tmp,file)
    assert.equal(a.sessionId,b.sessionId); assert.equal(instances.length,n+1); assert.equal(m.size,1)
    assert.equal(m.permissions.snapshot().sessions[a.sessionId].mode,'remember')
  })
  await check('concurrent backend opens share one startup/handshake and one pi',async()=>{
    const m=manager(), n=instances.length; controls.hold=true
    const requests=Array.from({length:10},()=>m.open(tmp,file))
    assert.equal(instances.length,n+1); assert.equal(m.size,1)
    instances.at(-1).ready()
    assert.equal(new Set((await Promise.all(requests)).map(r=>r.sessionId)).size,1)
  })
  await check('relative paths, dot segments and symlinks identify the same session file',async()=>{
    const m=manager(), a=await m.open(tmp,'./history.jsonl'), alias=path.join(tmp,'alias.jsonl')
    fs.symlinkSync(file,alias)
    assert.equal((await m.open(tmp,tmp+'/./history.jsonl')).sessionId,a.sessionId)
    assert.equal((await m.open(tmp,alias)).sessionId,a.sessionId); assert.equal(m.size,1)
  })
  await check('new sessions in the same cwd stay separate and can later be found by their actual file',async()=>{
    const m=manager(), [a,b]=await Promise.all([m.open(tmp),m.open(tmp)])
    assert.notEqual(a.sessionId,b.sessionId); assert.equal(m.size,2)
    assert.equal((await m.open(tmp,a.state.sessionFile)).sessionId,a.sessionId)
  })
  await check('failed startup releases its pending key and permissions so retry can succeed',async()=>{
    const m=manager(); controls.failNext=true
    await assert.rejects(m.open(tmp,file),/exited/)
    assert.equal(m.size,0); assert.equal(Object.keys(m.permissions.snapshot().sessions).length,0)
    assert.ok((await m.open(tmp,file)).sessionId); assert.equal(m.size,1)
  })
  await check('closing files are not reused; after exit reopening creates a fresh session',async()=>{
    const m=manager(), a=await m.open(tmp,file), closing=m.close(a.sessionId)
    await assert.rejects(m.open(tmp,file),/closing/); await closing
    assert.equal(m.size,0); assert.notEqual((await m.open(tmp,file)).sessionId,a.sessionId)
  })
  await check('a pi-side file switch does not keep the previous file permanently reserved',async()=>{
    const m=manager(), a=await m.open(tmp,file), pi=instances.at(-1), switched=path.join(tmp,'switched.jsonl')
    pi.state.sessionFile=switched
    const b=await m.open(tmp,file)
    assert.notEqual(b.sessionId,a.sessionId); assert.equal((await m.open(tmp,switched)).sessionId,a.sessionId)
  })
  await check('closing during startup rejects the shared open and does not leave a reusable ghost',async()=>{
    const m=manager(); controls.hold=true
    const request=m.open(tmp,file), rejection=assert.rejects(request,/exited|closed/)
    await m.close(instances.at(-1).id); await rejection
    assert.equal(m.size,0); controls.hold=false
    assert.ok((await m.open(tmp,file)).sessionId)
  })

  const store=load('src/renderer/src/store.ts', {react:{useSyncExternalStore(){}}})
  let calls=0, histories=0, next=0
  global.window={spi:{
    async openSession(opts){calls++; const id='ui-'+(++next); return {sessionId:id,state:{sessionFile:opts.sessionPath || '/new/'+id,isStreaming:false}}},
    async getMessages(){histories++; return [{role:'user',content:'SPI_HISTORY'}]}
  }}
  const clear=()=>Object.keys(store.getStore().sessions).forEach(store.removeSession)
  await check('idempotent store insertion preserves draft, images, queue mode, output and running state',async()=>{
    store.addSession('a',tmp,{sessionFile:file,isStreaming:false}); store.setDraft('a','unsent'); store.setSendMode('a','followUp')
    store.setPendingImages('a',[{data:'image-data',mimeType:'image/png'}]); store.setStreaming('a',true)
    store.setPermissionSettingsOpen('a',true); store.loadHistory('a',[{kind:'user',text:'keep output'}])
    const before=store.getStore().sessions.a
    assert.equal(store.addSession('a','wrong-cwd',{isStreaming:false}),false)
    assert.strictEqual(store.getStore().sessions.a,before); clear()
  })
  await check('renderer rapid clicks share one open and initial history load',async()=>{
    const opening=deferred(), history=deferred(); calls=0; histories=0
    window.spi.openSession=()=>{calls++;return opening.promise}; window.spi.getMessages=()=>{histories++;return history.promise}
    const requests=Array.from({length:10},()=>store.openSession(tmp,file))
    assert.equal(calls,1)
    opening.resolve({sessionId:'shared',state:{sessionFile:file,isStreaming:false}})
    await new Promise(resolve=>setImmediate(resolve))
    store.setDraft('shared','draft during initial history load')
    assert.equal(await store.openSession(tmp,file),'shared'); assert.equal(calls,1)
    history.resolve([{role:'user',content:'SPI_HISTORY'}]); await Promise.all(requests)
    assert.equal(histories,1); assert.equal(Object.keys(store.getStore().sessions).length,1)
    assert.equal(store.getStore().sessions.shared.draft,'draft during initial history load')
  })
  await check('clicking an existing session activates it without reopening or reloading its history',async()=>{
    store.addSession('peer',tmp,{sessionFile:'/peer',isStreaming:false})
    const before=store.getStore().sessions.shared, c=calls, h=histories
    assert.equal(await store.openSession(tmp,file),'shared'); assert.equal(store.getStore().activeId,'shared')
    assert.strictEqual(store.getStore().sessions.shared,before); assert.equal(calls,c); assert.equal(histories,h)
  })
  await check('a backend-reused ID for an alias cannot reset an existing renderer session',async()=>{
    window.spi.openSession=async()=>({sessionId:'shared',state:{sessionFile:file,isStreaming:false}})
    const before=store.getStore().sessions.shared, h=histories
    await store.openSession(tmp,'/alias/history.jsonl')
    assert.strictEqual(store.getStore().sessions.shared,before); assert.equal(histories,h); clear()
  })
  await check('renderer failed requests do not poison future clicks',async()=>{
    calls=0
    window.spi.openSession=async opts=>{calls++;if(calls===1)throw new Error('fixture failed');return{sessionId:'retry',state:{sessionFile:opts.sessionPath,isStreaming:false}}}
    window.spi.getMessages=async()=>[]
    await assert.rejects(Promise.all(Array.from({length:5},()=>store.openSession(tmp,file))),/fixture failed/)
    assert.equal(calls,1); assert.equal(await store.openSession(tmp,file),'retry'); assert.equal(calls,2); clear()
  })
  await check('renderer new-session action never deduplicates merely by directory',async()=>{
    window.spi.openSession=async()=>{const id='new-'+(++next);return{sessionId:id,state:{sessionFile:'/new/'+id,isStreaming:false}}}
    const [a,b]=await Promise.all([store.openSession(tmp),store.openSession(tmp)])
    assert.notEqual(a,b); assert.equal(Object.keys(store.getStore().sessions).length,2); clear()
  })
  await check('renderer close removes the identity and the next open starts a clean tab',async()=>{
    const a=await store.openSession(tmp,file); store.setDraft(a,'old draft'); store.removeSession(a)
    const b=await store.openSession(tmp,file)
    assert.notEqual(a,b); assert.equal(store.getStore().sessions[b].draft,''); clear()
  })
  console.log('RESULT PASS',checks,'checks',tmp)
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{for(const m of managers)m.closeAll();delete global.window})
