// Front matter: the YAML (`---`) or TOML (`+++`) block at the very top of a file, used by Jekyll,
// Hugo, Obsidian, Pandoc and others for title, author, tags… Without this, `title: …` followed by
// the closing `---` reads as a big heading. In the rendered view it shows as a small properties
// panel; a click (or Enter on the selected panel) edits the text in place. The file keeps it as written.
import remarkFrontmatter from 'remark-frontmatter'
import { $remark, $nodeSchema, $view, $prose, $command } from '@milkdown/kit/utils'
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@milkdown/kit/prose/state'

const KINDS = ['yaml', 'toml']
const FENCE = { yaml: '---', toml: '+++' }

const frontmatterRemark = $remark('folioFrontmatter', () => remarkFrontmatter, KINDS)

export const frontmatterSchema = $nodeSchema('front_matter', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  attrs: { value: { default: '' }, kind: { default: 'yaml' } },
  parseDOM: [{ tag: 'div[data-type="front-matter"]', getAttrs: (d) => ({ value: d.dataset.value || '', kind: d.dataset.kind || 'yaml' }) }],
  toDOM: (node) => ['div', { 'data-type': 'front-matter', 'data-value': node.attrs.value, 'data-kind': node.attrs.kind }],
  parseMarkdown: {
    match: (node) => KINDS.includes(node.type),
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value ?? '', kind: node.type })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'front_matter',
    runner: (state, node) => {
      state.addNode(KINDS.includes(node.attrs.kind) ? node.attrs.kind : 'yaml', undefined, node.attrs.value)
    },
  },
}))

// ───────────────────────────── reading the properties
// Only for showing them: simple `key: value` lines, lists (`[a, b]` or `- a` lines) and folded
// text. Anything else (nested maps, TOML tables) shows as the plain text.
const unquote = (s) => s.trim().replace(/^(["'])([\s\S]*)\1$/, '$2')
const splitList = (s) => s.slice(1, -1).split(',').map(unquote).filter(Boolean)

/** [{ key, value: string | string[] }] or null when the block isn't simple enough to show as a list. */
export function readProperties(text, kind = 'yaml') {
  const sep = kind === 'toml' ? '=' : ':'
  const keyRe = kind === 'toml' ? /^([A-Za-z0-9_."'-]+)\s*=\s*(.*)$/ : /^([^\s#][^:]*?):(?:\s+(.*)|\s*)$/
  const props = []
  let cur = null
  let block = false // inside a `|` or `>` text block
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      if (block && cur) cur.lines.push('')
      continue
    }
    if (/^\s*#/.test(line) && !block) continue
    const indented = /^\s/.test(line)
    if (!indented) {
      block = false
      const m = keyRe.exec(line)
      if (!m) return null
      cur = { key: unquote(m[1]), first: (m[2] || '').trim(), items: [], lines: [], block: '' }
      if (sep === ':' && /^[|>][+-]?$/.test(cur.first)) {
        block = true
        cur.block = cur.first[0]
        cur.first = ''
      }
      props.push(cur)
      continue
    }
    if (!cur) return null
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (!block && item && !cur.first) cur.items.push(unquote(item[1]))
    else if (!block && /^\s*[^\s#][^:]*:(\s|$)/.test(line)) return null // nested map
    else cur.lines.push(line.trim())
  }
  return props.map(({ key, first, items, lines, block }) => {
    if (items.length) return { key, value: items }
    if (/^\[.*\]$/.test(first)) return { key, value: splitList(first) }
    const text = block === '|' ? lines.join('\n') : [first, ...lines].filter(Boolean).join(' ')
    return { key, value: unquote(text) }
  })
}

// ───────────────────────────── node view
const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

class FrontmatterView {
  constructor(node, view, getPos) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.dom = el('div', 'folio-frontmatter')
    this.dom.contentEditable = 'false'
    this.dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !view.editable || this.ta) return
      e.preventDefault()
      this.edit()
    })
    this.dom.addEventListener('folio-edit-frontmatter', () => this.edit())
    this.render()
  }

  render() {
    const { value, kind } = this.node.attrs
    const props = readProperties(value, kind)
    this.dom.title = this.view.editable ? 'Front matter – click to edit' : 'Front matter'
    this.dom.classList.toggle('raw', !props?.length)
    if (!props?.length) {
      this.dom.replaceChildren(value.trim() ? el('pre', 'folio-fm-raw', value) : el('div', 'folio-fm-empty', 'Empty front matter'))
      return
    }
    const table = el('dl', 'folio-fm-props')
    for (const { key, value: v } of props) {
      table.append(el('dt', null, key))
      const dd = el('dd')
      if (Array.isArray(v)) dd.append(...v.map((s) => el('span', 'folio-fm-chip', s)))
      else if (v === '') dd.append(el('span', 'folio-fm-none', '—'))
      else dd.textContent = v
      table.append(dd)
    }
    this.dom.replaceChildren(table)
  }

  edit() {
    if (this.ta || !this.view.editable) return
    const fence = FENCE[this.node.attrs.kind] || '---'
    const ta = (this.ta = el('textarea', 'folio-fm-src'))
    ta.spellcheck = false
    ta.value = this.node.attrs.value
    const fit = () => (ta.rows = Math.max(1, ta.value.split('\n').length))
    fit()
    ta.addEventListener('input', fit)
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        ta.value = this.node.attrs.value
        this.close()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        this.close()
      }
    })
    ta.addEventListener('blur', () => this.close(false))
    this.dom.classList.add('editing')
    this.dom.replaceChildren(el('div', 'folio-fm-fence', fence), ta, el('div', 'folio-fm-fence', fence))
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    })
  }

  /** Save the edited text (empty removes the block) and go back to the properties. */
  close(refocus = true) {
    const ta = this.ta
    if (!ta) return
    this.ta = null
    this.dom.classList.remove('editing')
    const value = ta.value.replace(/\s+$/, '')
    const pos = this.getPos()
    if (pos != null && value !== this.node.attrs.value) {
      const { state } = this.view
      let tr = value.trim() ? state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, value }) : state.tr.delete(pos, pos + this.node.nodeSize)
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
    if (this.ta) return this.ta.contains(e.target)
    return e.type === 'mousedown' && e.button === 0 && this.view.editable
  }
  ignoreMutation() {
    return true
  }
  destroy() {
    this.ta = null
  }
}

const frontmatterView = $view(frontmatterSchema.node, () => (node, v, getPos) => new FrontmatterView(node, v, getPos))

const editAt = (view, pos) => view.nodeDOM(pos)?.dispatchEvent(new Event('folio-edit-frontmatter'))

// Enter on the selected panel edits it, as a click does
const enterKey = $prose(
  () =>
    new Plugin({
      key: new PluginKey('folio-frontmatter-enter'),
      props: {
        handleKeyDown(view, e) {
          const sel = view.state.selection
          if (e.key !== 'Enter' || !(sel instanceof NodeSelection) || sel.node.type.name !== 'front_matter' || !view.editable) return false
          editAt(view, sel.from)
          return true
        },
      },
    }),
)

/** Insert → Front Matter: edit the document's front matter, adding an empty one at the top first. */
export const frontmatterCommand = $command('FolioFrontmatter', (ctx) => () => (state, dispatch, view) => {
  const first = state.doc.firstChild
  if (first?.type.name !== 'front_matter') {
    if (!dispatch) return true
    dispatch(state.tr.insert(0, frontmatterSchema.type(ctx).create({ value: 'title: ' })).scrollIntoView())
  }
  if (view) requestAnimationFrame(() => editAt(view, 0))
  return true
})

export const frontmatter = [frontmatterRemark, frontmatterSchema, frontmatterView, enterKey, frontmatterCommand].flat()

/** Source mode's version of the command: returns the new text and where the cursor goes. */
export function sourceFrontmatter(text) {
  const m = /^(---|\+\+\+)\r?\n/.exec(text)
  if (m) return { text, cursor: m[0].length }
  return { text: '---\ntitle: \n---\n\n' + text, cursor: 11 }
}
