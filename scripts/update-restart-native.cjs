// Exercise Electron's real cross-runtime relaunch on a native runner, using two verified copies
// of this release and an empty throwaway profile. No model request or personal session is opened.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawn, execFileSync } = require('node:child_process')
if(process.platform==='linux'&&process.env.SPI_TEST_VIRTUAL_DISPLAY!=='1') throw Error('Use scripts/with-display.cjs for a private test display')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spi-update-restart-'))
const api = require('../dist/npm-package/dist/spi.cjs')
const root = path.resolve(__dirname, '..'), manifest = path.join(root, 'dist/release/release-manifest.json')
const data = JSON.parse(fs.readFileSync(manifest)), target = process.platform + '-' + process.arch, item = data.targets[target]
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let original, socket, restartedPid
async function wait(fn, label) {
  const end = Date.now() + 45000
  while (Date.now() < end) { const value = fn(); if (value) return value; await sleep(100) }
  throw Error('Timeout: ' + label)
}
function records(directory) {
  try { return fs.readdirSync(path.join(directory, '.running')).map(name => JSON.parse(fs.readFileSync(path.join(directory, '.running', name), 'utf8'))) } catch { return [] }
}
function command(pid) { try { return execFileSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], {encoding:'utf8'}).trim() } catch { return '' } }
;(async () => {
  const firstRoot = path.join(tmp, 'old-root'), secondRoot = path.join(tmp, 'new-root')
  const install = (directory, bin) => api.install({version:data.version, manifest, archive:path.join(root,'dist/release',item.file), installDir:directory, binDir:path.join(tmp,bin)})
  const first = await install(firstRoot,'old-bin'), second = await install(secondRoot,'new-bin')
  const profile = path.join(tmp,'profile'); fs.mkdirSync(profile)
  const settings = JSON.stringify({theme:'light',language:'en',confirmOnExit:false})
  fs.writeFileSync(path.join(profile,'spi-settings.json'), settings)
  const env = {...process.env, HOME:path.join(tmp,'home'), PI_CODING_AGENT_DIR:path.join(tmp,'pi'), XDG_CONFIG_HOME:path.join(tmp,'config'), XDG_DATA_HOME:path.join(tmp,'data'), XDG_CACHE_HOME:path.join(tmp,'cache')}
  for (const name of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','ELECTRON_VITE_DEV_SERVER_URL']) delete env[name]
  for (const key of ['HOME','PI_CODING_AGENT_DIR','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME']) fs.mkdirSync(env[key],{recursive:true})
  let log = ''
  original = spawn(first.entryPath, ['--inspect=127.0.0.1:0','--user-data-dir='+profile,...(process.platform==='linux'?['--ozone-platform=x11','--disable-gpu']:[])], {env,stdio:['ignore','pipe','pipe']})
  original.stdout.on('data',chunk=>log+=chunk); original.stderr.on('data',chunk=>log+=chunk)
  const endpoint = await wait(()=>log.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1], 'private main-process inspector')
  await wait(()=>records(firstRoot).some(record=>record.pid===original.pid),'first runtime is ready and protected from uninstall')
  socket = new WebSocket(endpoint)
  await new Promise((accept,reject)=>{socket.onopen=accept;socket.onerror=reject})
  const response = new Promise((accept,reject)=>{
    const timer=setTimeout(()=>reject(Error('Inspector response timed out')),15000)
    socket.onmessage=event=>{const result=JSON.parse(event.data);if(result.id===1){clearTimeout(timer);result.error||result.result?.exceptionDetails?reject(Error(JSON.stringify(result))):accept(result)}}
  })
  const args = ['--user-data-dir='+profile]
  // Same native API and arguments as the approved production restart path; only the target is
  // another privately installed copy, not a fabricated executable or a modified signed bundle.
  socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`(()=>{const {app}=process.getBuiltinModule('module').createRequire(process.execPath)('electron');app.relaunch({execPath:${JSON.stringify(second.entryPath)},args:${JSON.stringify(args)}});app.quit();return true})()`,returnByValue:true}}))
  await response; socket.close()
  const record = await wait(()=>records(secondRoot).find(value=>value.pid!==original.pid),'relaunch entered the new runtime and acquired the instance lock')
  restartedPid=record.pid
  await sleep(1500)
  const running=command(restartedPid)
  assert.ok(running.includes(second.entryPath)||running.includes(fs.realpathSync(second.entryPath)),running)
  assert.ok(running.includes(profile)||running.includes(fs.realpathSync(profile)),running)
  assert.equal(fs.readFileSync(path.join(profile,'spi-settings.json'),'utf8'),settings)
  assert.ok(records(secondRoot).some(value=>value.pid===restartedPid),'direct relaunch must protect its runtime from uninstall')
  console.log('PASS real native cross-runtime Electron relaunch, single-instance acquisition, unchanged profile and runtime liveness protection',target)
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
  socket?.close()
  if(restartedPid){const current=command(restartedPid);if(current.includes(tmp)||current.includes(fs.realpathSync(tmp))){try{process.kill(restartedPid,'SIGTERM')}catch{}}}
  if(original&&original.exitCode===null){original.kill('SIGTERM');await Promise.race([new Promise(resolve=>original.once('exit',resolve)),sleep(2000)])}
  await sleep(500)
  fs.rmSync(tmp,{recursive:true,force:true})
})
