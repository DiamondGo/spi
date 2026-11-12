const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), crypto=require('node:crypto')
const {execFileSync}=require('node:child_process')
const {build}=require('esbuild'), tar=require('tar'), asar=require('@electron/asar')
const root=path.resolve(__dirname,'..'), pkg=require('../package.json')
function config(){
  const defaults=require('../release.config.json')
  const file=path.join(root,'release.config.local.json'), local=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{}
  const result={version:pkg.version,repository:process.env.SPI_RELEASE_REPOSITORY||local.repository||defaults.repository,packageName:process.env.SPI_NPM_PACKAGE||local.npmPackage||defaults.npmPackage}
  if(result.repository&&!/^[\w.-]+\/[\w.-]+$/.test(result.repository))throw Error('Invalid repository')
  if(!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(result.packageName))throw Error('Invalid npm package name')
  if(process.argv.includes('--production')&&(!result.repository||result.repository.includes('your-owner')||result.packageName.includes('your-scope')))throw Error('Configure real repository/npm package before publishing')
  return result
}
async function prepare(){
  const cfg=config(), out=path.join(root,'dist','npm-package')
  fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(path.join(out,'dist'),{recursive:true})
  const result=await build({entryPoints:[path.join(root,'packages/pi-spi/lib/installer.cjs')],outfile:path.join(out,'dist/spi.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',sourcemap:false,legalComments:'eof',metafile:true,define:{__SPI_RELEASE__:JSON.stringify(cfg)}})
  const notice=[];const seen=new Set()
  for(const input of Object.keys(result.metafile.inputs)){
    let dir=path.dirname(path.resolve(root,input))
    while(dir!==path.dirname(dir)&&!fs.existsSync(path.join(dir,'package.json')))dir=path.dirname(dir)
    if(!dir.includes('node_modules')||seen.has(dir))continue
    seen.add(dir);const p=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'))
    const license=fs.readdirSync(dir).find(f=>/^licen[sc]e(?:\.|$)/i.test(f))
    notice.push(p.name+' '+p.version+'\n'+(license?fs.readFileSync(path.join(dir,license),'utf8'):'License: '+p.license))
  }
  fs.writeFileSync(path.join(out,'INSTALLER-NOTICES.txt'),notice.join('\n\n---\n\n'))
  for(const name of ['bin','extensions'])fs.cpSync(path.join(root,'packages/pi-spi',name),path.join(out,name),{recursive:true})
  for(const name of ['README.md','CHANGELOG.md'])fs.copyFileSync(path.join(root,'packages/pi-spi',name),path.join(out,name))
  fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({name:cfg.packageName,version:cfg.version,description:'sPi - Simple Pi Agent GUI installer and Pi launcher',type:'module',license:'UNLICENSED',engines:{node:'>=22.19.0'},keywords:['pi-package'],bin:{spi:'bin/spi.cjs'},scripts:{postinstall:'node dist/spi.cjs postinstall'},pi:{extensions:['extensions/launcher.ts']},peerDependencies:{'@earendil-works/pi-coding-agent':'*'},peerDependenciesMeta:{'@earendil-works/pi-coding-agent':{optional:true}},files:['bin','dist','extensions','README.md','CHANGELOG.md','INSTALLER-NOTICES.txt'],...(cfg.repository?{repository:{type:'git',url:'https://github.com/'+cfg.repository+'.git'}}:{})},null,2)+'\n')
  fs.chmodSync(path.join(out,'bin/spi.cjs'),0o755)
  const release=path.join(root,'dist','release');fs.mkdirSync(release,{recursive:true})
  fs.copyFileSync(path.join(out,'dist/spi.cjs'),path.join(release,'spi-installer.cjs'))
  fs.copyFileSync(path.join(out,'INSTALLER-NOTICES.txt'),path.join(release,'INSTALLER-NOTICES.txt'))
  // A release-specific bootstrap never follows a moving branch.
  const bootstrap=fs.readFileSync(path.join(root,'install.sh'),'utf8').replace(/^SPI_DEFAULT_REPOSITORY='[^']*'$/m,"SPI_DEFAULT_REPOSITORY='"+cfg.repository+"'").replace("SPI_BOOTSTRAP_VERSION='latest'","SPI_BOOTSTRAP_VERSION='"+cfg.version+"'")
  fs.writeFileSync(path.join(release,'install.sh'),bootstrap,{mode:0o755})
  console.log('Prepared light npm package and bootstrap (no desktop binaries in npm)')
}
// Native addon modules shipped in the runtime. node-pty is always rebuilt
// from source; bufferutil/utf-8-validate are optional websocket accelerators
// pulled in by the dev-tunnels relay and are rebuilt on native runners too.
const NATIVE_ADDONS={
  'node-pty':['build/Release/pty.node','build/Release/spawn-helper'],
  'bufferutil':['build/Release/bufferutil.node'],
  'utf-8-validate':['build/Release/utf-8-validate.node']
}
function pruneAddon(directory,platform,arch,localArtifacts){
  if(!fs.existsSync(directory))return
  for(const name of fs.readdirSync(directory))if(!['lib','package.json','LICENSE','LICENSE.txt','build','prebuilds'].includes(name))fs.rmSync(path.join(directory,name),{recursive:true,force:true})
  const buildDir=path.join(directory,'build')
  if(fs.existsSync(buildDir))for(const name of fs.readdirSync(buildDir))if(name!=='Release')fs.rmSync(path.join(buildDir,name),{recursive:true,force:true})
  function runtimeOnly(dir){
    if(!fs.existsSync(dir))return
    for(const e of fs.readdirSync(dir,{withFileTypes:true})){
      const f=path.join(dir,e.name)
      if(e.isDirectory()){
        if(/^(?:obj(?:\..*)?|\.deps)$/.test(e.name))fs.rmSync(f,{recursive:true,force:true})
        else{runtimeOnly(f);if(!fs.readdirSync(f).length)fs.rmdirSync(f)}
      }else if(!/\.(node|dll|exe)$/i.test(e.name)&&e.name!=='spawn-helper')fs.rmSync(f,{force:true})
    }
  }
  runtimeOnly(path.join(buildDir,'Release'))
  const prebuilt=path.join(directory,'prebuilds')
  // Rebuilt addons load build/Release first. Do not ship unused upstream
  // prebuilds (which can contain their producer's absolute build paths); keep
  // them only as a fallback when no local rebuild is present.
  if(platform==='darwin'&&localArtifacts.every(a=>fs.existsSync(path.join(directory,a))))fs.rmSync(prebuilt,{recursive:true,force:true})
  if(fs.existsSync(prebuilt))for(const name of fs.readdirSync(prebuilt)){
    if(name!==platform+'-'+arch)fs.rmSync(path.join(prebuilt,name),{recursive:true,force:true})
    else runtimeOnly(path.join(prebuilt,name))
  }
}
function keepPty(directory,platform=process.platform,arch=process.arch){
  for(const [name,artifacts] of Object.entries(NATIVE_ADDONS)){
    const base=path.join(path.dirname(directory),name)
    pruneAddon(base,platform,arch,artifacts)
  }
}
function stripMacDebug(directory,platform=process.platform,run=execFileSync){
  if(platform!=='darwin')return
  // ld's N_OSO debug-map entries can retain absolute object paths even when
  // clang's DWARF/source prefix maps are set. Strip debug metadata before
  // ASAR integrity is generated and before electron-builder signs the app.
  for(const name of ['pty.node','spawn-helper']){
    const file=path.join(directory,'build/Release',name)
    if(!fs.existsSync(file))throw Error('Missing rebuilt macOS PTY runtime: '+name)
    run('/usr/bin/strip',['-S',file],{stdio:['ignore','pipe','pipe']})
  }
  // Optional websocket accelerators are rebuilt alongside node-pty on native
  // runners and need the same debug-metadata removal before the privacy scan.
  for(const [addon,filename] of Object.entries({bufferutil:'bufferutil.node','utf-8-validate':'utf-8-validate.node'})){
    const file=path.join(directory,'..',addon,'build/Release',filename)
    if(fs.existsSync(file))run('/usr/bin/strip',['-S',file],{stdio:['ignore','pipe','pipe']})
  }
  require('./privacy.cjs').scanTree(directory,{binary:true})
}
function restoreUnpackedModes(original,extracted){
  if(!fs.existsSync(original))return
  function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const source=path.join(dir,e.name),target=path.join(extracted,path.relative(original,source))
    if(e.isSymbolicLink())continue
    if(e.isDirectory()){visit(source);continue}
    if(fs.existsSync(target)&&fs.lstatSync(target).isFile())fs.chmodSync(target,fs.statSync(source).mode&0o777)
  }}
  visit(original)
}
async function sanitizeRuntime(resources){
  const archive=path.join(resources,'app.asar'), tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-public-runtime-'))
  try{
    asar.extractAll(archive,tmp)
    // ASAR unpacked entries omit executable metadata; extractAll otherwise
    // turns spawn-helper into a non-executable file. Preserve original modes,
    // without following links or retaining setuid/setgid bits.
    restoreUnpackedModes(archive+'.unpacked',tmp)
    const ptyDirectory=path.join(tmp,'node_modules','node-pty')
    keepPty(ptyDirectory)
    stripMacDebug(ptyDirectory)
    const manifest=JSON.parse(fs.readFileSync(path.join(tmp,'package.json'),'utf8'))
    // No developer scripts/paths are needed at runtime.
    delete manifest.scripts;delete manifest.devDependencies
    fs.writeFileSync(path.join(tmp,'package.json'),JSON.stringify(manifest))
    fs.rmSync(archive);fs.rmSync(archive+'.unpacked',{recursive:true,force:true})
    await asar.createPackageWithOptions(tmp,archive,{unpackDir:'node_modules/node-pty'})
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
function copyRuntime(from,to){fs.cpSync(from,to,{recursive:true,dereference:false,verbatimSymlinks:true})}
async function archive(){
  const cfg=config(), args=process.argv, from=path.resolve(args[args.indexOf('--from')+1]||''), t=args[args.indexOf('--target')+1]
  if(!args.includes('--from')||!args.includes('--target')||!['linux-x64','linux-arm64','win32-x64','darwin-arm64','darwin-x64'].includes(t))throw Error('archive --from DIR --target PLATFORM-ARCH')
  if(t!==process.platform+'-'+process.arch)throw Error('Build/archive on the native target runner; architecture mismatch')
  const release=path.join(root,'dist/release');fs.mkdirSync(release,{recursive:true})
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),'spi-runtime-archive-')), appDir=path.join(stage,'app')
  try{
    copyRuntime(from,appDir)
    const entry=t.startsWith('darwin')?'app/sPi.app/Contents/MacOS/sPi':t.startsWith('win32')?'app/sPi.exe':'app/spi'
    const resources=t.startsWith('darwin')?path.join(appDir,'sPi.app/Contents/Resources'):path.join(appDir,'resources')
    if(!fs.existsSync(path.join(stage,entry))||!fs.existsSync(path.join(resources,'spi-permission-extension.mjs')))throw Error('Incomplete runtime')
    // Abort instead of publishing local build paths or user data hidden inside the ASAR.
    require('./privacy.cjs').scanTree(stage,{binary:true})
    const file='spi-'+cfg.version+'-'+t+(t.startsWith('linux')?'.tar.gz':'.zip'), dest=path.join(release,file)
    fs.rmSync(dest,{force:true})
    if(t.startsWith('linux'))await tar.c({gzip:true,file:dest,cwd:stage,portable:true},['app'])
    else if(t.startsWith('darwin'))execFileSync('ditto',['-c','-k','--norsrc','--keepParent',appDir,dest])
    else execFileSync('powershell',['-NoProfile','-NonInteractive','-Command','$ErrorActionPreference="Stop"; Compress-Archive -LiteralPath $env:SPI_ZIP_SOURCE -DestinationPath $env:SPI_ZIP_DEST'],{env:{...process.env,SPI_ZIP_SOURCE:appDir,SPI_ZIP_DEST:dest}})
    const item={file,size:fs.statSync(dest).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex'),entry,permissionExtension:path.posix.join(path.posix.dirname(entry),t.startsWith('darwin')?'../Resources/spi-permission-extension.mjs':'resources/spi-permission-extension.mjs')}
    if(t.startsWith('linux'))item.minGlibc=process.report.getReport().header.glibcVersionRuntime
    // Manifest paths must be normalized and contained in app/.
    item.permissionExtension=path.posix.normalize(item.permissionExtension)
    fs.writeFileSync(path.join(release,t+'.json'),JSON.stringify({version:cfg.version,target:t,...item},null,2))
    console.log('Archived '+file)
  }finally{fs.rmSync(stage,{recursive:true,force:true})}
}
function manifest(){
  const cfg=config(), release=path.join(root,'dist/release'), targets={}
  for(const name of fs.readdirSync(release).filter(n=>/^(linux|win32|darwin)-.+\.json$/.test(n))){const item=JSON.parse(fs.readFileSync(path.join(release,name)));if(item.version!==cfg.version)throw Error('Mixed versions');const {target,version,...rest}=item;targets[target]=rest}
  if(!Object.keys(targets).length)throw Error('No verified target descriptors')
  fs.writeFileSync(path.join(release,'release-manifest.json'),JSON.stringify({schemaVersion:1,version:cfg.version,targets},null,2)+'\n')
  const files=fs.readdirSync(release).filter(n=>!n.endsWith('.json')||n==='release-manifest.json').filter(n=>n!=='SHA256SUMS').sort()
  fs.writeFileSync(path.join(release,'SHA256SUMS'),files.map(n=>crypto.createHash('sha256').update(fs.readFileSync(path.join(release,n))).digest('hex')+'  '+n).join('\n')+'\n')
}
if(require.main===module)(async()=>{const cmd=process.argv[2];if(cmd==='prepare')await prepare();else if(cmd==='archive')await archive();else if(cmd==='manifest')manifest();else throw Error('prepare | archive | manifest')})().catch(e=>{console.error(e.message);process.exitCode=1})
module.exports={config,prepare,archive,manifest,sanitizeRuntime,keepPty,stripMacDebug,copyRuntime,restoreUnpackedModes,NATIVE_ADDONS}
