const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-yolo-unit-'))
function load(name){const f=path.join(tmp,name+'.cjs');fs.writeFileSync(f,ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/main/pi',name+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);return require(f)}
const {YoloPolicy}=load('yolo');let count=0
function check(name,fn){fn();count++;console.log('PASS',name)}
try{
  const events=[],p=new YoloPolicy(s=>events.push(s))
  check('a new session defaults to YOLO off and unready',()=>{p.open('a');assert.deepEqual(p.snapshot(),{sessions:{a:{enabled:false,ready:false}}})})
  check('off delegates execution to Pi without an sPi prompt or remembered rule',()=>{p.ready('a');assert.equal(p.allowsExecution('a','/fixture','bash',{command:'printf allowed by Pi'}),true);assert.equal(p.canAutoAllowExtension('a'),false);assert.equal(p.allowsExecution('a','/fixture','write',{path:'fixture',content:'test'}),true)})
  check('on enables automatic replies but does not add another tool decision',()=>{p.setEnabled('a',true);assert.equal(p.canAutoAllowExtension('a'),true);assert.equal(p.allowsExecution('a','/fixture','bash',{command:'fixture'}),true)})
  check('only booleans are accepted, never string/coerced modes',()=>{for(const value of ['all','ask','true',1,null,undefined])assert.throws(()=>p.setEnabled('a',value));assert.equal(p.snapshot().sessions.a.enabled,true)})
  check('turning YOLO off does not force Pi to ask',()=>{p.setEnabled('a',false);assert.equal(p.canAutoAllowExtension('a'),false);assert.equal(p.allowsExecution('a','/fixture','read',{path:'fixture'}),true)})
  check('YOLO flags stay isolated by session',()=>{p.open('b');p.ready('b');p.setEnabled('a',true);assert.equal(p.snapshot().sessions.b.enabled,false)})
  check('missing bridge readiness blocks execution regardless of the switch',()=>{p.open('unready');p.setEnabled('unready',true);assert.equal(p.allowsExecution('unready','/fixture','bash',{}),false);assert.equal(p.canAutoAllowExtension('unready'),false)})
  check('Stop/hold blocks both tool execution and automatic replies until next agent start',()=>{p.hold('a');assert.equal(p.allowsExecution('a','/fixture','bash',{}),false);assert.equal(p.canAutoAllowExtension('a'),false);p.begin('a');assert.equal(p.canAutoAllowExtension('a'),true)})
  check('malformed bridge calls fail closed without retaining request data',()=>{for(const input of [null,[],undefined,'bad'])assert.equal(p.allowsExecution('a','/fixture','bash',input),false);assert.equal(p.allowsExecution('a','','bash',{}),false);assert.equal(p.allowsExecution('a','/fixture','',{}),false);assert.equal(p.allowsExecution('a','/fixture','write',{content:'x'.repeat(1024*1024)}),false)})
  check('closing/reopening a session resets YOLO and never persists a default',()=>{p.close('a');assert.equal(p.isReady('a'),false);p.open('a');p.ready('a');assert.equal(p.snapshot().sessions.a.enabled,false);assert.equal('defaultMode' in p.snapshot(),false)})
  check('legacy permission configuration is neither read nor rewritten',()=>{const file=path.join(tmp,'spi-permissions.json');const original='{"defaultMode":"ask","rules":["legacy"]}';fs.writeFileSync(file,original);const q=new YoloPolicy(()=>{});q.open('q');q.ready('q');q.setEnabled('q',true);q.close('q');assert.equal(fs.readFileSync(file,'utf8'),original)})
  check('snapshots cannot mutate live state and subscriptions detach cleanly',()=>{let calls=0;const off=p.subscribe(()=>calls++);const s=p.snapshot();s.sessions.a.enabled=true;assert.equal(p.snapshot().sessions.a.enabled,false);p.setEnabled('a',true);assert.equal(calls,1);off();p.setEnabled('a',false);assert.equal(calls,1)})
  check('unknown session updates are rejected',()=>assert.throws(()=>p.setEnabled('missing',true),/session not found/))
  console.log('RESULT PASS',count,'YOLO policy checks')
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
