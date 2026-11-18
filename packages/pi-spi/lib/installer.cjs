'use strict'
// Bundled into a standalone installer/launcher. Never edit Pi's settings or execute archive scripts.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn, execFileSync } = require('node:child_process')
const { pipeline } = require('node:stream/promises')
const tar = require('tar')
const yauzl = require('yauzl')
const { syncDesktopEntry, assertDesktopOwned, removeDesktopEntry } = require('./desktop.cjs')
const { download, trustedURL, status, ACCEPT } = require('./download.cjs')
const BUILD = typeof __SPI_RELEASE__ === 'undefined'
  ? { version: require('../../../package.json').version, repository: require('../../../release.config.json').repository, packageName: require('../../../release.config.json').npmPackage }
  : __SPI_RELEASE__
const OWNER = 'sPi-installer-v1'
const MAX_ARCHIVE = 700 * 1024 * 1024, MAX_EXPANDED = 1600 * 1024 * 1024, MAX_ENTRIES = 40000
function fail(message) { throw new Error(message) }
function version(v) { if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)) fail('Invalid version'); return v }
const TARGETS = ['linux-x64','linux-arm64','win32-x64','darwin-arm64','darwin-x64']
// Test seams only (never configured from the environment or renderer input).
const internals = {
  target: () => target(),
  // Lock/liveness seams (tests only): never configured from the environment or renderer input.
  kill: pid => process.kill(pid, 0),
  procStat: pid => procStat(pid),
  identity: pid => identity(pid),
  retireLock: (root, token) => retireLock(root, token),
  codesign: bundle => execFileSync('/usr/bin/codesign', ['--verify','--deep','--strict',bundle], { stdio: ['ignore','ignore','pipe'], timeout: 120000 })
}
function target() {
  const t = process.platform + '-' + process.arch
  if (!['linux-x64','linux-arm64','win32-x64','darwin-arm64','darwin-x64'].includes(t)) fail('Unsupported platform: ' + t)
  if (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime) fail('Linux requires glibc; musl is not supported')
  return t
}
function defaultRoot() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'sPi')
  if (process.platform === 'darwin') return path.join(os.homedir(),'Library','Application Support','sPi')
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(),'.local','share'),'spi')
}
function rootFor(options = {}) {
  const root = path.resolve(options.installDir || process.env.SPI_INSTALL_ROOT || defaultRoot())
  if ([path.parse(root).root, os.homedir()].includes(root)) fail('Refusing unsafe install root')
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) fail('Install root must not be a symlink')
  return root
}
function readJSON(file) { return JSON.parse(fs.readFileSync(file,'utf8')) }
function atomicJSON(file, data) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  try { fs.writeFileSync(tmp, JSON.stringify(data,null,2)+'\n',{mode:0o600}); fs.renameSync(tmp,file) }
  finally { fs.rmSync(tmp,{force:true}) }
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function safeName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || name.includes(':') || name.startsWith('/') || name.split('/').includes('..')) fail('Unsafe archive path')
  if (/[\x00-\x1f\x7f]/.test(name) || name.split('/').some(s => /[. ]$/.test(s) && s!=='.' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) fail('Unsafe cross-platform archive name')
  const clean = path.posix.normalize(name).replace(/\/$/,'')
  if (clean !== 'app' && !clean.startsWith('app/')) fail('Archive must contain only app/')
  return clean
}
function linkTarget(name, link, hard = false) {
  if (!link || link.includes('\\') || link.includes('\0') || link.includes(':') || path.posix.isAbsolute(link)) fail('Unsafe archive link')
  const result = path.posix.normalize(hard ? link : path.posix.join(path.posix.dirname(name),link))
  return safeName(result)
}
function validateEntries(entries) {
  if (entries.length > MAX_ENTRIES) fail('Too many archive entries')
  let size = 0
  const names = new Map()
  for (const e of entries) {
    e.name = safeName(e.name)
    const key = process.platform === 'linux' ? e.name : e.name.normalize('NFC').toLowerCase()
    if (names.has(key)) fail('Duplicate archive path')
    names.set(key,e)
    size += e.size
    if (!Number.isSafeInteger(e.size) || e.size < 0 || size > MAX_EXPANDED) fail('Archive expanded size limit exceeded')
    if (!['file','directory','symlink','hardlink'].includes(e.type)) fail('Unsupported archive entry')
    if (e.link) linkTarget(e.name,e.link,e.type==='hardlink')
  }
  for (const e of entries) {
    let parent = path.posix.dirname(e.name)
    while (parent !== '.') {
      const item = names.get(process.platform === 'linux' ? parent : parent.normalize('NFC').toLowerCase())
      if (item && item.type !== 'directory') fail('Archive writes through a non-directory')
      parent = path.posix.dirname(parent)
    }
  }
}
function checkExtractedLinks(entries,dest){
  // macOS /var is normally an alias of /private/var. Compare both sides in
  // the same canonical namespace, retaining the path-separator boundary.
  const base=fs.realpathSync(dest)+path.sep
  for(const e of entries)if(e.link&&!fs.realpathSync(path.join(dest,e.name)).startsWith(base))fail('Extracted link escapes destination')
}
async function extractTar(file, dest) {
  const entries=[]
  await tar.t({file,onReadEntry:e=>entries.push({name:e.path,size:e.size,type:({File:'file',Directory:'directory',SymbolicLink:'symlink',Link:'hardlink'})[e.type] || 'unsupported',link:e.linkpath})})
  validateEntries(entries)
  await tar.x({file,cwd:dest,strict:true,preserveOwner:false,noChmod:true})
  // Strip setuid/setgid bits, retaining executable bits; never chmod through links.
  for (const e of entries) if (e.type==='file') { const f=path.join(dest,e.name); fs.chmodSync(f,fs.statSync(f).mode & 0o777) }
  checkExtractedLinks(entries,dest)
}
async function zipEntries(file) {
  return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(error)
    const entries=[];let expanded=0
    zip.on('error',reject); zip.on('end',()=>resolve(entries)); zip.readEntry()
    zip.on('entry',e=>{
      expanded+=e.uncompressedSize
      if(entries.length>=MAX_ENTRIES||expanded>MAX_EXPANDED){zip.close();return reject(new Error('Archive size/entry limit exceeded'))}
      const mode=e.externalFileAttributes>>>16, kind=mode & 0o170000
      const type=e.fileName.endsWith('/')?'directory':kind===0o120000?'symlink':kind && kind!==0o100000?'unsupported':'file'
      const record={name:e.fileName,size:e.uncompressedSize,type,mode:mode & 0o777,entry:e}
      entries.push(record)
      if(type!=='symlink')return zip.readEntry()
      if(e.uncompressedSize>8192){zip.close();return reject(new Error('Archive link too large'))}
      zip.openReadStream(e,(error,stream)=>{
        if(error){zip.close();return reject(error)}
        const chunks=[];stream.on('error',reject);stream.on('data',d=>chunks.push(d));stream.on('end',()=>{record.link=Buffer.concat(chunks).toString('utf8');zip.readEntry()})
      })
    })
  }))
}
async function extractZip(file,dest) {
  const entries=await zipEntries(file); validateEntries(entries)
  await new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(error)
    let i=0
    zip.on('error',reject);zip.on('end',resolve);zip.readEntry()
    zip.on('entry',async()=>{
      try {
        const e=entries[i++], output=path.join(dest,e.name)
        if(e.type==='directory')fs.mkdirSync(output,{recursive:true})
        if(e.type==='file') {
          fs.mkdirSync(path.dirname(output),{recursive:true})
          const input=await new Promise((res,rej)=>zip.openReadStream(e.entry,(err,s)=>err?rej(err):res(s)))
          await pipeline(input,fs.createWriteStream(output,{flags:'wx',mode:e.mode || 0o644}))
          fs.chmodSync(output,e.mode || 0o644)
        }
        zip.readEntry()
      }catch(error){zip.close();reject(error)}
    })
  }))
  for(const e of entries)if(e.type==='symlink') { const out=path.join(dest,e.name);fs.mkdirSync(path.dirname(out),{recursive:true});fs.symlinkSync(e.link,out) }
  checkExtractedLinks(entries,dest)
}
async function fetchJSON(url, options = {}) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-metadata-'))
  try{const f=path.join(tmp,'data.json');await download(url,f,2*1024*1024,options);return readJSON(f)}finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
// Strict SemVer 2.0 (no build metadata, no leading zeros); returns null when invalid.
function parseSemver(v) {
  const m=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/.exec(typeof v==='string'?v:'')
  if(!m)return null
  const core=m.slice(1,4).map(Number)
  if(!core.every(Number.isSafeInteger))return null
  return {core,pre:m[4]?m[4].split('.'):[]}
}
function compareSemver(a,b) {
  const x=parseSemver(a),y=parseSemver(b)
  if(!x||!y)fail('Invalid version')
  for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return x.core[i]<y.core[i]?-1:1
  if(!x.pre.length||!y.pre.length)return x.pre.length===y.pre.length?0:x.pre.length?-1:1
  for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
    const l=x.pre[i],r=y.pre[i]
    if(l===undefined)return -1
    if(r===undefined)return 1
    const ln=/^\d+$/.test(l),rn=/^\d+$/.test(r)
    if(ln&&rn){if(Number(l)!==Number(r))return Number(l)<Number(r)?-1:1}
    else if(ln!==rn)return ln?-1:1
    else if(l!==r)return l<r?-1:1
  }
  return 0
}
function repository() {
  const repo=process.env.SPI_RELEASE_REPOSITORY || BUILD.repository
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))fail('Release repository is not configured; see release.config.example.json')
  return repo
}
function latestURL() {
  if(process.env.SPI_RELEASE_API_URL){
    const u=trustedURL(process.env.SPI_RELEASE_API_URL)
    if(process.env.SPI_ALLOW_TEST_HTTP!=='1'||u.protocol!=='http:')fail('Release API override is test-only')
    return u.href
  }
  if(process.env.SPI_RELEASE_BASE_URL)fail('Tests must pin a version')
  return 'https://api.github.com/repos/'+repository()+'/releases/latest'
}
// GitHub's "latest" is never a draft/prerelease, but the metadata is still validated rather than trusted.
async function latestRelease(policy) {
  const apiURL=latestURL()
  let release
  try{release=await fetchJSON(apiURL,{accept:ACCEPT.githubJSON,policy})}
  catch(error){
    // Public GitHub API quotas are shared on hosted runners/networks. The official
    // latest asset redirect is independent of that quota; never use arbitrary mirrors.
    if(![403,429].includes(error.status))throw error
    const assetURL=process.env.SPI_RELEASE_API_URL
      ?new URL('/latest/download/release-manifest.json',apiURL).href
      :'https://github.com/'+repository()+'/releases/latest/download/release-manifest.json'
    const manifest=await fetchJSON(assetURL,{policy})
    const parsed=parseSemver(manifest?.version)
    if(!parsed||parsed.pre.length||manifest.schemaVersion!==1||!manifest.targets||typeof manifest.targets!=='object'||Array.isArray(manifest.targets)||!Object.keys(manifest.targets).length)fail('Latest release metadata is invalid')
    for(const t of Object.keys(manifest.targets)){
      if(!TARGETS.includes(t))fail('Latest release metadata is invalid')
      validateDescriptor(manifest,manifest.version,t)
    }
    return {version:manifest.version,releaseUrl:'https://github.com/'+repository()+'/releases/tag/v'+manifest.version}
  }
  const m=release&&typeof release==='object'&&!Array.isArray(release)&&release.draft===false&&release.prerelease===false&&typeof release.tag_name==='string'?/^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(release.tag_name):null
  if(!m||!parseSemver(m[1]))fail('Latest release metadata is invalid')
  return {version:m[1],releaseUrl:'https://github.com/'+repository()+'/releases/tag/v'+m[1]}
}
function expectedArchive(v,t) { return 'spi-'+v+'-'+t+(t.startsWith('linux')?'.tar.gz':'.zip') }
function expectedLayout(t) {
  if(t.startsWith('darwin'))return {entry:'app/sPi.app/Contents/MacOS/sPi',permissionExtension:'app/sPi.app/Contents/Resources/spi-permission-extension.mjs'}
  if(t.startsWith('win32'))return {entry:'app/sPi.exe',permissionExtension:'app/resources/spi-permission-extension.mjs'}
  return {entry:'app/spi',permissionExtension:'app/resources/spi-permission-extension.mjs'}
}
// Returns the target descriptor, or null when the release has no build for this target.
// Anything present but malformed, or not bound to this exact version/target/layout, throws.
function validateDescriptor(manifest,v,t) {
  if(!manifest||typeof manifest!=='object'||manifest.schemaVersion!==1||manifest.version!==v||!manifest.targets||typeof manifest.targets!=='object'||Array.isArray(manifest.targets))fail('Invalid release manifest')
  if(!TARGETS.includes(t)||!Object.hasOwn(manifest.targets,t))return null
  const item=manifest.targets[t], layout=expectedLayout(t)
  if(!item||typeof item!=='object'||Array.isArray(item))fail('Invalid release manifest')
  if(item.file!==expectedArchive(v,t)||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<=0||item.size>MAX_ARCHIVE)fail('Invalid release manifest')
  let paths=false
  try{paths=item.entry===layout.entry&&safeName(item.entry)===item.entry&&item.permissionExtension===layout.permissionExtension&&safeName(item.permissionExtension)===item.permissionExtension}catch{}
  if(!paths)fail('Invalid release manifest')
  if(item.installerSha256!==undefined&&(typeof item.installerSha256!=='string'||!/^[a-f0-9]{64}$/i.test(item.installerSha256)))fail('Invalid release manifest')
  if(item.minGlibc!==undefined&&!/^\d+\.\d+$/.test(String(item.minGlibc)))fail('Invalid glibc baseline')
  return item
}
function baseURL(v) {
  if(process.env.SPI_RELEASE_BASE_URL){const u=trustedURL(process.env.SPI_RELEASE_BASE_URL);if(process.env.SPI_ALLOW_TEST_HTTP!=='1'||u.protocol!=='http:')fail('Release base override is test-only');return u.href.replace(/\/$/,'')+'/v'+v}
  const repo=process.env.SPI_RELEASE_REPOSITORY || BUILD.repository
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))fail('Release repository is not configured; see release.config.example.json')
  return 'https://github.com/'+repo+'/releases/download/v'+v
}
async function selectedVersion(v) {
  if(v!=='latest')return version(v || BUILD.version)
  baseURL(BUILD.version)
  return (await latestRelease()).version
}
const supportedNow = () => { try { internals.target(); return true } catch { return false } }
// Read-only update probe for the GUI. Never installs and never accepts caller-supplied URLs.
// When nothing newer exists the manifest is not fetched, so "supported" then only reflects this host.
async function checkUpdate(options={}) {
  const currentVersion=options.currentVersion||BUILD.version
  if(!parseSemver(currentVersion))fail('Invalid current version')
  const t=process.platform+'-'+process.arch, policy={totalMs:30000,idleMs:15000,attempts:2,delayMs:500}
  const latest=await latestRelease(policy)
  const result={currentVersion,version:latest.version,available:compareSemver(latest.version,currentVersion)>0,target:t,supported:false,releaseUrl:latest.releaseUrl}
  if(!supportedNow())return result
  if(!result.available){result.supported=true;return result}
  const item=validateDescriptor(await fetchJSON(baseURL(latest.version)+'/release-manifest.json',{policy}),latest.version,internals.target())
  if(item){result.supported=true;result.file=item.file;result.size=item.size}
  return result
}
function ensureRoot(root) {
  fs.mkdirSync(root,{recursive:true,mode:0o700})
  const marker=path.join(root,'.spi-owned.json')
  if(fs.existsSync(marker)){if(readJSON(marker).owner!==OWNER)fail('Install root ownership mismatch')}
  else {if(fs.readdirSync(root).length)fail('Install root is not empty or owned by sPi');atomicJSON(marker,{owner:OWNER})}
}
// ---- Install lock ---------------------------------------------------------------------------------
// .install.lock is a directory holding owner.json {schema,owner,token(UUID),pid,start,host,boot,pidns,created}.
// A lock is only ever reclaimed when its owner is PROVABLY dead (ESRCH, a different Linux process start time /
// boot, or a zombie). Anything unverifiable (legacy empty lock from <=0.3.1, malformed metadata, another host or
// PID namespace, a live or EPERM-visible PID on a platform without start times) fails closed.
// Reclaiming renames the dead lock into the persistent, non-empty tombstone .retired-install-locks/<token>.
// rename(2) cannot replace a non-empty directory, so exactly one contender can ever retire a given token, even
// a delayed one that observed it long ago and finds a newer live lock at the path: its rename fails and it never
// touches that lock. Tombstones are tiny crash bookkeeping and are intentionally retained (never pruned).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const LOCK = '.install.lock', RETIRED = '.retired-install-locks', STAGE_MARKER = '.spi-stage.json'
const cleanups = []
// Best-effort synchronous cleanups run by CLI signal/crash handlers (LIFO: stage before lock).
function track(fn) { cleanups.push(fn); return () => { const i = cleanups.indexOf(fn); if (i >= 0) cleanups.splice(i, 1) } }
function runCleanups() { while (cleanups.length) { try { cleanups.pop()() } catch {} } }
function readTrim(file) { try { return fs.readFileSync(file, 'utf8').trim() } catch { return null } }
function procStat(pid) {
  if (process.platform !== 'linux') return null
  try { const s = fs.readFileSync('/proc/' + pid + '/stat', 'utf8'), rest = s.slice(s.lastIndexOf(')') + 2).split(' '); return { state: rest[0], start: rest[19] } } catch { return null }
}
function processStart(pid) { const s = procStat(pid); return s ? s.start : null }
function identity(pid = process.pid) {
  const id = { pid, start: processStart(pid) }
  if (process.platform === 'linux') {
    id.host = os.hostname(); id.boot = readTrim('/proc/sys/kernel/random/boot_id')
    try { id.pidns = fs.readlinkSync('/proc/self/ns/pid') } catch { id.pidns = null }
  }
  return id
}
// 'dead' only when the recorded process can no longer be running; 'live' or 'unknown' otherwise.
function ownerState(r) {
  if (process.platform === 'linux' && r.host) {
    const here = identity(process.pid)
    if (r.host !== here.host) return 'unknown'
    if (r.boot && here.boot && r.boot !== here.boot) return 'dead'
    if (r.pidns && here.pidns && r.pidns !== here.pidns) return 'unknown'
  }
  try { internals.kill(r.pid) } catch (error) { if (error.code === 'ESRCH') return 'dead'; if (error.code !== 'EPERM') return 'unknown' }
  if (process.platform !== 'linux') return 'live'
  const s = internals.procStat(r.pid)
  if (!s) return 'live'
  if (s.state === 'Z' || s.state === 'X') return 'dead'
  return r.start && s.start !== r.start ? 'dead' : 'live'
}
// Never follows a symlink; returns parsed JSON, or null when absent/oversized/unparsable.
function readSmallJSON(file, label) {
  let st; try { st = fs.lstatSync(file) } catch { return null }
  if (st.isSymbolicLink()) fail('Refusing symlink ' + label)
  if (!st.isFile() || st.size > 4096) return null
  let fd
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)) } catch (error) { if (error.code === 'ELOOP') fail('Refusing symlink ' + label); return null }
  try { return fs.fstatSync(fd).isFile() ? JSON.parse(fs.readFileSync(fd, 'utf8')) : null } catch { return null } finally { fs.closeSync(fd) }
}
function validLock(r) {
  return r && typeof r === 'object' && r.schema === 1 && r.owner === OWNER && typeof r.token === 'string' && UUID.test(r.token) && Number.isSafeInteger(r.pid) && r.pid > 0 ? r : null
}
// undefined: no lock. {record:null}: present but unrecognized (legacy/ownerless/malformed).
function inspectLock(lock) {
  let st; try { st = fs.lstatSync(lock) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  if (st.isSymbolicLink()) fail('Refusing symlink install lock')
  if (!st.isDirectory()) fail('Install lock is not a directory; refusing to modify it')
  return { record: validLock(readSmallJSON(path.join(lock, 'owner.json'), 'install lock metadata')) }
}
function retiredDir(root) {
  const dir = path.join(root, RETIRED)
  let st = null; try { st = fs.lstatSync(dir) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!st) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  else if (st.isSymbolicLink() || !st.isDirectory()) fail('Refusing unsafe retired-lock directory')
  return dir
}
// Returns true when this caller retired the lock; false when it vanished or another contender already retired
// this token. A caller must only pass a token whose owner it has just verified dead.
function retireLock(root, token) {
  if (typeof token !== 'string' || !UUID.test(token)) fail('Invalid install lock token')
  const lock = path.join(root, LOCK), dest = path.join(retiredDir(root), token)
  try { fs.renameSync(lock, dest) } catch (error) {
    if (error.code === 'ENOENT') return false
    let taken = false; try { fs.lstatSync(dest); taken = true } catch {}
    if (taken) return false
    throw error
  }
  const moved = validLock(readSmallJSON(path.join(dest, 'owner.json'), 'retired lock metadata'))
  if (!moved || moved.token !== token) {
    // Only reachable if the owner liveness verdict was wrong; put the lock back and refuse.
    try { fs.renameSync(dest, lock) } catch {}
    fail('Install lock changed during recovery; try again')
  }
  return true
}
function acquire(root) {
  const lock = path.join(root, LOCK)
  for (let attempt = 0; attempt < 8; attempt++) {
    try { fs.mkdirSync(lock, { mode: 0o700 }) } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const seen = inspectLock(lock)
      if (!seen) continue
      if (!seen.record) fail('Another install is active (or an unrecognized or legacy install lock exists); remove .install.lock manually only if no sPi installer is running')
      const state = ownerState(seen.record)
      if (state === 'live') fail('Another install is active (pid ' + seen.record.pid + ')')
      if (state !== 'dead') fail('Another install is active (or its owner cannot be verified on this machine); remove .install.lock manually only if no sPi installer is running')
      retireLock(root, seen.record.token)
      continue
    }
    const record = { schema: 1, owner: OWNER, token: crypto.randomUUID(), ...identity(), created: new Date().toISOString() }
    try { fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 }) }
    catch (error) { fs.rmSync(lock, { recursive: true, force: true }); throw error }
    return { lock, token: record.token }
  }
  fail('Another install is active (lock contention)')
}
// Only removes the lock if it still carries our token; never throws.
function release(held) {
  try {
    const seen = inspectLock(held.lock)
    if (seen && seen.record && seen.record.token === held.token) fs.rmSync(held.lock, { recursive: true, force: true })
  } catch {}
}
// Stages are named .staging-<lock token>-XXXXXX and carry a marker. Once a lock token has been retired as dead,
// remove only dirs whose name AND marker both bind to that token. Unmarked, mismatched, legacy, symlinked or
// user-created .staging-* entries are never removed (an empty unmarked token-named dir is rmdir'ed: crash window).
function sweepStages(root, own) {
  let names; try { names = fs.readdirSync(root) } catch { return }
  for (const name of names) {
    const m = /^\.staging-([0-9a-f-]{36})-[A-Za-z0-9]{6}$/.exec(name)
    if (!m || !UUID.test(m[1]) || m[1] === own) continue
    try {
      const dir = path.join(root, name), st = fs.lstatSync(dir)
      if (st.isSymbolicLink() || !st.isDirectory()) continue
      const tomb = fs.lstatSync(path.join(root, RETIRED, m[1]))
      if (tomb.isSymbolicLink() || !tomb.isDirectory()) continue
      const marker = readSmallJSON(path.join(dir, STAGE_MARKER), 'stage marker')
      if (!marker) { try { fs.rmdirSync(dir) } catch {} continue }
      if (marker.schema === 1 && marker.owner === OWNER && marker.kind === 'stage' && marker.token === m[1]) fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}
async function locked(root,action) {
  ensureRoot(root)
  const held = acquire(root), untrack = track(() => release(held))
  try { sweepStages(root, held.token); return await action(held) } finally { untrack(); release(held) }
}
function readCurrent(root) {
  if(readJSON(path.join(root,'.spi-owned.json')).owner!==OWNER)fail('Not an sPi install')
  const current=readJSON(path.join(root,'current.json'))
  version(current.version)
  if(!['linux-x64','linux-arm64','win32-x64','darwin-arm64','darwin-x64'].includes(current.target))fail('Invalid install target')
  if(current.directory!=='releases/'+current.version+'/'+current.target)fail('Invalid install record')
  safeName(current.entry);safeName(current.permissionExtension)
  const dir=path.join(root,current.directory)
  if(readJSON(path.join(dir,'.installed.json')).owner!==OWNER || fs.lstatSync(dir).isSymbolicLink())fail('Runtime ownership mismatch')
  const entry=path.join(dir,current.entry)
  if(!fs.existsSync(entry)||!fs.existsSync(path.join(dir,current.permissionExtension)))fail('Runtime is incomplete')
  if(!fs.realpathSync(entry).startsWith(fs.realpathSync(root)+path.sep))fail('Runtime escapes install root')
  return {...current,entryPath:entry}
}
function findPiBin() {
  for(const dir of (process.env.PATH || '').split(path.delimiter).filter(d=>d&&!/[\\/]node_modules[\\/]\.bin(?:[\\/]|$)/.test(d)))for(const name of process.platform==='win32'?['pi.cmd','pi.exe']:['pi']){
    const candidate=path.join(dir,name)
    try{fs.accessSync(candidate,fs.constants.X_OK);if(fs.statSync(candidate).isFile()){fs.accessSync(dir,fs.constants.W_OK);return path.resolve(dir)}}catch{}
  }
  return null
}
function shellQuote(s){return "'"+s.replaceAll("'","'\\''")+"'"}
function register(root, options={}) {
  const dir=path.resolve(options.binDir || process.env.SPI_BIN_DIR || findPiBin() || path.join(os.homedir(),'.local','bin'))
  fs.mkdirSync(dir,{recursive:true})
  const dest=path.join(dir,process.platform==='win32'?'spi.cmd':'spi'), oldState=fs.existsSync(path.join(root,'install-state.json'))?readJSON(path.join(root,'install-state.json')):{}
  const previous=(oldState.shims||[]).find(s=>s.path===dest)
  if(fs.existsSync(dest) || (()=>{try{return fs.lstatSync(dest).isSymbolicLink()}catch{return false}})()) {
    if(!previous||fs.lstatSync(dest).isSymbolicLink()||hash(dest)!==previous.sha256)fail('Refusing to overwrite an unowned or modified spi command; use --bin-dir')
  }
  const cur=readCurrent(root), cli=path.join(root,'launcher','spi.cjs')
  if(fs.existsSync(path.dirname(cli))&&fs.lstatSync(path.dirname(cli)).isSymbolicLink())fail('Refusing symlink launcher directory')
  fs.mkdirSync(path.dirname(cli),{recursive:true})
  if(oldState.launcher && fs.existsSync(cli) && (fs.lstatSync(cli).isSymbolicLink()||hash(cli)!==oldState.launcher.sha256))fail('Refusing to replace a modified launcher')
  // Prefer the newly verified runtime's helper, so the launcher does not lag one release behind.
  const bundled=path.join(root,cur.directory,path.posix.dirname(cur.permissionExtension),'spi-installer.cjs')
  const source=fs.existsSync(bundled)?bundled:__filename
  if(fs.lstatSync(source).isSymbolicLink()||!fs.statSync(source).isFile())fail('Invalid bundled installer')
  if(path.resolve(source)!==path.resolve(cli)){
    const temporary=cli+'.'+crypto.randomUUID()+'.tmp'
    try{fs.copyFileSync(source,temporary,fs.constants.COPYFILE_EXCL);fs.renameSync(temporary,cli)}finally{fs.rmSync(temporary,{force:true})}
  }
  // Installed Electron supplies Node mode; do not pin a transient Pi/Node installation path.
  const text=process.platform==='win32'
    ? '@echo off\r\nrem sPi managed launcher\r\nsetlocal DisableDelayedExpansion\r\nwhere node.exe >nul 2>nul\r\nif errorlevel 1 goto bundled\r\nnode.exe "'+cli.replaceAll('%','%%')+'" --install-dir "'+root.replaceAll('%','%%')+'" %*\r\nexit /b %errorlevel%\r\n:bundled\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"'+cur.entryPath.replaceAll('%','%%')+'" "'+cli.replaceAll('%','%%')+'" --install-dir "'+root.replaceAll('%','%%')+'" %*\r\n'
    : '#!/bin/sh\n# sPi managed launcher\nELECTRON_RUN_AS_NODE=1 exec '+shellQuote(cur.entryPath)+' '+shellQuote(cli)+' --install-dir '+shellQuote(root)+' "$@"\n'
  const temp=dest+'.'+crypto.randomUUID()+'.tmp'
  fs.writeFileSync(temp,text,{mode:0o755});fs.renameSync(temp,dest)
  const shims=(oldState.shims||[]).filter(s=>s.path!==dest);shims.push({path:dest,sha256:hash(dest)})
  let desktop=oldState.desktop
  if(process.platform==='linux'&&root===path.resolve(defaultRoot()))try{
    desktop=syncDesktopEntry({enabled:true,dataHome:process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),root,command:dest,entryPath:cur.entryPath,previous:desktop})
  }catch(error){console.warn('[sPi] Desktop entry unchanged: '+error.message)}
  atomicJSON(path.join(root,'install-state.json'),{owner:OWNER,shims,desktop,launcher:{sha256:hash(cli)}})
  console.log('sPi command: '+dest)
  if(!(process.env.PATH||'').split(path.delimiter).some(d=>path.resolve(d)===dir))console.log('Add this directory to your PATH: '+dir+' (shell configuration was not changed)')
}
async function install(options={}) {
  const root=rootFor(options), v=await selectedVersion(options.version), t=internals.target()
  return locked(root,async held=>{
    const stage=fs.mkdtempSync(path.join(root,'.staging-'+held.token+'-')), untrackStage=track(()=>fs.rmSync(stage,{recursive:true,force:true}))
    try{
      atomicJSON(path.join(stage,STAGE_MARKER),{schema:1,owner:OWNER,kind:'stage',token:held.token,pid:process.pid,created:new Date().toISOString()})
      const base=options.archive?null:baseURL(v)
      if(base)status('Preparing sPi '+v+' ('+t+'); retrieving the release manifest.')
      const manifest=options.manifest?readJSON(options.manifest):await fetchJSON(base+'/release-manifest.json')
      const item=validateDescriptor(manifest,v,t)
      if(!item)fail('Release does not support this version/platform')
      if(item.minGlibc && process.platform==='linux'){
        const actual=process.report.getReport().header.glibcVersionRuntime.split('.').map(Number), required=String(item.minGlibc).split('.').map(Number)
        if(required.length!==2||required.some(n=>!Number.isInteger(n)))fail('Invalid glibc baseline')
        if(actual[0]<required[0]||(actual[0]===required[0]&&actual[1]<required[1]))fail('This release requires glibc >= '+item.minGlibc)
      }
      const archive=path.join(stage,item.file)
      if(options.archive){if(!fs.statSync(options.archive).isFile()||fs.statSync(options.archive).size!==item.size)fail('Archive size mismatch');fs.copyFileSync(options.archive,archive)}else {
        await download(base+'/'+item.file,archive,item.size,{resume:true,sha256:item.sha256,progress:true})
      }
      if(fs.statSync(archive).size!==item.size || hash(archive)!==item.sha256.toLowerCase())fail('Release checksum/size mismatch')
      status('Checksum verified; extracting the runtime. Please wait.')
      if(item.file.endsWith('.tar.gz'))await extractTar(archive,stage);else await extractZip(archive,stage)
      for(const f of [item.entry,item.permissionExtension])if(!fs.statSync(path.join(stage,f)).isFile())fail('Release is incomplete')
      if(item.installerSha256){
        const helper=path.join(stage,path.posix.dirname(item.permissionExtension),'spi-installer.cjs')
        if(!fs.existsSync(helper)||fs.lstatSync(helper).isSymbolicLink()||!fs.statSync(helper).isFile()||hash(helper)!==item.installerSha256.toLowerCase())fail('Bundled installer checksum mismatch')
      }
      fs.rmSync(archive)
      // Mac payloads must carry an intact ad-hoc (or better) signature. This does not imply notarization;
      // Gatekeeper and quarantine attributes are never modified.
      if(t.startsWith('darwin'))verifyMacSignature(path.join(stage,'app/sPi.app'))
      atomicJSON(path.join(stage,'.installed.json'),{owner:OWNER,version:v,target:t,entry:item.entry,permissionExtension:item.permissionExtension,sha256:item.sha256})
      const directory='releases/'+v+'/'+t, dest=path.join(root,directory)
      for(const part of ['releases','releases/'+v,'releases/'+v+'/'+t]){const p=path.join(root,part);if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())fail('Refusing symlink release directory')}
      fs.mkdirSync(path.dirname(dest),{recursive:true})
      if(fs.existsSync(dest)){
        const old=readJSON(path.join(dest,'.installed.json'))
        if(old.owner!==OWNER||old.sha256!==item.sha256)fail('Version already exists with different contents')
      }else{fs.rmSync(path.join(stage,STAGE_MARKER),{force:true});fs.renameSync(stage,dest)}
      const pointer={schemaVersion:1,version:v,target:t,directory,entry:item.entry,permissionExtension:item.permissionExtension}
      const previous=fs.existsSync(path.join(root,'current.json'))?readJSON(path.join(root,'current.json')):null
      atomicJSON(path.join(root,'current.json'),pointer)
      try{register(root,options)}catch(error){if(previous)atomicJSON(path.join(root,'current.json'),previous);else fs.rmSync(path.join(root,'current.json'),{force:true});throw error}
      if(previous && previous.directory!==directory)atomicJSON(path.join(root,'previous.json'),previous)
      console.log('Installed sPi '+v+' ('+t+')')
      if(process.env.npm_lifecycle_event==='postinstall'&&!process.stdout.isTTY)status('Installed sPi '+v+' ('+t+'). Close and reopen any old window to use the new runtime.')
      return readCurrent(root)
    }finally{untrackStage();fs.rmSync(stage,{recursive:true,force:true})}
  })
}
function verifyMacSignature(bundle) {
  try{internals.codesign(bundle)}catch(error){fail('macOS code signature verification failed'+(error&&error.stderr&&String(error.stderr).trim()?': '+String(error.stderr).trim().split('\n')[0].slice(0,200):''))}
}
function personalInstall() {
  if(process.env.SPI_SKIP_INSTALL==='1'||process.env.CI)return false
  const agent=path.resolve(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(),'.pi','agent'))
  const prefix=process.env.npm_config_local_prefix || process.env.npm_config_prefix
  if(!prefix)return false
  try{return fs.realpathSync(prefix)===fs.realpathSync(path.join(agent,'npm'))}catch{return false}
}
async function rollback(options) {
  const root=rootFor(options)
  return locked(root,async()=>{
    const current=readJSON(path.join(root,'current.json')), previous=readJSON(path.join(root,'previous.json'))
    atomicJSON(path.join(root,'current.json'),previous)
    try{readCurrent(root);register(root,options);atomicJSON(path.join(root,'previous.json'),current)}catch(error){atomicJSON(path.join(root,'current.json'),current);throw error}
    console.log('Rolled back to sPi '+previous.version)
  })
}
function activeLaunches(root) {
  const dir=path.join(root,'.running')
  if(!fs.existsSync(dir))return false
  if(fs.lstatSync(dir).isSymbolicLink())fail('Refusing symlink runtime records')
  for(const name of fs.readdirSync(dir)){
    const file=path.join(dir,name), record=readJSON(file)
    if(!Number.isSafeInteger(record.pid)||record.pid<=0)fail('Invalid runtime record')
    let live=true
    try{process.kill(record.pid,0)}catch(error){live=error.code==='EPERM'}
    if(live&&(process.platform!=='linux'||processStart(record.pid)===record.start))return true
    fs.rmSync(file)
  }
  return false
}
async function uninstall(options) {
  const root=rootFor(options)
  if(process.platform==='win32' && path.resolve(process.execPath).startsWith(root+path.sep))fail('Use an external Node.js runtime (or npm exec --package '+BUILD.packageName+' -- spi uninstall) to remove a running Windows Electron runtime')
  await locked(root,async()=>{
    const state=readJSON(path.join(root,'install-state.json'))
    if(state.owner!==OWNER)fail('Install ownership mismatch')
    if(activeLaunches(root))fail('Close the running sPi application before uninstalling')
    // Preflight all owned trees before removing commands or touching user files.
    const releases=path.join(root,'releases'), owned=[]
    if(fs.existsSync(releases)){
      if(fs.lstatSync(releases).isSymbolicLink())fail('Refusing symlink releases')
      for(const v of fs.readdirSync(releases)){
        version(v)
        const vdir=path.join(releases,v)
        if(!fs.lstatSync(vdir).isDirectory()||fs.lstatSync(vdir).isSymbolicLink())fail('Unexpected release directory')
        for(const t of fs.readdirSync(vdir)){
          const dir=path.join(vdir,t)
          if(fs.lstatSync(dir).isSymbolicLink()||readJSON(path.join(dir,'.installed.json')).owner!==OWNER)fail('Unowned release directory')
          owned.push(dir)
        }
      }
    }
    const launcher=path.join(root,'launcher')
    if(fs.existsSync(launcher)&&fs.lstatSync(launcher).isSymbolicLink())fail('Refusing symlink launcher')
    const cli=path.join(launcher,'spi.cjs')
    if(fs.existsSync(cli)&&(!state.launcher||hash(cli)!==state.launcher.sha256||fs.lstatSync(cli).isSymbolicLink()))fail('Refusing modified launcher')
    assertDesktopOwned(state.desktop)
    for(const s of state.shims||[])if(fs.existsSync(s.path)){
      if(fs.lstatSync(s.path).isSymbolicLink()||hash(s.path)!==s.sha256)fail('Refusing to remove a modified command')
    }
    removeDesktopEntry(state.desktop)
    for(const s of state.shims||[])fs.rmSync(s.path,{force:true})
    // Remove only installer-owned paths, never an arbitrary user-supplied directory tree.
    for(const dir of owned)fs.rmSync(dir,{recursive:true,force:true})
    fs.rmSync(path.join(launcher,'spi.cjs'),{force:true})
    for(const name of ['current.json','previous.json','install-state.json'])fs.rmSync(path.join(root,name),{force:true})
    console.log('Uninstalled sPi binaries; preferences and Pi sessions were preserved')
  })
}
function parse(argv) {
  const options={},args=[]
  const flags={'--install-dir':'installDir','--bin-dir':'binDir','--version':'version','--archive':'archive','--manifest':'manifest','--cwd':'cwd','--current-version':'currentVersion'}
  for(let i=0;i<argv.length;i++){
    const a=argv[i]
    if(a==='--version' && !argv[i+1]){args.push('version');continue}
    if(flags[a]){if(!argv[i+1]||argv[i+1].startsWith('--'))fail('Missing option value: '+a);options[flags[a]]=argv[++i]}
    else if(a==='--json')options.json=true
    else if(a==='--help'||a==='-h')args.push('help')
    else if(a.startsWith('-'))fail('Unknown option: '+a)
    else args.push(a)
  }
  if(args.length>1)fail('Unexpected arguments')
  const command=args[0]||'launch'
  if(options.json&&!['check-update','install','doctor'].includes(command))fail('--json is not supported for this command')
  if(options.currentVersion!==undefined&&command!=='check-update')fail('--current-version is only supported by check-update')
  return {command,options}
}
async function launch(options) {
  const root=rootFor(options), current=readCurrent(root), env={...process.env}
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_VITE_DEV_SERVER_URL
  const args=[]
  if(options.cwd){const cwd=path.resolve(options.cwd);if(!fs.statSync(cwd).isDirectory())fail('Not a directory');args.push('--cwd='+cwd)}
  const records=path.join(root,'.running')
  if(fs.existsSync(records)&&fs.lstatSync(records).isSymbolicLink())fail('Invalid runtime records')
  fs.mkdirSync(records,{recursive:true,mode:0o700})
  const record=path.join(records,crypto.randomUUID()+'.json')
  const child=spawn(current.entryPath,args,{env,stdio:'inherit',cwd:process.cwd()})
  return new Promise((resolve,reject)=>{
    child.once('spawn',()=>atomicJSON(record,{pid:child.pid,start:processStart(child.pid)}))
    child.once('error',reject)
    child.once('exit',(code,signal)=>{fs.rmSync(record,{force:true});if(signal)failSafeSignal(signal);process.exitCode=code??1;resolve()})
  })
}
function failSafeSignal(signal){console.error('sPi terminated: '+signal)}
async function main(argv=process.argv.slice(2)) {
  // Electron's virtual ASAR filesystem must not interpret a partially extracted app.asar.
  // This flag is process-local; the actual GUI child starts with normal ASAR support.
  if(process.versions.electron)process.noAsar=true
  const {command,options}=parse(argv)
  if(command==='postinstall'){
    if(!personalInstall()){console.log('sPi: automatic install skipped outside a verified personal Pi install. Run /spi-install or spi install explicitly.');return}
    await install({...options,version:BUILD.version});return
  }
  if(command==='help'){console.log('sPi - Simple Pi Agent GUI\nspi [--cwd DIR] | --version | doctor | install | update | rollback | uninstall\ncheck-update [--current-version VERSION] [--json]\nOptions: --install-dir DIR --bin-dir DIR --version VERSION --archive FILE --manifest FILE --json');return}
  if(command==='version'){try{console.log(readCurrent(rootFor(options)).version)}catch{console.log(BUILD.version)};return}
  if(command==='check-update'){
    const result=await checkUpdate(options)
    if(options.json)process.stdout.write(JSON.stringify(result)+'\n')
    else console.log(result.available?'sPi '+result.version+' is available ('+(result.supported?'supported':'unsupported on '+result.target)+'): '+result.releaseUrl:'sPi is up to date ('+result.currentVersion+')')
    return
  }
  if(command==='install'&&options.json){
    // Machine-readable mode: stdout carries exactly one JSON document; all prose goes to stderr.
    if(!parseSemver(options.version))fail('--json install requires an exact --version')
    const log=console.log;console.log=(...args)=>console.error(...args)
    let current
    try{await install({...options});current=readCurrent(rootFor(options))}finally{console.log=log}
    process.stdout.write(JSON.stringify(current)+'\n')
    return
  }
  if(command==='install'||command==='update'){await install({...options,version:options.version||(command==='update'?'latest':BUILD.version)});return}
  if(command==='rollback'){await rollback(options);return}
  if(command==='uninstall'){await uninstall(options);return}
  if(command==='doctor'){const root=rootFor(options);console.log(JSON.stringify({root,platform:target(),current:readCurrent(root),locked:fs.existsSync(path.join(root,'.install.lock'))},null,2));return}
  if(command!=='launch')fail('Unknown command')
  await launch(options)
}
module.exports={main,install,checkUpdate,compareSemver,parseSemver,validateDescriptor,verifyMacSignature,internals,fetchJSON,rollback,uninstall,readCurrent,rootFor,personalInstall,validateEntries,extractTar,extractZip,parse,BUILD}
// CLI entry only: a closed stdout/stderr pipe (EPIPE) or a termination signal must release the lock and stage
// instead of orphaning them. SIGKILL/power loss cannot be handled here; the next install reclaims via acquire().
function guardProcess(){
  for(const stream of [process.stdout,process.stderr])stream.on('error',()=>{})
  for(const [signal,code] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]])process.once(signal,()=>{runCleanups();process.exit(code)})
  process.once('uncaughtException',error=>{runCleanups();try{console.error('sPi: '+(error&&error.message))}catch{};process.exit(1)})
}
if(require.main===module){guardProcess();main().catch(error=>{console.error('sPi: '+error.message);process.exitCode=1})}
