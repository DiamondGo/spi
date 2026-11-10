const path=require('node:path')
module.exports=async context=>{
  const resources=context.electronPlatformName==='darwin'?path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app','Contents','Resources'):path.join(context.appOutDir,'resources')
  await require('./distribution.cjs').sanitizeRuntime(resources)
}
