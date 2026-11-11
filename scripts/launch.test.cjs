const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),Module=require('node:module')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-launch-unit-'))
function load(relative,mocks={}){const name=path.join(tmp,path.basename(relative)+'.cjs'),mod=new Module(name,module);mod.paths=module.paths;mod.require=n=>n in mocks?mocks[n]:require(n);mod._compile(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,name);return mod.exports}
const {launchDirectory}=load('src/main/launchRequests.ts'),{entryFromShim,piInvocation,nodeForPi,validateNodePath}=load('src/main/pi/piInvocation.ts')
const dir=path.join(tmp,'project with spaces');fs.mkdirSync(dir)
assert.equal(launchDirectory(['app','--cwd',dir],tmp),fs.realpathSync(dir))
assert.equal(launchDirectory(['--cwd=project with spaces'],tmp),fs.realpathSync(dir))
assert.equal(launchDirectory(['--user-data-dir=/tmp/example'],tmp),null)
for(const args of [['--cwd'],['--cwd','missing'],['--cwd',dir,'--cwd',dir]])assert.throws(()=>launchDirectory(args,tmp))
const script=path.join(tmp,'entry with spaces.js');fs.writeFileSync(script,'// fixture')
assert.equal(entryFromShim(path.join(tmp,'pi.cmd'),'"%dp0%\\entry with spaces.js" %*'),script)
assert.equal(entryFromShim(path.join(tmp,'pi.cmd'),'unknown batch command'),null)
if(process.platform!=='win32'){
  const base={PATH:path.dirname(process.execPath),HOME:tmp,SHELL:'/bin/sh'}
  assert.equal(piInvocation('/bin/pi',['--mode','rpc'],base).command,'/bin/pi')
  const hidden=path.join(tmp,'nvm selected Node'),sparse=path.join(tmp,'desktop-bin'),shell=path.join(tmp,'login-shell');fs.mkdirSync(hidden);fs.mkdirSync(sparse)
  const node=path.join(hidden,'node');fs.symlinkSync(process.execPath,node)
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'"
  fs.writeFileSync(shell,`#!/bin/sh\nif [ -n "$SPI_PERMISSION_TOKEN$NODE_OPTIONS$NODE_PATH$ELECTRON_RUN_AS_NODE" ]; then exit 91; fi\nprintf 'profile banner\\n__SPI_NODE_PATH__%s\\n' ${quote(node)}\n`,{mode:0o700})
  const env={PATH:sparse,HOME:tmp,SHELL:shell,SPI_PERMISSION_TOKEN:'private-fixture-token',NODE_OPTIONS:'--invalid-probe-option',NODE_PATH:'/not-for-probes',ELECTRON_RUN_AS_NODE:'1'}
  const before={...env},args=['--mode','rpc','--extension','/fixture with spaces/$no-shell.mjs']
  const result=piInvocation('/fixture Pi launcher',args,env)
  assert.equal(result.command,'/fixture Pi launcher');assert.deepEqual(result.args,args);assert.equal(result.env.PATH,hidden+path.delimiter+sparse)
  assert.equal(result.env.SPI_PERMISSION_TOKEN,env.SPI_PERMISSION_TOKEN);assert.equal(result.env.ELECTRON_RUN_AS_NODE,undefined);assert.deepEqual(env,before)
  assert.equal(nodeForPi('/fixture Pi launcher',{...base,PATH:'/deleted/nvm/bin',SHELL:shell}),node)
  assert.equal(piInvocation(script,args,{...env,NODE_OPTIONS:undefined}).command,node)
  const managedHome=path.join(tmp,'managed-home'),managed=path.join(managedHome,'.local/share/pi-node/current/bin');fs.mkdirSync(managed,{recursive:true});fs.symlinkSync(process.execPath,path.join(managed,'node'))
  assert.equal(nodeForPi('/fixture',{PATH:sparse,HOME:managedHome,SHELL:'/nonexistent'}),path.join(managed,'node'))
  assert.equal(piInvocation('/fixture',args,{...base,PATH:sparse},node).env.PATH,hidden+path.delimiter+sparse)
  assert.throws(()=>piInvocation('/fixture',args,base,'/missing/configured-node'),/Configured Node/)
  const profile=path.join(tmp,'settings-profile'),finder=load('src/main/pi/piFinder.ts',{electron:{app:{getPath:()=>profile}},'./piInvocation':{validateNodePath}})
  assert.equal(finder.loadManualNodePath(),null)
  const configFile=path.join(profile,'spi-config.json');fs.writeFileSync(configFile,JSON.stringify({piPath:'/fixture/launcher',layout:{viewMode:'recent'}}))
  finder.saveManualNodePath(node);assert.equal(finder.loadManualNodePath(),node);assert.equal(fs.statSync(configFile).mode&0o777,0o600)
  for(const bad of [{},12,'relative/node','/missing/node']){assert.throws(()=>finder.saveManualNodePath(bad));assert.equal(finder.loadManualNodePath(),node)}
  finder.saveManualNodePath(null);assert.equal(finder.loadManualNodePath(),null);assert.deepEqual(JSON.parse(fs.readFileSync(configFile)),{piPath:'/fixture/launcher',layout:{viewMode:'recent'}})
  console.log('PASS sparse/stale desktop PATH, login-shell Node, managed Node, JS entries, wrapper/argv preservation and probe token isolation')
  console.log('PASS manual Node takes priority; invalid paths fail closed; private atomic settings preserve unrelated fields and clear back to auto')
}
const store=load('src/renderer/src/store.ts',{react:{useSyncExternalStore(){}}});let calls=0
let resolve;const opened=new Promise(r=>{resolve=r});global.window={spi:{openSession:()=>{calls++;return opened},getMessages:async()=>[]}}
;(async()=>{
  const a=store.openDirectory(dir),b=store.openDirectory(dir);assert.equal(calls,1)
  resolve({sessionId:'one',state:{sessionFile:'/example/session.jsonl',isStreaming:false}});await Promise.all([a,b])
  store.setDraft('one','keep');assert.equal(await store.openDirectory(dir),'one');assert.equal(calls,1);assert.equal(store.getStore().sessions.one.draft,'keep')
  console.log('PASS launch arguments, Windows shim resolution and duplicate directory requests')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>delete global.window)
