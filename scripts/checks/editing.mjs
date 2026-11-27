// Checks for things found with the benchmark document (benchmark/CaretFlow-Benchmark.md): lettered
// and roman sub-point numbers, footnotes, a box for images that can't load, inline HTML on the
// text line, the small inline math editor, and the view keeping its place on a mode change.
import { check, summary, run, stubBackend, wait } from './lib.mjs'

const filler = (n) => Array.from({ length: n }, (_, i) => `Filler paragraph number ${i + 1} with a few words in it.`).join('\n\n')

export const DOC = `# Editing

1. One
2. Two
   1. Lettered
      1. Roman
   2. Second lettered
3. Three

Text with a note.[^n] And another.[^1]

[^1]: The numbered note.
[^n]: The named note, referred to first.

![Missing picture](nowhere/missing.png)

Keys <kbd>Ctrl</kbd> and H<sub>2</sub>O and x<sup>2</sup>.

Inline math $a^2 + b^2$ here.

${filler(80)}

## Far below

${filler(20)}
`

const backend = (page) => stubBackend(page, { read_text: () => DOC, write_text: () => {} })

export const scenes = {
  'edit-lists-notes': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, updateCheck: false, spellcheck: false, nestedLists: true },
    setup: backend,
    async run(page) {
      await wait(800)
      const r = await run(page, () => {
        const marker = (t) => {
          const li = [...document.querySelectorAll('#wysiwyg li')].find((l) => l.querySelector('p')?.textContent === t)
          const w = li.querySelector(':scope > .label-wrapper')
          const c = getComputedStyle(w, '::before').content
          return c && c !== 'none' ? c.replace(/"/g, '') : w.textContent.trim()
        }
        const text = (t) => [...document.querySelectorAll('#wysiwyg li p')].find((p) => p.textContent === t).getBoundingClientRect()
        const label = (t) => [...document.querySelectorAll('#wysiwyg li')].find((l) => l.querySelector('p')?.textContent === t).querySelector(':scope > .label-wrapper').getBoundingClientRect()
        return {
          top: marker('Two'),
          a: marker('Lettered'),
          b: marker('Second lettered'),
          i: marker('Roman'),
          // the marker's box sits on the text's first line
          aligned: Math.abs(label('Lettered').top + label('Lettered').height / 2 - (text('Lettered').top + text('Lettered').height / 2)) < 4,
          refs: [...document.querySelectorAll('#wysiwyg sup[data-type="footnote_reference"]')].map((s) => getComputedStyle(s, '::after').content.replace(/"/g, '')),
          firstNote: !!document.querySelector('#wysiwyg dl.cf-fn-first'),
        }
      })
      check('top-level numbers stay digits', r.top === '2.', r.top)
      check('sub-points are lettered (a. b.)', r.a === 'a.' && r.b === 'b.', `${r.a} ${r.b}`)
      check('third level is roman (i.)', r.i === 'i.', r.i)
      check('the marker sits on its first line of text', r.aligned)
      check('footnotes numbered in order of reference (named one first)', r.refs.join() === '1,2', r.refs.join())
      check('the notes start below a rule', r.firstNote)
      const box = await run(page, () => document.querySelector('#wysiwyg sup[data-type="footnote_reference"]').getBoundingClientRect().height)
      check('a reference number is a box that can be clicked', box >= 8, String(box))

      // a click on a reference goes to its note
      await page.click('#wysiwyg sup[data-type="footnote_reference"]')
      await wait(700)
      const at = await run(page, () => {
        const sel = getSelection()
        return sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('dl')?.textContent
      })
      check('clicking a reference puts the cursor in its note', /named note/.test(at || ''), String(at))
      summary()
    },
  },

  'edit-inline-view': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, updateCheck: false, spellcheck: false },
    setup: backend,
    async run(page) {
      await wait(1200)
      const r = await run(page, () => {
        const block = document.querySelector('#wysiwyg .milkdown-image-block')
        const p = [...document.querySelectorAll('#wysiwyg p')].find((p) => p.textContent.startsWith('Keys'))
        const line = p.getBoundingClientRect()
        const sub = p.querySelector('sub').getBoundingClientRect()
        const sup = p.querySelector('sup').getBoundingClientRect()
        const kbd = p.querySelector('kbd').getBoundingClientRect()
        return {
          broken: block?.classList.contains('cf-img-broken'),
          msg: block && getComputedStyle(block.querySelector('.image-wrapper'), '::after').content,
          brokenH: block?.getBoundingClientRect().height,
          subBelow: sub.bottom > sup.bottom,
          kbdInLine: kbd.top >= line.top - 2 && kbd.bottom <= line.bottom + 2,
        }
      })
      check('an image that can not load shows a box with its path', r.broken && /missing\.png/.test(r.msg || ''), String(r.msg))
      check('…a small box, not an empty gap', r.brokenH > 20 && r.brokenH < 120, String(r.brokenH))
      check('<sub> sits lower than <sup>', r.subBelow)
      check('<kbd> stays inside its line', r.kbdInLine)

      // inline math: its editor is a small box, not as tall as the window
      await page.click('#wysiwyg span[data-type="math_inline"]')
      await wait(500)
      const h = await run(page, () => document.querySelector('.milkdown-latex-inline-edit[data-show="true"]')?.getBoundingClientRect().height)
      check('the inline math editor is a small box', h > 10 && h < 120, String(h))
      await page.keyboard.press('Escape')

      // with the cursor out of view, a mode change keeps the same lines at the top of the window
      await page.click('#wysiwyg h1')
      await run(page, () => {
        const h = [...document.querySelectorAll('#wysiwyg h2')].find((h) => h.textContent === 'Far below')
        document.querySelector('#scroller').scrollTop += h.getBoundingClientRect().top - 200
      })
      await wait(300)
      const before = await run(page, () => [...document.querySelectorAll('#wysiwyg h2')].find((h) => h.textContent === 'Far below').getBoundingClientRect().top)
      await page.keyboard.press('Control+/')
      await wait(1200)
      const src = await run(page, () => {
        const line = [...document.querySelectorAll('#source .cm-line')].find((l) => l.textContent === '## Far below')
        return line ? line.getBoundingClientRect().top : null
      })
      check('source mode shows the same lines', src != null && Math.abs(src - before) < 60, `${before} → ${src}`)
      await page.keyboard.press('Control+/')
      await wait(1500)
      const back = await run(page, () => [...document.querySelectorAll('#wysiwyg h2')].find((h) => h.textContent === 'Far below').getBoundingClientRect().top)
      check('and the rendered view again', Math.abs(back - before) < 60, `${before} → ${back}`)
      summary()
    },
  },
}
