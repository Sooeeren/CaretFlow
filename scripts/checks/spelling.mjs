// Checks for the spelling checker's languages and word lists (writing.js, languages.js,
// spell-core.js, ltlocal.js): Harper skips other languages and offers a dictionary, a downloaded
// Hunspell dictionary checks them, custom words reach Harper's suggestions, word case follows Word,
// folder and front matter word lists, "Ignore All" kept per file, LanguageTool server presets and
// Premium, and the Advanced Grammar extension feeding the checker from its local server.
// The dictionary download really fetches German from cdn.jsdelivr.net.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, summary, run, stubBackend, wait } from './lib.mjs'

const DIR = 'C:\\Users\\you\\Documents\\Notes'
const DOC = DIR + '\\Sprachen.md'
const WORDS = DIR + '\\.caretflow-words'
const demo = join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'demo')
const TEXT = `---
title: Languages
spellcheck-words: [Quuxly]
---

# Spelling test

CaretFlow is a Markdown editor and Quuxly comes from the front matter. Flurbo comes from the folder list. The Zorblat project is in the dictionary, but zorblat in lowercase is not.

Heute schreiben wir einen Text auf Deutsch, und die Rechtschreibprüfnug soll ihn mit dem deutschen Wörterbuch prüfen. Das ist ein Test für die Erkennung der Sprache.

Our writers use Typroa every day, and they like it a lot.
`

const saved = new Map() // saveTo path -> bytes
const writes = []
const backend = {
  initial_path: () => DOC,
  exists: ({ path }) => path === DOC || path === WORDS || existsSync(join(demo, path.split('\\').pop())),
  read_text: ({ path }) => (path === DOC ? TEXT : path === WORDS ? '# words for this folder\nFlurbo\n' : readFileSync(join(demo, path.split('\\').pop()), 'utf8')),
  write_text: (a) => void writes.push(a),
  data_dir: ({ sub }) => 'C:\\Data\\' + sub,
  secret_get: () => null,
  cloud_http: async ({ req }) => {
    const res = await fetch(req.url)
    saved.set(req.saveTo, Buffer.from(await res.arrayBuffer()))
    return { status: res.status, headers: [], body: '' }
  },
  read_bytes: ({ path }) => [...(saved.get(path) || [])],
}

/** Underlined words in the editor. */
const marked = (page) => run(page, () => [...document.querySelectorAll('#wysiwyg .wc-err')].map((x) => x.textContent))
const settings = (page) => run(page, () => JSON.parse(localStorage.getItem('folio.settings') || '{}'))
async function menuFor(page, word) {
  const box = await page.locator('#wysiwyg .wc-err', { hasText: word }).first().boundingBox()
  if (!box) return []
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await wait(300)
  return page.$$eval('#ctxmenu:not([hidden]) .menu-item .lbl', (xs) => xs.map((x) => x.textContent))
}

export const scenes = {
  'spell-languages': {
    open: 'Draft.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: true, wcDictionary: ['Zorblat', 'Typora'] },
    async setup(page) {
      await stubBackend(page, backend)
    },
    async run(page) {
      await page.waitForSelector('#wysiwyg .wc-err', { timeout: 30000 }).catch(() => {})
      await wait(1500)
      let words = await marked(page)
      check('German paragraph left alone before a dictionary', !words.some((w) => /Heute|Rechtschreib|Wörterbuch|deutschen/.test(w)), words.join('|'))
      check('front matter spellcheck-words (Quuxly)', !words.includes('Quuxly'), words.join('|'))
      check('folder word list (Flurbo)', !words.includes('Flurbo'), words.join('|'))
      check('dictionary word with capitals accepted as written (Zorblat)', !words.includes('Zorblat'), words.join('|'))
      check('…but not in lowercase (zorblat)', words.includes('zorblat'), words.join('|'))
      const offer = await run(page, () => document.querySelector('.wc-offer')?.textContent || '')
      check('offers German spelling', /German/.test(offer) && /MB/.test(offer), offer)

      const typo = await menuFor(page, 'Typroa')
      check('Harper suggests a dictionary word (Typroa → Typora)', typo.includes('Typora'), typo.join('|'))
      await page.keyboard.press('Escape')

      const z = await menuFor(page, 'zorblat')
      check('Add to Folder Word List in the menu', z.includes('Add to Folder Word List'), z.join('|'))
      await page.click('#ctxmenu .menu-item:has-text("Ignore All")')
      await wait(500)
      const st = await settings(page)
      check('Ignore All kept for the file', (st.wcIgnored?.[DOC.toLowerCase()] || []).some((k) => k.endsWith('|zorblat')), JSON.stringify(st.wcIgnored))

      await page.click('.wc-offer .wc-offer-yes')
      await page.waitForFunction(() => !document.querySelector('.wc-offer'), null, { timeout: 60000 }).catch(() => {})
      check('German dictionary installed', (await settings(page)).wcDicts?.includes('de'), JSON.stringify((await settings(page)).wcDicts))
      await page.waitForSelector('#wysiwyg .wc-err:has-text("Rechtschreibprüfnug")', { timeout: 30000 }).catch(() => {})
      words = await marked(page)
      const german = words.filter((w) => /[äöüß]|Heute|schreib|Text|Deutsch|prüf|Sprache|Erkennung|Wörter/.test(w))
      check('Hunspell marks the German typo, and only that', german.length === 1 && german[0] === 'Rechtschreibprüfnug', german.join('|'))
      const de = await menuFor(page, 'Rechtschreibprüfnug')
      check('…with the right suggestion', de.includes('Rechtschreibprüfung'), de.join('|'))
      await page.keyboard.press('Escape')
      const foot = await run(page, async () => {
        document.querySelector('#st-wc').click()
        await new Promise((r) => setTimeout(r, 400))
        return document.querySelector('#wc-panel .wc-foot')?.textContent || ''
      })
      check('review panel names the dictionary', /German/.test(foot), foot)
      summary()
    },
  },
  'spell-lt-prefs': {
    open: 'Welcome.md',
    settings: { theme: 'paper', spellcheck: true, wcEngine: 'languagetool', ltServer: 'http://localhost:8081' },
    async setup(page) {
      await stubBackend(page, { secret_get: () => null, secret_set: () => null })
      // nothing listens on 8081 in the test: answer like a LanguageTool server
      await page.route('http://localhost:8081/**', (r) => r.fulfill({ json: { matches: [] } }))
    },
    async run(page) {
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Writing")')
      await wait(300)
      const rows = await page.$$eval('.pref-row:not([hidden]) > label', (xs) => xs.map((x) => x.firstChild.textContent.trim()))
      check('server choice shows Docker preset', await page.locator('.pref-row:has-text("LanguageTool server") >> text=Docker').count(), rows.join('|'))
      check('no Advanced Grammar choice without the extension', !(await page.locator('.pref-row:has-text("LanguageTool server") >> text=Advanced Grammar').count()))
      check('Premium username and key rows', rows.includes('Premium username') && rows.includes('Premium API key'), rows.join('|'))
      check('custom address hidden for a preset', !rows.includes('Server address'), rows.join('|'))
      check('Other languages list', (await page.locator('.wc-lang').count()) >= 15)
      summary()
    },
  },
  'spell-ltlocal': {
    open: 'Draft.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: true, extensions: ['ltlocal'], wcEngine: 'languagetool', ltServer: 'local' },
    async setup(page) {
      const status = { installed: true, running: null, ngrams: ['de'], busy: null, bytes: 2.1e9, dir: 'C:\\Data\\languagetool' }
      await stubBackend(page, {
        lt_status: () => status,
        lt_start: async () => {
          await wait(600)
          status.running = 8299
          return 8299
        },
        lt_stop: () => void (status.running = null),
        secret_get: () => null,
      })
      await page.route('http://127.0.0.1:8299/v2/check', (r) => {
        const text = new URLSearchParams(r.request().postData()).get('text') || ''
        const at = text.indexOf('should of')
        r.fulfill({
          json: {
            matches:
              at < 0
                ? []
                : [{ offset: at, length: 9, message: 'Did you mean “should have”?', replacements: [{ value: 'should have' }], rule: { id: 'SHOULD_OF', issueType: 'grammar', category: { name: 'Grammar' } } }],
          },
        })
      })
    },
    async run(page) {
      await page.waitForSelector('#wysiwyg .wc-err:has-text("should of")', { timeout: 20000 }).catch(() => {})
      const words = await marked(page)
      check('local LanguageTool finds the grammar error', words.includes('should of'), words.join('|'))
      const foot = await run(page, async () => {
        document.querySelector('#st-wc').click()
        await new Promise((r) => setTimeout(r, 400))
        return document.querySelector('#wc-panel .wc-foot')?.textContent || ''
      })
      check('review panel: LanguageTool on this computer', /on this computer/.test(foot), foot)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Advanced Grammar")')
      await wait(800)
      const state = await run(page, () => document.querySelector('.lt-state')?.textContent || '')
      check('Preferences → Advanced Grammar shows it running', /Running on this computer/.test(state), state)
      check('n-gram list marks German installed', await page.locator('.wc-lang.on:has-text("German")').count(), '')
      summary()
    },
  },
  // callout markers ([!WARNING]…) and [TOC] are syntax: never underlined, in either view
  'spell-callouts': {
    open: 'Draft.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: true },
    setup: (page) =>
      stubBackend(page, {
        read_text: () =>
          '# Callouts\n\n[TOC]\n\n' +
          ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].map((k) => `> [!${k}]\n> This box has a message for the reader.\n`).join('\n') +
          '\nThis line has a mistaek in it.\n',
      }),
    async run(page) {
      await page.waitForSelector('#wysiwyg .wc-err', { timeout: 30000 }).catch(() => {})
      await wait(1500)
      const words = await marked(page)
      check('the checker ran (mistaek is marked)', words.includes('mistaek'), words.join('|'))
      check('callout markers are not marked', !words.some((w) => /NOTE|TIP|IMPORTANT|WARNING|CAUTION|\[!/.test(w)), words.join('|'))

      await page.keyboard.press('Control+/')
      await page.waitForSelector('.cm-content .wc-err', { timeout: 30000 }).catch(() => {})
      await wait(1500)
      const src = await run(page, () => [...document.querySelectorAll('.cm-content .wc-err')].map((x) => x.textContent))
      check('source mode: only the real typo', src.length === 1 && src[0] === 'mistaek', src.join('|'))
      summary()
    },
  },
}
