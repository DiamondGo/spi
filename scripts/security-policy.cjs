// One user-approved BUILD-ONLY exception for 0.3.3, not a global audit downgrade.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process')
const VERSION='0.3.3',ADVISORY='https://github.com/advisories/GHSA-fc5q-39xc-vjpf'
const FORBIDDEN=['picomatch','fdir','tinyglobby','node-gyp','@electron/rebuild']
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
function evaluateAudit(audit,lock,version){
  if(audit?.error||audit?.auditReportVersion!==2||!audit.vulnerabilities||!audit.metadata?.vulnerabilities)throw Error('Audit was incomplete or has an unsupported format')
  const counts=audit.metadata.vulnerabilities
  if(!Number.isSafeInteger(counts.high)||counts.high<0||!Number.isSafeInteger(counts.critical)||counts.critical<0)throw Error('Invalid audit severity counts')
  if(counts.critical>0)throw Error('Unapproved critical audit findings')
  const vulnerabilities=audit.vulnerabilities,exceptions=new Set(),blocked=new Set()
  if(Object.values(vulnerabilities).filter(v=>v.severity==='high').length!==counts.high)throw Error('Audit severity counts do not match findings')
  for(const [name,item] of Object.entries(vulnerabilities)){
    const leaves=[]
    function visit(key,seen=new Set()){
      if(seen.has(key))return
      const entry=vulnerabilities[key]
      if(!entry||!Array.isArray(entry.via))throw Error('Incomplete advisory dependency graph')
      const next=new Set(seen);next.add(key)
      for(const via of entry.via){if(typeof via==='string')visit(via,next);else if(via&&['high','critical'].includes(via.severity))leaves.push(via)}
    }
    visit(name)
    if(!['high','critical'].includes(item.severity)&&!leaves.length)continue
    if(!leaves.length){blocked.add(name+': high severity without a resolved advisory');continue}
    const devOnly=Array.isArray(item.nodes)&&item.nodes.length>0&&item.nodes.every(node=>lock?.packages?.[node]?.dev===true)
    for(const leaf of leaves){
      if(version===VERSION&&devOnly&&item.severity!=='critical'&&leaf.severity==='high'&&leaf.name==='picomatch'&&leaf.dependency==='picomatch'&&leaf.url===ADVISORY&&leaf.range==='<=4.0.7')exceptions.add(ADVISORY)
      else blocked.add(name+': '+(leaf.url||leaf.title||'unknown advisory'))
    }
  }
  if((counts.high||counts.critical)&&!exceptions.size&&!blocked.size)throw Error('Audit severity counts have no advisory details')
  if(blocked.size)throw Error('Unapproved high/critical audit findings: '+[...blocked].join('; '))
  return{version,exceptionUsed:exceptions.size>0,acceptedAdvisories:[...exceptions],reportedCounts:counts}
}
function checkInputs(inputs){
  for(const file of Object.keys(inputs)){
    const value=file.replaceAll('\\','/')
    if(FORBIDDEN.some(name=>value.includes('node_modules/'+name+'/')||value.endsWith('node_modules/'+name)))throw Error('Build-only dependency bundled in installer: '+file)
  }
}
function scanRuntime(resources,version){
  const asar=require('@electron/asar'),archive=path.join(resources,'app.asar'),entries=asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,''))
  for(const entry of entries)if(FORBIDDEN.some(name=>entry.includes('node_modules/'+name+'/')||entry.endsWith('node_modules/'+name)))throw Error('Build-only dependency shipped in runtime: '+entry)
  let scriptsScanned=0
  const check=(text,label)=>{if(/\bpicomatch\b|analyzeRepeatedExtglob/.test(text))throw Error('Picomatch implementation/reference in executable runtime: '+label)}
  for(const entry of entries.filter(n=>/\.(?:js|mjs|cjs)$/.test(n))){
    const stat=asar.statFile(archive,entry,false);if(stat.files||stat.link)continue
    check(asar.extractFile(archive,entry).toString(),entry);scriptsScanned++
  }
  const helper=fs.readFileSync(path.join(resources,'spi-installer.cjs'))
  const base=fs.realpathSync(resources)+path.sep,visited=new Set()
  function walk(directory){
    const real=fs.realpathSync(directory)
    if(real+path.sep!==base&&!real.startsWith(base))throw Error('Runtime resource link escapes its root')
    if(visited.has(real))return;visited.add(real)
    for(const name of fs.readdirSync(directory)){
      const file=path.join(directory,name),relative=path.relative(resources,file).replaceAll('\\','/')
      if(FORBIDDEN.some(module=>relative.includes('node_modules/'+module+'/')||relative.endsWith('node_modules/'+module)))throw Error('Build-only dependency in unpacked runtime: '+relative)
      const actual=fs.realpathSync(file)
      if(!actual.startsWith(base))throw Error('Runtime resource link escapes its root')
      const stat=fs.statSync(file)
      if(stat.isDirectory())walk(file)
      else if(/\.(?:js|mjs|cjs)$/.test(name)){check(fs.readFileSync(file,'utf8'),relative);scriptsScanned++}
    }
  }
  walk(resources)
  const manifest=JSON.parse(asar.extractFile(archive,'package.json'))
  if(manifest.version!==version)throw Error('Runtime inventory version mismatch')
  if(manifest.devDependencies)throw Error('Runtime retained development dependency declarations')
  if(!scriptsScanned)throw Error('No executable runtime scripts inspected')
  return{schemaVersion:1,version,policy:version===VERSION?ADVISORY:'no-build-dependencies',scriptsScanned,forbiddenModulesAbsent:true,asarSha256:digest(fs.readFileSync(archive)),installerSha256:digest(helper)}
}
function validateInventory(inventory,version,installerHash){
  if(!inventory||inventory.schemaVersion!==1||inventory.version!==version||inventory.policy!==(version===VERSION?ADVISORY:'no-build-dependencies')||inventory.forbiddenModulesAbsent!==true||!Number.isSafeInteger(inventory.scriptsScanned)||inventory.scriptsScanned<=0||!/^[a-f0-9]{64}$/.test(inventory.asarSha256||'')||inventory.installerSha256!==installerHash)throw Error('Missing or invalid build-only dependency inventory')
}
async function main(){
  const root=path.resolve(__dirname,'..'),lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'))),pkg=require('../package.json')
  const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['audit','--json'],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024})
  if(result.error||![0,1].includes(result.status))throw Error('npm audit could not complete')
  let audit;try{audit=JSON.parse(result.stdout)}catch{throw Error('npm audit returned invalid JSON')}
  const report=evaluateAudit(audit,lock,pkg.version)
  console.log(JSON.stringify(report,null,2))
  console.log(report.exceptionUsed?'PASS with explicit 0.3.3-only picomatch BUILD exception; runtime inventories remain mandatory':'PASS: no high/critical audit exception required')
}
module.exports={VERSION,ADVISORY,FORBIDDEN,evaluateAudit,checkInputs,scanRuntime,validateInventory}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1})
