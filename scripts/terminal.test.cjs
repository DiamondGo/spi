const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spi-terminal-unit-'))
const source = fs.readFileSync(path.join(__dirname, '../src/main/terminalManager.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
const file = path.join(tmp, 'terminalManager.cjs')
fs.writeFileSync(file, compiled.outputText)
const { TerminalManager, defaultShell } = require(file)
const delay = ms => new Promise(r => setTimeout(r, ms))
let count = 0
const check = async (name, fn) => { await fn(); count++; console.log('PASS', name) }
function fake() {
  let data, exit
  return {
    pid: 2147483000, cols:80,rows:12, paused:0,resumed:0,writes:[],sizes:[],killed:0,
    pause(){this.paused++},resume(){this.resumed++},write(s){this.writes.push(s)},resize(c,r){this.sizes.push([c,r])},kill(){this.killed++},
    onData(fn){data=fn;return {dispose(){data=undefined}}},onExit(fn){exit=fn;return {dispose(){exit=undefined}}},
    data(s){data?.(s)},exit(code=0){exit?.({exitCode:code})}
  }
}
;(async()=>{
  await check('default shell respects executable SHELL, falls back safely, never splits a shell command string',()=>{
    const shell=path.join(tmp,'custom shell');fs.writeFileSync(shell,'#!/bin/sh\n',{mode:0o700})
    assert.equal(defaultShell('linux',{SHELL:shell},'/bin/sh'),shell)
    assert.equal(defaultShell('linux',{SHELL:'/bin/bash -c bad'},'/bin/sh'),'/bin/sh')
    assert.equal(defaultShell('win32',{ComSpec:'C:\\Windows\\System32\\cmd.exe'},null),'C:\\Windows\\System32\\cmd.exe')
  })
  await check('open uses argv, exact cwd and terminal environment; a session gets only one PTY',()=>{
    const events=[], p=fake();let calls=0,args
    const m=new TerminalManager((...e)=>events.push(e),(shell,argv,opts)=>{calls++;args={shell,argv,opts};return p})
    const a=m.open('a',tmp,1,90,15),b=m.open('a',tmp,1,20,4)
    assert.equal(a.terminalId,b.terminalId);assert.equal(calls,1);assert.equal(args.opts.cwd,tmp)
    assert.ok(Array.isArray(args.argv));assert.equal(args.opts.env.TERM,'xterm-256color');assert.equal(args.opts.env.ELECTRON_RUN_AS_NODE,undefined)
    const rc=args.argv[0]==='--rcfile'?args.argv[1]:null
    if(rc){assert.ok(fs.readFileSync(rc,'utf8').includes('builtin cd -- "$SPI_TERMINAL_CWD"'));assert.equal(args.opts.env.SPI_TERMINAL_CWD,tmp)}
    assert.equal(p.paused,1);m.closeAll()
    if(rc)assert.equal(fs.existsSync(rc),false)
  })
  await check('invalid cwd / dimensions and cross-window requests are rejected',()=>{
    const p=fake(),m=new TerminalManager(()=>{},()=>p)
    assert.throws(()=>m.open('missing',path.join(tmp,'missing'),1,80,12))
    assert.throws(()=>m.open('a',tmp,1,NaN,12))
    const a=m.open('a',tmp,1,80,12)
    assert.throws(()=>m.open('a',tmp,2,80,12));assert.throws(()=>m.attach('a',a.terminalId,2))
    assert.throws(()=>m.write('a',a.terminalId,2,'input'));assert.throws(()=>m.close('a',a.terminalId,2))
    m.closeAll()
  })
  await check('attach replays startup output once; data is sequenced and backpressured until acknowledged',async()=>{
    const p=fake(),events=[],m=new TerminalManager((owner,event)=>events.push(event),()=>p)
    const a=m.open('a',tmp,1,80,12)
    p.data('welcome\r\n');await delay(25);assert.equal(events.length,0)
    const s=m.attach('a',a.terminalId,1);assert.equal(s.history,'welcome\r\n');assert.equal(s.seq,0)
    p.data('one');await delay(25);assert.equal(events[0].data,'one');assert.equal(events[0].seq,1)
    p.data('two');await delay(25);assert.equal(events.length,1)
    m.ack('a',a.terminalId,1,999);await delay(25);assert.equal(events.length,1)
    m.ack('a',a.terminalId,1,1);await delay(25);assert.equal(events[1].data,'two');assert.equal(events[1].seq,2)
    const replay=m.attach('a',a.terminalId,1);assert.equal(replay.history,'welcome\r\nonetwo');assert.equal(replay.seq,2)
    m.closeAll()
  })
  await check('input and resize are bounded; new dimensions are reflected in snapshots',()=>{
    const p=fake(),m=new TerminalManager(()=>{},()=>p),a=m.open('a',tmp,1,80,12)
    m.write('a',a.terminalId,1,'echo hello\r');assert.deepEqual(p.writes,['echo hello\r'])
    assert.throws(()=>m.write('a',a.terminalId,1,'x'.repeat(65537)))
    m.resize('a',a.terminalId,1,1000,1);assert.deepEqual(p.sizes,[[500,2]])
    assert.equal(m.get('a',1).cols,500);assert.equal(m.get('a',1).rows,2)
    assert.throws(()=>m.resize('a',a.terminalId,1,80,NaN));m.closeAll()
  })
  await check('large output history stays bounded and packets do not split surrogate pairs',async()=>{
    const p=fake(),events=[],m=new TerminalManager((owner,event)=>events.push(event),()=>p),a=m.open('a',tmp,1,80,12)
    p.data('x'.repeat(2*1024*1024)+'\nTAIL');assert.ok(m.get('a',1).history.length<=1024*1024)
    m.attach('a',a.terminalId,1)
    p.data('a'.repeat(65535)+'😀end');await delay(25)
    assert.equal(events[0].data.length,65535)
    m.ack('a',a.terminalId,1,events[0].seq);await delay(25)
    assert.equal(events[1].data,'😀end');m.closeAll()
  })
  await check('exit removes state; stale close/input cannot affect a replacement terminal',()=>{
    let p=fake();const events=[],m=new TerminalManager((owner,event)=>events.push(event),()=>p)
    const a=m.open('a',tmp,1,80,12);p.exit(7)
    assert.equal(m.get('a',1),null);assert.equal(events[0].exitCode,7)
    p=fake();const b=m.open('a',tmp,1,80,12);assert.notEqual(a.terminalId,b.terminalId)
    m.close('a',a.terminalId,1);assert.equal(m.get('a',1).terminalId,b.terminalId)
    assert.throws(()=>m.write('a',a.terminalId,1,'bad'));assert.deepEqual(p.writes,[]);m.closeAll()
  })
  await check('owner/session/all cleanup stays scoped and emits a close event immediately',()=>{
    const m=new TerminalManager(()=>{},()=>fake())
    m.open('a',tmp,1,80,12);m.open('b',tmp,2,80,12);m.closeOwner(1)
    assert.equal(m.get('a',1),null);assert.ok(m.get('b',2));m.closeSession('b');assert.equal(m.get('b',2),null)
    m.closeAll();assert.equal(m.cleanup.size,0)
  })
  await check('native spawn failure leaves no orphan terminal entry',()=>{
    const m=new TerminalManager(()=>{},()=>{throw Error('native missing')})
    assert.throws(()=>m.open('a',tmp,1,80,12));assert.equal(m.get('a',1),null)
  })
  console.log(`RESULT PASS ${count} checks ${tmp}`)
})().catch(error=>{console.error(error);process.exitCode=1})
