// Native probe + isolated GUI/second-instance check; no model requests or real user profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process')
const binary=process.argv[2]||process.env.SPI_SMOKE_EXECUTABLE
if(!binary)throw Error('Usage: node scripts/portable-smoke.cjs /path/to/native/spi')
const exe=path.resolve(binary),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-portable-smoke-'))
const profile=path.join(tmp,'profile'),agent=path.join(tmp,'agent'),workspace=path.join(tmp,'workspace with spaces')
for(const d of [profile,agent,workspace])fs.mkdirSync(d)
const env={...process.env,PI_CODING_AGENT_DIR:agent,HISTFILE:path.join(tmp,'history'),SPI_TEST_LIFECYCLE:'1'};delete env.ELECTRON_RUN_AS_NODE
if(process.env.SPI_TEST_PI_PATH)fs.writeFileSync(path.join(profile,'spi-config.json'),JSON.stringify({piPath:process.env.SPI_TEST_PI_PATH}))
const probe=path.join(tmp,'native.cjs'),resources=process.platform==='darwin'?path.resolve(exe,'../../Resources'):path.join(path.dirname(exe),'resources')
fs.writeFileSync(probe,`const {createRequire}=require('node:module');const pty=createRequire(${JSON.stringify(path.join(resources,'app.asar/package.json'))})('node-pty');let output='';const p=pty.spawn(process.platform==='win32'?(process.env.ComSpec||'cmd.exe'):'/bin/sh',process.platform==='win32'?['/d','/c','echo SPI_NATIVE_OK']:['-c','printf SPI_NATIVE_OK'],{cwd:${JSON.stringify(workspace)},env:process.env,cols:80,rows:24});const timeout=setTimeout(()=>{p.kill();process.exitCode=1},10000);p.onData(d=>output+=d);p.onExit(e=>{clearTimeout(timeout);if(e.exitCode!==0||!output.includes('SPI_NATIVE_OK'))process.exitCode=1;else console.log('PASS packaged native PTY')});`)
function child(command,args,childEnv){const c=spawn(command,args,{env:childEnv,stdio:['ignore','pipe','pipe']});c.started=start(c.pid);c.log='';c.done=false;for(const s of[c.stdout,c.stderr])s.on('data',d=>{c.log=(c.log+d).slice(-200000)});c.once('exit',()=>c.done=true);c.once('error',e=>{c.done=true;c.log+=e.message});return c}
async function wait(fn,label,timeout=30000){const until=Date.now()+timeout;while(Date.now()<until){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out: '+label)}
async function exit(c){await wait(()=>c.done,'owned child exit');assert.equal(c.exitCode,0,c.log)}
let app,ws
function start(pid){try{if(process.platform==='darwin')return execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8'}).trim()||null;const s=fs.readFileSync('/proc/'+pid+'/stat','utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[19]}catch{return null}}
function descendants(pid){try{
  if(process.platform==='darwin'){
    const rows=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number))
    const collect=parent=>rows.filter(row=>row[1]===parent).flatMap(row=>[row[0],...collect(row[0])]);return collect(pid)
  }
  return fs.readFileSync('/proc/'+pid+'/task/'+pid+'/children','utf8').trim().split(/\s+/).filter(Boolean).flatMap(p=>[+p,...descendants(+p)])
}catch{return[]}}
;(async()=>{
  const native=child(exe,[probe],{...env,ELECTRON_RUN_AS_NODE:'1'});try{await exit(native);console.log('PASS packaged native PTY')}finally{if(!native.done)native.kill('SIGKILL')}
  if(process.platform==='linux'&&process.env.SPI_TEST_VIRTUAL_DISPLAY!=='1')throw Error('Use scripts/with-display.cjs for isolated GUI tests')
  const headless=process.platform==='linux'?['--ozone-platform=x11','--disable-gpu']:[]
  const args=[...headless,'--user-data-dir='+profile,'--remote-debugging-port=0']
  app=child(exe,args,env)
  const endpoint=await wait(()=>{if(app.done)throw Error(app.log);return app.log.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]},'GUI endpoint')
  const page=await wait(async()=>{try{const pages=await(await fetch('http://'+new URL(endpoint).host+'/json/list')).json();return pages.find(p=>p.type==='page'&&p.webSocketDebuggerUrl)}catch{return false}},'GUI debugger page')
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j})
  let seq=0;const pending=new Map()
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}}
  const send=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout'))},15000);pending.set(id,{resolve:v=>{clearTimeout(t);resolve(v)},reject:e=>{clearTimeout(t);reject(e)}});ws.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails){fs.writeFileSync(path.join(tmp,'renderer-exception.json'),JSON.stringify(r.exceptionDetails,null,2));throw Error('Renderer evaluation failed; see isolated renderer-exception.json')};return r.result.value}
  await wait(()=>evaluate('!!document.querySelector(".titlebar")'),'real packaged UI')
  console.log('PASS isolated packaged GUI')
  if(process.env.SPI_ASSERT_APP_ICON==='1'){
    const png=fs.readFileSync(path.join(resources,'icon.png')),reference=path.join(__dirname,'../build/icons/icon.png')
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512)
    if(fs.existsSync(reference))assert.deepEqual(png,fs.readFileSync(reference))
    assert.ok(await evaluate('!!document.querySelector(\'link[rel="icon"][type="image/svg+xml"]\')'))
    if(process.platform==='linux'){
      let nativeIcon=''
      try{await wait(()=>{
        try{
          const options={env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}
          const tree=execFileSync('xwininfo',['-root','-tree'],options)
          nativeIcon='Owned browser PID: '+app.pid+'\n'+tree+'\n'
          for(const match of tree.matchAll(/^\s*(0x[0-9a-f]+)\s/gm)){
            const properties=execFileSync('xprop',['-id',match[1],'-f','_NET_WM_ICON','32c','_NET_WM_PID','_NET_WM_ICON'],options)
            nativeIcon+=properties.slice(0,400)+'\n'
            if(!properties.includes('= '+app.pid+'\n'))continue
            // The packaged PNG matches the generated artwork above; verify its native 512px representation.
            if(/_NET_WM_ICON\(CARDINAL\) = 512, 512,/.test(properties))return true
          }
          return false
        }catch(error){nativeIcon=String(error.stderr||error.message);return false}
      },'custom native window icon')}
      finally{fs.writeFileSync(path.join(tmp,'native-icon-query.txt'),nativeIcon.slice(0,2000))}
    }
    console.log('PASS packaged icon and SVG favicon'+(process.platform==='linux'?' and native window icon':''))
  }
  if(process.platform==='linux'&&process.env.SPI_ASSERT_RENDERER_SANDBOX==='1'){
    const sandboxed=descendants(app.pid).some(pid=>{
      try{
        if(!fs.readFileSync('/proc/'+pid+'/cmdline','utf8').includes('--type=renderer'))return false
        const status=fs.readFileSync('/proc/'+pid+'/status','utf8')
        return /^NoNewPrivs:\s+1$/m.test(status)&&/^Seccomp:\s+2$/m.test(status)
      }catch{return false}
    })
    assert.ok(sandboxed,'Chromium renderer must retain its own seccomp sandbox')
    console.log('PASS Chromium renderer seccomp sandbox is active')
  }
  const pi=await evaluate('window.spi.findPi()')
  if(pi){
    const second=child(exe,[...headless,'--user-data-dir='+profile,'--cwd='+workspace],env)
    try{await exit(second)}finally{if(!second.done)second.kill()}
    await wait(()=>evaluate('window.spi.getPermissions().then(s=>Object.keys(s.sessions).length===1&&Object.values(s.sessions)[0].ready&&!!document.querySelector(".session-tab.active"))'),'forwarded directory and real pi handshake')
    const firstId=await evaluate('document.querySelector(".session-tab.active").dataset.sessionId')
    const third=child(exe,[...headless,'--user-data-dir='+profile,'--cwd='+workspace],env)
    try{await exit(third)}finally{if(!third.done)third.kill()}
    await wait(()=>evaluate('window.spi.getLaunchRequest().then(r=>r===null)'),'directory acknowledged')
    assert.equal(await evaluate('document.querySelectorAll(".session-tab").length'),1)
    assert.equal(await evaluate('document.querySelector(".session-tab.active").dataset.sessionId'),firstId)
    console.log('PASS second-instance cwd forwarding reuses one real pi/session')
  }else if(process.env.CI){throw Error('CI requires Pi for native integration check')}
  else console.log('SKIP Pi directory forwarding: Pi not installed')
  await evaluate('window.spi.updateAppSettings({confirmOnExit:false})')
  await evaluate('window.close()').catch(()=>{})
  await exit(app)
  console.log('RESULT PASS',tmp)
})().catch(e=>{if(app){fs.writeFileSync(path.join(tmp,'failure.log'),app.log);const events=app.log.match(/\[sPi lifecycle\] (?:quit-committed|quit-dispatched|before-quit|window-all-closed|closed|close)\b/g)||[];console.error(events.slice(-20).join('\n'))}console.error(e.message);process.exitCode=1}).finally(()=>{
  ws?.close()
  if(app&&!app.done){
    if(['linux','darwin'].includes(process.platform)&&(!app.started||start(app.pid)!==app.started)){app.stdout.destroy();app.stderr.destroy();return}
    if(['linux','darwin'].includes(process.platform)){const own=descendants(app.pid).map(pid=>[pid,start(pid)]);for(const[pid,s]of own.reverse())if(s&&start(pid)===s)try{process.kill(pid,'SIGKILL')}catch{}}
    app.kill('SIGKILL')
    app.stdout.destroy(); app.stderr.destroy()
  }
})
