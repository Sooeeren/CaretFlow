// Images in the rendered view: clicking one doesn't move the text above it, the caption (alt
// text) is hidden unless shown in View, the caption button still edits it, and the full-screen
// button opens the viewer.
//   node scripts/screenshots.mjs image-view --extra scripts/checks/images.mjs --out <tmp dir>
import { check, summary, stubBackend, wait, run } from './lib.mjs'

const SVG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#c33"/></svg>').toString('base64')
const DOC = `# America\n\n- Guns\n- Eagle\n\n![The eagle](${SVG} "A bald eagle")\n\n- Trump\n`
const tops = (page) => run(page, () => [...document.querySelectorAll('#wysiwyg .ProseMirror > :not(.prosemirror-virtual-cursor)')].map((e) => Math.round(e.getBoundingClientRect().top)))
const captionShown = (page) => run(page, () => { const c = document.querySelector('.milkdown-image-block .caption-input'); return !!c && c.getBoundingClientRect().height > 0 })

export const scenes = {
  'image-view': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false },
    setup: (page) => stubBackend(page, { read_text: () => DOC }),
    async run(page) {
      await page.setViewportSize({ width: 1000, height: 900 })
      await wait(1200)
      await page.click('#wysiwyg h1')
      await wait(200)
      const before = await tops(page)
      check('caption hidden by default', !(await captionShown(page)))
      await page.click('#wysiwyg .milkdown-image-block img')
      await wait(300)
      const after = await tops(page)
      check('clicking an image moves nothing', JSON.stringify(before) === JSON.stringify(after), `${before} → ${after}`)

      await page.hover('#wysiwyg .milkdown-image-block .image-wrapper')
      await wait(300)
      check('full-screen button on hover', !!(await page.$('.milkdown-image-block .cf-img-full')))
      await page.click('.milkdown-image-block .cf-img-full')
      await wait(300)
      const v = await run(page, () => { const b = document.querySelector('.cf-img-viewer'); return b && { cap: b.querySelector('.cf-img-viewer-cap').textContent, w: b.getBoundingClientRect().width, src: !!b.querySelector('img').src } })
      if (process.env.PROBE_OUT) await page.screenshot({ path: process.env.PROBE_OUT + '/viewer.png' }).catch(() => {})
      check('viewer opens over the window', v && v.w >= 990 && v.src, JSON.stringify(v))
      await page.keyboard.press('Escape')
      await wait(300)
      check('Esc closes it', !(await page.$('.cf-img-viewer')))

      await page.hover('#wysiwyg .milkdown-image-block .image-wrapper')
      await page.click('.milkdown-image-block .operation-item:not(.cf-img-full)')
      await wait(400)
      check('caption button shows the caption field', await captionShown(page))
      await page.click('#wysiwyg h1')
      await wait(300)
      check('leaving it hides it again', !(await captionShown(page)))

      await run(page, () => document.body.classList.remove('cf-hide-captions'))
      await wait(200)
      check('Show Image Alt Text shows captions', await captionShown(page))
      summary()
    },
  },
}
