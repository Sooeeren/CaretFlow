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
}
