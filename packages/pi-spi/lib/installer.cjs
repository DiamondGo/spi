'use strict'
// Bundled into a standalone installer/launcher. Never edit Pi's settings or execute archive scripts.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { pipeline } = require('node:stream/promises')
const tar = require('tar')
const yauzl = require('yauzl')
const { syncDesktopEntry, assertDesktopOwned, removeDesktopEntry } = require('./desktop.cjs')
const BUILD = typeof __SPI_RELEASE__ === 'undefined'
  ? { version: require('../../../package.json').version, repository: require('../../../release.config.json').repository, packageName: require('../../../release.config.json').npmPackage }
  : __SPI_RELEASE__
const OWNER = 'sPi-installer-v1'
const MAX_ARCHIVE = 700 * 1024 * 1024, MAX_EXPANDED = 1600 * 1024 * 1024, MAX_ENTRIES = 40000
function fail(message) { throw new Error(message) }
function version(v) { if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)) fail('Invalid version'); return v }
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
function trustedURL(value) {
  const u=new URL(value)
  if(u.username||u.password)fail('URL credentials are not supported')
  const loopback=['127.0.0.1','localhost','[::1]'].includes(u.hostname)
  if(process.env.SPI_ALLOW_TEST_HTTP==='1' && loopback && u.protocol==='http:')return u
  if(u.protocol!=='https:' || !(u.hostname==='github.com'||u.hostname==='api.github.com'||u.hostname.endsWith('.githubusercontent.com')))fail('Only GitHub HTTPS release URLs are supported')
  return u
}
async function download(url,file,max=MAX_ARCHIVE) {
  let current=trustedURL(url), response
  for(let n=0;n<6;n++) {
    response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(180000),headers:{'User-Agent':'sPi-installer','Accept':'application/octet-stream'}})
    if([301,302,303,307,308].includes(response.status)){current=trustedURL(new URL(response.headers.get('location'),current));await response.body?.cancel();continue}
    break
  }
  if(!response?.ok){await response?.body?.cancel();fail('Download failed: HTTP '+response?.status)}
  if(Number(response.headers.get('content-length'))>max){await response.body.cancel();fail('Download size limit exceeded')}
  const out=await fsp.open(file,'wx',0o600);let bytes=0
  try{for await(const chunk of response.body){bytes+=chunk.length;if(bytes>max)fail('Download size limit exceeded');await out.writeFile(chunk)}}finally{await out.close()}
}
async function fetchJSON(url) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-metadata-'))
  try{const f=path.join(tmp,'data.json');await download(url,f,2*1024*1024);return readJSON(f)}finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
function baseURL(v) {
  if(process.env.SPI_RELEASE_BASE_URL){const u=trustedURL(process.env.SPI_RELEASE_BASE_URL);if(process.env.SPI_ALLOW_TEST_HTTP!=='1'||u.protocol!=='http:')fail('Release base override is test-only');return u.href.replace(/\/$/,'')+'/v'+v}
  const repo=process.env.SPI_RELEASE_REPOSITORY || BUILD.repository
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))fail('Release repository is not configured; see release.config.example.json')
  return 'https://github.com/'+repo+'/releases/download/v'+v
}
async function selectedVersion(v) {
  if(v!=='latest')return version(v || BUILD.version)
  if(process.env.SPI_RELEASE_BASE_URL)fail('Tests must pin a version')
  const repo=process.env.SPI_RELEASE_REPOSITORY || BUILD.repository
  baseURL(BUILD.version)
  const release=await fetchJSON('https://api.github.com/repos/'+repo+'/releases/latest')
  return version(String(release.tag_name).replace(/^v/,''))
}
function ensureRoot(root) {
  fs.mkdirSync(root,{recursive:true,mode:0o700})
  const marker=path.join(root,'.spi-owned.json')
  if(fs.existsSync(marker)){if(readJSON(marker).owner!==OWNER)fail('Install root ownership mismatch')}
  else {if(fs.readdirSync(root).length)fail('Install root is not empty or owned by sPi');atomicJSON(marker,{owner:OWNER})}
}
async function locked(root,action) {
  ensureRoot(root)
  const lock=path.join(root,'.install.lock')
  try{fs.mkdirSync(lock)}catch(error){if(error.code==='EEXIST')fail('Another install is active (or a stale lock exists); inspect with spi doctor');throw error}
  try{return await action()}finally{fs.rmSync(lock,{recursive:true,force:true})}
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
  if(path.resolve(__filename)!==path.resolve(cli))fs.copyFileSync(__filename,cli)
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
  const root=rootFor(options), v=await selectedVersion(options.version), t=target()
  return locked(root,async()=>{
    const stage=fs.mkdtempSync(path.join(root,'.staging-'))
    try{
      const base=options.archive?null:baseURL(v)
      const manifest=options.manifest?readJSON(options.manifest):await fetchJSON(base+'/release-manifest.json')
      const item=manifest.targets?.[t]
      if(manifest.schemaVersion!==1||manifest.version!==v||!item)fail('Release does not support this version/platform')
      if(!/^spi-[A-Za-z0-9.-]+\.(tar\.gz|zip)$/.test(item.file)||!(/^[a-f0-9]{64}$/i).test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<=0||item.size>MAX_ARCHIVE)fail('Invalid release manifest')
      safeName(item.entry);safeName(item.permissionExtension)
      if(item.minGlibc && process.platform==='linux'){
        const actual=process.report.getReport().header.glibcVersionRuntime.split('.').map(Number), required=String(item.minGlibc).split('.').map(Number)
        if(required.length!==2||required.some(n=>!Number.isInteger(n)))fail('Invalid glibc baseline')
        if(actual[0]<required[0]||(actual[0]===required[0]&&actual[1]<required[1]))fail('This release requires glibc >= '+item.minGlibc)
      }
      const archive=path.join(stage,item.file)
      if(options.archive){if(!fs.statSync(options.archive).isFile()||fs.statSync(options.archive).size!==item.size)fail('Archive size mismatch');fs.copyFileSync(options.archive,archive)}else {
        for(let attempt=0;;attempt++)try{await download(base+'/'+item.file,archive,item.size);break}catch(error){fs.rmSync(archive,{force:true});if(attempt===2)throw error;await new Promise(r=>setTimeout(r,500*(attempt+1)))}
      }
      if(fs.statSync(archive).size!==item.size || hash(archive)!==item.sha256.toLowerCase())fail('Release checksum/size mismatch')
      if(item.file.endsWith('.tar.gz'))await extractTar(archive,stage);else await extractZip(archive,stage)
      for(const f of [item.entry,item.permissionExtension])if(!fs.statSync(path.join(stage,f)).isFile())fail('Release is incomplete')
      fs.rmSync(archive)
      atomicJSON(path.join(stage,'.installed.json'),{owner:OWNER,version:v,target:t,entry:item.entry,permissionExtension:item.permissionExtension,sha256:item.sha256})
      const directory='releases/'+v+'/'+t, dest=path.join(root,directory)
      for(const part of ['releases','releases/'+v,'releases/'+v+'/'+t]){const p=path.join(root,part);if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())fail('Refusing symlink release directory')}
      fs.mkdirSync(path.dirname(dest),{recursive:true})
      if(fs.existsSync(dest)){
        const old=readJSON(path.join(dest,'.installed.json'))
        if(old.owner!==OWNER||old.sha256!==item.sha256)fail('Version already exists with different contents')
      }else fs.renameSync(stage,dest)
      const pointer={schemaVersion:1,version:v,target:t,directory,entry:item.entry,permissionExtension:item.permissionExtension}
      const previous=fs.existsSync(path.join(root,'current.json'))?readJSON(path.join(root,'current.json')):null
      atomicJSON(path.join(root,'current.json'),pointer)
      try{register(root,options)}catch(error){if(previous)atomicJSON(path.join(root,'current.json'),previous);else fs.rmSync(path.join(root,'current.json'),{force:true});throw error}
      if(previous && previous.directory!==directory)atomicJSON(path.join(root,'previous.json'),previous)
      console.log('Installed sPi '+v+' ('+t+')')
      return readCurrent(root)
    }finally{fs.rmSync(stage,{recursive:true,force:true})}
  })
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
function processStart(pid) {
  if(process.platform!=='linux')return null
  try{const s=fs.readFileSync('/proc/'+pid+'/stat','utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[19]}catch{return null}
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
  const flags={'--install-dir':'installDir','--bin-dir':'binDir','--version':'version','--archive':'archive','--manifest':'manifest','--cwd':'cwd'}
  for(let i=0;i<argv.length;i++){
    const a=argv[i]
    if(a==='--version' && !argv[i+1]){args.push('version');continue}
    if(flags[a]){if(!argv[i+1]||argv[i+1].startsWith('--'))fail('Missing option value: '+a);options[flags[a]]=argv[++i]}
    else if(a==='--help'||a==='-h')args.push('help')
    else if(a.startsWith('-'))fail('Unknown option: '+a)
    else args.push(a)
  }
  if(args.length>1)fail('Unexpected arguments')
  return {command:args[0]||'launch',options}
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
  if(command==='help'){console.log('sPi - Simple Pi Agent GUI\nspi [--cwd DIR] | --version | doctor | install | update | rollback | uninstall\nOptions: --install-dir DIR --bin-dir DIR --version VERSION --archive FILE --manifest FILE');return}
  if(command==='version'){try{console.log(readCurrent(rootFor(options)).version)}catch{console.log(BUILD.version)};return}
  if(command==='install'||command==='update'){await install({...options,version:options.version||(command==='update'?'latest':BUILD.version)});return}
  if(command==='rollback'){await rollback(options);return}
  if(command==='uninstall'){await uninstall(options);return}
  if(command==='doctor'){const root=rootFor(options);console.log(JSON.stringify({root,platform:target(),current:readCurrent(root),locked:fs.existsSync(path.join(root,'.install.lock'))},null,2));return}
  if(command!=='launch')fail('Unknown command')
  await launch(options)
}
module.exports={main,install,rollback,uninstall,readCurrent,rootFor,personalInstall,validateEntries,extractTar,extractZip,parse,BUILD}
if(require.main===module)main().catch(error=>{console.error('sPi: '+error.message);process.exitCode=1})
