// Stress the real sidebar layout with DOM-only rows; never create/open user sessions.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function ({ app, waitFor, pass, artifacts }) {
  const evaluate = (fn, arg) => app.eval(`(${fn.toString()})(${JSON.stringify(arg)})`)
  const removeRows = () => evaluate(() => document.querySelectorAll('[data-sidebar-fixture]').forEach(e => e.remove()))
  const populate = counts => evaluate(([dirs, sessions]) => {
    document.querySelectorAll('[data-sidebar-fixture]').forEach(e => e.remove())
    const tree = document.querySelector('.dir-tree')
    const list = document.querySelector('.session-list')
    for (const [parent, count, isDir] of [[tree, dirs, true], [list, sessions, false]]) {
      const fragment = document.createDocumentFragment()
      for (let i = 0; i < count; i++) {
        const row = document.createElement('div')
        row.dataset.sidebarFixture = 'true'
        row.className = isDir ? 'tree-node' : 'session-item'
        const title = document.createElement('span')
        title.className = isDir ? 'tree-name' : 'session-item-title'
        title.textContent = `${isDir ? 'directory' : 'session'}-${String(i).padStart(3, '0')}-${'long-name-'.repeat(15)}`
        row.append(title)
        if (!isDir) {
          title.style.display = 'block'
          const meta = document.createElement('div')
          meta.className = 'session-item-meta'
          meta.textContent = '2026-11-09 12:00'
          row.append(meta)
        }
        fragment.append(row)
      }
      parent.append(fragment)
      parent.closest('.sidebar-section').scrollTop = 0
    }
  }, counts)
  const metrics = () => evaluate(() => {
    const rect = e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height } }
    const pane = e => ({ ...rect(e), scroll: e.scrollHeight, client: e.clientHeight, topScroll: e.scrollTop, overflow: getComputedStyle(e).overflowY })
    const sidebar = document.querySelector('.sidebar')
    const dir = document.querySelector('.dir-tree').closest('.sidebar-section')
    const sessions = document.querySelector('.session-pane')
    return { sidebar: pane(sidebar), toggle: rect(document.querySelector('.sidebar-mode-toggle')), dir: pane(dir), sessions: pane(sessions), header: rect(document.querySelector('.session-list-header')), newButton: rect(document.querySelector('.btn-new')), innerOverflow: getComputedStyle(document.querySelector('.session-list')).overflowY }
  })
  try {
    for (const [width, height] of [[1280, 800], [900, 640], [900, 420]]) {
      await app.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      let anchor
      for (const counts of [[0, 0], [300, 0], [0, 300], [300, 300]]) {
        await populate(counts)
        const m = await metrics()
        assert.ok(Math.abs(m.dir.height - m.sessions.height) <= 2, 'directory/session must split 50/50: ' + JSON.stringify(m))
        assert.ok(m.dir.height > 100 && m.sessions.bottom <= m.sidebar.bottom + 1, JSON.stringify(m))
        assert.ok(m.sidebar.scroll <= m.sidebar.client + 1, 'sidebar itself must not overflow')
        assert.equal(m.dir.overflow, 'auto'); assert.equal(m.sessions.overflow, 'auto')
        assert.equal(m.innerOverflow, 'visible', 'session list must not create a nested scrollbar')
        if (anchor) assert.ok(Math.abs(anchor - m.dir.height) < 1, 'row count must not move divider')
        anchor = m.dir.height
        if (counts[0]) assert.ok(m.dir.scroll > m.dir.client)
        if (counts[1]) assert.ok(m.sessions.scroll > m.sessions.client)
      }
      await evaluate(() => {
        document.querySelector('.dir-tree').closest('.sidebar-section').scrollTop = 35
        document.querySelector('.session-pane').scrollTop = 70
      })
      let m = await metrics()
      assert.equal(m.dir.topScroll, 35); assert.equal(m.sessions.topScroll, 70)
      await evaluate(() => {
        const dir = document.querySelector('.dir-tree').closest('.sidebar-section')
        dir.scrollTop = dir.scrollHeight
      })
      m = await metrics()
      assert.equal(m.sessions.topScroll, 70, 'directory scrolling must not scroll sessions')
      await evaluate(() => { const pane = document.querySelector('.session-pane'); pane.scrollTop = pane.scrollHeight })
      m = await metrics()
      assert.ok(m.newButton.top >= m.sessions.top && m.newButton.bottom <= m.sessions.bottom, 'new session button stays visible')
      assert.ok(Math.abs(m.header.top - m.sessions.top) <= 2, 'session header stays sticky')
      const ends = await evaluate(() => ['.dir-tree', '.session-list'].map(selector => {
        const root = document.querySelector(selector), pane = root.closest('.sidebar-section').getBoundingClientRect()
        const last = root.querySelector('[data-sidebar-fixture]:last-child').getBoundingClientRect()
        return last.top >= pane.top && last.bottom <= pane.bottom + 1
      }))
      assert.ok(ends.every(Boolean), 'last row in each pane must be reachable')
      const capture = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(artifacts, `sidebar-split-${width}-${height}.png`), Buffer.from(capture.data, 'base64'))
    }
    pass('sidebar directory/session split stays 50/50 with independent scrollbars, long lists and short windows')
    await removeRows()
    await evaluate(() => document.querySelector('.sidebar-mode-toggle button[aria-label="近期"]').click())
    await waitFor(() => app.eval(`!!document.querySelector('.recent-list')`), 'recent view for sidebar layout')
    const recent = await evaluate(() => {
      const list = document.querySelector('.recent-list')
      for (let i = 0; i < 300; i++) {
        const row = document.createElement('div'); row.className = 'session-item'; row.dataset.sidebarFixture = 'true'; row.textContent = 'Recent layout fixture ' + i; list.append(row)
      }
      const pane = list.closest('.sidebar-section'), sidebar = document.querySelector('.sidebar'), toggle = document.querySelector('.sidebar-mode-toggle')
      return { height: pane.getBoundingClientRect().height, available: sidebar.clientHeight - toggle.getBoundingClientRect().height, client: pane.clientHeight, scroll: pane.scrollHeight, inner: getComputedStyle(list).overflowY }
    })
    assert.ok(Math.abs(recent.height - recent.available) <= 1, JSON.stringify(recent))
    assert.ok(recent.scroll > recent.client); assert.equal(recent.inner, 'visible')
    pass('recent sessions use full remaining sidebar height and one scrollbar')
  } finally {
    await removeRows()
    await app.send('Emulation.clearDeviceMetricsOverride')
    await evaluate(() => document.querySelector('.sidebar-mode-toggle button[aria-label="目录"]').click())
    await waitFor(() => app.eval(`document.querySelectorAll('.dir-tree .tree-node').length>1&&!!document.querySelector('.btn-new')`), 'restore directory view after layout fixtures')
  }
}
