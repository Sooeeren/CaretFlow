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

  // PDF / HTML export: standalone Markdown and resized <img> blocks are centered like the editor,
  // inline / raw HTML images stay left-aligned, and missing or failed images render as clean boxes
  'export-images': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false },
    setup: (page) => stubBackend(page, { read_text: () => DOC }),
    async run(page) {
      await wait(600)
      const r = await run(page, async () => {
        const logo = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#2563eb"/></svg>')
        const wide = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="400"><rect width="1400" height="400" fill="#0f766e"/></svg>')
        const md = [
          '![Logo](assets/logo.svg)',
          '',
          '<img src="assets/logo.svg" alt="Half" style="zoom:50%;" />',
          '',
          '<img src="assets/wide.svg" alt="Zoomed wide" style="zoom:200%;" />',
          '',
          '<img src="assets/wide.svg" alt="Fixed px" width="300" />',
          '',
          'Inline ![dot](assets/logo.svg) image in text.',
          '',
          '<img src="assets/logo.svg" alt="raw html" width="32" onerror="alert(1)" />',
          '',
          '![This image does not exist](assets/missing.png)',
          '',
          '![Unreachable](http://127.0.0.1:1/unreachable.png)',
        ].join('\n')
        const cs = getComputedStyle(document.documentElement)
        const vars = ['--bg', '--fg', '--fg-strong', '--muted', '--chrome', '--border', '--link', '--code-bg', '--code-fg', '--quote', '--quote-bar', '--doc-font', '--doc-size', '--doc-width', '--doc-lh', '--heading-space', '--font-mono', '--font-ui']
          .map((v) => `${v}:${cs.getPropertyValue(v)}`)
          .join(';')
        const { toHtml } = await import('/src/export.js')
        const map = { 'D:/bench/assets/logo.svg': logo, 'D:/bench/assets/wide.svg': wide }
        const htmlExport = await toHtml(md, { docDir: 'D:/bench', targetDir: 'D:/bench', imageExists: async (p) => p.replace(/\\/g, '/') in map, themeVars: vars })
        const pdfHtml = await toHtml(md, { docDir: 'D:/bench', resolveForView: (p) => map[p.replace(/\\/g, '/')] || p, imageExists: async (p) => p.replace(/\\/g, '/') in map, themeVars: vars, inlineKatex: true, forPdf: true })
        const f = document.createElement('iframe')
        f.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:2000px;border:0;z-index:99999;background:#fff'
        document.body.append(f)
        await new Promise((res) => {
          f.onload = res
          f.srcdoc = pdfHtml
        })
        await new Promise((res) => setTimeout(res, 300))
        const body = f.contentDocument.body
        const br = body.getBoundingClientRect()
        const centerErr = (el) => {
          const r = el.getBoundingClientRect()
          return Math.abs((r.left - br.left) - (br.right - r.right))
        }
        const imgs = [...body.querySelectorAll('img')]
        const byAlt = (a) => imgs.find((i) => i.getAttribute('alt') === a)
        const missing = [...body.querySelectorAll('.cf-img-missing')].map((s) => ({ text: s.textContent.trim(), h: Math.round(s.getBoundingClientRect().height) }))
        const out = {
          noScriptInHtmlExport: !htmlExport.includes('<script'),
          htmlMissingBox: htmlExport.includes('cf-img-missing') && htmlExport.includes('assets/missing.png'),
          logoCentered: centerErr(byAlt('Logo')) <= 2,
          logoW: Math.round(byAlt('Logo').getBoundingClientRect().width),
          halfCentered: centerErr(byAlt('Half')) <= 2,
          halfW: Math.round(byAlt('Half').getBoundingClientRect().width),
          zoom200Fits: byAlt('Zoomed wide').getBoundingClientRect().width <= br.width + 1 && centerErr(byAlt('Zoomed wide')) <= 2,
          px300Centered: centerErr(byAlt('Fixed px')) <= 2 && Math.round(byAlt('Fixed px').getBoundingClientRect().width) === 300,
          inlineNotCentered: centerErr(byAlt('dot')) > 80,
          rawHtmlLeft: byAlt('raw html').getBoundingClientRect().left - br.left < 5,
          missing,
          brokenImgsLeft: imgs.filter((i) => !i.complete || !i.naturalWidth).length,
        }
        f.remove()
        return out
      })
      check('HTML export stays script-free and replaces missing local images', r.noScriptInHtmlExport && r.htmlMissingBox, JSON.stringify(r))
      check('Markdown block image is centered in PDF/HTML', r.logoCentered && r.logoW === 160, JSON.stringify(r))
      check('zoomed <img style="zoom:50%"> is centered at half size', r.halfCentered && Math.abs(r.halfW - 80) <= 2, JSON.stringify(r))
      check('zoomed 200 % wide image stays centered within the page width', r.zoom200Fits, JSON.stringify(r))
      check('pixel-width <img width="300"> is centered at 300 px', r.px300Centered, JSON.stringify(r))
      check('inline and non-block HTML images stay left-aligned', r.inlineNotCentered && r.rawHtmlLeft, JSON.stringify(r))
      check('missing local and failed remote images show clean placeholder boxes (no broken <img>)', r.brokenImgsLeft === 0 && r.missing.length === 2 && r.missing[0].text.includes('assets/missing.png') && r.missing[1].text.includes('unreachable.png') && r.missing.every((m) => m.h >= 24 && m.h <= 80), JSON.stringify(r.missing))
      summary()
    },
  },
}
