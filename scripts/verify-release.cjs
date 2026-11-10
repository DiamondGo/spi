const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const cfg=require('./distribution.cjs').config(), dir=path.resolve(__dirname,'../dist/release')
if(!cfg.repository)throw Error('Configure repository')
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'release-manifest.json')))
const base='https://github.com/'+cfg.repository+'/releases/download/v'+cfg.version
async function checksum(file,max){
  const response=await fetch(base+'/'+file,{signal:AbortSignal.timeout(180000)})
  if(!response.ok)throw Error('Release asset is not publicly downloadable: '+file)
  const hash=crypto.createHash('sha256');let count=0
  for await(const chunk of response.body){count+=chunk.length;if(count>max)throw Error('Release asset too large');hash.update(chunk)}
  return {hash:hash.digest('hex'),size:count}
}
;(async()=>{
  const expected=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'release-manifest.json'))).digest('hex')
  if((await checksum('release-manifest.json',2*1024*1024)).hash!==expected)throw Error('Published manifest mismatch')
  for(const item of Object.values(manifest.targets)){
    const result=await checksum(item.file,item.size)
    if(result.size!==item.size||result.hash!==item.sha256)throw Error('Published runtime mismatch')
  }
  for(const file of ['spi-installer.cjs','install.sh','SHA256SUMS']){
    const bytes=fs.readFileSync(path.join(dir,file)),result=await checksum(file,bytes.length)
    if(result.hash!==crypto.createHash('sha256').update(bytes).digest('hex'))throw Error('Published bootstrap mismatch')
  }
  console.log('Public Release assets match the verified local artifacts')
})().catch(error=>{console.error(error.message);process.exitCode=1})
