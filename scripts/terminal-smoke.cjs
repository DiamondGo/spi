const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function ({ app, stop, waitFor, pass, fill, artifacts, workspace, descendants, hashes, before }) {
  const evaluate = expression => app.eval(expression)
  const get = id => evaluate(`window.spi.getTerminal(${JSON.stringify(id)})`)
  const state = () => evaluate('window.spi.getPermissions()')
  const write = (info,text) => evaluate(`window.spi.writeTerminal(${JSON.stringify(info.sessionId)},${JSON.stringify(info.terminalId)},${JSON.stringify(text)})`)
  const output = (info, marker) => waitFor(async()=>{
    const s=await get(info.sessionId)
    if(!s)throw Error('Terminal closed while waiting for '+marker)
    return s.history.includes(marker) ? s : false
  },'terminal output '+marker)
  const startTime = pid => {try{const s=fs.readFileSync(`/proc/${pid}/stat`,'utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[19]}catch{return null}}
  const owned = new Map()
  const track = pid => {const started=startTime(pid);if(started)owned.set(pid,started)}
  const alive = pid => owned.has(pid)&&startTime(pid)===owned.get(pid)
  const gone = pid => waitFor(()=>!alive(pid),'owned process exited '+pid,10000)
  const capture = async name => {const s=await app.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(s.data,'base64'))}
  const enter = async () => {
    for(const type of ['keyDown','keyUp'])await app.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  }
  const open = async id => {
    await evaluate(`document.querySelector('.terminal-toggle').click()`)
    const info=await waitFor(async()=>await get(id),'PTY created')
    track(info.pid)
    await waitFor(()=>evaluate(`!!document.querySelector('.terminal-panel:not([hidden]) .xterm-helper-textarea')`),'xterm initialized')
    return info
  }
  let a,b,spaceSession
  try {
    a=Object.keys((await state()).sessions)[0]
    assert.equal(await evaluate(`document.querySelectorAll('.input-options select').length`),1)
    assert.equal(await evaluate(`document.querySelectorAll('.tb-details select').length`),3)
    assert.equal(await evaluate(`!!document.querySelector('.input-options .permission-settings-button')`),false)
    await evaluate(`(()=>{const e=document.querySelector('select[data-control="permission"]');e.value='__settings';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await waitFor(()=>evaluate(`!!document.querySelector('.permission-settings')`),'permission rules in header menu')
    assert.equal((await state()).sessions[a].mode,'ask')
    await evaluate(`document.querySelector('.permission-panel-close').click()`)
    pass('composer removes duplicate header controls; permission rules remain accessible from header menu')

    await fill(app,'SPI_TERMINAL_DRAFT_A')
    const first=await open(a)
    assert.equal(first.cwd,workspace)
    if(process.env.SHELL&&fs.existsSync(process.env.SHELL))assert.equal(first.shell,process.env.SHELL)
    assert.equal(await evaluate(`document.querySelector('.terminal-toggle').getAttribute('aria-pressed')`),'true')
    assert.equal(await evaluate(`document.querySelector('.input-bar textarea').value`),'SPI_TERMINAL_DRAFT_A')
    const geometry=await evaluate(`(()=>{const c=document.querySelector('.chat-messages').getBoundingClientRect(),t=document.querySelector('.terminal-panel:not([hidden])').getBoundingClientRect(),i=document.querySelector('.input-bar-wrap').getBoundingClientRect();return {above:c.bottom<=t.top+1,below:t.bottom<=i.top+1}})()`)
    assert.ok(geometry.above&&geometry.below,JSON.stringify(geometry))
    await write(first,`printf 'SPI_PWD:%s\\n' "$PWD"; if test -t 0 && test -t 1; then printf 'SPI_REAL_TTY_OK\\n'; fi; printf 'SPI_INTERACTIVE:%s\\n' "$-"\r`)
    const initial=await output(first,'SPI_REAL_TTY_OK\r\n')
    assert.ok(initial.history.includes('SPI_PWD:'+workspace+'\r\n'),initial.history.slice(-1000))
    assert.match(initial.history,/SPI_INTERACTIVE:[^\r\n]*i/)
    await evaluate(`document.querySelector('.terminal-toggle').click()`)
    assert.equal((await get(a)).terminalId,first.terminalId)
    pass('real default shell opens in session cwd as an interactive PTY, between chat and input; reopen focuses same PTY')

    await evaluate(`document.querySelector('.terminal-panel:not([hidden]) .xterm-helper-textarea').focus()`)
    for(const key of 'echo spiuiinputok') {
      await app.send('Input.dispatchKeyEvent',{type:'keyDown',key,text:key,unmodifiedText:key,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)})
      await app.send('Input.dispatchKeyEvent',{type:'keyUp',key,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)})
    }
    await enter()
    await output(first,'\rspiuiinputok\r\n')
    await write(first,"printf '\\033[31mSPI_ANSI_OK\\033[0m\\n'\r")
    await output(first,'\x1b[31mSPI_ANSI_OK\x1b[0m')
    await waitFor(()=>evaluate(`document.querySelector('.terminal-panel:not([hidden]) .xterm-screen').textContent.includes('SPI_ANSI_OK')`),'ANSI output rendered by xterm')
    pass('terminal keyboard input and ANSI output work through xterm, not a line-buffered fake console')

    await write(first,'sleep 60\r')
    const sleepPid=await waitFor(()=>{
      const children=fs.readFileSync(`/proc/${first.pid}/task/${first.pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean).map(Number)
      return children.find(pid=>{try{return fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').includes('sleep')}catch{return false}})
    },'owned foreground sleep')
    track(sleepPid)
    await write(first,'\x03')
    await gone(sleepPid)
    await write(first,"printf 'SPI_CTRL_C_OK\\n'\r")
    await output(first,'SPI_CTRL_C_OK\r\n')
    pass('Ctrl+C interrupts the terminal foreground command without closing shell or pi')

    const wide=(await get(a)).cols
    await app.send('Emulation.setDeviceMetricsOverride',{width:900,height:640,deviceScaleFactor:1,mobile:false})
    await waitFor(async()=> (await get(a)).cols<wide,'PTY follows terminal viewport width')
    const resized=await get(a)
    await write(first,"printf 'SPI_SIZE:'; stty size\r")
    await output(first,`SPI_SIZE:${resized.rows} ${resized.cols}\r\n`)
    await capture('terminal-900')
    await app.send('Emulation.clearDeviceMetricsOverride')
    await waitFor(async()=> (await get(a)).cols>resized.cols,'PTY restores width')
    pass('terminal resize reaches kernel PTY dimensions (stty size)')

    await write(first,"printf 'SPI_FLOOD_START\\n'; for ((i=0;i<5000;i++)); do printf 'terminal flow control %04d\\n' \"$i\"; done; printf 'SPI_FLOOD_END\\n'\r")
    const flooded=await output(first,'SPI_FLOOD_END\r\n')
    assert.ok(flooded.history.length<=1024*1024)
    await write(first,"printf 'SPI_AFTER_FLOOD\\n'\r")
    await output(first,'SPI_AFTER_FLOOD\r\n')
    pass('large terminal output is backpressured and remains responsive with bounded history')

    for(const theme of ['light','high-contrast','dark']){
      await evaluate(`window.spi.updateAppSettings({theme:${JSON.stringify(theme)},language:${JSON.stringify(theme==='light'?'en':'zh')}})`)
      await waitFor(()=>evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`),'terminal theme '+theme)
      assert.equal((await get(a)).pid,first.pid)
      assert.equal(await evaluate(`document.querySelector('.terminal-header strong').textContent`),theme==='light'?'Terminal':'终端')
      await capture('terminal-'+theme)
    }
    pass('terminal follows language and all themes without restarting shell')

    const oldShell=process.env.SHELL
    const spaced=path.join(artifacts,'workspace with spaces');fs.mkdirSync(spaced)
    spaceSession=(await evaluate(`window.spi.openSession({cwd:${JSON.stringify(spaced)}})`)).sessionId
    const inSpace=await evaluate(`window.spi.openTerminal(${JSON.stringify(spaceSession)},80,8)`)
    track(inSpace.pid)
    await evaluate(`window.__terminalOff=window.spi.onTerminalEvent(e=>{if(e.type==='data'&&e.sessionId===${JSON.stringify(spaceSession)})window.spi.acknowledgeTerminal(e.sessionId,e.terminalId,e.seq)})`)
    await evaluate(`window.spi.attachTerminal(${JSON.stringify(spaceSession)},${JSON.stringify(inSpace.terminalId)})`)
    await write(inSpace,`printf 'SPI_SPACE:%s\\n' "$PWD"\r`)
    await output(inSpace,'SPI_SPACE:'+spaced+'\r\n')
    if(oldShell&&fs.existsSync(oldShell))assert.equal(inSpace.shell,oldShell)
    await evaluate(`window.spi.closeTerminal(${JSON.stringify(spaceSession)},${JSON.stringify(inSpace.terminalId)})`)
    await gone(inSpace.pid)
    await evaluate(`window.__terminalOff();window.spi.closeSession(${JSON.stringify(spaceSession)})`)
    spaceSession=undefined
    pass('cwd containing spaces is passed directly, not interpolated into a shell command')

    await write(first,"export SPI_TAB_STATE=A; printf 'SPI_A_STATE_SET\\n'\r")
    await output(first,'SPI_A_STATE_SET\r\n')
    await write(first,"(sleep 1; printf 'SPI_A_BACKGROUND\\n') &\r")
    await evaluate(`document.querySelector('.btn-new').click()`)
    await waitFor(()=>evaluate(`document.querySelectorAll('.session-tab').length===2`),'second pi session')
    b=await evaluate(`document.querySelector('.session-tab.active').dataset.sessionId`)
    assert.notEqual(a,b)
    assert.equal(await evaluate(`document.querySelectorAll('.terminal-panel:not([hidden])').length`),0)
    assert.equal((await get(a)).pid,first.pid)
    await fill(app,'SPI_TERMINAL_DRAFT_B')
    const second=await open(b)
    assert.notEqual(second.pid,first.pid)
    await write(second,"printf 'SPI_B_STATE:%s\\n' \"${SPI_TAB_STATE-unset}\"; printf 'SPI_B_ONLY\\n'\r")
    await output(second,'SPI_B_STATE:unset\r\n')
    await output(first,'SPI_A_BACKGROUND\r\n')
    assert.ok(!(await get(a)).history.includes('SPI_B_ONLY'))
    await evaluate(`document.querySelector('.session-tab[data-session-id="${a}"]').click()`)
    await write(first,"printf 'SPI_A_STATE:%s\\n' \"$SPI_TAB_STATE\"\r")
    await output(first,'SPI_A_STATE:A\r\n')
    assert.ok(!(await get(b)).history.includes('SPI_A_STATE:A'))
    assert.equal(await evaluate(`document.querySelector('.input-bar textarea').value`),'SPI_TERMINAL_DRAFT_A')
    pass('two sessions keep distinct PTYs, shell state, output and drafts across tab switches')

    await evaluate(`document.querySelector('.session-tab[data-session-id="${b}"]').click()`)
    await write(second,'sleep 60\r')
    const child=await waitFor(()=>{
      try{return fs.readFileSync(`/proc/${second.pid}/task/${second.pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean).map(Number).find(pid=>{try{return fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').includes('sleep')}catch{return false}})}catch{return false}
    },'B foreground child')
    track(child)
    await evaluate(`document.querySelector('.terminal-panel:not([hidden]) .terminal-close').click()`)
    await waitFor(async()=> !(await get(b)),'close terminal with x')
    await gone(second.pid);await gone(child)
    assert.ok(alive(first.pid))
    assert.equal(await evaluate(`document.querySelector('.input-bar textarea').value`),'SPI_TERMINAL_DRAFT_B')
    assert.equal(await evaluate(`document.querySelectorAll('.terminal-panel:not([hidden])').length`),0)
    pass('x closes shell and owned foreground child, preserves message draft and leaves peer terminal alive')

    await evaluate(`document.querySelector('.session-tab[data-session-id="${a}"]').click()`)
    await write(first,'exit\r')
    await waitFor(async()=>!(await get(a)),'shell exit closes panel')
    await gone(first.pid)
    assert.equal(await evaluate(`document.querySelectorAll('.terminal-panel:not([hidden])').length`),0)
    const replacement=await open(a)
    assert.notEqual(replacement.terminalId,first.terminalId)
    await evaluate(`window.spi.closeTerminal(${JSON.stringify(a)},${JSON.stringify(first.terminalId)})`)
    assert.equal((await get(a)).terminalId,replacement.terminalId)
    await write(replacement,"printf 'SPI_FRESH:%s\\n' \"${SPI_TAB_STATE-unset}\"\r")
    await output(replacement,'SPI_FRESH:unset\r\n')
    pass('shell exit automatically restores chat/input-only UI; reopening is fresh and stale close is harmless')

    await evaluate(`document.querySelector('.session-tab[data-session-id="${a}"] .session-tab-close').click()`)
    await waitFor(()=>evaluate(`document.querySelectorAll('.session-tab').length===1`),'close session A')
    await gone(replacement.pid)
    assert.equal(await evaluate(`document.querySelector('.session-tab.active').dataset.sessionId`),b)
    assert.ok(await evaluate(`!!document.querySelector('.input-bar textarea')`))
    pass('closing a pi session also closes only its terminal')

    const quitTerm=await open(b)
    await write(quitTerm,'sleep 60\r')
    await waitFor(()=>{try{return fs.readFileSync(`/proc/${quitTerm.pid}/task/${quitTerm.pid}/children`,'utf8').trim()}catch{return false}},'quit foreground child')
    for(const pid of descendants(app.child.pid))track(pid)
    assert.deepEqual(hashes(),before)
    assert.equal(app.errors.length,0,JSON.stringify(app.errors))
    await evaluate(`window.spi.updateAppSettings({confirmOnExit:false})`)
    await evaluate(`window.close()`).catch(()=>{})
    await waitFor(()=>app.exited,'quit app with terminal open',15000)
    await waitFor(()=>[...owned.keys()].every(pid=>!alive(pid)),'all owned PTY and pi processes exit',15000)
    pass('application quit cleans its terminal jobs and pi processes without touching unrelated agents')
  }catch(error){
    if(!app.exited){
      try{await capture('terminal-failure')}catch{}
      try{fs.writeFileSync(path.join(artifacts,'terminal-failure.json'),JSON.stringify(await evaluate(`(async()=>({body:document.body.innerText,terminals:await Promise.all(Object.keys((await window.spi.getPermissions()).sessions).map(id=>window.spi.getTerminal(id)))}))()`),null,2))}catch{}
    }
    throw error
  }finally{
    if(spaceSession&&!app.exited){try{await evaluate(`window.spi.closeSession(${JSON.stringify(spaceSession)})`)}catch{}}
    await stop(app)
    for(const pid of owned.keys())if(alive(pid)){try{process.kill(pid,'SIGKILL')}catch{}}
  }
}
