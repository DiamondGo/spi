// Dedicated display for GUI tests; never attach test keyboard input to the user's desktop.
const fs=require('node:fs'),{spawn}=require('node:child_process')
const args=process.argv.slice(2)
if(!args.length)throw Error('Usage: node with-display.cjs script.cjs [args]')
let display,child,finished=false
function stop(){if(finished)return;finished=true;if(display){display.kill('SIGTERM');display.stdout.destroy();display.stderr.destroy();display.stdio[3]?.destroy()}}
function run(env){
  child=spawn(process.execPath,args,{env,stdio:'inherit'})
  child.once('error',error=>{console.error(error.message);process.exitCode=1;stop()})
  child.once('exit',(code,signal)=>{process.exitCode=code??1;if(signal)console.error('Owned test child terminated: '+signal);stop()})
}
if(process.platform!=='linux'||process.env.SPI_TEST_VIRTUAL_DISPLAY==='1')run(process.env)
else{
  const binary=process.env.SPI_XVFB_BINARY||'/usr/bin/Xvfb'
  if(!fs.existsSync(binary)){console.error('GUI tests require Xvfb (or SPI_XVFB_BINARY); no shared-desktop fallback is allowed.');process.exitCode=1}
  else{
    let output='',ready=false
    display=spawn(binary,['-displayfd','3','-screen','0','1920x1080x24','-nolisten','tcp','-noreset'],{stdio:['ignore','pipe','pipe','pipe']})
    const timer=setTimeout(()=>{console.error('Private display startup timed out');process.exitCode=1;stop()},15000)
    display.on('error',error=>{clearTimeout(timer);console.error(error.message);process.exitCode=1;stop()})
    display.stderr.on('data',()=>{}) // Keep diagnostics out of public logs; never echo host display details.
    display.stdio[3].on('data',data=>{
      output+=data
      if(!ready&&/^\d+\n/.test(output)){
        ready=true;clearTimeout(timer)
        run({...process.env,DISPLAY:':'+output.trim(),WAYLAND_DISPLAY:'',XDG_SESSION_TYPE:'x11',SPI_TEST_VIRTUAL_DISPLAY:'1'})
      }
    })
    display.once('exit',()=>{clearTimeout(timer);if(!finished){console.error('Private display exited');process.exitCode=1;child?.kill('SIGKILL');stop()}})
  }
}
process.once('SIGINT',()=>{child?.kill('SIGINT');stop()})
process.once('SIGTERM',()=>{child?.kill('SIGTERM');stop()})
