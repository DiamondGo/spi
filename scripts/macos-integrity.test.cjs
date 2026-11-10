const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),asar=require('@electron/asar')
const {headerHash,refreshMacIntegrity}=require('./macos-integrity.cjs')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-mac-integrity-'))
;(async()=>{try{
  const source=path.join(tmp,'source'),resources=path.join(tmp,'Contents/Resources');fs.mkdirSync(source);fs.mkdirSync(resources,{recursive:true})
  fs.writeFileSync(path.join(source,'package.json'),'{"name":"fixture"}');await asar.createPackage(source,path.join(resources,'app.asar'));const first=headerHash(resources)
  const original={ElectronAsarIntegrity:{'Resources/app.asar':{algorithm:'SHA256',hash:'stale'},'Resources/other.asar':{algorithm:'SHA256',hash:'preserve'}}}
  const calls=[];refreshMacIntegrity(resources,(cmd,args)=>{calls.push([cmd,args]);return JSON.stringify(original)})
  assert.equal(calls.length,2);assert.equal(calls[1][0],'/usr/bin/plutil');assert.equal(calls[1][1][0],'-replace')
  const replaced=JSON.parse(calls[1][1][3]);assert.deepEqual(replaced['Resources/app.asar'],{algorithm:'SHA256',hash:first});assert.deepEqual(replaced['Resources/other.asar'],original.ElectronAsarIntegrity['Resources/other.asar'])
  fs.writeFileSync(path.join(source,'new.json'),'{"changed":true}');fs.rmSync(path.join(resources,'app.asar'));await asar.createPackage(source,path.join(resources,'app.asar'));assert.notEqual(headerHash(resources),first)
  assert.throws(()=>refreshMacIntegrity(resources,()=>JSON.stringify({})),/Missing macOS ASAR integrity/)
  if(process.platform!=='win32'){
    fs.writeFileSync(path.join(source,'spawn-helper'),'fixture',{mode:0o755});const unpacked=path.join(tmp,'modes.asar'),extracted=path.join(tmp,'modes-extracted')
    await asar.createPackageWithOptions(source,unpacked,{unpack:'spawn-helper'});asar.extractAll(unpacked,extracted)
    require('./distribution.cjs').restoreUnpackedModes(unpacked+'.unpacked',extracted)
    assert.equal(fs.statSync(path.join(extracted,'spawn-helper')).mode&0o777,0o755)
    assert.equal(fs.statSync(path.join(extracted,'package.json')).mode&0o111,0)
    console.log('PASS ASAR unpack/repack preserves helper execution permission without granting it to data files')
  }
  console.log('PASS macOS post-sanitize ASAR hash refresh, unrelated entries preserved, stale/missing metadata detected')
}finally{fs.rmSync(tmp,{recursive:true,force:true})}})().catch(error=>{console.error(error.message);process.exitCode=1})
