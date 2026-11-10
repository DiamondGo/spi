const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process')
const asar=require('@electron/asar')
// Reports only file names and categories, never matching secret values.
const patterns=[
  ['credential',/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|npm_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{25,})/],
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['credential-assignment',/(?:api[_-]?key|password|token)\s*[:=]\s*["'][A-Za-z0-9_-]{24,}["']/i],
  ['private-network',/https?:\/\/(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)/]
]
function scanBuffer(buffer,label,binary=false){
  const home=os.homedir(), text=buffer.toString('utf8')
  const homes=[home+'/',home+'\\',home.replaceAll('\\','/')+'/',home.replaceAll('\\','\\\\')+'\\\\']
  if(home.length>5&&homes.some(h=>text.includes(h)))throw Error('Privacy check: local-home-path in '+label)
  if(!binary)for(const [category,pattern]of patterns)if(pattern.test(text))throw Error('Privacy check: '+category+' in '+label)
}
function scanTree(dir,{binary=false}={}){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,e.name)
    if(e.isSymbolicLink())continue
    if(e.isDirectory()){scanTree(file,{binary});continue}
    if(e.name==='app.asar'){
      const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-privacy-asar-'))
      try{asar.extractAll(file,tmp);scanTree(tmp,{binary:true})}finally{fs.rmSync(tmp,{recursive:true,force:true})}
    }else scanBuffer(fs.readFileSync(file),path.relative(dir,file),binary&&!/\.(?:[cm]?js|json|html|css|txt|md|map)$/.test(e.name))
  }
}
function repo(){
  const root=path.resolve(__dirname,'..'), files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean)
  for(const name of files)if(fs.statSync(path.join(root,name)).isFile())scanBuffer(fs.readFileSync(path.join(root,name)),name)
  console.log('Privacy check passed for '+files.length+' Git candidate files')
}
module.exports={scanTree,scanBuffer,repo}
if(require.main===module)try{if(process.argv[2])scanTree(path.resolve(process.argv[2]),{binary:true});else repo()}catch(e){console.error(e.message);process.exitCode=1}
