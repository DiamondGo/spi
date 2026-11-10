const path=require('node:path'),{execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'), target=process.platform+'-'+process.arch
if(!['linux-x64','linux-arm64','win32-x64','darwin-arm64'].includes(target))throw Error('Unsupported native build target: '+target)
function node(file,args=[]){execFileSync(process.execPath,[path.join(root,file),...args],{cwd:root,stdio:'inherit'})}
node('scripts/distribution.cjs',['prepare',...process.argv.slice(2)])
node('node_modules/electron-vite/bin/electron-vite.js',['build'])
node('node_modules/electron-builder/cli.js',['--dir','--'+(process.platform==='win32'?'win':process.platform==='darwin'?'mac':'linux'),'--'+process.arch])
const folder=process.platform==='darwin'?'mac-arm64':process.platform==='win32'?'win-unpacked':process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked'
node('scripts/distribution.cjs',['archive','--from',path.join(root,'dist',folder),'--target',target])
node('scripts/distribution.cjs',['manifest'])
