const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spi-settings-unit-'))
function compile(relative) {
  return ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
}
function load(relative) {
  const filename = path.join(tmp, path.basename(relative, '.ts') + '.cjs')
  fs.writeFileSync(filename, compile(relative))
  return require(filename)
}
const { SettingsStore, themeChrome } = load('src/main/settings.ts')
const { QuitController } = load('src/main/quitController.ts')
const { translate } = load('src/shared/i18n.ts')
let count = 0
const check = async (name, fn) => { await fn(); console.log('PASS', name); count++ }
const tick = () => new Promise(resolve => setImmediate(resolve))

async function testMainClose(language, confirmOnExit, answer, ownsInstance = true, viaIPC = false, placement) {
  const home = fs.mkdtempSync(path.join(tmp, 'main-'))
  if (placement) fs.writeFileSync(path.join(home, 'spi-window.json'), JSON.stringify(placement))
  const app = new EventEmitter()
  app.getPath = () => home
  app.isPackaged = false
  app.setName = () => {}
  app.setDesktopName = name => { app.desktopName = name }
  const exitCodes = []
  app.exit = code => { exitCodes.push(code) }
  app.requestSingleInstanceLock = () => ownsInstance
  app.whenReady = () => ownsInstance ? Promise.resolve() : new Promise(() => {})
  app.quit = () => { const e = { preventDefault() { this.prevented = true } }; app.emit('before-quit', e); if (!e.prevented) app.didQuit = true }
  const windows = []
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = { id: 1, send() {}, on() {}, isDestroyed: () => false }; windows.push(this) }
    static getAllWindows() { return windows }
    static getFocusedWindow() { return windows[0] }
    setBackgroundColor(color) { this.background = color }
    setTitleBarOverlay(overlay) { this.overlay = overlay }
    maximize() { this.maximized = true }
    show() { this.shown = true }
    loadFile() {}
    loadURL() {}
  }
  const handlers = new Map()
  let dialogOptions, resolveDialog, dialogCalls = 0, stopped = 0
  class Manager {
    size = 1
    constructor(_pi, policy) { this.policy = policy }
    async open() { this.policy.open('owned'); this.policy.ready('owned'); return { sessionId: 'owned', state: {} } }
    closeAll() { stopped++ }
  }
  const electron = {
    app, screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] }, BrowserWindow: Window, ipcMain: { handle: (name, callback) => handlers.set(name, callback), on() {} }, nativeTheme: {},
    dialog: { showMessageBox: (...args) => { dialogCalls++; dialogOptions = args.at(-1); return new Promise(resolve => { resolveDialog = resolve }) } }
  }
  const filename = path.join(tmp, 'main-test.cjs')
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = module.paths
  mod.require = name => {
    if (name === 'electron') return electron
    if (name === './settings') return { SettingsStore, themeChrome }
    if (name === './windowState') return { loadWindowState: load('src/main/windowState.ts').loadWindowState, trackWindowState() {} }
    if (name === './pi/sessionFiles') return load('src/main/pi/sessionFiles.ts')
    if (name === './quitController') return { QuitController }
    if (name === './launchRequests') return load('src/main/launchRequests.ts')
    if (name === './terminalManager') return { TerminalManager: class {} }
    if (name === '../shared/i18n') return { translate }
    if (name === './pi/piFinder') return { findPi: async () => '/test/pi' }
    if (name === './pi/piManager') return { PiManager: Manager }
    if (name === './pi/yolo') return load('src/main/pi/yolo.ts')
    if (name === './pi/sessionScanner') return {}
    return require(name)
  }
  mod._compile(compile('src/main/index.ts'), filename)
  await tick()
  if (!ownsInstance) {
    assert.deepEqual(exitCodes, [0]); assert.equal(windows.length, 0); assert.equal(dialogCalls, 0); assert.equal(stopped, 0)
    assert.deepEqual(fs.readdirSync(home), []); return
  }
  assert.deepEqual(exitCodes, [])
  await handlers.get('settings:update')({}, { language, confirmOnExit, theme: 'light' })
  await handlers.get('session:open')({}, { cwd: '/test' })
  assert.equal(handlers.has('permissions:get'), false); assert.equal(handlers.has('permissions:mode'), false)
  assert.deepEqual(handlers.get('yolo:get')(), { sessions: { owned: { enabled: false, ready: true } } })
  handlers.get('yolo:set')({}, 'owned', true); assert.equal(handlers.get('yolo:get')().sessions.owned.enabled, true)
  assert.throws(() => handlers.get('yolo:set')({}, 'owned', 'all'), /boolean/)
  handlers.get('yolo:set')({}, 'owned', false)
  const win = windows[0]
  for (const name of ['sessions:rename', 'sessions:delete', 'sessions:generate-name']) await assert.rejects(handlers.get(name)({sender:{isDestroyed:()=>false}},{}),/application window/)
  win.emit('ready-to-show')
  if (placement) { assert.equal(win.maximized, true); for (const key of ['x','y','width','height']) assert.equal(win.options[key], placement.bounds[key]); assert.equal(win.shown,true) }
  if (process.platform === 'linux') assert.equal(app.desktopName, 'spi.desktop')
  assert.ok(win.options.icon.endsWith(path.join('build', 'icons', 'icon.png')))
  if (process.platform !== 'darwin') assert.equal(win.overlay.color, themeChrome.light.color)
  assert.equal(win.background, themeChrome.light.background)
  assert.throws(() => handlers.get('app:quit')({ sender: { isDestroyed: () => true } }), /closed/)
  assert.throws(() => handlers.get('app:quit')({ sender: { isDestroyed: () => false } }), /closed/)
  if (viaIPC) {
    assert.equal(await handlers.get('app:quit')({ sender: win.webContents }), true)
    await tick(); assert.equal(app.didQuit, true); assert.equal(stopped, 1); assert.equal(dialogCalls, 0); return
  }
  const e = { preventDefault() { this.prevented = true } }
  win.emit('close', e)
  assert.equal(Boolean(app.didQuit), false, 'Native close event must unwind before app.quit re-enters termination')
  assert.equal(e.prevented, true, 'Window must not be destroyed while approval is pending')
  if (confirmOnExit) {
    assert.equal(dialogCalls, 1)
    app.quit() // simultaneous quit while the close confirmation is open
    assert.equal(dialogCalls, 1)
    assert.equal(dialogOptions.defaultId, 1)
    assert.equal(dialogOptions.message, translate('确定退出 sPi 吗？', language))
    assert.ok(dialogOptions.detail.includes('1'))
    resolveDialog({ response: answer ? 0 : 1 })
    await tick(); await tick()
    assert.equal(Boolean(app.didQuit), answer)
    assert.equal(stopped, answer ? 1 : 0)
    if (!answer) {
      assert.equal(windows[0], win)
      // Disabling confirmation then closing quits without another dialog.
      await handlers.get('settings:update')({}, { confirmOnExit: false })
      win.emit('close', { preventDefault() {} })
      await tick()
      assert.equal(app.didQuit, true)
      assert.equal(dialogCalls, 1)
      assert.equal(stopped, 1)
    }
  } else {
    await tick()
    assert.equal(dialogCalls, 0); assert.equal(app.didQuit, true); assert.equal(stopped, 1)
  }
}

;(async () => {
  await check('safe defaults: dark / English / confirm enabled, no file write on read', () => {
    const file = path.join(tmp, 'new/spi-settings.json')
    assert.deepEqual(new SettingsStore(file).get(), { theme: 'dark', language: 'en', confirmOnExit: true })
    assert.equal(fs.existsSync(file), false)
  })
  await check('partial settings persist, survive restart, and are private to sPi', () => {
    const file = path.join(tmp, 'profile/spi-settings.json')
    const store = new SettingsStore(file)
    store.update({ theme: 'light' }); store.update({ language: 'zh' }); store.update({ confirmOnExit: false })
    assert.deepEqual(new SettingsStore(file).get(), { theme: 'light', language: 'zh', confirmOnExit: false })
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  })
  await check('invalid IPC patches do not change state or saved preferences', () => {
    const file = path.join(tmp, 'validation.json'), store = new SettingsStore(file)
    store.update({ language: 'zh' }); const saved = fs.readFileSync(file, 'utf8')
    for (const bad of [null, [], { theme: 'bad' }, { language: 'xx' }, { confirmOnExit: 'false' }, { arbitrary: true }]) assert.throws(() => store.update(bad))
    assert.equal(fs.readFileSync(file, 'utf8'), saved)
  })
  await check('unknown/corrupt saved values retain safe defaults; valid fields are preserved', () => {
    const file = path.join(tmp, 'invalid.json')
    fs.writeFileSync(file, JSON.stringify({ theme: 'unknown', language: 'zh', confirmOnExit: 'no' }))
    assert.deepEqual(new SettingsStore(file).get(), { theme: 'dark', language: 'zh', confirmOnExit: true })
    fs.writeFileSync(file, '{broken')
    const original = console.error; console.error = () => {}
    try { assert.equal(new SettingsStore(file).get().confirmOnExit, true) } finally { console.error = original }
  })
  await check('failed save never changes the in-memory settings', () => {
    const file = path.join(tmp, 'cannot-replace-directory'), store = new SettingsStore(file)
    fs.mkdirSync(file); assert.throws(() => store.update({ theme: 'light' }))
    assert.equal(store.get().theme, 'dark')
  })
  await check('all three native title-bar palettes exist', () => {
    assert.deepEqual(Object.keys(themeChrome), ['dark', 'light', 'high-contrast'])
    assert.equal(themeChrome['high-contrast'].symbolColor, '#ffffff')
  })
  await check('English/Chinese interpolation preserves user-provided content', () => {
    assert.equal(translate('模型：{name}', 'en', { name: '中文 model' }), 'Model: 中文 model')
    assert.equal(translate('模型：{name}', 'zh', { name: 'English model' }), '模型：English model')
  })
  await check('renderer translation calls all have English catalog entries', () => {
    function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []) }
    const missing = []
    for (const file of files(path.join(root, 'src/renderer/src'))) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      function walk(node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && ts.isStringLiteral(node.arguments[0]) && /[\u3400-\u9fff]/.test(node.arguments[0].text)) {
          if (/[\u3400-\u9fff]/.test(translate(node.arguments[0].text, 'en'))) missing.push(node.arguments[0].text)
        }
        ts.forEachChild(node, walk)
      }
      walk(source)
    }
    assert.deepEqual(missing, [])
  })
  await check('concurrent quit requests share one dialog; cancel keeps the app alive', async () => {
    let resolve, asks=0, exits=0
    const q=new QuitController(()=>true,()=>{asks++;return new Promise(r=>{resolve=r})},()=>exits++)
    const a=q.request(), b=q.request(); assert.equal(a,b); assert.equal(asks,1)
    resolve(false); assert.equal(await a,false); assert.equal(q.allowed,false); assert.equal(exits,0)
    const c=q.request(); resolve(true); assert.equal(await c,true); assert.equal(q.allowed,true); assert.equal(exits,1)
    await q.request(); assert.equal(exits,1)
  })
  await check('confirmation off skips dialog; dialog failure never quits', async () => {
    let exits=0
    const off=new QuitController(()=>false,()=>{throw Error('must not ask')},()=>exits++)
    assert.equal(await off.request(),true); assert.equal(exits,1)
    const failed=new QuitController(()=>true,async()=>{throw Error('dialog failed')},()=>exits++)
    await assert.rejects(failed.request()); assert.equal(failed.allowed,false); assert.equal(exits,1)
  })
  await check('secondary instance exits before readiness without creating a window/profile or quit dialog', () => testMainClose('en',true,false,false))
  await check('real main close handler: English cancel retains window and sessions', () => testMainClose('en',true,false))
  await check('real main close handler: Chinese confirmation commits once', () => testMainClose('zh',true,true))
  await check('real main close handler: disabling confirmation exits immediately', () => testMainClose('en',false,true))
  await check('real main startup restores normal bounds and maximizes before showing the window',()=>testMainClose('en',false,true,true,true,{bounds:{x:150,y:90,width:1000,height:700},maximized:true}))
  await check('renderer app quit validates its owning window and uses normal cleanup', () => testMainClose('en',false,true,true,true))
  console.log(`RESULT PASS ${count} checks ${tmp}`)
})().catch(error => { console.error(error); process.exitCode=1 })
