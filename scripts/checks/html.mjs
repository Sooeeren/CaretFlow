// Checks for HTML in Markdown (html.js): block and inline HTML render, unsafe parts are removed,
// a click edits the source, and the file keeps the HTML exactly as written.
import { check, summary, run, stubBackend, wait } from './lib.mjs'

export const DOC = `# Project

<p align="center">
  <a href="https://example.com/releases/latest"><b>Download the latest release</b></a> ·
  <a href="#install">Install</a>
</p>

Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save, H<sub>2</sub>O, and <u>underline</u> stays a mark.

<div onclick="alert(1)" id="modal" class="menu-pop"><script>window.__pwned = 1</script><img src="x" onerror="window.__pwned = 2">safe text</div>

<!-- a comment -->

<details>
<summary>More</summary>
Hidden text
</details>
`

let saved = null
/** What Ctrl+S writes to disk */
async function md(page) {
  saved = null
  await page.keyboard.press('Control+S')
  for (let i = 0; i < 20 && saved === null; i++) await wait(100)
  return saved ?? ''
}

export const scenes = {
  'html-render': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false },
    setup: (page) => stubBackend(page, { read_text: () => DOC, write_text: ({ content }) => void (saved = content) }),
    async run(page) {
      await wait(500)
      const r = await run(page, () => {
        const pm = document.querySelector('#wysiwyg .ProseMirror')
        const nodes = [...pm.querySelectorAll('.folio-html')]
        return {
          count: nodes.length,
          centered: !!pm.querySelector('.folio-html.block p[align="center"] a b'),
          kbd: pm.querySelectorAll('.folio-html kbd').length,
          sub: !!pm.querySelector('.folio-html sub'),
          u: !!pm.querySelector('u'),
          script: !!pm.querySelector('.folio-html script'),
          onclick: !!pm.querySelector('.folio-html [onclick], .folio-html [onerror]'),
          idClass: !!pm.querySelector('.folio-html #modal, .folio-html .menu-pop'),
          safe: pm.textContent.includes('safe text'),
          comment: nodes.some((n) => n.classList.contains('raw') && n.textContent.includes('<!-- a comment -->')),
          details: !!pm.querySelector('.folio-html details summary'),
          rawTags: /<p align|<kbd>|<b>/.test(pm.textContent),
          pwned: window.__pwned,
        }
      })
      check('block HTML renders (centered paragraph with a bold link)', r.centered, JSON.stringify(r))
      check('inline pairs render (<kbd>, <sub>)', r.kbd === 2 && r.sub)
      check('<u> stays an underline mark', r.u)
      check('no raw tags left as text', !r.rawTags)
      check('scripts and event handlers removed, never run', !r.script && !r.onclick && !r.pwned, String(r.pwned))
      check('id/class removed (cannot pick up app styles)', !r.idClass)
      check('the safe part still shows', r.safe)
      check('comments stay visible as source', r.comment)
      check('<details> renders', r.details)

      const untouched = await md(page)
      const htmlParts = DOC.match(/<p align[\s\S]*?<\/p>|<kbd>Ctrl<\/kbd>|<sub>2<\/sub>|<details>[\s\S]*?<\/details>|<!-- a comment -->/g)
      check('saving without edits keeps every HTML part as written', htmlParts.every((p) => untouched.includes(p)), untouched)

      // click to edit the source, change it, Ctrl+Enter saves it back
      await page.click('.folio-html.block p[align="center"]', { position: { x: 5, y: 5 } })
      await wait(200)
      const ta = await page.$('.folio-html-src')
      check('click opens the source', !!ta && (await ta.inputValue()).startsWith('<p align="center">'))
      await page.keyboard.press('Control+End')
      await page.keyboard.type('\n<!-- edited -->')
      await page.keyboard.press('Control+Enter')
      await wait(400)
      const after = await md(page)
      check('the edit is saved to Markdown', /<\/p>\n<!-- edited -->/.test(after || ''), after?.slice(0, 200))
      check('rendered again after editing', !(await page.$('.folio-html-src')))
      check('everything else unchanged', (after || '').includes('Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save, H<sub>2</sub>O, and <u>underline</u>'), after)

      // Escape cancels
      await page.click('.folio-html kbd >> nth=0')
      await wait(150)
      await page.keyboard.type('xyz')
      await page.keyboard.press('Escape')
      await wait(300)
      check('Escape cancels the edit', !(await md(page)).includes('xyz'))
      summary()
    },
  },
}
