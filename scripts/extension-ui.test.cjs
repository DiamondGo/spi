const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-extension-ui-test-'))
function load(relative,mocks={}){const file=path.join(tmp,path.basename(relative,'.ts')+'.cjs'),m=new Module(file,module);m.paths=module.paths;m.require=n=>n in mocks?mocks[n]:require(n);m._compile(ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,file);return m.exports}
const ui=load('src/main/pi/extensionUi.ts'),{Permissions}=load('src/main/pi/permissions.ts')
const instances=[],managers=[];let count=0,seq=0
class FakePi {
  constructor(id,cwd,file,pi,extension,token){this.id=id;this.cwd=cwd;this.token=token;this.wire=[];this.commands=[];this.child={stdin:{writable:true,write:line=>{this.wire.push(JSON.parse(line));return true}}};instances.push(this);queueMicrotask(()=>this.onEvent({type:'extension_ui_request',method:'notify',message:'spi-permission-ready:'+token}))}
  sendCommand(command){this.commands.push(command);if(command==='get_state')return Promise.resolve({sessionFile:path.join(tmp,this.id+'.jsonl')});if(command==='clear_queue'&&this.clearGate)return this.clearGate;return Promise.resolve({steering:[],followUp:[]})}
  close(){if(!this.exited){this.exited=true;this.child.stdin.writable=false;this.onExit(0)}}
  kill(){this.close()}
}
const {PiManager}=load('src/main/pi/piManager.ts',{'./piSession':{PiSession:FakePi},'./extensionUi':ui})
const extension=path.join(tmp,'gate.mjs');fs.writeFileSync(extension,'// fixture')
async function setup(hasUi=true){const events=[],state={hasUi},p=new Permissions(path.join(tmp,'permissions-'+(++seq)+'.json'),()=>{}),m=new PiManager('fixture',p,extension,e=>events.push(e),()=>{},()=>state.hasUi);managers.push(m);const a=await m.open(tmp);return{m,p,events,state,id:a.sessionId,pi:instances.at(-1)}}
const options=['Allow','Allow always (this project)','Allow always (global)','Block']
const req=(id='r',patch={})=>({type:'extension_ui_request',method:'select',id,title:'Allow bash? "printf SENSITIVE_COMMAND"',options:[...options],...patch})
const delay=ms=>new Promise(r=>setTimeout(r,ms))
async function check(name,fn){await fn();count++;console.log('PASS',name);for(const m of managers)m.closeAll()}
;(async()=>{try{
  await check('recognizer accepts only exact known tool/select fingerprints and never chooses persistent/bypass options',()=>{
    for(const tool of ['bash','read','write','edit','grep','find','ls'])assert.deepEqual(ui.recognizeToolApproval(req('x',{title:'Allow '+tool+'? multiline\nbody'})),{adapter:'permission-modes',tool})
    for(const tool of ['write','edit'])assert.equal(ui.recognizeToolApproval(req('x',{title:'Allow '+tool+' on /fixture path?',options:[...options.slice(0,3),'Allow all (enable bypass)','Block']})).tool,tool)
    for(const patch of [{method:'confirm'},{method:'input'},{method:'editor'},{title:'Delete session?'},{title:'Allow login? account'},{title:'Allow bash?'},{title:'Subagent: Allow bash? command'},{title:'Allow Bash? command'},{options:['Allow','Block']},{options:[...options,'Yes']},{options:[...options].reverse()},{message:'additional confirmation'},{placeholder:''},{prefill:''}])assert.equal(ui.recognizeToolApproval(req('x',patch)),null,JSON.stringify(patch))
  })
  await check('All auto-replies once to a future recognized request and emits metadata-only audit, not a live dialog',async()=>{
    const {m,p,id,pi,events}=await setup();p.setMode(id,'all');pi.onEvent(req());assert.deepEqual(pi.wire,[{type:'extension_ui_response',id:'r',value:'Allow'}]);assert.equal(events.length,1);assert.equal(events[0].event.resolution,'auto-allow');assert.ok(!JSON.stringify(events).includes('SENSITIVE_COMMAND'));assert.equal(m.size,1)
  })
  await check('Ask/remember/allowlist keep extension approvals manual',async()=>{
    const {p,id,pi,events}=await setup();for(const mode of ['ask','remember','allowlist']){p.setMode(id,mode);pi.onEvent(req(mode))}assert.equal(pi.wire.length,0);assert.equal(events.filter(e=>e.event.type==='extension_ui_request').length,3)
  })
  await check('switching to All resolves an already visible Pi approval, but not other sessions or sPi pending approvals',async()=>{
    const {m,p,id,pi,events}=await setup(),b=await m.open(tmp),other=instances.at(-1)
    pi.onEvent(req());other.onEvent(req('peer'));p.request(id,'own',tmp,'bash',{command:'fixture'},()=>{})
    p.setMode(id,'all');assert.deepEqual(pi.wire,[{type:'extension_ui_response',id:'r',value:'Allow'}]);assert.equal(other.wire.length,0);assert.equal(p.snapshot().pending.length,1);assert.equal(events.at(-1).event.resolution,'auto-allow')
  })
  await check('leaving All restores manual behavior for new requests',async()=>{
    const {p,id,pi}=await setup();p.setMode(id,'all');pi.onEvent(req('first'));p.setMode(id,'ask');pi.onEvent(req('second'));assert.equal(pi.wire.length,1)
  })
  await check('no UI or missing bridge readiness prevents automatic replies',async()=>{
    const a=await setup(false);a.p.setMode(a.id,'all');a.pi.onEvent(req());assert.equal(a.pi.wire.length,0);await assert.rejects(a.m.answerExtensionUi(a.id,'r',{value:'Allow'}),/已停止/)
    a.pi.onEvent({type:'extension_ui_request',method:'select',id:'own',title:'spi-permission:'+a.pi.token+':'+JSON.stringify({cwd:tmp,tool:'bash',input:{command:'fixture'}}),options:['allow','deny']});assert.equal(a.pi.wire.at(-1).value,'deny')
    const p=new Permissions(path.join(tmp,'not-ready.json'),()=>{});p.open('x');p.setMode('x','all');assert.equal(p.canAutoAllowExtension('x'),false);p.ready('x');assert.equal(p.canAutoAllowExtension('x'),true);p.hold('x');assert.equal(p.canAutoAllowExtension('x'),false);p.close('x')
  })
  await check('login/deletion/plan/unknown/forwarded and other UI methods remain manual even in All',async()=>{
    const {p,id,pi,events}=await setup();p.setMode(id,'all');let n=0
    for(const patch of [{method:'confirm',title:'Delete all sessions?'},{method:'input',title:'Login OTP'},{method:'editor',title:'Edit plan'},{title:'Execute this plan?',options:['Execute','Cancel']},{title:'Allow unknown? action'},{title:'[Subagent x] Allow bash? command'},{options:['Allow','Block']},{message:'another step'}])pi.onEvent(req('unknown-'+(++n),patch))
    assert.equal(pi.wire.length,0);assert.equal(events.length,n);assert.ok(events.every(e=>e.event.type==='extension_ui_request'))
  })
  await check('manual Block wins a race with switching All, without duplicate approval',async()=>{
    const {m,p,id,pi}=await setup();pi.onEvent(req());await m.answerExtensionUi(id,'r',{value:'Block'});p.setMode(id,'all');assert.deepEqual(pi.wire,[{type:'extension_ui_response',id:'r',value:'Block'}]);await assert.rejects(m.answerExtensionUi(id,'r',{value:'Allow'}),/已取消/)
  })
  await check('automatic reply wins once; duplicate records and stale/manual replies cannot write again',async()=>{
    const {m,p,id,pi}=await setup();p.setMode(id,'all');pi.onEvent(req());pi.onEvent(req());p.setMode(id,'all');await assert.rejects(m.answerExtensionUi(id,'r',{value:'Allow always (global)'}),/已取消/);assert.equal(pi.wire.length,1)
  })
  await check('manual select validates options, confirm validates boolean, and editor/input still work',async()=>{
    const {m,id,pi}=await setup();pi.onEvent(req());await assert.rejects(m.answerExtensionUi(id,'r',{value:'invalid'}),/无效/);assert.equal(pi.wire.length,0);await m.answerExtensionUi(id,'r',{value:'Allow'})
    pi.onEvent(req('confirm',{method:'confirm'}));await assert.rejects(m.answerExtensionUi(id,'confirm',{value:'Allow'}),/无效/);await m.answerExtensionUi(id,'confirm',{confirmed:false});assert.equal(pi.wire.at(-1).confirmed,false)
    for(const method of ['input','editor']){pi.onEvent(req(method,{method}));await m.answerExtensionUi(id,method,{value:'fixture text'});assert.equal(pi.wire.at(-1).value,'fixture text')}
  })
  await check('expired/zero-timeout requests never become allowed after switching All',async()=>{
    const {p,id,pi,events}=await setup();pi.onEvent(req('expires',{timeout:10}));await delay(25);p.setMode(id,'all');pi.onEvent(req('zero',{timeout:0}));assert.ok(pi.wire.every(e=>e.cancelled===true));assert.ok(events.some(e=>e.event.resolution==='expired'));assert.equal(pi.wire.length,2)
  })
  await check('malformed timeout metadata cannot trigger auto approval',async()=>{
    const {p,id,pi}=await setup();p.setMode(id,'all');for(const timeout of [-1,null,'100'])pi.onEvent(req(String(timeout),{timeout}));assert.equal(pi.wire.length,0)
  })
  await check('Stop holds approvals until clear_queue completes, then cancels rather than allows',async()=>{
    const {m,p,id,pi}=await setup();pi.onEvent(req());let release;pi.clearGate=new Promise(r=>{release=r});const stopping=m.abort(id);p.setMode(id,'all');assert.equal(pi.wire.length,0);await assert.rejects(m.answerExtensionUi(id,'r',{value:'Allow'}),/已停止/);release({steering:[],followUp:[]});await stopping;assert.equal(pi.wire[0].cancelled,true);assert.deepEqual(pi.commands.slice(-2),['clear_queue','abort'])
  })
  await check('concurrent Stop calls keep replies suspended until both queue clears finish',async()=>{
    const {m,id,pi}=await setup();let one,two;pi.clearGate=new Promise(r=>{one=r});const a=m.abort(id);pi.clearGate=new Promise(r=>{two=r});const b=m.abort(id);one({steering:[],followUp:[]});await a;pi.onEvent(req('between',{method:'confirm',title:'Plan confirmation'}));await assert.rejects(m.answerExtensionUi(id,'between',{confirmed:true}),/已停止/);two({steering:[],followUp:[]});await b;assert.equal(pi.wire.at(-1).cancelled,true)
  })
  await check('manual extension commands still work after Stop, while auto tool approvals stay held',async()=>{
    const {m,p,id,pi}=await setup();p.setMode(id,'all');await m.abort(id);pi.onEvent(req('post-stop',{method:'input',title:'Choose a profile'}));await m.answerExtensionUi(id,'post-stop',{value:'fixture'});assert.equal(pi.wire.at(-1).value,'fixture');const n=pi.wire.length;pi.onEvent(req('held-tool'));assert.equal(pi.wire.length,n)
  })
  await check('agent settled cancels stale dialogs and invalidates their manual replies',async()=>{
    const {m,p,id,pi,events}=await setup();pi.onEvent(req());pi.onEvent({type:'agent_settled'});p.setMode(id,'all');await assert.rejects(m.answerExtensionUi(id,'r',{value:'Allow'}),/已取消/);assert.equal(pi.wire[0].cancelled,true);assert.ok(events.some(e=>e.event.resolution==='cancelled'))
  })
  await check('closeAll freezes all sessions before observer callbacks can approve another pending session',async()=>{
    const {m,p,id,pi,state}=await setup(false),b=await m.open(tmp),other=instances.at(-1);p.setMode(id,'all');p.setMode(b.sessionId,'all');pi.onEvent(req());other.onEvent(req('peer'));state.hasUi=true;m.closeAll();assert.ok([...pi.wire,...other.wire].every(e=>e.cancelled===true));assert.equal(m.size,0)
  })
  await check('stream failure is not reported as automatic Allow',async()=>{
    const {p,id,pi,events}=await setup();p.setMode(id,'all');pi.child.stdin.writableEnded=true;pi.onEvent(req());assert.equal(pi.wire.length,0);assert.equal(events.at(-1).event.resolution,'failed');assert.ok(!events.some(e=>e.event.resolution==='auto-allow'))
  })
  await check('pi cannot forge internal auto-approval results or route own protected approvals through generic UI',async()=>{
    const {m,p,id,pi,events}=await setup();pi.onEvent({type:'spi_extension_ui_result',id:'spoof',resolution:'auto-allow'});assert.equal(events.length,0);p.request(id,'own',tmp,'bash',{command:'fixture'},()=>{});await assert.rejects(m.answerExtensionUi(id,'own',{value:'Allow'}),/专用审批/)
  })
  await check('no default mode, Pi config, model profile or allowlist is changed by auto replies',async()=>{
    const {p,id,pi}=await setup();const before=p.snapshot();p.setMode(id,'all');pi.onEvent(req());assert.equal(p.snapshot().defaultMode,before.defaultMode);assert.deepEqual(p.snapshot().rules,before.rules);assert.equal(fs.existsSync(path.join(tmp,'permissions-'+seq+'.json')),false)
  })
  const store=load('src/renderer/src/store.ts',{react:{useSyncExternalStore(){}}});store.addSession('ui',tmp,{isStreaming:false})
  await check('renderer creates one non-interactive audit record for a fresh auto reply and deduplicates it',()=>{
    const e={type:'spi_extension_ui_result',id:'new',resolution:'auto-allow',adapter:'permission-modes',tool:'bash'};store.applyEvent('ui',e);store.applyEvent('ui',e);const items=store.getStore().sessions.ui.items;assert.equal(items.length,1);assert.equal(items[0].answered,true);assert.equal(items[0].resolution,'auto-allow')
  })
  await check('renderer resolves existing pending cards on auto/cancel rather than leaving clickable stale approvals',()=>{
    store.applyEvent('ui',req('pending'));store.applyEvent('ui',{type:'spi_extension_ui_result',id:'pending',resolution:'auto-allow',adapter:'permission-modes',tool:'bash'});store.applyEvent('ui',req('cancel'));store.applyEvent('ui',{type:'spi_extension_ui_result',id:'cancel',resolution:'cancelled'});const items=store.getStore().sessions.ui.items;assert.equal(items.find(i=>i.reqId==='pending').answered,true);assert.equal(items.find(i=>i.reqId==='cancel').resolution,'cancelled')
  })
  console.log('RESULT PASS',count,'extension approval checks')
}finally{for(const m of managers)m.closeAll();fs.rmSync(tmp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1})
