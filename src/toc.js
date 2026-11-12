// Table of contents: a line with just `[TOC]` (Typora's convention; GitLab and many Markdown tools
// read it too) shows a live, clickable list of the document's headings in the rendered view and in
// exports. The file keeps the `[TOC]` line, so other tools still see plain Markdown.
import { $remark, $nodeSchema, $view, $prose, $command, $inputRule } from '@milkdown/kit/utils'
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { InputRule } from '@milkdown/kit/prose/inputrules'

export const TOC_MARKDOWN = '[TOC]'
const TOC_RE = /^\[toc\]$/i

/** Heading text → anchor id, as GitHub makes them (also used for `#links` inside the app). */
export const slugify = (s) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')

// ───────────────────────────── Markdown
// remark reads `[TOC]` as plain text (a link reference without a definition), so a paragraph
// that holds only that text becomes the block
const isTocPara = (n) => n?.type === 'paragraph' && n.children?.length === 1 && n.children[0].type === 'text' && TOC_RE.test(n.children[0].value.trim())

function convertToc(node) {
  if (!Array.isArray(node.children)) return
  node.children = node.children.map((c) => (isTocPara(c) ? { type: 'toc' } : c))
  // only top level and inside containers (quotes, lists): a [TOC] in running text stays text
  node.children.forEach((c) => c.type !== 'paragraph' && convertToc(c))
}

function remarkToc() {
  const data = this.data()
  // written raw: the usual text handler would escape it to `\[TOC]`
  ;(data.toMarkdownExtensions ||= []).push({ handlers: { toc: () => TOC_MARKDOWN } })
  return (tree) => convertToc(tree)
}

const tocRemark = $remark('folioToc', () => remarkToc)

export const tocSchema = $nodeSchema('toc', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseDOM: [{ tag: 'div[data-type="toc"]' }],
  toDOM: () => ['div', { 'data-type': 'toc', class: 'folio-toc' }],
  parseMarkdown: {
    match: (node) => node.type === 'toc',
    runner: (state, _node, type) => {
      state.addNode(type)
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'toc',
    runner: (state) => {
      state.addNode('toc')
    },
  },
}))

// ───────────────────────────── the list in the editor
/** [{ level, text, pos }] for every heading in the document (code blocks skipped). */
export function docHeadings(doc) {
  const out = []
  doc.descendants((n, pos) => {
    if (n.type.name === 'heading') out.push({ level: n.attrs.level, text: n.textContent, pos })
    return !n.isTextblock && n.type.name !== 'code_block'
  })
  return out
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

const live = new Set() // TocViews on screen, refreshed when the headings change

class TocView {
  constructor(node, view, getPos, opts) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.opts = opts
    this.dom = el('div', 'folio-toc')
    this.dom.dataset.type = 'toc'
    this.dom.contentEditable = 'false'
    this.key = null
    this.dom.addEventListener('click', (e) => {
      const a = e.target.closest('[data-pos]')
      if (!a) return
      e.preventDefault()
      this.jump(Number(a.dataset.pos))
    })
    live.add(this)
    this.render(docHeadings(view.state.doc))
  }

  jump(pos) {
    const h = docHeadings(this.view.state.doc).find((h) => h.pos === pos)
    if (!h) return
    if (this.opts.jump) return this.opts.jump(h)
    this.view.nodeDOM(h.pos)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  render(heads) {
    // skip the DOM work while typing in a paragraph: nothing in the list changed
    const key = JSON.stringify(heads.map((h) => [h.level, h.text, h.pos]))
    if (key === this.key) return
    this.key = key
    const title = el('div', 'folio-toc-title', 'Contents')
    if (!heads.length) {
      this.dom.replaceChildren(title, el('div', 'folio-toc-empty', 'No headings yet. Lines that start with # are listed here.'))
      return
    }
    const min = Math.min(...heads.map((h) => h.level))
    const list = el('div', 'folio-toc-list')
    for (const h of heads) {
      const a = el('a', `folio-toc-item l${h.level - min + 1}`, h.text || '(empty heading)')
      a.dataset.pos = h.pos
      a.style.paddingLeft = `${(h.level - min) * 1.2}em`
      a.title = h.text
      list.append(a)
    }
    this.dom.replaceChildren(title, list)
  }

  update(node) {
    if (node.type !== this.node.type) return false
    this.node = node
    return true
  }
  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }
  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }
  // clicks on an entry jump; a click elsewhere on the block selects it as usual
  stopEvent(e) {
    return e.type === 'mousedown' && !!e.target.closest?.('[data-pos]')
  }
  ignoreMutation() {
    return true
  }
  destroy() {
    live.delete(this)
  }
}

// headings change as you type: refresh the lists a moment after, never on the keystroke itself
const refresher = $prose(
  () =>
    new Plugin({
      key: new PluginKey('folio-toc'),
      view: () => {
        let timer = 0
        return {
          update(view, prev) {
            if (prev.doc.eq(view.state.doc)) return
            clearTimeout(timer)
            timer = setTimeout(() => {
              const mine = [...live].filter((t) => t.view === view)
              if (!mine.length) return
              const heads = docHeadings(view.state.doc)
              mine.forEach((t) => t.render(heads))
            }, 150)
          },
          destroy: () => clearTimeout(timer),
        }
      },
    }),
)

/** Insert → Table of Contents: replaces an empty paragraph, else goes after the current block. */
export const insertTocCommand = $command('InsertToc', (ctx) => () => (state, dispatch) => {
  const type = tocSchema.type(ctx)
  if (dispatch) {
    const { $from } = state.selection
    let tr = state.tr
    let at
    if ($from.parent.type.name === 'paragraph' && $from.parent.content.size === 0 && $from.depth >= 1) {
      at = $from.before()
      tr = tr.replaceWith(at, $from.after(), type.create())
    } else {
      at = $from.depth >= 1 ? $from.after(1) : $from.pos
      tr = tr.insert(at, type.create())
    }
    dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView())
  }
  return true
})

// typing `[TOC]` alone in a paragraph turns it into the block right away (as opening the file
// would); the cursor goes to the line after it. Backspace right after undoes it, like other rules.
const tocInput = $inputRule(
  (ctx) =>
    new InputRule(/^\[toc\]$/i, (state, _match, start, end) => {
      const $s = state.doc.resolve(start)
      const para = $s.parent
      if (para.type.name !== 'paragraph' || $s.parentOffset !== 0 || end !== $s.end()) return null
      const before = $s.before()
      const after = $s.after()
      let tr = state.tr.replaceWith(before, after, tocSchema.type(ctx).create())
      const next = before + 1
      // reuse an empty line below; otherwise start a new one (never type into the next heading)
      const below = tr.doc.nodeAt(next)
      if (!(below?.type.name === 'paragraph' && below.content.size === 0)) tr = tr.insert(next, state.schema.nodes.paragraph.create())
      return tr.setSelection(TextSelection.create(tr.doc, next + 1))
    }),
)

/** Milkdown plugins: editor.use(toc({ jump })), jump(heading) scrolls to a { level, text, pos }. */
export const toc = (opts = {}) =>
  [tocRemark, tocSchema, $view(tocSchema.node, () => (node, v, getPos) => new TocView(node, v, getPos, opts)), refresher, tocInput, insertTocCommand].flat()

// ───────────────────────────── exports (HTML, PDF, print, page preview)
const stripTags = (s) => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Gives every heading an id (GitHub style, -1/-2 for repeats) and turns `<p>[TOC]</p>` into a linked list. */
export function renderToc(html) {
  const used = new Map()
  const heads = []
  html = html.replace(/<h([1-6])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/g, (all, lvl, attrs, inner) => {
    const text = stripTags(inner).trim()
    let id = /\sid="([^"]*)"/.exec(attrs)?.[1]
    if (!id) {
      const base = slugify(text) || 'section'
      const n = used.get(base) || 0
      used.set(base, n + 1)
      id = n ? `${base}-${n}` : base
      all = `<h${lvl}${attrs} id="${escHtml(id)}">${inner}</h${lvl}>`
    }
    heads.push({ level: Number(lvl), text, id })
    return all
  })
  if (!/<p>\s*\[toc\]\s*<\/p>/i.test(html)) return html
  const min = heads.length ? Math.min(...heads.map((h) => h.level)) : 1
  const items = heads.map((h) => `<li class="toc-l${h.level - min + 1}"><a href="#${escHtml(h.id)}">${escHtml(h.text)}</a></li>`).join('')
  const nav = `<nav class="toc"><p class="toc-title">Contents</p><ul>${items}</ul></nav>`
  return html.replace(/<p>\s*\[toc\]\s*<\/p>/gi, nav)
}

export const TOC_CSS = `
.toc{margin:1em 0 1.4em;padding:.6em 1em;border:1px solid var(--border);border-radius:6px}
.toc-title{font-weight:650;margin:0 0 .3em;color:var(--fg-strong)}
.toc ul{list-style:none;margin:0;padding:0}.toc li{margin:.15em 0}
.toc-l2{padding-left:1.2em}.toc-l3{padding-left:2.4em}.toc-l4{padding-left:3.6em}.toc-l5{padding-left:4.8em}.toc-l6{padding-left:6em}
@media print{.toc{break-inside:avoid}}`
