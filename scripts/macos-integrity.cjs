const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),asar=require('@electron/asar'),{execFileSync}=require('node:child_process')
function headerHash(resources){return crypto.createHash('sha256').update(asar.getRawHeader(path.join(resources,'app.asar')).headerString).digest('hex')}
function refreshMacIntegrity(resources,run=execFileSync){
  const plist=path.join(resources,'../Info.plist')
  const info=JSON.parse(run('/usr/bin/plutil',['-convert','json','-o','-',plist],{encoding:'utf8'}))
  if(!info.ElectronAsarIntegrity?.['Resources/app.asar'])throw Error('Missing macOS ASAR integrity metadata')
  info.ElectronAsarIntegrity['Resources/app.asar']={algorithm:'SHA256',hash:headerHash(resources)}
  // afterPack follows builder's initial hash calculation. Refresh, never disable,
  // the metadata after sanitizing ASAR and before the bundle is code-signed.
  run('/usr/bin/plutil',['-replace','ElectronAsarIntegrity','-json',JSON.stringify(info.ElectronAsarIntegrity),plist],{stdio:['ignore','pipe','pipe']})
}
module.exports={headerHash,refreshMacIntegrity}
