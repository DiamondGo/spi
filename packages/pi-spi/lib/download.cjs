'use strict'
// No credentials, signed redirect URLs, local paths or server-supplied text in progress/errors.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const crypto = require('node:crypto')
const { performance } = require('node:perf_hooks')
const DEFAULTS = Object.freeze({ totalMs: 3600000, metadataMs: 180000, idleMs: 60000, attempts: 3, delayMs: 1000, progressMs: 10000 })
function error(message, fatal = false) { return Object.assign(new Error(message), { fatal }) }
function trustedURL(value) {
  const u = new URL(value)
  if (u.username || u.password) throw error('URL credentials are not supported', true)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
  if (process.env.SPI_ALLOW_TEST_HTTP === '1' && loopback && u.protocol === 'http:') return u
  if (u.protocol !== 'https:' || !(u.hostname === 'github.com' || u.hostname === 'api.github.com' || u.hostname.endsWith('.githubusercontent.com'))) throw error('Only GitHub HTTPS release URLs are supported', true)
  return u
}
function archiveTimeout() {
  const raw = process.env.SPI_DOWNLOAD_TIMEOUT_SECONDS
  if (raw === undefined) return DEFAULTS.totalMs
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 60 || Number(raw) > 21600) throw error('SPI_DOWNLOAD_TIMEOUT_SECONDS must be an integer from 60 to 21600', true)
  return Number(raw) * 1000
}
function progressReporter() {
  let fd = 2, owned = false
  // npm normally buffers lifecycle stdout/stderr. Use only our own controlling terminal,
  // never enumerate/open somebody else's terminal; headless callers use normal stderr.
  if (process.env.npm_lifecycle_event === 'postinstall' && !process.stderr.isTTY && process.platform !== 'win32') {
    try { fd = fs.openSync('/dev/tty', fs.constants.O_WRONLY | fs.constants.O_NOCTTY); owned = true } catch {}
  }
  return {
    write(message) { try { fs.writeSync(fd, '[sPi] ' + message + '\n') } catch {} },
    close() { if (owned) { try { fs.closeSync(fd) } catch {} } }
  }
}
function status(message) {
  const reporter = progressReporter()
  try { reporter.write(message) } finally { reporter.close() }
}
async function download(url, file, max, options = {}) {
  if (!Number.isSafeInteger(max) || max <= 0) throw error('Invalid download size limit', true)
  const resume = !!options.resume
  const policy = { ...DEFAULTS, totalMs: resume ? archiveTimeout() : DEFAULTS.metadataMs, ...options.policy }
  for (const key of ['totalMs', 'idleMs', 'attempts', 'progressMs']) if (!Number.isSafeInteger(policy[key]) || policy[key] <= 0) throw error('Invalid download policy', true)
  if (options.sha256 && !/^[a-f0-9]{64}$/i.test(options.sha256)) throw error('Invalid download checksum', true)
  const firstURL = trustedURL(url)
  const reporter = options.progress ? progressReporter() : null
  const emit = options.report || (message => reporter?.write(message))
  const controller = new AbortController()
  const totalTimer = setTimeout(() => controller.abort(error('Download exceeded its total time limit; increase SPI_DOWNLOAD_TIMEOUT_SECONDS (maximum 21600)', true)), policy.totalMs)
  const started = performance.now()
  let out, bytes = 0, etag, success = false, attempt = 0, progressTimer
  const report = () => {
    const seconds = Math.max(0.001, (performance.now() - started) / 1000)
    emit('Downloading runtime: ' + (bytes / 1048576).toFixed(1) + '/' + (max / 1048576).toFixed(1) + ' MiB (' + (success ? 100 : Math.min(99, Math.floor(bytes / max * 100))) + '%), ' + (bytes / 1024 / seconds).toFixed(0) + ' KiB/s, attempt ' + attempt + '/' + policy.attempts)
  }
  try {
    out = await fsp.open(file, 'wx+', 0o600)
    if (options.progress || options.report) { emit('Downloading runtime; active transfers may take up to ' + Math.round(policy.totalMs / 60000) + ' minutes. Interrupted transfers resume when supported.'); progressTimer = setInterval(report, policy.progressMs) }
    for (attempt = 1; attempt <= policy.attempts; attempt++) {
      controller.signal.throwIfAborted()
      if (options.progress || options.report) report()
      if (attempt > 1 && !resume) { await out.truncate(0); bytes = 0; etag = undefined }
      const idle = new AbortController()
      let idleTimer, response
      const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => idle.abort(error('Download stalled: no network data for ' + Math.round(policy.idleMs / 1000) + ' seconds')), policy.idleMs) }
      const signal = AbortSignal.any([controller.signal, idle.signal])
      try {
        // A disconnected stream may already have delivered all expected archive bytes.
        if (!(resume && bytes === max)) {
          let current = firstURL, redirects = 0
          const offset = bytes
          const headers = { 'User-Agent': 'sPi-installer', Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' }
          if (resume && offset) { headers.Range = 'bytes=' + offset + '-'; if (etag) headers['If-Range'] = etag }
          while (true) {
            touch()
            response = await fetch(current, { redirect: 'manual', signal, headers })
            if (![301, 302, 303, 307, 308].includes(response.status)) break
            await response.body?.cancel()
            if (++redirects > 5) throw error('Too many download redirects', true)
            const location = response.headers.get('location')
            if (!location) throw error('Missing download redirect location', true)
            current = trustedURL(new URL(location, current))
          }
          if (response.status !== 200 && response.status !== 206) throw error('Download failed: HTTP ' + response.status, ![408, 429].includes(response.status) && response.status < 500)
          const encoding = response.headers.get('content-encoding')
          if (encoding && encoding !== 'identity') throw error('Encoded download responses cannot be safely resumed', true)
          if (response.status === 206) {
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '')
            if (!resume || !offset || !range || !range.slice(1).every(n => Number.isSafeInteger(Number(n))) || Number(range[1]) !== offset || Number(range[2]) !== max - 1 || Number(range[3]) !== max) throw error('Invalid resumed download range', true)
            if (etag && response.headers.get('etag') && response.headers.get('etag') !== etag) throw error('Resumed download validator changed', true)
          } else if (offset) {
            await out.truncate(0); bytes = 0; etag = undefined
            emit('Server did not honor resume; restarting this transfer safely.')
          }
          const length = response.headers.get('content-length')
          if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > max - bytes)) throw error('Download size limit exceeded', true)
          const validator = response.headers.get('etag')
          if (validator && /^"[^\r\n]{1,500}"$/.test(validator)) etag = validator
          touch()
          for await (const chunk of response.body) {
            touch()
            if (chunk.length > max - bytes) throw error('Download size limit exceeded', true)
            let written = 0
            while (written < chunk.length) {
              const result = await out.write(chunk, written, chunk.length - written, bytes)
              if (!result.bytesWritten) throw error('Cannot write downloaded data', true)
              written += result.bytesWritten; bytes += result.bytesWritten
            }
          }
          if (resume && bytes !== max) throw error('Download ended before the expected size')
        }
        clearTimeout(idleTimer)
        if (options.sha256) {
          const digest = crypto.createHash('sha256')
          for await (const chunk of fs.createReadStream(file)) digest.update(chunk)
          if (digest.digest('hex') !== options.sha256.toLowerCase()) throw error('Release checksum mismatch', true)
        }
        controller.signal.throwIfAborted()
        success = true
        if (options.progress || options.report) { report(); emit('Download verified; preparing the runtime.') }
        return
      } catch (caught) {
        const reason = controller.signal.aborted ? controller.signal.reason : idle.signal.aborted ? idle.signal.reason : caught
        if (reason.fatal || attempt === policy.attempts) throw reason
        emit('Transfer interrupted; retrying' + (resume && bytes ? ' from ' + (bytes / 1048576).toFixed(1) + ' MiB' : '') + ' (' + attempt + '/' + policy.attempts + ').')
      } finally {
        clearTimeout(idleTimer)
        if (response?.body && !response.body.locked) { try { await response.body.cancel() } catch {} }
      }
      await new Promise(resolve => setTimeout(resolve, policy.delayMs * attempt))
    }
  } finally {
    clearTimeout(totalTimer); clearInterval(progressTimer)
    await out?.close()
    if (out && !success) await fsp.rm(file, { force: true })
    reporter?.close()
  }
}
module.exports = { download, trustedURL, archiveTimeout, progressReporter, status, DEFAULTS }
