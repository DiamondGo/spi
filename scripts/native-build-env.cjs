const os=require('node:os')
// Compiler-level relocation, not binary patching or a privacy-scan exception.
function macBuildEnv(env=process.env,home=os.homedir()){
  if(!home.startsWith('/')||home.length<3||/[\x00-\x1f\x7f]/.test(home))throw Error('Invalid build home')
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
  const maps=['file','debug','macro'].map(kind=>quote('-f'+kind+'-prefix-map='+home+'=/spi-build')).join(' ')
  return {...env,CFLAGS:[env.CFLAGS,maps].filter(Boolean).join(' '),CXXFLAGS:[env.CXXFLAGS,maps].filter(Boolean).join(' ')}
}
module.exports={macBuildEnv}
