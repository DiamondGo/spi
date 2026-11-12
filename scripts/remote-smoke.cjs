// Two isolated sPi instances on a loopback relay (SPI_TEST_REMOTE=loopback): pair, drive the
// host through a remote window, survive relay drops and a host restart, then revoke.
// With --live the same flow runs over the real Dev Tunnels service using the signed-in GitHub CLI;
// the tunnel the host created is deleted afterwards.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

async function tcpProxy(targetPort) {
  const sockets = new Set()
  const server = net.createServer(inbound => {
    const outbound = net.connect(targetPort, '127.0.0.1')
    for (const s of [inbound, outbound]) { sockets.add(s); s.on('error', () => {}); s.on('close', () => { sockets.delete(s); inbound.destroy(); outbound.destroy() }) }
    inbound.pipe(outbound); outbound.pipe(inbound)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const drop = () => { for (const s of sockets) s.destroy() }
  return { port: server.address().port, drop, close: () => new Promise(r => { drop(); server.close(() => r()) }) }
}
// The code is test-only and never printed; only its relay port is redirected through the proxy.
function viaPort(code, port) {
  const raw = JSON.parse(Buffer.from(code.slice('spi1.'.length), 'base64url').toString('utf8'))
  return { hostPort: raw.a.port, code: 'spi1.' + Buffer.from(JSON.stringify({ ...raw, a: { ...raw.a, port } })).toString('base64url') }
}

/** Deletes the host's tunnel with the user's gh token (kept in memory, never printed); returns true once it is gone. */
async function deleteLiveTunnel(hostStateFile) {
  const saved = fs.existsSync(hostStateFile) ? JSON.parse(fs.readFileSync(hostStateFile, 'utf8')).tunnel : null
  if (!saved?.tunnelId) return false
  const { TunnelManagementHttpClient, ManagementApiVersions } = require('@microsoft/dev-tunnels-management')
  const token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', env: { ...process.env, GH_PROMPT_DISABLED: '1' } }).trim()
  const management = new TunnelManagementHttpClient({ name: 'spi-smoke', version: '0' }, ManagementApiVersions.Version20230927preview, async () => 'github ' + token)
  const id = { tunnelId: saved.tunnelId, clusterId: saved.clusterId }
  // deleteTunnel returns false on 404; getTunnel throws on 404.
  const deleted = await management.deleteTunnel(id)
  try { await management.getTunnel(id); return false } catch (error) { if (error?.response?.status !== 404) throw error }
  return deleted
}

module.exports = async function ({ app: host, launch, stop, waitFor, pass, fill, results, artifacts, profile, workspace, connectPage }) {
  const live = process.argv.includes('--live')
  const relayMs = live ? 120000 : 20000
  // The client bounds the display name returned by the host hello to 64 characters.
  const hostName = os.hostname().trim().slice(0, 64)
  const capture = async (page, name) => { const s = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(artifacts, name + '.png'), Buffer.from(s.data, 'base64')) }
  const openSettings = async page => {
    await page.eval(`document.querySelector('.app-settings-button').click()`)
    await waitFor(() => page.eval(`!!document.querySelector('.app-settings-dialog')?.open`), 'settings dialog open')
  }
  const closeSettings = async page => {
    await page.eval(`document.querySelector('.settings-close').click()`)
    await waitFor(() => page.eval(`!document.querySelector('.app-settings-dialog')`), 'settings dialog closed')
  }
  let client, remote, proxy, observer, observerRemote
  const heaps = {}
  const checkHeap = async phase => {
    for (const [name, page] of [['host', host], ['client', client], ['remote', remote]]) {
      if (!page?.eval) continue
      const mb = await page.eval('Math.round(performance.memory.usedJSHeapSize/1048576)')
      ;(heaps[name] ??= []).push([phase, mb])
      assert.ok(mb < 512, `${name} renderer heap ${mb} MB after ${phase}: ${JSON.stringify(heaps)}`)
    }
  }
  const step = async (name, details) => { await checkHeap(name); pass(name, details) }
  try {
    const status = await host.eval('window.spi.getRemoteStatus()')
    assert.equal(status.relay, live ? 'devtunnels' : 'loopback', live ? 'live mode must use Dev Tunnels' : 'test mode must never use Dev Tunnels')
    assert.equal(status.host.enabled, false); assert.equal(status.host.state, 'off')

    await openSettings(host)
    if (live) await waitFor(() => host.eval(`document.querySelector('[data-remote-account]')?.dataset.remoteAccount === 'ready'`), 'GitHub CLI account ready', 30000)
    await waitFor(() => host.eval(`!!document.querySelector('[data-setting="remoteHost"]') && !document.querySelector('[data-setting="remoteHost"]').disabled`), 'remote host toggle')
    await host.eval(`document.querySelector('[data-setting="remoteHost"]').click()`)
    await waitFor(() => host.eval(`!!document.querySelector('[data-remote-host-state="online"]')`), 'host online', relayMs)
    await waitFor(() => host.eval(`!document.querySelector('[data-action="remote-add-device"]').disabled`), 'add device enabled')
    assert.equal(await host.eval(`document.querySelector('[data-setting="remotePairingHours"]').value`), '1')
    await host.eval(`(()=>{const e=document.querySelector('[data-setting="remotePairingHours"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1441');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await waitFor(() => host.eval(`document.querySelector('[data-action="remote-add-device"]').disabled`), 'over-limit lifetime rejected')
    await host.eval(`(()=>{const e=document.querySelector('[data-setting="remotePairingHours"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1440');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await waitFor(() => host.eval(`!document.querySelector('[data-action="remote-add-device"]').disabled`), '60 day lifetime accepted')
    const generatedAt = Date.now()
    await host.eval(`document.querySelector('[data-action="remote-add-device"]').click()`)
    const original = await waitFor(() => host.eval(`document.querySelector('[data-remote-pairing-code]')?.value || ''`), 'pairing code')
    assert.match(original, /^spi1\.[A-Za-z0-9_-]+$/)
    const offerExpires = JSON.parse(Buffer.from(original.slice(5), 'base64url').toString()).x
    assert.ok(offerExpires >= generatedAt + 60 * 24 * 3_600_000)
    assert.ok(offerExpires <= Date.now() + 60 * 24 * 3_600_000)
    await waitFor(() => host.eval(`document.querySelector('[data-remote-pending-device] .remote-state')?.textContent === '待配对'`), 'pending device status displayed')
    await closeSettings(host)
    await openSettings(host)
    await waitFor(() => host.eval(`!!document.querySelector('[data-remote-pending-device]')`), 'pending device survives settings close and reopen')
    assert.equal(await host.eval(`document.querySelector('[data-remote-pairing-code]')`), null, 'secret stays hidden until explicitly viewed')
    assert.equal(await host.eval(`document.querySelector('[data-action="remote-add-device"]')`), null, 'pending offer is not silently replaced')
    await host.eval(`document.querySelector('[data-action="remote-view-pairing"]').click()`)
    const recovered = await waitFor(() => host.eval(`document.querySelector('[data-remote-pairing-code]')?.value || ''`), 'recover active pairing code')
    assert.equal(recovered, original, 'closing settings must not regenerate or lose the code')
    await capture(host, 'remote-host-settings')
    let code = original
    if (!live) {
      proxy = await tcpProxy(viaPort(original, 1).hostPort)
      code = viaPort(original, proxy.port).code
    }
    await step(`host enables remote access from settings and shows a one-time pairing code${live ? ' (live Dev Tunnels)' : ''}`)

    const clientProfile = path.join(artifacts, 'profile-client')
    fs.mkdirSync(clientProfile)
    const config = JSON.parse(fs.readFileSync(path.join(profile, 'spi-config.json'), 'utf8'))
    fs.writeFileSync(path.join(clientProfile, 'spi-config.json'), JSON.stringify({ ...config, layout: { viewMode: 'dir', selectedDir: workspace, sessions: [] } }))
    fs.copyFileSync(path.join(profile, 'spi-settings.json'), path.join(clientProfile, 'spi-settings.json'))
    client = await launch({ profile: clientProfile, waitForSession: false })
    await openSettings(client)
    await waitFor(() => client.eval(`!!document.querySelector('[data-setting="remotePairCode"]') && !document.querySelector('[data-setting="remotePairCode"]').disabled`), 'pair input')
    await client.eval(`(()=>{const e=document.querySelector('[data-setting="remotePairCode"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(code)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await waitFor(() => client.eval(`!document.querySelector('[data-action="remote-pair"]').disabled`), 'pair button enabled')
    await client.eval(`document.querySelector('[data-action="remote-pair"]').click()`)
    const target = await waitFor(async () => {
      try { return (await (await fetch(client.origin + '/json/list')).json()).find(t => t.type === 'page' && t.id !== client.targetId) } catch { return null }
    }, 'remote window', relayMs)
    remote = await connectPage(target)
    remote.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data)
      if (msg.method === 'Debugger.paused') remote.paused = msg.params.callFrames.map(f => `${f.functionName || '?'} ${f.url.split('/').pop()}:${f.location.lineNumber}:${f.location.columnNumber}`)
    })
    await remote.send('Debugger.enable')
    await waitFor(() => remote.eval(`!!document.querySelector('.titlebar')`), 'remote window rendered')
    const info = await remote.eval('window.spi.getRemoteWindow()')
    assert.equal(info.state, 'connected'); assert.equal(info.hostName, hostName)
    assert.equal(await remote.eval(`document.querySelector('.tb-remote')?.textContent`), `远程：${hostName}`)
    assert.equal(await client.eval('window.spi.getRemoteWindow()'), null, 'the local window stays local')
    await waitFor(() => host.eval(`document.querySelector('[data-remote-connected]')?.dataset.remoteConnected === '1'`), 'host title shows one connected device')
    await waitFor(() => host.eval(`document.querySelector('[data-remote-device] .remote-state.connected')?.textContent === '已连接'`), 'host lists the connected device')
    assert.equal(await host.eval(`document.querySelector('[data-remote-pairing-code]')`), null, 'a used code disappears')
    assert.equal(await client.eval(`document.querySelector('[data-remote-host] .remote-state.connected')?.textContent`), '已连接')
    await remote.eval(`window.spi.getPairingCode()`).then(() => assert.fail('remote windows cannot read host pairing secrets'), error => assert.match(error.message, /local sPi window/))
    await remote.eval(`window.spi.pairRemoteHost('x')`).then(() => assert.fail('remote windows cannot manage remote access'), error => assert.match(error.message, /local sPi window/))
    await closeSettings(host); await closeSettings(client)
    await step('client pairs from settings and opens a remote window; both sides show the connection')

    // Pairing briefly uses its own connection; wait for its lease to close and
    // for the renderer's initial debounced layout save before replacing that layout.
    await waitFor(() => remote.eval(`window.spi.getRemoteWindow().then(r=>r.access==='control')`), 'initial remote controller lease')
    await waitFor(() => remote.eval(`window.spi.loadLayout().then(l=>Array.isArray(l.sessions))`), 'initial remote layout persisted')
    await remote.eval(`window.spi.saveLayout({viewMode:'dir',selectedDir:${JSON.stringify(workspace)},sessions:[{cwd:${JSON.stringify(workspace)}}]})`)
    await remote.send('Page.reload')
    await waitFor(async () => {
      try { return await remote.eval(`!!document.querySelector('.input-bar textarea') && !!document.querySelector('.session-tab.active')`) }
      catch (error) { if (/context|navigated|closed/i.test(String(error))) return false; throw error }
    }, 'remote session restored on the host', 30000)
    await remote.eval(`window.__remoteEvents=[];window.__remoteStates=[];window.spi.onPiEvent(e=>window.__remoteEvents.push(e));window.spi.onRemoteWindowChanged(s=>window.__remoteStates.push(s))`)
    const sessionId = await remote.eval(`document.querySelector('.session-tab.active').dataset.sessionId`)
    assert.ok((await host.eval(`window.spi.getState(${JSON.stringify(sessionId)})`)).sessionId, 'the session lives in the host process')
    assert.equal(await remote.eval(`[...document.querySelectorAll('[data-action="browse-node"]')].length`), 0)
    await remote.eval(`window.spi.setModel(${JSON.stringify(sessionId)},'spi-test','fixture')`)
    const prompt = async marker => {
      const before = await remote.eval(`window.__remoteEvents.filter(e=>e.event.type==='agent_settled').length`)
      await fill(remote, JSON.stringify({ tool: 'bash', input: { command: `printf ${marker}` } }))
      await waitFor(() => remote.eval(`!!document.querySelector('.btn-send:not([disabled])')`), 'send enabled')
      await remote.eval(`document.querySelector('.btn-send').click()`)
      await waitFor(() => remote.eval(`window.__remoteEvents.filter(e=>e.event.type==='agent_settled').length>${before}`), 'remote prompt settled', 60000)
      await waitFor(() => remote.eval(`[...document.querySelectorAll('.tool-output-text')].some(e=>e.textContent.includes(${JSON.stringify(marker)}))`), 'tool output in the remote window')
    }
    await prompt('SPI_REMOTE_OUTPUT')
    assert.ok((await remote.eval(`document.querySelector('.chat-messages').textContent`)).includes('SPI_FIXTURE_DONE'))
    await capture(remote, 'remote-window-chat')
    await step('a prompt typed in the remote window runs on the host and streams back', { sessionId })

    await remote.eval(`document.querySelector('.terminal-toggle').click()`)
    await waitFor(() => remote.eval(`!!document.querySelector('.terminal-panel:not([hidden]) .xterm-helper-textarea')`), 'remote xterm initialized')
    const terminal = await waitFor(() => remote.eval(`window.spi.getTerminal(${JSON.stringify(sessionId)})`), 'remote terminal created')
    const typeInTerminal = async marker => {
      await remote.eval(`window.spi.writeTerminal(${JSON.stringify(sessionId)},${JSON.stringify(terminal.terminalId)},${JSON.stringify(`printf '${marker}_%s\\n' OK\r`)})`)
      await waitFor(() => remote.eval(`document.querySelector('.terminal-panel:not([hidden]) .xterm-screen')?.textContent.includes(${JSON.stringify(marker + '_OK')})`), 'terminal output rendered remotely: ' + marker)
    }
    await typeInTerminal('SPI_REMOTE_TERM')
    assert.equal(await host.eval(`window.spi.getTerminal(${JSON.stringify(sessionId)}).catch(()=>null)`), null, 'the terminal belongs to the remote device, not the host window')
    await step('the remote window gets its own host terminal rendered by xterm')
    assert.equal(remote.errors.length, 0, JSON.stringify(remote.errors))

    const observerProfile = path.join(artifacts, 'profile-observer')
    fs.mkdirSync(observerProfile)
    fs.writeFileSync(path.join(observerProfile, 'spi-config.json'), JSON.stringify({ ...config, layout: { viewMode: 'dir', selectedDir: workspace, sessions: [] } }))
    fs.copyFileSync(path.join(profile, 'spi-settings.json'), path.join(observerProfile, 'spi-settings.json'))
    observer = await launch({ profile: observerProfile, waitForSession: false })
    const observerCode = await host.eval('window.spi.createPairingCode().then(r=>r.code)')
    await observer.eval(`window.spi.pairRemoteHost(${JSON.stringify(observerCode)}).then(r=>window.spi.connectRemoteHost(r.id))`)
    const observerTarget = await waitFor(async () => (await (await fetch(observer.origin + '/json/list')).json()).find(t => t.type === 'page' && t.id !== observer.targetId), 'read-only remote window')
    observerRemote = await connectPage(observerTarget)
    await waitFor(() => observerRemote.eval(`!!document.querySelector('[data-remote-read-only]')`), 'read-only viewer UI')
    assert.equal((await observerRemote.eval('window.spi.getRemoteWindow()')).access, 'read-only')
    assert.equal((await remote.eval('window.spi.getRemoteWindow()')).access, 'control')
    await waitFor(() => observerRemote.eval(`document.querySelector('.chat-messages')?.textContent.includes('SPI_REMOTE_OUTPUT')`), 'viewer loads existing history without opening a session')
    assert.equal(await observerRemote.eval(`document.querySelector('.input-bar')`), null)
    assert.equal(await observerRemote.eval(`document.querySelector('[data-control="yolo"]').disabled`), true)
    for (const call of [`window.spi.sendPrompt(${JSON.stringify(sessionId)},'must-not-run','normal')`, `window.spi.openTerminal(${JSON.stringify(sessionId)},80,24)`]) {
      await observerRemote.eval(call).then(() => assert.fail('read-only API must be denied by the host'), error => assert.match(error.message, /read-only/))
    }
    await prompt('SPI_VIEWER_LIVE_OUTPUT')
    await waitFor(() => observerRemote.eval(`document.querySelector('.chat-messages')?.textContent.includes('SPI_VIEWER_LIVE_OUTPUT')`), 'viewer receives controller live output')
    assert.equal(observerRemote.errors.length, 0, JSON.stringify(observerRemote.errors))
    await capture(observerRemote, 'remote-read-only-viewer')
    await observerRemote.eval('window.close()').catch(() => {})
    observerRemote.ws.close(); observerRemote = null
    // Keep the observer's local app alive until final cleanup: the shared fixture
    // waitFor tracks the most recently launched Electron parent.
    await step('a second remote is read-only, sees history and live output, and cannot bypass permissions through IPC')

    // A relay drop can only be injected on the loopback relay, where the test owns the TCP path.
    if (!live) {
      proxy.drop()
      await waitFor(() => remote.eval(`window.__remoteStates.some(s=>s.state!=='connected')`), 'drop noticed')
      // The debounced status broadcast may repeat the connected state without the resync flag.
      await waitFor(() => remote.eval(`window.__remoteStates.at(-1)?.state==='connected' && window.__remoteStates.slice(window.__remoteStates.findIndex(s=>s.state!=='connected')).some(s=>s.state==='connected'&&s.resync===true)`), 'reconnected with resync', 20000)
      await waitFor(() => remote.eval(`!document.querySelector('[data-remote-banner]')`), 'banner cleared')
      assert.equal((await remote.eval(`window.spi.getTerminal(${JSON.stringify(sessionId)})`)).terminalId, terminal.terminalId, 'the terminal survives a short drop')
      await waitFor(() => remote.eval(`!!document.querySelector('.terminal-panel:not([hidden]) .xterm-helper-textarea')`), 'terminal reattached')
      await typeInTerminal('SPI_AFTER_DROP')
      await prompt('SPI_AFTER_DROP_OUTPUT')
      await step('a relay drop reconnects, resyncs the window and keeps the terminal')
    }

    await host.eval('window.spi.setRemoteHostEnabled(false)')
    await waitFor(() => remote.eval(`!!document.querySelector('[data-remote-banner="reconnecting"],[data-remote-banner="connecting"]')`), 'disconnected banner', relayMs)
    await checkHeap('host turned off')
    await remote.eval(`window.spi.getState(${JSON.stringify(sessionId)})`).then(() => assert.fail('calls must fail while disconnected'), error => assert.match(error.message, /Not connected/))
    await capture(remote, 'remote-window-disconnected')
    await host.eval('window.spi.setRemoteHostEnabled(true)')
    await waitFor(() => remote.eval(`window.__remoteStates.at(-1)?.state==='connected'`), 'reconnected after host restart', relayMs)
    await checkHeap('host turned on again')
    await waitFor(() => remote.eval(`!document.querySelector('[data-remote-banner]')`), 'banner cleared after host restart')
    await waitFor(() => remote.eval(`!document.querySelector('.terminal-panel')`), 'terminal closed by the host restart is dropped')
    await prompt('SPI_AFTER_RESTART_OUTPUT')
    await remote.eval(`document.querySelector('.terminal-toggle').click()`)
    await waitFor(() => remote.eval(`window.spi.getTerminal(${JSON.stringify(sessionId)}).then(t=>!!t&&t.terminalId!==${JSON.stringify(terminal.terminalId)})`), 'a new terminal opens after the restart')
    await step('turning remote access off shows a banner and fails calls fast; turning it on reconnects')

    if (live) {
      const hostStateFile = path.join(profile, 'spi-remote-host.json')
      const tunnelId = () => JSON.parse(fs.readFileSync(hostStateFile, 'utf8')).tunnel?.tunnelId
      const before = tunnelId()
      await host.eval('window.spi.setRemoteHostEnabled(false)')
      await waitFor(() => remote.eval(`!!document.querySelector('[data-remote-banner]')`), 'disconnected before the tunnel is deleted', relayMs)
      assert.equal(await deleteLiveTunnel(hostStateFile), true)
      await host.eval('window.spi.setRemoteHostEnabled(true)')
      await waitFor(() => host.eval(`window.spi.getRemoteStatus().then(s=>s.host.state==='online')`), 'host online with a new tunnel', relayMs)
      assert.notEqual(tunnelId(), before, 'the host created a new tunnel')
      await waitFor(() => remote.eval(`window.__remoteStates.at(-1)?.state==='connected'`), 'client found the recreated tunnel', relayMs)
      await waitFor(() => remote.eval(`!document.querySelector('[data-remote-banner]')`), 'banner cleared after the tunnel was recreated')
      await prompt('SPI_AFTER_RECREATE_OUTPUT')
      await step('a deleted host tunnel is recreated and the client finds it again by its label')
    }

    await observer.eval('window.spi.getRemoteStatus().then(s=>window.spi.connectRemoteHost(s.hosts[0].id))')
    const promotionTarget = await waitFor(async () => (await (await fetch(observer.origin + '/json/list')).json()).find(t => t.type === 'page' && t.id !== observer.targetId), 'observer reconnects before control handoff')
    observerRemote = await connectPage(promotionTarget)
    await waitFor(() => observerRemote.eval(`!!document.querySelector('[data-remote-read-only]')`), 'observer waits read-only')
    const device = (await host.eval('window.spi.getRemoteStatus()')).host.devices.find(d => d.access === 'control')
    await host.eval(`window.spi.revokeRemoteDevice(${JSON.stringify(device.id)})`)
    await waitFor(() => remote.eval(`!!document.querySelector('[data-remote-banner="rejected"]')`), 'rejected banner', live ? relayMs : 30000)
    assert.match(await remote.eval(`document.querySelector('[data-remote-banner]').textContent`), /不再接受此设备（已被撤销/)
    assert.equal((await remote.eval('window.spi.getRemoteWindow()')).reason, 'revoked')
    await waitFor(() => observerRemote.eval(`window.spi.getRemoteWindow().then(r=>r.access==='control')`), 'viewer promoted after controller revocation')
    await waitFor(() => observerRemote.eval(`!!document.querySelector('.input-bar textarea') && !document.querySelector('[data-remote-read-only]')`), 'promoted viewer becomes writable')
    await step('revoking the controller automatically promotes the remaining read-only window')
    await observerRemote.eval('window.close()').catch(() => {})
    observerRemote.ws.close(); observerRemote = null
    await waitFor(() => host.eval(`!document.querySelector('[data-remote-connected]')`), 'host badge cleared')
    const remainingDevices = (await host.eval('window.spi.getRemoteStatus()')).host.devices
    assert.equal(remainingDevices.length, 1, 'the offline observer remains paired')
    assert.equal(remainingDevices[0].connected, false)
    await capture(remote, 'remote-window-revoked')
    await step('revoking the device disconnects the remote window for good')

    await remote.eval('window.close()').catch(() => {})
    remote.ws.close(); remote = null
    await waitFor(async () => (await (await fetch(client.origin + '/json/list')).json()).filter(t => t.type === 'page').length === 1, 'remote window closed')
    assert.equal(client.exited, false, 'closing a remote window keeps the client running')
    assert.equal(host.errors.length, 0, JSON.stringify(host.errors))
    assert.equal(client.errors.length, 0, JSON.stringify(client.errors))
    await step('closing the remote window leaves both apps running without renderer errors')

    await openSettings(host)
    await waitFor(() => host.eval(`!!document.querySelector('[data-action="remote-add-device"]:not([disabled])')`), 'add another pending device')
    await host.eval(`document.querySelector('[data-action="remote-add-device"]').click()`)
    await waitFor(() => host.eval(`!!document.querySelector('[data-remote-pending-device]')`), 'new pending entry')
    await closeSettings(host); await openSettings(host)
    await waitFor(() => host.eval(`!!document.querySelector('[data-action="remote-cancel-pending"]')`), 'pending cancel action survives reopening')
    await host.eval(`document.querySelector('[data-action="remote-cancel-pending"]').click()`)
    await waitFor(() => host.eval(`!document.querySelector('[data-remote-pending-device]') && !!document.querySelector('[data-action="remote-add-device"]')`), 'cancel removes pending entry')
    assert.equal(await host.eval('window.spi.getPairingCode()'), null)
    await step('pending devices survive settings reopening, recover the same code, and can be cancelled from the list')

    if (live) {
      await host.eval('window.spi.setRemoteHostEnabled(false)')
      assert.equal(await deleteLiveTunnel(path.join(profile, 'spi-remote-host.json')), true)
      pass('the live test tunnel was deleted from the Dev Tunnels account')
    }
  } catch (error) {
    fs.writeFileSync(path.join(artifacts, 'remote-heaps.json'), JSON.stringify(heaps, null, 2))
    for (const [name, page] of [['host', host], ['client', client], ['remote', remote]]) {
      if (!page?.eval) continue
      try {
        const diagnostic = await page.eval(`(async()=>{const r=await window.spi.getRemoteWindow();return{state:r?.state,access:r?.access,readOnly:!!document.querySelector('[data-remote-read-only]'),input:!!document.querySelector('.input-bar textarea'),tabs:document.querySelectorAll('.session-tab').length,liveSessions:await window.spi.listLiveSessions().then(s=>s.length).catch(()=>null),savedSessions:await window.spi.loadLayout().then(l=>l.sessions?.length).catch(()=>null),openError:!!document.querySelector('.session-error')}})()`)
        console.log('REMOTE FAILURE STATE', name, JSON.stringify(diagnostic))
      } catch {}
      try { fs.writeFileSync(path.join(artifacts, `remote-failure-${name}.json`), JSON.stringify(await page.eval(`({body:document.body.innerText.slice(-8000),states:window.__remoteStates})`), null, 2)) } catch (dumpError) { fs.writeFileSync(path.join(artifacts, `remote-failure-${name}.json`), JSON.stringify({ dumpError: String(dumpError) })) }
      try { await capture(page, `remote-failure-${name}`) } catch {}
    }
    if (remote?.ws) {
      remote.ws.send(JSON.stringify({ id: 1e9, method: 'Debugger.pause' }))
      await new Promise(resolve => setTimeout(resolve, 3000))
      fs.writeFileSync(path.join(artifacts, 'remote-paused-stack.json'), JSON.stringify(remote.paused ?? 'not paused', null, 2))
    }
    throw error
  } finally {
    remote?.ws?.close()
    observerRemote?.ws?.close()
    await stop(observer)
    await stop(client)
    await proxy?.close()
    if (live && results.at(-1)?.name !== 'the live test tunnel was deleted from the Dev Tunnels account') {
      try { await host.eval('window.spi.setRemoteHostEnabled(false)') } catch {}
      try { console.log('LIVE TUNNEL CLEANUP', await deleteLiveTunnel(path.join(profile, 'spi-remote-host.json')) ? 'deleted' : 'nothing to delete') }
      catch (error) { console.error('LIVE TUNNEL CLEANUP FAILED: delete the tunnel labelled spi-remote manually', error.message) }
    }
  }
}
