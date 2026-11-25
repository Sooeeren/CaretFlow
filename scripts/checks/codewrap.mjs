// Wrap Code Lines (settings.wrapCode): long lines in code blocks continue on the next line in the
// rendered editor and in exports; off, the block scrolls sideways as before.
//   node scripts/screenshots.mjs codewrap --extra scripts/checks/codewrap.mjs --out <tmp dir>
import { check, summary, stubBackend, wait, run } from './lib.mjs'

const LONG = 'const message = ' + JSON.stringify('word '.repeat(60).trim()) + ' // a line far wider than the page'
const DOC = `# Code\n\nSome text.\n\n\`\`\`js\n${LONG}\nconst short = 1\n\`\`\`\n`

const measure = (page) =>
  run(page, async () => {
    const block = document.querySelector('#wysiwyg .milkdown-code-block')
    block.scrollIntoView()
    await new Promise((r) => setTimeout(r, 600))
    const sc = block.querySelector('.cm-scroller')
    const line = block.querySelector('.cm-line')
    const lh = parseFloat(getComputedStyle(line).lineHeight)
    return { overflow: sc.scrollWidth - sc.clientWidth, lines: line.getBoundingClientRect().height / lh }
  })

const exported = (page, wrapCode) =>
  run(page, async (wrapCode) => {
    const { toHtml } = await import('/src/export.js')
    const html = await toHtml(await window.__TAURI_INTERNALS__.invoke('read_text', {}), { wrapCode })
    const f = document.createElement('iframe')
    f.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:800px;border:0'
    document.body.append(f)
    await new Promise((r) => {
      f.onload = r
      f.srcdoc = html
    })
    const pre = f.contentDocument.querySelector('pre')
    const out = { overflow: pre.scrollWidth - pre.clientWidth, height: pre.getBoundingClientRect().height }
    f.remove()
    return out
  }, wrapCode)

export const scenes = {
  codewrap: {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false },
    setup: (page) => stubBackend(page, { read_text: () => DOC }),
    async run(page) {
      await wait(1200)
      check('on by default', await page.evaluate(() => document.body.classList.contains('wrap-code')))
      let m = await measure(page)
      if (m.error) return check('measured', false, m.error)
      check('wrapped: no sideways scrolling', m.overflow <= 1, `overflow ${m.overflow}px`)
      check('wrapped: the long line takes several rows', m.lines >= 2, `${m.lines.toFixed(1)} rows`)

      await page.keyboard.press('Alt+Z')
      await wait(300)
      check('Alt+Z turns it off', !(await page.evaluate(() => document.body.classList.contains('wrap-code'))))
      m = await measure(page)
      check('unwrapped: scrolls sideways', m.overflow > 50, `overflow ${m.overflow}px`)
      check('unwrapped: one row', m.lines < 1.5, `${m.lines.toFixed(1)} rows`)

      const on = await exported(page, true)
      const off = await exported(page, false)
      if (on.error || off.error) return check('export measured', false, on.error || off.error)
      check('export wrapped: no sideways scrolling', on.overflow <= 1, `overflow ${on.overflow}px`)
      check('export unwrapped: scrolls sideways', off.overflow > 50, `overflow ${off.overflow}px`)
      check('export wrapped block is taller', on.height > off.height + 10, `${on.height.toFixed(0)} vs ${off.height.toFixed(0)}`)
      summary()
    },
  },
}
