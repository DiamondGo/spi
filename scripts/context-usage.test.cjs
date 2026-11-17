const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-context-test-'))
function load(relative,mocks={}){
 const original=path.join(root,relative),file=path.join(tmp,relative.replaceAll('/','_')+'.cjs'),m=new Module(file,module);m.paths=module.paths
 m.require=n=>n in mocks?mocks[n]:n.startsWith('.')&&fs.existsSync(path.resolve(path.dirname(original),n)+'.ts')?load(path.relative(root,path.resolve(path.dirname(original),n)+'.ts')):require(n)
 m._compile(ts.transpileModule(fs.readFileSync(original,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,file);return m.exports
}
const C=load('src/shared/contextUsage.ts'),{YoloPolicy}=load('src/main/pi/yolo.ts')
const instances=[],managers=[],tick=()=>new Promise(r=>setImmediate(r))
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
class Pi {
 constructor(id,cwd,file,_pi,_ext,token){this.cwd=cwd;this.hasExited=false;this.commands=[];this.state={isStreaming:false,model:{id:'fixture',contextWindow:1000},sessionFile:file};this.stats={contextUsage:{tokens:250,contextWindow:1000,percent:25}};this.child={stdin:{write(){},writable:true}};instances.push(this);queueMicrotask(()=>this.onEvent({type:'extension_ui_request',method:'notify',message:'spi-permission-ready:'+token}))}
 async sendCommand(type,fields={},timeout){this.commands.push({type,fields,timeout});if(type==='get_state')return this.probe?this.probe():{...this.state};if(type==='get_session_stats')return this.statsGate?this.statsGate.promise:this.stats;if(type==='get_messages')return{messages:[{role:'compactionSummary',summary:'COMPACT_SUMMARY'},{role:'user',content:'retained'}]};if(type==='compact'){this.state.isCompacting=true;this.onEvent({type:'agent_settled'});this.onEvent({type:'compaction_start',reason:'manual'});try{if(this.compactGate)await this.compactGate.promise;this.stats={contextUsage:{tokens:null,contextWindow:1000,percent:null}};return{summary:'COMPACT_SUMMARY'}}finally{this.state.isCompacting=false;this.onEvent({type:'compaction_end',reason:'manual'})}};return{}}
 close(){this.hasExited=true;this.onExit?.(0)}
}
const {PiManager}=load('src/main/pi/piManager.ts',{'./piSession':{PiSession:Pi}})
const extension=path.join(tmp,'extension.mjs'),history=path.join(tmp,'history.jsonl');fs.writeFileSync(extension,'// fixture');fs.writeFileSync(history,'{}\n')
async function setup(){const events=[],manager=new PiManager('fixture',new YoloPolicy(()=>{}),extension,e=>events.push(e),()=>{},()=>true);managers.push(manager);const {sessionId:id,state}=await manager.open(tmp,history);return{manager,id,state,events,pi:instances.at(-1)}}
let count=0;async function check(name,fn){await fn();console.log('PASS',name);count++}
;(async()=>{try{
 await check('current context, not cumulative usage, determines percent; unknown stays unknown',()=>{
  assert.deepEqual(C.contextUsageFromStats({tokens:{total:999999},contextUsage:{tokens:250,contextWindow:1000,percent:99}}),{tokens:250,contextWindow:1000,percent:25})
  assert.deepEqual(C.contextUsageFromStats({contextUsage:{tokens:null,contextWindow:1000,percent:null}}),{tokens:null,contextWindow:1000,percent:null})
  for(const contextUsage of [undefined,{},null,{tokens:1,contextWindow:0},{tokens:-1,contextWindow:1000},{tokens:NaN,contextWindow:1000}])assert.equal(C.contextUsageFromStats({contextUsage}),null)
  assert.equal(C.contextUsageFromStats({contextUsage:{tokens:1200,contextWindow:1000}}).percent,120)
 })
 await check('instructions are bounded literal text and error responses never echo provider secrets',()=>{
  assert.equal(C.compactionInstructions('  keep tasks\n/other-command  '),'keep tasks\n/other-command')
  for(const value of [null,1,{},'x'.repeat(16001),'bad\0value'])assert.throws(()=>C.compactionInstructions(value),/Invalid/)
  assert.equal(C.compactionInstructions('   '),undefined)
  assert.ok(!C.compactionFailure(new Error('SECRET_PROVIDER_URL API_KEY')).message.includes('SECRET'))
  assert.match(C.compactionFailure(new Error('Nothing to compact (session too small)')).message,/too small/)
 })
 await check('context queries are single-flight, passive and tied to the correct process',async()=>{
  const {manager,id,pi}=await setup();pi.statsGate=deferred()
  const a=manager.getContextUsage(id),b=manager.getContextUsage(id);assert.equal(a,b)
  pi.statsGate.resolve(pi.stats);assert.equal((await a).percent,25)
  assert.equal(pi.commands.filter(c=>c.type==='get_session_stats').length,1)
  assert.equal(pi.commands.filter(c=>c.type==='prompt'||c.type==='compact').length,0)
 })
 await check('manual compaction is single-flight, uses canonical RPC, and broadcasts refreshed history',async()=>{
  const {manager,id,pi,events}=await setup();pi.compactGate=deferred()
  const a=manager.compactSession(id,'  keep decisions\n/ignored-as-command  '),b=manager.compactSession(id,'keep decisions\n/ignored-as-command')
  assert.equal(a,b);await assert.rejects(manager.compactSession(id,'different'),/different instructions/);await tick();assert.equal(manager.sessionInTransition(id),true)
  const compact=pi.commands.find(c=>c.type==='compact');assert.deepEqual(compact.fields,{customInstructions:'keep decisions\n/ignored-as-command'});assert.ok(compact.timeout>=120000)
  assert.equal(pi.commands.filter(c=>c.type==='prompt').length,0)
  pi.compactGate.resolve();await a
  assert.equal(events.filter(e=>e.event.type==='spi_session_compacted').length,1)
  assert.equal(manager.sessionInTransition(id),false)
  assert.equal((await manager.getContextUsage(id)).tokens,null)
 })
 await check('running sessions, pending messages and malformed instructions cannot trigger compaction',async()=>{
  const {manager,id,pi}=await setup();pi.state.isStreaming=true
  await assert.rejects(manager.compactSession(id),/finish/);pi.state.isStreaming=false
  await assert.rejects(manager.compactSession(id,null),/Invalid/)
  manager.messages.pause(id);manager.messages.submit(id,{clientId:'pending',text:'queued'});manager.messages.pause(id)
  await assert.rejects(manager.compactSession(id),/pending messages/)
  assert.equal(pi.commands.filter(c=>c.type==='compact').length,0)
 })
 await check('an explicit new send stays queued through compaction, including its settled event',async()=>{
  const {manager,id,pi}=await setup();pi.compactGate=deferred()
  const compact=manager.compactSession(id);await tick()
  manager.submitMessage(id,{clientId:'during',text:'after compact'});await tick()
  assert.equal(pi.commands.filter(c=>c.type==='prompt').length,0)
  assert.equal(manager.getPendingMessages(id).items.length,1)
  pi.compactGate.resolve();await compact;await tick()
  assert.equal(pi.commands.filter(c=>c.type==='prompt').length,1)
 })
 await check('compaction failures release the lock, remain retryable, and do not replay a prompt',async()=>{
  const {manager,id,pi}=await setup();pi.compactGate=deferred();const compact=manager.compactSession(id);await tick();pi.compactGate.reject(new Error('SECRET_PROVIDER_BODY'))
  await assert.rejects(compact,e=>!e.message.includes('SECRET')&&/compaction failed/.test(e.message))
  assert.equal(manager.sessionInTransition(id),false);pi.compactGate=null;await manager.compactSession(id)
  assert.equal(pi.commands.filter(c=>c.type==='prompt').length,0)
 })
 await check('replacing projected history preserves draft, images and outbox state',()=>{
  const store=load('src/renderer/src/store.ts',{react:{useSyncExternalStore(){}}})
  store.addSession('view','/project',{isStreaming:false});store.setDraft('view','DRAFT');store.setPendingImages('view',[{mimeType:'image/png',data:'YQ=='}])
  store.applyEvent('view',{type:'compaction_start',reason:'manual'});assert.equal(store.getStore().sessions.view.state.isCompacting,true)
  store.applyEvent('view',{type:'spi_session_compacted',state:{isStreaming:false,isCompacting:false},messages:[{role:'compactionSummary',summary:'summary'},{role:'user',content:'keep'}]})
  const view=store.getStore().sessions.view;assert.equal(view.draft,'DRAFT');assert.equal(view.pendingImages.length,1);assert.equal(view.items[0].kind,'compaction');assert.equal(view.state.isCompacting,false)
 })
 console.log('RESULT PASS',count,'context/compaction checks')
}finally{for(const manager of managers)manager.closeAll();fs.rmSync(tmp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1})
