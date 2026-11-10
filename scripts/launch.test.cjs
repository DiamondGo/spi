const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),Module=require('node:module')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-launch-unit-'))
function load(relative,mocks={}){const name=path.join(tmp,path.basename(relative)+'.cjs'),mod=new Module(name,module);mod.paths=module.paths;mod.require=n=>n in mocks?mocks[n]:require(n);mod._compile(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,name);return mod.exports}
const {launchDirectory}=load('src/main/launchRequests.ts'),{entryFromShim,piInvocation}=load('src/main/pi/piInvocation.ts')
const dir=path.join(tmp,'project with spaces');fs.mkdirSync(dir)
assert.equal(launchDirectory(['app','--cwd',dir],tmp),fs.realpathSync(dir))
assert.equal(launchDirectory(['--cwd=project with spaces'],tmp),fs.realpathSync(dir))
assert.equal(launchDirectory(['--user-data-dir=/tmp/example'],tmp),null)
for(const args of [['--cwd'],['--cwd','missing'],['--cwd',dir,'--cwd',dir]])assert.throws(()=>launchDirectory(args,tmp))
const script=path.join(tmp,'entry with spaces.js');fs.writeFileSync(script,'// fixture')
assert.equal(entryFromShim(path.join(tmp,'pi.cmd'),'"%dp0%\\entry with spaces.js" %*'),script)
assert.equal(entryFromShim(path.join(tmp,'pi.cmd'),'unknown batch command'),null)
if(process.platform!=='win32')assert.equal(piInvocation('/bin/pi',['--mode','rpc'],{}).command,'/bin/pi')
const store=load('src/renderer/src/store.ts',{react:{useSyncExternalStore(){}}});let calls=0
let resolve;const opened=new Promise(r=>{resolve=r});global.window={spi:{openSession:()=>{calls++;return opened},getMessages:async()=>[]}}
;(async()=>{
  const a=store.openDirectory(dir),b=store.openDirectory(dir);assert.equal(calls,1)
  resolve({sessionId:'one',state:{sessionFile:'/example/session.jsonl',isStreaming:false}});await Promise.all([a,b])
  store.setDraft('one','keep');assert.equal(await store.openDirectory(dir),'one');assert.equal(calls,1);assert.equal(store.getStore().sessions.one.draft,'keep')
  console.log('PASS launch arguments, Windows shim resolution and duplicate directory requests')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>delete global.window)
