// Native CI: verify the archive after extraction, not merely the unarchived build directory.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-native-install-'))
const manifest=path.join(root,'dist/release/release-manifest.json'),data=JSON.parse(fs.readFileSync(manifest)),target=process.platform+'-'+process.arch
const item=data.targets[target]
if(!item)throw Error('Native target missing from manifest')
const api=require('../dist/npm-package/dist/spi.cjs')
;(async()=>{
  const installed=await api.install({version:data.version,manifest,archive:path.join(root,'dist/release',item.file),installDir:path.join(tmp,'runtime'),binDir:path.join(tmp,'bin')})
  execFileSync(process.execPath,[path.join(__dirname,'portable-smoke.cjs'),installed.entryPath],{stdio:'inherit',timeout:120000})
  console.log('PASS extracted native archive',target)
})().catch(error=>{console.error(error.message);process.exitCode=1})
