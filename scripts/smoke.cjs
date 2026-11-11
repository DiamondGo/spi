// Build first: npm run build && node scripts/smoke.cjs
// Real Electron + real installed pi. Isolates GUI userData/workspace; never resumes user sessions.
// Only PIDs descended from this script's Electron instance are inspected/terminated.
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const repo = path.resolve(__dirname, '..')
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'spi-smoke-'))
const profile = path.join(artifacts, 'profile')
const workspace = process.argv.includes('--workspace-ui') ? path.join(artifacts, 'home/source/sPi') : path.join(artifacts, 'workspace')
fs.mkdirSync(profile)
fs.mkdirSync(workspace, { recursive: true })
// Legacy regression assertions use Chinese; settings tests deliberately exercise real English defaults.
if (!process.argv.includes('--settings')) fs.writeFileSync(path.join(profile, 'spi-settings.json'), JSON.stringify({ language: 'zh' }))
fs.writeFileSync(path.join(workspace, 'smoke.txt'), 'sPi smoke fixture\n')
fs.writeFileSync(path.join(profile, 'spi-config.json'), JSON.stringify({
  layout: { viewMode: 'dir', selectedDir: workspace, sessions: [
    { cwd: path.join(artifacts, 'deleted-workspace') },
    { cwd: workspace }
  ] }
}))
const results = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const apps = []
let current

async function waitFor(fn, label, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const result = await fn()
    if (result) return result
    if (current?.exited) throw new Error(`Electron exited while waiting for ${label}`)
    await delay(150)
  }
  throw new Error(`Timeout (${timeout}ms): ${label}`)
}
function pass(name, details) {
  results.push({ name, passed: true, details })
  console.log('PASS', name, details === undefined ? '' : JSON.stringify(details))
}
function descendants(pid) {
  let children = []
  try {
    children = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim()
      .split(/\s+/).filter(Boolean).map(Number)
  } catch {}
  return children.flatMap(child => [child, ...descendants(child)])
}
function processInfo(pid) {
  try {
    return { pid, cmdline: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim(), cwd: fs.readlinkSync(`/proc/${pid}/cwd`) }
  } catch { return { pid } }
}
function startTime(pid) { try { const s=fs.readFileSync(`/proc/${pid}/stat`,'utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[19] } catch { return null } }
async function stop(app) {
  if (!app || app.exited) return
  app.ws?.close()
  // Snapshot only this parent's descendants and verify identities before signalling.
  if (process.platform==='linux' && (!app.started || startTime(app.child.pid)!==app.started)) return
  const own=descendants(app.child.pid).map(pid=>[pid,startTime(pid)])
  for (const [pid,started] of own.reverse()) {
    if (started && startTime(pid)===started) { try { process.kill(pid, 'SIGKILL') } catch {} }
  }
  if (process.platform!=='linux'||startTime(app.child.pid)===app.started) app.child.kill('SIGKILL')
  app.child.stdout.destroy()
  app.child.stderr.destroy()
  await Promise.race([new Promise(r => app.child.once('exit', r)), delay(2000)])
}
async function launch(options = {}) {
  const index = apps.length + 1
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_VITE_DEV_SERVER_URL
  if (process.argv.includes('--terminal')) env.HISTFILE = path.join(artifacts, 'terminal-shell-history')
  if (['--yolo','--settings','--terminal','--extension-ui','--workspace-ui','--runtime-env','--session-health','--session-actions'].some(flag => process.argv.includes(flag))) {
    env.PI_CODING_AGENT_DIR = path.join(artifacts, 'agent')
    env.HOME = path.join(artifacts, 'home')
    env.XDG_CONFIG_HOME = path.join(artifacts, 'xdg-config')
    env.XDG_CACHE_HOME = path.join(artifacts, 'xdg-cache')
    env.XDG_DATA_HOME = path.join(artifacts, 'xdg-data')
    for (const dir of [env.HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME, path.join(env.HOME, 'fixture-a'), path.join(env.HOME, 'fixture-b')]) fs.mkdirSync(dir, { recursive: true })
  }
  Object.assign(env, options.env || {})
  const executable = process.platform === 'win32' ? 'electron.exe' : 'electron'
  const installed = process.env.SPI_SMOKE_EXECUTABLE
  if (process.platform === 'linux' && process.env.SPI_TEST_VIRTUAL_DISPLAY !== '1') throw new Error('Use scripts/with-display.cjs for isolated GUI tests')
  const isolatedDisplay = process.platform === 'linux' ? ['--ozone-platform=x11', '--disable-gpu'] : []
  const child = spawn(installed || path.join(repo, 'node_modules/electron/dist', executable), [
    ...(installed ? [] : [repo]), ...isolatedDisplay, `--user-data-dir=${profile}`, '--remote-debugging-port=0'
  ], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const app = { child, started: startTime(child.pid), log: '', exited: false, errors: [], pending: new Map(), index }
  current = app
  apps.push(app)
  child.stdout.on('data', d => { app.log += d })
  child.stderr.on('data', d => { app.log += d })
  child.on('error', error => { app.exited = true; app.log += error.stack })
  child.on('exit', (code, signal) => {
    app.exited = true
    app.exit = { code, signal }
    for (const request of app.pending.values()) request.reject(new Error('Electron exited'))
    app.pending.clear()
  })
  console.log('LAUNCH', { pid: child.pid, index })
  const debug = await waitFor(() => app.log.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 'debug endpoint')
  const origin = 'http://' + new URL(debug).host
  const page = await waitFor(async () => {
    // New Chromium versions can announce CDP just before its HTTP endpoint accepts connections.
    try {
      const targets = await (await fetch(origin + '/json/list', { signal: AbortSignal.timeout(3000) })).json()
      return targets.find(t => t.type === 'page')
    } catch { return null }
  }, 'Electron renderer')
  const ws = app.ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let seq = 0
  ws.onmessage = event => {
    const msg = JSON.parse(event.data)
    if (msg.id) {
      const request = app.pending.get(msg.id)
      if (!request) return
      app.pending.delete(msg.id)
      msg.error ? request.reject(new Error(JSON.stringify(msg.error))) : request.resolve(msg.result)
    } else if (msg.method === 'Runtime.exceptionThrown' || (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')) {
      app.errors.push(msg)
    }
  }
  app.send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { app.pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 20000)
    app.pending.set(id, {
      resolve: v => { clearTimeout(timer); resolve(v) },
      reject: e => { clearTimeout(timer); reject(e) }
    })
    ws.send(JSON.stringify({ id, method, params }))
  })
  app.eval = async expression => {
    const response = await app.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
    return response.result.value
  }
  await app.send('Runtime.enable')
  await app.send('Log.enable')
  await waitFor(() => app.eval(options.waitForSession === false ? `!!document.querySelector('.titlebar')` : `!!document.querySelector('textarea')`), 'restored session input', 30000)
  assert.equal(await app.eval('location.protocol'), 'file:')
  const layout = await app.eval('window.spi.loadLayout()')
  assert.equal(layout.selectedDir, workspace, 'Must use isolated profile')
  assert.ok(layout.sessions.every(s => s.cwd === workspace), 'Deleted cwd must be filtered from layout')
  await app.eval(`window.__smokeEvents=[];window.__smokeOff=window.spi.onPiEvent(e=>window.__smokeEvents.push({...e,receivedAt:Date.now()}))`)
  return app
}
async function fill(app, text) {
  await app.eval(`(() => {
    const ta=document.querySelector('.input-bar textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(ta,${JSON.stringify(text)});
    ta.setSelectionRange(ta.value.length,ta.value.length);
    ta.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await delay(100)
}
const text = (app, selector) => app.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent || ''`)

async function main() {
  console.log('ARTIFACTS', artifacts)
  if (process.argv.includes('--yolo') || process.argv.includes('--settings') || process.argv.includes('--terminal') || process.argv.includes('--extension-ui') || process.argv.includes('--workspace-ui') || process.argv.includes('--runtime-env') || process.argv.includes('--session-health') || process.argv.includes('--session-actions')) {
    await require('./gui-fixture-smoke.cjs')({ launch, stop, waitFor, pass, fill, text, results, workspace, profile, repo, artifacts, descendants })
    return
  }
  let app = await launch()
  pass('built renderer + preload + startup restore')
  if (process.argv.includes('--advanced')) {
    await require('./advanced-smoke.cjs')({ app, waitFor, pass, fill, text, results, workspace, artifacts })
    return
  }
  const owned = descendants(app.child.pid).map(processInfo)
  fs.writeFileSync(path.join(artifacts, 'owned-processes.json'), JSON.stringify(owned, null, 2))
  console.log('OWNED_WORKSPACE_PROCESSES', owned.filter(p => p.cwd === workspace))

  await waitFor(() => app.eval(`document.querySelector('select[title="标题栏模型"]')?.options.length > 1`), 'model list')
  await waitFor(() => app.eval(`document.querySelector('select[title="标题栏思考"]')?.options.length>1`), 'thinking choices in title bar')
  const selectors = await app.eval(`[...document.querySelectorAll('.tb-details select,.input-options select')].map(s=>({title:s.title,value:s.value,count:s.options.length}))`)
  assert.equal(selectors.length, 3)
  assert.ok(await app.eval(`!!document.querySelector('input[aria-label="YOLO"]')`))
  assert.equal(await app.eval(`document.querySelectorAll('.input-options select').length`), 1)
  const oldThinking = selectors.find(s => s.title === '标题栏思考').value
  const nextThinking = await app.eval(`(()=>{const s=document.querySelector('select[title="标题栏思考"]');const next=[...s.options].find(o=>o.value!==s.value&&o.value!=='off');s.value=next.value;s.dispatchEvent(new Event('change',{bubbles:true}));return next.value})()`)
  await waitFor(() => app.eval(`document.querySelector('.tb-thinking').textContent===${JSON.stringify('思考：' + nextThinking)}`), 'title reflects thinking-depth change')
  await app.eval(`(()=>{const s=document.querySelector('select[title="标题栏思考"]');s.value=${JSON.stringify(oldThinking)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await waitFor(() => app.eval(`document.querySelector('select[title="标题栏思考"]').value===${JSON.stringify(oldThinking)}&&document.querySelector('.tb-thinking').textContent===${JSON.stringify('思考：' + (oldThinking === 'off' ? '关闭（off）' : oldThinking))}`), 'restore thinking depth')
  pass('model and thinking selectors + textual title stay synchronized', selectors)

  const failed = await app.eval(`(async()=>{const start=Date.now();try{await window.spi.openSession({cwd:${JSON.stringify(path.join(artifacts, 'missing'))}});return {unexpected:true}}catch(e){return {message:String(e),ms:Date.now()-start}}})()`)
  assert.ok(failed.message?.includes('目录不存在'), JSON.stringify(failed))
  assert.ok(failed.ms < 2000)
  pass('missing cwd fails immediately', failed)

  await fill(app, '这是 sPi 客户端烟雾测试。仅用 bash 执行 printf SPI_TOOL_OUTPUT，然后只回复 SPI_SMOKE_OK。不要读写文件。')
  await waitFor(() => app.eval(`!!document.querySelector('.btn-send:not([disabled])')`), 'send enabled')
  await app.eval(`document.querySelector('.btn-send').click()`)
  await waitFor(() => app.eval(`window.__smokeEvents.some(e=>e.event.type==='agent_start')`), 'agent start')
  const activeSession = await app.eval(`document.querySelector('.session-tab.active').dataset.sessionId`)
  await app.eval(`window.spi.setYolo(${JSON.stringify(activeSession)},true)`)
  await waitFor(() => app.eval(`window.__smokeEvents.some(e=>e.event.type==='agent_settled')`), 'agent settled', 90000)
  const reply = await text(app, '.chat-messages')
  assert.ok(reply.includes('SPI_SMOKE_OK'), reply.slice(-1200))
  const output = await text(app, '.tool-output-text')
  assert.ok(output.includes('SPI_TOOL_OUTPUT'), output)
  assert.equal(await app.eval(`document.querySelectorAll('.msg.user').length`), 1, 'One click must send one prompt')
  const sessionId = await app.eval(`window.__smokeEvents.find(e=>e.event.type==='agent_start').sessionId`)
  assert.ok((await text(app, '.tb-name')).startsWith('这是 sPi 客户端烟雾测试'), 'Title should show first-message summary rather than directory name')
  pass('one prompt → stream → bash output → answer → idle', { sessionId, output })
  const screenshot = await app.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(artifacts, 'chat.png'), Buffer.from(screenshot.data, 'base64'))

  await fill(app, '@smoke')
  await waitFor(() => app.eval(`!!document.querySelector('.completion-item')`), '@ completion')
  assert.ok((await text(app, '.completion-popup')).includes('smoke.txt'))
  await app.eval(`document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}))`)
  assert.equal(await app.eval('document.querySelector("textarea").value'), 'smoke.txt ')
  pass('@ file completion')

  await fill(app, '/')
  await waitFor(() => app.eval(`!!document.querySelector('.completion-item')`), '/ commands')
  pass('/ command completion', { count: await app.eval(`document.querySelectorAll('.completion-item').length`) })
  await fill(app, 'SPI_DRAFT_A')
  await app.eval(`document.querySelector('.btn-new').click()`)
  await waitFor(() => app.eval(`document.querySelectorAll('.session-tab').length===2`), 'second session')
  assert.equal(await app.eval('document.querySelector("textarea").value'), '')
  await fill(app, 'SPI_DRAFT_B')
  await app.eval(`document.querySelectorAll('.session-tab')[0].click()`)
  await waitFor(() => app.eval(`document.querySelector('textarea').value==='SPI_DRAFT_A'`), 'draft A')
  assert.ok((await text(app, '.chat-messages')).includes('SPI_SMOKE_OK'))
  await app.eval(`document.querySelectorAll('.session-tab')[1].click()`)
  await waitFor(() => app.eval(`document.querySelector('textarea').value==='SPI_DRAFT_B'`), 'draft B')
  await app.eval(`document.querySelectorAll('.session-tab')[0].click()`)
  pass('two independent sessions: output and drafts survive tab switches')

  const beforeModel = await app.eval(`document.querySelector('select[title="标题栏模型"]').value`)
  const afterModel = await app.eval(`(() => {const s=document.querySelector('select[title="标题栏模型"]');const opt=[...s.options].find(o=>o.value!==s.value&&o.textContent.includes('gemini'));if(!opt)throw Error('No Gemini test model');s.value=opt.value;s.dispatchEvent(new Event('change',{bubbles:true}));return opt.value})()`)
  await waitFor(() => app.eval(`window.spi.getState(${JSON.stringify(sessionId)}).then(s=>(s.model.provider+'/'+s.model.id)===${JSON.stringify(afterModel)})`), 'model switched in pi')
  const levels = await app.eval(`window.spi.getAvailableThinkingLevels(${JSON.stringify(sessionId)})`)
  await waitFor(() => app.eval(`JSON.stringify([...document.querySelectorAll('select[title="标题栏思考"] option')].map(o=>o.value))===${JSON.stringify(JSON.stringify(levels))}`), 'thinking level options reloaded')
  const switchedState = await app.eval(`window.spi.getState(${JSON.stringify(sessionId)})`)
  await waitFor(() => app.eval(`document.querySelector('.tb-model').textContent===${JSON.stringify('模型：' + switchedState.model.name)}`), 'title reflects selected model')
  pass('model switch matches real pi state + thinking levels', { beforeModel, afterModel, levels })

  await app.eval(`(() => {const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;canvas.getContext('2d').fillStyle='red';canvas.getContext('2d').fillRect(0,0,100,100);return new Promise(resolve=>canvas.toBlob(blob=>{const dt=new DataTransfer();dt.items.add(new File([blob],'smoke.png',{type:'image/png'}));document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));resolve(true)}))})()`)
  await waitFor(() => app.eval(`document.querySelectorAll('.image-preview img').length===1`), 'image preview')
  await app.eval(`document.querySelector('.image-preview-remove').click()`)
  assert.equal(await app.eval(`document.querySelectorAll('.image-preview').length`), 0)
  pass('image paste preview + remove (not model recognition)')

  const layout = await app.eval('window.spi.loadLayout()')
  assert.equal(layout.sessions.length, 2)
  assert.ok(layout.sessions[0].sessionPath)
  assert.equal(app.errors.length, 0, JSON.stringify(app.errors))
  fs.writeFileSync(path.join(artifacts, 'layout-before-restart.json'), JSON.stringify(layout, null, 2))
  await stop(app)
  app = await launch()
  await waitFor(() => app.eval(`document.querySelectorAll('.session-tab').length===2`), 'restore both tabs', 30000)
  await app.eval(`document.querySelectorAll('.session-tab')[0].click()`)
  await waitFor(() => app.eval(`document.querySelector('.chat-messages')?.textContent.includes('SPI_SMOKE_OK')`), 'history restored')
  pass('restart built app: two sessions + history restored')
  await app.eval(`document.querySelectorAll('.session-tab-close')[0].click()`)
  await waitFor(() => app.eval(`document.querySelectorAll('.session-tab').length===1`), 'close only selected session')
  assert.ok(await app.eval(`!!document.querySelector('textarea')`))
  pass('close one session leaves the other usable')
  assert.equal(app.errors.length, 0, JSON.stringify(app.errors))
  pass('no renderer exceptions / error-level browser logs')
}

const watchdog = setTimeout(() => { console.error('SMOKE global timeout'); finish(1) }, process.argv.includes('--advanced') || process.argv.includes('--yolo') || process.argv.includes('--settings') || process.argv.includes('--terminal') || process.argv.includes('--extension-ui') || process.argv.includes('--workspace-ui') ? 300000 : 210000)
let finishing = false
async function finish(code) {
  if (finishing) return
  finishing = true
  clearTimeout(watchdog)
  for (const app of apps) {
    if (!app.exited && app.eval) {
      try {
        const snapshot = await app.eval(`({events:window.__smokeEvents,body:document.body.innerText.slice(-16000)})`)
        fs.writeFileSync(path.join(artifacts, `page-${app.index}-snapshot.json`), JSON.stringify(snapshot, null, 2))
      } catch (error) { console.error('SNAPSHOT', error.message) }
    }
    try { await stop(app) } catch (error) { console.error('CLEANUP', error.message) }
    fs.writeFileSync(path.join(artifacts, `electron-${app.index}.log`), app.log)
    fs.writeFileSync(path.join(artifacts, `renderer-${app.index}-errors.json`), JSON.stringify(app.errors, null, 2))
  }
  fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ passed: code===0, results }, null, 2))
  console.log('RESULT', code===0 ? 'PASS' : 'FAIL', 'ARTIFACTS', artifacts)
  process.exit(code)
}
main().then(() => finish(results.some(r => !r.passed) ? 1 : 0), error => {
  console.error('SMOKE FAIL', error.stack)
  results.push({ name: error.message, passed: false })
  finish(1)
})
