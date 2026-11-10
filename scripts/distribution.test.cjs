const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {spawn,execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'), tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-distribution-test-')), release=path.join(root,'dist/release')
const npmCLI=process.env.npm_execpath || fs.realpathSync(execFileSync('which',['npm'],{encoding:'utf8'}).trim())
function run(command,args,env={},cwd=tmp,timeout=180000){return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let text=''
  const timer=setTimeout(()=>{child.kill();reject(new Error('Owned test child timed out'))},timeout)
  for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{text=(text+d).slice(-200000)})
  child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('exit',code=>{clearTimeout(timer);if(code!==0){fs.writeFileSync(path.join(tmp,'failure.log'),text);reject(new Error('Command failed; see isolated failure.log (exit '+code+')'))}else resolve(text)})
})}
let checks=0
async function check(name,fn){await fn();checks++;console.log('PASS',name)}
function digest(file){return fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null}
const actualSettings=path.join(os.homedir(),'.pi/agent/settings.json'), before=digest(actualSettings)
;(async()=>{
  await run(process.execPath,[path.join(__dirname,'distribution.cjs'),'prepare'],{},root)
  const configured=require('./distribution.cjs').config(), generated=JSON.parse(fs.readFileSync(path.join(root,'dist/npm-package/package.json')))
  assert.equal(generated.name,configured.packageName)
  assert.equal(generated.repository.url,'https://github.com/'+configured.repository+'.git')
  assert.equal(fs.readFileSync(path.join(root,'dist/release/install.sh'),'utf8').includes("SPI_DEFAULT_REPOSITORY='"+configured.repository+"'"),true)
  const pack=JSON.parse(await run(process.execPath,[npmCLI,'pack','--ignore-scripts','--json','--pack-destination',tmp],{},path.join(root,'dist/npm-package')))[0]
  await check('npm tarball is light, explicit and contains no runtime, config or development files',()=>{
    assert.ok(pack.size<1024*1024)
    for(const f of pack.files)assert.ok(/^(bin\/spi.cjs|dist\/spi.cjs|extensions\/launcher.ts|package.json|README.md|CHANGELOG.md|INSTALLER-NOTICES.txt)$/.test(f.path),f.path)
    assert.equal(pack.files.some(f=>f.path.endsWith('.node')),false)
    require('./privacy.cjs').scanTree(path.join(root,'dist/npm-package'))
  })
  await check('Git ignore keeps secrets/local files out but example files remain trackable',()=>{
    const ignored=['.env','.env.production','.npmrc','release.config.local.json','.pi/settings.json','dist/native.node','plan.md']
    for(const file of ignored)execFileSync('git',['check-ignore','--no-index',file],{cwd:root,stdio:'ignore'})
    for(const file of ['.env.example','.npmrc.example','release.config.example.json'])assert.throws(()=>execFileSync('git',['check-ignore','--no-index',file],{cwd:root,stdio:'ignore'}))
    const privacy=require('./privacy.cjs');assert.throws(()=>privacy.scanBuffer(Buffer.from('ghp_'+'x'.repeat(36)),'synthetic'))
    assert.throws(()=>privacy.scanBuffer(Buffer.from(os.homedir()+'/private'),'synthetic'))
  })
  if(process.platform!=='linux'||!fs.existsSync(path.join(release,'release-manifest.json'))){console.log('SKIP real Pi/install bootstrap: Linux prebuilt release required');console.log('RESULT PASS',checks,tmp);return}
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'dist/npm-package/package.json'))), tarball=path.join(tmp,pack.filename)
  const home=path.join(tmp,'home'), agent=path.join(tmp,'agent'), bin=path.join(tmp,'user-bin'), install=path.join(tmp,'installed desktop')
  for(const dir of [home,agent,bin])fs.mkdirSync(dir,{recursive:true})
  const pi=process.env.SPI_TEST_PI_PATH || execFileSync('which',['pi'],{encoding:'utf8'}).trim()
  fs.symlinkSync(pi,path.join(bin,'pi'))
  const archiveFiles=new Set(fs.readdirSync(release)), requests=[]
  const server=http.createServer((req,res)=>{
    const name=decodeURIComponent(req.url.split('?')[0]);requests.push(name)
    if(name==='/'+pkg.name){
      const bytes=fs.readFileSync(tarball), origin='http://127.0.0.1:'+server.address().port
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({name:pkg.name,'dist-tags':{latest:pkg.version},versions:{[pkg.version]:{...pkg,dist:{tarball:origin+'/package.tgz',shasum:crypto.createHash('sha1').update(bytes).digest('hex'),integrity:'sha512-'+crypto.createHash('sha512').update(bytes).digest('base64')}}}}));return
    }
    let file
    if(name==='/package.tgz')file=tarball
    else if(name.startsWith('/releases/v'+pkg.version+'/')){const basename=name.slice(('/releases/v'+pkg.version+'/').length);if(archiveFiles.has(basename))file=path.join(release,basename)}
    if(!file){res.writeHead(404);res.end();return}
    res.setHeader('Content-Length',fs.statSync(file).size);fs.createReadStream(file).pipe(res)
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const origin='http://127.0.0.1:'+server.address().port, emptyNpmrc=path.join(tmp,'empty-npmrc');fs.writeFileSync(emptyNpmrc,'')
  const env={HOME:home,PI_CODING_AGENT_DIR:agent,PATH:bin+path.delimiter+process.env.PATH,CI:'',SPI_INSTALL_ROOT:install,SPI_ALLOW_TEST_HTTP:'1',SPI_RELEASE_BASE_URL:origin+'/releases',NPM_CONFIG_REGISTRY:origin,NPM_CONFIG_USERCONFIG:emptyNpmrc,NPM_CONFIG_CACHE:path.join(tmp,'npm-cache'),npm_config_ignore_scripts:'false',NPM_CONFIG_IGNORE_SCRIPTS:'false'}
  try{
    await check('real personal pi install downloads a verified runtime and registers spi beside pi',async()=>{
      const text=await run(path.join(bin,'pi'),['install','npm:'+pkg.name],env)
      fs.writeFileSync(path.join(tmp,'pi-install.log'),text)
      assert.ok(fs.existsSync(path.join(bin,'spi')),'postinstall did not register user command')
      assert.equal((await run(path.join(bin,'spi'),['--version'],env)).trim(),pkg.version)
      assert.ok(requests.some(n=>n.endsWith('.tar.gz')))
      assert.ok(JSON.parse(fs.readFileSync(path.join(agent,'settings.json'))).packages.includes('npm:'+pkg.name))
    })
    await check('installed Electron-backed CLI can reinstall and its extracted GUI/native PTY really run',async()=>{
      await run(path.join(bin,'spi'),['install','--version',pkg.version],env)
      const current=JSON.parse(fs.readFileSync(path.join(install,'current.json')))
      await run(process.execPath,[path.join(__dirname,'portable-smoke.cjs'),path.join(install,current.directory,current.entry)],env)
    })
    await check('Pi loads manual commands without automatically launching another GUI',async()=>{
      await new Promise((resolve,reject)=>{
        const child=spawn(path.join(bin,'pi'),['--mode','rpc'],{env:{...process.env,...env},cwd:tmp,stdio:['pipe','pipe','pipe']});let buffer='',errors='',found=false
        const timer=setTimeout(()=>{child.kill();reject(Error('Isolated RPC commands timed out'))},30000)
        child.stderr.on('data',d=>{errors=(errors+d).slice(-10000)})
        child.stdout.on('data',d=>{buffer+=d;for(const line of buffer.split('\n').slice(0,-1))try{const e=JSON.parse(line);if(e.type==='response'&&e.id==='commands'){
          found=true;assert.equal(e.success,true);assert.ok(e.data.commands.some(c=>c.name==='spi'));assert.ok(e.data.commands.some(c=>c.name==='spi-install'));child.stdin.end()
        }}catch(e){child.kill();clearTimeout(timer);reject(e)}buffer=buffer.slice(buffer.lastIndexOf('\n')+1)})
        child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);if(code===0&&found)resolve();else{fs.writeFileSync(path.join(tmp,'rpc-errors.log'),errors);reject(Error('Isolated Pi extension load failed'))}})
        child.stdin.write(JSON.stringify({id:'commands',type:'get_commands'})+'\n')
      })
    })
    await check('pi remove does not break the independently installed spi command',async()=>{
      await run(path.join(bin,'pi'),['remove','npm:'+pkg.name],env)
      assert.equal((await run(path.join(bin,'spi'),['--version'],env)).trim(),pkg.version)
    })
    await check('project-local Pi install does not create a global command or desktop runtime',async()=>{
      const project=path.join(tmp,'project');fs.mkdirSync(project)
      const skipped=path.join(tmp,'must-not-install')
      await run(path.join(bin,'pi'),['install','npm:'+pkg.name,'--local','--approve'],{...env,SPI_INSTALL_ROOT:skipped},project)
      assert.equal(fs.existsSync(skipped),false)
    })
    await check('disabled lifecycle scripts support explicit manual installation',async()=>{
      const manual=path.join(tmp,'manual-install'), manualBin=path.join(tmp,'manual-bin')
      const e={...env,SPI_INSTALL_ROOT:manual,NPM_CONFIG_IGNORE_SCRIPTS:'true',npm_config_ignore_scripts:'true'}
      await run(path.join(bin,'pi'),['install','npm:'+pkg.name],e)
      assert.equal(fs.existsSync(manual),false)
      await run(process.execPath,[path.join(agent,'npm/node_modules',pkg.name,'bin/spi.cjs'),'install','--bin-dir',manualBin],e)
      assert.equal((await run(path.join(manualBin,'spi'),['--version'],e)).trim(),pkg.version)
      // npm exec/npx must not auto-install a second Pi just to satisfy the host API peer.
      await run(process.execPath,[npmCLI,'exec','--yes','--package',pkg.name,'--','spi','install','--bin-dir',manualBin],e)
    })
    await check('standalone install.sh fetches/verifies its installer and runtime from Release assets',async()=>{
      const script=path.join(tmp,'install.sh');fs.copyFileSync(path.join(release,'install.sh'),script)
      const shellRoot=path.join(tmp,'shell-install'), shellBin=path.join(tmp,'shell-bin')
      await run('bash',[script,'--version',pkg.version,'--install-dir',shellRoot,'--bin-dir',shellBin],env)
      assert.equal((await run(path.join(shellBin,'spi'),['--version'],env)).trim(),pkg.version)
      assert.equal(fs.existsSync(path.join(home,'.bashrc')),false)
    })
    assert.equal(digest(actualSettings),before,'Real Pi settings changed')
    console.log('RESULT PASS',checks,'checks',tmp)
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1})
