const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spi-permissions-unit-'))
function load(name) {
  const output = path.join(tmp, name + '.cjs')
  const source = fs.readFileSync(path.join(__dirname, '../src/main/pi', name + '.ts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
  fs.writeFileSync(output, compiled.outputText)
  return require(output)
}
const { Permissions, permissionKey } = load('permissions')
const file = path.join(tmp, 'profile/spi-permissions.json')
let p = new Permissions(file, () => {})
let seq = 0
let checks = 0
const bash = { command: 'printf SAFE' }
function check(name, fn) { fn(); checks++; console.log('PASS', name) }
function request(session = 'a', input = bash, cwd = '/work', tool = 'bash') {
  const r = { id: String(++seq), result: undefined }
  p.request(session, r.id, cwd, tool, input, allow => { r.result = allow })
  return r
}
function answer(r, decision, session = 'a') { p.answer(session, r.id, decision) }
p.open('a'); p.ready('a'); p.open('b'); p.ready('b')
check('default asks; single approval does not remember', () => {
  assert.equal(p.snapshot().sessions.a.mode, 'ask')
  const first = request(); assert.equal(first.result, undefined); answer(first, 'once'); assert.equal(first.result, true)
  const again = request(); assert.equal(again.result, undefined); answer(again, 'deny'); assert.equal(again.result, false)
})
check('session remembers only exact command and cwd, isolated from peer', () => {
  answer(request(), 'session'); assert.equal(request().result, true)
  for (const changed of [request('b'), request('a', { command: 'printf SAFE; touch unsafe' }), request('a', bash, '/other')]) {
    assert.equal(changed.result, undefined)
  }
  p.cancel('a'); p.cancel('b')
})
check('ask mode ignores previous session grants', () => {
  p.setMode('a', 'ask'); const r = request(); assert.equal(r.result, undefined); answer(r, 'once')
})
check('whitelist persists only under sPi profile and only whitelist mode uses it', () => {
  answer(request(), 'whitelist'); assert.equal(request().result, true)
  assert.equal(p.snapshot().rules.length, 1)
  assert.ok(fs.existsSync(file))
  const peer = request('b'); assert.equal(peer.result, undefined); answer(peer, 'deny', 'b')
  p.setMode('b', 'allowlist'); assert.equal(request('b').result, true)
})
check('shell timeout ignored, command quoting and newlines not normalized', () => {
  assert.equal(permissionKey('/work', 'bash', bash), permissionKey('/work', 'bash', { ...bash, timeout: 20 }))
  assert.notEqual(permissionKey('/work', 'bash', bash), permissionKey('/work', 'bash', { command: 'printf SAFE\nwhoami' }))
  assert.notEqual(permissionKey('/work', 'bash', bash), permissionKey('/work', 'powershell', bash))
})
check('non-shell grants include complete arguments, including file body', () => {
  const input = { path: 'x', content: 'one' }
  answer(request('a', input, '/work', 'write'), 'session')
  assert.equal(request('a', { content: 'one', path: 'x' }, '/work', 'write').result, true)
  const changed = request('a', { path: 'x', content: 'two' }, '/work', 'write')
  assert.equal(changed.result, undefined); answer(changed, 'deny')
})
check('cancel denies pending and stale / wrong-session approval is rejected', () => {
  const r = request('a', { command: 'printf CANCEL' })
  assert.throws(() => answer(r, 'once', 'b'))
  p.cancel('a'); assert.equal(r.result, false); assert.throws(() => answer(r, 'once'))
})
check('changing mode does not implicitly approve pending requests', () => {
  const r = request('a', { command: 'printf PENDING' })
  p.setMode('a', 'all'); assert.equal(r.result, undefined); answer(r, 'deny')
  assert.equal(request('a', { command: 'printf NEW' }).result, true)
})
check('clear remembered grants; removing rule revokes later approvals', () => {
  p.setMode('a', 'remember'); p.clear('a')
  const r = request(); assert.equal(r.result, undefined); answer(r, 'deny')
  p.removeRule(p.snapshot().rules[0].id)
  const b = request('b'); assert.equal(b.result, undefined); answer(b, 'deny', 'b')
})
check('manual rule is exact and deduplicated; invalid modes rejected', () => {
  p.addRule('/work', 'git status'); p.addRule('/work', 'git status'); assert.equal(p.snapshot().rules.length, 1)
  assert.throws(() => p.addRule('', 'x')); assert.throws(() => p.setMode('a', 'oops'))
  assert.throws(() => p.setDefault('all')); assert.throws(() => p.addRule('/work', ''))
})
check('all mode and session memory never survive close or restart', () => {
  p.setMode('a', 'all'); p.close('a'); p.open('a'); p.ready('a')
  assert.equal(p.snapshot().sessions.a.mode, 'ask'); assert.equal(p.snapshot().sessions.a.remembered, 0)
  p.setDefault('allowlist')
  const next = new Permissions(file, () => {}); next.open('c'); next.ready('c')
  assert.equal(next.snapshot().sessions.c.mode, 'allowlist'); assert.equal(next.snapshot().rules.length, 1)
  p.close('a'); p.close('b'); p = next
})
check('not-ready gate refuses even with permissive settings', () => {
  p.open('a'); p.setMode('a', 'all'); assert.equal(request().result, false); p.ready('a')
})
check('stop refuses new requests until the next agent run begins', () => {
  p.stop('a'); assert.equal(request().result, false)
  p.begin('a'); assert.equal(request().result, true)
})
check('failed whitelist persistence never approves the command', () => {
  const bad = path.join(tmp, 'cannot-replace-directory')
  const gate = new Permissions(bad, () => {})
  gate.open('test'); gate.ready('test')
  let result
  gate.request('test', 'save-fails', '/work', 'bash', bash, allow => { result = allow })
  fs.mkdirSync(bad)
  assert.throws(() => gate.answer('test', 'save-fails', 'whitelist'))
  assert.equal(result, undefined); assert.equal(gate.snapshot().rules.length, 0)
  gate.close('test'); assert.equal(result, false)
})
check('corrupt permission file fails closed', () => {
  fs.writeFileSync(path.join(tmp, 'broken.json'), '{bad')
  assert.throws(() => new Permissions(path.join(tmp, 'broken.json'), () => {}))
})
check('extension blocks denial, missing UI and aborted calls; protects user_bash', () => {
  process.env.SPI_PERMISSION_TOKEN = 'unit-token'
  const handlers = {}
  load('permissionExtension').default({ on: (event, handler) => { handlers[event] = handler } })
  delete process.env.SPI_PERMISSION_TOKEN
  assert.ok(handlers.tool_call); assert.ok(handlers.user_bash); assert.ok(handlers.session_start)
})
;(async () => {
  process.env.SPI_PERMISSION_TOKEN = 'unit-token'
  const handlers = {}
  load('permissionExtension').default({ on: (event, handler) => { handlers[event] = handler } })
  delete process.env.SPI_PERMISSION_TOKEN
  let calls = 0
  const ctx = { cwd: '/work', hasUI: true, ui: { notify() {}, select: async () => { calls++; return 'allow' } } }
  const event = { toolName: 'write', input: { path: 'x', content: 'text' } }
  assert.equal(await handlers.tool_call(event, ctx), undefined)
  assert.equal(calls, 1)
  assert.equal((await handlers.tool_call(event, { ...ctx, hasUI: false })).block, true)
  assert.equal((await handlers.tool_call(event, { ...ctx, signal: AbortSignal.abort() })).block, true)
  const denied = { ...ctx, ui: { ...ctx.ui, select: async () => 'deny' } }
  assert.equal((await handlers.tool_call(event, denied)).block, true)
  assert.equal((await handlers.user_bash({ cwd: '/work', command: 'echo x' }, denied)).result.exitCode, 1)
  console.log('PASS extension asynchronous fail-closed behavior')
  p.close('a'); p.close('c')
  console.log(`RESULT PASS (${checks + 1} checks) ${tmp}`)
})().catch(error => { console.error(error); process.exit(1) })
