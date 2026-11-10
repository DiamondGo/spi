const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process')
const {macBuildEnv}=require('./native-build-env.cjs'),{keepPty}=require('./distribution.cjs'),privacy=require('./privacy.cjs')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-native-build-test-'));let count=0
function check(name,fn){fn();console.log('PASS',name);count++}
function write(root,name,data='fixture'){const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data)}
try{
  check('mac compiler maps preserve caller flags and cover source/debug/macro paths',()=>{
    const env=macBuildEnv({CFLAGS:'-O2',CXXFLAGS:'-std=c++17',OTHER:'keep'},'/Users/build user');assert.equal(env.OTHER,'keep')
    for(const key of ['CFLAGS','CXXFLAGS'])for(const kind of ['file','debug','macro'])assert.ok(env[key].includes('-f'+kind+'-prefix-map=/Users/build user=/spi-build'))
    assert.ok(env.CFLAGS.startsWith('-O2 '));assert.ok(env.CXXFLAGS.startsWith('-std=c++17 '))
    assert.throws(()=>macBuildEnv({},'/bad\npath'));assert.throws(()=>macBuildEnv({},'/'));assert.throws(()=>macBuildEnv({},'relative'))
  })
  if(process.platform!=='win32')check('prefix-map arguments remain one shell word even with spaces and quotes',()=>{
    const home="/Users/build '$user`name",env=macBuildEnv({},home)
    const words=execFileSync('/bin/sh',['-c','set -- '+env.CFLAGS+'; printf "%s\\n" "$@"'],{encoding:'utf8'}).trim().split('\n')
    assert.deepEqual(words,['file','debug','macro'].map(k=>'-f'+k+'-prefix-map='+home+'=/spi-build'))
  })
  check('mac sanitizer keeps rebuilt addon/helper and removes unused vendor prebuilds and metadata',()=>{
    const dir=path.join(tmp,'rebuilt');for(const f of ['build/Release/pty.node','build/Release/spawn-helper','build/Release/obj.target/private.o','build/config.gypi','prebuilds/darwin-arm64/pty.node','lib/index.js','package.json','src/private.cc'])write(dir,f)
    keepPty(dir,'darwin','arm64');assert.ok(fs.existsSync(path.join(dir,'build/Release/pty.node')));assert.ok(fs.existsSync(path.join(dir,'build/Release/spawn-helper')))
    for(const f of ['prebuilds','build/config.gypi','build/Release/obj.target','src'])assert.equal(fs.existsSync(path.join(dir,f)),false)
  })
  check('missing rebuilt helper does not silently remove the only prebuilt runtime',()=>{
    const dir=path.join(tmp,'fallback');for(const f of ['build/Release/pty.node','prebuilds/darwin-arm64/pty.node','prebuilds/darwin-arm64/spawn-helper','prebuilds/darwin-x64/pty.node'])write(dir,f)
    keepPty(dir,'darwin','arm64');assert.ok(fs.existsSync(path.join(dir,'prebuilds/darwin-arm64/pty.node')));assert.equal(fs.existsSync(path.join(dir,'prebuilds/darwin-x64')),false)
  })
  check('Windows runtime helper prebuilds are not removed by mac-only pruning',()=>{
    const dir=path.join(tmp,'windows');for(const f of ['build/Release/conpty.node','prebuilds/win32-x64/conpty/OpenConsole.exe','prebuilds/win32-x64/conpty/conpty.dll'])write(dir,f)
    keepPty(dir,'win32','x64');assert.ok(fs.existsSync(path.join(dir,'prebuilds/win32-x64/conpty/OpenConsole.exe')))
  })
  check('privacy still rejects a home path in native binaries and identifies the relative location only',()=>{
    const dir=path.join(tmp,'scan');write(dir,'node_modules/node-pty/build/Release/pty.node',os.homedir()+'/hidden.cc')
    assert.throws(()=>privacy.scanTree(dir,{binary:true}),error=>error.message.includes('local-home-path')&&error.message.includes(path.join('node_modules/node-pty/build/Release/pty.node'))&&!error.message.includes(os.homedir()))
  })
  console.log('RESULT PASS',count,'native build checks')
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
