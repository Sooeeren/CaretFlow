// HTML inside Markdown, rendered in the WYSIWYG view (README headers, <kbd>, <details>, <img
// width=…>). Milkdown keeps HTML as an atom node with the raw text; this shows it rendered and
// cleaned, and a click (or Enter on the selected node) edits the source in place. The file
// keeps the HTML exactly as written.
import DOMPurify from 'dompurify'
import { $remark, $view, $prose } from '@milkdown/kit/utils'
import { htmlSchema } from '@milkdown/kit/preset/commonmark'
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@milkdown/kit/prose/state'

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

const joinRemark = $remark('folioJoinInlineHtml', () => () => (tree, file) => joinInlineHtml(tree, String(file ?? '')))

// ───────────────────────────── cleaning
// No scripts, event handlers, forms or frames, and nothing that could restyle or take over the
// app (<style>, id/class that match CaretFlow's own). Inline style stays (centering, widths).
const PURIFY = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'dialog'],
  FORBID_ATTR: ['id', 'class', 'name', 'autofocus', 'contenteditable', 'tabindex', 'popover'],
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
      if (e.button !== 0 || e.ctrlKey || e.metaKey || !view.editable || this.ta) return
      e.preventDefault()
      this.edit()
    })
    this.dom.addEventListener('folio-edit-html', () => this.edit())
    this.render()
  }

  isBlock() {
    const pos = this.getPos()
    if (pos == null) return false
    const $p = this.view.state.doc.resolve(pos)
    return $p.parent.type.name === 'paragraph' && $p.parent.childCount === 1
  }

  render() {
    const raw = this.node.attrs.value
    const frag = renderHtml(raw, this.opts.resolveSrc)
    this.dom.className = 'folio-html' + (frag ? '' : ' raw') + (this.isBlock() ? ' block' : '')
    this.dom.title = frag ? 'HTML – click to edit' : ''
    if (frag) this.dom.replaceChildren(frag)
    else this.dom.textContent = raw
  }

  edit() {
    if (this.ta || !this.view.editable) return
    const ta = (this.ta = document.createElement('textarea'))
    ta.className = 'folio-html-src'
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
      key: new PluginKey('folio-html-enter'),
      props: {
        handleKeyDown(view, e) {
          const sel = view.state.selection
          if (e.key !== 'Enter' || !(sel instanceof NodeSelection) || sel.node.type.name !== 'html' || !view.editable) return false
          view.nodeDOM(sel.from)?.dispatchEvent(new Event('folio-edit-html'))
          return true
        },
      },
    }),
)

/** The plugins for Crepe: `editor.use(htmlRendering({ resolveSrc }))`. */
export function htmlRendering(opts = {}) {
  const view = $view(htmlSchema.node, () => (node, v, getPos) => new HtmlView(node, v, getPos, opts))
  return [joinRemark, view, enterKey].flat()
}
