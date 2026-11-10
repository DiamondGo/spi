const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),tar=require('tar')
const {execFileSync}=require('node:child_process')
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
execFileSync(process.execPath,[path.join(__dirname,'distribution.cjs'),'prepare'],{stdio:'inherit'})
const api=require('../dist/npm-package/dist/spi.cjs'), platform=process.platform+'-'+process.arch
const routes=new Map();let count=0
async function check(name,fn){await fn();console.log('PASS',name);count++}
async function fixture(v){
  const dir=path.join(tmp,'fixture-'+v);fs.mkdirSync(path.join(dir,'app/resources'),{recursive:true})
  fs.writeFileSync(path.join(dir,'app/spi'),'#!/bin/sh\nexec '+JSON.stringify(process.execPath)+' "$@"\n',{mode:0o755})
  fs.writeFileSync(path.join(dir,'app/resources/spi-permission-extension.mjs'),'// deterministic test fixture\n')
  const file='spi-'+v+'-'+platform+'.tar.gz', archive=path.join(tmp,file)
  await tar.c({cwd:dir,file:archive,gzip:true,portable:true},['app'])
  const item={file,size:fs.statSync(archive).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),entry:'app/spi',permissionExtension:'app/resources/spi-permission-extension.mjs'}
  const manifest={schemaVersion:1,version:v,targets:{[platform]:item}}, mf=path.join(tmp,v+'.json')
  fs.writeFileSync(mf,JSON.stringify(manifest));routes.set('/v'+v+'/'+file,fs.readFileSync(archive));routes.set('/v'+v+'/release-manifest.json',Buffer.from(JSON.stringify(manifest)))
  return {v,archive,manifest:mf,item}
}
const server=http.createServer((req,res)=>{const data=routes.get(req.url);if(!data){res.writeHead(404);res.end();return}res.setHeader('Content-Length',data.length);res.end(data)})
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
  await check('postinstall only recognizes an explicit personal Pi npm prefix',()=>{
    const saved={...process.env};try{
      const agent=path.join(tmp,'agent');fs.mkdirSync(path.join(agent,'npm'),{recursive:true})
      process.env.PI_CODING_AGENT_DIR=agent;process.env.npm_config_local_prefix=path.join(agent,'npm');delete process.env.CI;delete process.env.SPI_SKIP_INSTALL
      assert.equal(api.personalInstall(),true)
      process.env.npm_config_local_prefix=path.join(tmp,'project','.pi','npm');assert.equal(api.personalInstall(),false)
      process.env.npm_config_local_prefix=path.join(agent,'npm');process.env.SPI_SKIP_INSTALL='1';assert.equal(api.personalInstall(),false)
    }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved)}
  })
  console.log('RESULT PASS',count,'checks',tmp)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close())
