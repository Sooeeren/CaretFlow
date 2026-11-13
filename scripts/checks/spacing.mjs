// Checks that the PDF / HTML export lays a document out like the rendered editor: the same
// document is shown in both at the same width, and the space above every block (and list item)
// must match within a few pixels.
import { check, summary, stubBackend, run, wait } from './lib.mjs'

export const DOC = `# Heading one

First paragraph with **bold** text and enough words to wrap onto a second line in the editor so the line height counts too.

Second paragraph.

## Heading two

- Bullet one
- Bullet two
  - Nested bullet
  - Nested bullet two
- Bullet three

1. First
2. Second

Paragraph after a list.

- [ ] Open task
- [x] Done task

### Heading three

> A quote that is long enough to wrap onto two lines, so the line height inside quotes is compared as well.

> [!NOTE]
> A callout with its title.

\`\`\`js
const a = 1
const b = 2
\`\`\`

| Name | Count |
| --- | --- |
| Apples | 3 |
| Pears | 12 |

---

#### Heading four

Last paragraph.
`

/** [{ tag, text, top, height }] of the blocks and list items, top relative to the first block, in px */
function layout(root) {
  const blocks = []
  for (const c of root.children) {
    if (c.matches('.prosemirror-virtual-cursor, .ProseMirror-trailingBreak, .folio-fm, br, style, script')) continue
    const tag = c.classList.contains('milkdown-code-block') ? 'PRE' : c.classList.contains('milkdown-table-block') ? 'TABLE' : c.tagName
    // list items one by one (nested ones too, in document order)
    if (/^(UL|OL)$/.test(tag)) for (const li of c.querySelectorAll('li')) blocks.push({ tag: li.parentElement.closest('li') ? 'LI2' : 'LI', el: li, text: (li.querySelector('p') || li).textContent.trim() })
    else blocks.push({ tag, el: c, text: c.textContent.trim() })
  }
  const first = blocks[0]?.el.getBoundingClientRect().top || 0
  const cs = getComputedStyle(root)
  const edge = root.getBoundingClientRect().left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)
  // where the text starts: labels, check boxes, callout titles and line numbers don't count
  const skip = '.label-wrapper, .tools, .cm-gutters, .callout-marker, .callout-title, li ul, li ol'
  const textLeft = (el) => {
    const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let t; (t = w.nextNode()); ) {
      const s = t.parentElement.closest(skip)
      if (!t.nodeValue.trim() || (s && el.contains(s) && s !== el)) continue
      const i = t.nodeValue.search(/\S/)
      const r = el.ownerDocument.createRange()
      r.setStart(t, i)
      r.setEnd(t, i + 1)
      return r.getBoundingClientRect().left - edge
    }
    return 0
  }
  return blocks.map((b) => {
    const r = b.el.getBoundingClientRect()
    const width = (b.el.querySelector('tr') || b.el).getBoundingClientRect().width // a row: Milkdown keeps a hidden helper table
    return { tag: b.tag, text: b.text.replace(/\s+/g, ' ').slice(0, 18), top: r.top - first, height: r.height, left: textLeft(b.el), width }
  })
}

const SCENE = (settings) => ({
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false, nestedLists: true, ...settings },
    setup: (page) => stubBackend(page, { read_text: () => DOC }),
    async run(page) {
      await wait(1200)
      const r = await run(page, async (layoutSrc) => {
        const layout = eval('(' + layoutSrc + ')')
        const pm = document.querySelector('#wysiwyg .ProseMirror')
        // code blocks get their CodeMirror editor once they are on screen
        for (const b of pm.querySelectorAll('.milkdown-code-block')) b.scrollIntoView()
        await new Promise((res) => setTimeout(res, 800))
        document.querySelector('#scroller').scrollTop = 0
        const editor = layout(pm)
        const cs = getComputedStyle(document.documentElement)
        const vars = ['--bg', '--fg', '--fg-strong', '--muted', '--chrome', '--border', '--link', '--code-bg', '--code-fg', '--quote', '--quote-bar', '--doc-font', '--doc-size', '--doc-width', '--doc-lh', '--heading-space', '--font-mono']
          .map((v) => `${v}:${cs.getPropertyValue(v)}`)
          .join(';')
        const { toHtml } = await import('/src/export.js')
        const html = await toHtml(await window.__TAURI_INTERNALS__.invoke('read_text', {}), { themeVars: vars, inlineKatex: true, nestedLists: true })
        const f = document.createElement('iframe')
        f.style.cssText = `position:fixed;left:0;top:0;width:${pm.getBoundingClientRect().width}px;height:3000px;border:0;z-index:99999;background:#fff`
        document.body.append(f)
        await new Promise((res) => {
          f.onload = res
          f.srcdoc = html
        })
        await new Promise((res) => setTimeout(res, 500))
        const exported = layout(f.contentDocument.body)
        f.remove()
        return { editor, exported, size: parseFloat(cs.getPropertyValue('--doc-size')) }
      }, layout.toString())
      if (r.error) return check('measured', false, r.error)
      const { editor, exported } = r
      check('same blocks in both', editor.length === exported.length, `${editor.map((b) => b.tag).join(' ')} | ${exported.map((b) => b.tag).join(' ')}`)
      const n = Math.min(editor.length, exported.length)
      let worst = 0
      const rows = []
      for (let i = 1; i < n; i++) {
        const ge = editor[i].top - editor[i - 1].top
        const gx = exported[i].top - exported[i - 1].top
        const d = gx - ge
        worst = Math.max(worst, Math.abs(d))
        rows.push(`${editor[i].tag.padEnd(10)} ${editor[i].text.padEnd(20)} editor ${ge.toFixed(1).padStart(6)}  export ${gx.toFixed(1).padStart(6)}  ${d > 0 ? '+' : ''}${d.toFixed(1).padEnd(6)} h ${editor[i].height.toFixed(1)} / ${exported[i].height.toFixed(1)}`)
      }
      if (process.env.SPACING_TABLE) console.log(rows.join('\n'))
      for (let i = 1; i < n; i++) {
        const d = exported[i].top - exported[i - 1].top - (editor[i].top - editor[i - 1].top)
        check(`${editor[i].tag} "${editor[i].text}" step`, Math.abs(d) <= 3, `${d > 0 ? '+' : ''}${d.toFixed(1)}px`)
      }
      for (let i = 0; i < n; i++) {
        const [e, x] = [editor[i], exported[i]]
        if (e.tag === 'PRE') continue // the editor shows line numbers in code blocks
        if (e.text.startsWith('[!')) continue // the editor's callout text starts after the hidden line break's space
        check(`${e.tag} "${e.text}" text starts at the same x`, Math.abs(x.left - e.left) <= 3, `editor ${e.left.toFixed(1)} export ${x.left.toFixed(1)}`)
        if (e.tag === 'TABLE') check('table as wide as in the editor', Math.abs(x.width - e.width) <= 3, `editor ${e.width.toFixed(0)} export ${x.width.toFixed(0)}`)
      }
      check('total height within 1%', Math.abs(exported[n - 1].top - editor[n - 1].top) <= editor[n - 1].top * 0.01, `editor ${editor[n - 1].top.toFixed(0)} export ${exported[n - 1].top.toFixed(0)}`)
      summary()
    },
})

export const scenes = {
  spacing: SCENE({ fontSize: 16, lineHeight: 1.7, width: 760 }),
  // other text settings: everything follows the text size and line height
  'spacing-large': SCENE({ fontSize: 19, lineHeight: 1.45, width: 640, headingSpacing: 1.3 }),
}
