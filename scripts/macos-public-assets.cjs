// Promote verified native Mac ZIPs as additive manual downloads; never rewrite installer manifests/assets.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process')
const targets=['darwin-arm64','darwin-x64']
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function prepare(source,out,version,sourceCommit){
  assert.match(version,/^\d+\.\d+\.\d+$/);assert.match(sourceCommit,/^[a-f0-9]{40}$/)
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'release-manifest.json')))
  assert.equal(manifest.schemaVersion,1);assert.equal(manifest.version,version);assert.deepEqual(Object.keys(manifest.targets).sort(),[...targets].sort())
  const selected=[]
  for(const target of targets){
    const item=manifest.targets[target],file=`spi-${version}-${target}.zip`,reportName=`macos-build-${target}.txt`
    assert.equal(item.file,file);assert.equal(item.entry,'app/sPi.app/Contents/MacOS/sPi')
    assert.equal(item.permissionExtension,'app/sPi.app/Contents/Resources/spi-permission-extension.mjs')
    assert.equal(fs.lstatSync(path.join(source,file)).isFile(),true);assert.equal(fs.statSync(path.join(source,file)).size,item.size);assert.equal(hash(path.join(source,file)),item.sha256)
    const report=JSON.parse(fs.readFileSync(path.join(source,reportName)))
    assert.equal(report.version,version);assert.equal(report.target,target);assert.equal(report.sourceCommit,sourceCommit)
    assert.equal(report.signature,'ad-hoc');assert.equal(report.notarized,false);assert.equal(typeof report.minimumOS,'string')
    selected.push(file,reportName)
  }
  if(fs.existsSync(out))assert.equal(fs.readdirSync(out).length,0,'Output must be an empty staging directory')
  fs.mkdirSync(out,{recursive:true})
  for(const name of selected)fs.copyFileSync(path.join(source,name),path.join(out,name))
  fs.copyFileSync(path.join(source,'release-manifest.json'),path.join(out,'release-manifest-macos.json'))
  selected.push('release-manifest-macos.json');selected.sort()
  fs.writeFileSync(path.join(out,'SHA256SUMS-macos.txt'),selected.map(name=>hash(path.join(out,name))+'  '+name).join('\n')+'\n')
  selected.push('SHA256SUMS-macos.txt')
  const result={version,sourceCommit,signature:'ad-hoc',notarized:false,files:selected.map(name=>({name,size:fs.statSync(path.join(out,name)).size,sha256:hash(path.join(out,name))}))}
  fs.writeFileSync(path.join(out,'publication-review.json'),JSON.stringify(result,null,2)+'\n')
  return result
}
async function publicHash(repository,tag,item){
  const response=await fetch(`https://github.com/${repository}/releases/download/${tag}/${item.name}`,{signal:AbortSignal.timeout(180000)})
  assert.equal(response.ok,true,'Public Mac asset unavailable: '+item.name)
  const digest=crypto.createHash('sha256');let bytes=0
  for await(const chunk of response.body){bytes+=chunk.length;assert.ok(bytes<=item.size,'Oversized public asset');digest.update(chunk)}
  assert.equal(bytes,item.size);assert.equal(digest.digest('hex'),item.sha256,'Public Mac asset hash mismatch')
}
async function publish(repository,tag,out){
  assert.match(repository,/^[\w.-]+\/[\w.-]+$/);assert.match(tag,/^v\d+\.\d+\.\d+$/)
  const review=JSON.parse(fs.readFileSync(path.join(out,'publication-review.json')));assert.equal(tag,'v'+review.version)
  const expected=targets.flatMap(target=>[`spi-${review.version}-${target}.zip`,`macos-build-${target}.txt`]).concat(['release-manifest-macos.json','SHA256SUMS-macos.txt'])
  assert.deepEqual(review.files.map(item=>item.name).sort(),expected.sort());assert.match(review.sourceCommit,/^[a-f0-9]{40}$/)
  assert.equal(review.signature,'ad-hoc');assert.equal(review.notarized,false)
  const gh=args=>execFileSync('gh',args,{encoding:'utf8'})
  const before=JSON.parse(gh(['api',`repos/${repository}/releases/tags/${tag}`]))
  assert.equal(before.draft,false);assert.equal(before.prerelease,false)
  const existing=new Map(before.assets.map(item=>[item.name,item]))
  for(const item of review.files){
    assert.ok(/^(?:spi-\d+\.\d+\.\d+-darwin-(?:arm64|x64)\.zip|macos-build-darwin-(?:arm64|x64)\.txt|release-manifest-macos\.json|SHA256SUMS-macos\.txt)$/.test(item.name))
    assert.equal(fs.statSync(path.join(out,item.name)).size,item.size);assert.equal(hash(path.join(out,item.name)),item.sha256)
    if(existing.has(item.name))await publicHash(repository,tag,item) // Resume a partial publication only if bytes match; never clobber.
    else execFileSync('gh',['release','upload',tag,path.join(out,item.name),'--repo',repository],{stdio:'inherit'})
  }
  const after=JSON.parse(gh(['api',`repos/${repository}/releases/tags/${tag}`]))
  for(const original of before.assets){
    const current=after.assets.find(item=>item.id===original.id)
    assert.ok(current,'An existing release asset was removed')
    for(const key of ['name','size','digest'])assert.equal(current[key],original[key],'Existing release asset changed')
  }
  for(const item of review.files)await publicHash(repository,tag,item)
  console.log('PASS public Mac ZIPs/reports/independent manifest/checksums; all pre-existing assets unchanged')
}
module.exports={prepare,publish}
if(require.main===module){(async()=>{
  const [command,...args]=process.argv.slice(2)
  if(command==='prepare')console.log(JSON.stringify(prepare(...args),null,2))
  else if(command==='publish')await publish(...args)
  else throw Error('Usage: prepare SOURCE OUT VERSION SOURCE_SHA | publish REPOSITORY TAG OUT')
})().catch(error=>{console.error(error.message);process.exitCode=1})}
