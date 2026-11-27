// Numbers of nested ordered lists as letters and roman numerals (a. b. c., then i. ii. iii.), like
// exports and Word do with Preferences → Editing → Style sub-points differently. Milkdown draws the
// marker itself, from the item's "1." label, so CSS list-style-type can't reach it: each item gets
// its marker as a CSS variable (--cf-marker), which style.css shows instead of the label under
// body.nested-lists. The Markdown keeps its digits.
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

export function alpha(n) {
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(97 + ((n - 1) % 26)) + s
  return s
}

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
export function roman(n) {
  let s = ''
  for (const [v, r] of ROMAN) for (; n >= v; n -= v) s += r
  return s
}

/** The marker of an ordered item `n` at ordered-list depth `depth` (1 = top level, digits). */
export function nestedMarker(n, depth) {
  if (depth <= 1 || !(n > 0)) return null
  return (depth % 2 === 0 ? alpha(n) : roman(n)) + '.'
}

function markerDecorations(doc) {
  const decos = []
  const walk = (node, base, depth) => {
    node.forEach((child, offset) => {
      const pos = base + offset
      const name = child.type.name
      if (name === 'ordered_list' || name === 'bullet_list') {
        walk(child, pos + 1, depth + (name === 'ordered_list' ? 1 : 0))
        return
      }
      if (name === 'list_item') {
        if (child.attrs.listType === 'ordered') {
          const m = nestedMarker(parseInt(child.attrs.label, 10), depth)
          if (m) decos.push(Decoration.node(pos, pos + child.nodeSize, { style: `--cf-marker: "${m}"`, 'data-cf-marker': '' }))
        }
        walk(child, pos + 1, depth)
        return
      }
      // lists sit in quotes, callouts and the top level; nothing deeper in a paragraph
      if (!child.isTextblock && child.childCount) walk(child, pos + 1, depth)
    })
  }
  walk(doc, 0, 0)
  return DecorationSet.create(doc, decos)
}

const key = new PluginKey('cf-list-markers')
export const listMarkers = $prose(
  () =>
    new Plugin({
      key,
      state: {
        init: (_, { doc }) => markerDecorations(doc),
        apply: (tr, old) => (tr.docChanged ? markerDecorations(tr.doc) : old),
      },
      props: { decorations: (state) => key.getState(state) },
    }),
)
