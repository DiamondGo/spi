'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto')
const {spawn}=require('node:child_process')
const {download,archiveTimeout,DEFAULTS}=require('../packages/pi-spi/lib/download.cjs')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spi-download-test-')),routes=new Map(),payload=Buffer.from('0123456789'),sha=crypto.createHash('sha256').update(payload).digest('hex')
const policy={totalMs:3000,idleMs:500,attempts:3,delayMs:1,progressMs:20}
let count=0,seq=0
async function check(name,fn){await fn();console.log('PASS',name);count++}
const server=http.createServer((req,res)=>{const route=routes.get(req.url);if(route)route(req,res);else{res.writeHead(404);res.end()}})
const file=()=>path.join(tmp,'download-'+(++seq))
function drip(res,data,period){let n=0;const timer=setInterval(()=>{if(n===data.length){clearInterval(timer);res.end();return}res.write(data.subarray(n,n+1));n++},period);res.once('close',()=>clearInterval(timer))}
;(async()=>{
  process.env.SPI_ALLOW_TEST_HTTP='1'
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const base='http://127.0.0.1:'+server.address().port
  await check('archives allow an hour of active downloading, with a separate 60-second inactivity bound',()=>{
    assert.equal(DEFAULTS.totalMs,3600000);assert.equal(DEFAULTS.idleMs,60000)
    const saved=process.env.SPI_DOWNLOAD_TIMEOUT_SECONDS
    try{delete process.env.SPI_DOWNLOAD_TIMEOUT_SECONDS;assert.equal(archiveTimeout(),3600000);process.env.SPI_DOWNLOAD_TIMEOUT_SECONDS='1800';assert.equal(archiveTimeout(),1800000);for(const value of ['0','-1','Infinity','21601','1.5','bad']){process.env.SPI_DOWNLOAD_TIMEOUT_SECONDS=value;assert.throws(archiveTimeout)}}finally{if(saved===undefined)delete process.env.SPI_DOWNLOAD_TIMEOUT_SECONDS;else process.env.SPI_DOWNLOAD_TIMEOUT_SECONDS=saved}
  })
  await check('slow but healthy transfers survive a scaled former total timeout and report increasing percentage through 100%',async()=>{
    routes.set('/slow',(req,res)=>{assert.equal(req.headers['accept-encoding'],'identity');res.setHeader('Content-Length',payload.length);drip(res,payload,40)})
    const dest=file(),messages=[],start=Date.now()
    await download(base+'/slow',dest,10,{resume:true,sha256:sha,report:m=>messages.push(m),policy:{...policy,totalMs:1500,idleMs:250}})
    assert.ok(Date.now()-start>=350);assert.deepEqual(fs.readFileSync(dest),payload)
    const percentages=messages.flatMap(m=>{const a=/\((\d+)%\)/.exec(m);return a?[+a[1]]:[]})
    assert.ok(percentages.some(n=>n>0&&n<100));assert.equal(percentages.at(-1),100)
    for(let n=1;n<percentages.length;n++)assert.ok(percentages[n]>=percentages[n-1])
  })
  await check('dropped connections resume from received bytes with Range and If-Range; full SHA-256 still matches',async()=>{
    let calls=0;const ranges=[]
    routes.set('/resume',(req,res)=>{ranges.push(req.headers.range);res.setHeader('ETag','"stable"');if(++calls===1){res.setHeader('Content-Length',10);res.write(payload.subarray(0,4));setTimeout(()=>res.destroy(),40)}else{assert.equal(req.headers['if-range'],'"stable"');res.writeHead(206,{'Content-Range':'bytes 4-9/10','Content-Length':6});res.end(payload.subarray(4))}})
    const dest=file(),messages=[];await download(base+'/resume',dest,10,{resume:true,sha256:sha,policy,report:m=>messages.push(m)})
    assert.deepEqual(ranges,[undefined,'bytes=4-']);assert.deepEqual(fs.readFileSync(dest),payload);assert.ok(messages.some(m=>m.includes('retrying from')))
  })
  await check('a server ignoring Range restarts from zero rather than appending duplicate bytes',async()=>{
    let calls=0;routes.set('/ignore',(req,res)=>{res.setHeader('Content-Length',10);if(++calls===1){res.write(payload.subarray(0,4));setTimeout(()=>res.destroy(),30)}else{assert.equal(req.headers.range,'bytes=4-');res.end(payload)}})
    const dest=file();await download(base+'/ignore',dest,10,{resume:true,sha256:sha,policy});assert.deepEqual(fs.readFileSync(dest),payload)
  })
  await check('a stalled body is retried only a bounded number of times and partial files are removed',async()=>{
    let calls=0;routes.set('/stall',(req,res)=>{calls++;res.setHeader('Content-Length',10);res.write(payload.subarray(0,1))})
    const dest=file();await assert.rejects(download(base+'/stall',dest,10,{resume:true,policy:{...policy,idleMs:60,attempts:2}}),/stalled/);assert.equal(calls,2);assert.equal(fs.existsSync(dest),false)
  })
  await check('headers with no response also hit the inactivity bound',async()=>{
    routes.set('/no-headers',()=>{});const dest=file();await assert.rejects(download(base+'/no-headers',dest,10,{policy:{...policy,idleMs:60,attempts:1}}),/stalled/);assert.equal(fs.existsSync(dest),false)
  })
  await check('one total deadline covers all active bytes and retries, not one deadline per attempt',async()=>{
    routes.set('/total',(req,res)=>{res.setHeader('Content-Length',10);drip(res,payload,50)})
    const dest=file();await assert.rejects(download(base+'/total',dest,10,{resume:true,policy:{...policy,totalMs:170,idleMs:100}}),/total time limit/);assert.equal(fs.existsSync(dest),false)
  })
  await check('invalid range offsets, total lengths and changed validators fail closed',async()=>{
    for(const [range,etag] of [['bytes 3-9/10','"stable"'],['bytes 4-9/11','"stable"'],['bytes 4-9/10','"changed"']]){
      let calls=0;routes.set('/bad-range',(req,res)=>{res.setHeader('ETag',calls?'"unused"':'"stable"');if(++calls===1){res.setHeader('Content-Length',10);res.write(payload.subarray(0,4));setTimeout(()=>res.destroy(),30)}else{res.writeHead(206,{'Content-Range':range,ETag:etag,'Content-Length':6});res.end(payload.subarray(4))}})
      const dest=file();await assert.rejects(download(base+'/bad-range',dest,10,{resume:true,sha256:sha,policy}),/range|validator/);assert.equal(fs.existsSync(dest),false)
    }
  })
  await check('oversized declared/chunked bodies and checksum changes cannot be installed',async()=>{
    routes.set('/too-large',(req,res)=>{res.setHeader('Content-Length',11);res.end(Buffer.alloc(11))})
    routes.set('/chunked',(req,res)=>{res.write(payload);res.end('extra')})
    routes.set('/checksum',(req,res)=>res.end(Buffer.alloc(10)))
    for(const [name,re] of [['too-large',/size limit/],['chunked',/size limit/],['checksum',/checksum/]]){const dest=file(),messages=[];await assert.rejects(download(base+'/'+name,dest,10,{resume:true,sha256:sha,policy,report:m=>messages.push(m)}),re);assert.equal(fs.existsSync(dest),false);assert.ok(!messages.some(m=>m.includes('(100%)')))}
  })
  await check('404s do not retry and short successful bodies are retried without accepting truncation',async()=>{
    let missing=0,short=0;routes.set('/missing',(req,res)=>{missing++;res.writeHead(404);res.end()});routes.set('/short',(req,res)=>{short++;res.end('123')})
    await assert.rejects(download(base+'/missing',file(),10,{resume:true,policy}),/HTTP 404/);assert.equal(missing,1)
    await assert.rejects(download(base+'/short',file(),10,{resume:true,policy}),/expected size|range/);assert.equal(short,3)
  })
  await check('redirects retain the HTTPS/host allowlist, reject credentials and have a strict hop limit',async()=>{
    routes.set('/escape',(req,res)=>{res.writeHead(302,{Location:'http://example.com/private?token=never-log'});res.end()})
    routes.set('/loop',(req,res)=>{res.writeHead(302,{Location:'/loop'});res.end()})
    await assert.rejects(download(base+'/escape',file(),10,{policy}),/GitHub HTTPS/)
    await assert.rejects(download(base+'/loop',file(),10,{policy}),/Too many/)
    await assert.rejects(download(base.replace('://','://user:secret@')+'/x',file(),10,{policy}),/credentials/)
  })
  await check('exclusive files are not overwritten; metadata keeps its smaller size/deadline policy',async()=>{
    const dest=file();fs.writeFileSync(dest,'KEEP');await assert.rejects(download(base+'/slow',dest,10,{policy}),/EEXIST/);assert.equal(fs.readFileSync(dest,'utf8'),'KEEP')
    assert.equal(DEFAULTS.metadataMs,180000)
  })
  await check('npm-buffered postinstall progress is visible on its own private PTY without exposing buffered stderr',async()=>{
    if(process.platform!=='linux')return
    const probe=path.join(tmp,'probe'),prefix=path.join(tmp,'npm-root'),home=path.join(tmp,'home');fs.mkdirSync(probe);fs.mkdirSync(home)
    const modulePath=path.resolve(__dirname,'../packages/pi-spi/lib/download.cjs')
    fs.writeFileSync(path.join(probe,'package.json'),JSON.stringify({name:'spi-private-progress-probe',version:'1.0.0',scripts:{postinstall:'node probe.cjs'}}))
    fs.writeFileSync(path.join(probe,'probe.cjs'),`const {progressReporter}=require(${JSON.stringify(modulePath)});const r=progressReporter();r.write('Downloading runtime: 50% TTY_PROGRESS_VISIBLE');r.close();console.error('BUFFERED_STDERR_MUST_STAY_HIDDEN')`)
    fs.writeFileSync(path.join(home,'empty.npmrc'),'');fs.writeFileSync(path.join(home,'global.npmrc'),'')
    const quote=s=>"'"+s.replaceAll("'","'\\''")+"'",npm=process.env.npm_execpath
    const command=(npm?quote(process.execPath)+' '+quote(npm):'npm')+' install --offline --foreground-scripts=false --ignore-scripts=false --no-audit --no-fund --package-lock=false --install-links=true --prefix '+quote(prefix)+' '+quote(probe)
    const env={PATH:process.env.PATH,HOME:home,TERM:'xterm',NPM_CONFIG_USERCONFIG:path.join(home,'empty.npmrc'),NPM_CONFIG_GLOBALCONFIG:path.join(home,'global.npmrc'),NPM_CONFIG_CACHE:path.join(home,'cache')}
    const output=await new Promise((resolve,reject)=>{const p=spawn('script',['-q','-e','-c',command,'/dev/null'],{env,stdio:['ignore','pipe','pipe']});let text='';const timer=setTimeout(()=>{p.kill('SIGKILL');reject(Error('Private PTY test timed out'))},30000);p.stdout.on('data',b=>text+=b);p.stderr.on('data',b=>text+=b);p.on('error',reject);p.on('exit',code=>{clearTimeout(timer);code===0?resolve(text):reject(Error(text))})})
    assert.ok(output.includes('50% TTY_PROGRESS_VISIBLE'));assert.ok(!output.includes('BUFFERED_STDERR_MUST_STAY_HIDDEN'))
  })
  console.log('RESULT PASS',count,'download/progress checks')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{server.closeAllConnections();server.close()})
