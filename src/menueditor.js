// Customize Menus (lazy): the menu bar as a tree you rearrange by dragging. Commands come from the
// list on the right: drag them into a menu, drag them back to the list to remove them. Menus and
// submenus are made, renamed, nested and moved like commands.
// Dragging uses pointer events, not HTML5 drag and drop: WebView2 hands native drags to Tauri's
// file drop, and Android's WebView has no drag and drop for touch.
import { MENU_TEMPLATES, expandTemplate } from './menutemplates.js'

/**
 * @param h { el, dialog, units: [{ id, label, group, keys, sub, off }], layout, defaults, template? }
 *   template: the id of a MENU_TEMPLATES entry to start from (Undo goes back to your menus)
 *   layout/defaults: [{ label, items: [id | '-' | { label, items, ext? }] }]
 * @returns the new layout, or null when cancelled
 */
export function editMenus(h) {
  const { el, dialog } = h
  const byId = new Map(h.units.map((u) => [u.id, u]))
  const sameLabel = {}
  for (const u of h.units) sameLabel[u.label] = (sameLabel[u.label] || 0) + 1

  // working copy: nodes with identity, so a command can be in two places and still be dragged apart
  const toNodes = (items) =>
    items.map((x) => (x === '-' ? { t: 'sep' } : typeof x === 'string' ? { t: 'cmd', id: x } : { t: 'menu', label: x.label, ext: x.ext, items: toNodes(x.items) }))
  const fromNodes = (nodes) =>
    nodes.map((n) => {
      if (n.t === 'sep') return '-'
      if (n.t === 'cmd') return n.id
      return n.ext ? { label: n.label, items: fromNodes(n.items), ext: n.ext } : { label: n.label, items: fromNodes(n.items) }
    })
  const root = { t: 'menu', items: toNodes(h.layout) }
  let selected = null
  let collapsed = new Set()
  const history = []
  const snap = () => {
    history.push(JSON.stringify(fromNodes(root.items)))
    if (history.length > 100) history.shift()
    undoBtn.disabled = false
  }
  const undo = () => {
    if (!history.length) return
    root.items = toNodes(JSON.parse(history.pop()))
    selected = null
    collapsed = new Set()
    undoBtn.disabled = !history.length
    draw()
  }

  /** Where a node is: the folder holding it, that folder's list and the index. */
  const locate = (node, folder = root) => {
    const i = folder.items.indexOf(node)
    if (i >= 0) return { folder, list: folder.items, i }
    for (const x of folder.items) {
      const r = x.t === 'menu' && locate(node, x)
      if (r) return r
    }
    return null
  }
  /** Whether folder is node or lies somewhere inside it. */
  const inside = (folder, node) => folder === node || (node.t === 'menu' && node.items.some((x) => inside(folder, x)))
  const placedIds = () => {
    const out = new Set()
    const walk = (list) => list.forEach((n) => (n.t === 'cmd' ? out.add(n.id) : n.t === 'menu' && walk(n.items)))
    walk(root.items)
    return out
  }

  // ── the tree (left)
  const tree = el('div', { class: 'me-tree', tabindex: '0', role: 'tree', 'aria-label': 'Menus' })
  const visibleRows = () => [...tree.querySelectorAll('.me-row')]
  const rowFor = (n, depth) => {
    const u = n.t === 'cmd' ? byId.get(n.id) : null
    const label = n.t === 'menu' ? n.label : n.t === 'cmd' ? (u ? u.label : n.id.split('/').pop()) : ''
    const hint = n.t !== 'cmd' ? '' : !u ? 'not available here' : u.off ? 'extension not installed' : sameLabel[u.label] > 1 ? u.group : ''
    const open = n.t === 'menu' && !collapsed.has(n)
    const r = el(
      'div',
      {
        class: `me-row me-t-${n.t}` + (n === selected ? ' sel' : '') + (n.t === 'cmd' && (!u || u.off) ? ' off' : '') + (depth === 0 ? ' top' : ''),
        style: `--depth:${depth}`,
        role: 'treeitem',
        'aria-expanded': n.t === 'menu' ? String(open) : null,
      },
      el('span', { class: 'me-grip', title: 'Drag to move' }, '⠿'),
      n.t === 'menu' ? el('button', { type: 'button', class: 'me-fold', tabindex: '-1', title: open ? 'Collapse' : 'Expand', onclick: () => fold(n) }, open ? '▾' : '▸') : null,
      n.t === 'sep' ? el('span', { class: 'me-line', title: 'Separator' }) : el('span', { class: 'me-label' }, label),
      u?.sub ? el('span', { class: 'me-subhint', title: 'A submenu filled when it opens' }, '›') : null,
      hint ? el('small', {}, hint) : null,
      u?.keys ? el('kbd', {}, u.keys) : null,
      n.t === 'menu' ? el('button', { type: 'button', class: 'me-btn', tabindex: '-1', title: 'Rename (F2)', onclick: () => rename(n) }, '✎') : null,
      el('button', { type: 'button', class: 'me-btn', tabindex: '-1', title: n.t === 'menu' ? 'Delete this menu and what is in it (Delete)' : 'Remove (Delete)', onclick: () => remove(n) }, '×'),
    )
    r._node = n
    r.addEventListener('pointerdown', (e) => startDrag(e, r, { node: n }))
    r.addEventListener('click', (e) => {
      if (e.target.closest('button, input')) return
      select(n)
      tree.focus({ preventScroll: true })
    })
    if (n.t === 'menu') r.addEventListener('dblclick', (e) => !e.target.closest('button') && rename(n))
    return r
  }
  const draw = () => {
    const rows = []
    const walk = (list, depth) => {
      for (const n of list) {
        rows.push(rowFor(n, depth))
        if (n.t !== 'menu' || collapsed.has(n)) continue
        if (!n.items.length) {
          const e = el('div', { class: 'me-emptyrow', style: `--depth:${depth + 1}` }, 'Empty: drag commands here')
          e._into = n
          rows.push(e)
        }
        walk(n.items, depth + 1)
      }
    }
    walk(root.items, 0)
    if (!root.items.length) rows.push(el('div', { class: 'me-none' }, 'No menus. Click New Menu to make one.'))
    tree.replaceChildren(...rows)
    tree.querySelector('.me-row.sel')?.scrollIntoView({ block: 'nearest' })
    drawCommands()
  }
  const select = (n) => {
    selected = n
    for (const r of visibleRows()) r.classList.toggle('sel', r._node === n)
  }
  const fold = (n) => {
    collapsed.has(n) ? collapsed.delete(n) : collapsed.add(n)
    draw()
  }

  // ── changes
  const remove = (n) => {
    const l = locate(n)
    if (!l) return
    snap()
    l.list.splice(l.i, 1)
    // the selection moves to the next row, so Delete can be pressed again
    selected = l.list[l.i] || l.list[l.i - 1] || (l.folder === root ? null : l.folder)
    draw()
  }
  /** Where something new goes: into the selected menu, after the selected row, or into the last menu. */
  const insert = (n) => {
    snap()
    const l = selected && locate(selected)
    if (selected?.t === 'menu') {
      selected.items.push(n)
      collapsed.delete(selected)
    } else if (l) l.list.splice(l.i + 1, 0, n)
    else {
      if (!root.items.length) root.items.push({ t: 'menu', label: 'New Menu', items: [] })
      root.items.at(-1).items.push(n)
    }
    selected = n
    draw()
  }
  const newMenu = () => {
    snap()
    const n = { t: 'menu', label: 'New Menu', items: [] }
    // after the menu the selection is in
    let top = selected
    while (top && locate(top)?.folder !== root) top = locate(top)?.folder
    root.items.splice(top ? root.items.indexOf(top) + 1 : root.items.length, 0, n)
    selected = n
    draw()
    rename(n)
  }
  const newSubmenu = () => {
    const n = { t: 'menu', label: 'New Submenu', items: [] }
    insert(n)
    rename(n)
  }
  const rename = (n) => {
    select(n)
    const r = visibleRows().find((x) => x._node === n)
    const span = r?.querySelector('.me-label')
    if (!span) return
    const inp = el('input', { type: 'text', class: 'me-input', value: n.label, spellcheck: 'false', 'aria-label': 'Menu name' })
    span.replaceWith(inp)
    inp.focus()
    inp.select()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      window.removeEventListener('keydown', onKey, true)
      const v = inp.value.trim()
      if (ok && v && v !== n.label) {
        snap()
        n.label = v
      }
      draw()
      tree.focus({ preventScroll: true })
    }
    // window capture runs before the dialog's Enter (save) and Esc (cancel) on document
    const onKey = (e) => {
      if (e.target !== inp || (e.key !== 'Enter' && e.key !== 'Escape')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      finish(e.key === 'Enter')
    }
    window.addEventListener('keydown', onKey, true)
    inp.addEventListener('blur', () => finish(true))
    inp.addEventListener('pointerdown', (e) => e.stopPropagation())
  }
  /** Keyboard moves: Alt+Up/Down within a menu, Alt+Left out of it, Alt+Right into the menu above. */
  const move = (n, dir) => {
    const l = locate(n)
    if (!l) return
    if (dir === 'up' || dir === 'down') {
      const j = l.i + (dir === 'up' ? -1 : 1)
      if (j < 0 || j >= l.list.length) return
      snap()
      ;[l.list[l.i], l.list[j]] = [l.list[j], l.list[l.i]]
    } else if (dir === 'out') {
      if (l.folder === root) return
      const p = locate(l.folder)
      if (p.folder === root && n.t !== 'menu') return // only menus sit on the menu bar itself
      snap()
      l.list.splice(l.i, 1)
      p.list.splice(p.i + 1, 0, n)
    } else {
      const prev = l.list[l.i - 1]
      if (prev?.t !== 'menu') return
      snap()
      l.list.splice(l.i, 1)
      prev.items.push(n)
      collapsed.delete(prev)
    }
    draw()
  }
  tree.addEventListener('keydown', (e) => {
    if (e.target !== tree) return
    const rows = visibleRows()
    const i = rows.findIndex((r) => r._node === selected)
    const n = selected
    const key = (e.altKey ? 'Alt+' : '') + (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + e.key
    const act = {
      ArrowDown: () => rows.length && select(rows[Math.min(i + 1, rows.length - 1)]._node),
      ArrowUp: () => rows.length && select(rows[Math.max(i - 1, 0)]._node),
      Home: () => rows.length && select(rows[0]._node),
      End: () => rows.length && select(rows.at(-1)._node),
      ArrowRight: () => n?.t === 'menu' && collapsed.has(n) && fold(n),
      ArrowLeft: () => (n?.t === 'menu' && !collapsed.has(n) ? fold(n) : n && locate(n).folder !== root && select(locate(n).folder)),
      'Alt+ArrowUp': () => n && move(n, 'up'),
      'Alt+ArrowDown': () => n && move(n, 'down'),
      'Alt+ArrowLeft': () => n && move(n, 'out'),
      'Alt+ArrowRight': () => n && move(n, 'in'),
      Delete: () => n && remove(n),
      Backspace: () => n && remove(n),
      F2: () => n?.t === 'menu' && rename(n),
      'Ctrl+z': undo,
    }[key]
    if (!act) return
    e.preventDefault()
    act()
    tree.querySelector('.me-row.sel')?.scrollIntoView({ block: 'nearest' })
  })

  // ── the commands (right)
  const filter = el('input', { type: 'search', class: 'kb-filter', placeholder: 'Filter commands…', spellcheck: 'false' })
  const cmds = el('div', { class: 'me-cmds' })
  const cmdRow = (label, make, extra = {}) => {
    const add = el('button', { type: 'button', class: 'me-btn me-add', title: 'Add to the selected menu' }, '+')
    add.onclick = () => insert(make())
    const r = el(
      'div',
      { class: 'me-cmd' + (extra.placed ? ' placed' : '') + (extra.cls ? ' ' + extra.cls : '') },
      el('span', { class: 'me-grip', title: 'Drag into a menu' }, '⠿'),
      el('span', { class: 'me-label' }, label),
      extra.sub ? el('span', { class: 'me-subhint', title: 'A submenu filled when it opens' }, '›') : null,
      extra.placed ? el('small', { title: 'Already in a menu' }, '✓') : null,
      extra.keys ? el('kbd', {}, extra.keys) : null,
      add,
    )
    r.addEventListener('pointerdown', (e) => startDrag(e, r, { make }))
    return r
  }
  const drawCommands = () => {
    const q = filter.value.trim().toLowerCase()
    const placed = placedIds()
    const groups = new Map()
    for (const u of h.units) {
      if (u.off) continue
      if (q && !`${u.group} ${u.label} ${u.keys || ''}`.toLowerCase().includes(q)) continue
      if (!groups.has(u.group)) groups.set(u.group, [])
      groups.get(u.group).push(u)
    }
    const rows = []
    if (!q) rows.push(cmdRow('Separator', () => ({ t: 'sep' }), { cls: 'me-sepcmd' }))
    for (const [g, us] of groups) {
      rows.push(el('div', { class: 'kb-group' }, g))
      for (const u of us) rows.push(cmdRow(u.label, () => ({ t: 'cmd', id: u.id }), { placed: placed.has(u.id), keys: u.keys, sub: u.sub }))
    }
    if (!groups.size && q) rows.push(el('p', { class: 'about-note' }, 'No command matches.'))
    const top = cmds.scrollTop
    cmds.replaceChildren(...rows)
    cmds.scrollTop = top
  }
  filter.oninput = drawCommands

  // ── dragging
  let drag = null
  const clearMarks = () => {
    for (const x of box.querySelectorAll('.drop-before, .drop-after, .drop-into')) x.classList.remove('drop-before', 'drop-after', 'drop-into')
    cmdPane.classList.remove('drop-remove')
    tree.classList.remove('drop-end')
  }
  /** What a drop at (x, y) would do, marked on the page: { remove } | { into, at } | { ref, where } */
  const aim = (x, y) => {
    clearMarks()
    const src = drag.src.node
    const isMenu = src ? src.t === 'menu' : false
    const t = document.elementFromPoint(x, y)
    if (!t) return null
    if (cmdPane.contains(t)) {
      if (!src) return null
      cmdPane.classList.add('drop-remove')
      return { remove: true }
    }
    if (!tree.contains(t)) return null
    const empty = t.closest('.me-emptyrow')
    if (empty) {
      if (src && inside(empty._into, src)) return null
      empty.classList.add('drop-into')
      return { into: empty._into, at: 'end' }
    }
    const r = t.closest('.me-row')
    if (!r) {
      // below the last row: the end of the menu bar (a menu) or of the last menu
      const last = root.items.at(-1)
      if (!isMenu && !last) return null
      tree.classList.add('drop-end')
      return isMenu ? { into: root, at: 'end' } : { into: last, at: 'end' }
    }
    const n = r._node
    if (n === src) return null
    const b = r.getBoundingClientRect()
    const f = (y - b.top) / b.height
    const top = r.classList.contains('top')
    let d
    if (n.t === 'menu') {
      const open = !collapsed.has(n) && n.items.length
      if (top && !isMenu) d = { into: n, at: open && f > 0.5 ? 'start' : 'end' }
      else if (f < 0.3) d = { ref: n, where: 'before' }
      else if (f > 0.7 && !open) d = { ref: n, where: 'after' }
      else d = { into: n, at: f > 0.7 ? 'start' : 'end' }
    } else d = { ref: n, where: f < 0.5 ? 'before' : 'after' }
    const folder = d.into || locate(d.ref).folder
    if (src && isMenu && inside(folder, src)) return null // not into itself
    r.classList.add(d.into ? 'drop-into' : 'drop-' + d.where)
    return d
  }
  const drop = (d) => {
    const src = drag.src
    if (!d) return
    snap()
    let node = src.node
    if (node) {
      const l = locate(node)
      l.list.splice(l.i, 1)
    } else node = src.make()
    if (d.remove) {
      if (selected === node) selected = null
      return draw()
    }
    if (d.into) {
      d.into.items[d.at === 'start' ? 'unshift' : 'push'](node)
      collapsed.delete(d.into)
    } else {
      const l = locate(d.ref)
      l.list.splice(l.i + (d.where === 'after' ? 1 : 0), 0, node)
    }
    selected = node
    draw()
  }
  const startDrag = (e, rowEl, src) => {
    if (e.button !== 0 || e.target.closest('button, input')) return
    // a finger scrolls the lists; it drags only by the grip
    if (e.pointerType !== 'mouse' && !e.target.closest('.me-grip')) return
    if (e.pointerType === 'mouse') e.preventDefault() // no text selection while dragging
    const x0 = e.clientX
    const y0 = e.clientY
    let target = null
    let ghost = null
    const onMove = (ev) => {
      if (!drag) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
        drag = { src }
        ghost = rowEl.cloneNode(true)
        ghost.classList.add('me-ghost')
        ghost.classList.remove('sel')
        ghost.style.width = rowEl.offsetWidth + 'px'
        document.body.append(ghost)
        rowEl.classList.add('dragging')
        box.classList.add('me-dragging')
      }
      ev.preventDefault()
      ghost.style.transform = `translate(${ev.clientX + 10}px, ${ev.clientY - 12}px)`
      target = aim(ev.clientX, ev.clientY)
      // near the top or bottom edge of a list: scroll it
      for (const list of [tree, cmds]) {
        const b = list.getBoundingClientRect()
        if (ev.clientX < b.left || ev.clientX > b.right) continue
        if (ev.clientY < b.top + 28) list.scrollTop -= 12
        else if (ev.clientY > b.bottom - 28) list.scrollTop += 12
      }
    }
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      if (!drag) return
      ghost.remove()
      rowEl.classList.remove('dragging')
      box.classList.remove('me-dragging')
      clearMarks()
      if (ev.type === 'pointerup') drop(target)
      drag = null
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }

  // ── layout
  const btn = (label, title, fn) => el('button', { type: 'button', class: 'fsel', title, onclick: fn }, label)
  const undoBtn = btn('Undo', 'Undo the last change (Ctrl+Z)', undo)
  undoBtn.disabled = true
  const reset = btn('Reset to Default', 'Start again from the menus CaretFlow comes with', () => {
    snap()
    root.items = toNodes(h.defaults)
    selected = null
    collapsed = new Set()
    draw()
  })

  // templates: a popup above the button; picking one replaces the tree (Undo brings yours back)
  const templateMenus = (t) => expandTemplate(t, h.defaults, (id) => byId.has(id))
  const useTemplate = (t) => {
    snap()
    root.items = toNodes(templateMenus(t))
    selected = null
    collapsed = new Set(root.items) // the menus at a glance; open one to see what is in it
    draw()
    tree.focus({ preventScroll: true })
  }
  let tplPop = null
  const closeTemplates = () => {
    tplPop?.remove()
    tplPop = null
    window.removeEventListener('keydown', tplKey, true)
    document.removeEventListener('pointerdown', tplOutside, true)
  }
  // window capture: Esc closes the popup, not the dialog
  const tplKey = (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    closeTemplates()
    tplBtn.focus()
  }
  const tplOutside = (e) => !tplPop?.contains(e.target) && !tplBtn.contains(e.target) && closeTemplates()
  const tplBtn = btn('Templates…', 'Menus made for a kind of work, to start from', () => {
    if (tplPop) return closeTemplates()
    const pick = (t) => () => {
      closeTemplates()
      useTemplate(t)
    }
    tplPop = el(
      'div',
      { class: 'me-tpls', role: 'menu' },
      ...MENU_TEMPLATES.map((t) =>
        el('button', { type: 'button', class: 'me-tpl', role: 'menuitem', 'data-tpl': t.id, onclick: pick(t) }, el('b', {}, t.name), el('small', {}, `${t.menus.map((m) => m.label).join(' · ')} — ${t.desc}`)),
      ),
    )
    tplBtn.after(tplPop)
    tplPop.querySelector('button').focus()
    tplPop.addEventListener('keydown', (e) => {
      const bs = [...tplPop.querySelectorAll('button')]
      const i = bs.indexOf(document.activeElement)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus()
      }
    })
    window.addEventListener('keydown', tplKey, true)
    document.addEventListener('pointerdown', tplOutside, true)
  })
  const collapseAll = btn('Collapse All', 'Show only the menus', () => {
    collapsed = new Set(root.items)
    draw()
  })
  const treePane = el(
    'div',
    { class: 'me-pane' },
    el('div', { class: 'me-tools' }, btn('New Menu', 'A new menu on the menu bar', newMenu), btn('New Submenu', 'A submenu in the selected menu', newSubmenu), btn('Separator', 'A line between commands', () => insert({ t: 'sep' }))),
    tree,
  )
  const cmdPane = el('div', { class: 'me-pane me-cmd-pane' }, el('div', { class: 'me-tools' }, filter), cmds, el('div', { class: 'me-drophint' }, 'Drop here to remove'))
  const box = el(
    'div',
    { class: 'me' },
    el('p', { class: 'about-note' }, 'Drag commands from the right into your menus, and back to remove them. Double-click a menu to rename it. Keys: Alt+arrows move the selected row, Delete removes it, F2 renames.'),
    el('div', { class: 'me-cols' }, treePane, cmdPane),
    el('div', { class: 'me-tools me-bottom' }, undoBtn, collapseAll, el('span', { class: 'me-gap' }), tplBtn, reset),
  )
  draw()
  const start = h.template && MENU_TEMPLATES.find((t) => t.id === h.template)
  if (start) useTemplate(start)

  return dialog({
    title: 'Customize Menus',
    body: box,
    wide: true,
    buttons: [
      { label: 'Cancel', value: false, cancel: true },
      { label: 'Save', value: true, primary: true },
    ],
    onMount: (b) => {
      b.classList.add('me-dialog')
      tree.focus({ preventScroll: true })
    },
  }).then((ok) => {
    closeTemplates()
    return ok ? fromNodes(root.items) : null
  })
}
