// Real pi RPC + sPi build, deterministic loopback model; no external model requests.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')

module.exports = async function ({ launch, stop, waitFor, pass, fill, workspace, profile, artifacts, descendants }) {
  const sh = value => "'" + value.replaceAll("'", "'\\''") + "'"
  const configFiles = [path.join(require('node:os').homedir(), '.pi/agent/settings.json'), path.join(workspace, '.pi/settings.json')]
  const hashes = () => configFiles.map(f => [f, fs.existsSync(f) ? createHash('sha256').update(fs.readFileSync(f)).digest('hex') : null])
  const before = hashes()
  let requests = 0
  const modelErrors = []
  const server = http.createServer(async (req, res) => {
    try {
    let raw = ''
    for await (const d of req) raw += d
    const body = JSON.parse(raw)
    requests++
    const last = body.messages.at(-1)
    const chunks = []
    if (last.role === 'user') {
      const content = typeof last.content === 'string' ? last.content : last.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      const match = content.match(/\{"tool":[\s\S]*\}/)
      const action = JSON.parse(match[0])
      chunks.push({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_spi_' + requests, type: 'function', function: { name: action.tool, arguments: JSON.stringify(action.input) } }] }, finish_reason: null }] })
      chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    } else {
      chunks.push({ choices: [{ index: 0, delta: { role: 'assistant', content: 'SPI_FIXTURE_DONE' }, finish_reason: null }] })
      chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const c of chunks) res.write('data: ' + JSON.stringify({ id: 'chatcmpl-spi', object: 'chat.completion.chunk', created: 1, model: 'fixture', ...c }) + '\n\n')
    res.end('data: [DONE]\n\n')
    } catch (error) {
      modelErrors.push(error.message)
      res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const fixture = path.join(artifacts, 'provider.mjs')
  fs.writeFileSync(fixture, `export default function(pi) { pi.registerCommand('spi-title', {description:'sPi title test', handler:async args=>pi.setSessionName(args)}); pi.registerProvider('spi-test', { api: 'openai-completions', baseUrl: 'http://127.0.0.1:${server.address().port}/v1', apiKey: 'local-fixture', models: [{ id: 'fixture', name: 'sPi deterministic test', reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] }) }`)
  const pi = process.env.SPI_TEST_PI_PATH || execFileSync('which', ['pi'], { encoding: 'utf8' }).trim()
  const wrapper = path.join(artifacts, 'test-pi')
  let extraExtension = ''
  if (process.argv.includes('--extension-ui')) {
    const approvals = path.join(artifacts, 'approval-fixture.mjs')
    fs.writeFileSync(approvals, `export default function(pi) { pi.on('tool_call', async (event, ctx) => {
      const command=String(event.input.command||''); let title, options=['Allow','Allow always (this project)','Allow always (global)','Block'];
      if(command.includes('SPI_EXT_DENY'))return {block:true,reason:'SPI_FIXTURE_DIRECT_BLOCK'};
      if(command.includes('SPI_EXT_GENERIC'))title='Delete saved sessions?';
      else if(command.includes('SPI_EXT_UNKNOWN')){title='Allow bash? '+command;options=['Allow','Block'];}
      else if(command.includes('SPI_EXT_'))title='Allow bash? "'+command+'"';
      else if(event.toolName==='write'&&String(event.input.path).endsWith('SPI_EXT_WRITE.txt')){title='Allow write on '+event.input.path+'?';options.splice(3,0,'Allow all (enable bypass)');}
      else return;
      const choice=await ctx.ui.select(title,options);ctx.ui.notify('SPI_EXT_ANSWER:'+event.toolName+':'+String(choice),'info');
      if(choice!=='Allow')return {block:true,reason:'SPI_FIXTURE_NOT_ALLOWED'};
    }) }`)
    extraExtension = ' --extension ' + sh(approvals)
  }
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${sh(pi)} --no-extensions --extension ${sh(fixture)}${extraExtension} "$@"\n`, { mode: 0o700 })
  const configPath = path.join(profile, 'spi-config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  config.piPath = wrapper
  fs.writeFileSync(configPath, JSON.stringify(config))
  let app
  let currentId
  const evaluate = expr => app.eval(expr)
  const snapshot = () => evaluate('window.spi.getPermissions()')
  const start = async (tool, input) => {
    const n = await evaluate('window.__smokeEvents.length')
    await fill(app, JSON.stringify({ tool, input }))
    await evaluate(`document.querySelector('.input-bar textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
    return n
  }
  const settled = n => waitFor(() => evaluate(`window.__smokeEvents.slice(${n}).some(e=>e.sessionId===${JSON.stringify(currentId)}&&e.event.type==='agent_settled')`), 'deterministic agent settled', 15000)
  const pending = () => waitFor(async () => (await snapshot()).pending.find(p => p.sessionId === currentId), 'sPi approval request')
  const answer = async decision => {
    const req = await pending()
    await evaluate(`window.spi.answerPermission(${JSON.stringify(currentId)},${JSON.stringify(req.id)},${JSON.stringify(decision)})`)
    return req
  }
  const mode = value => evaluate(`window.spi.setPermissionMode(${JSON.stringify(currentId)},${JSON.stringify(value)})`)
  const toggleRules = () => evaluate(`(()=>{const close=document.querySelector('.permission-panel-close');if(close){close.click();return}const e=document.querySelector('select[data-control="permission"]');e.value='__settings';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const hoverTip = async (selector, expected) => {
    // Leave any element already under the native pointer before testing a fresh mouse-enter.
    await app.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:600,y:200 })
    const rect = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await app.send('Input.dispatchMouseEvent', { type:'mouseMoved', ...rect })
    // Native pointer focus can belong to another user's window. Exercise the same React mouse-over
    // path without bringing this Electron window to the foreground or stealing their focus.
    if (!await evaluate(`Array.from(document.querySelectorAll('[role="tooltip"]')).some(e=>e.textContent.includes(${JSON.stringify(expected)}))`)) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:${rect.x},clientY:${rect.y},relatedTarget:null}))`)
    }
    try {
      await waitFor(()=>evaluate(`Array.from(document.querySelectorAll('[role="tooltip"]')).some(e=>e.textContent.includes(${JSON.stringify(expected)}))`), 'sidebar tooltip: '+expected, 5000)
    } catch (error) {
      const evidence=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {rect:{x:r.x,y:r.y,w:r.width,h:r.height},hit:document.elementFromPoint(${rect.x},${rect.y})?.outerHTML,hover:[...document.querySelectorAll(':hover')].slice(-5).map(e=>e.className)}})()`)
      const capture=await app.send('Page.captureScreenshot',{format:'png'})
      fs.writeFileSync(path.join(artifacts,'sidebar-hover-failure.png'),Buffer.from(capture.data,'base64'))
      throw new Error(error.message+' '+JSON.stringify(evidence))
    }
    const visible = await evaluate(`Array.from(document.querySelectorAll('[role="tooltip"]')).filter(e=>e.textContent.includes(${JSON.stringify(expected)})).every(e=>e.getBoundingClientRect().top>=0&&e.getBoundingClientRect().left>=0)`)
    assert.ok(visible,'Tooltip should remain inside viewport')
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`)
    await app.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:600,y:200 })
  }
  const taMetrics = () => evaluate(`(()=>{const t=document.querySelector('.input-bar textarea');const s=getComputedStyle(t);return {value:t.value,height:t.getBoundingClientRect().height,line:parseFloat(s.lineHeight),extras:parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth),overflow:s.overflowY,scroll:t.scrollHeight,client:t.clientHeight}})()`)
  const press = async (key, code) => {
    for (const type of ['keyDown', 'keyUp']) await app.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code })
  }
  const selectFixture = async () => {
    await waitFor(() => evaluate(`document.querySelector('.session-tab.active')?.dataset.sessionId===${JSON.stringify(currentId)}`), 'new session active in renderer')
    await waitFor(() => evaluate(`!!document.querySelector('select[title="标题栏模型"] option[value="spi-test/fixture"]')`), 'header model choices')
    await evaluate(`(()=>{const s=document.querySelector('select[title="标题栏模型"]');s.value='spi-test/fixture';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await waitFor(() => evaluate(`window.spi.getState(${JSON.stringify(currentId)}).then(s=>s.model.provider==='spi-test')`), 'fixture selected')
    await waitFor(() => evaluate(`document.querySelector('.tb-model').textContent.includes('sPi deterministic test')`), 'header model choice reflected in title')
  }
  try {
    app = await launch()
    if (process.argv.includes('--extension-ui')) {
      await require('./extension-ui-smoke.cjs')({app,waitFor,pass,workspace,artifacts,hashes,before})
      return
    }
    if (process.argv.includes('--terminal')) {
      await require('./terminal-smoke.cjs')({ app, launch, stop, waitFor, pass, fill, artifacts, profile, workspace, descendants, hashes, before })
      return
    }
    if (process.argv.includes('--settings')) {
      await require('./settings-smoke.cjs')({ app, launch, stop, waitFor, pass, fill, artifacts, profile, descendants, hashes, before })
      return
    }
    let s = await snapshot()
    currentId = Object.keys(s.sessions)[0]
    assert.equal(s.sessions[currentId].ready, true)
    assert.equal(s.sessions[currentId].mode, 'ask')
    const composerLayout = () => evaluate(`(()=>{
      const options=document.querySelector('.input-options');
      const selects=[...options.querySelectorAll('select')];
      const controls=[...selects,document.querySelector('.input-bar textarea'),document.querySelector('.input-message button')];
      const y=controls.map(s=>{const r=s.getBoundingClientRect();return r.top+r.height/2});
      return {sameRow:Math.max(...y)-Math.min(...y)<2,inline:options.querySelectorAll('select').length===1&&!!options.querySelector('.terminal-toggle'),noTopBar:!document.querySelector('.app-root > .permissions'),session:document.querySelector('.input-bar-wrap').dataset.sessionId};
    })()`)
    assert.deepEqual(await composerLayout(), { sameRow: true, inline: true, noTopBar: true, session: currentId })
    await selectFixture()
    pass('real pi loads packaged gate without pi configuration changes')
    pass('composer only contains delivery and terminal controls; model / permission / thinking stay in header')
    for (const [selector, tip] of [['.sidebar-mode-toggle button[aria-label="目录"]','目录'],['.sidebar-mode-toggle button[aria-label="近期"]','近期'],['.btn-new','新建会话']]) {
      const icon = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return {icon:!!e.querySelector('svg'),text:e.textContent.trim(),label:e.getAttribute('aria-label')}})()`)
      assert.ok(icon.icon&&icon.label&&!icon.text,JSON.stringify(icon))
      await hoverTip(selector,tip)
    }
    await waitFor(()=>evaluate(`document.querySelectorAll('.dir-tree .tree-node').length>1`),'expanded directory tree')
    await evaluate(`document.querySelector('.dir-tree > .tree-node .tree-arrow').click()`)
    await waitFor(()=>evaluate(`document.querySelector('.dir-tree > .tree-node .tree-arrow').getAttribute('aria-expanded')==='false'&&document.querySelectorAll('.dir-tree .tree-node').length===1`),'collapse tree with icon button')
    await hoverTip('.dir-tree > .tree-node .tree-arrow','展开主目录')
    await evaluate(`document.querySelector('.dir-tree > .tree-node .tree-arrow').click()`)
    await waitFor(()=>evaluate(`document.querySelectorAll('.dir-tree .tree-node').length>1`),'expand tree with icon button')
    assert.equal((await evaluate('window.spi.loadLayout()')).selectedDir,workspace,'Expanding must not select another cwd')
    pass('sidebar navigation / new-session / tree controls are icon-only, accessible and have hover tips')
    await require('./sidebar-layout-smoke.cjs')({ app, waitFor, pass, artifacts })
    await waitFor(() => evaluate(`document.querySelector('.tb-model').textContent==='模型：sPi deterministic test'&&document.querySelector('.tb-thinking').textContent==='思考：关闭（off）'&&document.querySelector('.tb-permission').textContent==='许可：每次询问'`), 'textual title metadata synchronized')
    assert.equal(await evaluate(`document.querySelectorAll('.tb-details svg,.tb-details .icon-control').length`), 0)
    assert.ok(await evaluate(`!!document.querySelector('.sidebar-toggle svg')&&!!document.querySelector('.app-settings-button svg')`))
    assert.equal(await evaluate(`document.querySelectorAll('.tb-choice select').length`), 3)
    pass('title bar has textual model / permission / thinking selectors synchronized with composer')
    const longTitle = 'SPI 单行会话摘要：验证标题过长时显示省略号，模型、许可和思考按钮保持可选择。'.repeat(3)
    await evaluate(`window.spi.sendPrompt(${JSON.stringify(currentId)},${JSON.stringify('/spi-title ' + longTitle)},'normal')`)
    await waitFor(() => evaluate(`document.querySelector('.tb-name').textContent===${JSON.stringify(longTitle)}`), 'live session rename updates header')
    for (const [width, height] of [[1280, 800], [900, 640]]) {
      await app.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      const fullTitle = await evaluate(`(()=>{const h=document.querySelector('.titlebar');const n=h.querySelector('.tb-name');return {name:n.textContent,title:n.title,height:h.getBoundingClientRect().height,ellipsis:getComputedStyle(n).textOverflow,clipped:n.scrollWidth>n.clientWidth,fields:[...h.querySelectorAll('.tb-choice')].map(e=>({height:e.getBoundingClientRect().height,right:e.getBoundingClientRect().right,drag:getComputedStyle(e).webkitAppRegion})),right:h.getBoundingClientRect().right,width:innerWidth}})()`)
      assert.equal(fullTitle.name, longTitle)
      assert.ok(fullTitle.title.includes(longTitle), 'full name remains in hover title')
      assert.equal(fullTitle.height, 40)
      assert.equal(fullTitle.ellipsis, 'ellipsis')
      assert.equal(fullTitle.clipped, true)
      assert.ok(fullTitle.fields.every(f=>f.height===28&&f.right<=fullTitle.width-140&&f.drag==='no-drag'), JSON.stringify(fullTitle))
      assert.ok(fullTitle.right <= fullTitle.width)
      const anchors = await evaluate(`Array.from(document.querySelectorAll('.tb-choice')).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))`)
      await evaluate(`window.spi.sendPrompt(${JSON.stringify(currentId)},'/spi-title short','normal')`)
      await waitFor(()=>evaluate(`document.querySelector('.tb-name').textContent==='short'`),'short title applied')
      assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.tb-choice')).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))`), anchors, 'header choices must not move when summary length changes')
      await evaluate(`window.spi.sendPrompt(${JSON.stringify(currentId)},${JSON.stringify('/spi-title ' + longTitle)},'normal')`)
      await waitFor(()=>evaluate(`document.querySelector('.tb-name').textContent===${JSON.stringify(longTitle)}`),'long title restored')
      const titleCapture = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(artifacts, `titlebar-${width}.png`), Buffer.from(titleCapture.data, 'base64'))
    }
    await app.send('Emulation.clearDeviceMetricsOverride')
    await evaluate(`window.spi.sendPrompt(${JSON.stringify(currentId)},'/spi-title','normal')`)
    await waitFor(() => evaluate(`document.querySelector('.tb-name').textContent.startsWith('新会话')`), 'unnamed empty session fallback')
    pass('single-line title ellipsizes while fixed-width selectors stay right-aligned across summary changes')
    {
      const rect = await evaluate(`(()=>{const r=document.querySelector('select[title="标题栏许可"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...rect })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...rect })
      await press('ArrowDown', 40); await press('Enter', 13)
      await waitFor(() => evaluate(`document.querySelector('select[data-control="permission"]').value==='remember'&&document.querySelector('.tb-permission').textContent==='许可：首次询问 · 会话记忆'`), 'clickable header permission menu')
      await evaluate(`(()=>{const s=document.querySelector('select[title="标题栏许可"]');s.value='ask';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.input-bar textarea').focus()})()`)
      await waitFor(async () => (await snapshot()).sessions[currentId].mode === 'ask', 'restore permission mode')
      pass('header buttons open native menus; permission changes synchronize with bottom control')
    }
    {
      const one = await taMetrics()
      assert.equal(one.height, one.line + one.extras)
      await fill(app, Array.from({length:12},(_,i)=>'sPi line '+i).join('\n'))
      let m = await taMetrics()
      assert.equal(m.height, m.line*8+m.extras); assert.equal(m.overflow,'auto'); assert.ok(m.scroll>m.client)
      const capture = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(artifacts, 'input-eight-lines.png'), Buffer.from(capture.data, 'base64'))
      await fill(app, 'one\ntwo\nthree')
      m = await taMetrics(); assert.equal(m.height,m.line*3+m.extras); assert.equal(m.overflow,'hidden')
      await fill(app, '测试输入'.repeat(25))
      const wide = await taMetrics(); assert.ok(wide.height>one.height)
      await app.send('Emulation.setDeviceMetricsOverride', { width:900,height:640,deviceScaleFactor:1,mobile:false })
      await waitFor(async()=> (await taMetrics()).height>wide.height, 'textarea recalculates wrapped lines on resize')
      m=await taMetrics(); assert.ok(m.height<=m.line*8+m.extras)
      await app.send('Emulation.clearDeviceMetricsOverride')
      await fill(app,'')
      m=await taMetrics(); assert.equal(m.height,one.height); assert.equal(m.overflow,'hidden')
      pass('composer shares one row; textarea grows for wrapping/newlines, caps at 8 rows and shrinks after deletion')
    }
    {
    const iconStyles = await evaluate(`Array.from(document.querySelectorAll('.input-options select')).map(s=>({label:s.getAttribute('aria-label'),width:s.getBoundingClientRect().width,indent:getComputedStyle(s).textIndent,optionFont:getComputedStyle(s.options[0]).fontSize}))`)
    assert.ok(iconStyles.every(s => s.label && s.width === 34 && parseFloat(s.indent) < -1000 && parseFloat(s.optionFont) >= 12), JSON.stringify(iconStyles))
    const modelRect = await evaluate(`(()=>{const r=document.querySelector('select[title="发送方式"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...modelRect })
    if(!await evaluate(`document.querySelector('[role="tooltip"]')?.textContent.includes('普通发送')`)) await evaluate(`document.querySelector('select[title="发送方式"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:null}))`)
    await waitFor(() => evaluate(`document.querySelector('[role="tooltip"]')?.textContent.includes('普通发送')`), 'hover reveals delivery mode')
    let capture = await app.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(artifacts, 'icons-hover.png'), Buffer.from(capture.data, 'base64'))
    await evaluate(`document.querySelector('select[title="发送方式"]').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`)
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 500, y: 200 })
    await waitFor(() => evaluate(`!document.querySelector('[role="tooltip"]')`), 'hover tooltip hides on leave')
    const sendRect = await evaluate(`(()=>{const r=document.querySelector('select[title="发送方式"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...sendRect })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...sendRect })
    capture = await app.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(artifacts, 'icons-menu.png'), Buffer.from(capture.data, 'base64'))
    for (const [key, code] of [['ArrowDown', 40], ['Enter', 13]]) {
      await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
    }
    await waitFor(() => evaluate(`document.querySelector('select[title="发送方式"]').value==='steer'`), 'native menu selects steering by keyboard')
    await evaluate(`(()=>{const s=document.querySelector('select[title="发送方式"]');s.value='normal';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.input-bar textarea').focus()})()`)
    pass('icon-only controls expose current values on hover and retain readable native menus / keyboard selection')
    }

    const deniedFile = path.join(workspace, 'must-not-exist')
    let n = await start('bash', { command: `printf denied > ${sh(deniedFile)}` })
    await pending()
    await waitFor(() => evaluate(`!!document.querySelector('.permission-request')`), 'approval card rendered')
    await waitFor(async()=>{const m=await taMetrics();return !m.value&&m.height===m.line+m.extras}, 'successful send resets textarea to one line')
    assert.ok(await evaluate(`document.querySelector('.tb-name').textContent.startsWith('{"tool":"bash"')`), 'unnamed session uses first user message summary')
    await waitFor(() => evaluate(`document.querySelector('.tb-status').textContent==='等待审批'`), 'header waiting status')
    for (const [width, height] of [[1280, 800], [900, 640]]) {
      await app.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      const layout = await composerLayout()
      assert.ok(layout.sameRow && layout.inline && layout.noTopBar, JSON.stringify(layout))
      const geometry = await evaluate(`(()=>{const r=document.querySelector('.permission-request').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}})()`)
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.width, JSON.stringify(geometry))
      const capture = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(artifacts, `approval-${width}.png`), Buffer.from(capture.data, 'base64'))
    }
    await app.send('Emulation.clearDeviceMetricsOverride')
    await new Promise(r => setTimeout(r, 200))
    assert.equal(fs.existsSync(deniedFile), false, 'command must wait BEFORE execution')
    await evaluate(`document.querySelector('.permission-request button').click()`)
    await settled(n)
    assert.equal(fs.existsSync(deniedFile), false)
    pass('approval happens before execution; UI refusal prevents shell side effect')

    currentId = await require('./session-dedup-smoke.cjs')({ app, waitFor, pass, fill, workspace, currentId })

    {
      const ownPath=await evaluate(`window.spi.getState(${JSON.stringify(currentId)}).then(s=>s.sessionFile)`)
      assert.ok(ownPath)
      const tabs=await evaluate(`document.querySelectorAll('.session-tab').length`)
      await evaluate(`document.querySelector('.sidebar-mode-toggle button[aria-label="近期"]').click()`)
      await waitFor(()=>evaluate(`document.querySelector('.sidebar-mode-toggle button[aria-label="近期"]').getAttribute('aria-pressed')==='true'&&Array.from(document.querySelectorAll('.recent-list .session-item')).some(e=>e.dataset.sessionPath===${JSON.stringify(ownPath)})`),'recent view contains only-targeted test session')
      await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('.recent-list .session-item')).find(e=>e.dataset.sessionPath===${JSON.stringify(ownPath)});e.dataset.sidebarTest='owned'})()`)
      const pinSelector='.recent-list .session-item[data-sidebar-test="owned"] .pin-btn'
      await hoverTip(pinSelector,'置顶会话')
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(pinSelector)}).textContent.trim()`),'')
      await evaluate(`document.querySelector(${JSON.stringify(pinSelector)}).click()`)
      // Pinning reorders the item; retarget using its immutable session path, never another user's row.
      await waitFor(()=>evaluate(`Array.from(document.querySelectorAll('.recent-list .session-item')).some(e=>e.dataset.sessionPath===${JSON.stringify(ownPath)}&&e.querySelector('.pin-btn').getAttribute('aria-pressed')==='true')`),'owned session pinned')
      await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('.recent-list .session-item')).find(e=>e.dataset.sessionPath===${JSON.stringify(ownPath)});e.dataset.sidebarTest='owned'})()`)
      await hoverTip(pinSelector,'取消置顶')
      assert.ok(await evaluate(`!!document.querySelector('.recent-section-label[aria-label="置顶会话"] svg')`))
      await evaluate(`document.querySelector(${JSON.stringify(pinSelector)}).click()`)
      await waitFor(()=>evaluate(`Array.from(document.querySelectorAll('.recent-list .session-item')).some(e=>e.dataset.sessionPath===${JSON.stringify(ownPath)}&&e.querySelector('.pin-btn').getAttribute('aria-pressed')==='false')`),'owned session unpinned')
      assert.equal(await evaluate(`document.querySelectorAll('.session-tab').length`),tabs,'Pinning must not open a session')
      assert.ok(!(await evaluate('window.spi.getPinned()')).includes(ownPath))
      await evaluate(`document.querySelector('.sidebar-mode-toggle button[aria-label="目录"]').click()`)
      await waitFor(()=>evaluate(`!!document.querySelector('.btn-new')&&document.querySelector('.sidebar-mode-toggle button[aria-label="目录"]').getAttribute('aria-pressed')==='true'`),'directory mode restored')
      const sidebarCapture=await app.send('Page.captureScreenshot',{format:'png'})
      fs.writeFileSync(path.join(artifacts,'sidebar-icons.png'),Buffer.from(sidebarCapture.data,'base64'))
      pass('recent navigation and pin / unpin icons work with tips without opening user sessions')
    }

    const marker = path.join(workspace, 'approved.txt')
    const command = `printf x >> ${sh(marker)}`
    n = await start('bash', { command }); await pending()
    await evaluate(`(()=>{const d=document.querySelector('.permission-request');[...d.querySelectorAll('button')].find(b=>b.textContent==='单次允许').click()})()`)
    await settled(n)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'x')
    n = await start('bash', { command }); await pending(); await answer('deny'); await settled(n)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'x')
    pass('single approval runs once and repeated identical command asks again')

    n = await start('bash', { command }); await answer('session'); await settled(n)
    n = await start('bash', { command }); await settled(n)
    assert.equal((await snapshot()).pending.length, 0)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'xxx')
    const a = currentId
    await toggleRules()
    await waitFor(() => evaluate(`!!document.querySelector('.permission-settings')`), 'A settings opened')
    await fill(app,Array.from({length:12},(_,i)=>'A draft '+i).join('\n'))
    await evaluate(`document.querySelector('.btn-new').click()`)
    await waitFor(async () => Object.keys((await snapshot()).sessions).length === 2, 'peer session')
    currentId = Object.keys((await snapshot()).sessions).find(id => id !== a)
    await selectFixture()
    let draftMetrics=await taMetrics(); assert.equal(draftMetrics.height,draftMetrics.line+draftMetrics.extras)
    assert.equal(await evaluate(`document.querySelector('select[data-control="permission"]').value`), 'ask')
    assert.equal(await evaluate(`!!document.querySelector('.permission-settings')`), false, 'settings from A must not leak into B')
    await evaluate(`document.querySelectorAll('.session-tab')[0].click()`)
    await waitFor(() => evaluate(`document.querySelector('select[data-control="permission"]').value==='remember'&&document.querySelector('.tb-permission').textContent==='许可：首次询问 · 会话记忆'`), 'A permission mode restored in title')
    draftMetrics=await taMetrics(); assert.equal(draftMetrics.height,draftMetrics.line*8+draftMetrics.extras)
    await evaluate(`document.querySelectorAll('.session-tab')[1].click()`)
    await waitFor(() => evaluate(`document.querySelector('select[data-control="permission"]').value==='ask'&&document.querySelector('.tb-permission').textContent==='许可：每次询问'`), 'B permission mode restored in title')
    assert.equal((await composerLayout()).session, currentId)
    n = await start('bash', { command }); await answer('deny'); await settled(n)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'xxx')
    pass('session memory and selector modes stay isolated across tab switches')

    n = await start('write', { path: path.join(workspace, 'write-denied.txt'), content: 'secret' })
    await pending(); await answer('deny'); await settled(n)
    assert.equal(fs.existsSync(path.join(workspace, 'write-denied.txt')), false)
    pass('non-shell write tool is also gated before changing files')

    await mode('allowlist')
    await toggleRules()
    await evaluate(`(()=>{const t=document.querySelector('.permission-command');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(command)});t.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await evaluate(`document.querySelector('.permission-settings form').requestSubmit()`)
    await waitFor(async () => (await snapshot()).rules.length === 1, 'UI add whitelist')
    await toggleRules()
    n = await start('bash', { command }); await settled(n)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'xxxx')
    n = await start('bash', { command: command + '; printf changed' }); await answer('deny'); await settled(n)
    pass('UI-managed exact whitelist allows matching command, not shell suffix')

    await mode('ask')
    n = await start('bash', { command }); await answer('deny'); await settled(n)
    pass('every-time mode ignores an existing whitelist')

    const cancelFile = path.join(workspace, 'cancelled.txt')
    n = await start('bash', { command: `printf cancelled > ${sh(cancelFile)}` })
    const stale = await pending()
    await evaluate(`window.spi.sendPrompt(${JSON.stringify(currentId)},'SPI_QUEUE_RESTORE','followUp')`)
    await fill(app, 'SPI_UNSENT_PERMISSION_DRAFT')
    await evaluate(`(()=>{const d=document.querySelector('.permission-request');[...d.querySelectorAll('button')].find(b=>b.textContent==='停止该会话').click()})()`)
    await settled(n)
    await waitFor(() => evaluate(`document.querySelector('.input-bar textarea').value.includes('SPI_QUEUE_RESTORE')`), 'permission stop restores queued draft')
    assert.ok(await evaluate(`document.querySelector('.input-bar textarea').value.includes('SPI_UNSENT_PERMISSION_DRAFT')`))
    assert.equal((await snapshot()).pending.length, 0)
    assert.equal(fs.existsSync(cancelFile), false)
    const staleResult = await evaluate(`window.spi.answerPermission(${JSON.stringify(currentId)},${JSON.stringify(stale.id)},'once').then(()=>false,()=>true)`)
    assert.equal(staleResult, true)
    pass('UI stop cancels pending approval, restores queued draft and rejects late approval')

    await app.send('Page.enable')
    async function selectAll(accept) {
      const opening = new Promise((resolve, reject) => {
        const listener = event => {
          const msg = JSON.parse(event.data)
          if (msg.method === 'Page.javascriptDialogOpening') {
            clearTimeout(timer); app.ws.removeEventListener('message', listener); resolve(msg.params)
          }
        }
        const timer = setTimeout(() => { app.ws.removeEventListener('message', listener); reject(new Error('permission confirmation missing')) }, 5000)
        app.ws.addEventListener('message', listener)
      })
      const change = evaluate(`(()=>{const s=document.querySelector('select[title="标题栏许可"]');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
      const dialog = await opening
      assert.ok(dialog.message.includes('全部工具调用'))
      await app.send('Page.handleJavaScriptDialog', { accept })
      await change
    }
    await selectAll(false)
    assert.equal((await snapshot()).sessions[currentId].mode, 'ask')
    await selectAll(true)
    await waitFor(async () => (await snapshot()).sessions[currentId].mode === 'all', 'confirmed all-allow')
    await waitFor(() => evaluate(`document.querySelector('.tb-permission').textContent==='许可：本会话全部允许'&&document.querySelector('.tb-permission').classList.contains('permission-warning')`), 'header all-allow warning')
    n = await start('bash', { command }); await settled(n)
    assert.equal((await snapshot()).pending.length, 0)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'xxxxx')
    assert.equal((await snapshot()).sessions[a].mode, 'remember')
    pass('all-allow is restricted to one open session')

    assert.equal(app.errors.length, 0, JSON.stringify(app.errors))
    const capture = await app.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(artifacts, 'permissions.png'), Buffer.from(capture.data, 'base64'))
    await stop(app)
    // Old releases could persist the same file more than once. Restoring must normalize it.
    const legacyConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    assert.equal(legacyConfig.layout.sessions.length, 2)
    legacyConfig.layout.sessions.push({ ...legacyConfig.layout.sessions[0] })
    fs.writeFileSync(configPath, JSON.stringify(legacyConfig))
    app = await launch()
    await waitFor(async () => {
      const s = await snapshot()
      return Object.keys(s.sessions).length === 2 && Object.values(s.sessions).every(v => v.ready) && await evaluate(`document.querySelectorAll('.session-tab').length===2`)
    }, 'both restored')
    await waitFor(() => evaluate('window.spi.loadLayout().then(s=>s.sessions.length===2)'), 'legacy duplicate layout normalized')
    pass('duplicate legacy layout entries restore one tab/process per session file and save a clean layout')
    s = await snapshot()
    assert.ok(Object.values(s.sessions).every(v => v.mode === 'ask' && v.remembered === 0 && v.ready))
    assert.equal(s.rules.length, 1)
    currentId = Object.keys(s.sessions)[1]
    // Resumed history restores the fixture model, without any default-provider config edits.
    await evaluate(`document.querySelectorAll('.session-tab')[1].click()`)
    await mode('allowlist')
    n = await start('bash', { command }); await settled(n)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'xxxxxx')
    pass('restart preserves sPi whitelist but discards session grants and all-allow')
    assert.deepEqual(hashes(), before)
    assert.equal(app.errors.length, 0, JSON.stringify(app.errors))
    pass('pi settings remain unchanged; no renderer exceptions', { localModelRequests: requests })

    const ids = Object.keys(s.sessions)
    await Promise.all(ids.map(id => evaluate(`window.spi.setPermissionMode(${JSON.stringify(id)},'ask')`)))
    const concurrentInput = { command: 'printf SPI_CONCURRENT' }
    await Promise.all(ids.map(id => evaluate(`window.spi.sendPrompt(${JSON.stringify(id)},${JSON.stringify(JSON.stringify({ tool: 'bash', input: concurrentInput }))},'normal')`)))
    await waitFor(async () => (await snapshot()).pending.length === 2, 'two concurrent approvals')
    await waitFor(() => evaluate(`document.querySelectorAll('.permission-request').length===2`), 'both approval cards visible')
    assert.ok(await evaluate(`document.querySelector('.permission-requests').textContent.includes('后台会话')`))
    for (const [i, req] of (await snapshot()).pending.entries()) {
      await evaluate(`window.spi.answerPermission(${JSON.stringify(req.sessionId)},${JSON.stringify(req.id)},${JSON.stringify(i ? 'deny' : 'once')})`)
    }
    await waitFor(async () => {
      const states = await Promise.all(ids.map(id => evaluate(`window.spi.getState(${JSON.stringify(id)})`)))
      return states.every(v => !v.isStreaming)
    }, 'concurrent approvals settled')
    pass('parallel approvals remain individually addressable, including background sessions')

    // Simulate an installed pi that silently ignores --extension: never expose an unprotected session.
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${sh(pi)} --mode rpc --no-extensions --extension ${sh(fixture)}\n`, { mode: 0o700 })
    const failedOpen = await evaluate(`window.spi.openSession({cwd:${JSON.stringify(workspace)}}).then(()=>({unexpected:true}),e=>({error:String(e)}))`)
    assert.ok(failedOpen.error?.includes('权限扩展未就绪'), JSON.stringify(failedOpen))
    assert.equal(Object.keys((await snapshot()).sessions).length, 2)
    assert.deepEqual(hashes(), before)
    assert.deepEqual(modelErrors, [], 'Unexpected queued/model requests')
    pass('missing extension handshake fails closed instead of opening an unprotected session')
  } catch (error) {
    if (app && !app.exited) {
      try {
        fs.writeFileSync(path.join(artifacts, 'permission-failure.json'), JSON.stringify(await evaluate(`(async()=>({permissions:await window.spi.getPermissions(),events:window.__smokeEvents,body:document.body.innerText}))()`), null, 2))
      } catch {}
    }
    throw error
  } finally {
    await stop(app)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
