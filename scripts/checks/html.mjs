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

<div style="position: fixed; top: 0; left: 0">pinned</div>

<details>
<summary>More</summary>
Hidden text
</details>
`

const WRAP_DOC = `<div align="center">

# Centered Title

> **Note:** a centered quote.

Centered paragraph with \`code\`
\`api.call\` at the start of a line.

<div align="right" style="color: red; position: fixed; display: none">

Right inside

</div>

</div>

After the wrapper.

<center>

</p>

</center>

<div align="center">

Never closed.
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
        const nodes = [...pm.querySelectorAll('.cf-html')]
        return {
          count: nodes.length,
          centered: !!pm.querySelector('.cf-html.block p[align="center"] a b'),
          kbd: pm.querySelectorAll('.cf-html kbd').length,
          sub: !!pm.querySelector('.cf-html sub'),
          u: !!pm.querySelector('u'),
          script: !!pm.querySelector('.cf-html script'),
          onclick: !!pm.querySelector('.cf-html [onclick], .cf-html [onerror]'),
          idClass: !!pm.querySelector('.cf-html #modal, .cf-html .menu-pop'),
          safe: pm.textContent.includes('safe text'),
          comment: nodes.some((n) => n.classList.contains('raw') && n.textContent.includes('<!-- a comment -->')),
          details: !!pm.querySelector('.cf-html details summary'),
          pinned: [...pm.querySelectorAll('.cf-html div')].find((d) => d.textContent === 'pinned')?.style.position,
          // the paragraph around block HTML is exactly as tall as the HTML: no empty lines, no margins
          gap: (() => {
            const h = pm.querySelector('.cf-html.block p[align]').closest('.cf-html')
            return Math.round(h.parentElement.getBoundingClientRect().height - h.getBoundingClientRect().height) + '/' + getComputedStyle(h.querySelector('p')).marginTop
          })(),
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
      check('position: fixed cannot pin anything over the app', r.pinned === 'static', r.pinned)
      check('no empty lines or margins around block HTML', r.gap === '0/0px', r.gap)

      const untouched = await md(page)
      const htmlParts = DOC.match(/<p align[\s\S]*?<\/p>|<kbd>Ctrl<\/kbd>|<sub>2<\/sub>|<details>[\s\S]*?<\/details>|<!-- a comment -->/g)
      check('saving without edits keeps every HTML part as written', htmlParts.every((p) => untouched.includes(p)), untouched)

      // click to edit the source, change it, Ctrl+Enter saves it back
      await page.click('.cf-html.block p[align="center"]', { position: { x: 5, y: 5 } })
      await wait(200)
      const ta = await page.$('.cf-html-src')
      check('click opens the source', !!ta && (await ta.inputValue()).startsWith('<p align="center">'))
      await page.keyboard.press('Control+End')
      await page.keyboard.type('\n<!-- edited -->')
      await page.keyboard.press('Control+Enter')
      await wait(400)
      const after = await md(page)
      check('the edit is saved to Markdown', /<\/p>\n<!-- edited -->/.test(after || ''), after?.slice(0, 200))
      check('rendered again after editing', !(await page.$('.cf-html-src')))
      check('everything else unchanged', (after || '').includes('Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save, H<sub>2</sub>O, and <u>underline</u>'), after)

      // Escape cancels
      await page.click('.cf-html kbd >> nth=0')
      await wait(150)
      await page.keyboard.type('xyz')
      await page.keyboard.press('Escape')
      await wait(300)
      check('Escape cancels the edit', !(await md(page)).includes('xyz'))
      summary()
    },
  },
  // a README header: Markdown between a lone `<div align="center">` and `</div>` shows centered
  'html-wrap': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false },
    setup: (page) => stubBackend(page, { read_text: () => WRAP_DOC, write_text: ({ content }) => void (saved = content) }),
    async run(page) {
      await wait(600)
      const r = await run(page, () => {
        const pm = document.querySelector('#wysiwyg .ProseMirror')
        const align = (sel) => getComputedStyle(pm.querySelector(sel)).textAlign
        const para = (t) => [...pm.querySelectorAll('p')].find((p) => p.textContent.includes(t))
        return {
          tags: pm.querySelectorAll('p.cf-html-wrap-tag').length,
          tagSize: parseFloat(getComputedStyle(pm.querySelector('p.cf-html-wrap-tag .cf-html')).fontSize) < parseFloat(getComputedStyle(para('Centered')).fontSize),
          h1: align('h1'),
          quote: align('blockquote'),
          centered: getComputedStyle(para('Centered')).textAlign,
          right: getComputedStyle(para('Right inside')).textAlign,
          rightColor: getComputedStyle(para('Right inside')).color,
          after: getComputedStyle(para('After the wrapper')).textAlign,
          unclosed: getComputedStyle(para('Never closed')).textAlign,
          leak: [...pm.querySelectorAll('[style]')].some((e) => /position|display/.test(e.getAttribute('style'))),
        }
      })
      check('the tag lines are shown small', r.tags === 7 && r.tagSize, JSON.stringify(r))
      check('heading, quote and paragraph between them are centered', r.h1 === 'center' && r.quote === 'center' && r.centered === 'center')
      check('an inner wrapper wins (align="right" and its color)', r.right === 'right' && r.rightColor === 'rgb(255, 0, 0)', r.right + ' ' + r.rightColor)
      check('blocks after the closing tag are not centered', r.after !== 'center', r.after)
      check('a wrapper without its closing tag changes nothing', r.unclosed !== 'center', r.unclosed)
      check('only text styles are taken from style="…"', !r.leak)
      check('saving keeps the file as written', (await md(page)) === WRAP_DOC)

      // switching to source mode with a line that starts with `code` used to hang the spelling check
      await page.keyboard.press('Control+/')
      const alive = await Promise.race([page.evaluate(() => new Promise((ok) => setTimeout(() => ok(!!document.querySelector('#source .cm-content')), 800))), wait(6000).then(() => false)])
      check('source mode opens (a line starting with inline code does not freeze it)', alive)
      summary()
    },
  },
  // not HTML, but rendering too: Markdown images scale with the window instead of being cropped
  'image-scale': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false },
    setup: (page) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><rect width="1600" height="400" fill="#639"/></svg>`
      return stubBackend(page, { read_text: () => `# Image\n\n![wide](data:image/svg+xml,${encodeURIComponent(svg)})\n` })
    },
    async run(page) {
      await wait(800)
      const ratio = () => page.$eval('.milkdown-image-block img', (i) => i.getBoundingClientRect().width / i.getBoundingClientRect().height)
      const wide = await ratio()
      check('a 4:1 image shows as 4:1', Math.abs(wide - 4) < 0.1, wide.toFixed(2))
      await page.setViewportSize({ width: 700, height: 900 })
      await wait(500)
      const narrow = await ratio()
      const w = await page.$eval('.milkdown-image-block img', (i) => i.getBoundingClientRect().width)
      check('in a narrow window it scales down, still 4:1 (not cropped)', Math.abs(narrow - 4) < 0.1 && w < 650, `${narrow.toFixed(2)}, ${Math.round(w)}px wide`)
      summary()
    },
  },
}
