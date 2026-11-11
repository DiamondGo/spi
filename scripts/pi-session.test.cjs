const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),Module=require('node:module'),{EventEmitter}=require('node:events')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-session-process-test-'))
let child
const source=path.resolve(__dirname,'../src/main/pi/piSession.ts'),mod=new Module(path.join(tmp,'session.cjs'),module);mod.paths=module.paths
mod.require=n=>n==='child_process'?{spawn(){child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.write=()=>true;child.kill=()=>true;return child}}:n==='./piInvocation'?{piInvocation:(command,args,env)=>({command,args,env})}:require(n)
mod._compile(ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,source)
const {PiSession}=mod.exports
;(async()=>{
  const a=new PiSession('fixture','/fixture',undefined,'/fixture/pi','/fixture/ext','token');let exits=0;a.onExit=()=>exits++
  const pending=a.sendCommand('get_state');child.stderr.emit('data',Buffer.from("env: 'no"));child.stderr.emit('data',Buffer.from("de': No such file or directory\n"));child.emit('exit',127,null)
  await assert.rejects(pending,/code 127.*Node\.js is missing/);assert.equal(exits,1)
  const start=Date.now();await assert.rejects(a.sendCommand('get_state'),/code 127/);assert.ok(Date.now()-start<100)
  console.log('PASS exit code and missing Node classification; commands after exit fail immediately')
  const b=new PiSession('fixture','/fixture',undefined,'/fixture/pi','/fixture/ext','token'),other=b.sendCommand('get_state');child.stderr.emit('data',Buffer.from('PRIVATE_EXTENSION_DIAGNOSTIC_NOT_FOR_IPC'));child.emit('exit',1,null)
  await assert.rejects(other,e=>e.message.includes('code 1')&&!e.message.includes('PRIVATE_EXTENSION'));console.log('PASS arbitrary extension stderr is not copied into IPC errors')
  const c=new PiSession('fixture','/fixture',undefined,'/fixture/pi','/fixture/ext','token'),failed=c.sendCommand('get_state');child.emit('error',new Error('ENOENT fixture launcher'));await assert.rejects(failed,/failed to launch pi.*ENOENT/);await assert.rejects(c.sendCommand('get_state'),/ENOENT/);console.log('PASS spawn failures retire pending and future commands')
  const d=new PiSession('fixture','/fixture',undefined,'/fixture/pi','/fixture/ext','token'),killed=d.sendCommand('get_state');child.emit('exit',null,'SIGTERM');await assert.rejects(killed,/signal SIGTERM/);console.log('PASS signal-based startup exit has a useful diagnostic')
  const e=new PiSession('fixture','/fixture',undefined,'/fixture/pi','/fixture/ext','token');child.stdin.destroyed=true
  await assert.rejects(e.sendCommand('get_state'),/input stream unavailable/);child.emit('exit',0,null)
  console.log('PASS destroyed RPC input rejects immediately')
  const f=new PiSession('fixture','/fixture',undefined,'/fixture/pi','/fixture/ext','token');child.stdin.write=(_line,cb)=>{queueMicrotask(()=>cb(new Error('EPIPE fixture')));return false}
  await assert.rejects(f.sendCommand('get_state'),/EPIPE/);assert.equal(f.pending.size,0);child.emit('exit',0,null)
  console.log('PASS asynchronous pipe-write errors retire the command without waiting for timeout')
  const g=new PiSession('fixture','/fixture',undefined,'/fixture/pi','/fixture/ext','token');const process=child;let killSent=false;process.kill=signal=>{assert.equal(signal,'SIGKILL');killSent=true;return true}
  let terminated=false;const termination=g.terminate().then(()=>{terminated=true});await new Promise(r=>setImmediate(r));assert.equal(killSent,true);assert.equal(terminated,false)
  process.emit('exit',null,'SIGKILL');await termination;assert.equal(g.hasExited,true);await g.terminate()
  console.log('PASS force recovery waits for actual process exit, including a stopped process, and is idempotent after exit')
  console.log('RESULT PASS 7 process/RPC diagnostic checks')
})().catch(e=>{console.error(e);process.exitCode=1})
