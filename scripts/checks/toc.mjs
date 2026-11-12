// Checks for the table of contents (toc.js): a [TOC] line shows the headings as a clickable list,
// follows edits, survives saving as `[TOC]`, is inserted with Ctrl+Alt+O, and becomes linked
// headings in exports.
import { check, summary, run, stubBackend, wait } from './lib.mjs'

export const DOC = `# Guide

[TOC]

## Install

Text.

### On Linux

More text.

## Use

${'Filler paragraph.\n\n'.repeat(30)}## Last part

The end.
`

let saved = null
async function md(page) {
  saved = null
  await page.keyboard.press('Control+S')
  for (let i = 0; i < 20 && saved === null; i++) await wait(100)
  return saved ?? ''
}

const items = (page) => run(page, () => [...document.querySelectorAll('#wysiwyg .folio-toc-item')].map((a) => a.textContent))

export const scenes = {
  toc: {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, updateCheck: false },
    setup: (page) => stubBackend(page, { read_text: () => DOC, write_text: ({ content }) => void (saved = content) }),
    async run(page) {
      await wait(700)
      const r = await run(page, () => {
        const pm = document.querySelector('#wysiwyg .ProseMirror')
        return { toc: pm.querySelectorAll('.folio-toc').length, text: pm.textContent.includes('[TOC]') }
      })
      check('[TOC] shows as a contents block, not text', r.toc === 1 && !r.text, JSON.stringify(r))
      const list = await items(page)
      check('lists every heading in order', list.join('|') === 'Guide|Install|On Linux|Use|Last part', list.join('|'))
      const pad = await run(page, () => [...document.querySelectorAll('#wysiwyg .folio-toc-item')].map((a) => a.style.paddingLeft))
      check('nested headings are indented', pad[0] === '0em' && pad[2] === '2.4em', pad.join())

      const out = await md(page)
      check('saving keeps the [TOC] line', out.includes('\n[TOC]\n') && !out.includes('\\[TOC]'), out.slice(0, 80))

      // clicking an entry scrolls to the heading
      await page.click('#wysiwyg .folio-toc-item:last-child')
      await wait(900)
      const jumped = await run(page, () => {
        const h = [...document.querySelectorAll('#wysiwyg h2')].find((h) => h.textContent === 'Last part')
        const top = h.getBoundingClientRect().top
        return { ok: top >= 0 && top < innerHeight / 2, top }
      })
      check('clicking an entry goes to that heading', jumped.ok === true, JSON.stringify(jumped))

      // a new heading shows up in the list
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('## Added later')
      await wait(500)
      const after = await items(page)
      check('the list follows edits', after.at(-1) === 'Added later', after.join('|'))
      summary()
    },
  },
  'toc-insert': {
    open: 'Welcome.md',
    settings: { theme: 'ink', sidebar: false, updateCheck: false },
    setup: (page) => stubBackend(page, { read_text: () => '# Notes\n\n## Part\n\nText.\n', write_text: ({ content }) => void (saved = content) }),
    async run(page) {
      await wait(700)
      await page.click('#wysiwyg .ProseMirror h1')
      await page.keyboard.press('End')
      await page.keyboard.press('Control+Alt+O')
      await wait(400)
      const list = await items(page)
      check('Ctrl+Alt+O inserts a table of contents', list.join('|') === 'Notes|Part', list.join('|'))
      const out = await md(page)
      check('saved as [TOC] after the heading', /^# Notes\n\n\[TOC\]\n/.test(out), out)

      const html = await run(page, async () => {
        const { renderToc } = await import('/src/toc.js')
        return renderToc('<h1>Notes</h1><p>[TOC]</p><h2>Part <em>one</em></h2><h2>Part one</h2>')
      })
      check('exports: headings get ids', html.includes('<h2 id="part-one">') && html.includes('<h2 id="part-one-1">'), html)
      check('exports: [TOC] becomes a linked list', html.includes('<nav class="toc">') && html.includes('<a href="#part-one-1">Part one</a>') && !html.includes('[TOC]'), html)
      summary()
    },
  },
  'toc-type': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, updateCheck: false },
    setup: (page) => stubBackend(page, { read_text: () => '# Notes\n\n## Part\n\nText.\n', write_text: ({ content }) => void (saved = content) }),
    async run(page) {
      await wait(700)
      await page.click('#wysiwyg .ProseMirror h1')
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('[TOC]')
      await wait(400)
      const list = await items(page)
      check('typing [TOC] makes the contents block', list.join('|') === 'Notes|Part', list.join('|'))
      await page.keyboard.type('Next line')
      await wait(300)
      const out = await md(page)
      check('the cursor goes to the line after it', /^# Notes\n\n\[TOC\]\n\nNext line\n/.test(out), out)

      // [TOC] inside running text stays text
      await page.keyboard.type(' and [toc] here')
      await wait(300)
      const n = (await items(page)).length
      const out2 = await md(page)
      check('[toc] in a sentence stays text', n === 2 && /Next line and \\?\[toc\] here/.test(out2), `${n} ${out2}`)
      summary()
    },
  },
}
