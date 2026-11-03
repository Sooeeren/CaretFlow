// Page breaks and callouts (GitHub-style alerts) for the WYSIWYG editor.
import { $nodeSchema, $remark, $command, $prose } from '@milkdown/kit/utils'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

// ───────────────────────────── page break
// Stored as the HTML convention Typora and most Markdown→PDF tools understand.
export const PAGE_BREAK_HTML = '<div style="page-break-after: always;"></div>'
const PAGE_BREAK_RE = /^<div\s+style\s*=\s*["']\s*(?:page-break-after|break-after)\s*:\s*(?:always|page)\s*;?\s*["']\s*>\s*<\/div>$/i

const isBreakHtml = (n) => n?.type === 'html' && typeof n.value === 'string' && PAGE_BREAK_RE.test(n.value.trim())

export function convertPageBreaks(node) {
  if (!Array.isArray(node.children)) return
  node.children = node.children.map((c) => {
    if (isBreakHtml(c)) return { type: 'pageBreak' }
    // Milkdown's HTML transformer wraps block-level HTML in a paragraph — unwrap ours again
    if (c.type === 'paragraph' && c.children?.length === 1 && isBreakHtml(c.children[0])) return { type: 'pageBreak' }
    return c
  })
  node.children.forEach(convertPageBreaks)
}

export function remarkPageBreak() {
  const data = this.data()
  ;(data.toMarkdownExtensions ||= []).push({ handlers: { pageBreak: () => PAGE_BREAK_HTML } })
  return (tree) => convertPageBreaks(tree)
}

export const pageBreakRemark = $remark('remarkPageBreak', () => remarkPageBreak)

export const pageBreakSchema = $nodeSchema('page_break', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseDOM: [
    { tag: 'div[data-type="page-break"]' },
    { tag: 'div', getAttrs: (d) => (/(page-break-after|break-after)\s*:\s*(always|page)/i.test(d.getAttribute('style') || '') ? {} : false) },
  ],
  toDOM: () => ['div', { 'data-type': 'page-break', class: 'folio-page-break', contenteditable: 'false' }, ['span', 'Page break']],
  parseMarkdown: {
    match: (node) => node.type === 'pageBreak',
    runner: (state, _node, type) => {
      state.addNode(type)
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'page_break',
    runner: (state) => {
      state.addNode('pageBreak')
    },
  },
}))

export const insertPageBreakCommand = $command('InsertPageBreak', (ctx) => () => (state, dispatch) => {
  const type = pageBreakSchema.type(ctx)
  if (dispatch) {
    const { $from } = state.selection
    let tr = state.tr
    // an empty paragraph is replaced; otherwise the break goes after the current block
    if ($from.parent.type.name === 'paragraph' && $from.parent.content.size === 0 && $from.depth >= 1) {
      tr = tr.replaceWith($from.before(), $from.after(), type.create())
    } else {
      const at = $from.depth >= 1 ? $from.after(1) : $from.pos
      tr = tr.insert(at, type.create())
    }
    dispatch(tr.scrollIntoView())
  }
  return true
})

export const pageBreak = [pageBreakRemark, pageBreakSchema, insertPageBreakCommand].flat()

// ───────────────────────────── callouts:  > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
export const CALLOUTS = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}
export const CALLOUT_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*/i
const ESCAPED_RE = /^\\\[!(note|tip|important|warning|caution)\]/i

/**
 * The Markdown writer escapes "[" at the start of text ("\[!NOTE]"), which breaks the alert
 * syntax. Wrap a `text` handler so the marker stays literal at the start of a paragraph.
 */
export function unescapeCalloutText(textHandler) {
  return function text(node, parent, state, info) {
    const out = textHandler ? textHandler(node, parent, state, info) : state.safe(node.value, info)
    if (parent?.type === 'paragraph' && parent.children[0] === node && ESCAPED_RE.test(out)) return out.slice(1)
    return out
  }
}

/** Plain remark plugin (used outside Milkdown, e.g. in tests). */
export function remarkCalloutMarkers() {
  const data = this.data()
  ;(data.toMarkdownExtensions ||= []).push({ handlers: { text: unescapeCalloutText() } })
}

/**
 * Milkdown passes its own `text` handler through the stringify options, and those take
 * precedence over plugin extensions, so wrap that handler in the options themselves.
 */
const calloutStringify = (ctx) => {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    handlers: { ...prev.handlers, text: unescapeCalloutText(prev.handlers?.text) },
  }))
}

const calloutKey = new PluginKey('folio-callouts')

function calloutDecorations(state) {
  const decos = []
  const { from: selFrom, to: selTo } = state.selection
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'blockquote') return !node.isTextblock
    const first = node.firstChild
    if (first?.isTextblock) {
      const m = CALLOUT_RE.exec(first.textContent)
      // only when the marker is plain text at the very start of the first paragraph
      if (m && first.firstChild?.isText && first.firstChild.text.length >= m[0].trimEnd().length) {
        const kind = m[1].toLowerCase()
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `callout callout-${kind}`, 'data-callout': kind }))
        const start = pos + 2 // inside blockquote > paragraph
        const editing = selFrom <= pos + 2 + first.content.size && selTo >= start
        // when shown as a title, also swallow the space/line break after the marker so the
        // body starts cleanly on the next line (like GitHub renders it)
        const ws = /^[ \t\n]*/.exec(first.firstChild.text.slice(m[0].trimEnd().length))[0].length
        const end = start + m[0].trimEnd().length + (editing ? 0 : ws)
        decos.push(
          Decoration.inline(start, end, {
            class: 'callout-marker' + (editing ? ' editing' : ''),
            'data-label': CALLOUTS[kind],
          }),
        )
      }
    }
    return true // callouts can be nested in lists etc.
  })
  return DecorationSet.create(state.doc, decos)
}

export const calloutPlugin = $prose(
  () =>
    new Plugin({
      key: calloutKey,
      state: {
        init: (_c, state) => calloutDecorations(state),
        apply(tr, old, _o, state) {
          return tr.docChanged || tr.selectionSet ? calloutDecorations(state) : old
        },
      },
      props: { decorations: (state) => calloutKey.getState(state) },
    }),
)

/** Milkdown plugin list: use as editor.config(calloutConfig).use(callouts) */
export const calloutConfig = calloutStringify
export const callouts = [calloutPlugin].flat()

// GitHub-style alerts:  > [!NOTE] …  →  <blockquote class="callout callout-note"><p class="callout-title">Note</p>…
export function renderCallouts(html) {
  return html
    .replace(/<blockquote>\s*<p>\[!(note|tip|important|warning|caution)\][ \t]*(?:<br\s*\/?>|\n)?/gi, (_, t) => {
      const k = t.toLowerCase()
      return `<blockquote class="callout callout-${k}"><p class="callout-title">${CALLOUTS[k]}</p><p>`
    })
    .replace(/(<p class="callout-title">[^<]*<\/p>)<p>\s*<\/p>/g, '$1')
}
