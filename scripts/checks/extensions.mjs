// Checks for the Extensions catalog, hiding, the Preferences tab and the 0.7.0 migration.
import { check, summary, run, stubBackend, wait } from './lib.mjs'

const CLOUD = { cloudEnabled: true, cloudProvider: 'webdav', cloudUrl: 'https://example.invalid/dav/Notes', cloudLocal: 'C:/Users/you/Documents/Notes', cloudAuto: false, cloudInterval: 0 }

/** What the UI offers right now: menu labels, palette rows, tabs, Preferences pages, shortcut list. */
async function surface(page) {
  const menu = async (label) => {
    await page.click(`#menus .menu-root > button:has-text("${label}")`)
    const items = await page.$$eval('.menu-pop .menu-item .lbl', (xs) => xs.map((x) => x.textContent))
    await page.keyboard.press('Escape')
    await page.mouse.click(700, 500)
    return items
  }
  const out = { file: await menu('File'), view: await menu('View') }
  await page.keyboard.press('Control+Shift+P')
  await page.keyboard.type('typing test')
  await wait(200)
  out.palette = await page.$$eval('#pal-list > *', (xs) => xs.map((x) => x.textContent))
  await page.keyboard.press('Escape')
  out.cloudTab = await page.$eval('#tab-cloud', (e) => !e.hidden)
  out.cloudBtn = await page.$eval('#st-cloud', (e) => !e.hidden)
  await page.keyboard.press('Shift+F1')
  await wait(200)
  out.shortcuts = await page.$eval('#modal', (m) => m.textContent)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+,')
  await wait(400)
  out.prefs = await page.$$eval('.prefs-nav button', (xs) => xs.map((x) => x.textContent))
  await page.keyboard.press('Escape')
  await wait(200)
  return out
}
const typingOpens = async (page, keys) => {
  await page.click('#wysiwyg .ProseMirror')
  await page.keyboard.press(keys)
  await wait(600)
  const open = await page.$eval('#tt', (e) => !e.hidden).catch(() => false)
  await page.keyboard.press('Escape')
  await wait(200)
  return open
}

export const scenes = {
  'ext-catalog': {
    open: 'Welcome.md',
    settings: {},
    async run(page) {
      const r = await run(page, async () => {
        const m = await import('/src/extensions.js')
        const s = { extensions: [] }
        const out = { ids: m.EXTENSIONS.map((e) => e.id), none: m.isInstalled(s, 'cloud') }
        m.setInstalled(s, 'ai', true)
        m.setInstalled(s, 'cloud', true)
        out.both = [...s.extensions]
        m.setInstalled(s, 'cloud', false)
        out.after = [...s.extensions]
        out.fields = m.EXTENSIONS.every((e) => e.name && e.icon && e.tagline && e.description && e.adds.length && e.network && e.shots.length >= 2)
        return out
      })
      check('catalog ids', JSON.stringify(r.ids) === '["cloud","typing","ai"]', JSON.stringify(r.ids ?? r.error))
      check('nothing installed', r.none === false)
      check('installed keeps catalog order', JSON.stringify(r.both) === '["cloud","ai"]', JSON.stringify(r.both))
      check('remove', JSON.stringify(r.after) === '["ai"]', JSON.stringify(r.after))
      check('every entry has texts and 2+ screenshots', r.fields === true)
      summary()
    },
  },
  'ext-hidden': {
    open: 'Welcome.md',
    settings: { ...CLOUD, extensions: [], keybindings: { 'View/Typing Test…': 'Ctrl+Alt+Y' } },
    setup: (page) => stubBackend(page, {}),
    async run(page) {
      let u = await surface(page)
      check('no Sync Now in File', !u.file.includes('Sync Now'), u.file.join('|'))
      check('no Typing Test / Cloud Files in View', !u.view.some((l) => /Typing Test|Cloud Files/.test(l)), u.view.join('|'))
      check('palette has no Typing Test', !u.palette.some((t) => t.includes('Typing Test')), u.palette.join('|'))
      check('Cloud tab and status button hidden', !u.cloudTab && !u.cloudBtn)
      check('shortcut list has no Typing Test / Sync Now', !/Typing Test|Sync Now/.test(u.shortcuts))
      check('Preferences has no Cloud Sync page', !u.prefs.includes('Cloud Sync'), u.prefs.join('|'))
      check('custom key does nothing while removed', !(await typingOpens(page, 'Control+Alt+Y')))
      check('default key does nothing while removed', !(await typingOpens(page, 'Control+Alt+T')))
      const kb = await page.evaluate(() => JSON.parse(localStorage.getItem('folio.settings')).keybindings)
      check('custom shortcut is kept', kb?.['View/Typing Test…'] === 'Ctrl+Alt+Y', JSON.stringify(kb))

      await page.evaluate(() => sessionStorage.setItem('test.override', JSON.stringify({ extensions: ['cloud', 'typing'] })))
      await page.reload()
      await page.waitForSelector('#wysiwyg .ProseMirror')
      await wait(800)
      u = await surface(page)
      check('installed: Sync Now in File', u.file.includes('Sync Now'))
      check('installed: Typing Test in View', u.view.includes('Typing Test…'))
      check('installed: Cloud tab shown', u.cloudTab && u.cloudBtn)
      check('installed: Cloud Sync page', u.prefs.includes('Cloud Sync'))
      check('installed: custom key opens the test', await typingOpens(page, 'Control+Alt+Y'))
      summary()
    },
  },
  'ext-tab': {
    open: 'Welcome.md',
    settings: { ...CLOUD, extensions: ['cloud'] },
    // a server that never answers, so a sync is still running when Cloud Sync is removed
    setup: (page) => stubBackend(page, { cloud_http: () => new Promise(() => {}), cloud_scan: () => [], secret_get: () => null }),
    async run(page) {
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      const openTab = async () => {
        await page.keyboard.press('Control+,')
        await wait(300)
        await page.click('.prefs-nav button:has-text("Extensions")')
        await wait(300)
      }
      await openTab()
      const cards = await page.$$eval('.ext-card', (cs) => cs.map((c) => ({ name: c.querySelector('.ext-name').textContent, btn: c.querySelector('button.ext-act').textContent })))
      check('three cards', cards.length === 3, JSON.stringify(cards))
      check('Cloud Sync shows Remove, others Install', cards[0]?.btn === 'Remove' && cards[1]?.btn === 'Install' && cards[2]?.btn === 'Install', JSON.stringify(cards))
      await page.click('.ext-card:nth-child(1) .ext-name')
      await wait(300)
      const detail = await page.evaluate(() => ({ imgs: document.querySelectorAll('.ext-dots button').length, back: !!document.querySelector('.ext-back'), net: document.querySelector('.ext-net')?.textContent || '' }))
      check('detail view: screenshots, back button, network line', detail.imgs >= 2 && detail.back && /server/.test(detail.net), JSON.stringify(detail))
      await page.click('.ext-back')
      await wait(200)
      await page.click('.ext-card:nth-child(2) button.ext-act')
      await wait(400)
      const typing = await page.evaluate(() => ({ ext: JSON.parse(localStorage.getItem('folio.settings')).extensions, btn: document.querySelector('.ext-card:nth-child(2) button.ext-act')?.textContent }))
      check('install Typing Test', typing.ext.includes('typing') && typing.btn === 'Remove', JSON.stringify(typing))
      await page.keyboard.press('Escape')
      await wait(200)
      await page.click('#menus .menu-root > button:has-text("View")')
      const view = await page.$$eval('.menu-pop .menu-item .lbl', (xs) => xs.map((x) => x.textContent))
      await page.mouse.click(700, 500)
      check('Typing Test in View right after install', view.includes('Typing Test…'))

      // remove Cloud Sync while a sync is running
      page.evaluate(() => import('/src/cloud.js').then((m) => m.sync())).catch(() => {}) // never finishes
      await wait(300)
      await openTab()
      await page.click('.ext-card:nth-child(1) button.ext-act')
      await wait(300)
      const confirm = await page.$eval('#modal h3', (h) => h.textContent).catch(() => '')
      check('removing active Cloud Sync asks first', /Remove Cloud Sync/.test(confirm), confirm)
      await page.click('#modal button:has-text("Remove")')
      await wait(500)
      const after = await page.evaluate(() => ({ ext: JSON.parse(localStorage.getItem('folio.settings')).extensions, tab: !document.querySelector('#tab-cloud').hidden, btn: !document.querySelector('#st-cloud').hidden }))
      check('Cloud Sync removed mid-sync: gone, no errors', !after.ext.includes('cloud') && !after.tab && !after.btn && !errors.length, JSON.stringify({ ...after, errors }))
      summary()
    },
  },
  'ext-update': {
    open: 'Welcome.md',
    // settings saved by 0.7.0: no `extensions` key yet
    settings: { cloudEnabled: true, cloudUrl: 'https://example.invalid/dav/Notes', cloudLocal: 'C:/Notes', cloudAuto: false },
    setup: (page) => stubBackend(page, { secret_get: () => null }),
    async run(page) {
      const st = await page.evaluate(() => JSON.parse(localStorage.getItem('folio.settings')))
      const notice = await page.$eval('#notice', (n) => (n.hidden ? '' : n.textContent))
      check('update keeps Cloud Sync installed (it was on)', JSON.stringify(st.extensions) === '["cloud"]', JSON.stringify(st.extensions))
      check('one-time notice', /Settings → Extensions/.test(notice) && st.extNoticeSeen === true, notice)
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('folio.settings'))
        sessionStorage.setItem('test.override', JSON.stringify(s))
      })
      await page.reload()
      await page.waitForSelector('#wysiwyg .ProseMirror')
      await wait(800)
      const again = await page.$eval('#notice', (n) => (n.hidden ? '' : n.textContent))
      check('notice shows only once', !/Extensions/.test(again), again)
      summary()
    },
  },
  'ext-fresh': {
    open: 'Welcome.md',
    settings: {},
    // a first start: no saved settings at all
    setup: (page) => page.addInitScript(() => localStorage.removeItem('folio.settings')),
    async run(page) {
      await wait(500)
      const st = await page.evaluate(() => JSON.parse(localStorage.getItem('folio.settings') || '{}'))
      const notice = await page.$eval('#notice', (n) => (n.hidden ? '' : n.textContent))
      check('fresh install: nothing installed', JSON.stringify(st.extensions || []) === '[]', JSON.stringify(st.extensions))
      check('fresh install: no notice', !/Extensions/.test(notice), notice)
      summary()
    },
  },
}
