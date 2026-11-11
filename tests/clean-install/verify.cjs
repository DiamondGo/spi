// Only public registry/Release traffic. No host config, credentials, cache or app binaries are mounted.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const {spawn,execFileSync}=require('node:child_process')
const spec=process.env.SPI_VERIFY_PACKAGE||'spi-agent-gui@0.1.4'
const expectedVersion=process.env.SPI_EXPECTED_VERSION||'0.1.4'
function locate(name){return execFileSync('/bin/sh',['-c','command -v '+name],{encoding:'utf8'}).trim()}
function run(command,args,options={}){return new Promise((resolve,reject)=>{
  const {timeoutMs=240000,...spawnOptions}=options
  const child=spawn(command,args,{stdio:'inherit',env:process.env,...spawnOptions})
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Clean test child timed out'))},timeoutMs)
  child.once('error',error=>{clearTimeout(timer);reject(error)})
  child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Clean test command failed: '+code))})
})}
async function commands(pi){return new Promise((resolve,reject)=>{
  const p=spawn(pi,['--mode','rpc'],{stdio:['pipe','pipe','pipe']});let buffer='',found=false
  const timer=setTimeout(()=>{p.kill('SIGKILL');reject(Error('Pi extension command check timed out'))},30000)
  p.stdout.on('data',data=>{
    buffer+=data
    let newline
    while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1)
      try{const message=JSON.parse(line);if(message.id==='clean-commands'&&message.type==='response'){
        assert.equal(message.success,true)
        for(const name of ['spi','spi-install'])assert.ok(message.data.commands.some(c=>c.name===name))
        found=true;p.stdin.end()
      }}catch(error){clearTimeout(timer);p.kill('SIGKILL');reject(error)}
    }
  })
  p.stderr.on('data',()=>{})
  p.once('error',error=>{clearTimeout(timer);reject(error)})
  p.once('exit',code=>{clearTimeout(timer);code===0&&found?resolve():reject(Error('Pi command registration failed'))})
  p.stdin.write(JSON.stringify({id:'clean-commands',type:'get_commands'})+'\n')
})}
;(async()=>{
  assert.equal(process.getuid()===0,false,'Test must run as a non-root user')
  for(const key of ['NPM_TOKEN','NODE_AUTH_TOKEN','GH_TOKEN','GITHUB_TOKEN','SPI_RELEASE_BASE_URL','SPI_ALLOW_TEST_HTTP'])assert.equal(!!process.env[key],false,'No credentials/test registry overrides allowed')
  assert.equal(fs.existsSync(path.join(os.homedir(),'.npmrc')),false)
  assert.equal(fs.existsSync(path.join(os.homedir(),'.pi/agent/settings.json')),false)
  assert.throws(()=>locate('spi'))
  const pi=locate('pi')
  console.log('PASS clean non-root environment; no spi, settings or credentials')
  await run(pi,['install','npm:'+spec],{timeoutMs:4500000,env:{...process.env,npm_config_foreground_scripts:'true'}})
  const spi=locate('spi')
  assert.equal(path.dirname(spi),path.dirname(pi),'spi must be globally visible beside the user-owned pi launcher')
  const version=execFileSync(spi,['--version'],{encoding:'utf8'}).trim()
  assert.equal(version,expectedVersion)
  const doctor=JSON.parse(execFileSync(spi,['doctor'],{encoding:'utf8'}))
  assert.equal(doctor.platform,'linux-x64')
  console.log('PASS public pi install, user command location, version and doctor')
  const desktop=path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),'applications/spi.desktop')
  const icon=path.join(path.dirname(doctor.current.entryPath),'resources/icon.png')
  const text=fs.readFileSync(desktop,'utf8'),png=fs.readFileSync(icon)
  assert.ok(text.includes('Icon='+icon));assert.ok(text.includes('StartupWMClass=spi'))
  assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512)
  const state=JSON.parse(fs.readFileSync(path.join(doctor.root,'install-state.json')))
  assert.equal(state.desktop.path,desktop)
  assert.equal(require('node:crypto').createHash('sha256').update(text).digest('hex'),state.desktop.sha256)
  console.log('PASS owned Linux desktop entry and installed spy icon')
  await commands(pi)
  console.log('PASS published Pi extension commands; no automatic GUI launch')
  process.env.SPI_ASSERT_RENDERER_SANDBOX='1'
  process.env.SPI_ASSERT_APP_ICON='1'
  process.env.SPI_ASSERT_WORKSPACE_UI='1'
  await run(process.execPath,['/opt/spi-test/with-display.cjs','/opt/spi-test/portable-smoke.cjs',doctor.current.entryPath])
  await run(process.execPath,['/opt/spi-test/with-display.cjs','/opt/spi-test/smoke.cjs','--workspace-ui'],{env:{...process.env,SPI_SMOKE_EXECUTABLE:doctor.current.entryPath}})
  console.log('PASS published editable outbox, follow-up/steer order, active sidebar and path abbreviation')
  await run(process.execPath,['/opt/spi-test/with-display.cjs','/opt/spi-test/smoke.cjs','--runtime-env'],{env:{...process.env,SPI_SMOKE_EXECUTABLE:doctor.current.entryPath}})
  console.log('PASS published sparse-desktop-PATH new/history sessions, manual Node settings and persistence')
  const report={desktopNodeRecovery:true,manualNodeSettings:true,historyReopen:true,editableOutbox:true,steerFrontInsertion:true,resizableSidebar:true,activeSessionHighlight:true,homePathAbbreviation:true,package:spec,uid:process.getuid(),target:doctor.platform,version,sameBinDirectory:true,publicRegistry:true,hostConfigMounted:false,nativePty:true,gui:true,piRpc:true,singleInstance:true,rendererSandbox:true,customIcon:true,ownedDesktopEntry:true}
  fs.writeFileSync(path.join(os.homedir(),'clean-install-result.json'),JSON.stringify(report,null,2))
  console.log('CLEAN_INSTALL_RESULT '+JSON.stringify(report))
})().catch(error=>{console.error(error.message);process.exitCode=1})
