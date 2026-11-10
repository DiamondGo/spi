// Native macOS checks, before and after safe archive extraction. No Gatekeeper bypass.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync,spawnSync}=require('node:child_process')
function verifyMac(executable){
  if(process.platform!=='darwin')throw Error('macOS verification requires a native macOS runner')
  const contents=path.resolve(executable,'../..'),bundle=path.dirname(contents),resources=path.join(contents,'Resources')
  const info=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path.join(contents,'Info.plist')],{encoding:'utf8'}))
  assert.equal(info.CFBundleIdentifier,'com.kexie.spi');assert.equal(info.CFBundleExecutable,path.basename(executable))
  assert.equal(info.CFBundleShortVersionString,require('../package.json').version)
  assert.deepEqual(info.ElectronAsarIntegrity?.['Resources/app.asar'],{algorithm:'SHA256',hash:require('./macos-integrity.cjs').headerHash(resources)},'Signed plist must describe the sanitized ASAR')
  assert.equal(info.CFBundleIconFile,path.basename(info.CFBundleIconFile))
  const icon=path.join(resources,info.CFBundleIconFile.endsWith('.icns')?info.CFBundleIconFile:info.CFBundleIconFile+'.icns')
  assert.deepEqual(fs.readFileSync(icon),fs.readFileSync(path.join(__dirname,'../build/icons/icon.icns')))
  const native=path.join(resources,'app.asar.unpacked/node_modules/node-pty/build/Release')
  for(const file of [executable,path.join(native,'spawn-helper')])fs.accessSync(file,fs.constants.X_OK)
  for(const file of [executable,path.join(native,'pty.node'),path.join(native,'spawn-helper')]){
    const arch=execFileSync('/usr/bin/lipo',['-archs',file],{encoding:'utf8'}).trim()
    assert.equal(arch,process.arch==='x64'?'x86_64':'arm64','Runtime must be native to its declared target')
  }
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:['ignore','pipe','pipe']})
  const signature=spawnSync('/usr/bin/codesign',['--display','--verbose=4',bundle],{encoding:'utf8'})
  assert.equal(signature.status,0);assert.match(signature.stderr,/Signature=adhoc/)
  assert.ok(!fs.existsSync(path.join(resources,'app.asar.unpacked/node_modules/node-pty/prebuilds')))
  console.log('PASS native macOS architectures, ICNS bundle icon, ASAR integrity and intact ad-hoc signatures')
  return {target:process.platform+'-'+process.arch,version:info.CFBundleShortVersionString,minimumOS:info.LSMinimumSystemVersion,signature:'ad-hoc',notarized:false}
}
module.exports={verifyMac}
if(require.main===module){try{const info=verifyMac(path.resolve(process.argv[2]));console.log(JSON.stringify(info));const out=process.argv[3];if(out){const sha=process.env.GITHUB_SHA;if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Missing source identity');fs.writeFileSync(out,JSON.stringify({...info,sourceCommit:sha,electron:require('../package.json').devDependencies.electron,node:process.version},null,2)+'\n')}}catch(e){console.error(e.message);process.exitCode=1}}
