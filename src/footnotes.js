// Footnotes in the rendered view, the way GitHub shows them: references are small numbers in the
// order they first appear in the text (a named one, [^note], too), the notes are numbered the same
// and sit below a rule, and a click goes from a reference to its note and back. The Markdown keeps
// its labels. The numbers reach the DOM as a CSS variable (--cf-fn), shown by style.css.
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

function footnotes(doc) {
  const refs = []
  const defs = []
  doc.descendants((n, pos) => {
    if (n.type.name === 'footnote_reference') refs.push({ pos, node: n })
    else if (n.type.name === 'footnote_definition') defs.push({ pos, node: n })
    // references sit in text, notes at block level: nothing to find inside code
    return n.type.name !== 'code_block'
  })
  if (!refs.length && !defs.length) return null
  const num = new Map()
  for (const r of refs) if (!num.has(r.node.attrs.label)) num.set(r.node.attrs.label, num.size + 1)
  for (const d of defs) if (!num.has(d.node.attrs.label)) num.set(d.node.attrs.label, num.size + 1)
  return { refs, defs, num }
}

function decorations(doc) {
  const f = footnotes(doc)
  if (!f) return DecorationSet.empty
  const decos = []
  const deco = (pos, node, extra = {}) => decos.push(Decoration.node(pos, pos + node.nodeSize, { style: `--cf-fn: "${f.num.get(node.attrs.label)}"`, ...extra }))
  for (const r of f.refs) deco(r.pos, r.node, { title: `Footnote ${f.num.get(r.node.attrs.label)} – click to go to it` })
  f.defs.forEach((d, i) => {
    // the rule goes above the first note of each run of notes
    const before = i > 0 && f.defs[i - 1].pos + f.defs[i - 1].node.nodeSize === d.pos
    deco(d.pos, d.node, before ? {} : { class: 'cf-fn-first' })
  })
  return DecorationSet.create(doc, decos)
}

function goTo(view, pos, nodeSize) {
  const dom = view.nodeDOM(pos)
  dom?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(Math.min(pos + nodeSize, view.state.doc.content.size)))))
    view.focus()
  } catch {}
}

const isFn = (n) => n.type.name === 'footnote_reference' || n.type.name === 'footnote_definition'

/** Whether a change adds or removes a footnote; typing elsewhere only moves the numbers along. */
function touchesFootnotes(tr) {
  return tr.steps.some((step, i) => {
    let hit = false
    step.slice?.content.descendants((n) => {
      if (isFn(n)) hit = true
      return !hit
    })
    const before = tr.docs[i]
    step.getMap().forEach((from, to) => {
      if (!hit && to > from)
        before.nodesBetween(from, to, (n) => {
          if (isFn(n)) hit = true
          return !hit
        })
    })
    return hit
  })
}

const key = new PluginKey('cf-footnotes')
export const footnotePlugin = $prose(
  () =>
    new Plugin({
      key,
      state: {
        init: (_, { doc }) => decorations(doc),
        apply: (tr, old) => (!tr.docChanged ? old : touchesFootnotes(tr) ? decorations(tr.doc) : old.map(tr.mapping, tr.doc)),
      },
      props: {
        decorations: (state) => key.getState(state),
        handleClickOn(view, _pos, node, nodePos, event) {
          const f = (name) => footnotes(view.state.doc)?.[name] || []
          if (node.type.name === 'footnote_reference') {
            const d = f('defs').find((d) => d.node.attrs.label === node.attrs.label)
            if (d) goTo(view, d.pos, 2)
            return !!d
          }
          // the note's number leads back to where the text refers to it
          if (node.type.name === 'footnote_definition' && event.target.closest?.('dt')) {
            const r = f('refs').find((r) => r.node.attrs.label === node.attrs.label)
            if (r) goTo(view, r.pos, r.node.nodeSize)
            return !!r
          }
          return false
        },
      },
    }),
)
