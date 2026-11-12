const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),{randomUUID}=require('node:crypto')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-title-unit-')),previous=process.env.SPI_PERMISSION_TOKEN
const file=path.join(tmp,'bridge.cjs');fs.writeFileSync(file,ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/main/pi/permissionExtension.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)
process.env.SPI_PERMISSION_TOKEN=randomUUID()
const hooks=new Map(),commands=new Map();require(file).default({on:(name,fn)=>hooks.set(name,fn),registerCommand:(name,command)=>commands.set(name,command)})
const command=commands.get('spi-session-title-bridge'),tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(override={}){
 const replies=[],calls=[],model={provider:'fixture',id:'reasoning-title',reasoning:true,maxTokens:128000}
 const ctx={cwd:tmp,hasUI:true,model,isIdle:()=>true,sessionManager:{getBranch:()=>[{type:'message',message:{role:'user',content:'Improve the desktop UI'}},{type:'message',message:{role:'assistant',content:[{type:'text',text:'Implemented menus'}]}}]},modelRegistry:{streamSimple:(...args)=>{calls.push(args);return{result:async()=>({stopReason:'stop',content:[{type:'text',text:'Desktop menus'}]})}}},ui:{notify:text=>replies.push(JSON.parse(text.slice(text.indexOf('{'))))},...override}
 return{ctx,replies,calls,invoke:args=>command.handler(args??JSON.stringify({requestId:'unit-'+randomUUID(),language:'en'}),ctx)}
}
let checks=0;async function check(name,fn){await fn();checks++;console.log('PASS',name)}
;(async()=>{try{
 await check('reasoning models use provider-neutral low effort and answer room, without mutating model/history',async()=>{
  const f=fixture(),before=JSON.stringify(f.ctx.model);f.ctx.modelRegistry.complete=()=>{throw Error('raw API unexpectedly used')}
  await f.invoke();assert.equal(f.replies[0].name,'Desktop menus');assert.equal(f.calls.length,1)
  const [model,context,options]=f.calls[0];assert.strictEqual(model,f.ctx.model);assert.equal(context.tools,undefined);assert.equal(options.reasoning,'low');assert.equal(options.maxTokens,4096);assert.equal(options.maxRetries,0);assert.equal(options.cacheRetention,'none');assert.equal(JSON.stringify(f.ctx.model),before)
 })
 await check('legacy complete remains supported with explicit low reasoning and the configured token cap',async()=>{
  let captured;const f=fixture({model:{reasoning:true,maxTokens:2048},modelRegistry:{complete:async(...args)=>{captured=args;return{stopReason:'stop',content:[{type:'text',text:'Legacy title'}]}}}})
  await f.invoke();assert.equal(f.replies[0].name,'Legacy title');assert.equal(captured[2].reasoningEffort,'low');assert.equal(captured[2].maxTokens,2048)
 })
 await check('summarization is bounded and excludes images, thinking, tool output and abandoned-role data',async()=>{
  const f=fixture();f.ctx.sessionManager.getBranch=()=>[{type:'message',message:{role:'user',content:[{type:'text',text:'original task'},{type:'image',data:'PRIVATE_IMAGE'}]}},{type:'message',message:{role:'toolResult',content:'PRIVATE_TOOL'}},{type:'message',message:{role:'assistant',content:[{type:'thinking',text:'PRIVATE_THINKING'},{type:'text',text:'x'.repeat(4000)}]}},...Array.from({length:40},()=>({type:'compaction',summary:'summary '.repeat(1000)}))]
  await f.invoke();const payload=JSON.stringify(f.calls[0][1]);assert.ok(!payload.includes('PRIVATE_'));assert.ok(f.calls[0][1].messages[0].content[0].text.length<=24000)
 })
 await check('unready, missing-model/API, busy and empty-history cases are distinct and make no model calls',async()=>{
  for(const [patch,code]of [[{hasUI:false},'not_ready'],[{model:undefined},'no_model'],[{modelRegistry:{}},'unsupported'],[{isIdle:()=>false},'busy'],[{sessionManager:{getBranch:()=>[]}},'empty_history']]){const f=fixture(patch);await f.invoke();assert.equal(f.replies[0].errorCode,code);assert.equal(f.calls.length,0)}
 })
 await check('provider failures return only an allowlisted category, never raw response text or credentials',async()=>{
  for(const [message,code]of [['400 unsupported reasoning effort none PRIVATE_RESPONSE','request_options'],['401 PRIVATE_CREDENTIAL','auth'],['403 permission denied PRIVATE_RESPONSE','auth'],['429 quota exceeded PRIVATE_RESPONSE','rate_limit'],['413 context length exceeded PRIVATE_RESPONSE','context_limit'],['404 deployment not found PRIVATE_RESPONSE','model_unavailable'],['fetch failed ECONNRESET PRIVATE_RESPONSE','network'],['request timed out PRIVATE_RESPONSE','timeout'],['500 private upstream body PRIVATE_RESPONSE','provider_error']]){
   const f=fixture({modelRegistry:{streamSimple:()=>({result:async()=>({stopReason:'error',content:[],errorMessage:message})})}})
   await f.invoke();assert.equal(f.replies[0].errorCode,code);assert.ok(!JSON.stringify(f.replies).includes('PRIVATE'));assert.equal(f.replies[0].name,undefined)
  }
 })
 await check('synchronous/provider auth exceptions are also categorized without leaking their message',async()=>{
  const f=fixture({modelRegistry:{streamSimple:()=>{throw Object.assign(new Error('PRIVATE_AUTH_BODY'),{status:401})}}});await f.invoke();assert.equal(f.replies[0].errorCode,'auth');assert.ok(!JSON.stringify(f.replies).includes('PRIVATE'))
 })
 await check('thinking-only exhausted output is not confused with network failure or a valid title',async()=>{
  for(const [response,code]of [[{stopReason:'length',content:[{type:'thinking',thinking:'PRIVATE_THINKING'}]},'output_limit'],[{stopReason:'stop',content:[{type:'toolCall',name:'do-not-execute'}]},'empty_response'],[{stopReason:'aborted',content:[]},'cancelled']]){const f=fixture({modelRegistry:{streamSimple:()=>({result:async()=>response})}});await f.invoke();assert.equal(f.replies[0].errorCode,code);assert.ok(!JSON.stringify(f.replies).includes('PRIVATE'))}
 })
 await check('the deadline settles even when a provider ignores AbortSignal, and late output is ignored',async()=>{
  const original=global.setTimeout;let deadline,resolveRequest,signal,calls=0
  global.setTimeout=(fn,ms,...args)=>{if(ms===30000)deadline=fn;return original(fn,ms,...args)}
  try{const f=fixture({modelRegistry:{streamSimple:(_m,_c,o)=>{calls++;signal=o.signal;return{result:()=>new Promise(resolve=>{resolveRequest=resolve})}}}});const task=f.invoke();await tick();assert.equal(calls,1);deadline();await task;assert.equal(signal.aborted,true);assert.equal(f.replies[0].errorCode,'timeout');resolveRequest({stopReason:'stop',content:[{type:'text',text:'late'}]});await tick();assert.equal(f.replies.length,1)}finally{global.setTimeout=original}
 })
 await check('session shutdown cancels an uncooperative provider without waiting for its result',async()=>{
  const f=fixture({modelRegistry:{streamSimple:()=>({result:()=>new Promise(()=>{})})}});const task=f.invoke();await tick();hooks.get('session_shutdown')();await task;assert.equal(f.replies[0].errorCode,'cancelled')
 })
 await check('malformed command inputs cannot make billable model requests',async()=>{
  const f=fixture();for(const request of ['not-json','null',JSON.stringify({requestId:null,language:'en'}),JSON.stringify({requestId:'safe',language:'unsupported'})])await f.invoke(request);assert.equal(f.calls.length,0);assert.equal(f.replies.length,0)
 })
 console.log('RESULT PASS',checks,'AI naming compatibility/diagnostic checks')
}finally{if(previous===undefined)delete process.env.SPI_PERMISSION_TOKEN;else process.env.SPI_PERMISSION_TOKEN=previous;fs.rmSync(tmp,{recursive:true,force:true})}})().catch(error=>{console.error(error);process.exitCode=1})
