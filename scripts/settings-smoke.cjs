const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function ({ app, launch, stop, waitFor, pass, fill, artifacts, profile, descendants, hashes, before }) {
  const owned = new Map()
  const startTime = pid => { try { const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8');return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19] } catch { return null } }
  const stillOwned = pid => owned.has(pid) && startTime(pid) === owned.get(pid)
  const evaluate = expression => app.eval(expression)
  const prefs = () => evaluate('window.spi.getAppSettings()')
  const open = async () => {
    await evaluate(`document.querySelector('.app-settings-button').click()`)
    await waitFor(()=>evaluate(`document.querySelector('.app-settings-dialog')?.open`),'settings dialog open')
  }
  const close = async () => {
    await evaluate(`document.querySelector('.settings-close').click()`)
    await waitFor(()=>evaluate(`!document.querySelector('.app-settings-dialog')`),'settings dialog closed')
  }
  const set = async (key,value) => {
    await waitFor(()=>evaluate(`!document.querySelector('[data-setting="${key}"]').disabled`),'settings controls enabled')
    await evaluate(`(()=>{const e=document.querySelector('[data-setting="${key}"]');${key==='confirmOnExit' ? `e.checked=${value};` : `e.value=${JSON.stringify(value)};`}e.dispatchEvent(new Event(${JSON.stringify(key==='confirmOnExit'?'click':'change')},{bubbles:true}))})()`)
    // React checkboxes need their real click path rather than a synthetic changed checked property.
    await waitFor(async()=> (await prefs())[key]===value,'saved setting '+key)
  }
  const checkbox = async value => {
    await waitFor(()=>evaluate(`!document.querySelector('[data-setting="confirmOnExit"]').disabled`),'checkbox ready')
    await evaluate(`(()=>{const e=document.querySelector('[data-setting="confirmOnExit"]');if(e.checked!==${value})e.click()})()`)
    await waitFor(async()=> (await prefs()).confirmOnExit===value,'exit preference saved')
  }
  const capture = async name => {
    const result=await app.send('Page.captureScreenshot',{format:'png'})
    fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(result.data,'base64'))
  }
  try {
    assert.deepEqual(await prefs(),{theme:'dark',language:'en',confirmOnExit:true})
    assert.equal(await evaluate(`document.documentElement.lang`),'en')
    assert.equal(await evaluate(`document.documentElement.dataset.theme`),'dark')
    assert.ok(await evaluate(`!!document.querySelector('.sidebar-toggle svg')&&!!document.querySelector('.app-settings-button svg')`))
    const icons=await evaluate(`(()=>{const a=document.querySelector('.sidebar-toggle'),b=document.querySelector('.app-settings-button');return {a:a.getAttribute('aria-label'),b:b.getAttribute('aria-label'),text:a.textContent+b.textContent,left:b.getBoundingClientRect().left,right:document.querySelector('.tb-close-session').getBoundingClientRect().right}})()`)
    assert.equal(icons.a,'Hide sidebar'); assert.equal(icons.b,'Settings'); assert.equal(icons.text.trim(),''); assert.ok(icons.left>=icons.right)
    await evaluate(`document.querySelector('.sidebar-toggle').click()`)
    assert.equal(await evaluate(`!!document.querySelector('.sidebar')`),false)
    await evaluate(`document.querySelector('.sidebar-toggle').click()`)
    assert.equal(await evaluate(`!!document.querySelector('.sidebar')`),true)
    pass('real defaults are dark / English / confirm on; sidebar and far-right settings are icons')

    await open()
    assert.equal(await evaluate(`document.querySelector('#app-settings-title').textContent`),'Settings')
    await capture('settings-dialog-en')
    assert.ok(await evaluate(`document.querySelector('.app-settings-dialog').contains(document.activeElement)`))
    await set('language','zh')
    assert.equal(await evaluate(`document.querySelector('#app-settings-title').textContent`),'设置')
    assert.ok(await evaluate(`document.querySelector('.app-settings-content').textContent.includes('退出会中止当前打开的会话')&&document.querySelector('.app-settings-content').textContent.includes('只影响 sPi')`))
    await capture('settings-dialog-zh')
    assert.ok(await evaluate(`document.querySelector('.tb-model').textContent.startsWith('模型：')&&!!document.querySelector('.sidebar-mode-toggle button[aria-label="目录"]')`))
    await close()
    await fill(app,'SPI draft 保留内容')
    await open(); await set('language','en'); await close()
    assert.equal(await evaluate(`document.querySelector('.input-bar textarea').value`),'SPI draft 保留内容')
    assert.ok(await evaluate(`document.querySelector('.tb-model').textContent.startsWith('Model:')&&!!document.querySelector('.sidebar-mode-toggle button[aria-label="Directories"]')`))
    pass('language switches live across settings / header / sidebar / composer without changing drafts')

    await open()
    for (const type of ['keyDown','keyUp']) await app.send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    await waitFor(()=>evaluate(`!document.querySelector('.app-settings-dialog')`),'Escape closes modal')
    pass('settings dialog traps focus and closes with Escape')

    const id=Object.keys((await evaluate('window.spi.getPermissions()')).sessions)[0]
    await waitFor(()=>evaluate(`!!document.querySelector('select[title="Title bar Model"] option[value="spi-test/fixture"]')`),'fixture model in English header')
    await evaluate(`(()=>{const e=document.querySelector('select[title="Title bar Model"]');e.value='spi-test/fixture';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await waitFor(()=>evaluate(`window.spi.getState(${JSON.stringify(id)}).then(s=>s.model.provider==='spi-test')`),'fixture model selected')
    await fill(app,JSON.stringify({tool:'bash',input:{command:'printf SPI_SETTINGS_OUTPUT'}}))
    await evaluate(`document.querySelector('.btn-send').click()`)
    await waitFor(()=>evaluate(`!!document.querySelector('.permission-request')`),'English approval card')
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.permission-request button')).some(e=>e.textContent==='Allow once')`))
    await evaluate(`Array.from(document.querySelectorAll('.permission-request button')).find(e=>e.textContent==='Allow once').click()`)
    await waitFor(()=>evaluate(`window.__smokeEvents.some(e=>e.sessionId===${JSON.stringify(id)}&&e.event.type==='agent_settled')`),'fixture finished')
    assert.ok(await evaluate(`document.querySelector('.tool-output-text').textContent.includes('SPI_SETTINGS_OUTPUT')`))
    pass('English tool / approval UI remains functional with actual pi and a deterministic local model')

    for (const theme of ['dark','light','high-contrast']) {
      for (const language of ['en','zh']) {
        await open(); await set('theme',theme); await set('language',language)
        await capture(`settings-dialog-${theme}-${language}`)
        await close()
        assert.equal(await evaluate(`document.documentElement.dataset.theme`),theme)
        assert.equal(await evaluate(`document.documentElement.lang`),language==='zh'?'zh-CN':'en')
        await evaluate(`(()=>{const e=document.querySelector('select[data-control="permission"]');e.value='__settings';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
        await waitFor(()=>evaluate(`!!document.querySelector('.permission-settings')`),'localized permission panel')
        const colors=await evaluate(`(()=>{const css=e=>{const s=getComputedStyle(e);return {fg:s.color,bg:s.backgroundColor,border:s.borderColor}};return {body:css(document.body),header:css(document.querySelector('.titlebar')),input:css(document.querySelector('.input-bar textarea')),tool:css(document.querySelector('.tool-card')),permissions:css(document.querySelector('.permissions')),placeholder:getComputedStyle(document.querySelector('.input-bar textarea'),'::placeholder').color,send:css(document.querySelector('.btn-send')),panel:document.querySelector('.permission-settings').textContent}})()`)
        function lum(color) { const values=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return values[0]*.2126+values[1]*.7152+values[2]*.0722 }
        function ratio(a,b) { const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
        assert.ok(ratio(colors.body.fg,colors.body.bg)>=4.5,JSON.stringify(colors))
        assert.ok(ratio(colors.input.fg,colors.input.bg)>=4.5,JSON.stringify(colors))
        assert.ok(ratio(colors.placeholder,colors.input.bg)>=4.5,JSON.stringify(colors))
        if(theme==='light') assert.equal(colors.body.bg,'rgb(255, 255, 255)')
        if(theme==='high-contrast') { assert.equal(colors.body.fg,'rgb(255, 255, 255)');assert.equal(colors.body.bg,'rgb(0, 0, 0)');assert.ok(ratio(colors.send.fg,colors.send.bg)>=4.5,JSON.stringify(colors.send)) }
        assert.ok(colors.panel.includes(language==='en'?'sPi allowlist':'sPi 白名单'))
        assert.ok(await evaluate(`document.querySelector('.tool-output-text').textContent.includes('SPI_SETTINGS_OUTPUT')`))
        for(const [width,height] of [[1280,800],[900,640]]) {
          await app.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
          const geometry=await evaluate(`({header:document.querySelector('.titlebar').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth})`)
          assert.equal(geometry.header,40);assert.equal(geometry.overflow,false)
          await capture(`settings-${theme}-${language}-${width}`)
        }
        await app.send('Emulation.clearDeviceMetricsOverride')
        await evaluate(`document.querySelector('.permission-panel-close').click()`)
        pass(`theme/language matrix: ${theme} / ${language}, readable UI at 1280 and 900px`)
      }
    }

    await open(); await set('theme','light'); await set('language','zh'); await checkbox(false); await close()
    const expected={theme:'light',language:'zh',confirmOnExit:false}
    assert.deepEqual(await prefs(),expected)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile,'spi-settings.json'),'utf8')),expected)
    await stop(app)
    app=await launch()
    assert.deepEqual(await prefs(),expected)
    assert.equal(await evaluate(`document.documentElement.dataset.theme`),'light')
    assert.equal(await evaluate(`document.documentElement.lang`),'zh-CN')
    await open()
    assert.equal(await evaluate(`document.querySelector('[data-setting="confirmOnExit"]').checked`),false)
    await checkbox(true); await checkbox(false); await close()
    assert.deepEqual(hashes(),before)
    assert.equal(app.errors.length,0,JSON.stringify(app.errors))
    pass('theme / language / exit choice survive restart; pi settings are untouched')

    for(const pid of descendants(app.child.pid)){const started=startTime(pid);if(started)owned.set(pid,started)}
    await evaluate(`window.close()`).catch(()=>{})
    await waitFor(()=>app.exited,'quit without confirmation',15000)
    await waitFor(()=>[...owned.keys()].every(pid=>!stillOwned(pid)),'owned pi children exit on quit',15000)
    pass('confirmation disabled: actual window close exits app and its own pi without a dialog')
  } catch(error) {
    if(!app.exited) {
      try { fs.writeFileSync(path.join(artifacts,'settings-failure.json'),JSON.stringify(await evaluate(`(async()=>({settings:await window.spi.getAppSettings(),body:document.body.innerText}))()`),null,2)) } catch {}
      try { await capture('settings-failure') } catch {}
    }
    throw error
  } finally {
    await stop(app)
    for(const pid of owned.keys())if(stillOwned(pid)){try{process.kill(pid,'SIGKILL')}catch{}}
  }
}
