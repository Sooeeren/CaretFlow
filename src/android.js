// CaretFlow on Android (lazy, loaded only there): the touch layout (app bar, menu drawer, sidebar
// drawer, formatting bar above the keyboard, back button), CaretFlow's own file browser, files from
// other apps ("Open with", "Share"), saving when the app goes to the background, printing,
// sharing and update checks. Native work goes through the android_* commands in
// src-tauri/src/android.rs and CaretFlowPlugin.kt.
import { invoke } from '@tauri-apps/api/core'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { open as systemPicker } from '@tauri-apps/plugin-dialog'
import * as P from './paths.js'

let ctx = null // set by initAndroid; see main.js bootAndroid()
let dirsP = null
const dirs = () => (dirsP ||= invoke('android_dirs').catch(() => ({ storage: '/storage/emulated/0', documents: '/storage/emulated/0/Documents', library: '' })))
const storage = () => invoke('android_storage').catch(() => ({ granted: false }))
const DRAFT_KEY = 'folio.draft'
const BROWSE_KEY = 'folio.browseDir'
const narrow = () => innerWidth < 760

// ════════════════════════════════════════ start
export async function initAndroid(c) {
  ctx = c
  document.body.classList.add('android')
  buildAppBar()
  buildDrawer()
  buildFormatBar()
  wireSidebarDrawer()
  wireBack()
  wireLifecycle()
  followTheme()
  // phones start without the sidebar; it opens as a drawer over the page
  if (narrow()) ctx.setSidebar(false)
}

/** After the first document is on screen: draft, file from another app, storage, default folder */
export async function afterBoot() {
  // the draft first, even when the last file was reopened: otherwise it is never shown and the
  // next trip to the background deletes it. A file from another app comes after it and asks
  // about the draft like about any unsaved change.
  await restoreDraft()
  await takeIntent()
  const st = await storage()
  if (!st.granted && !ctx.settings.androidStorageAsked) await askStorage()
  else if (!ctx.S.root) await openDefaultFolder()
}

// ════════════════════════════════════════ storage permission and folders
async function askStorage() {
  const { el, dialog, settings, saveSettings } = ctx
  const r = await dialog({
    title: 'Let CaretFlow open your files?',
    body: el(
      'div',
      {},
      el('p', {}, 'To open folders, show the file tree, search in folders and sync, CaretFlow needs Android’s “All files access”. It only reads and writes files you open or save; nothing is sent anywhere.'),
      el('p', { class: 'about-note' }, 'Without it, CaretFlow keeps documents in its own folder and can still open files that other apps share with it.'),
    ),
    buttons: [
      { label: 'Not Now', value: false, cancel: true },
      { label: 'Allow…', value: true, primary: true },
    ],
  })
  settings.androidStorageAsked = true
  saveSettings()
  if (r) await requestStorage()
  else await openDefaultFolder()
}

let waitingForGrant = false
async function requestStorage() {
  waitingForGrant = true
  await invoke('android_request_storage').catch((e) => ctx.toast(String(e), 3000))
}

/** Documents/CaretFlow when CaretFlow may use shared storage, else its own folder */
async function defaultFolder() {
  const d = await dirs()
  const { granted } = await storage()
  if (!granted) return d.library
  const dir = P.join(d.documents, 'CaretFlow')
  await invoke('make_dir', { path: dir }).catch(() => {})
  return dir
}

async function openDefaultFolder() {
  const dir = await defaultFolder()
  if (dir && !ctx.S.root) ctx.setRoot(dir, false)
}

// ════════════════════════════════════════ other apps: "Open with", "Share", files from pickers
async function takeIntent() {
  const r = await invoke('android_take_intent').catch(() => null)
  if (r?.uri) {
    const p = await resolve(r.uri)
    if (r.more) ctx.toast(`CaretFlow opens one file at a time: the first of ${r.more + 1}`, 3500)
    if (p) return (await ctx.openFile(p)) || true
  } else if (r?.text) {
    // shared text becomes a new, unsaved document
    if (await ctx.confirmDiscard()) await ctx.loadUnsaved(r.text, null)
    return true
  }
  return false
}

/** A path for a content:// link (when Android has one CaretFlow may read), else the link itself */
async function resolve(uri) {
  if (!uri) return null
  if (!uri.startsWith('content://')) return uri.replace(/^file:\/\//, '')
  const r = await invoke('android_resolve', { uri }).catch(() => null)
  if (r?.path) return r.path
  // no path: keep Android's name for the link, so the title and Save As don't show an ID
  P.setUriName(uri, r?.name)
  return uri
}

export async function pickImage() {
  const uri = await systemPicker({ multiple: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }] })
  if (!uri) return null
  const r = uri.startsWith('content://') ? await invoke('android_resolve', { uri }).catch(() => null) : { path: uri }
  if (r?.path) return r.path
  // no path: copy it out so the usual image code (copy next to the document) can take it from there
  const name = (r?.name || 'image.png').replace(/[\\/:*?"<>|]+/g, '-')
  const to = P.join(await invoke('temp_dir'), name)
  await invoke('android_copy_uri', { uri, to })
  return to
}

/** Open a file in another app; a folder (Cloud Sync's "Open sync folder") opens in the file tree */
export async function openPath(path) {
  if (await invoke('is_dir', { path }).catch(() => false)) return ctx.setRoot(path, true)
  return invoke('android_open_path', { path }).catch((e) => ctx.toast(String(e), 3000))
}

/** File → Share…: the saved file, or the current text as a Markdown file */
export async function shareDoc() {
  const { S } = ctx
  try {
    if (S.path && !S.path.startsWith('content://') && !ctx.syncDirty()) return await invoke('android_share', { path: S.path, mime: 'text/markdown' })
    const name = (S.path ? P.stem(S.path) : ctx.docTitle() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || 'Untitled'
    const tmp = P.join(await invoke('temp_dir'), name + '.md')
    await invoke('write_text', { path: tmp, content: ctx.currentText() })
    await invoke('android_share', { path: tmp, mime: 'text/markdown' })
  } catch (e) {
    ctx.toast('Could not share: ' + e, 3000)
  }
}

/** File → Print…: Android's print dialog (printers, or "Save as PDF") */
export async function printHtml(html, title) {
  const tmp = P.join(await invoke('temp_dir'), `print-${Date.now().toString(36)}.folio-tmp.html`)
  await invoke('write_text', { path: tmp, content: html })
  await invoke('android_print', { html: tmp, title })
  setTimeout(() => invoke('remove_temp', { path: tmp }).catch(() => {}), 120e3)
}

// ════════════════════════════════════════ file browser (Open, Open Folder, Save As, exports)
/**
 * mode: 'open' (a file) | 'folder' | 'save'. Resolves to a path, a content:// link (a file
 * picked in another app) or null. Lists folders and Markdown files (list_dir).
 */
export async function browse({ mode = 'open', defaultPath, filters, title } = {}) {
  const { el } = ctx
  const d = await dirs()
  let st = await storage()
  const allowed = (p) => st.granted || (d.library && P.isInside(p, d.library))
  const ext = filters?.[0]?.extensions?.[0]
  let start = defaultPath
  let name = ''
  if (mode === 'save' && defaultPath) {
    name = P.basename(defaultPath)
    start = P.dirname(defaultPath)
  }
  const usable = async (p) => p && !P.isUri(p) && allowed(p) && (await invoke('is_dir', { path: p }).catch(() => false))
  if (!(await usable(start))) start = localStorage.getItem(BROWSE_KEY)
  if (!(await usable(start))) start = await defaultFolder()
  let cur = start
  let confirmReplace = null

  // its own layer above everything, not the shared #modal: it also opens from inside Preferences
  // (Cloud Sync → Choose…), and closing a second #modal dialog would close Preferences with it
  const layer = el('div', { class: 'fb-layer' })
  const box = el('div', { class: 'modal-box wide fb-dialog', role: 'dialog', 'aria-label': title || 'Files' })
  const list = el('div', { class: 'fb-list' })
  const crumbs = el('div', { class: 'fb-crumbs' })
  const places = el('div', { class: 'fb-places' })
  const banner = el('div', { class: 'fb-banner' })
  const nameInput = el('input', { type: 'text', value: name, placeholder: 'File name', spellcheck: 'false', class: 'fb-name' })
  const folderRow = el('div', { class: 'fb-newfolder', hidden: true })
  const folderInput = el('input', { type: 'text', placeholder: 'New folder name', spellcheck: 'false' })
  folderRow.append(
    folderInput,
    el('button', { type: 'button', onclick: () => (folderRow.hidden = true) }, 'Cancel'),
    el('button', { type: 'button', class: 'primary', onclick: () => newFolder() }, 'Create'),
  )
  folderInput.onkeydown = (e) => e.key === 'Enter' && newFolder()

  let finish
  const result = new Promise((res) => (finish = res))
  const close = (v) => {
    layer.remove()
    grantListeners.delete(onGrant)
    browsers.delete(close)
    if (v && !P.isUri(v)) {
      try {
        localStorage.setItem(BROWSE_KEY, mode === 'folder' ? v : P.dirname(v))
      } catch {}
    }
    finish(v || null)
  }
  browsers.add(close)

  const chip = (label, fn) => el('button', { type: 'button', class: 'fb-chip', onclick: fn }, label)
  function drawPlaces() {
    places.innerHTML = ''
    places.append(
      ...[
        st.granted && chip('Phone', () => go(d.storage)),
        st.granted && chip('Documents', () => go(d.documents)),
        st.granted && chip('Download', () => go(P.join(d.storage, 'Download'))),
        d.library && chip('CaretFlow', () => go(d.library)),
        mode === 'open' && chip('Other apps…', fromOtherApp),
        chip('New folder', () => {
          folderRow.hidden = false
          folderInput.value = ''
          folderInput.focus()
        }),
      ].filter(Boolean),
    )
    banner.hidden = st.granted
    banner.innerHTML = ''
    banner.append(
      el('span', {}, 'CaretFlow can only see its own folder. '),
      el('button', { type: 'button', class: 'wc-link', onclick: () => requestStorage() }, 'Allow access to all files'),
    )
  }

  async function fromOtherApp() {
    const uri = await systemPicker({ multiple: false }).catch(() => null)
    if (uri) close(await resolve(uri))
  }

  async function newFolder() {
    const n = folderInput.value.trim().replace(/[\\/:*?"<>|]+/g, '')
    if (!n) return
    try {
      await invoke('make_dir', { path: P.join(cur, n) })
      folderRow.hidden = true
      go(P.join(cur, n))
    } catch (e) {
      ctx.toast('Could not create the folder: ' + e, 3000)
    }
  }

  function drawCrumbs() {
    crumbs.innerHTML = ''
    const root = st.granted && P.isInside(cur, d.storage) ? d.storage : d.library && P.isInside(cur, d.library) ? d.library : '/'
    const label = root === d.storage ? 'Phone' : root === d.library ? 'CaretFlow' : '/'
    const rel = P.relative(root, cur)
    let acc = root
    crumbs.append(el('button', { type: 'button', onclick: () => go(root) }, label))
    for (const part of rel && rel !== '.' ? rel.split('/') : []) {
      acc = P.join(acc, part)
      const target = acc
      crumbs.append(el('span', { class: 'fb-sep' }, '›'), el('button', { type: 'button', onclick: () => go(target) }, part))
    }
    crumbs.scrollLeft = crumbs.scrollWidth
  }

  async function go(p) {
    cur = p
    confirmReplace = null
    drawCrumbs()
    list.innerHTML = ''
    list.append(el('div', { class: 'fb-empty' }, 'Loading…'))
    let entries
    try {
      entries = await invoke('list_dir', { path: p })
    } catch (e) {
      list.innerHTML = ''
      list.append(el('div', { class: 'fb-empty' }, st.granted ? `Can’t open this folder: ${e}` : 'CaretFlow needs access to all files to open this folder.'))
      return
    }
    if (cur !== p) return // tapped on to another folder meanwhile
    list.innerHTML = ''
    const parent = P.dirname(p)
    if (parent && parent !== p && p !== d.storage && p !== d.library && allowed(parent)) list.append(row({ name: '..', path: parent, dir: true }, 'Up'))
    const shown = mode === 'folder' ? entries.filter((e) => e.dir) : entries
    for (const e of shown) list.append(row(e))
    if (!shown.length) list.append(el('div', { class: 'fb-empty' }, mode === 'folder' ? 'No folders here' : 'No Markdown files here'))
  }

  function row(e, label) {
    const r = el('button', { type: 'button', class: 'fb-row' + (e.dir ? ' dir' : '') + (label ? ' up' : '') }, el('span', { class: 'fb-ico' }), el('span', { class: 'fb-n' }, label || e.name))
    r.onclick = () => {
      if (e.dir) return go(e.path)
      if (mode === 'open') return close(e.path)
      if (mode === 'save') {
        nameInput.value = e.name
        confirmReplace = null
      }
    }
    return r
  }

  async function submit() {
    if (mode === 'folder') return close(cur)
    let n = nameInput.value.trim().replace(/[\\/:*?"<>|]+/g, '')
    if (!n) return ctx.toast('Type a file name')
    if (ext && !/\.[^.]+$/.test(n)) n += '.' + ext
    const p = P.join(cur, n)
    if (confirmReplace !== p && (await invoke('exists', { path: p }).catch(() => false))) {
      confirmReplace = p
      return ctx.toast(`“${n}” is already there. Tap Save again to replace it`, 3500)
    }
    close(p)
  }

  // "All files access" turned on while the browser is open: show everything right away
  const onGrant = async () => {
    st = await storage()
    drawPlaces()
    go(cur)
  }
  grantListeners.add(onGrant)

  const btns = el('div', { class: 'modal-btns' }, el('button', { type: 'button', onclick: () => close(null) }, 'Cancel'))
  if (mode !== 'open') btns.append(el('button', { type: 'button', class: 'primary', onclick: submit }, mode === 'folder' ? 'Use This Folder' : 'Save'))
  nameInput.onkeydown = (e) => e.key === 'Enter' && submit()
  box.append(el('h3', {}, title || { open: 'Open', folder: 'Choose a folder', save: 'Save as' }[mode]), banner, places, folderRow, ...[crumbs, list, mode === 'save' && nameInput, btns].filter(Boolean))
  layer.append(box)
  layer.onclick = (e) => e.target === layer && close(null)
  document.body.append(layer)
  drawPlaces()
  go(cur)
  return result
}
// open file browsers (the back button closes the top one)
const browsers = new Set()
const grantListeners = new Set()

// ════════════════════════════════════════ app bar and menu drawer
const ICONS = {
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  files: '<svg viewBox="0 0 24 24"><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 7 4.5 4.5L15 16"/><path d="M19 11.5h-9a5 5 0 0 0 0 10h2"/></svg>',
  find: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>',
}
const iconBtn = (name, title, fn) => {
  const b = ctx.el('button', { type: 'button', class: 'm-btn', title, 'aria-label': title })
  b.innerHTML = ICONS[name]
  b.onclick = fn
  b.onmousedown = (e) => e.preventDefault() // keep the editor (and the keyboard) focused
  return b
}

function buildAppBar() {
  const bar = document.querySelector('#menubar')
  bar.prepend(iconBtn('menu', 'Menu', () => toggleDrawer(true)))
  const actions = ctx.el('div', { class: 'm-actions' })
  actions.append(
    iconBtn('files', 'Files and outline', () => ctx.setSidebar()),
    iconBtn('undo', 'Undo', () => ctx.runAction('Edit/Undo')),
    iconBtn('redo', 'Redo', () => ctx.runAction('Edit/Redo')),
    iconBtn('find', 'Find', () => ctx.runAction('Edit/Find…')),
    iconBtn('save', 'Save', () => ctx.runAction('File/Save')),
    iconBtn('more', 'Command palette', () => ctx.runAction('View/Command Palette…')),
  )
  bar.append(actions)
}

let drawer, scrim
function buildDrawer() {
  const { el } = ctx
  scrim = el('div', { id: 'm-scrim', hidden: true })
  scrim.onclick = () => {
    toggleDrawer(false)
    if (narrow() && ctx.settings.sidebar) ctx.setSidebar(false)
  }
  drawer = el('nav', { id: 'm-drawer', hidden: true, 'aria-label': 'Menu' })
  document.body.append(scrim, drawer)
}

const drawerOpen = () => drawer && !drawer.hidden
function toggleDrawer(show = !drawerOpen()) {
  if (show) renderDrawer()
  drawer.hidden = !show
  syncScrim()
}
function syncScrim() {
  scrim.hidden = !(drawerOpen() || (narrow() && ctx.settings.sidebar))
}

let openGroup = null
function renderDrawer() {
  const { el, menu, menuItems, version } = ctx
  drawer.innerHTML = ''
  drawer.append(el('div', { class: 'm-head' }, el('b', {}, 'CaretFlow'), el('span', {}, version)))
  const items = (list, depth) => {
    const box = el('div', { class: 'm-items' + (depth ? ' sub' : '') })
    for (const it of menuItems(list)) {
      if (it === '-') {
        box.append(el('div', { class: 'menu-sep' }))
        continue
      }
      const enabled = it.enabled ? it.enabled() : true
      const b = el(
        'button',
        { type: 'button', class: 'm-item' + (it.checked?.() ? ' checked' : '') + (enabled ? '' : ' disabled') + (it.sub ? ' has-sub' : '') },
        el('span', { class: 'lbl' }, it.label),
        it.keys && !it.sub ? el('span', { class: 'kbd' }, it.keys) : null,
      )
      if (it.sub) {
        let sub = null
        b.onclick = () => {
          if (sub) {
            sub.remove()
            sub = null
            b.classList.remove('open')
          } else {
            sub = items(it.sub, depth + 1)
            b.after(sub)
            b.classList.add('open')
          }
        }
      } else
        b.onclick = () => {
          toggleDrawer(false)
          setTimeout(() => it.fn?.(), 0)
        }
      box.append(b)
    }
    return box
  }
  for (const g of menu) {
    const head = el('button', { type: 'button', class: 'm-group' + (openGroup === g.label ? ' open' : '') }, g.label)
    const body = items(g.items, 0)
    body.hidden = openGroup !== g.label
    head.onclick = () => {
      openGroup = openGroup === g.label ? null : g.label
      for (const x of drawer.querySelectorAll('.m-group')) x.classList.toggle('open', x === head && openGroup)
      for (const x of drawer.querySelectorAll(':scope > .m-items')) x.hidden = x !== body || !openGroup
    }
    drawer.append(head, body)
  }
}

// ════════════════════════════════════════ sidebar as a drawer on phones
function wireSidebarDrawer() {
  // the sidebar's state changes in main.js (setSidebar → applySettings → body.no-sidebar)
  new MutationObserver(syncScrim).observe(document.body, { attributes: true, attributeFilter: ['class'] })
  addEventListener('resize', syncScrim)
  // picking a file, a heading or a search hit closes the drawer, so the document shows
  for (const id of ['#tree', '#outline', '#search-results', '#sb-cloud'])
    document.querySelector(id)?.addEventListener('click', (e) => {
      if (!narrow()) return
      const row = e.target.closest('.tree-row, .ol-item, .sr-item')
      if (row && !row.classList.contains('dir')) setTimeout(() => ctx.setSidebar(false), 150)
    })
}

// ════════════════════════════════════════ formatting bar above the keyboard
const FORMAT = [
  ['B', 'Bold', 'Format/Bold', 'b'],
  ['I', 'Italic', 'Format/Italic', 'i'],
  ['H', 'Heading', 'heading'],
  ['•', 'Bullet list', 'Paragraph/Bullet List'],
  ['1.', 'Numbered list', 'Paragraph/Ordered List'],
  ['☐', 'Task list', 'Paragraph/Task List'],
  ['❝', 'Quote', 'Paragraph/Quote'],
  ['🔗', 'Link', 'Insert/Link'],
  ['`', 'Inline code', 'Format/Inline Code'],
  ['{ }', 'Code block', 'Insert/Code Block'],
  ['▦', 'Table', 'Insert/Table'],
  ['🖼', 'Image', 'Insert/Image…'],
  ['</>', 'Source mode', 'View/Source Code Mode'],
  ['⌄', 'Hide keyboard', 'hide'],
]
let fmt
function buildFormatBar() {
  const { el } = ctx
  fmt = el('div', { id: 'm-format', hidden: true, role: 'toolbar', 'aria-label': 'Formatting' })
  for (const [glyph, title, id, cls] of FORMAT) {
    const b = el('button', { type: 'button', title, 'aria-label': title, class: cls || '' }, glyph)
    // pointerdown + preventDefault: the editor keeps focus, so the keyboard stays open
    b.addEventListener('pointerdown', (e) => e.preventDefault())
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.onclick = (e) => {
      if (id === 'hide') return document.activeElement?.blur()
      if (id === 'heading') {
        const r = b.getBoundingClientRect()
        return ctx.showContextMenu(r.left, r.top - 8 - 5 * 36, [
          ['Heading 1', () => ctx.runAction('Paragraph/Heading 1')],
          ['Heading 2', () => ctx.runAction('Paragraph/Heading 2')],
          ['Heading 3', () => ctx.runAction('Paragraph/Heading 3')],
          ['Heading 4', () => ctx.runAction('Paragraph/Heading 4')],
          ['Paragraph', () => ctx.runAction('Paragraph/Paragraph')],
        ])
      }
      e.preventDefault()
      ctx.runAction(id)
    }
    fmt.append(b)
  }
  document.querySelector('#content').append(fmt)
  const inEditor = (n) => n?.closest?.('#wysiwyg .ProseMirror, #source .cm-content')
  document.addEventListener('focusin', (e) => {
    fmt.hidden = !inEditor(e.target) || ctx.S.readonly
    if (!fmt.hidden) keepCaretVisible()
  })
  document.addEventListener('focusout', () =>
    setTimeout(() => {
      if (!inEditor(document.activeElement)) fmt.hidden = true
    }, 50),
  )
  // the keyboard opening shrinks the page: keep the line being typed above it, and a menu
  // that is open (spelling suggestions) on screen
  addEventListener('resize', () =>
    setTimeout(() => {
      keepCaretVisible()
      const m = document.querySelector('#ctxmenu')
      if (m && !m.hidden) m.style.top = Math.max(8, Math.min(m.offsetTop, innerHeight - m.offsetHeight - 8)) + 'px'
    }, 60),
  )
}

function keepCaretVisible() {
  const sel = getSelection()
  if (!sel?.rangeCount || !document.activeElement?.closest?.('#scroller')) return
  const r = sel.getRangeAt(0).getBoundingClientRect()
  const sc = document.querySelector('#scroller').getBoundingClientRect()
  if (!r.height && !r.top) return
  const bottom = sc.bottom - (fmt.hidden ? 0 : fmt.offsetHeight) - 16
  if (r.bottom > bottom) document.querySelector('#scroller').scrollBy({ top: r.bottom - bottom })
  else if (r.top < sc.top + 8) document.querySelector('#scroller').scrollBy({ top: r.top - sc.top - 8 })
}

// ════════════════════════════════════════ back button
function wireBack() {
  onBackButtonPress(() => back()).catch((e) => ctx.log('back button:', e))
}

async function back() {
  const $ = (s) => document.querySelector(s)
  const visible = (s) => $(s) && !$(s).hidden
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  if (visible('#ctxmenu')) return ($('#ctxmenu').hidden = true)
  if (browsers.size) return [...browsers].pop()(null)
  if (visible('#modal')) return esc()
  if (drawerOpen()) return toggleDrawer(false)
  if (narrow() && ctx.settings.sidebar) return ctx.setSidebar(false)
  if (visible('#findbar')) return $('#find-close').click()
  if (visible('#pagepreview')) return $('#pv-close').click()
  if (document.querySelector('.tt-overlay, .typing-test')) return esc()
  if (ctx.S.mode === 'source' && !ctx.settings.vim) return ctx.runAction('View/Source Code Mode')
  // leaving CaretFlow: save first (or keep the draft), like Android apps do
  await saveOrKeepDraft()
  if (ctx.syncDirty()) {
    if (!(await ctx.confirmDiscard())) return
    // "Don't Save" means it: the kept draft must not come back on the next start
    if (ctx.syncDirty()) localStorage.removeItem(DRAFT_KEY)
  }
  invoke('exit_app', { code: 0 })
}

// ════════════════════════════════════════ background: save, drafts, coming back
function wireLifecycle() {
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return saveOrKeepDraft()
    if (waitingForGrant) {
      waitingForGrant = false
      const { granted } = await storage()
      if (granted) {
        ctx.toast('CaretFlow can open your files now')
        dirsP = null
        if (!ctx.S.root || ctx.S.root === (await dirs()).library) ctx.setRoot(await defaultFolder(), false)
        else ctx.renderTree()
        for (const f of grantListeners) f()
      }
    }
    takeIntent()
  })
}

/** Android may end a background app at any time: write the file, or keep the text as a draft */
async function saveOrKeepDraft() {
  const { S, settings } = ctx
  try {
    if (!ctx.syncDirty()) return localStorage.removeItem(DRAFT_KEY)
    // the draft first: Android may end the app while the save is still running
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ path: S.path, text: ctx.currentText(), at: Date.now() }))
    // quiet: no "changed on disk" or "save failed" dialog nobody can see; the draft stays then
    if (S.path && settings.autoSave && !S.externalChange && !S.readonly) {
      if (await ctx.save({ quiet: true })) localStorage.removeItem(DRAFT_KEY)
    }
  } catch (e) {
    ctx.log('keeping the draft failed:', e)
  }
}

async function restoreDraft() {
  let d = null
  try {
    d = JSON.parse(localStorage.getItem(DRAFT_KEY))
  } catch {}
  if (!d?.text) return
  localStorage.removeItem(DRAFT_KEY)
  if (d.path && (await invoke('exists', { path: d.path }).catch(() => false))) await ctx.openFile(d.path, { force: true })
  await ctx.loadUnsaved(d.text, d.path && ctx.S.path === d.path ? d.path : null)
  ctx.toast('Your unsaved changes are back', 3000)
}

// ════════════════════════════════════════ system bars follow the theme
function followTheme() {
  let last = ''
  const apply = () => {
    const cs = getComputedStyle(document.documentElement)
    const color = toHex(cs.getPropertyValue('--chrome').trim() || '#ffffff')
    const dark = ['ink', 'slate'].includes(document.documentElement.dataset.theme)
    if (color + dark === last) return // style changes often (font size, width …)
    last = color + dark
    invoke('android_bar_color', { color, dark }).catch(() => {})
  }
  // the theme, or the Material You colors (set inline on <html>) changed
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
  apply()
}

/** Android's Color.parseColor only knows #rrggbb */
function toHex(c) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('')
  const m = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c)
  return m ? '#' + m.slice(1, 4).map((x) => (+x).toString(16).padStart(2, '0')).join('') : '#ffffff'
}

// ════════════════════════════════════════ updates: a new APK on GitHub (no in-app installing)
const LATEST = 'https://api.github.com/repos/Sooeeren/CaretFlow/releases/latest'
export async function checkForUpdates({ manual = false } = {}) {
  const { el, dialog, toast, settings, saveSettings, openUrl, version } = ctx
  if (manual) toast('Checking for updates…')
  let rel
  try {
    const r = await invoke('cloud_http', { req: { method: 'GET', url: LATEST, headers: [['Accept', 'application/vnd.github+json'], ['User-Agent', 'CaretFlow']], timeoutMs: 15000 } })
    if (r.status !== 200) throw new Error('HTTP ' + r.status)
    rel = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(r.body || ''), (c) => c.charCodeAt(0))))
  } catch (e) {
    if (manual) await dialog({ title: 'Update check failed', body: `CaretFlow could not reach GitHub.\n\n${e}` })
    return
  }
  const latest = String(rel.tag_name || '').replace(/^v/, '')
  if (!latest || !newer(latest, version)) {
    if (manual) await dialog({ title: 'You’re up to date', body: `CaretFlow ${version} is the latest version.` })
    return
  }
  if (!manual && (settings.updateSkip === latest || !document.querySelector('#modal').hidden)) return
  const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name) && !/debug/i.test(a.name))
  const notes = String(rel.body || '')
    .replace(/\r/g, '')
    .split(/\n## (?:Downloads|Updating)\b/)[0]
    .trim()
  const body = el('div', { class: 'update' }, el('p', {}, `CaretFlow ${latest} is available. You have ${version}.`))
  if (notes) body.append(el('div', { class: 'update-notes' }, notes.slice(0, 1500)))
  body.append(el('p', { class: 'about-note' }, 'Android installs the new version over this one; your documents and settings stay.'))
  const r = await dialog({
    title: 'Update available',
    body,
    wide: true,
    buttons: [
      { label: 'Skip This Version', value: 'skip' },
      { label: 'Later', value: 'later', cancel: true },
      { label: 'Download', value: 'download', primary: true },
    ],
  })
  if (r === 'skip') {
    settings.updateSkip = latest
    saveSettings()
  } else if (r === 'download') openUrl(apk?.browser_download_url || rel.html_url)
}

function newer(a, b) {
  const pa = a.split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}
