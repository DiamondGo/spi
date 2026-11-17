const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const ts = require('typescript')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spi-app-updates-unit-'))
const file = path.join(tmp, 'updates.cjs')
fs.writeFileSync(file, ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/main/updates.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText)
const { AppUpdates, updateRoot, updateBinDirectory, trackManagedRuntime, installerRunner } = require(file)
let checks = 0
const test = async (name, fn) => { await fn(); console.log('PASS', name); checks++ }
const target = process.platform + '-' + process.arch
const root = path.join(tmp, 'managed')
const entry = process.platform === 'darwin' ? 'app/sPi.app/Contents/MacOS/sPi' : 'app/spi'
const result = { currentVersion: '0.3.2', version: '0.3.3', available: true, supported: true, target,
  file: `spi-0.3.3-${target}${process.platform === 'linux' ? '.tar.gz' : '.zip'}`, size: 100, releaseUrl: 'https://github.com/DiamondGo/spi/releases/tag/v0.3.3' }
function service(run) { const changes = []; return { updates: new AppUpdates({ version: '0.3.2', target, root, home: tmp, run, changed: state => changes.push(state) }), changes } }
function installed() {
  const entryPath = path.join(root, 'releases/0.3.3', target, entry)
  fs.mkdirSync(path.dirname(entryPath), { recursive: true }); fs.writeFileSync(entryPath, '#!/bin/sh\n', { mode: 0o755 })
  return { version: '0.3.3', target, entry, entryPath }
}
;(async () => {
  await test('read-only state and no implicit install/network access', async () => {
    let calls = 0; const { updates } = service(async () => { calls++; return result })
    assert.equal(updates.snapshot().phase, 'idle'); assert.equal(calls, 0)
    await assert.rejects(updates.install(), /Check/); assert.throws(() => updates.restartExecutable(), /ready/); assert.equal(calls, 0)
    const snapshot = updates.snapshot(); snapshot.phase = 'ready'; assert.equal(updates.snapshot().phase, 'idle')
  })
  await test('deduplicated exact-version stable checking and progress/installation/restart target', async () => {
    let resolveCheck, resolveInstall, calls = [], progress
    const { updates, changes } = service((args, report) => { calls.push(args); if (args[0] === 'check-update') return new Promise(r => resolveCheck = r); progress = report; return new Promise(r => resolveInstall = r) })
    const first = updates.check(); assert.equal(updates.check(), first); assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], ['check-update', '--current-version', '0.3.2', '--json'])
    resolveCheck(result); assert.equal((await first).phase, 'available')
    const installation = updates.install(); assert.equal(updates.install(), installation); assert.equal(calls.length, 2)
    assert.deepEqual(calls[1], ['install', '--version', '0.3.3', '--install-dir', root, '--bin-dir', path.join(tmp, '.local/bin'), '--json'])
    assert.equal(updates.busy, true); assert.equal(updates.check(), installation)
    progress('Downloading runtime: 1/2 MiB (50%), 1 KiB/s, attempt 1/3'); assert.equal(updates.snapshot().percent, 50)
    resolveInstall(installed()); assert.equal((await installation).phase, 'ready'); assert.equal(updates.busy, false)
    assert.equal(updates.restartExecutable(), installed().entryPath)
    assert.equal((await updates.check()).phase, 'ready'); assert.equal(calls.length, 2)
    fs.rmSync(installed().entryPath); assert.throws(() => updates.restartExecutable(), /ready/)
    assert.ok(changes.some(s => s.phase === 'installing' && s.percent === 50))
  })
  await test('unsupported platform is announced but never installed', async () => {
    let calls = 0; const { updates } = service(async () => { calls++; return { ...result, supported: false, file: undefined, size: undefined } })
    assert.equal((await updates.check()).phase, 'available'); await assert.rejects(updates.install(), /supported/); assert.equal(calls, 1)
  })
  await test('offline failures retry without claiming a new version', async () => {
    let fail = true; const { updates } = service(async () => { if (fail) throw Error('offline'); return result })
    assert.equal((await updates.check()).phase, 'error'); assert.equal(updates.snapshot().available, undefined)
    fail = false; assert.equal((await updates.check()).phase, 'available'); assert.equal(updates.snapshot().error, undefined)
  })
  await test('failed install preserves new-version notice and allows explicit retry', async () => {
    let fail = true; const { updates } = service(async args => { if (args[0] === 'check-update') return result; if (fail) throw Error('checksum mismatch'); return installed() })
    await updates.check(); assert.equal((await updates.install()).phase, 'error'); assert.equal(updates.snapshot().available, true)
    assert.throws(() => updates.restartExecutable(), /ready/); fail = false; assert.equal((await updates.install()).phase, 'ready')
  })
  await test('metadata binds version, repository, architecture, archive and bounded size', async () => {
    for (const patch of [{ currentVersion: '0.1.0' }, { target: 'other-arch' }, { version: '../bad' }, { available: 'yes' }, { supported: 'yes' }, { releaseUrl: 'https://evil.invalid/a' }, { file: '../payload' }, { file: 'spi-0.3.3-other.zip' }, { size: -1 }, { size: 800 * 1024 * 1024 }]) {
      const { updates } = service(async () => ({ ...result, ...patch })); assert.equal((await updates.check()).phase, 'error', JSON.stringify(patch)); assert.throws(() => updates.restartExecutable())
    }
  })
  await test('installed executable must match exact version/architecture and remain in release tree', async () => {
    const valid = installed(), outside = path.join(tmp, 'outside'); fs.writeFileSync(outside, 'x')
    for (const patch of [{ version: '0.0.1' }, { target: 'other' }, { entry: 'app/../escape' }, { entryPath: outside }, { entry: '../outside' }]) {
      const { updates } = service(async args => args[0] === 'check-update' ? result : { ...valid, ...patch }); await updates.check(); assert.equal((await updates.install()).phase, 'error'); assert.throws(() => updates.restartExecutable())
    }
    const symlinkPath = path.join(path.dirname(valid.entryPath), 'escape'); fs.symlinkSync(outside, symlinkPath)
    const { updates } = service(async args => args[0] === 'check-update' ? result : { ...valid, entry: entry.replace(/[^/]+$/, 'escape'), entryPath: symlinkPath })
    await updates.check(); assert.equal((await updates.install()).phase, 'error')
  })
  await test('custom root detection preserves managed installs; manual apps migrate without overwrite', async () => {
    const valid = installed(); fs.writeFileSync(path.join(root, '.spi-owned.json'), JSON.stringify({ owner: 'sPi-installer-v1' }))
    assert.equal(updateRoot(valid.entryPath), root)
    assert.equal(updateRoot('/Applications/sPi.app/Contents/MacOS/sPi', 'darwin', tmp), path.join(tmp, 'Library/Application Support/sPi'))
  })
  await test('direct managed relaunch records protect the live runtime from uninstall and clean up on exit', () => {
    const executable = installed().entryPath
    const stop = trackManagedRuntime(executable)
    const records = fs.readdirSync(path.join(root, '.running'))
    assert.equal(records.length, 1)
    const record = JSON.parse(fs.readFileSync(path.join(root, '.running', records[0]), 'utf8'))
    assert.equal(record.pid, process.pid)
    if (process.platform === 'linux') assert.match(record.start, /^\d+$/)
    stop(); assert.deepEqual(fs.readdirSync(path.join(root, '.running')), [])
    const manual = path.join(tmp, 'manual/spi'); fs.mkdirSync(path.dirname(manual)); fs.writeFileSync(manual, 'x')
    trackManagedRuntime(manual)(); assert.deepEqual(fs.readdirSync(path.dirname(manual)), ['spi'])
  })
  await test('unowned PATH commands and symlinks are preserved with a private managed command fallback', () => {
    const normal = path.join(tmp, '.local/bin'), command = path.join(normal, 'spi')
    fs.mkdirSync(normal, { recursive: true }); fs.writeFileSync(command, 'unrelated user command')
    assert.equal(updateBinDirectory(root, tmp), path.join(root, 'bin')); assert.equal(fs.readFileSync(command, 'utf8'), 'unrelated user command')
    fs.rmSync(command); fs.symlinkSync(path.join(tmp, 'missing-command'), command)
    assert.equal(updateBinDirectory(root, tmp), path.join(root, 'bin')); fs.rmSync(command)
    const owned = path.join(tmp, 'custom/bin/spi'); fs.mkdirSync(path.dirname(owned), { recursive: true }); fs.writeFileSync(owned, 'owned shim')
    const sha256 = require('node:crypto').createHash('sha256').update('owned shim').digest('hex')
    fs.writeFileSync(path.join(root, 'install-state.json'), JSON.stringify({ owner: 'sPi-installer-v1', shims: [{ path: owned, sha256 }] }))
    assert.equal(updateBinDirectory(root, tmp), path.dirname(owned)); fs.writeFileSync(owned, 'user modified')
    assert.equal(updateBinDirectory(root, tmp), normal); assert.equal(fs.readFileSync(owned,'utf8'), 'user modified')
  })
  await test('private runtime runner has bounded JSON output, no shell/npm, and strips release overrides', async () => {
    const helper = path.join(tmp, 'helper.cjs')
    fs.writeFileSync(helper, `console.error('[sPi] Downloading runtime: 1/2 MiB (50%)'); console.log(JSON.stringify({argv:process.argv.slice(2), env:process.env.SPI_RELEASE_REPOSITORY || null, node:process.env.ELECTRON_RUN_AS_NODE}))`)
    const previous = process.env.SPI_RELEASE_REPOSITORY; process.env.SPI_RELEASE_REPOSITORY = 'wrong/repository'
    try {
      const lines = [], value = await installerRunner(process.execPath, helper)(['check-update', '--json'], line => lines.push(line))
      assert.deepEqual(value, { argv: ['check-update', '--json'], env: null, node: '1' }); assert.equal(lines.length, 1)
    } finally { if (previous === undefined) delete process.env.SPI_RELEASE_REPOSITORY; else process.env.SPI_RELEASE_REPOSITORY = previous }
    fs.writeFileSync(helper, `console.log('not json')`); await assert.rejects(installerRunner(process.execPath, helper)([]), /response/)
    fs.writeFileSync(helper, `console.error('failed fixture');process.exitCode=1`); await assert.rejects(installerRunner(process.execPath, helper)([]), /failed fixture/)
  })
  console.log(`${checks} app update checks passed`)
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => fs.rmSync(tmp, { recursive: true, force: true }))
