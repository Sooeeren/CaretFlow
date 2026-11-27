// HTML inside Markdown, rendered in the WYSIWYG view (README headers, <kbd>, <details>, <img
// width=…>). Milkdown keeps HTML as an atom node with the raw text; this shows it rendered and
// cleaned, and a click (or Enter on the selected node) edits the source in place. The file
// keeps the HTML exactly as written.
import DOMPurify from 'dompurify'
import { $remark, $view, $prose } from '@milkdown/kit/utils'
import { htmlSchema } from '@milkdown/kit/preset/commonmark'
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

// ───────────────────────────── one node per inline tag pair
// remark splits `<kbd>Ctrl</kbd>` into html "<kbd>", text, html "</kbd>". Join such pairs into
// one html node (straight from the source text, so nothing changes on save), so they can be
// shown rendered. <u> stays a real mark (underline.js). Only inside paragraphs and other
// phrasing: at block level an open tag can enclose Markdown, which must stay editable.
const OPEN_TAG = /^<([a-z][\w-]*)\b[^>]*>$/i
const CLOSE_TAG = /^<\/([a-z][\w-]*)\s*>$/i
const VOID = new Set(['br', 'img', 'hr', 'wbr', 'input', 'source', 'area', 'col', 'embed', 'track', 'meta', 'link', 'param'])
const BLOCK_PARENTS = new Set(['root', 'blockquote', 'list', 'listItem', 'footnoteDefinition'])

const tagOf = (n, re) => n.type === 'html' && n.value.trim().match(re)?.[1].toLowerCase()

export function joinInlineHtml(node, src) {
  if (!Array.isArray(node.children)) return
  node.children.forEach((c) => joinInlineHtml(c, src))
  if (BLOCK_PARENTS.has(node.type)) return
  const kids = node.children
  const out = []
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]
    const tag = tagOf(c, OPEN_TAG)
    if (tag && tag !== 'u' && !VOID.has(tag) && !c.value.trim().endsWith('/>') && c.position) {
      let depth = 1
      let j = i + 1
      for (; j < kids.length; j++) {
        if (tagOf(kids[j], OPEN_TAG) === tag) depth++
        else if (tagOf(kids[j], CLOSE_TAG) === tag && --depth === 0) break
      }
      const end = kids[j]?.position
      if (j < kids.length && end) {
        out.push({ type: 'html', value: src.slice(c.position.start.offset, end.end.offset), position: { start: c.position.start, end: end.end } })
        i = j
        continue
      }
    }
    out.push(c)
  }
  node.children = out
}

const joinRemark = $remark('cfJoinInlineHtml', () => () => (tree, file) => joinInlineHtml(tree, String(file ?? '')))

// ───────────────────────────── cleaning
// No scripts, event handlers, forms or frames, and nothing that could restyle or take over the
// app (<style>, id/class that match CaretFlow's own). Inline style stays (centering, widths).
const PURIFY = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'dialog'],
  FORBID_ATTR: ['id', 'class', 'name', 'autofocus', 'contenteditable', 'tabindex', 'popover'],
}
const FORBIDDEN_EL = new Set(['SCRIPT', ...PURIFY.FORBID_TAGS.map((t) => t.toUpperCase())])

/** True when `raw` holds only elements the sanitizer removes (<script>, <form>, <iframe>…), not comments or lone wrapper tags. */
function isStrippedHtml(raw) {
  if (/<!--/.test(raw)) return false
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  const els = [...doc.head.children, ...doc.body.children]
  return els.length > 0 && els.every((e) => FORBIDDEN_EL.has(e.tagName)) && ![...doc.body.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())
}

/** Cleaned HTML as a fragment, local image paths made loadable, or null if nothing would show. */
export function renderHtml(raw, resolveSrc = (s) => s) {
  const tpl = document.createElement('template')
  tpl.innerHTML = DOMPurify.sanitize(raw, PURIFY)
  const f = tpl.content
  for (const img of f.querySelectorAll('img[src], video[src], audio[src], source[src]')) img.setAttribute('src', resolveSrc(img.getAttribute('src')))
  for (const s of f.querySelectorAll('[srcset]'))
    s.setAttribute(
      'srcset',
      s
        .getAttribute('srcset')
        .split(',')
        .map((part) => part.trim().replace(/^\S+/, (u) => resolveSrc(u)))
        .join(', '),
    )
  // links open with Ctrl+click like Markdown links; the webview never navigates
  for (const a of f.querySelectorAll('a[target]')) a.removeAttribute('target')
  // nothing may pin itself over the app (block HTML isn't contained, so floats can flow on)
  for (const e of f.querySelectorAll('[style]')) if (/fixed|sticky/i.test(e.style.position)) e.style.position = 'static'
  // a lone tag or a comment shows nothing: keep it visible as source instead
  const shows = f.textContent.trim() || f.querySelector('img, hr, br, svg, video, audio, table, picture, details')
  return shows ? f : null
}

// ───────────────────────────── node view
class HtmlView {
  constructor(node, view, getPos, opts) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.opts = opts
    this.dom = document.createElement('span')
    this.dom.contentEditable = 'false'
    this.dom.addEventListener('mousedown', (e) => {
      // Ctrl+click opens links (main.js); read-only shows, never edits
      if (e.button !== 0 || e.ctrlKey || e.metaKey || this.ta) return
      // a <details> summary line opens and closes its section (also read-only); a double click edits it
      if (this.isDetailsHead()) {
        e.preventDefault()
        const pos = this.getPos()
        if (pos != null) toggleDetails(view, pos - 1)
        if (e.detail === 2 && view.editable) {
          toggleDetails(view, pos - 1)
          this.edit()
        }
        return
      }
      // a whole <details> in one piece of HTML: its summary opens and closes it, the browser's way
      if (e.target.closest?.('details > summary')) return
      if (!view.editable) return
      e.preventDefault()
      this.edit()
    })
    this.dom.addEventListener('cf-edit-html', () => this.edit())
    this.render()
  }

  isBlock() {
    const pos = this.getPos()
    if (pos == null) return false
    const $p = this.view.state.doc.resolve(pos)
    return $p.parent.type.name === 'paragraph' && $p.parent.childCount === 1
  }

  isDetailsHead() {
    return DETAILS_OPEN.test(this.node.attrs.value.trim()) && this.isBlock()
  }

  render() {
    const raw = this.node.attrs.value
    if (this.isDetailsHead()) {
      // the summary with an arrow; the section's blocks follow as Markdown (wrapDecorations)
      const summary = DETAILS_OPEN.exec(raw.trim())[2]
      const frag = summary?.trim() ? renderHtml(summary, this.opts.resolveSrc) : null
      const label = document.createElement('span')
      label.className = 'cf-summary'
      if (frag) label.append(frag)
      else label.textContent = 'Details'
      this.dom.className = 'cf-html block cf-details-summary'
      this.dom.title = 'Click to open or close · double-click to edit the HTML'
      this.dom.replaceChildren(label)
      return
    }
    const frag = renderHtml(raw, this.opts.resolveSrc)
    const stripped = !frag && isStrippedHtml(raw)
    this.dom.className = 'cf-html' + (frag ? '' : stripped ? ' stripped' : ' raw') + (this.isBlock() ? ' block' : '')
    this.dom.title = frag ? 'HTML – click to edit' : ''
    if (frag) this.dom.replaceChildren(frag)
    else this.dom.textContent = stripped ? '' : raw
  }

  edit() {
    if (this.ta || !this.view.editable) return
    const ta = (this.ta = document.createElement('textarea'))
    ta.className = 'cf-html-src'
    ta.spellcheck = false
    ta.value = this.node.attrs.value
    const fit = () => {
      ta.rows = Math.max(1, ta.value.split('\n').length)
      ta.style.width = this.isBlock() ? '' : Math.min(60, Math.max(8, ...ta.value.split('\n').map((l) => l.length + 2))) + 'ch'
    }
    fit()
    ta.addEventListener('input', fit)
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        ta.value = this.node.attrs.value
        this.close()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !this.isBlock())) {
        e.preventDefault()
        this.close()
      }
    })
    ta.addEventListener('blur', () => this.close(false))
    this.dom.classList.add('editing')
    this.dom.replaceChildren(ta)
    requestAnimationFrame(() => ta.focus())
  }

  /** Save the edited source (empty removes the node) and go back to the rendered view. */
  close(refocus = true) {
    const ta = this.ta
    if (!ta) return
    this.ta = null
    this.dom.classList.remove('editing')
    const value = ta.value
    const pos = this.getPos()
    if (pos != null && value !== this.node.attrs.value) {
      const { state } = this.view
      let tr = value.trim() ? state.tr.setNodeMarkup(pos, null, { value }) : state.tr.delete(pos, pos + this.node.nodeSize)
      if (refocus) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + (value.trim() ? this.node.nodeSize : 0), tr.doc.content.size))))
      this.view.dispatch(tr)
    } else if (refocus && pos != null) {
      const { state } = this.view
      this.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos + this.node.nodeSize))))
    }
    this.render()
    if (refocus) this.view.focus()
  }

  update(node) {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.ta) this.render()
    return true
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
  }
  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
  }
  stopEvent(e) {
    // events in the source box are its own; a plain click opens it (the mousedown handler above)
    if (this.ta) return this.ta.contains(e.target)
    return e.type === 'mousedown' && e.button === 0 && !e.ctrlKey && !e.metaKey && this.view.editable
  }
  ignoreMutation() {
    return true
  }
  destroy() {
    this.ta = null
  }
}

// Enter on a selected HTML node edits it, as a click does
const enterKey = $prose(
  () =>
    new Plugin({
      key: new PluginKey('cf-html-enter'),
      props: {
        handleKeyDown(view, e) {
          const sel = view.state.selection
          if (e.key !== 'Enter' || !(sel instanceof NodeSelection) || sel.node.type.name !== 'html' || !view.editable) return false
          view.nodeDOM(sel.from)?.dispatchEvent(new Event('cf-edit-html'))
          return true
        },
      },
    }),
)

// ───────────────────────────── wrappers around Markdown
// README headers put Markdown between a lone `<div align="center">` line and a lone `</div>` line
// (blank lines around both, so the Markdown inside is parsed). Markdown sees three separate things;
// this pairs the two tag lines and gives the blocks between them the wrapper's alignment and text
// styles, so they show as on GitHub and stay editable Markdown. The tag lines themselves are hidden;
// source mode shows them, to edit or delete.
// `<details><summary>…</summary>` … `</details>` works the same way: a click on the summary line
// opens and closes the blocks up to `</details>`. The file is never changed.
const WRAP_OPEN = /^<(div|center|p|section|article|span|font)\b([^>]*)>$/i
const WRAP_CLOSE = /^<\/(div|center|p|section|article|span|font|details)\s*>$/i
export const DETAILS_OPEN = /^<details\b([^>]*)>\s*(?:<summary\b[^>]*>([\s\S]*?)<\/summary>)?$/i
// only what changes how text looks: nothing that could move a block over the app
const WRAP_STYLES = ['text-align', 'color', 'font-size', 'font-weight', 'font-style', 'font-family', 'line-height']

/** The lone tag in an html-only paragraph, or null. */
function loneTag(node) {
  if (node.type.name !== 'paragraph' || node.childCount !== 1 || node.firstChild.type.name !== 'html') return null
  const v = node.firstChild.attrs.value.trim()
  const det = DETAILS_OPEN.exec(v)
  if (det) return { open: true, tag: 'details', css: '', details: true, startsOpen: /\bopen\b/i.test(det[1]) }
  const open = WRAP_OPEN.exec(v)
  if (open) return { open: true, tag: open[1].toLowerCase(), css: wrapCss(open[1], open[2]) }
  const close = WRAP_CLOSE.exec(v)
  return close ? { open: false, tag: close[1].toLowerCase() } : null
}

/** The CSS a wrapper's attributes give the blocks inside it (`align`, safe parts of `style`). */
export function wrapCss(tag, attrs) {
  const tpl = document.createElement('template')
  tpl.innerHTML = DOMPurify.sanitize(`<div${attrs}></div>`, PURIFY)
  const src = tpl.content.firstElementChild
  const probe = document.createElement('div')
  if (src?.getAttribute('style')) probe.style.cssText = src.getAttribute('style')
  const out = WRAP_STYLES.filter((p) => probe.style.getPropertyValue(p)).map((p) => `${p}: ${probe.style.getPropertyValue(p)}`)
  const align = tag.toLowerCase() === 'center' ? 'center' : src?.getAttribute('align')?.toLowerCase()
  if (align && /^(left|right|center|justify)$/.test(align) && !probe.style.textAlign) out.unshift(`text-align: ${align}`)
  return out.join('; ')
}

/**
 * The wrappers of a document, found again when the text changes: tag lines to hide, blocks a
 * wrapper styles, and <details> sections (summary line, the blocks inside, the closing line).
 */
export function findWrappers(doc) {
  const tags = []
  const styled = []
  const details = []
  const scan = (parent, base) => {
    const stack = []
    parent.forEach((child, offset) => {
      const pos = base + offset
      const t = loneTag(child)
      if (t?.open) {
        stack.push({ ...t, pos, size: child.nodeSize, inner: [] })
        return
      }
      if (t && stack.length && stack[stack.length - 1].tag === t.tag) {
        const w = stack.pop()
        tags.push({ pos, size: child.nodeSize })
        if (w.details) {
          details.push({ pos: w.pos, startsOpen: w.startsOpen, body: w.inner.map(({ pos, size }) => ({ pos, size })) })
          if (stack.length) stack[stack.length - 1].inner.push({ pos: w.pos, size: w.size, css: '' }, ...w.inner)
          return
        }
        tags.push({ pos: w.pos, size: w.size })
        // one style per block: the outer wrapper's first, so an inner wrapper's own values win
        for (const b of w.inner) b.css = [w.css, b.css].filter(Boolean).join('; ')
        if (stack.length) stack[stack.length - 1].inner.push(...w.inner)
        else for (const b of w.inner) if (b.css) styled.push(b)
        return
      }
      if (stack.length) stack[stack.length - 1].inner.push({ pos, size: child.nodeSize, css: '' })
      // Markdown inside quotes and lists can hold wrappers too
      if (!child.isTextblock && child.childCount && child.firstChild.isBlock) scan(child, pos + 1)
    })
    // an opening line that is never closed styles nothing and stays a visible line of HTML
  }
  scan(doc, 0)
  return { tags, styled, details }
}

/**
 * Decorations: tag lines hidden (source mode shows them), wrapped blocks styled, the
 * blocks of a closed <details> folded away. `open` holds the summary lines the user toggled.
 */
export function wrapDecorations(doc, w = findWrappers(doc), sel = null, open = new Set()) {
  if (!w.tags.length && !w.styled.length && !w.details.length) return DecorationSet.empty
  const decos = []
  const touches = (a, b) => !!sel && sel.from <= b && sel.to >= a
  for (const t of w.tags) decos.push(Decoration.node(t.pos, t.pos + t.size, { class: 'cf-html-wrap-tag' }))
  for (const b of w.styled) decos.push(Decoration.node(b.pos, b.pos + b.size, { style: b.css }))
  for (const d of w.details) {
    const isOpen = open.has(d.pos) !== d.startsOpen
    decos.push(Decoration.node(d.pos, d.pos + doc.nodeAt(d.pos).nodeSize, { class: 'cf-details-head' + (isOpen ? ' cf-details-open' : '') }))
    if (isOpen || !d.body.length) continue
    // closed, unless the cursor went inside (with the arrow keys): nobody should type unseen
    const last = d.body[d.body.length - 1]
    if (touches(d.body[0].pos, last.pos + last.size)) continue
    for (const b of d.body) decos.push(Decoration.node(b.pos, b.pos + b.size, { class: 'cf-details-folded' }))
  }
  return DecorationSet.create(doc, decos)
}

const wrapKey = new PluginKey('cf-html-wrap')
const wrapState = (doc, sel, w, open) => ({ w, open, decos: wrapDecorations(doc, w, sel, open) })
const wrapPlugin = $prose(
  () =>
    new Plugin({
      key: wrapKey,
      state: {
        init: (_, { doc, selection }) => wrapState(doc, selection, findWrappers(doc), new Set()),
        apply: (tr, old, _before, state) => {
          const toggle = tr.getMeta(wrapKey)
          if (!tr.docChanged && !tr.selectionSet && toggle == null) return old
          const w = tr.docChanged ? findWrappers(state.doc) : old.w
          // most documents have no wrappers: nothing to redo when only the cursor moves
          if (!tr.docChanged && toggle == null && !w.tags.length && !w.details.length) return old
          let open = old.open
          if (tr.docChanged) open = new Set([...open].map((p) => tr.mapping.map(p)))
          if (toggle != null) {
            open = new Set(open)
            if (open.has(toggle)) open.delete(toggle)
            else open.add(toggle)
          }
          return wrapState(state.doc, state.selection, w, open)
        },
      },
      props: { decorations: (state) => wrapKey.getState(state).decos },
    }),
)

/** Opens or closes the <details> section whose summary line is the paragraph at `pos`. */
function toggleDetails(view, pos) {
  view.dispatch(view.state.tr.setMeta(wrapKey, pos))
}

/** The plugins for Crepe: `editor.use(htmlRendering({ resolveSrc }))`. */
export function htmlRendering(opts = {}) {
  const view = $view(htmlSchema.node, () => (node, v, getPos) => new HtmlView(node, v, getPos, opts))
  return [joinRemark, view, enterKey, wrapPlugin].flat()
}
