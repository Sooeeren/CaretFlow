// Diagram Editor (an extension, lazy): edits one Mermaid block with its code on the left and the
// drawing on the right. Flowcharts can also be edited on the drawing itself: add boxes, drag from
// one box to another to connect them, rename with a double-click, change shapes, arrows and the
// direction. Mermaid lays the drawing out by itself, so the editor changes what is connected to
// what, never where things sit. The code stays the source of truth: every visual change is written
// back as plain Mermaid (flowchart.js), and diagrams it can't model stay editable as code.

import { parse, serialize, freeId, removeNode, SHAPES, LINKS, DIRS, isFlowchart } from './flowchart.js'

/** @type {{ el, isDark: () => boolean, mermaid: () => Promise<any>, onClose: () => void }} */
let H = null
let root = null
let ui = {}
let st = null // { code, start, model, sel, undo, redo, onDone, rid, renderT, renaming }
let rn = 0

export const isOpen = () => !!root && !root.hidden

/** Opens the editor on `code`; onDone(code) gets the result when the user clicks Done. */
export function openDiagram(host, { code, isNew, onDone }) {
  H = host
  if (!root) build()
  st = { code, start: isNew ? null : code, model: null, sel: null, undo: [], redo: [], onDone, rid: '', renaming: null }
  ui.title.textContent = isNew ? 'New diagram' : 'Edit diagram'
  ui.code.value = code
  root.hidden = false
  reparse()
  render()
  ;(st.model?.ok ? ui.canvas : ui.code).focus()
}

export function closeDiagram(save) {
  if (!isOpen()) return
  stopRename(false)
  root.hidden = true
  const { code, start, onDone } = st
  st = null
  // a new diagram goes in even unchanged; an existing one only when it changed
  if (save && code !== start && code.trim()) onDone(code)
  H.onClose()
}

// ════════════════════════════════════════ layout
function build() {
  const { el } = H
  const btn = (label, title, fn, cls = '') => el('button', { type: 'button', class: 'dg-b ' + cls, title, onclick: fn }, label)
  root = el('div', { id: 'dg', hidden: true, onkeydown: onKey })
  ui.title = el('b', {}, 'Edit diagram')
  ui.kind = el('span', { class: 'dg-kind' })
  ui.code = el('textarea', { class: 'dg-code', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Mermaid code', oninput: onCodeInput })
  ui.msg = el('div', { class: 'dg-msg' })
  ui.svg = el('div', { class: 'dg-svg' })
  ui.canvas = el('div', { class: 'dg-canvas', tabindex: '0', onpointerdown: onDown, ondblclick: onDbl }, ui.svg)
  ui.line = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  ui.line.setAttribute('class', 'dg-dragline')
  ui.line.innerHTML = '<line x1="0" y1="0" x2="0" y2="0"/>'

  ui.add = btn('+ Box', 'Add a box (A); with a box selected, the new one is connected to it', addNode, 'dg-add')
  ui.rename = btn('Rename', 'Rename the selection (F2 or double-click)', () => startRename())
  ui.del = btn('Delete', 'Delete the selection (Del)', del)
  ui.shapes = SHAPES.map(([id, , , name]) => btn(shapeIcon(id), name, () => setShape(id), 'dg-ico'))
  ui.links = LINKS.map(([id, , name]) => btn(linkIcon(id), name, () => setLink(id), 'dg-ico'))
  ui.dirs = DIRS.map((d) => btn({ TD: '↓', LR: '→', BT: '↑', RL: '←' }[d], { TD: 'Top to bottom', LR: 'Left to right', BT: 'Bottom to top', RL: 'Right to left' }[d], () => setDir(d), 'dg-ico'))
  ui.bar = el(
    'div',
    { class: 'dg-bar' },
    ui.add,
    ui.rename,
    ui.del,
    el('span', { class: 'dg-sep' }),
    el('span', { class: 'dg-group', title: 'Shape of the selected box' }, ...ui.shapes),
    el('span', { class: 'dg-sep' }),
    el('span', { class: 'dg-group', title: 'Style of the selected link' }, ...ui.links),
    el('span', { class: 'dg-sep' }),
    el('span', { class: 'dg-group', title: 'Direction' }, ...ui.dirs),
  )
  ui.hint = el('div', { class: 'dg-hint' })
  root.append(
    el(
      'div',
      { class: 'dg-top' },
      ui.title,
      ui.kind,
      el('span', { class: 'dg-fill' }),
      btn('Cancel', 'Close without changes (Esc)', () => closeDiagram(false)),
      btn('Done', 'Put the diagram into the document (Ctrl+Enter)', () => closeDiagram(true), 'primary'),
    ),
    el('div', { class: 'dg-main' }, el('div', { class: 'dg-left' }, ui.code, ui.msg), el('div', { class: 'dg-right' }, ui.bar, ui.canvas, ui.hint)),
    ui.line,
  )
  document.querySelector('#app').append(root)
}

const svgIcon = (body) => {
  const s = document.createElement('span')
  s.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  return s.firstChild
}
function shapeIcon(id) {
  return svgIcon(
    {
      rect: '<rect x="3" y="7" width="18" height="10"/>',
      round: '<rect x="3" y="7" width="18" height="10" rx="3"/>',
      stadium: '<rect x="3" y="7" width="18" height="10" rx="5"/>',
      sub: '<rect x="3" y="7" width="18" height="10"/><path d="M6 7v10M18 7v10"/>',
      db: '<ellipse cx="12" cy="6.5" rx="7" ry="2.5"/><path d="M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11"/>',
      circle: '<circle cx="12" cy="12" r="8"/>',
      diamond: '<path d="M12 3l9 9-9 9-9-9z"/>',
      hex: '<path d="M7 5h10l4 7-4 7H7l-4-7z"/>',
      para: '<path d="M7 7h14l-4 10H3z"/>',
      flag: '<path d="M3 7h18v10H3l4-5z"/>',
    }[id],
  )
}
function linkIcon(id) {
  return svgIcon(
    {
      arrow: '<path d="M3 12h16M15 8l4 4-4 4"/>',
      line: '<path d="M3 12h18"/>',
      dotted: '<path d="M3 12h16" stroke-dasharray="2 3"/><path d="M15 8l4 4-4 4"/>',
      thick: '<path d="M3 12h15M14 8l4 4-4 4" stroke-width="3"/>',
      both: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
    }[id],
  )
}

// ════════════════════════════════════════ code ↔ model
function reparse() {
  const flow = isFlowchart(st.code)
  st.model = flow ? parse(st.code) : null
  const ok = !!st.model?.ok
  ui.bar.hidden = !ok
  ui.kind.textContent = flow ? 'Flowchart' : (/^\s*(?:%%.*\n\s*)*(\w+)/.exec(st.code)?.[1] || '')
  ui.hint.textContent = ok
    ? 'Drag from one box to another to connect them · double-click to rename · Del deletes'
    : flow
      ? st.model.why + ' Edit it in the code on the left.'
      : 'Only flowcharts can be edited on the drawing; edit this diagram in the code on the left.'
  if (st.sel && !selValid()) st.sel = null
  syncBar()
}

const selValid = () => (st.sel?.kind === 'node' ? st.model?.ok && st.model.nodes.has(st.sel.id) : st.sel?.kind === 'edge' ? st.model?.ok && !!st.model.edges[st.sel.i] : false)

let inputT = 0
function onCodeInput() {
  st.code = ui.code.value
  clearTimeout(inputT)
  inputT = setTimeout(() => {
    if (!st) return
    reparse()
    render()
  }, 250)
}

/** A visual change: write the model back as code and redraw at once. */
function commit() {
  st.undo.push(st.code)
  st.redo = []
  st.code = serialize(st.model)
  ui.code.value = st.code
  reparse()
  render()
}

function undo(back) {
  const from = back ? st.undo : st.redo
  if (!from.length) return
  ;(back ? st.redo : st.undo).push(st.code)
  st.code = from.pop()
  ui.code.value = st.code
  reparse()
  render()
}

// ════════════════════════════════════════ drawing
async function render() {
  const my = ++rn
  const code = st.code
  if (!code.trim()) {
    ui.svg.innerHTML = ''
    ui.msg.textContent = ''
    return
  }
  const mermaid = await H.mermaid()
  if (my !== rn || !st) return
  mermaid.initialize({ startOnLoad: false, theme: H.isDark() ? 'dark' : 'default', securityLevel: 'strict', flowchart: { htmlLabels: false } })
  const rid = 'dge' + my
  try {
    const { svg } = await mermaid.render(rid, code)
    if (my !== rn || !st) return
    st.rid = rid
    ui.svg.innerHTML = svg
    // natural size, smaller only when the window is (Mermaid's own width="100%" would blow it up)
    const el = ui.svg.firstElementChild
    const vb = el?.viewBox?.baseVal
    if (vb?.width) Object.assign(el.style, { width: vb.width + 'px', maxWidth: '100%' })
    ui.svg.classList.remove('stale')
    ui.msg.textContent = ''
    tag()
  } catch (e) {
    document.getElementById('d' + rid)?.remove()
    if (my !== rn || !st) return
    ui.svg.classList.add('stale')
    ui.msg.textContent = String(e?.message || e).split('\n').slice(0, 4).join('\n')
  }
}

// marks the drawn boxes and links with what they are in the model
function tag() {
  if (!st.model?.ok) return
  const pre = st.rid + '-flowchart-'
  for (const g of ui.svg.querySelectorAll('g.node')) {
    const m = g.id.startsWith(pre) && /^(.+)-\d+$/.exec(g.id.slice(pre.length))
    if (m && st.model.nodes.has(m[1])) g.dataset.node = m[1]
  }
  const byId = new Map()
  ui.svg.querySelectorAll('path.flowchart-link').forEach((p, i) => {
    p.dataset.edge = i
    byId.set(p.getAttribute('data-id'), i)
    // a wide, invisible twin, so thin lines are easy to click
    const hit = p.cloneNode(false)
    hit.removeAttribute('id')
    hit.removeAttribute('marker-end')
    hit.removeAttribute('marker-start')
    hit.setAttribute('class', 'dg-hit')
    hit.dataset.edge = i
    p.after(hit)
  })
  for (const l of ui.svg.querySelectorAll('g.edgeLabel [data-id]')) {
    const i = byId.get(l.getAttribute('data-id'))
    if (i != null) l.closest('g.edgeLabel').dataset.edge = i
  }
  showSel()
}

function showSel() {
  for (const x of ui.svg.querySelectorAll('.dg-sel')) x.classList.remove('dg-sel')
  const s = st.sel
  if (s?.kind === 'node') ui.svg.querySelector(`g.node[data-node="${CSS.escape(s.id)}"]`)?.classList.add('dg-sel')
  if (s?.kind === 'edge') for (const x of ui.svg.querySelectorAll(`[data-edge="${s.i}"]`)) x.classList.add('dg-sel')
  syncBar()
}

function syncBar() {
  const s = st?.sel
  const m = st?.model
  const node = s?.kind === 'node' ? m.nodes.get(s.id) : null
  const edge = s?.kind === 'edge' ? m.edges[s.i] : null
  ui.rename.disabled = ui.del.disabled = !node && !edge
  SHAPES.forEach(([id], i) => {
    ui.shapes[i].disabled = !node
    ui.shapes[i].classList.toggle('on', node?.shape === id)
  })
  LINKS.forEach(([id], i) => {
    ui.links[i].disabled = !edge
    ui.links[i].classList.toggle('on', edge?.style === id)
  })
  DIRS.forEach((d, i) => ui.dirs[i].classList.toggle('on', m?.ok && m.dir === d))
}

function select(sel) {
  st.sel = sel
  showSel()
}

// ════════════════════════════════════════ editing
function addNode() {
  if (!st.model?.ok) return
  const m = st.model
  const id = freeId(m)
  const from = st.sel?.kind === 'node' ? st.sel.id : null
  m.nodes.set(id, { id, label: 'New box', shape: 'rect' })
  if (from) m.edges.push({ from, to: id, label: '', style: 'arrow' })
  st.sel = { kind: 'node', id }
  commit()
  // rename once it is drawn
  waitDrawn(() => startRename())
}

function del() {
  const s = st.sel
  if (!s || !st.model?.ok) return
  if (s.kind === 'node') removeNode(st.model, s.id)
  else st.model.edges.splice(s.i, 1)
  st.sel = null
  commit()
}

function setShape(shape) {
  const n = st.sel?.kind === 'node' && st.model.nodes.get(st.sel.id)
  if (!n || n.shape === shape) return
  n.shape = shape
  commit()
}

function setLink(style) {
  const e = st.sel?.kind === 'edge' && st.model.edges[st.sel.i]
  if (!e || e.style === style) return
  e.style = style
  commit()
}

function setDir(d) {
  if (!st.model?.ok || st.model.dir === d) return
  st.model.dir = d
  commit()
}

function connect(from, to) {
  const m = st.model
  if (m.edges.some((e) => e.from === from && e.to === to)) return select({ kind: 'edge', i: m.edges.findIndex((e) => e.from === from && e.to === to) })
  m.edges.push({ from, to, label: '', style: 'arrow' })
  st.sel = { kind: 'edge', i: m.edges.length - 1 }
  commit()
}

// runs fn after the next drawing is on screen
function waitDrawn(fn) {
  const want = rn
  const t0 = performance.now()
  const tick = () => {
    if (!st) return
    if (st.rid === 'dge' + want) return fn()
    if (performance.now() - t0 < 4000) requestAnimationFrame(tick)
  }
  tick()
}

// a text field laid over the box or link being renamed
function startRename() {
  const s = st.sel
  if (!s || !st.model?.ok) return
  stopRename(false)
  const target = s.kind === 'node' ? ui.svg.querySelector(`g.node[data-node="${CSS.escape(s.id)}"]`) : ui.svg.querySelector(`g.edgeLabel[data-edge="${s.i}"]`) || ui.svg.querySelector(`path.flowchart-link[data-edge="${s.i}"]`)
  if (!target) return
  const item = s.kind === 'node' ? st.model.nodes.get(s.id) : st.model.edges[s.i]
  const r = target.getBoundingClientRect()
  const c = ui.canvas.getBoundingClientRect()
  const inp = H.el('input', { class: 'dg-rename', value: item.label, spellcheck: 'false', placeholder: s.kind === 'edge' ? 'Link text' : '' })
  const w = Math.max(120, r.width + 24)
  Object.assign(inp.style, {
    left: r.left - c.left + ui.canvas.scrollLeft + r.width / 2 - w / 2 + 'px',
    top: r.top - c.top + ui.canvas.scrollTop + r.height / 2 - 16 + 'px',
    width: w + 'px',
  })
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') stopRename(true)
    if (e.key === 'Escape') stopRename(false)
  })
  inp.addEventListener('blur', () => stopRename(true))
  st.renaming = { inp, item }
  ui.canvas.append(inp)
  inp.focus()
  inp.select()
}

function stopRename(save) {
  const r = st?.renaming
  if (!r) return
  st.renaming = null
  r.inp.remove()
  const v = r.inp.value.trim()
  ui.canvas.focus()
  if (save && v !== r.item.label && (v || !('shape' in r.item))) {
    r.item.label = v
    commit()
  }
}

// ════════════════════════════════════════ mouse and keys
function hitAt(t) {
  const n = t.closest?.('g.node[data-node]')
  if (n) return { kind: 'node', id: n.dataset.node }
  const e = t.closest?.('[data-edge]')
  if (e) return { kind: 'edge', i: +e.dataset.edge }
  return null
}

function onDown(e) {
  if (e.button !== 0 || e.target.closest('.dg-rename') || !st.model?.ok) return
  const hit = hitAt(e.target)
  if (hit?.kind !== 'node') return select(hit)
  e.preventDefault()
  ui.canvas.focus()
  const x0 = e.clientX
  const y0 = e.clientY
  const box = e.target.closest('g.node').getBoundingClientRect()
  const line = ui.line.firstChild
  let dragging = false
  const move = (ev) => {
    if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
    dragging = true
    ui.line.classList.add('on')
    line.setAttribute('x1', box.left + box.width / 2)
    line.setAttribute('y1', box.top + box.height / 2)
    line.setAttribute('x2', ev.clientX)
    line.setAttribute('y2', ev.clientY)
    for (const x of ui.svg.querySelectorAll('.dg-target')) x.classList.remove('dg-target')
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('g.node[data-node]')
    if (over && over.dataset.node !== hit.id) over.classList.add('dg-target')
  }
  const up = (ev) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    ui.line.classList.remove('on')
    for (const x of ui.svg.querySelectorAll('.dg-target')) x.classList.remove('dg-target')
    if (!dragging) return select(hit)
    const to = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('g.node[data-node]')?.dataset.node
    if (to && to !== hit.id) connect(hit.id, to)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function onDbl(e) {
  if (!st.model?.ok || e.target.closest('.dg-rename')) return
  const hit = hitAt(e.target)
  if (!hit) {
    st.sel = null
    return addNode()
  }
  select(hit)
  startRename()
}

function onKey(e) {
  const combo = (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + e.key
  if (combo === 'Ctrl+Enter') {
    e.preventDefault()
    return closeDiagram(true)
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    if (st.sel && e.target === ui.canvas) return select(null)
    return closeDiagram(false)
  }
  if (e.target !== ui.canvas || !st.model?.ok) return
  const act = {
    Delete: del,
    Backspace: del,
    F2: () => startRename(),
    Enter: () => startRename(),
    a: addNode,
    A: addNode,
    'Ctrl+z': () => undo(true),
    'Ctrl+Z': () => undo(true),
    'Ctrl+y': () => undo(false),
    'Ctrl+Shift+Z': () => undo(false),
  }[combo]
  if (act) {
    e.preventDefault()
    act()
  }
}
