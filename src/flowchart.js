// Mermaid flowcharts as data, for the Diagram Editor (diagram.js): parse() reads the code into
// nodes and links, serialize() writes it back. Only what the visual editor can change is modelled;
// style lines (classDef, style, class, linkStyle, click) and comments are kept as they are. Code
// the model can't hold (subgraphs, `&` lists, …) makes parse() say so, and the editor then leaves
// that diagram to the code view instead of rewriting it wrongly.

/** Shapes: [id, opener, closer, name]; longer openers first, so `((` wins over `(`. */
export const SHAPES = [
  ['circle', '((', '))', 'Circle'],
  ['stadium', '([', '])', 'Pill'],
  ['sub', '[[', ']]', 'Subroutine'],
  ['db', '[(', ')]', 'Database'],
  ['hex', '{{', '}}', 'Hexagon'],
  ['para', '[/', '/]', 'Slanted'],
  ['rect', '[', ']', 'Box'],
  ['round', '(', ')', 'Rounded'],
  ['diamond', '{', '}', 'Decision'],
  ['flag', '>', ']', 'Flag'],
]
const SHAPE = Object.fromEntries(SHAPES.map((s) => [s[0], s]))

/** Link styles: [id, code, name]. */
export const LINKS = [
  ['arrow', '-->', 'Arrow'],
  ['line', '---', 'Line'],
  ['dotted', '-.->', 'Dotted arrow'],
  ['thick', '==>', 'Thick arrow'],
  ['both', '<-->', 'Both ways'],
]
const LINK = Object.fromEntries(LINKS.map((l) => [l[0], l]))
// what each written form means; longer forms first
const LINK_CODES = [
  [/^<-{2,}>/, 'both'],
  [/^-\.+->/, 'dotted'],
  [/^-\.+-/, 'dotted'],
  [/^={2,}>/, 'thick'],
  [/^={3,}/, 'thick'],
  [/^-{2,}>/, 'arrow'],
  [/^-{3,}/, 'line'],
]
// `A -- text --> B`, `A -. text .-> B`, `A == text ==> B`
const LABELLED = /^(--|-\.|==)\s+(.+?)\s+(-{2,}>|-{3,}|\.+->|\.+-|={2,}>|={3,})/

export const DIRS = ['TD', 'LR', 'BT', 'RL']
const KEEP = /^(%%|classDef\b|class\b|style\b|linkStyle\b|click\b)/
const ID = /^[\p{L}\p{N}_]+/u

export const isFlowchart = (code) => /^\s*(?:%%.*\n\s*)*(flowchart|graph)\b/.test(code)

/**
 * @returns {{ ok: true, dir: string, kw: string, head: string[], nodes: Map<string, {id, label, shape, cls?}>, edges: {from, to, label, style}[], keep: string[] }
 *         | { ok: false, why: string }}
 */
export function parse(code) {
  const lines = code.replace(/\r/g, '').split('\n')
  const m = { ok: true, kw: 'flowchart', dir: 'TD', nodes: new Map(), edges: [], keep: [], head: [] }
  let seenHeader = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (!seenHeader) {
      if (line.startsWith('%%')) {
        m.head.push(line)
        continue
      }
      const h = /^(flowchart|graph)(?:\s+(TB|TD|LR|BT|RL))?\s*;?$/.exec(line)
      if (!h) return { ok: false, why: 'This is not a flowchart.' }
      m.kw = h[1]
      m.dir = h[2] === 'TB' ? 'TD' : h[2] || 'TD'
      seenHeader = true
      continue
    }
    if (KEEP.test(line)) {
      m.keep.push(line)
      continue
    }
    for (const st of line.split(/;\s*(?=\S|$)/)) {
      if (!st.trim()) continue
      const why = statement(st.trim(), m)
      if (why) return { ok: false, why }
    }
  }
  if (!seenHeader) return { ok: false, why: 'This is not a flowchart.' }
  return m
}

// one statement: a node, or nodes joined by links (`A --> B -- yes --> C`)
function statement(s, m) {
  if (/^(subgraph|end|direction)\b/.test(s)) return 'Subgraphs can only be edited in the code for now.'
  const first = node(s, m)
  if (!first) return `Can’t read “${s}”.`
  let rest = first.rest
  let prev = first.id
  while (rest.trim()) {
    rest = rest.trimStart()
    if (rest.startsWith('&')) return 'Lists with “&” can only be edited in the code for now.'
    const l = link(rest)
    if (!l) return `Can’t read “${s}”.`
    const next = node(l.rest.trimStart(), m)
    if (!next) return `Can’t read “${s}”.`
    m.edges.push({ from: prev, to: next.id, label: l.label, style: l.style })
    prev = next.id
    rest = next.rest
  }
  return null
}

function node(s, m) {
  const id = ID.exec(s)?.[0]
  if (!id) return null
  let rest = s.slice(id.length)
  let shape = null
  let label = null
  for (const [sid, open, close] of SHAPES) {
    if (!rest.startsWith(open)) continue
    const body = rest.slice(open.length)
    const end = body.startsWith('"') ? body.indexOf('"' + close, 1) + 1 : body.indexOf(close)
    if (end < 0 || (body.startsWith('"') && end === 0)) continue
    label = unquote(body.slice(0, end))
    rest = body.slice(end + close.length)
    shape = sid
    break
  }
  let cls
  const c = /^:::([\w-]+)/.exec(rest)
  if (c) {
    cls = c[1]
    rest = rest.slice(c[0].length)
  }
  const had = m.nodes.get(id)
  if (!had) m.nodes.set(id, { id, label: label ?? id, shape: shape || 'rect', cls })
  else {
    if (shape) Object.assign(had, { label, shape })
    if (cls) had.cls = cls
  }
  return { id, rest }
}

function link(s) {
  const lab = LABELLED.exec(s)
  if (lab) {
    const end = lab[3].replace(/^\.+/, '-.')
    const style = LINK_CODES.find(([re]) => re.test(end))?.[1] || 'arrow'
    return { style, label: unquote(lab[2]), rest: s.slice(lab[0].length) }
  }
  for (const [re, style] of LINK_CODES) {
    const x = re.exec(s)
    if (!x) continue
    let rest = s.slice(x[0].length)
    let label = ''
    const p = /^\s*\|([^|]*)\|/.exec(rest)
    if (p) {
      label = unquote(p[1].trim())
      rest = rest.slice(p[0].length)
    }
    return { style, label, rest }
  }
  return null
}

function unquote(t) {
  t = t.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1)
  return t.replace(/#quot;/g, '"')
}

// labels with brackets, pipes or quotes need quotes in Mermaid
function quote(t) {
  return /^[\p{L}\p{N} _.,:;!?'’+*/@#$%^~-]*$/u.test(t) && t.trim() === t ? t : '"' + t.replace(/"/g, '#quot;') + '"'
}

function nodeCode(n) {
  const [, open, close] = SHAPE[n.shape] || SHAPE.rect
  const plain = n.shape === 'rect' && n.label === n.id
  return n.id + (plain ? '' : open + quote(n.label) + close) + (n.cls ? ':::' + n.cls : '')
}

/** Writes the model back: links first, each node with its text where it first appears. */
export function serialize(m) {
  const out = [...m.head, `${m.kw} ${m.dir}`]
  const written = new Set()
  const ref = (id) => {
    const n = m.nodes.get(id)
    if (written.has(id) || !n) return id
    written.add(id)
    return nodeCode(n)
  }
  for (const e of m.edges) {
    const code = LINK[e.style]?.[1] || '-->'
    out.push(`  ${ref(e.from)} ${code}${e.label ? '|' + quote(e.label) + '|' : ''} ${ref(e.to)}`)
  }
  for (const id of m.nodes.keys()) if (!written.has(id)) out.push('  ' + ref(id))
  for (const k of m.keep) out.push('  ' + k)
  return out.join('\n')
}

/** A node id not used yet: A…Z, then N1, N2, … */
export function freeId(m) {
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i)
    if (!m.nodes.has(id)) return id
  }
  for (let i = 1; ; i++) if (!m.nodes.has('N' + i)) return 'N' + i
}

export function removeNode(m, id) {
  m.nodes.delete(id)
  m.edges = m.edges.filter((e) => e.from !== id && e.to !== id)
}
