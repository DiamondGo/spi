const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),tar=require('tar')
const {execFileSync,spawn,spawnSync}=require('node:child_process')
const yazl=require('yazl')
async function makeZip(file,badLink=false){
  const zip=new yazl.ZipFile(),out=fs.createWriteStream(file)
  zip.addBuffer(Buffer.from('binary fixture'),'app/spi',{mode:0o755})
  zip.addBuffer(Buffer.from('// resource'),'app/resources/spi-permission-extension.mjs')
  zip.addBuffer(Buffer.from(badLink?'../../escape':'spi'),'app/link',{mode:0o120777})
  const done=new Promise((resolve,reject)=>{out.once('close',resolve);out.once('error',reject);zip.outputStream.once('error',reject)})
  zip.outputStream.pipe(out);zip.end();await done
}
const root=path.resolve(__dirname,'..'), tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-installer-test-'))
// Default: test the real bundled installer from `distribution prepare`. SPI_INSTALLER_TEST_SOURCE=1 tests the
// source module directly without touching the shared dist/ directory.
const fromSource=process.env.SPI_INSTALLER_TEST_SOURCE==='1'
if(!fromSource)execFileSync(process.execPath,[path.join(__dirname,'distribution.cjs'),'prepare'],{stdio:'inherit'})
const cliFile=fromSource?path.join(root,'packages/pi-spi/lib/installer.cjs'):path.join(root,'dist/npm-package/dist/spi.cjs')
const api=require(cliFile), platform=process.platform+'-'+process.arch
const routes=new Map(),dynamic=new Map(),requests=[];let count=0
async function check(name,fn){await fn();console.log('PASS',name);count++}
async function fixture(v,helper){
  const dir=path.join(tmp,'fixture-'+v);fs.mkdirSync(path.join(dir,'app/resources'),{recursive:true})
  fs.writeFileSync(path.join(dir,'app/spi'),'#!/bin/sh\nexec '+JSON.stringify(process.execPath)+' "$@"\n',{mode:0o755})
  fs.writeFileSync(path.join(dir,'app/resources/spi-permission-extension.mjs'),'// deterministic test fixture\n')
  fs.writeFileSync(path.join(dir,'app/resources/icon.png'),Buffer.from('89504e470d0a1a0a','hex'))
  if(helper!==undefined)fs.writeFileSync(path.join(dir,'app/resources/spi-installer.cjs'),helper)
  const file='spi-'+v+'-'+platform+'.tar.gz', archive=path.join(tmp,file)
  await tar.c({cwd:dir,file:archive,gzip:true,portable:true},['app'])
  const item={file,size:fs.statSync(archive).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),entry:'app/spi',permissionExtension:'app/resources/spi-permission-extension.mjs'}
  if(helper!==undefined)item.installerSha256=crypto.createHash('sha256').update(helper).digest('hex')
  const manifest={schemaVersion:1,version:v,targets:{[platform]:item}}, mf=path.join(tmp,v+'.json')
  fs.writeFileSync(mf,JSON.stringify(manifest));routes.set('/v'+v+'/'+file,fs.readFileSync(archive));routes.set('/v'+v+'/release-manifest.json',Buffer.from(JSON.stringify(manifest)))
  return {v,archive,manifest:mf,item}
}
const server=http.createServer((req,res)=>{requests.push({url:req.url,accept:req.headers.accept});const handler=dynamic.get(req.url);if(handler)return handler(req,res);const data=routes.get(req.url);if(!data){res.writeHead(404);res.end();return}res.setHeader('Content-Length',data.length);res.end(data)})
;(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  process.env.SPI_ALLOW_TEST_HTTP='1';process.env.SPI_RELEASE_BASE_URL='http://127.0.0.1:'+server.address().port
  const a=await fixture('0.1.0'), b=await fixture('0.2.0')
  let seq=0
  const opts=()=>({installDir:path.join(tmp,'install '+(++seq)),binDir:path.join(tmp,'bin '+seq),version:a.v,archive:a.archive,manifest:a.manifest})
  await check('path/entry validation rejects traversal, absolute paths, duplicates and link ancestors',()=>{
    const bad=[[{name:'../outside',type:'file',size:1}],[{name:'/app/x',type:'file',size:0}],[{name:'app/x',type:'file',size:0},{name:'app/x',type:'file',size:0}],[{name:'app/a',type:'symlink',size:0,link:'../..'},{name:'app/a/file',type:'file',size:1}],[{name:'app/x',type:'unsupported',size:0}],[{name:'app/link',type:'hardlink',size:0,link:'/outside'}]]
    for(const entries of bad)assert.throws(()=>api.validateEntries(entries))
    api.validateEntries([{name:'app/a',type:'file',size:1},{name:'app/link',type:'symlink',size:0,link:'a'}])
  })
  await check('ZIP extraction preserves executable bits/internal symlinks and refuses escaping links before writing',async()=>{
    const good=path.join(tmp,'good.zip'),bad=path.join(tmp,'bad.zip'),dest=path.join(tmp,'zip-out'),rejected=path.join(tmp,'zip-rejected')
    fs.mkdirSync(dest);fs.mkdirSync(rejected);await makeZip(good);await makeZip(bad,true)
    if(process.platform!=='win32'){
      await api.extractZip(good,dest);assert.equal(fs.readlinkSync(path.join(dest,'app/link')),'spi');assert.ok(fs.statSync(path.join(dest,'app/spi')).mode&0o100)
    }
    await assert.rejects(api.extractZip(bad,rejected));assert.equal(fs.readdirSync(rejected).length,0)
  })
  await check('ZIP and tar links stay contained when the destination parent has a canonical alias',async()=>{
    if(process.platform==='win32')return
    const real=path.join(tmp,'canonical-parent'),alias=path.join(tmp,'parent-alias');fs.mkdirSync(real);fs.symlinkSync(real,alias,'dir')
    const zip=path.join(tmp,'alias.zip'),zipDest=path.join(alias,'zip');fs.mkdirSync(zipDest);await makeZip(zip);await api.extractZip(zip,zipDest)
    assert.equal(fs.realpathSync(path.join(zipDest,'app/link')),path.join(fs.realpathSync(zipDest),'app/spi'))
    const source=path.join(tmp,'alias-tar-source');fs.mkdirSync(path.join(source,'app'),{recursive:true});fs.writeFileSync(path.join(source,'app/spi'),'fixture');fs.symlinkSync('spi',path.join(source,'app/link'))
    const archive=path.join(tmp,'alias.tar.gz'),tarDest=path.join(alias,'tar');fs.mkdirSync(tarDest);await tar.c({cwd:source,file:archive,gzip:true},['app']);await api.extractTar(archive,tarDest)
    assert.equal(fs.readFileSync(path.join(tarDest,'app/link'),'utf8'),'fixture')
    const bad=path.join(tmp,'alias-bad.zip'),badDest=path.join(alias,'rejected');fs.mkdirSync(badDest);await makeZip(bad,true)
    await assert.rejects(api.extractZip(bad,badDest));assert.equal(fs.readdirSync(badDest).length,0)
  })
  await check('tar escaping links are rejected before extraction',async()=>{
    if(process.platform==='win32')return
    const source=path.join(tmp,'bad-tar'),dest=path.join(tmp,'bad-tar-out');fs.mkdirSync(path.join(source,'app'),{recursive:true});fs.mkdirSync(dest)
    fs.symlinkSync('../../outside',path.join(source,'app/link'))
    const file=path.join(tmp,'bad.tar.gz');await tar.c({cwd:source,file,gzip:true},['app'])
    await assert.rejects(api.extractTar(file,dest));assert.equal(fs.readdirSync(dest).length,0)
  })
  await check('option parser rejects invalid flags and missing values',()=>{
    assert.throws(()=>api.parse(['--bin-dir']));assert.throws(()=>api.parse(['--unknown']));assert.throws(()=>api.parse(['install','uninstall']))
    assert.equal(api.parse(['--version']).command,'version')
  })
  await check('local install preserves whitespace paths and provides a standalone command',async()=>{
    const o=opts();await api.install(o);assert.equal(api.readCurrent(o.installDir).version,a.v)
    if(process.platform!=='win32')assert.equal(execFileSync(path.join(o.binDir,'spi'),['--version'],{encoding:'utf8'}).trim(),a.v)
    await api.install(o);assert.equal(api.readCurrent(o.installDir).version,a.v)
  })
  await check('update and rollback switch complete versions without deleting the old runtime',async()=>{
    const o=opts();await api.install(o);await api.install({...o,version:b.v,archive:b.archive,manifest:b.manifest})
    assert.equal(api.readCurrent(o.installDir).version,b.v);await api.rollback(o);assert.equal(api.readCurrent(o.installDir).version,a.v)
    assert.ok(fs.existsSync(path.join(o.installDir,'releases',b.v,platform)))
  })
  await check('the verified new bundled installer replaces the old launcher; helper checksum failures preserve selection',async()=>{
    const o=opts();await api.install(o)
    const next=await fixture('0.2.1','// verified next-release installer fixture\n')
    const invalid=JSON.parse(fs.readFileSync(next.manifest));invalid.targets[platform].installerSha256='0'.repeat(64)
    const bad=path.join(tmp,'bad-helper.json');fs.writeFileSync(bad,JSON.stringify(invalid))
    await assert.rejects(api.install({...o,version:next.v,archive:next.archive,manifest:bad}),/Bundled installer checksum/)
    assert.equal(api.readCurrent(o.installDir).version,a.v)
    await api.install({...o,version:next.v,archive:next.archive,manifest:next.manifest})
    assert.equal(fs.readFileSync(path.join(o.installDir,'launcher/spi.cjs'),'utf8'),'// verified next-release installer fixture\n')
    const state=JSON.parse(fs.readFileSync(path.join(o.installDir,'install-state.json')))
    assert.equal(state.launcher.sha256,next.item.installerSha256)
  })
  await check('bad hash, bad size and missing targets do not break an existing installation',async()=>{
    const o=opts();await api.install(o)
    for(const change of [m=>m.targets[platform].sha256='0'.repeat(64),m=>m.targets[platform].size++,m=>delete m.targets[platform]]){
      const m=JSON.parse(fs.readFileSync(b.manifest));change(m);const file=path.join(tmp,'invalid.json');fs.writeFileSync(file,JSON.stringify(m))
      await assert.rejects(api.install({...o,version:b.v,archive:b.archive,manifest:file}));assert.equal(api.readCurrent(o.installDir).version,a.v)
      assert.ok(!fs.existsSync(path.join(o.installDir,'.install.lock')))
    }
  })
  await check('unknown spi command is never overwritten and failed registration is recoverable',async()=>{
    const o=opts();fs.mkdirSync(o.binDir);const command=path.join(o.binDir,process.platform==='win32'?'spi.cmd':'spi');fs.writeFileSync(command,'USER FILE')
    await assert.rejects(api.install(o),/overwrite/);assert.equal(fs.readFileSync(command,'utf8'),'USER FILE')
    await api.install({...o,binDir:path.join(tmp,'alternate-bin')})
  })
  await check('modified managed commands are not removed by uninstall',async()=>{
    const o=opts();await api.install(o);const command=path.join(o.binDir,process.platform==='win32'?'spi.cmd':'spi');fs.appendFileSync(command,'\n# user change')
    await assert.rejects(api.uninstall(o),/modified/);assert.ok(fs.existsSync(command));assert.equal(api.readCurrent(o.installDir).version,a.v)
  })
  await check('uninstall preserves unrelated root files and user preferences',async()=>{
    const o=opts();await api.install(o);fs.writeFileSync(path.join(o.installDir,'user-file'),'keep')
    await api.uninstall(o);assert.equal(fs.readFileSync(path.join(o.installDir,'user-file'),'utf8'),'keep')
    assert.ok(!fs.existsSync(path.join(o.binDir,process.platform==='win32'?'spi.cmd':'spi')))
  })
  await check('uninstall refuses a tracked live application instead of killing it',async()=>{
    const o=opts();await api.install(o);fs.mkdirSync(path.join(o.installDir,'.running'))
    let start=null;if(process.platform==='linux'){const s=fs.readFileSync('/proc/self/stat','utf8');start=s.slice(s.lastIndexOf(')')+2).split(' ')[19]}
    fs.writeFileSync(path.join(o.installDir,'.running/test.json'),JSON.stringify({pid:process.pid,start}))
    await assert.rejects(api.uninstall(o),/Close the running/);assert.equal(api.readCurrent(o.installDir).version,a.v)
  })
  await check('installation locks prevent concurrent mutation without removing another lock',async()=>{
    const o=opts();await api.install(o);fs.mkdirSync(path.join(o.installDir,'.install.lock'))
    await assert.rejects(api.install(o),/Another install/);assert.ok(fs.existsSync(path.join(o.installDir,'.install.lock')))
  })
  // ---- Crash-safe lock recovery ----
  const OWNER_ID='sPi-installer-v1',UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  const deadPid=()=>{const r=spawnSync(process.execPath,['-e','0']);assert.ok(r.pid>0);return r.pid}
  const lockRec=(over={})=>({schema:1,owner:OWNER_ID,token:crypto.randomUUID(),...api.internals.identity(process.pid),created:new Date().toISOString(),...over})
  const deadRec=(over={})=>lockRec({pid:deadPid(),start:null,...over})
  const lockPath=o=>path.join(o.installDir,'.install.lock'),tombs=o=>{const d=path.join(o.installDir,'.retired-install-locks');return fs.existsSync(d)?fs.readdirSync(d).sort():[]}
  const plant=(o,rec)=>{const l=lockPath(o);fs.mkdirSync(l);if(rec)fs.writeFileSync(path.join(l,'owner.json'),JSON.stringify(rec));return l}
  const stageNames=o=>fs.readdirSync(o.installDir).filter(n=>n.startsWith('.staging-'))
  const plantStage=(o,token,suffix,marker)=>{const d=path.join(o.installDir,'.staging-'+token+'-'+suffix);fs.mkdirSync(d);fs.writeFileSync(path.join(d,'partial.tar.gz'),'partial');if(marker!==null)fs.writeFileSync(path.join(d,'.spi-stage.json'),JSON.stringify(marker===undefined?{schema:1,owner:OWNER_ID,kind:'stage',token,pid:1}:marker));return d}
  await check('a lock held by a live process (own pid, EPERM or unreadable identity) is never reclaimed',async()=>{
    const o=opts();await api.install(o)
    const rec=lockRec();const l=plant(o,rec);const before=fs.readFileSync(path.join(l,'owner.json'),'utf8')
    await assert.rejects(api.install(o),/Another install is active/);assert.equal(fs.readFileSync(path.join(l,'owner.json'),'utf8'),before);assert.deepEqual(tombs(o),[])
    // EPERM means the process exists but belongs to someone else: live, not dead.
    const saved=api.internals.kill;fs.rmSync(l,{recursive:true})
    try{
      api.internals.kill=()=>{throw Object.assign(new Error('EPERM'),{code:'EPERM'})}
      plant(o,{...rec,pid:deadPid(),start:null});await assert.rejects(api.install(o),/Another install is active/);assert.ok(fs.existsSync(l));assert.deepEqual(tombs(o),[])
      // Any other probe failure is unknown, hence also fail-closed.
      api.internals.kill=()=>{throw Object.assign(new Error('EINVAL'),{code:'EINVAL'})}
      await assert.rejects(api.install(o),/Another install is active/);assert.ok(fs.existsSync(l))
    }finally{api.internals.kill=saved}
    // A live lock from another host / PID namespace / unknown pid namespace cannot be judged and is kept.
    if(process.platform==='linux'){
      for(const over of [{host:'some-other-host'},{pidns:'pid:[1]'}]){fs.rmSync(l,{recursive:true});plant(o,{...deadRec(),...over});await assert.rejects(api.install(o),/Another install is active/);assert.ok(fs.existsSync(l))}
    }
    fs.rmSync(l,{recursive:true});await api.install(o)
  })
  await check('Linux PID reuse (same pid, different process start time) or a previous boot is a dead owner',async()=>{
    if(process.platform!=='linux')return
    const o=opts();await api.install(o)
    const reuse=lockRec({start:'1'});plant(o,reuse);await api.install(o);assert.deepEqual(tombs(o),[reuse.token]);assert.ok(!fs.existsSync(lockPath(o)))
    const boot=lockRec({boot:'00000000-0000-0000-0000-000000000000'});plant(o,boot);await api.install(o);assert.deepEqual(tombs(o),[reuse.token,boot.token].sort())
    // Matching identity (this very process) stays live.
    const same=lockRec();plant(o,same);await assert.rejects(api.install(o),/Another install/);assert.ok(fs.existsSync(lockPath(o)))
  })
  await check('a dead owner lock is retired once and only its marked stage directories are cleaned',async()=>{
    const o=opts();await api.install(o);const dead=deadRec();plant(o,dead)
    const owned=plantStage(o,dead.token,'abc123'),ownedEmpty=path.join(o.installDir,'.staging-'+dead.token+'-empty1'),unmarked=plantStage(o,dead.token,'unmark',null)
    fs.mkdirSync(ownedEmpty)
    const mismatch=plantStage(o,dead.token,'wrongT',{schema:1,owner:OWNER_ID,kind:'stage',token:crypto.randomUUID()}),otherOwner=plantStage(o,dead.token,'wrongO',{schema:1,owner:'someone',kind:'stage',token:dead.token})
    const foreignTok=crypto.randomUUID(),foreign=plantStage(o,foreignTok,'other1')                         // marked, but its lock token was never retired
    const legacy=path.join(o.installDir,'.staging-AbC123'),user=path.join(o.installDir,'.staging-mine');for(const d of [legacy,user]){fs.mkdirSync(d);fs.writeFileSync(path.join(d,'keep'),'keep')}
    const unrelated=path.join(o.installDir,'my-folder');fs.mkdirSync(unrelated);fs.writeFileSync(path.join(unrelated,'keep'),'keep')
    const outside=path.join(tmp,'sweep-outside-'+seq);fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep'),'keep')
    const link=path.join(o.installDir,'.staging-'+dead.token+'-symlnk');fs.symlinkSync(outside,link,'dir')
    await api.install(o)
    assert.deepEqual(tombs(o),[dead.token]);assert.ok(!fs.existsSync(lockPath(o)))
    const tomb=path.join(o.installDir,'.retired-install-locks',dead.token,'owner.json');assert.equal(JSON.parse(fs.readFileSync(tomb,'utf8')).token,dead.token)
    for(const gone of [owned,ownedEmpty])assert.ok(!fs.existsSync(gone),gone)
    for(const kept of [unmarked,mismatch,otherOwner,foreign,legacy,user,unrelated,outside])assert.ok(fs.existsSync(kept),kept)
    assert.equal(fs.readFileSync(path.join(outside,'keep'),'utf8'),'keep');assert.ok(fs.lstatSync(link).isSymbolicLink());assert.equal(fs.readFileSync(path.join(legacy,'keep'),'utf8'),'keep')
    assert.equal(api.readCurrent(o.installDir).version,a.v)
  })
  await check('legacy, ownerless and malformed locks fail closed and are never removed',async()=>{
    const o=opts();await api.install(o);const l=lockPath(o)
    const bad=[null,{},{...deadRec(),schema:2},{...deadRec(),owner:'other'},{...deadRec(),token:'not-a-uuid'},{...deadRec(),pid:0},{...deadRec(),pid:'7'},'garbage']
    for(const rec of bad){
      fs.mkdirSync(l);fs.writeFileSync(path.join(l,'canary'),'keep');if(rec!==null)fs.writeFileSync(path.join(l,'owner.json'),typeof rec==='string'?rec:JSON.stringify(rec))
      await assert.rejects(api.install(o),/Another install is active/);assert.equal(fs.readFileSync(path.join(l,'canary'),'utf8'),'keep');assert.deepEqual(tombs(o),[]);fs.rmSync(l,{recursive:true})
    }
    fs.mkdirSync(l);fs.writeFileSync(path.join(l,'owner.json'),'x'.repeat(5000));await assert.rejects(api.install(o),/Another install/);assert.ok(fs.existsSync(l));fs.rmSync(l,{recursive:true})
    fs.writeFileSync(l,'a file');await assert.rejects(api.install(o),/not a directory/);assert.equal(fs.readFileSync(l,'utf8'),'a file');fs.rmSync(l)
    for(const op of [()=>api.rollback(o),()=>api.uninstall(o)]){fs.mkdirSync(l);await assert.rejects(op(),/Another install/);fs.rmSync(l,{recursive:true})}
    await api.install(o)
  })
  await check('symlinked lock directories, lock metadata and retired-lock directories are refused without touching their targets',async()=>{
    if(process.platform==='win32')return
    const o=opts();await api.install(o);const l=lockPath(o),target=path.join(tmp,'lock-link-target-'+seq)
    fs.mkdirSync(target);fs.writeFileSync(path.join(target,'owner.json'),JSON.stringify(deadRec()));fs.writeFileSync(path.join(target,'keep'),'keep')
    fs.symlinkSync(target,l,'dir');await assert.rejects(api.install(o),/symlink install lock/);assert.ok(fs.lstatSync(l).isSymbolicLink());fs.unlinkSync(l)
    const meta=path.join(tmp,'owner-link-'+seq+'.json');fs.writeFileSync(meta,JSON.stringify(deadRec()));fs.mkdirSync(l);fs.symlinkSync(meta,path.join(l,'owner.json'))
    await assert.rejects(api.install(o),/symlink install lock metadata/);assert.ok(fs.existsSync(meta));assert.deepEqual(tombs(o),[]);fs.rmSync(l,{recursive:true})
    const dead=deadRec(),retired=path.join(o.installDir,'.retired-install-locks'),elsewhere=path.join(tmp,'retired-elsewhere-'+seq);fs.mkdirSync(elsewhere);fs.symlinkSync(elsewhere,retired,'dir')
    plant(o,dead);await assert.rejects(api.install(o),/unsafe retired-lock/);assert.ok(fs.existsSync(path.join(l,'owner.json')));assert.deepEqual(fs.readdirSync(elsewhere),[]);fs.rmSync(l,{recursive:true});fs.unlinkSync(retired)
    await api.install(o)
  })
  await check('a delayed stale contender can never retire a lock that was recreated after the token was retired',async()=>{
    const o=opts();await api.install(o);const dead=deadRec();plant(o,dead)
    assert.equal(api.internals.retireLock(o.installDir,dead.token),true);assert.ok(!fs.existsSync(lockPath(o)))
    assert.equal(api.internals.retireLock(o.installDir,dead.token),false)      // nothing there
    const live=lockRec();plant(o,live)                                         // a new live install takes the lock
    assert.equal(api.internals.retireLock(o.installDir,dead.token),false)      // stale contender: tombstone already exists
    assert.equal(JSON.parse(fs.readFileSync(path.join(lockPath(o),'owner.json'),'utf8')).token,live.token);assert.deepEqual(tombs(o),[dead.token])
    assert.throws(()=>api.internals.retireLock(o.installDir,'../escape'),/Invalid install lock token/)
    await assert.rejects(api.install(o),/Another install/);assert.equal(JSON.parse(fs.readFileSync(path.join(lockPath(o),'owner.json'),'utf8')).token,live.token)
  })
  await check('concurrent installer processes reclaiming the same dead lock retire it exactly once and leave a consistent install',async()=>{
    const o=opts();await api.install(o);const dead=deadRec();plant(o,dead)
    const args=['install','--version',a.v,'--install-dir',o.installDir,'--bin-dir',o.binDir,'--archive',a.archive,'--manifest',a.manifest]
    const runCli=args=>new Promise(resolve=>require('node:child_process').execFile(process.execPath,[cliFile,...args],{timeout:60000},(error,stdout,stderr)=>resolve({code:error?(error.code??1):0,stdout,stderr})))
    const results=await Promise.all(Array.from({length:6},()=>runCli(args)))
    for(const r of results)assert.ok(r.code===0||/Another install is active/.test(r.stderr),r.stderr)
    assert.ok(results.some(r=>r.code===0),results.map(r=>r.stderr).join('|'))
    assert.deepEqual(tombs(o),[dead.token]);assert.ok(!fs.existsSync(lockPath(o)));assert.deepEqual(stageNames(o),[]);assert.equal(api.readCurrent(o.installDir).version,a.v)
  })
  const stalls=[]
  async function stalledInstall(o){
    let hit;const hitP=new Promise(r=>hit=r)
    dynamic.set('/v'+a.v+'/'+a.item.file,(req,res)=>{res.writeHead(200,{'Content-Length':a.item.size});res.write('x');stalls.push(res);hit()})
    const child=spawn(process.execPath,[cliFile,'install','--version',a.v,'--install-dir',o.installDir,'--bin-dir',o.binDir],{stdio:'ignore'})
    const exited=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})))
    await Promise.race([hitP,exited.then(x=>{throw new Error('installer exited early '+JSON.stringify(x))})])
    return {child,exited}
  }
  await check('SIGTERM during a download releases the lock and stage; SIGKILL leaves a lock that the next install recovers',async()=>{
    if(process.platform==='win32')return
    const o=opts()
    try{
      let run1=await stalledInstall(o);assert.ok(fs.existsSync(lockPath(o)));assert.equal(stageNames(o).length,1)
      run1.child.kill('SIGTERM');assert.deepEqual(await run1.exited,{code:143,signal:null})
      assert.ok(!fs.existsSync(lockPath(o)));assert.deepEqual(stageNames(o),[]);assert.ok(!fs.existsSync(path.join(o.installDir,'current.json')))
      run1=await stalledInstall(o);const token=JSON.parse(fs.readFileSync(path.join(lockPath(o),'owner.json'),'utf8')).token;assert.match(token,UUID_RE)
      const stage=stageNames(o)[0];assert.ok(stage.startsWith('.staging-'+token+'-'));assert.equal(JSON.parse(fs.readFileSync(path.join(o.installDir,stage,'.spi-stage.json'),'utf8')).token,token)
      run1.child.kill('SIGKILL');assert.equal((await run1.exited).signal,'SIGKILL')
      assert.ok(fs.existsSync(lockPath(o)));assert.equal(stageNames(o).length,1)
      const unrelated=path.join(o.installDir,'.staging-user-dir');fs.mkdirSync(unrelated)
      dynamic.delete('/v'+a.v+'/'+a.item.file)
      await api.install({...o,archive:a.archive,manifest:a.manifest})
      assert.ok(!fs.existsSync(lockPath(o)));assert.deepEqual(tombs(o),[token]);assert.deepEqual(stageNames(o),['.staging-user-dir']);assert.equal(api.readCurrent(o.installDir).version,a.v)
    }finally{dynamic.delete('/v'+a.v+'/'+a.item.file);for(const r of stalls.splice(0))r.destroy()}
  })
  await check('closed stdout/stderr pipes (EPIPE) do not abandon the install lock',async()=>{
    if(process.platform==='win32')return
    const o=opts(),child=spawn(process.execPath,[cliFile,'install','--version',a.v,'--install-dir',o.installDir,'--bin-dir',o.binDir,'--archive',a.archive,'--manifest',a.manifest],{stdio:['ignore','pipe','pipe']})
    child.stdout.destroy();child.stderr.destroy()
    const code=await new Promise(r=>child.once('exit',c=>r(c)));assert.equal(code,0)
    assert.ok(!fs.existsSync(lockPath(o)));assert.deepEqual(stageNames(o),[]);assert.equal(api.readCurrent(o.installDir).version,a.v)
  })
  await check('arbitrary occupied roots, symlink roots and HOME cannot be used as install roots',async()=>{
    const o=opts();fs.mkdirSync(o.installDir);fs.writeFileSync(path.join(o.installDir,'foreign'),'keep')
    await assert.rejects(api.install(o),/not empty/);assert.throws(()=>api.rootFor({installDir:os.homedir()}))
    if(process.platform!=='win32'){const link=path.join(tmp,'symlink-root');fs.symlinkSync(o.installDir,link);assert.throws(()=>api.rootFor({installDir:link}))}
  })
  await check('loopback network release installs from a pinned manifest with no compile step',async()=>{
    const o=opts();delete o.archive;delete o.manifest;await api.install(o);assert.equal(api.readCurrent(o.installDir).version,a.v)
  })
  await check('HTTP errors preserve an existing installation and clean staging/locks',async()=>{
    const o=opts();await api.install(o)
    await assert.rejects(api.install({...o,version:'8.8.8',archive:undefined,manifest:undefined}),/HTTP 404/)
    assert.equal(api.readCurrent(o.installDir).version,a.v);assert.ok(!fs.readdirSync(o.installDir).some(n=>n.startsWith('.staging-')))
  })
  await check('default Linux desktop icon follows update/rollback and owned uninstall',async()=>{
    if(process.platform!=='linux')return
    const saved=process.env.XDG_DATA_HOME;process.env.XDG_DATA_HOME=path.join(tmp,'desktop data')
    try{
      const o={...opts(),installDir:path.join(process.env.XDG_DATA_HOME,'spi')},file=path.join(process.env.XDG_DATA_HOME,'applications/spi.desktop')
      await api.install(o);assert.ok(fs.readFileSync(file,'utf8').includes('/releases/0.1.0/'))
      await api.install({...o,version:b.v,archive:b.archive,manifest:b.manifest});assert.ok(fs.readFileSync(file,'utf8').includes('/releases/0.2.0/'))
      await api.rollback(o);const original=fs.readFileSync(file,'utf8');assert.ok(original.includes('/releases/0.1.0/'))
      fs.appendFileSync(file,'# user change\n');await assert.rejects(api.uninstall(o),/modified desktop/)
      assert.ok(fs.existsSync(path.join(o.binDir,'spi')))
      fs.writeFileSync(file,original);await api.uninstall(o);assert.ok(!fs.existsSync(file))
    }finally{if(saved===undefined)delete process.env.XDG_DATA_HOME;else process.env.XDG_DATA_HOME=saved}
  })
  await check('unowned Linux desktop entries never prevent CLI install and are not removed',async()=>{
    if(process.platform!=='linux')return
    const saved=process.env.XDG_DATA_HOME;process.env.XDG_DATA_HOME=path.join(tmp,'unowned desktop data')
    try{
      const o={...opts(),installDir:path.join(process.env.XDG_DATA_HOME,'spi')},file=path.join(process.env.XDG_DATA_HOME,'applications/spi.desktop')
      fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'USER ENTRY')
      await api.install(o);assert.equal(fs.readFileSync(file,'utf8'),'USER ENTRY')
      await api.uninstall(o);assert.equal(fs.readFileSync(file,'utf8'),'USER ENTRY')
    }finally{if(saved===undefined)delete process.env.XDG_DATA_HOME;else process.env.XDG_DATA_HOME=saved}
  })
  await check('postinstall only recognizes an explicit personal Pi npm prefix',()=>{
    const saved={...process.env};try{
      const agent=path.join(tmp,'agent');fs.mkdirSync(path.join(agent,'npm'),{recursive:true})
      process.env.PI_CODING_AGENT_DIR=agent;process.env.npm_config_local_prefix=path.join(agent,'npm');delete process.env.CI;delete process.env.SPI_SKIP_INSTALL
      assert.equal(api.personalInstall(),true)
      process.env.npm_config_local_prefix=path.join(tmp,'project','.pi','npm');assert.equal(api.personalInstall(),false)
      process.env.npm_config_local_prefix=path.join(agent,'npm');process.env.SPI_SKIP_INSTALL='1';assert.equal(api.personalInstall(),false)
    }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved)}
  })
  // ---- 0.3.2: GitHub-only update probe, JSON CLI contract, descriptor binding, Mac signature gate ----
  const {execFile}=require('node:child_process')
  process.env.SPI_RELEASE_API_URL=process.env.SPI_RELEASE_BASE_URL+'/api/latest'
  const run=(args,env={})=>new Promise(resolve=>execFile(process.execPath,[cliFile,...args],{env:{...process.env,...env},timeout:60000},(error,stdout,stderr)=>resolve({code:error?(error.code??1):0,stdout,stderr})))
  const layout=t=>t.startsWith('darwin')?{entry:'app/sPi.app/Contents/MacOS/sPi',permissionExtension:'app/sPi.app/Contents/Resources/spi-permission-extension.mjs'}:t.startsWith('win32')?{entry:'app/sPi.exe',permissionExtension:'app/resources/spi-permission-extension.mjs'}:{entry:'app/spi',permissionExtension:'app/resources/spi-permission-extension.mjs'}
  const desc=(v,t,over={})=>({file:'spi-'+v+'-'+t+(t.startsWith('linux')?'.tar.gz':'.zip'),size:1234,sha256:'a'.repeat(64),...layout(t),...(t.startsWith('linux')?{minGlibc:'2.35'}:{}),...over})
  const manifestOf=(v,targets,extra={})=>({schemaVersion:1,version:v,targets,...extra})
  const publish=(v,m)=>routes.set('/v'+v+'/release-manifest.json',Buffer.from(JSON.stringify(m)))
  const setLatest=(tag,over={},status=200)=>dynamic.set('/api/latest',(req,res)=>{
    if(req.headers.accept!=='application/vnd.github+json'){res.writeHead(415,{'Content-Type':'application/json'});res.end('{"message":"Unsupported Media Type"}');return}
    const body=Buffer.from(typeof tag==='string'?JSON.stringify({tag_name:tag,draft:false,prerelease:false,html_url:'https://evil.example/ignored',...over}):JSON.stringify(tag))
    res.writeHead(status,{'Content-Type':'application/json','Content-Length':body.length});res.end(body)
  })
  const all4=v=>Object.fromEntries(['linux-x64','linux-arm64','darwin-arm64','darwin-x64'].map(t=>[t,desc(v,t)]))
  const url='https://github.com/DiamondGo/spi/releases/tag/v'
  await check('SemVer comparison is numeric, handles pre-releases and rejects malformed versions',()=>{
    const order=['0.3.1-alpha','0.3.1-alpha.1','0.3.1-alpha.beta','0.3.1-beta','0.3.1-beta.2','0.3.1-beta.11','0.3.1-rc.1','0.3.1','0.3.2','0.3.10','0.10.0','1.0.0','10.0.0']
    for(let i=0;i<order.length;i++)for(let j=0;j<order.length;j++)assert.equal(api.compareSemver(order[i],order[j]),Math.sign(i-j),order[i]+' vs '+order[j])
    for(const bad of ['01.0.0','1.0','1.0.0.0','v1.0.0','1.0.0+build','1.0.0-','1.0.0-01','','1.0.0 ','9007199254740993.0.0',null,1])assert.equal(api.parseSemver(bad),null,String(bad))
    assert.throws(()=>api.compareSemver('1.0.0','nope'))
  })
  await check('check-update reports a newer exact-tag release for this target with exact request headers and JSON-only stdout',async()=>{
    publish('9.1.0',manifestOf('9.1.0',all4('9.1.0')));setLatest('v9.1.0');requests.length=0
    const r=await run(['check-update','--current-version','0.3.1','--json'])
    assert.equal(r.code,0,r.stderr);assert.equal(r.stderr,'');assert.ok(r.stdout.endsWith('\n')&&r.stdout.trim().split('\n').length===1)
    const item=desc('9.1.0',platform)
    assert.deepEqual(JSON.parse(r.stdout),{currentVersion:'0.3.1',version:'9.1.0',available:true,target:platform,supported:true,releaseUrl:url+'9.1.0',file:item.file,size:item.size})
    assert.deepEqual(requests.map(x=>[x.url,x.accept]),[['/api/latest','application/vnd.github+json'],['/v9.1.0/release-manifest.json','application/octet-stream']])
  })
  await check('only a strictly newer stable release is available: equal, older (downgrade) and pre-release current versions',async()=>{
    publish('9.1.0',manifestOf('9.1.0',all4('9.1.0')));setLatest('v9.1.0')
    for(const [current,available] of [['9.1.0',false],['9.2.0',false],['10.0.0',false],['9.1.0-rc.1',true],['9.0.99',true],['0.3.2',true]]){
      requests.length=0;const r=await run(['check-update','--current-version',current,'--json']);assert.equal(r.code,0,r.stderr)
      const out=JSON.parse(r.stdout);assert.equal(out.available,available,current);assert.equal(out.version,'9.1.0');assert.equal(out.currentVersion,current);assert.equal(out.releaseUrl,url+'9.1.0')
      if(!available){assert.deepEqual(requests.map(x=>x.url),['/api/latest']);assert.equal(out.file,undefined);assert.equal(out.supported,true)}
    }
  })
  await check('pre-release, draft and malformed latest metadata are never offered; failures are concise and non-zero',async()=>{
    publish('9.3.0',manifestOf('9.3.0',all4('9.3.0')))
    for(const [tag,over] of [['v9.3.0-rc.1',{}],['v9.3.0',{prerelease:true}],['v9.3.0',{draft:true}],['v9.3.0',{prerelease:undefined}],['9.3.0',{}],['v09.3.0',{}],['v9.3',{}],['v9.3.0+build',{}],[null,{}],[{tag_name:'v9.3.0'},{}],[['v9.3.0'],{}]]){
      setLatest(tag,over);const r=await run(['check-update','--current-version','0.3.1','--json'])
      assert.notEqual(r.code,0,JSON.stringify([tag,over]));assert.equal(r.stdout,'');assert.match(r.stderr,/^sPi: Latest release metadata is invalid\n$/)
    }
    setLatest('v9.3.0',{},500);let r=await run(['check-update','--current-version','0.3.1','--json']);assert.notEqual(r.code,0);assert.equal(r.stdout,'');assert.match(r.stderr,/^sPi: Download failed: HTTP 500\n$/)
    dynamic.set('/api/latest',(req,res)=>{res.end('not json')});r=await run(['check-update','--current-version','0.3.1','--json']);assert.notEqual(r.code,0);assert.equal(r.stdout,'');assert.equal(r.stderr.trim().split('\n').length,1)
    dynamic.delete('/api/latest');r=await run(['check-update','--current-version','0.3.1','--json']);assert.notEqual(r.code,0);assert.match(r.stderr,/HTTP 404/)
  })
  await check('an unreachable release service exits non-zero with one concise stderr line and no JSON',async()=>{
    const dead=await new Promise(resolve=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})})
    const r=await run(['check-update','--current-version','0.3.1','--json'],{SPI_RELEASE_API_URL:'http://127.0.0.1:'+dead+'/api/latest'})
    assert.notEqual(r.code,0);assert.equal(r.stdout,'');assert.match(r.stderr,/^sPi: [^\n]+\n$/);assert.ok(!r.stderr.includes(tmp))
  })
  await check('a target absent from the exact-tag manifest is reported unsupported without losing version/availability',async()=>{
    const targets=all4('9.4.0');delete targets[platform];publish('9.4.0',manifestOf('9.4.0',targets));setLatest('v9.4.0')
    const r=await run(['check-update','--current-version','9.3.0','--json']);assert.equal(r.code,0,r.stderr)
    assert.deepEqual(JSON.parse(r.stdout),{currentVersion:'9.3.0',version:'9.4.0',available:true,target:platform,supported:false,releaseUrl:url+'9.4.0'})
    publish('9.4.0',manifestOf('9.4.0',{}));assert.equal(JSON.parse((await run(['check-update','--current-version','9.3.0','--json'])).stdout).supported,false)
  })
  await check('a manifest for the wrong version, schema or malformed target descriptor is rejected rather than reported supported',async()=>{
    setLatest('v9.5.0');const good=desc('9.5.0',platform),other=platform==='linux-x64'?'linux-arm64':'linux-x64'
    const bad=[
      manifestOf('9.4.0',{[platform]:desc('9.4.0',platform)}),{...manifestOf('9.5.0',{[platform]:good}),schemaVersion:2},{schemaVersion:1,version:'9.5.0'},manifestOf('9.5.0',[good]),manifestOf('9.5.0',null),
      ...[{file:desc('9.4.0',platform).file},{file:desc('9.5.0',other).file},{file:'../'+good.file},{file:good.file.replace(/\.tar\.gz$|\.zip$/,'.exe')},{file:'/abs/'+good.file},{file:good.file+'.zip'},{file:undefined},
        {sha256:'g'.repeat(64)},{sha256:'a'.repeat(63)},{sha256:undefined},{size:0},{size:-1},{size:1.5},{size:'1234'},{size:700*1024*1024+1},{size:Number.MAX_SAFE_INTEGER+1},
        {entry:'/app/spi'},{entry:'app/../spi'},{entry:'other/spi'},{entry:'app/other'},{entry:undefined},{permissionExtension:'app/../x.mjs'},{permissionExtension:'../x.mjs'},{permissionExtension:'app/resources/other.mjs'},{permissionExtension:undefined},{minGlibc:'two'}
      ].map(over=>manifestOf('9.5.0',{[platform]:{...good,...over}})),
      ...[null,[],'x',7].map(item=>manifestOf('9.5.0',{[platform]:item}))
    ]
    for(const m of bad){publish('9.5.0',m);const r=await run(['check-update','--current-version','9.4.0','--json']);assert.notEqual(r.code,0,JSON.stringify(m).slice(0,160));assert.equal(r.stdout,'');assert.match(r.stderr,/^sPi: Invalid (release manifest|glibc baseline)\n$/)}
  })
  await check('descriptor validation binds every supported target to its own file, layout and platform archive type',()=>{
    for(const v of ['0.3.2','1.2.3']){const m=manifestOf(v,{...all4(v),'win32-x64':desc(v,'win32-x64')});for(const t of Object.keys(m.targets))assert.equal(api.validateDescriptor(m,v,t),m.targets[t],t)}
    const m=manifestOf('0.3.2',all4('0.3.2'));assert.equal(api.validateDescriptor(m,'0.3.2','win32-arm64'),null);assert.equal(api.validateDescriptor(m,'0.3.2','linux-ppc64'),null)
    assert.equal(api.validateDescriptor(manifestOf('0.3.2',{}),'0.3.2','linux-x64'),null)
    // Linux is only ever a tar.gz, Mac only ever a zip; targets cannot borrow each other's archives.
    assert.throws(()=>api.validateDescriptor(manifestOf('0.3.2',{'darwin-arm64':desc('0.3.2','darwin-arm64',{file:'spi-0.3.2-darwin-arm64.tar.gz'})}),'0.3.2','darwin-arm64'),/Invalid release manifest/)
    assert.throws(()=>api.validateDescriptor(manifestOf('0.3.2',{'linux-x64':desc('0.3.2','linux-x64',{file:'spi-0.3.2-linux-x64.zip'})}),'0.3.2','linux-x64'),/Invalid release manifest/)
    assert.throws(()=>api.validateDescriptor(manifestOf('0.3.2',{'darwin-x64':desc('0.3.2','darwin-arm64')}),'0.3.2','darwin-x64'),/Invalid release manifest/)
    assert.throws(()=>api.validateDescriptor(manifestOf('0.3.2',{'darwin-x64':desc('0.3.2','darwin-x64',layout('linux-x64'))}),'0.3.2','darwin-x64'),/Invalid release manifest/)
    // Own-property lookup only: inherited keys cannot masquerade as targets.
    assert.equal(api.validateDescriptor(JSON.parse('{"schemaVersion":1,"version":"0.3.2","targets":{"__proto__":{"file":"x"}}}'),'0.3.2','linux-x64'),null)
    assert.equal(api.validateDescriptor(manifestOf('0.3.2',{}),'0.3.2','constructor'),null)
  })
  await check('a historical Linux-only 0.3.1-style manifest still validates unchanged for Linux and is unsupported for Mac',()=>{
    const m=manifestOf('0.3.1',{'linux-x64':desc('0.3.1','linux-x64'),'linux-arm64':desc('0.3.1','linux-arm64')});const copy=JSON.stringify(m)
    assert.ok(api.validateDescriptor(m,'0.3.1','linux-arm64'));assert.equal(api.validateDescriptor(m,'0.3.1','darwin-arm64'),null);assert.equal(JSON.stringify(m),copy)
  })
  await check('an invalid or mismatching manifest never disturbs the selected runtime or leaves staging/locks',async()=>{
    const o=opts();await api.install(o);const before=JSON.stringify(api.readCurrent(o.installDir))
    const good=JSON.parse(fs.readFileSync(b.manifest)),item=good.targets[platform]
    for(const change of [m=>m.targets[platform].file='spi-0.2.0-'+(platform==='linux-x64'?'linux-arm64':'linux-x64')+'.tar.gz',m=>m.targets[platform].file='spi-9.9.9-'+platform+'.tar.gz',m=>m.targets[platform].entry='app/../../escape',m=>m.targets[platform].permissionExtension='/etc/passwd',m=>m.version='0.2.1',m=>m.schemaVersion=2,m=>m.targets=null]){
      const m=JSON.parse(JSON.stringify(good));change(m);const file=path.join(tmp,'bad-descriptor.json');fs.writeFileSync(file,JSON.stringify(m))
      await assert.rejects(api.install({...o,version:b.v,archive:b.archive,manifest:file}));assert.equal(JSON.stringify(api.readCurrent(o.installDir)),before)
      assert.ok(!fs.existsSync(path.join(o.installDir,'.install.lock')));assert.ok(!fs.readdirSync(o.installDir).some(n=>n.startsWith('.staging-')))
    }
    assert.ok(item.file.startsWith('spi-0.2.0-'))
  })
  await check('install --json emits exactly the current-runtime JSON on stdout while progress goes to stderr',async()=>{
    const o=opts(),args=['install','--version',a.v,'--install-dir',o.installDir,'--bin-dir',o.binDir,'--json']
    const r=await run(args);assert.equal(r.code,0,r.stderr);assert.equal(r.stdout.trim().split('\n').length,1)
    const out=JSON.parse(r.stdout);assert.deepEqual(out,api.readCurrent(o.installDir));assert.equal(out.version,a.v);assert.equal(out.target,platform);assert.equal(out.entryPath,path.join(o.installDir,out.directory,out.entry))
    assert.match(r.stderr,/Installed sPi 0\.1\.0/);assert.match(r.stderr,/sPi command:/);assert.ok(!r.stdout.includes('Installed'))
    // Without --json the historical stdout is unchanged.
    const plain=await run(['install','--version',a.v,'--install-dir',o.installDir,'--bin-dir',o.binDir]);assert.equal(plain.code,0,plain.stderr);assert.match(plain.stdout,/Installed sPi 0\.1\.0 \(/);assert.match(plain.stdout,/sPi command:/)
  })
  await check('install/check-update option contract: --json needs an exact version and is limited to supported commands',async()=>{
    const o=opts(),base=['--install-dir',o.installDir,'--bin-dir',o.binDir]
    for(const args of [['install','--json',...base],['install','--version','latest','--json',...base],['install','--version','1.2','--json',...base],['install','--version','1.2.3+x','--json',...base]]){const r=await run(args);assert.notEqual(r.code,0,args.join(' '));assert.equal(r.stdout,'')}
    assert.ok(!fs.existsSync(o.installDir))
    for(const args of [['uninstall','--json'],['rollback','--json'],['update','--json'],['install','--current-version','1.0.0'],['check-update','--current-version'],['check-update','--current-version','--json'],['check-update','--current-version','not-a-version','--json'],['check-update','--current-version','1.0','--json']]){const r=await run(args);assert.notEqual(r.code,0,args.join(' '));assert.equal(r.stdout,'')}
    assert.equal(api.parse(['check-update','--current-version','0.3.1','--json']).options.json,true);assert.equal(api.parse(['check-update','--current-version','0.3.1','--json']).options.currentVersion,'0.3.1')
    assert.deepEqual(api.parse(['install','--version','1.2.3']).options,{version:'1.2.3'})
  })
  await check('check-update without --json prints human text; update/install with latest use the GitHub JSON Accept type',async()=>{
    publish('9.6.0',manifestOf('9.6.0',all4('9.6.0')));setLatest('v9.6.0')
    let r=await run(['check-update','--current-version','9.0.0']);assert.equal(r.code,0,r.stderr);assert.match(r.stdout,/sPi 9\.6\.0 is available \(supported\)/)
    r=await run(['check-update','--current-version','9.6.0']);assert.match(r.stdout,/up to date \(9\.6\.0\)/)
    // `spi update` shares the latest-release resolver: no 415 and invalid latest metadata is refused.
    const o=opts();requests.length=0;r=await run(['update','--install-dir',o.installDir,'--bin-dir',o.binDir],{SPI_RELEASE_API_URL:process.env.SPI_RELEASE_API_URL});assert.notEqual(r.code,0)
    assert.equal(requests[0].accept,'application/vnd.github+json');assert.ok(!/415/.test(r.stderr));assert.match(r.stderr,/HTTP 404/)
    setLatest('v9.6.0',{prerelease:true});r=await run(['update','--install-dir',o.installDir,'--bin-dir',o.binDir]);assert.match(r.stderr,/Latest release metadata is invalid/);assert.ok(!fs.existsSync(path.join(o.installDir,'current.json')))
  })
  const macVersion='9.7.0',macTarget='darwin-arm64'
  async function macFixture(v=macVersion,{badLink=false}={}){
    const file=path.join(tmp,'spi-'+v+'-'+macTarget+'.zip'),zip=new yazl.ZipFile(),out=fs.createWriteStream(file)
    zip.addBuffer(Buffer.from('#!/bin/sh\nexit 0\n'),'app/sPi.app/Contents/MacOS/sPi',{mode:0o100755})
    zip.addBuffer(Buffer.from('// ext'),'app/sPi.app/Contents/Resources/spi-permission-extension.mjs',{mode:0o100644})
    if(badLink)zip.addBuffer(Buffer.from('../../../../escape'),'app/sPi.app/Contents/Frameworks/link',{mode:0o120777})
    const done=new Promise((resolve,reject)=>{out.once('close',resolve);out.once('error',reject)});zip.outputStream.pipe(out);zip.end();await done
    const data=fs.readFileSync(file),item=desc(v,macTarget,{size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')}),m=path.join(tmp,'mac-'+v+'.json')
    fs.writeFileSync(m,JSON.stringify(manifestOf(v,{[macTarget]:item})));return {archive:file,manifest:m,version:v}
  }
  await check('Mac runtime is installed only after /usr/bin/codesign --verify --deep --strict passes on the staged app bundle',async()=>{
    const f=await macFixture(),savedTarget=api.internals.target,savedSign=api.internals.codesign,o={...opts(),version:f.version,archive:f.archive,manifest:f.manifest}
    try{
      // Baseline Linux runtime already selected: a failed signature check must not disturb it.
      await api.install({...opts(),installDir:o.installDir,binDir:o.binDir});const before=JSON.stringify(api.readCurrent(o.installDir))
      api.internals.target=()=>macTarget
      let seen=[];api.internals.codesign=bundle=>{seen.push(bundle);throw Object.assign(new Error('codesign failed'),{stderr:Buffer.from('a.app: invalid signature (code or signature have been modified)\nsecond line')})}
      await assert.rejects(api.install(o),/macOS code signature verification failed: a\.app: invalid signature/);assert.equal(seen.length,1);assert.equal(path.basename(seen[0]),'sPi.app');assert.ok(seen[0].startsWith(o.installDir+path.sep))
      assert.equal(JSON.stringify(api.readCurrent(o.installDir)),before);assert.ok(!fs.existsSync(path.join(o.installDir,'releases',f.version)))
      assert.ok(!fs.readdirSync(o.installDir).some(n=>n.startsWith('.staging-')));assert.ok(!fs.existsSync(path.join(o.installDir,'.install.lock')))
      seen=[];api.internals.codesign=bundle=>{seen.push([bundle,fs.existsSync(path.join(bundle,'Contents/MacOS/sPi')),fs.existsSync(path.join(bundle,'Contents/Resources/spi-permission-extension.mjs'))])}
      await api.install(o);assert.equal(seen.length,1);assert.deepEqual(seen[0].slice(1),[true,true])
      const cur=api.readCurrent(o.installDir);assert.equal(cur.version,f.version);assert.equal(cur.target,macTarget);assert.equal(cur.entry,'app/sPi.app/Contents/MacOS/sPi')
    }finally{api.internals.target=savedTarget;api.internals.codesign=savedSign}
  })
  await check('Mac archives with escaping links fail extraction before any signature check or selection',async()=>{
    if(process.platform==='win32')return
    const f=await macFixture('9.7.1',{badLink:true}),saved=[api.internals.target,api.internals.codesign],o={...opts(),version:f.version,archive:f.archive,manifest:f.manifest};let called=false
    try{api.internals.target=()=>macTarget;api.internals.codesign=()=>{called=true}
      await assert.rejects(api.install(o));assert.equal(called,false);assert.ok(!fs.existsSync(path.join(o.installDir,'current.json')))
    }finally{[api.internals.target,api.internals.codesign]=saved}
  })
  await check('signature verification fails closed when codesign is unavailable or errors',()=>{
    assert.throws(()=>api.verifyMacSignature(path.join(tmp,'nonexistent.app')),/macOS code signature verification failed/)
    const saved=api.internals.codesign;try{api.internals.codesign=()=>{throw new Error('boom')};assert.throws(()=>api.verifyMacSignature('x'),/^Error: macOS code signature verification failed$/)}finally{api.internals.codesign=saved}
  })
  console.log('RESULT PASS',count,'checks',tmp)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close())
