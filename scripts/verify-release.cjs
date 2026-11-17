// Anonymous post-publication verification of the canonical GitHub Release.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {RELEASE_TARGETS,config}=require('./distribution.cjs')
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
// Every file listed in SHA256SUMS plus SHA256SUMS itself must be a public asset, and the
// manifest must describe exactly the four supported native targets (never Windows).
function plan(dir,expectedTargets=RELEASE_TARGETS){
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'release-manifest.json'),'utf8'))
  if(JSON.stringify(Object.keys(manifest.targets).sort())!==JSON.stringify([...expectedTargets].sort()))throw Error('Release manifest must list exactly: '+expectedTargets.join(', '))
  const sums=new Map()
  for(const line of fs.readFileSync(path.join(dir,'SHA256SUMS'),'utf8').trim().split('\n')){
    const match=/^([a-f0-9]{64})  ([\w.-]+)$/.exec(line);if(!match||sums.has(match[2]))throw Error('Malformed SHA256SUMS')
    sums.set(match[2],match[1])
  }
  const assets=[]
  for(const [target,item] of Object.entries(manifest.targets)){
    if(sums.get(item.file)!==item.sha256)throw Error('SHA256SUMS does not match manifest for '+target)
    if(target.startsWith('darwin')&&!sums.has('macos-build-'+target+'.txt'))throw Error('Missing native Mac report for '+target)
    assets.push({name:item.file,size:item.size,sha256:item.sha256})
  }
  for(const required of ['release-manifest.json','spi-installer.cjs','install.sh','INSTALLER-NOTICES.txt'])if(!sums.has(required))throw Error('SHA256SUMS omits '+required)
  for(const [name,hash] of sums){
    if(assets.some(a=>a.name===name))continue
    const bytes=fs.readFileSync(path.join(dir,name));if(sha256(bytes)!==hash)throw Error('Local artifact does not match SHA256SUMS: '+name)
    assets.push({name,size:bytes.length,sha256:hash})
  }
  const sumsBytes=fs.readFileSync(path.join(dir,'SHA256SUMS'))
  assets.push({name:'SHA256SUMS',size:sumsBytes.length,sha256:sha256(sumsBytes)})
  return assets
}
async function download(base,asset,fetchImpl=fetch){
  const response=await fetchImpl(base+'/'+asset.name,{signal:AbortSignal.timeout(180000)})
  if(!response.ok)throw Error('Release asset is not publicly downloadable: '+asset.name)
  const hash=crypto.createHash('sha256');let count=0
  for await(const chunk of response.body){count+=chunk.length;if(count>asset.size)throw Error('Release asset too large: '+asset.name);hash.update(chunk)}
  if(count!==asset.size||hash.digest('hex')!==asset.sha256)throw Error('Published asset mismatch: '+asset.name)
}
async function verify(dir,repository,version,fetchImpl=fetch){
  const assets=plan(dir),base='https://github.com/'+repository+'/releases/download/v'+version
  for(const asset of assets)await download(base,asset,fetchImpl)
  return assets
}
module.exports={plan,verify}
if(require.main===module)(async()=>{
  const cfg=config();if(!cfg.repository)throw Error('Configure repository')
  const assets=await verify(path.resolve(__dirname,'../dist/release'),cfg.repository,cfg.version)
  console.log('Public Release assets match the verified local artifacts for '+RELEASE_TARGETS.join(', ')+' ('+assets.length+' files)')
})().catch(error=>{console.error(error.message);process.exitCode=1})
