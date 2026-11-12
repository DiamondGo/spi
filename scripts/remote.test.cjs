const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')

const root = path.join(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spi-remote-unit-'))
// Inside the repo so the externalized SDK and @noble packages resolve from node_modules.
const bundle = path.join(root, 'node_modules/.cache/spi-remote-test/remote.cjs')
esbuild.buildSync({
  stdin: {
    contents: ['noise', 'transport', 'secure', 'rpc', 'pairing', 'protocol', 'githubCli', 'identity', 'stateFile', 'backend', 'hostService', 'clientService', 'devTunnels']
      .map(name => `export * from './${name}'`).join('\n') + "\nexport { ApiRegistry } from '../api/registry'",
    resolveDir: path.join(root, 'src/main/remote'), loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external', outfile: bundle, logLevel: 'error'
})
const R = require(bundle)

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(what, test, ms = 5000) {
  const end = Date.now() + ms
  for (;;) {
    const value = test()
    if (value) return value
    if (Date.now() > end) throw new Error('timed out waiting for ' + what)
    await delay(10)
  }
}
let count = 0
const check = async (name, fn) => { await fn(); count++; console.log('PASS', name) }
const hex = s => Uint8Array.from(Buffer.from(s, 'hex'))
const toHex = b => Buffer.from(b).toString('hex')
const fakeToken = () => 'gho_' + 'A1b2C3d4'.repeat(5)

/** In-memory ByteStream pair; transform(chunk, index) decides how bytes reach the other side. */
function memoryPair(transform = chunk => [chunk]) {
  class End {
    constructor() { this.queue = []; this.wake = null; this.ended = false; this.closed = new Promise(r => { this.resolveClosed = r }) }
    async *recv() {
      for (;;) {
        if (this.queue.length) { yield this.queue.shift(); continue }
        if (this.ended) return
        await new Promise(r => { this.wake = r })
        this.wake = null
      }
    }
    deliver(chunk) { this.queue.push(chunk); this.wake?.() }
    finish(reason) { if (this.ended) return; this.ended = true; this.resolveClosed(reason); this.wake?.() }
  }
  const a = new End(), b = new End()
  let sent = 0
  const stream = (self, other, fromClient) => ({
    closed: self.closed,
    recv: () => self.recv(),
    async send(chunk) {
      if (self.ended || other.ended) throw new Error('stream closed')
      for (const part of transform(Uint8Array.from(chunk), sent++, fromClient)) other.deliver(part)
    },
    async close(reason = 'closed') { self.finish(reason); other.finish('closed by peer') }
  })
  return [stream(a, b, true), stream(b, a, false)]
}
const splitInto = size => chunk => { const parts = []; for (let i = 0; i < chunk.length; i += size) parts.push(chunk.slice(i, i + size)); return parts }

function serverPolicy(identity, extra = {}) {
  const paired = []
  return { paired, identity, isPaired: key => paired.some(k => R.bytesEqual(k, key)), pairingPsk: () => null, onPairingFailed() {}, onPaired: key => paired.push(key), ...extra }
}
async function pairedChannels(transform) {
  const host = R.generateKeyPair(), device = R.generateKeyPair(), psk = R.randomSecret()
  const [c, s] = memoryPair(transform)
  const [client, server] = await Promise.all([
    R.clientHandshake(c, { mode: 'pair', identity: device, hostKey: host.publicKey, psk }),
    R.serverHandshake(s, serverPolicy(host, { pairingPsk: () => psk }))
  ])
  return { client, server: server.channel, host, device }
}
async function collect(channel, n) { const out = []; for await (const m of channel.messages()) { out.push(m); if (out.length === n) break } return out }

function fakeOutboxPeer() {
  const sent = []
  return { sent, channel: { queuedBytes: 0 }, emit: (name, data) => { sent.push(data); return Promise.resolve() } }
}

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

function hostHarness(dir, identity, extra = {}) {
  const api = new R.ApiRegistry()
  const calls = [], sends = [], gone = []
  api.handle('ping', (caller, value) => { calls.push({ caller, value }); return { owner: caller.owner, kind: caller.kind, value } })
  api.handle('local:only', () => 'never', { remote: false })
  api.handle('session:open', () => ({ sessionId: 'opened-session' }))
  api.handle('session:get-state', (_caller, id) => ({ id }))
  api.handle('hang', () => new Promise(() => {}))
  api.on('terminal:ack', (caller, ...args) => sends.push({ caller, args }))
  const host = new R.RemoteHostService({
    dataDir: dir, backend: extra.backend ?? new R.LoopbackBackend(), identity: () => identity, hostName: () => 'Host A',
    invoke: (channel, caller, args) => api.invoke(channel, caller, args),
    send: (channel, caller, args) => api.send(channel, caller, args),
    ownerGone: owner => gone.push(owner), changed() {}
  })
  return { host, calls, sends, gone }
}
function clientHarness(dir, identity, backend = new R.LoopbackBackend()) {
  return new R.RemoteClientService({ dataDir: dir, backend, identity: () => identity, deviceName: () => 'Laptop\u0007   B', changed() {} })
}
const rewritePort = (code, port) => { const decoded = R.decodePairingCode(code); return R.encodePairingCode({ ...decoded, address: { ...decoded.address, port } }) }

;(async () => {
  await check('Noise XXpsk3 and IK replay the official cacophony and snow vectors in both roles', () => {
    const { vectors } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/noise-vectors.json'), 'utf8'))
    assert.equal(vectors.length, 3)
    for (const v of vectors) {
      const pattern = v.protocol_name.split('_')[1]
      const init = new R.HandshakeState({ pattern, initiator: true, prologue: hex(v.init_prologue), s: R.keyPairFromPrivate(hex(v.init_static)), e: R.keyPairFromPrivate(hex(v.init_ephemeral)), rs: v.init_remote_static ? hex(v.init_remote_static) : undefined, psk: v.init_psks?.length ? hex(v.init_psks[0]) : undefined })
      const resp = new R.HandshakeState({ pattern, initiator: false, prologue: hex(v.resp_prologue), s: R.keyPairFromPrivate(hex(v.resp_static)), e: R.keyPairFromPrivate(hex(v.resp_ephemeral)), psk: v.resp_psks?.length ? hex(v.resp_psks[0]) : undefined })
      let i = 0
      for (; !init.complete; i++) {
        const [writer, reader] = init.isMyTurn ? [init, resp] : [resp, init]
        const ct = writer.writeMessage(hex(v.messages[i].payload))
        assert.equal(toHex(ct), v.messages[i].ciphertext, `${v.source} ${v.protocol_name} handshake ${i}`)
        assert.equal(toHex(reader.readMessage(ct)), v.messages[i].payload)
      }
      const a = init.finish(), b = resp.finish()
      if (v.handshake_hash) assert.equal(toHex(a.handshakeHash), v.handshake_hash)
      assert.ok(R.bytesEqual(a.handshakeHash, b.handshakeHash))
      for (; i < v.messages.length; i++) {
        const [send, recv] = i % 2 === 0 ? [a.send, b.recv] : [b.send, a.recv]
        const ct = send.encryptWithAd(new Uint8Array(0), hex(v.messages[i].payload))
        assert.equal(toHex(ct), v.messages[i].ciphertext, `${v.source} ${v.protocol_name} transport ${i}`)
        assert.equal(toHex(recv.decryptWithAd(new Uint8Array(0), ct)), v.messages[i].payload)
      }
      const tampered = a.send.encryptWithAd(new Uint8Array(0), Uint8Array.of(1, 2, 3)); tampered[0] ^= 1
      assert.throws(() => b.recv.decryptWithAd(new Uint8Array(0), tampered))
    }
  })

  await check('pairing then resume over a stream that delivers one byte at a time; both sides learn the right keys', async () => {
    const host = R.generateKeyPair(), device = R.generateKeyPair(), psk = R.randomSecret()
    const policy = serverPolicy(host, { pairingPsk: () => psk })
    let [c, s] = memoryPair(splitInto(1))
    const [client, server] = await Promise.all([R.clientHandshake(c, { mode: 'pair', identity: device, hostKey: host.publicKey, psk }), R.serverHandshake(s, policy)])
    assert.equal(server.mode, 'pair'); assert.ok(R.bytesEqual(server.channel.peerKey, device.publicKey)); assert.ok(R.bytesEqual(client.peerKey, host.publicKey))
    assert.equal(policy.paired.length, 1)
    ;[c, s] = memoryPair(splitInto(1))
    const [resumed, accepted] = await Promise.all([R.clientHandshake(c, { mode: 'resume', identity: device, hostKey: host.publicKey }), R.serverHandshake(s, policy)])
    assert.equal(accepted.mode, 'resume')
    await resumed.send(new TextEncoder().encode('hello'))
    assert.equal(new TextDecoder().decode((await collect(accepted.channel, 1))[0]), 'hello')
  })

  await check('large messages are chunked and reassembled; concurrent sends never interleave; >32 MB is refused', async () => {
    const { client, server } = await pairedChannels((chunk, i) => i < 4 ? [chunk] : splitInto(4093)(chunk))
    const big = new Uint8Array(3 * 1024 * 1024 + 17).map((_, i) => i * 7)
    const small = Uint8Array.of(9, 9, 9)
    const reading = collect(server, 3)
    await Promise.all([client.send(big), client.send(small), client.send(new Uint8Array(0))])
    const [first, second, third] = await reading
    assert.ok(Buffer.from(first).equals(Buffer.from(big))); assert.deepEqual([...second], [9, 9, 9]); assert.equal(third.length, 0)
    assert.ok(client.bytesSent > big.length); assert.equal(client.queuedBytes, 0)
    await assert.rejects(client.send(new Uint8Array(32 * 1024 * 1024 + 1)), /too large/)
  })

  await check('a single flipped ciphertext bit closes the channel instead of resynchronising', async () => {
    let tamper = false
    const { client, server } = await pairedChannels(chunk => { if (tamper) { chunk[chunk.length - 1] ^= 1 } return [chunk] })
    tamper = true
    await client.send(Uint8Array.of(1, 2, 3))
    assert.deepEqual(await collect(server, 1), [])
    assert.equal(await server.closed, 'decryption failed')
  })

  await check('wrong PSK, no open offer, unpaired keys, wrong pinned host key and a rewritten hello all fail closed', async () => {
    const host = R.generateKeyPair(), device = R.generateKeyPair()
    let failures = 0
    let [c, s] = memoryPair()
    const policy = serverPolicy(host, { pairingPsk: () => R.randomSecret(), onPairingFailed: () => failures++ })
    let results = await Promise.allSettled([R.clientHandshake(c, { mode: 'pair', identity: device, hostKey: host.publicKey, psk: R.randomSecret() }), R.serverHandshake(s, policy)])
    // psk3 is mixed into the initiator's last message, so only the host can notice; it hangs up.
    assert.equal(results[1].status, 'rejected'); assert.equal(failures, 1); assert.equal(policy.paired.length, 0)
    assert.equal(results[0].status, 'fulfilled'); await results[0].value.closed

    ;[c, s] = memoryPair()
    results = await Promise.allSettled([R.clientHandshake(c, { mode: 'pair', identity: device, hostKey: host.publicKey, psk: R.randomSecret() }), R.serverHandshake(s, serverPolicy(host))])
    assert.ok(results[0].reason instanceof R.HandshakeClosed); assert.match(results[1].reason.message, /no pairing offer/)

    ;[c, s] = memoryPair()
    results = await Promise.allSettled([R.clientHandshake(c, { mode: 'resume', identity: device, hostKey: host.publicKey }), R.serverHandshake(s, serverPolicy(host))])
    assert.ok(results[0].reason instanceof R.HandshakeClosed, 'an unpaired device gets no reply'); assert.match(results[1].reason.message, /not paired/)

    const psk = R.randomSecret()
    ;[c, s] = memoryPair()
    results = await Promise.allSettled([R.clientHandshake(c, { mode: 'pair', identity: device, hostKey: R.generateKeyPair().publicKey, psk }), R.serverHandshake(s, serverPolicy(host, { pairingPsk: () => psk }))])
    assert.match(results[0].reason.message, /pinned key|host key mismatch/)

    const paired = serverPolicy(host); paired.paired.push(device.publicKey)
    ;[c, s] = memoryPair((chunk, i, fromClient) => { if (fromClient && i === 0) chunk[3] = 1; return [chunk] })
    results = await Promise.allSettled([R.clientHandshake(c, { mode: 'resume', identity: device, hostKey: host.publicKey }), R.serverHandshake(s, paired)])
    assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'rejected')
  })

  await check('pairing codes round-trip, reject damaged or unexpected addresses, and offers are single-use with 3 attempts', () => {
    const hostKey = R.generateKeyPair().publicKey, psk = R.randomSecret()
    const address = { kind: 'devtunnels', tunnelId: 'abc-123', clusterId: 'usw2', port: 41234, hostLabel: 'spi-host-0123456789abcdef01234567' }
    const code = R.encodePairingCode({ address, hostKey, psk, expiresAt: 123 })
    assert.match(code, /^spi1\.[A-Za-z0-9_-]+$/)
    const decoded = R.decodePairingCode('  ' + code.slice(0, 20) + '\n' + code.slice(20) + ' ')
    assert.deepEqual(decoded.address, address); assert.ok(R.bytesEqual(decoded.hostKey, hostKey)); assert.ok(R.bytesEqual(decoded.psk, psk)); assert.equal(decoded.expiresAt, 123)
    const bad = a => R.encodePairingCode({ address: a, hostKey, psk, expiresAt: 1 })
    assert.throws(() => R.decodePairingCode(bad({ kind: 'loopback', port: 80, host: 'evil.example' })), /damaged/)
    assert.throws(() => R.decodePairingCode(bad({ ...address, tunnelId: '../x' })), /damaged/)
    assert.throws(() => R.decodePairingCode(bad({ kind: 'devtunnels', tunnelId: 'a', clusterId: 'b', port: 70000 })), /damaged/)
    assert.throws(() => R.decodePairingCode(bad({ kind: 'ssh', port: 22 })), /damaged/)
    assert.throws(() => R.decodePairingCode('spi1.' + code.slice(9, 40)), /damaged/)
    assert.throws(() => R.decodePairingCode('hello'), /not an sPi pairing code/)
    assert.throws(() => R.decodePairingCode(42), /Invalid/)
    assert.match(R.keyFingerprint(hostKey), /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/)

    assert.equal(R.PAIRING_TTL_MS, 3_600_000)
    assert.equal(R.MAX_PAIRING_TTL_MS, 60 * 24 * 3_600_000)
    const now = Date.now()
    assert.equal(new R.PairingOffer(now).expiresAt, now + 3_600_000)
    assert.equal(new R.PairingOffer(now, R.MAX_PAIRING_TTL_MS).expiresAt, now + R.MAX_PAIRING_TTL_MS)
    assert.equal(new R.PairingOffer(now, 60_000).expiresAt, now + 60_000)
    for (const invalid of [0, -1, 59_999, NaN, Infinity, null, '3600000', 3_600_000.5, R.MAX_PAIRING_TTL_MS + 1]) {
      assert.throws(() => new R.PairingOffer(now, invalid), /between 1 minute and 60 days/)
    }
    const offer = new R.PairingOffer()
    assert.ok(offer.active); assert.equal(offer.expiresAt - Date.now() <= R.PAIRING_TTL_MS, true)
    assert.ok(offer.claim()); assert.equal(offer.claim(), null, 'one handshake at a time'); offer.release()
    offer.failed(); offer.failed(); assert.ok(offer.active); offer.failed(); assert.equal(offer.active, false); assert.equal(offer.claim(), null)
    const used = new R.PairingOffer(); used.consume(); assert.equal(used.active, false)
    assert.equal(new R.PairingOffer(Date.now() - R.PAIRING_TTL_MS - 1).active, false)
  })

  await check('RPC answers calls, reports handler errors, delivers events and rejects in-flight calls when the link drops', async () => {
    const { client, server } = await pairedChannels()
    const order = []
    const serverPeer = new R.RpcPeer(server, { add: ({ a, b }) => a + b, fail: () => { throw new Error('nope') }, slow: () => new Promise(() => {}) })
    const clientPeer = new R.RpcPeer(client)
    const events = []
    serverPeer.onEvent((name, data) => events.push([name, data]))
    assert.equal(await clientPeer.call('add', { a: 2, b: 3 }), 5)
    await assert.rejects(clientPeer.call('fail'), /nope/)
    await assert.rejects(clientPeer.call('constructor'), /unknown method/)
    await clientPeer.emit('note', { x: 1 })
    await waitFor('event', () => events.length === 1); assert.deepEqual(events[0], ['note', { x: 1 }])
    clientPeer.onClose(() => order.push('closed'))
    const pending = clientPeer.call('slow').catch(error => { order.push('rejected'); return error })
    await delay(20)
    await serverPeer.close('test drop')
    assert.ok((await pending) instanceof R.RpcDisconnected)
    assert.deepEqual(order, ['closed', 'rejected'])
    await assert.rejects(clientPeer.call('add', { a: 1, b: 1 }), R.RpcDisconnected)
  })

  await check('RPC closes the channel on a malformed message', async () => {
    const { client, server } = await pairedChannels()
    const peer = new R.RpcPeer(server)
    await client.send(new TextEncoder().encode('{not json'))
    assert.equal(await peer.done, 'malformed RPC message'); assert.equal(peer.closed, true)
  })

  await check('gh provider: runs `gh auth token` non-interactively, caches in memory, invalidates, and dedupes concurrent reads', async () => {
    const runs = []
    const runner = async (file, args, env) => {
      runs.push({ file, args, env })
      if (file === 'which') return { code: 0, stdout: process.execPath + '\n', stderr: '' }
      return { code: 0, stdout: fakeToken() + '\n', stderr: '' }
    }
    const gh = new R.GitHubCliAuth(runner, 'linux', { PATH: '/usr/bin' })
    const [a, b] = await Promise.all([gh.token(), gh.token()])
    assert.equal(a, fakeToken()); assert.equal(b, a)
    const tokenRuns = runs.filter(r => r.args[0] === 'auth')
    assert.equal(tokenRuns.length, 1)
    assert.equal(tokenRuns[0].file, process.execPath)
    assert.deepEqual(tokenRuns[0].args, ['auth', 'token', '--hostname', 'github.com'])
    assert.equal(tokenRuns[0].env.GH_PROMPT_DISABLED, '1'); assert.equal(tokenRuns[0].env.GH_HOST, 'github.com')
    await gh.token(); assert.equal(runs.filter(r => r.args[0] === 'auth').length, 1, 'cached')
    gh.invalidate(); await gh.token(); assert.equal(runs.filter(r => r.args[0] === 'auth').length, 2)
    assert.deepEqual(await gh.status(), { state: 'ready' })
  })

  await check('gh provider: missing, logged out and failing CLIs map to states whose messages never echo gh output', async () => {
    const empty = { ProgramFiles: path.join(tmp, 'none'), LOCALAPPDATA: path.join(tmp, 'none') }
    const missing = new R.GitHubCliAuth(async () => ({ code: 1, stdout: '', stderr: '' }), 'win32', empty)
    assert.equal((await missing.status()).state, 'missing')
    await assert.rejects(missing.token(), error => error instanceof R.GitHubCliError && error.state === 'missing')

    const located = (result) => new R.GitHubCliAuth(async (file) => file === 'which' ? { code: 0, stdout: process.execPath, stderr: '' } : result, 'linux', {})
    const secret = fakeToken()
    const loggedOut = await located({ code: 1, stdout: '', stderr: `no oauth token found for github.com ${secret}` }).status()
    assert.equal(loggedOut.state, 'logged_out'); assert.ok(!loggedOut.message.includes(secret)); assert.ok(!loggedOut.message.includes('oauth token found'))
    const failed = await located({ code: 2, stdout: '', stderr: `boom ${secret}` }).status()
    assert.equal(failed.state, 'failed'); assert.ok(!failed.message.includes(secret))
    const garbage = await located({ code: 0, stdout: 'Welcome to gh! token is here', stderr: '' }).status()
    assert.equal(garbage.state, 'failed')
    const vanished = await located({ code: null, stdout: '', stderr: '', missing: true }).status()
    assert.equal(vanished.state, 'missing')

    const backend = new R.DevTunnelsBackend('0.0.0-test', missing)
    assert.equal(backend.explain(new Error(`relay said ${secret} and eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl`)), 'relay said [redacted] and [redacted]')
    assert.match(backend.explain(new Error('Request failed with status 401')), /gh auth status/)
    assert.equal(R.isAuthError(new Error('403 Forbidden')), true); assert.equal(R.isAuthError(new Error('ECONNRESET')), false)
    assert.match(R.hostLabel(R.generateKeyPair().publicKey), /^spi-host-[0-9a-f]{24}$/)
  })

  await check('a saved host tunnel that the service reports as 404 is recreated; other lookup errors still fail', async () => {
    const notFound = Object.assign(new Error('Tunnel service error: Not Found'), { response: { status: 404 } })
    const created = []
    const management = {
      getTunnel: async () => { throw notFound },
      createTunnel: async (tunnel) => { created.push(tunnel); return { ...tunnel, tunnelId: 'new', clusterId: 'usw2' } },
    }
    const { tunnel, port } = await R.ensureHostTunnel(management, { tunnelId: 'gone', clusterId: 'usw2', port: 1 }, R.generateKeyPair().publicKey)
    assert.equal(created.length, 1); assert.equal(tunnel.tunnelId, 'new'); assert.equal(created[0].ports[0].portNumber, port)
    assert.ok(created[0].labels.includes(R.REMOTE_LABEL))
    const forbidden = Object.assign(new Error('Forbidden'), { response: { status: 403 } })
    await assert.rejects(R.getTunnelOrNull({ getTunnel: async () => { throw forbidden } }, { tunnelId: 'x', clusterId: 'y' }), /Forbidden/)
  })

  await check('pi event slimming drops the quadratic partial message and keeps the delta', () => {
    const event = { sessionId: 's', event: { type: 'message_update', message: { big: 'x'.repeat(1000) }, assistantMessageEvent: { type: 'text_delta', delta: 'hi', partial: { big: 1 } } } }
    assert.deepEqual(R.slimPiEvent(event), { sessionId: 's', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } } })
    assert.equal(event.event.message.big.length, 1000, 'input is not mutated')
    const other = { sessionId: 's', event: { type: 'agent_end', messages: [1] } }
    assert.equal(R.slimPiEvent(other), other)
  })

  await check('outbox coalesces tool updates per tool call, lets tool end supersede them, and sheds a peer that cannot keep up', async () => {
    const peer = fakeOutboxPeer()
    const outbox = new R.PeerOutbox(peer, () => {})
    const update = (id, n) => ({ sessionId: 's', event: { type: 'tool_execution_update', toolCallId: id, partialResult: n } })
    for (let n = 1; n <= 5; n++) outbox.emit('pi:event', update('a', n))
    outbox.emit('pi:event', update('b', 1))
    outbox.emit('sessions:changed', undefined)
    assert.equal(peer.sent.length, 1, 'non-tool events pass straight through')
    await delay(300)
    assert.deepEqual(peer.sent.slice(1).map(p => [p.payload.event.toolCallId, p.payload.event.partialResult]), [['a', 5], ['b', 1]])
    outbox.emit('pi:event', update('a', 6))
    outbox.emit('pi:event', { sessionId: 's', event: { type: 'tool_execution_end', toolCallId: 'a' } })
    await delay(300)
    assert.deepEqual(peer.sent.slice(3).map(p => p.payload.event.type), ['tool_execution_end'])
    outbox.close()

    const slow = fakeOutboxPeer(); let overflowed = 0
    const shed = new R.PeerOutbox(slow, () => overflowed++)
    slow.channel.queuedBytes = 65 * 1024 * 1024
    shed.emit('sessions:changed', undefined); shed.emit('sessions:changed', undefined)
    assert.equal(overflowed, 1); assert.equal(slow.sent.length, 0)
  })

  await check('handler registry blocks local-only handlers for remote callers and refuses duplicates', () => {
    const api = new R.ApiRegistry()
    api.handle('a', (caller, x) => [caller.kind, x])
    api.handle('b', () => 'local', { remote: false })
    api.on('c', () => {}, { remote: false })
    const remote = { kind: 'remote', owner: 'remote:x', deviceId: 'x' }, local = { kind: 'local', owner: 'local:1', sender: {}, mainFrame: true }
    assert.deepEqual(api.invoke('a', remote, [1]), ['remote', 1])
    assert.equal(api.invoke('b', local, []), 'local')
    assert.throws(() => api.invoke('b', remote, []), /Unavailable/)
    assert.throws(() => api.send('c', remote, []), /Unavailable/)
    assert.throws(() => api.invoke('missing', local, []), /Unavailable/)
    assert.throws(() => api.handle('a', () => {}), /Duplicate/)
  })

  await check('identity key is encrypted at rest, reloaded, and never created without a protected store', () => {
    const fakeSafe = (available, backend) => ({ isEncryptionAvailable: () => available, getSelectedStorageBackend: () => backend, encryptString: s => Buffer.from([...Buffer.from(s)].map(x => x ^ 0x5a)), decryptString: b => Buffer.from([...b].map(x => x ^ 0x5a)).toString() })
    assert.match(R.electronSecretStorage(fakeSafe(true, 'basic_text'), 'linux').problem(), /keyring/)
    assert.equal(R.electronSecretStorage(fakeSafe(true, 'gnome_libsecret'), 'linux').problem(), null)
    assert.equal(R.electronSecretStorage(fakeSafe(true, 'basic_text'), 'darwin').problem(), null)
    assert.match(R.electronSecretStorage(fakeSafe(false), 'win32').problem(), /unavailable/)
    const file = path.join(tmp, 'identity.json')
    assert.throws(() => R.loadOrCreateIdentity(file, R.electronSecretStorage(fakeSafe(true, 'basic_text'), 'linux')), /keyring/)
    assert.equal(fs.existsSync(file), false)
    const storage = R.electronSecretStorage(fakeSafe(true, 'kwallet5'), 'linux')
    const first = R.loadOrCreateIdentity(file, storage)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    assert.ok(!fs.readFileSync(file, 'utf8').includes(toHex(first.privateKey)))
    assert.ok(R.bytesEqual(R.loadOrCreateIdentity(file, storage).publicKey, first.publicKey))
    fs.writeFileSync(file, '{"version":1,"key":"AAAA"}')
    assert.throws(() => R.loadOrCreateIdentity(file, storage), /damaged/)
  })

  await check('host and client over loopback: pair once, authorize calls, route events by session interest', async () => {
    const hostId = R.generateKeyPair(), deviceId = R.generateKeyPair()
    const hostDir = fs.mkdtempSync(path.join(tmp, 'host-')), clientDir = fs.mkdtempSync(path.join(tmp, 'client-'))
    const { host, calls, sends, gone } = hostHarness(hostDir, hostId)
    assert.throws(() => host.createPairingCode(), /not online/)
    await host.setEnabled(true)
    assert.equal(host.snapshot().state, 'online')
    const client = clientHarness(clientDir, deviceId)
    for (const invalid of [0, NaN, '3600000', R.MAX_PAIRING_TTL_MS + 1]) assert.throws(() => host.createPairingCode(invalid), /between 1 minute and 60 days/)
    const beforeOffer = Date.now()
    const { code, expiresAt } = host.createPairingCode(R.MAX_PAIRING_TTL_MS)
    assert.ok(expiresAt >= beforeOffer + R.MAX_PAIRING_TTL_MS)
    assert.ok(expiresAt <= Date.now() + R.MAX_PAIRING_TTL_MS)
    assert.equal(host.snapshot().pairingExpiresAt, expiresAt)
    const entry = await client.pair(code)
    assert.equal(entry.name, 'Host A'); assert.equal(entry.id, R.keyFingerprint(hostId.publicKey))
    await waitFor('device name', () => host.snapshot().devices[0]?.name === 'Laptop B')
    assert.equal(host.snapshot().pairingExpiresAt, undefined, 'a used code is gone')
    await assert.rejects(client.pair(code), /refused this pairing code/)
    const fresh = R.decodePairingCode(host.createPairingCode().code)
    const stranger = clientHarness(fs.mkdtempSync(path.join(tmp, 'stranger-')), R.generateKeyPair())
    await assert.rejects(stranger.pair(R.encodePairingCode({ ...fresh, psk: R.randomSecret() })), /refused this pairing code/)
    await waitFor('failure counted', () => host.snapshot().pairingExpiresAt !== undefined)
    await assert.rejects(clientHarness(fs.mkdtempSync(path.join(tmp, 'self-')), hostId).pair(host.createPairingCode().code), /belongs to this computer/)
    host.cancelPairing()
    for (const f of ['spi-remote-host.json']) assert.equal(fs.statSync(path.join(hostDir, f)).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.join(clientDir, 'spi-remote-hosts.json')).mode & 0o777, 0o600)

    const connection = await client.connect(entry.id)
    assert.equal(connection.state, 'connected')
    const owner = 'remote:' + R.keyFingerprint(deviceId.publicKey)
    assert.deepEqual(await connection.invoke('ping', [7]), { owner, kind: 'remote', value: 7 })
    assert.equal(calls[0].caller.deviceId, R.keyFingerprint(deviceId.publicKey))
    await assert.rejects(connection.invoke('local:only', []), /Unavailable operation/)
    await assert.rejects(connection.invoke('ping', new Array(9).fill(0)), /Invalid remote call/)
    connection.send('terminal:ack', ['s', 't', 1])
    await waitFor('send', () => sends.length === 1); assert.equal(sends[0].caller.owner, owner)
    assert.equal(host.connectedDevices, 1)
    await waitFor('connected flag', () => host.snapshot().devices[0].connected)

    const events = []
    connection.onEvent((channel, payload) => events.push({ channel, payload }))
    host.broadcast('pi:event', { sessionId: 'opened-session', event: { type: 'agent_start' } })
    host.broadcast('sessions:changed', undefined)
    host.broadcast('settings:changed', { theme: 'x' })
    await waitFor('sessions:changed', () => events.some(e => e.channel === 'sessions:changed'))
    assert.ok(!events.some(e => e.channel === 'pi:event'), 'no pi events for sessions the device never opened')
    assert.ok(!events.some(e => e.channel === 'settings:changed'), 'per-machine events are not applied remotely')
    await connection.invoke('session:open', [{}])
    await connection.invoke('session:get-state', ['watched-session'])
    host.broadcast('pi:event', { sessionId: 'opened-session', event: { type: 'message_update', message: { huge: 1 }, assistantMessageEvent: { type: 'text_delta', delta: 'a', partial: {} } } })
    host.broadcast('pi:event', { sessionId: 'watched-session', event: { type: 'agent_end' } })
    host.broadcast('pi:event', { sessionId: 'other-session', event: { type: 'agent_end' } })
    host.sendToOwner(owner, 'terminal:event', { kind: 'data' })
    host.sendToOwner('remote:someone-else', 'terminal:event', { kind: 'wrong' })
    await waitFor('pi events', () => events.filter(e => e.channel === 'pi:event').length === 2 && events.some(e => e.channel === 'terminal:event'))
    await delay(50)
    const pi = events.filter(e => e.channel === 'pi:event')
    assert.deepEqual(pi.map(e => e.payload.sessionId), ['opened-session', 'watched-session'])
    assert.equal(pi[0].payload.event.message, undefined); assert.equal(pi[0].payload.event.assistantMessageEvent.partial, undefined)
    assert.deepEqual(events.filter(e => e.channel === 'terminal:event').map(e => e.payload.kind), ['data'])

    await client.disconnect(entry.id)
    await waitFor('bye releases terminals immediately', () => gone.includes(owner))
    await waitFor('peer gone', () => host.connectedDevices === 0)
    assert.deepEqual(client.hosts().map(h => h.name), ['Host A'])
    client.saveLayout(entry.id, { sessions: [] }); assert.deepEqual(client.loadLayout(entry.id), { sessions: [] })
    await client.forget(entry.id)
    assert.deepEqual(client.hosts(), []); assert.throws(() => client.loadLayout(entry.id), /Unknown remote host/)
    await host.stop()
  })

  await check('relay drops: calls fail fast and are never replayed, the client reconnects with a resync, terminals survive the grace period', async () => {
    const hostId = R.generateKeyPair(), deviceId = R.generateKeyPair()
    const { host, calls, gone } = hostHarness(fs.mkdtempSync(path.join(tmp, 'host-')), hostId)
    await host.setEnabled(true)
    const { code } = host.createPairingCode()
    const proxy = await tcpProxy(R.decodePairingCode(code).address.port)
    const client = clientHarness(fs.mkdtempSync(path.join(tmp, 'client-')), deviceId)
    const entry = await client.pair(rewritePort(code, proxy.port))
    const connection = await client.connect(entry.id)
    const states = []
    connection.onState(resync => states.push([connection.state, resync]))
    const inFlight = connection.invoke('hang', [])
    await delay(50)
    proxy.drop()
    await assert.rejects(inFlight, /may or may not have run/)
    await waitFor('reconnecting', () => connection.state === 'reconnecting')
    await assert.rejects(connection.invoke('ping', [1]), /Not connected/)
    await waitFor('reconnected', () => connection.state === 'connected', 8000)
    assert.deepEqual(states.at(-1), ['connected', true])
    assert.ok(!gone.length, 'an unintentional drop keeps the device terminals for the grace period')
    const before = calls.length
    assert.equal((await connection.invoke('ping', [2])).value, 2)
    assert.equal(calls.length, before + 1, 'nothing was replayed')

    await host.setEnabled(false)
    await waitFor('host restart noticed', () => connection.state === 'reconnecting')
    assert.ok(gone.includes('remote:' + R.keyFingerprint(deviceId.publicKey)), 'stopping the host releases remote terminals')
    await host.setEnabled(true)
    await waitFor('reconnected after host restart', () => connection.state === 'connected', 8000)
    await client.closeAll(); await host.stop(); await proxy.close()
  })

  await check('revoking a device disconnects it and the client ends in rejected after repeated refusals', async () => {
    const hostId = R.generateKeyPair(), deviceId = R.generateKeyPair()
    const { host, gone } = hostHarness(fs.mkdtempSync(path.join(tmp, 'host-')), hostId)
    await host.setEnabled(true)
    const client = clientHarness(fs.mkdtempSync(path.join(tmp, 'client-')), deviceId)
    const entry = await client.pair(host.createPairingCode().code)
    const connection = await client.connect(entry.id)
    const device = host.snapshot().devices[0].id
    host.revoke(device)
    assert.throws(() => host.revoke(device), /not found/)
    assert.ok(gone.includes('remote:' + device))
    await waitFor('rejected', () => connection.state === 'rejected', 15000)
    assert.match(connection.detail, /no longer accepts this device/); assert.equal(connection.reason, 'revoked')
    assert.equal(client.hosts()[0].reason, 'revoked')
    await assert.rejects(connection.invoke('ping', [1]), /no longer accepts/)
    assert.equal(host.snapshot().devices.length, 0)
    await client.closeAll(); await host.stop()
  })

  await check('an incompatible host is refused during pairing; a failing relay start is reported and cleared when turned off', async () => {
    const hostId = R.generateKeyPair(), psk = R.randomSecret()
    const listener = await new R.LoopbackTransport().listen(async stream => {
      const { channel } = await R.serverHandshake(stream, serverPolicy(hostId, { pairingPsk: () => psk }))
      new R.RpcPeer(channel, { 'remote.hello': () => ({ protocol: 99, hostName: 'Future' }) })
    })
    const code = R.encodePairingCode({ address: listener.address, hostKey: hostId.publicKey, psk, expiresAt: Date.now() + 60_000 })
    await assert.rejects(clientHarness(fs.mkdtempSync(path.join(tmp, 'client-')), R.generateKeyPair()).pair(code), /incompatible sPi version/)
    await assert.rejects(clientHarness(fs.mkdtempSync(path.join(tmp, 'client-')), R.generateKeyPair()).pair(R.encodePairingCode({ address: listener.address, hostKey: hostId.publicKey, psk, expiresAt: Date.now() - 1 })), /expired/)
    await listener.close()

    let attempts = 0
    const failing = { kind: 'loopback', account: async () => ({ state: 'ready' }), clientTransport: () => new R.LoopbackTransport(), rediscover: async () => null, explain: e => 'explained: ' + e.message, prepareHost: async () => { attempts++; throw new Error('relay down') } }
    const { host } = hostHarness(fs.mkdtempSync(path.join(tmp, 'host-')), hostId, { backend: failing })
    await host.setEnabled(true)
    assert.deepEqual([host.snapshot().state, host.snapshot().error], ['error', 'explained: relay down'])
    assert.equal(attempts, 1)
    await host.setEnabled(false)
    assert.deepEqual([host.snapshot().state, host.snapshot().error, host.snapshot().enabled], ['off', undefined, false])
  })

  console.log('RESULT PASS', count, 'checks', tmp)
  process.exit(0)
})().catch(error => { console.error(error); process.exit(1) })
