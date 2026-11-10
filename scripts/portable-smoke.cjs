// Native probe + isolated GUI/second-instance check; no model requests or real user profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process')
const binary=process.argv[2]||process.env.SPI_SMOKE_EXECUTABLE
if(!binary)throw Error('Usage: node scripts/portable-smoke.cjs /path/to/native/spi')
const exe=path.resolve(binary),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-portable-smoke-'))
const profile=path.join(tmp,'profile'),agent=path.join(tmp,'agent'),workspace=path.join(tmp,'workspace with spaces')
for(const d of [profile,agent,workspace])fs.mkdirSync(d)
const env={...process.env,PI_CODING_AGENT_DIR:agent,HISTFILE:path.join(tmp,'history')};delete env.ELECTRON_RUN_AS_NODE
if(process.env.SPI_TEST_PI_PATH)fs.writeFileSync(path.join(profile,'spi-config.json'),JSON.stringify({piPath:process.env.SPI_TEST_PI_PATH}))
const probe=path.join(tmp,'native.cjs'),resources=process.platform==='darwin'?path.resolve(exe,'../../Resources'):path.join(path.dirname(exe),'resources')
fs.writeFileSync(probe,`const {createRequire}=require('node:module');const pty=createRequire(${JSON.stringify(path.join(resources,'app.asar/package.json'))})('node-pty');let output='';const p=pty.spawn(process.platform==='win32'?(process.env.ComSpec||'cmd.exe'):'/bin/sh',process.platform==='win32'?['/d','/c','echo SPI_NATIVE_OK']:['-c','printf SPI_NATIVE_OK'],{cwd:${JSON.stringify(workspace)},env:process.env,cols:80,rows:24});const timeout=setTimeout(()=>{p.kill();process.exitCode=1},10000);p.onData(d=>output+=d);p.onExit(e=>{clearTimeout(timeout);if(e.exitCode!==0||!output.includes('SPI_NATIVE_OK'))process.exitCode=1;else console.log('PASS packaged native PTY')});`)
function child(command,args,childEnv){const c=spawn(command,args,{env:childEnv,stdio:['ignore','pipe','pipe']});c.started=start(c.pid);c.log='';c.done=false;for(const s of[c.stdout,c.stderr])s.on('data',d=>{c.log=(c.log+d).slice(-200000)});c.once('exit',()=>c.done=true);c.once('error',e=>{c.done=true;c.log+=e.message});return c}
async function wait(fn,label,timeout=30000){const until=Date.now()+timeout;while(Date.now()<until){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out: '+label)}
async function exit(c){await wait(()=>c.done,'owned child exit');assert.equal(c.exitCode,0,c.log)}
let app,ws
function start(pid){try{const s=fs.readFileSync('/proc/'+pid+'/stat','utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[19]}catch{return null}}
function descendants(pid){try{return fs.readFileSync('/proc/'+pid+'/task/'+pid+'/children','utf8').trim().split(/\s+/).filter(Boolean).flatMap(p=>[+p,...descendants(+p)])}catch{return[]}}
;(async()=>{
  const native=child(exe,[probe],{...env,ELECTRON_RUN_AS_NODE:'1'});try{await exit(native);console.log('PASS packaged native PTY')}finally{if(!native.done)native.kill('SIGKILL')}
  if(process.platform==='linux'&&process.env.SPI_TEST_VIRTUAL_DISPLAY!=='1')throw Error('Use scripts/with-display.cjs for isolated GUI tests')
  const headless=process.platform==='linux'?['--ozone-platform=x11','--disable-gpu']:[]
  const args=[...headless,'--user-data-dir='+profile,'--remote-debugging-port=0']
  app=child(exe,args,env)
  const endpoint=await wait(()=>{if(app.done)throw Error(app.log);return app.log.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]},'GUI endpoint')
  const pages=await(await fetch('http://'+new URL(endpoint).host+'/json/list')).json(),page=pages.find(p=>p.type==='page')
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j})
  let seq=0;const pending=new Map()
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}}
  const send=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout'))},15000);pending.set(id,{resolve:v=>{clearTimeout(t);resolve(v)},reject:e=>{clearTimeout(t);reject(e)}});ws.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails){fs.writeFileSync(path.join(tmp,'renderer-exception.json'),JSON.stringify(r.exceptionDetails,null,2));throw Error('Renderer evaluation failed; see isolated renderer-exception.json')};return r.result.value}
  await wait(()=>evaluate('!!document.querySelector(".titlebar")'),'real packaged UI')
  console.log('PASS isolated packaged GUI')
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
})().catch(e=>{if(app)fs.writeFileSync(path.join(tmp,'failure.log'),app.log);console.error(e.message);process.exitCode=1}).finally(()=>{
  ws?.close()
  if(app&&!app.done){
    if(process.platform==='linux'&&(!app.started||start(app.pid)!==app.started)){app.stdout.destroy();app.stderr.destroy();return}
    if(process.platform==='linux'){const own=descendants(app.pid).map(pid=>[pid,start(pid)]);for(const[pid,s]of own.reverse())if(s&&start(pid)===s)try{process.kill(pid,'SIGKILL')}catch{}}
    app.kill('SIGKILL')
    app.stdout.destroy(); app.stderr.destroy()
  }
})
