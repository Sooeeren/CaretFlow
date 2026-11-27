// Checks for issue #30: scrolling the page preview. Pages are whole screen pixels in size, they are
// drawn ahead while nothing scrolls and never while the list moves, and far pages give their canvas
// back so a long document stays within a memory limit.
import { check, summary, stubBackend, wait } from './lib.mjs'

/** A PDF of `n` A4 pages with a line of text and a box on each. */
function makePdf(n) {
  const objs = []
  const add = (body) => objs.push(body) && objs.length
  const catalog = add('')
  const pages = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const kids = []
  for (let i = 1; i <= n; i++) {
    const text = `BT /F1 24 Tf 72 760 Td (Page ${i}) Tj ET 72 200 451 500 re S`
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`
  objs[pages - 1] = `<< /Type /Pages /Count ${n} /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] >>`
  let out = '%PDF-1.4\n'
  const offsets = objs.map((body, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return [...Buffer.from(out, 'latin1')]
}

const backend = (n) => ({ export_pdf: () => null, read_bytes: () => makePdf(n), remove_temp: () => null })
const pages = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('#pv-pages')
    const view = box.getBoundingClientRect()
    const dpr = devicePixelRatio
    const all = [...box.querySelectorAll('.pv-page')].map((w) => {
      const r = w.getBoundingClientRect()
      const c = w.querySelector('canvas')
      return { w: r.width * dpr, h: r.height * dpr, cw: c?.width ?? 0, ch: c?.height ?? 0, seen: r.bottom > view.top && r.top < view.bottom }
    })
    return {
      n: all.length,
      drawn: all.filter((p) => p.cw).length,
      seenDrawn: all.filter((p) => p.seen).every((p) => p.cw),
      // layout keeps 1/64 px, so at a zoom of 150 % a size can be off by a hundredth of a screen pixel
      whole: all.every((p) => Math.abs(p.w - Math.round(p.w)) < 0.03 && Math.abs(p.h - Math.round(p.h)) < 0.03),
      exact: all.filter((p) => p.cw).every((p) => p.cw === Math.round(p.w) && p.ch === Math.round(p.h)),
      pixels: all.reduce((s, p) => s + p.cw * p.ch, 0),
      shadow: getComputedStyle(box.querySelector('.pv-page')).boxShadow,
      status: document.querySelector('#pv-status').textContent,
    }
  })
const openPreview = async (page) => {
  await page.keyboard.press('Control+Alt+L')
  await page.waitForSelector('#pv-pages .pv-page canvas', { timeout: 30000 })
}
const untilDrawn = async (page, ms = 20000) => {
  let last = -1
  for (const end = Date.now() + ms; Date.now() < end; ) {
    const p = await pages(page)
    // after a new layout the old canvases stand in until each page is drawn again: wait for the new ones
    if ((p.drawn === p.n && p.exact) || (p.drawn === last && p.exact && last > 0)) return p
    last = p.drawn
    await wait(700)
  }
  return pages(page)
}

export const scenes = {
  'preview-scroll': {
    open: 'Welcome.md',
    settings: { sidebar: false, spellcheck: false },
    async setup(page) {
      await stubBackend(page, backend(24))
      // as on Linux, where the preview paints without the GPU
      await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' }))
    },
    async run(page) {
      await openPreview(page)
      // nothing is scrolled: all pages are drawn ahead
      const p = await untilDrawn(page)
      check('the preview shows the pages', p.n === 24, JSON.stringify(p))
      check('every page is drawn ahead, without scrolling to it', p.drawn === 24, `${p.drawn} of ${p.n}`)
      check('pages are a whole number of screen pixels in size', p.whole, JSON.stringify(p))
      check('each canvas has exactly the pixels of its page', p.exact, JSON.stringify(p))
      check('no blurred shadow behind the pages on Linux', /0px 0px 0px 1px/.test(p.shadow), p.shadow)

      // a new layout (zoom), then scrolling right away: no page is drawn while the list moves
      await page.evaluate(() => {
        const box = document.querySelector('#pv-pages')
        window.__draws = []
        window.__scrolls = []
        new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.tagName === 'CANVAS' && window.__draws.push(performance.now())))).observe(box, { childList: true, subtree: true })
        box.addEventListener('scroll', () => window.__scrolls.push(performance.now()))
      })
      await page.click('#pv-zoom-in')
      await wait(60)
      await page.evaluate(
        () =>
          new Promise((done) => {
            const box = document.querySelector('#pv-pages')
            const t0 = performance.now()
            const step = () => {
              box.scrollTop += 30
              if (performance.now() - t0 < 1500) requestAnimationFrame(step)
              else done()
            }
            step()
          }),
      )
      const during = await page.evaluate(() => {
        const first = window.__scrolls[0]
        const last = window.__scrolls[window.__scrolls.length - 1]
        // a page that was being drawn when the scrolling began may still land right after it
        return { scrolls: window.__scrolls.length, draws: window.__draws.filter((t) => t > first + 250 && t < last).length }
      })
      check('the list was scrolled', during.scrolls > 20, JSON.stringify(during))
      check('no page is drawn while the list is scrolling', during.draws === 0, JSON.stringify(during))
      const after = await untilDrawn(page)
      check('the pages are drawn once it is still', after.drawn === after.n && after.exact, JSON.stringify(after))

      // refreshing the preview cleans up the previous PDF without throwing (pdf.js loadingTask.destroy)
      await page.click('#pv-refresh')
      await wait(800)
      const refreshed = await untilDrawn(page)
      check('refreshing the preview succeeds without error', refreshed.status === '24 pages' && refreshed.drawn === 24, refreshed.status)
      summary()
    },
  },

  // a long document: far pages give their canvas back, the visible ones are always drawn
  'preview-long': {
    open: 'Welcome.md',
    settings: { sidebar: false, spellcheck: false, pvWidth: 700 },
    setup: (page) => stubBackend(page, backend(160)),
    async run(page) {
      await openPreview(page)
      const a = await untilDrawn(page, 60000)
      check('the preview shows 160 pages', a.n === 160, JSON.stringify(a))
      check('the canvases stay within the limit', a.pixels > 0 && a.pixels <= 48e6, `${Math.round(a.pixels / 1e6)} MP, ${a.drawn} pages drawn`)
      check('not every page can be kept', a.drawn < a.n, `${a.drawn} of ${a.n}`)
      check('the visible pages are drawn', a.seenDrawn, JSON.stringify(a))
      await page.evaluate(() => {
        const box = document.querySelector('#pv-pages')
        box.scrollTop = box.scrollHeight
      })
      await wait(1500)
      const b = await untilDrawn(page, 60000)
      check('at the end: the visible pages are drawn', b.seenDrawn, JSON.stringify(b))
      check('at the end: still within the limit', b.pixels <= 48e6, `${Math.round(b.pixels / 1e6)} MP, ${b.drawn} pages drawn`)
      await page.evaluate(() => (document.querySelector('#pv-pages').scrollTop = 0))
      await wait(1500)
      const c = await untilDrawn(page, 60000)
      check('back at the top: the visible pages are drawn again', c.seenDrawn && c.pixels <= 48e6, JSON.stringify(c))
      summary()
    },
  },
}
