// Release/build plumbing: four-target manifest merge, public-asset verification and workflow policy.
// Standalone: needs no dist/ output, network, npm credentials or native runners.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const {RELEASE_TARGETS,config,manifest}=require('./distribution.cjs'),{plan,verify}=require('./verify-release.cjs')
const root=path.resolve(__dirname,'..'),version=config().version,sha='c'.repeat(40),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-release-plumbing-'))
const read=file=>fs.readFileSync(path.join(root,file),'utf8'),sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
let checks=0
function check(name,fn){return Promise.resolve(fn()).then(()=>{checks++;console.log('PASS',name)})}
function fixture(targets=RELEASE_TARGETS){
  const dir=fs.mkdtempSync(path.join(tmp,'release-'))
  for(const target of targets){
    const mac=target.startsWith('darwin'),file='spi-'+version+'-'+target+(target.startsWith('linux')?'.tar.gz':'.zip'),bytes=Buffer.from('archive-'+target)
    fs.writeFileSync(path.join(dir,file),bytes)
    const entry=mac?'app/sPi.app/Contents/MacOS/sPi':'app/spi'
    fs.writeFileSync(path.join(dir,target+'.json'),JSON.stringify({version,target,file,size:bytes.length,sha256:sha256(bytes),installerSha256:sha256('fixture spi-installer.cjs'),securityInventory:{schemaVersion:1,version,policy:version==='0.3.3'?require('./security-policy.cjs').ADVISORY:'no-build-dependencies',scriptsScanned:1,forbiddenModulesAbsent:true,asarSha256:'f'.repeat(64),installerSha256:sha256('fixture spi-installer.cjs')},entry,permissionExtension:mac?'app/sPi.app/Contents/Resources/spi-permission-extension.mjs':'app/resources/spi-permission-extension.mjs'}))
    if(mac)fs.writeFileSync(path.join(dir,'macos-build-'+target+'.txt'),JSON.stringify({target,version,minimumOS:'13.0',signature:'ad-hoc',notarized:false,sourceCommit:sha}))
  }
  for(const name of ['spi-installer.cjs','install.sh','INSTALLER-NOTICES.txt'])fs.writeFileSync(path.join(dir,name),'fixture '+name)
  return dir
}
const release=dir=>manifest({dir,release:true,sourceSha:sha})
function patch(dir,name,change){const file=path.join(dir,name),value=JSON.parse(fs.readFileSync(file));change(value);fs.writeFileSync(file,JSON.stringify(value))}
;(async()=>{
  try{
    await check('canonical release targets are exactly the four supported natives (no Windows)',()=>{
      assert.deepEqual([...RELEASE_TARGETS].sort(),['darwin-arm64','darwin-x64','linux-arm64','linux-x64'])
    })
    await check('four exact-target descriptors merge into one manifest and checksum list',()=>{
      const dir=fixture();release(dir)
      const merged=JSON.parse(fs.readFileSync(path.join(dir,'release-manifest.json')))
      assert.equal(merged.version,version);assert.deepEqual(Object.keys(merged.targets).sort(),[...RELEASE_TARGETS].sort())
      assert.equal(merged.targets['darwin-arm64'].file,'spi-'+version+'-darwin-arm64.zip')
      const sums=fs.readFileSync(path.join(dir,'SHA256SUMS'),'utf8')
      for(const name of ['release-manifest.json','spi-installer.cjs','install.sh','INSTALLER-NOTICES.txt','macos-build-darwin-arm64.txt','macos-build-darwin-x64.txt','spi-'+version+'-linux-x64.tar.gz','spi-'+version+'-darwin-x64.zip'])assert.ok(sums.includes('  '+name+'\n'),name)
      assert.ok(!sums.includes('.json\n')||sums.split('\n').filter(l=>l.endsWith('.json')).every(l=>l.endsWith('  release-manifest.json')))
    })
    await check('a release missing any native target is rejected before publication',()=>{
      for(const missing of RELEASE_TARGETS){const dir=fixture(RELEASE_TARGETS.filter(t=>t!==missing));assert.throws(()=>release(dir),/exactly/,missing)}
    })
    await check('Windows or other extra targets cannot slip into the canonical release',()=>{
      const dir=fixture([...RELEASE_TARGETS,'win32-x64']);assert.throws(()=>release(dir),/exactly/)
    })
    await check('substituted/corrupted archives and descriptor tampering are rejected',()=>{
      let dir=fixture();fs.appendFileSync(path.join(dir,'spi-'+version+'-darwin-x64.zip'),'x');assert.throws(()=>release(dir),/Archive does not match/)
      dir=fixture();patch(dir,'linux-x64.json',d=>{d.file='../escape.tar.gz'});assert.throws(()=>release(dir),/Unexpected archive name/)
      dir=fixture();patch(dir,'linux-arm64.json',d=>{d.entry='/abs/spi'});assert.throws(()=>release(dir),/Unsafe descriptor/)
      dir=fixture();patch(dir,'linux-arm64.json',d=>{d.version='0.0.0'});assert.throws(()=>release(dir),/Mixed versions/)
      dir=fixture();fs.renameSync(path.join(dir,'linux-x64.json'),path.join(dir,'linux-arm64.json'));assert.throws(()=>release(dir),/Descriptor does not match/)
    })
    await check('Mac reports must match version, target and exact source and may only claim ad-hoc/not notarized',()=>{
      for(const change of [r=>{r.sourceCommit='d'.repeat(40)},r=>{r.notarized=true},r=>{r.signature='Developer ID'},r=>{r.version='0.0.0'},r=>{r.target='darwin-x64'}]){
        const dir=fixture();patch(dir,'macos-build-darwin-arm64.txt',change);assert.throws(()=>release(dir),/Mac/)
      }
      const dir=fixture();fs.rmSync(path.join(dir,'macos-build-darwin-x64.txt'));assert.throws(()=>release(dir))
      assert.throws(()=>manifest({dir:fixture(),release:true,sourceSha:'main'}),/source commit/)
    })
    await check('all bundled installers must be byte-identical to the standalone public helper',()=>{
      const dir=fixture();patch(dir,'linux-arm64.json',value=>{value.installerSha256='a'.repeat(64)})
      assert.throws(()=>release(dir),/Bundled installer differs/)
    })
    await check('recovery verifies workflow/repository/source and all four successful native jobs',()=>{
      const {validate}=require('./release-provenance.cjs')
      const run={id:10,workflow_id:20,repository:{full_name:'DiamondGo/spi'},head_repository:{full_name:'DiamondGo/spi'},head_sha:sha,status:'completed',conclusion:'success'}
      const jobs={jobs:RELEASE_TARGETS.map(target=>({name:'Native '+target,status:'completed',conclusion:'success',run_id:10}))}
      const options={repository:'DiamondGo/spi',sha,sourceRun:10,currentRun:11}
      validate(run,{id:20},jobs,options)
      for(const patch of [{head_sha:'d'.repeat(40)},{workflow_id:99},{status:'in_progress'},{conclusion:'failure'},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'other/repo'}}])assert.throws(()=>validate({...run,...patch},{id:20},jobs,options))
      const badJobs=structuredClone(jobs);badJobs.jobs[0].conclusion='failure';assert.throws(()=>validate(run,{id:20},badJobs,options))
      assert.throws(()=>validate(run,{id:20},{jobs:jobs.jobs.slice(1)},options))
      validate({...run,status:'in_progress',conclusion:null},{id:20},jobs,{...options,currentRun:10})
    })
    await check('local build manifests still accept a single verified native target',()=>{
      const dir=fixture(['linux-x64']);manifest({dir});assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir,'release-manifest.json'))).targets),['linux-x64'])
    })
    await check('public verification downloads every asset (all four runtimes, reports, installer, checksums) anonymously',async()=>{
      const dir=fixture();release(dir)
      const served=new Map(fs.readdirSync(dir).filter(n=>!/^(linux|darwin)-.+\.json$/.test(n)).map(n=>[n,fs.readFileSync(path.join(dir,n))])),seen=[]
      const fetchImpl=async(url,options)=>{
        const name=url.split('/').pop();seen.push(name);assert.ok(options.signal)
        assert.ok(url.startsWith('https://github.com/DiamondGo/spi/releases/download/v'+version+'/')||url.startsWith('https://github.com/'))
        return served.has(name)?{ok:true,body:(async function*(){yield served.get(name)})()}:{ok:false}
      }
      const assets=await verify(dir,'DiamondGo/spi',version,fetchImpl)
      assert.deepEqual(seen.sort(),[...served.keys()].sort());assert.equal(assets.length,served.size)
      for(const target of RELEASE_TARGETS)assert.ok(seen.some(n=>n.startsWith('spi-'+version+'-'+target)),target)
      served.set('spi-'+version+'-darwin-arm64.zip',Buffer.from('archive-darwin-arm4'))
      await assert.rejects(verify(dir,'DiamondGo/spi',version,fetchImpl),/mismatch|too large/)
      served.set('spi-'+version+'-darwin-arm64.zip',fs.readFileSync(path.join(dir,'spi-'+version+'-darwin-arm64.zip')))
      served.delete('install.sh');await assert.rejects(verify(dir,'DiamondGo/spi',version,fetchImpl),/not publicly downloadable/)
    })
    await check('verification refuses incomplete manifests or checksum lists',()=>{
      let dir=fixture();release(dir);patch(dir,'release-manifest.json',m=>{delete m.targets['darwin-x64']});assert.throws(()=>plan(dir),/exactly/)
      dir=fixture();release(dir);fs.writeFileSync(path.join(dir,'SHA256SUMS'),fs.readFileSync(path.join(dir,'SHA256SUMS'),'utf8').split('\n').filter(l=>!l.endsWith('macos-build-darwin-x64.txt')).join('\n'));assert.throws(()=>plan(dir),/Mac report/)
      dir=fixture();release(dir);fs.appendFileSync(path.join(dir,'install.sh'),'tampered');assert.throws(()=>plan(dir),/does not match SHA256SUMS/)
    })
    await check('canonical workflow builds/tests all four natives, gates publication and never publishes npm',()=>{
      const yml=read('.github/workflows/release.yml')
      for(const text of ['ubuntu-22.04','ubuntu-24.04-arm','macos-26','macos-15-intel',...RELEASE_TARGETS])assert.ok(yml.includes(text),text)
      assert.ok(/needs: native/.test(yml)&&/needs\.native\.result == 'success'/.test(yml),'publish must require every native job')
      assert.ok(!/fail-fast: true/.test(yml))
      assert.ok(yml.includes('macos-verify.cjs')&&yml.includes('install-native-smoke.cjs')&&yml.includes('--release --source-sha')&&yml.includes('verify-release.cjs'))
      assert.ok(yml.includes('Linux + macOS')&&!/--title "[^"]*\(Linux\)/.test(yml),'title must cover Linux and macOS')
      assert.ok(!/npm publish|id-token|registry-url|NODE_AUTH_TOKEN|NPM_TOKEN|npm_token|secrets\./i.test(yml),'no npm publication or credentials')
      assert.ok(!/win32|windows-/i.test(yml),'Windows stays deferred')
      assert.ok(!/xattr|spctl|disable.*gatekeeper|--no-sandbox/i.test(yml),'no Gatekeeper/sandbox bypass')
      assert.equal((yml.match(/run: node scripts\/security-policy\.cjs/g)||[]).length,2,'both native and publication jobs enforce the scoped audit policy')
      assert.ok(yml.includes('apparmor')&&!/APPARMOR_RESTRICT.*=\s*0/.test(yml))
      assert.ok(yml.includes('test -z')||yml.includes('-eq 4'),'exactly four runtime assets are uploaded')
    })
    await check('installer is packaged into the app resources for the in-app updater',()=>{
      const builder=read('electron-builder.yml'),portable=read('scripts/build-portable.cjs')
      assert.match(builder,/from: dist\/release\/spi-installer\.cjs\s+to: spi-installer\.cjs/)
      assert.match(builder,/from: dist\/release\/INSTALLER-NOTICES\.txt\s+to: spi-installer-NOTICES\.txt/)
      assert.ok(portable.indexOf("'prepare'")<portable.indexOf('electron-builder/cli.js'),'prepare must run before packaging')
      assert.ok(read('scripts/distribution.cjs').includes("'spi-installer.cjs'"),'archive verifies the bundled installer')
    })
    await check('native updater/relaunch regression uses isolated profiles and CI-only sandbox allowlists for both runtime paths',()=>{
      assert.ok(read('scripts/install-native-smoke.cjs').includes('update-restart-native.cjs'))
      assert.ok(read('.github/spi-ci.apparmor').includes('/tmp/spi-update-restart-*/{old-root,new-root}/releases/*/*/app/spi'))
      assert.ok(!read('scripts/update-restart-native.cjs').includes('--no-sandbox'))
      assert.ok(read('.github/workflows/release.yml').includes('SPI_ASSERT_APP_UPDATES'))
    })
    await check('pending-panel navigation/draft tests gate source builds and extracted Mac runtimes',()=>{
      const workflow=read('.github/workflows/release.yml'),installed=read('scripts/install-native-smoke.cjs')
      assert.ok(workflow.includes('npm run test:workspace-ui-smoke'))
      assert.ok(workflow.includes("SPI_ASSERT_PENDING_PANEL: '1'"))
      assert.ok(installed.includes("process.env.SPI_ASSERT_PENDING_PANEL==='1'"))
      assert.ok(installed.includes("process.env.SPI_ASSERT_WORKSPACE_UI!=='1'"),'avoid duplicating Linux workspace suite')
      assert.ok(read('scripts/smoke.cjs').includes('fs.realpathSync(fs.mkdtempSync'),'Mac fixtures must use canonical paths')
    })
    await check('publication requires each native runtime dependency inventory even when an audit exception is approved',()=>{
      const dir=fixture();patch(dir,'darwin-arm64.json',value=>{delete value.securityInventory});assert.throws(()=>release(dir),/inventory/)
      const bad=fixture();patch(bad,'linux-x64.json',value=>{value.securityInventory.forbiddenModulesAbsent=false});assert.throws(()=>release(bad),/inventory/)
    })
    await check('PR checks run the plumbing test',()=>{assert.ok(read('.github/workflows/check.yml').includes('release-plumbing.test.cjs'))})
    console.log('RESULT PASS',checks,'release plumbing checks')
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1})
