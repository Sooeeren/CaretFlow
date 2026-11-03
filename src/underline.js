// Underline support. Markdown has no underline syntax, so (like Typora) it is stored as
// inline HTML: <u>text</u>. This plugin turns those HTML tag pairs into a real mark
// while editing and writes them back on save.
import { $markSchema, $command, $remark } from '@milkdown/kit/utils'
import { toggleMark } from '@milkdown/kit/prose/commands'

const OPEN = /^<u>$/i
const CLOSE = /^<\/u>$/i

/** mdast transform: [html "<u>", …phrasing…, html "</u>"] → { type: "underline", children } */
function groupUnderline(node) {
  if (!Array.isArray(node.children)) return
  const out = []
  for (let i = 0; i < node.children.length; i++) {
    const c = node.children[i]
    if (c.type === 'html' && OPEN.test(c.value.trim())) {
      let depth = 1
      let j = i + 1
      for (; j < node.children.length; j++) {
        const d = node.children[j]
        if (d.type !== 'html') continue
        if (OPEN.test(d.value.trim())) depth++
        else if (CLOSE.test(d.value.trim()) && --depth === 0) break
      }
      if (j < node.children.length) {
        const u = { type: 'underline', children: node.children.slice(i + 1, j) }
        groupUnderline(u)
        out.push(u)
        i = j
        continue
      }
    }
    groupUnderline(c)
    out.push(c)
  }
  node.children = out
}

export function remarkUnderline() {
  const data = this.data()
  ;(data.toMarkdownExtensions ||= []).push({
    handlers: {
      underline(node, _parent, state, info) {
        const exit = state.enter('phrasing')
        const inner = state.containerPhrasing(node, { ...info, before: '>', after: '<' })
        exit()
        return `<u>${inner}</u>`
      },
    },
  })
  return (tree) => groupUnderline(tree)
}

export const underlineRemark = $remark('remarkUnderline', () => remarkUnderline)

export const underlineSchema = $markSchema('underline', () => ({
  parseDOM: [
    { tag: 'u' },
    { style: 'text-decoration', getAttrs: (v) => (String(v).includes('underline') ? null : false) },
    { style: 'text-decoration-line', getAttrs: (v) => (String(v).includes('underline') ? null : false) },
  ],
  toDOM: () => ['u', 0],
  parseMarkdown: {
    match: (node) => node.type === 'underline',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'underline',
    runner: (state, mark) => {
      state.withMark(mark, 'underline')
    },
  },
}))

export const toggleUnderlineCommand = $command('ToggleUnderline', (ctx) => () => toggleMark(underlineSchema.type(ctx)))

export const underline = [underlineRemark, underlineSchema, toggleUnderlineCommand].flat()
