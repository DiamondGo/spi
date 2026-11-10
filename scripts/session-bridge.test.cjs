const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript'),{randomUUID}=require('node:crypto')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-session-bridge-')),previous=process.env.SPI_PERMISSION_TOKEN
const file=path.join(tmp,'bridge.cjs');fs.writeFileSync(file,ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/main/pi/permissionExtension.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)
let count=0;async function check(name,fn){await fn();count++;console.log('PASS',name)}
;(async()=>{try{
  delete process.env.SPI_PERMISSION_TOKEN;const factory=require(file).default;assert.throws(()=>factory({on(){}}),/token missing/)
  process.env.SPI_PERMISSION_TOKEN=randomUUID();const hooks=new Map();factory({on:(name,fn)=>hooks.set(name,fn)})
  let value='allow',asked=0;const ctx={cwd:tmp,hasUI:true,ui:{select:async()=>{asked++;return value},notify(){}}},event={toolName:'bash',input:{command:'fixture'}}
  await check('token is mandatory and readiness is emitted only on the private bridge',()=>{let message;hooks.get('session_start')({}, {...ctx,ui:{...ctx.ui,notify:s=>{message=s}}});assert.equal(message,'spi-permission-ready:'+process.env.SPI_PERMISSION_TOKEN)})
  await check('Pi-approved tool calls pass when the owner bridge permits them',async()=>assert.equal(await hooks.get('tool_call')(event,ctx),undefined))
  await check('no UI and aborted calls fail closed',async()=>{const before=asked;assert.equal((await hooks.get('tool_call')(event,{...ctx,hasUI:false})).block,true);assert.equal((await hooks.get('tool_call')(event,{...ctx,signal:AbortSignal.abort()})).block,true);assert.equal(asked,before)})
  await check('a stopped/denied or failed bridge never runs a tool',async()=>{value='deny';assert.equal((await hooks.get('tool_call')(event,ctx)).block,true);assert.equal((await hooks.get('tool_call')(event,{...ctx,ui:{...ctx.ui,select:async()=>{throw Error('fixture')}}})).block,true)})
  await check('user bash obeys the same private lifecycle guard',async()=>{const result=await hooks.get('user_bash')({cwd:tmp,command:'fixture'},ctx);assert.equal(result.result.cancelled,true);assert.equal(result.result.exitCode,1)})
  console.log('RESULT PASS',count,'session bridge checks')
}finally{if(previous===undefined)delete process.env.SPI_PERMISSION_TOKEN;else process.env.SPI_PERMISSION_TOKEN=previous;fs.rmSync(tmp,{recursive:true,force:true})}})().catch(e=>{console.error(e.message);process.exitCode=1})
