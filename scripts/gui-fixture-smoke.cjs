// Isolated real Pi + deterministic loopback model, shared by GUI regression suites.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto')
module.exports=async function(context){
  const {launch,stop,workspace,profile,artifacts}=context,sh=s=>"'"+s.replaceAll("'","'\\''")+"'"
  const legacy=path.join(profile,'spi-permissions.json');fs.writeFileSync(legacy,'{intentionally invalid legacy configuration')
  const configFiles=[path.join(os.homedir(),'.pi/agent/settings.json'),path.join(workspace,'.pi/settings.json'),legacy]
  const hashes=()=>configFiles.map(f=>[f,fs.existsSync(f)?createHash('sha256').update(fs.readFileSync(f)).digest('hex'):null]),before=hashes(),errors=[]
  const server=http.createServer(async(req,res)=>{try{
    let raw='';for await(const chunk of req)raw+=chunk
    const body=JSON.parse(raw),last=body.messages.at(-1),chunks=[]
    if(last.role==='user'){
      const text=typeof last.content==='string'?last.content:last.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'),match=text.match(/\{"tool":[\s\S]*\}/),action=JSON.parse(match[0])
      chunks.push({choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_'+Date.now(),type:'function',function:{name:action.tool,arguments:JSON.stringify(action.input)}}]},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})
    }else chunks.push({choices:[{index:0,delta:{role:'assistant',content:'SPI_FIXTURE_DONE'},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}]})
    res.writeHead(200,{'Content-Type':'text/event-stream'});for(const c of chunks)res.write('data: '+JSON.stringify({id:'chatcmpl-fixture',object:'chat.completion.chunk',created:1,model:'fixture',...c})+'\n\n');res.end('data: [DONE]\n\n')
  }catch(error){errors.push(error.message);res.writeHead(500);res.end('{}')}})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const provider=path.join(artifacts,'provider.mjs')
  fs.writeFileSync(provider,`export default function(pi){pi.registerCommand('spi-title',{description:'isolated title fixture',handler:async args=>pi.setSessionName(args)});pi.registerProvider('spi-test',{api:'openai-completions',baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'local-fixture',models:[{id:'fixture',name:'sPi deterministic test',reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]})}`)
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
  fs.writeFileSync(wrapper,`#!/bin/sh\nexec env PI_CODING_AGENT_DIR=${sh(agent)} ${sh(pi)} --no-extensions --extension ${sh(provider)} --extension ${sh(approvals)} "$@"\n`,{mode:0o700})
  const configFile=path.join(profile,'spi-config.json'),config=JSON.parse(fs.readFileSync(configFile));config.piPath=wrapper;fs.writeFileSync(configFile,JSON.stringify(config))
  let app
  try{
    app=await launch()
    const suite=process.argv.includes('--terminal')?'terminal-smoke.cjs':process.argv.includes('--settings')?'settings-smoke.cjs':process.argv.includes('--extension-ui')?'extension-ui-smoke.cjs':'yolo-smoke.cjs'
    await require('./'+suite)({...context,app,hashes,before})
    assert.deepEqual(hashes(),before);assert.deepEqual(errors,[])
  }catch(error){if(app&&!app.exited){try{fs.writeFileSync(path.join(artifacts,'gui-failure.json'),JSON.stringify(await app.eval('(async()=>({yolo:await window.spi.getYoloState(),events:window.__smokeEvents,body:document.body.innerText}))()')))}catch{}}throw error}
  finally{await stop(app);server.closeAllConnections();await new Promise(r=>server.close(r))}
}
