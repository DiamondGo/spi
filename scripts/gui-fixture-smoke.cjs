// Isolated real Pi + deterministic loopback model, shared by GUI regression suites.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto')
module.exports=async function(context){
  const {launch,stop,workspace,profile,artifacts}=context,sh=s=>"'"+s.replaceAll("'","'\\''")+"'"
  const legacy=path.join(profile,'spi-permissions.json');fs.writeFileSync(legacy,'{intentionally invalid legacy configuration')
  const configFiles=[path.join(os.homedir(),'.pi/agent/settings.json'),path.join(workspace,'.pi/settings.json'),legacy]
  const hashes=()=>configFiles.map(f=>[f,fs.existsSync(f)?createHash('sha256').update(fs.readFileSync(f)).digest('hex'):null]),before=hashes(),errors=[]
  const namingRequests=[]
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk
    const body=JSON.parse(raw)
    if(req.url?.endsWith('/responses')){
      namingRequests.push({model:body.model,reasoning:body.reasoning?.effort,maxTokens:body.max_output_tokens,tools:body.tools?.length||0})
      if(!raw.includes('SPI_SESSION_TITLE')||body.model==='fixture-reasoning-reject'||body.reasoning?.effort!=='low'||body.max_output_tokens<2048){
        res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Unsupported reasoning title request PRIVATE_PROVIDER_RESPONSE',type:'invalid_request_error',param:'reasoning',code:'unsupported_value'}}));return
      }
      const item={type:'message',id:'msg_title_fixture',status:'completed',role:'assistant',content:[{type:'output_text',text:'推理模型会话标题',annotations:[]}]}
      const response={id:'resp_title_fixture',object:'response',created_at:1,model:body.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:10,total_tokens:11,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}
      const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'推理模型会话标题'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}]
      res.writeHead(200,{'Content-Type':'text/event-stream'});events.forEach((event,index)=>res.write('event: '+event.type+'\ndata: '+JSON.stringify({...event,sequence_number:index+1})+'\n\n'));res.end();return
    }
    const last=body.messages.at(-1),chunks=[]
    // A private stalled-network fixture: killing Pi closes this request; no external tool is launched.
    if(process.argv.includes('--session-health') && last.role==='user' && JSON.stringify(last.content).includes('SPI_HEALTH_HANG')) return
    if(raw.includes('SPI_SESSION_TITLE')){
      chunks.push({choices:[{index:0,delta:{role:'assistant',content:'会话操作与终端优化'},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}]})
    }else if(last.role==='user'){
      const text=typeof last.content==='string'?last.content:last.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'),match=text.match(/\{"tool":[\s\S]*\}/),action=JSON.parse(match[0])
      chunks.push({choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_'+Date.now(),type:'function',function:{name:action.tool,arguments:JSON.stringify(action.input)}}]},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})
    }else chunks.push({choices:[{index:0,delta:{role:'assistant',content:'SPI_FIXTURE_DONE'},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}]})
    if(process.argv.includes('--context-usage'))chunks.push({choices:[],usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100}})
    res.writeHead(200,{'Content-Type':'text/event-stream'});for(const c of chunks)res.write('data: '+JSON.stringify({id:'chatcmpl-fixture',object:'chat.completion.chunk',created:1,model:'fixture',...c})+'\n\n');res.end('data: [DONE]\n\n')
  }catch(error){errors.push(error.message);res.writeHead(500);res.end('{}')}})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const provider=path.join(artifacts,'provider.mjs')
  const recoveryFixture=process.argv.includes('--session-recovery')?"pi.registerCommand('fixture-exit',{description:'private recovery fixture',handler:async()=>{setTimeout(()=>process.exit(0),50)}});":''
  fs.writeFileSync(provider,`export default function(pi){${recoveryFixture}pi.registerCommand('spi-title',{description:'isolated title fixture',handler:async args=>pi.setSessionName(args)});pi.registerProvider('spi-test',{api:'openai-completions',baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'local-fixture',models:[{id:'fixture',name:'sPi deterministic test',reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},...['fixture-reasoning','fixture-reasoning-reject'].map(id=>({id,name:id,api:'openai-responses',reasoning:true,input:['text'],contextWindow:32768,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}))]})}`)
  const approvals=path.join(artifacts,'approval-fixture.mjs')
  fs.writeFileSync(approvals,`export default function(pi){let policy='ask';pi.registerCommand('fixture-policy',{description:'isolated Pi policy fixture',handler:async(args,ctx)=>{if(['ask','bypass','deny'].includes(args.trim()))policy=args.trim();ctx.ui.notify('SPI_POLICY:'+policy,'info')}});pi.on('tool_call',async(event,ctx)=>{
    const command=String(event.input.command||'');let title,options=['Allow','Allow always (this project)','Allow always (global)','Block'];
    if(command.includes('SPI_EXT_DENY')||(command.includes('SPI_EXT_')&&policy==='deny'))return{block:true,reason:'SPI_FIXTURE_DIRECT_BLOCK'};
    if(command.includes('SPI_EXT_')&&policy==='bypass')return;
    if(command.includes('SPI_EXT_GENERIC'))title='Delete saved sessions?';
    else if(command.includes('SPI_EXT_UNKNOWN')){title='Allow bash? '+command;options=['Allow','Block'];}
    else if(command.includes('SPI_EXT_'))title='Allow bash? "'+command+'"';
    else if(event.toolName==='write'&&String(event.input.path).endsWith('SPI_EXT_WRITE.txt')){title='Allow write on '+event.input.path+'?';options.splice(3,0,'Allow all (enable bypass)');}
    else return;
    const choice=await ctx.ui.select(title,options);ctx.ui.notify('SPI_EXT_ANSWER:'+event.toolName+':'+String(choice),'info');if(choice!=='Allow')return{block:true,reason:'SPI_FIXTURE_NOT_ALLOWED'};
  })}`)
  const pi=process.env.SPI_TEST_PI_PATH||execFileSync('which',['pi'],{encoding:'utf8'}).trim(),wrapper=path.join(artifacts,'test-pi'),agent=path.join(artifacts,'agent')
  fs.mkdirSync(agent,{recursive:true})
  let compactionArgs=''
  if(process.argv.includes('--context-usage')){
    fs.writeFileSync(path.join(agent,'settings.json'),JSON.stringify({compaction:{enabled:false,reserveTokens:512,keepRecentTokens:256}}))
    const fixture=path.join(artifacts,'compaction-fixture.mjs'),record=path.join(artifacts,'compactions.jsonl')
    fs.writeFileSync(fixture,`import fs from 'node:fs';export default function(pi){pi.on('session_before_compact',async event=>{fs.appendFileSync(${JSON.stringify(record)},JSON.stringify({instructions:event.customInstructions})+'\\n');if(event.customInstructions==='SPI_CONTEXT_CANCEL')return{cancel:true};await new Promise(r=>setTimeout(r,250));return{compaction:{summary:'SPI_COMPACTION_SUMMARY '+(event.customInstructions||'default'),firstKeptEntryId:event.preparation.firstKeptEntryId,tokensBefore:event.preparation.tokensBefore}}})}`)
    compactionArgs=' --extension '+sh(fixture)
  }
  fs.writeFileSync(wrapper,`#!/bin/sh\nexec env PI_CODING_AGENT_DIR=${sh(agent)} ${sh(pi)} --no-extensions --extension ${sh(provider)} --extension ${sh(approvals)}${compactionArgs} "$@"\n`,{mode:0o700})
  const configFile=path.join(profile,'spi-config.json'),config=JSON.parse(fs.readFileSync(configFile));config.piPath=wrapper;fs.writeFileSync(configFile,JSON.stringify(config))
  let launchOptions
  if(process.argv.includes('--runtime-env')){
    const sparse=path.join(artifacts,'desktop-bin'),nodeBin=path.join(artifacts,'login-node-bin'),loginShell=path.join(artifacts,'login-shell')
    fs.mkdirSync(sparse);fs.mkdirSync(nodeBin)
    fs.symlinkSync(fs.realpathSync(execFileSync('which',['env'],{encoding:'utf8'}).trim()),path.join(sparse,'env'))
    fs.symlinkSync(process.execPath,path.join(nodeBin,'node'))
    fs.writeFileSync(loginShell,`#!/bin/sh\nprintf '__SPI_NODE_PATH__%s\\n' ${sh(path.join(nodeBin,'node'))}\n`,{mode:0o700})
    assert.throws(()=>execFileSync(path.join(sparse,'env'),['node','--version'],{env:{PATH:sparse},stdio:'ignore'}))
    launchOptions={env:{PATH:sparse,SHELL:loginShell},waitForSession:false}
  }
  if(process.argv.includes('--app-updates')&&!process.env.SPI_SMOKE_EXECUTABLE){
    const mode=path.join(artifacts,'update-mode.txt'),helper=path.join(artifacts,'update-helper.cjs')
    const nextVersion=require('../package.json').version.replace(/\d+$/,patch=>String(Number(patch)+1))
    fs.writeFileSync(mode,'current')
    fs.writeFileSync(helper,`const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1],mode=fs.readFileSync(${JSON.stringify(mode)},'utf8'),target=process.platform+'-'+process.arch;
      if(mode==='offline'){console.error('SPI_UPDATE_OFFLINE');process.exit(1)}
      if(args[0]==='check-update'){const currentVersion=get('--current-version'),version=mode==='current'?currentVersion:${JSON.stringify(nextVersion)};console.log(JSON.stringify({currentVersion,version,available:mode!=='current',supported:mode!=='unsupported',target,file:'spi-'+version+'-'+target+(process.platform==='linux'?'.tar.gz':'.zip'),size:1024,releaseUrl:'https://github.com/DiamondGo/spi/releases/tag/v'+version}))}
      else {console.error('[sPi] Downloading runtime: 1/2 MiB (50%)');setTimeout(()=>{if(mode==='install-failure'){console.error('SPI_UPDATE_CHECKSUM_MISMATCH');process.exitCode=1;return}const version=get('--version'),entry='app/spi',entryPath=path.join(get('--install-dir'),'releases',version,target,entry);fs.mkdirSync(path.dirname(entryPath),{recursive:true});fs.writeFileSync(entryPath,'#!/bin/sh\\n',{mode:0o755});console.log(JSON.stringify({version,target,entry,entryPath}))},250)}
    `)
    launchOptions={env:{SPI_TEST_UPDATE_HELPER:helper}}
  }
  let app
  try{
    app=await launch(launchOptions)
    const suite=process.argv.includes('--app-updates')?'app-updates-smoke.cjs':process.argv.includes('--context-usage')?'context-usage-smoke.cjs':process.argv.includes('--question-navigation')?'user-message-navigation-smoke.cjs':process.argv.includes('--remote')?'remote-smoke.cjs':process.argv.includes('--session-actions')?'session-actions-smoke.cjs':process.argv.includes('--session-recovery')?'session-recovery-smoke.cjs':process.argv.includes('--session-health')?'session-health-smoke.cjs':process.argv.includes('--runtime-env')?'runtime-env-smoke.cjs':process.argv.includes('--terminal')?'terminal-smoke.cjs':process.argv.includes('--settings')?'settings-smoke.cjs':process.argv.includes('--extension-ui')?'extension-ui-smoke.cjs':process.argv.includes('--workspace-ui')?'workspace-ui-smoke.cjs':'yolo-smoke.cjs'
    await require('./'+suite)({...context,app,hashes,before,launchOptions,namingRequests})
    assert.deepEqual(hashes(),before);assert.deepEqual(errors,[])
  }catch(error){if(app&&!app.exited){try{fs.writeFileSync(path.join(artifacts,'gui-failure.json'),JSON.stringify(await app.eval('(async()=>({yolo:await window.spi.getYoloState(),events:window.__smokeEvents,body:document.body.innerText}))()')))}catch{}}throw error}
  finally{await stop(app);server.closeAllConnections();await new Promise(r=>server.close(r))}
}
