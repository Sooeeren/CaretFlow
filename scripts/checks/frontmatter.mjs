// Checks for front matter (frontmatter.js): the YAML block at the top shows as a properties panel
// (not a heading), the outline and spell check skip it, a click edits it, the file keeps it as written.
import { check, summary, run, stubBackend, wait } from './lib.mjs'

const FM = `title: Threading - Bestellbearbeitung
author: hauk
date: 20251212
topic: Threading, Threadsafe Collection
tags: [java, threads]
aliases:
  - Orders
  - "Bestellungen"
handout: true`

export const DOC = `---
${FM}
---

# Bestellbearbeitung - Threading

Entwickeln Sie ein Java-Programm.
`

let saved = null
async function md(page) {
  saved = null
  await page.keyboard.press('Control+S')
  for (let i = 0; i < 20 && saved === null; i++) await wait(100)
  return saved ?? ''
}

export const scenes = {
  frontmatter: {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: true, updateCheck: false },
    setup: (page) => stubBackend(page, { read_text: () => DOC, write_text: ({ content }) => void (saved = content) }),
    async run(page) {
      await wait(600)
      const r = await run(page, () => {
        const pm = document.querySelector('#wysiwyg .ProseMirror')
        const fm = pm.querySelector('.folio-frontmatter')
        const dt = [...(fm?.querySelectorAll('dt') || [])].map((d) => d.textContent)
        const dd = [...(fm?.querySelectorAll('dd') || [])].map((d) => d.textContent)
        return {
          first: pm.firstElementChild?.classList.contains('folio-frontmatter'),
          dt,
          dd,
          chips: [...(fm?.querySelectorAll('.folio-fm-chip') || [])].map((c) => c.textContent),
          headings: [...pm.querySelectorAll('h1, h2')].map((h) => h.textContent),
          hr: pm.querySelectorAll('hr').length,
          outline: document.querySelector('#outline')?.textContent || '',
        }
      })
      check('front matter is the first block, shown as a panel', r.first, JSON.stringify(r))
      check('every key is listed', r.dt.join() === 'title,author,date,topic,tags,aliases,handout', r.dt.join())
      check('values are shown', r.dd[0] === 'Threading - Bestellbearbeitung' && r.dd[6] === 'true', r.dd.join(' | '))
      check('lists show as chips', r.chips.join() === 'java,threads,Orders,Bestellungen', r.chips.join())
      check('no heading or rule made from the front matter', r.headings.join() === 'Bestellbearbeitung - Threading' && r.hr === 0, r.headings.join())
      check('the outline skips it', !r.outline.includes('title:'), r.outline.slice(0, 120))

      const untouched = await md(page)
      check('saving keeps the front matter as written', untouched.startsWith(`---\n${FM}\n---\n`), untouched.slice(0, 300))

      await page.click('.folio-frontmatter')
      await wait(200)
      const ta = await page.$('.folio-fm-src')
      check('click opens the YAML', !!ta && (await ta.inputValue()) === FM)
      await page.keyboard.type('\nstatus: draft')
      await page.keyboard.press('Control+Enter')
      await wait(400)
      const after = await md(page)
      check('the edit is saved', after.startsWith(`---\n${FM}\nstatus: draft\n---\n`), after.slice(0, 300))
      check('shown as a panel again', !(await page.$('.folio-fm-src')) && (await page.$$eval('.folio-frontmatter dt', (d) => d.length)) === 8)

      await page.click('.folio-frontmatter')
      await wait(150)
      await page.keyboard.type('xyz')
      await page.keyboard.press('Escape')
      await wait(300)
      check('Escape cancels the edit', !(await md(page)).includes('xyz'))
      summary()
    },
  },
  'frontmatter-new': {
    open: 'Welcome.md',
    settings: { theme: 'ink', sidebar: false, updateCheck: false },
    setup: (page) => stubBackend(page, { read_text: () => '# Notes\n\nText.\n', write_text: ({ content }) => void (saved = content) }),
    async run(page) {
      await wait(600)
      await page.click('#wysiwyg .ProseMirror p')
      await page.keyboard.press('Control+Alt+F')
      await wait(300)
      check('Ctrl+Alt+F adds front matter and opens it', !!(await page.$('.folio-fm-src')))
      await page.keyboard.type('Notes\ntags: [a]')
      await page.keyboard.press('Control+Enter')
      await wait(400)
      const out = await md(page)
      check('saved at the top of the file', out.startsWith('---\ntitle: Notes\ntags: [a]\n---\n\n# Notes'), out)

      // source mode: YAML colors, not a heading
      await page.keyboard.press('Control+/')
      await wait(800)
      const src = await run(page, () =>
        [...document.querySelectorAll('.cm-content .cm-line')].slice(0, 3).map((l) => [l.textContent, Math.max(...[l, ...l.querySelectorAll('span')].map((s) => +getComputedStyle(s).fontWeight))]),
      )
      check('source mode: front matter is not a bold heading', Array.isArray(src) && src[1][0].startsWith('title') && src.every(([, w]) => w < 700), JSON.stringify(src))
      summary()
    },
  },
}
