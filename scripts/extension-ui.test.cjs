const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-extension-ui-test-'))
function load(relative,mocks={}){const file=path.join(tmp,path.basename(relative,'.ts')+'.cjs'),m=new Module(file,module);m.paths=module.paths;m.require=n=>n in mocks?mocks[n]:n==='../../shared/sessionHealth'?load('src/shared/sessionHealth.ts'):require(n);m._compile(ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,file);return m.exports}
const ui=load('src/main/pi/extensionUi.ts'),{YoloPolicy}=load('src/main/pi/yolo.ts')
const instances=[],managers=[];let count=0
class FakePi {
  constructor(id,cwd,file,pi,extension,token){this.id=id;this.cwd=cwd;this.token=token;this.wire=[];this.commands=[];this.child={stdin:{writable:true,write:line=>{this.wire.push(JSON.parse(line));return true}}};instances.push(this);queueMicrotask(()=>this.onEvent({type:'extension_ui_request',method:'notify',message:'spi-permission-ready:'+token}))}
  sendCommand(command){this.commands.push(command);if(command==='get_state')return Promise.resolve({sessionFile:path.join(tmp,this.id+'.jsonl')});if(command==='clear_queue'&&this.clearGate)return this.clearGate;return Promise.resolve({steering:[],followUp:[]})}
  close(){if(!this.exited){this.exited=true;this.child.stdin.writable=false;this.onExit(0)}}
  kill(){this.close()}
}
const {PiManager}=load('src/main/pi/piManager.ts',{'./piSession':{PiSession:FakePi},'./extensionUi':ui,'./messageQueue':load('src/main/pi/messageQueue.ts')})
const extension=path.join(tmp,'bridge.mjs');fs.writeFileSync(extension,'// fixture')
async function setup(hasUi=true){const events=[],state={hasUi},p=new YoloPolicy(()=>{}),m=new PiManager('fixture',p,extension,e=>events.push(e),()=>{},()=>state.hasUi);managers.push(m);const a=await m.open(tmp);return{m,p,events,state,id:a.sessionId,pi:instances.at(-1)}}
const options=['Allow','Allow always (this project)','Allow always (global)','Block']
const req=(id='r',patch={})=>({type:'extension_ui_request',method:'select',id,title:'Allow bash? "printf SENSITIVE_COMMAND"',options:[...options],...patch})
function bridge(pi,id='bridge'){pi.onEvent({type:'extension_ui_request',method:'select',id,title:'spi-permission:'+pi.token+':'+JSON.stringify({cwd:tmp,tool:'bash',input:{command:'fixture'}}),options:['allow','deny']})}
const delay=ms=>new Promise(r=>setTimeout(r,ms))
async function check(name,fn){await fn();count++;console.log('PASS',name);for(const m of managers)m.closeAll()}
;(async()=>{try{
  await check('recognizer accepts only complete compatible tool/select formats, not an Allow button alone',()=>{
    for(const tool of ['bash','read','write','edit','grep','find','ls'])assert.deepEqual(ui.recognizeToolApproval(req('x',{title:'Allow '+tool+'? multiline\nbody'})),{adapter:'permission-modes',tool})
    for(const tool of ['write','edit'])assert.equal(ui.recognizeToolApproval(req('x',{title:'Allow '+tool+' on /fixture path?',options:[...options.slice(0,3),'Allow all (enable bypass)','Block']})).tool,tool)
    for(const patch of [{method:'confirm'},{method:'input'},{method:'editor'},{title:'Delete session?'},{title:'Allow login? account'},{title:'Allow bash?'},{title:'Subagent: Allow bash? command'},{title:'Allow Bash? command'},{options:['Allow','Block']},{options:[...options,'Yes']},{options:[...options].reverse()},{message:'additional confirmation'},{placeholder:''},{prefill:''}])assert.equal(ui.recognizeToolApproval(req('x',patch)),null)
  })
  await check('off adds no sPi approval: a Pi-approved tool passes immediately in either switch state',async()=>{
    const {p,id,pi,events}=await setup();bridge(pi,'off');p.setEnabled(id,true);bridge(pi,'on');assert.deepEqual(pi.wire.map(e=>e.value),['allow','allow']);assert.equal(events.length,0)
  })
  await check('YOLO on auto-replies once and emits metadata-only audit, not a live dialog',async()=>{
    const {p,id,pi,events}=await setup();p.setEnabled(id,true);pi.onEvent(req());assert.deepEqual(pi.wire,[{type:'extension_ui_response',id:'r',value:'Allow'}]);assert.equal(events.length,1);assert.equal(events[0].event.resolution,'auto-allow');assert.ok(!JSON.stringify(events).includes('SENSITIVE_COMMAND'))
  })
  await check('YOLO off leaves Pi approvals manual and does not change Pi session policy',async()=>{
    const {id,pi,events,p}=await setup();pi.onEvent(req());assert.equal(pi.wire.length,0);assert.equal(events[0].event.type,'extension_ui_request');assert.deepEqual(p.snapshot().sessions[id],{enabled:false,ready:true})
  })
  await check('off preserves Pi dialogs without inventing a default timeout',async()=>{
    const {pi}=await setup();const original=global.setTimeout;let timers=0;global.setTimeout=(...args)=>{timers++;return original(...args)};try{pi.onEvent(req('no-pi-timeout'))}finally{global.setTimeout=original}assert.equal(timers,0);assert.equal(pi.wire.length,0)
  })
  await check('enabling YOLO resolves visible compatible prompts only in that session',async()=>{
    const {m,p,id,pi,events}=await setup(),b=await m.open(tmp),other=instances.at(-1);pi.onEvent(req());other.onEvent(req('peer'));p.setEnabled(id,true);assert.equal(pi.wire[0].value,'Allow');assert.equal(other.wire.length,0);assert.equal(events.at(-1).event.resolution,'auto-allow');assert.equal(p.snapshot().sessions[b.sessionId].enabled,false)
  })
  await check('disabling YOLO restores manual replies, while Pi-approved commands still run without another gate',async()=>{
    const {p,id,pi}=await setup();p.setEnabled(id,true);pi.onEvent(req('first'));p.setEnabled(id,false);pi.onEvent(req('second'));assert.equal(pi.wire.length,1);bridge(pi);assert.equal(pi.wire.at(-1).value,'allow')
  })
  await check('no UI or missing bridge readiness fails closed regardless of YOLO',async()=>{
    const a=await setup(false);a.p.setEnabled(a.id,true);a.pi.onEvent(req());assert.equal(a.pi.wire.length,0);await assert.rejects(a.m.answerExtensionUi(a.id,'r',{value:'Allow'}),/已停止/);bridge(a.pi);assert.equal(a.pi.wire.at(-1).value,'deny')
    const p=new YoloPolicy(()=>{});p.open('x');p.setEnabled('x',true);assert.equal(p.canAutoAllowExtension('x'),false);p.ready('x');assert.equal(p.canAutoAllowExtension('x'),true);p.hold('x');assert.equal(p.canAutoAllowExtension('x'),false)
  })
  await check('auth/deletion/plan/unknown/forwarded and confirm/input/editor requests remain manual',async()=>{
    const {p,id,pi,events}=await setup();p.setEnabled(id,true);let n=0
    for(const patch of [{method:'confirm',title:'Delete all sessions?'},{method:'input',title:'Login OTP'},{method:'editor',title:'Edit plan'},{title:'Execute this plan?',options:['Execute','Cancel']},{title:'Allow unknown? action'},{title:'[Subagent x] Allow bash? command'},{options:['Allow','Block']},{message:'another step'}])pi.onEvent(req('unknown-'+(++n),patch))
    assert.equal(pi.wire.length,0);assert.equal(events.length,n)
  })
  await check('manual Block wins the race with enabling YOLO',async()=>{
    const {m,p,id,pi}=await setup();pi.onEvent(req());await m.answerExtensionUi(id,'r',{value:'Block'});p.setEnabled(id,true);assert.deepEqual(pi.wire,[{type:'extension_ui_response',id:'r',value:'Block'}]);await assert.rejects(m.answerExtensionUi(id,'r',{value:'Allow'}),/已取消/)
  })
  await check('auto reply is single-use and never selects persistent/global/bypass options',async()=>{
    const {m,p,id,pi}=await setup();p.setEnabled(id,true);pi.onEvent(req());pi.onEvent(req());p.setEnabled(id,true);await assert.rejects(m.answerExtensionUi(id,'r',{value:'Allow always (global)'}),/已取消/);assert.equal(pi.wire.length,1);assert.equal(pi.wire[0].value,'Allow')
  })
  await check('manual generic responses retain type/option validation',async()=>{
    const {m,id,pi}=await setup();pi.onEvent(req());await assert.rejects(m.answerExtensionUi(id,'r',{value:'invalid'}),/无效/);await m.answerExtensionUi(id,'r',{value:'Allow'});pi.onEvent(req('confirm',{method:'confirm'}));await assert.rejects(m.answerExtensionUi(id,'confirm',{value:'Allow'}),/无效/);await m.answerExtensionUi(id,'confirm',{confirmed:false});for(const method of ['input','editor']){pi.onEvent(req(method,{method}));await m.answerExtensionUi(id,method,{value:'fixture'})}
  })
  await check('expired/zero-timeout requests cannot be allowed later by YOLO',async()=>{
    const {p,id,pi}=await setup();pi.onEvent(req('expires',{timeout:10}));await delay(25);p.setEnabled(id,true);pi.onEvent(req('zero',{timeout:0}));assert.equal(pi.wire.length,2);assert.ok(pi.wire.every(e=>e.cancelled===true))
  })
  await check('malformed timeout metadata stays manual',async()=>{
    const {p,id,pi}=await setup();p.setEnabled(id,true);for(const timeout of [-1,null,'100'])pi.onEvent(req(String(timeout),{timeout}));assert.equal(pi.wire.length,0)
  })
  await check('Stop clears the queue before cancelling prompts; neither bridge nor auto replies can execute while held',async()=>{
    const {m,p,id,pi}=await setup();pi.onEvent(req());let release;pi.clearGate=new Promise(r=>{release=r});const stopping=m.abort(id);p.setEnabled(id,true);assert.equal(pi.wire.length,0);await assert.rejects(m.answerExtensionUi(id,'r',{value:'Allow'}),/已停止/);release({steering:[],followUp:[]});await stopping;assert.equal(pi.wire[0].cancelled,true);bridge(pi);assert.equal(pi.wire.at(-1).value,'deny');assert.deepEqual(pi.commands.slice(-2),['clear_queue','abort'])
  })
  await check('concurrent Stops keep manual replies suspended until both clears finish',async()=>{
    const {m,id,pi}=await setup();let one,two;pi.clearGate=new Promise(r=>{one=r});const a=m.abort(id);pi.clearGate=new Promise(r=>{two=r});const b=m.abort(id);one({steering:[],followUp:[]});await a;pi.onEvent(req('between',{method:'confirm'}));await assert.rejects(m.answerExtensionUi(id,'between',{confirmed:true}),/已停止/);two({steering:[],followUp:[]});await b;assert.equal(pi.wire.at(-1).cancelled,true)
  })
  await check('manual extension commands work after Stop; automatic replies stay held until next agent start',async()=>{
    const {m,p,id,pi}=await setup();p.setEnabled(id,true);await m.abort(id);pi.onEvent(req('input',{method:'input'}));await m.answerExtensionUi(id,'input',{value:'fixture'});const n=pi.wire.length;pi.onEvent(req('tool'));assert.equal(pi.wire.length,n)
  })
  await check('agent settlement retires stale dialog IDs',async()=>{
    const {m,p,id,pi}=await setup();pi.onEvent(req());pi.onEvent({type:'agent_settled'});p.setEnabled(id,true);await assert.rejects(m.answerExtensionUi(id,'r',{value:'Allow'}),/已取消/);assert.equal(pi.wire[0].cancelled,true)
  })
  await check('closeAll freezes every session before observers can approve another one',async()=>{
    const {m,p,id,pi,state}=await setup(false),b=await m.open(tmp),other=instances.at(-1);p.setEnabled(id,true);p.setEnabled(b.sessionId,true);pi.onEvent(req());other.onEvent(req('peer'));state.hasUi=true;m.closeAll();assert.ok([...pi.wire,...other.wire].every(e=>e.cancelled===true));assert.equal(m.size,0)
  })
  await check('write failures are never audited as Allow, and Pi cannot forge the internal result event',async()=>{
    const {p,id,pi,events}=await setup();pi.onEvent({type:'spi_extension_ui_result',id:'spoof',resolution:'auto-allow'});assert.equal(events.length,0);p.setEnabled(id,true);pi.child.stdin.writableEnded=true;pi.onEvent(req());assert.equal(events.at(-1).event.resolution,'failed');assert.equal(pi.wire.length,0)
  })
  await check('no legacy permission modes, rules or persisted default are exposed',async()=>{
    const {p,id,pi}=await setup();p.setEnabled(id,true);pi.onEvent(req());assert.deepEqual(Object.keys(p.snapshot()),['sessions']);assert.deepEqual(Object.keys(p.snapshot().sessions[id]).sort(),['enabled','ready'])
  })
  const store=load('src/renderer/src/store.ts',{react:{useSyncExternalStore(){}}});store.addSession('ui',tmp,{isStreaming:false})
  await check('renderer deduplicates non-interactive YOLO audit records',()=>{const e={type:'spi_extension_ui_result',id:'new',resolution:'auto-allow',adapter:'permission-modes',tool:'bash'};store.applyEvent('ui',e);store.applyEvent('ui',e);assert.equal(store.getStore().sessions.ui.items.length,1);assert.equal(store.getStore().sessions.ui.items[0].answered,true)})
  await check('pending cards retire on automatic reply or cancellation',()=>{store.applyEvent('ui',req('pending'));store.applyEvent('ui',{type:'spi_extension_ui_result',id:'pending',resolution:'auto-allow'});store.applyEvent('ui',req('cancel'));store.applyEvent('ui',{type:'spi_extension_ui_result',id:'cancel',resolution:'cancelled'});const items=store.getStore().sessions.ui.items;assert.equal(items.find(i=>i.reqId==='pending').answered,true);assert.equal(items.find(i=>i.reqId==='cancel').resolution,'cancelled')})
  console.log('RESULT PASS',count,'YOLO/extension checks')
}finally{for(const m of managers)m.closeAll();fs.rmSync(tmp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1})
