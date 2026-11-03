import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './style.css'

import { editorViewCtx, serializerCtx, commandsCtx } from '@milkdown/kit/core'
import { callCommand, $prose, $inputRule } from '@milkdown/kit/utils'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import * as cmk from '@milkdown/kit/preset/commonmark'
import * as gfm from '@milkdown/kit/preset/gfm'
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history'
import { toggleLinkCommand } from '@milkdown/kit/component/link-tooltip'

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { openUrl, openPath as osOpenPath, revealItemInDir } from '@tauri-apps/plugin-opener'

import * as P from './paths.js'
import { underline as underlinePlugin, toggleUnderlineCommand, underlineSchema } from './underline.js'
import { pageBreak as pageBreakPlugin, insertPageBreakCommand, PAGE_BREAK_HTML, callouts as calloutPlugins, calloutConfig, CALLOUTS } from './blocks.js'
import { initWriting, writingPlugin, writingSourceExtension, writingSettingsChanged, writingStatus, togglePanel as toggleWritingPanel, nextIssueMenu, dictionaryEditor } from './writing.js'
import { autocorrectRule } from './autocorrect.js'
import aiStats from './ai-stats.json'
import { version as APP_VERSION } from '../package.json'

const UNDERLINE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M5 21v-2h14v2H5Zm7-4q-2.525 0-3.925-1.575T6.675 11.2V3h2.55v8.35q0 1.4.775 2.275T12 14.5q1.225 0 1.988-.875t.762-2.275V3h2.55v8.2q0 2.65-1.4 4.225T12 17Z"/></svg>'
import guideMd from './guide.md?raw'

// ════════════════════════════════════════ state & settings
const $ = (s) => document.querySelector(s)
const html = document.documentElement
const scroller = $('#scroller')
const win = getCurrentWindow()

const IS_LINUX = /Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)
const DEFAULTS = {
  theme: 'paper',
  font: 'auto',
  fontSize: 16,
  lineHeight: 1.7,
  width: 860,
  wide: false,
  autoSave: false,
  spellcheck: true, // Folio's own spelling & grammar check (writing.js)
  wcGrammar: true,
  wcStyle: false,
  wcEngine: 'harper', // 'harper' (offline, English) | 'languagetool' (HTTP, 30+ languages)
  wcDialect: 'american',
  ltLanguage: 'auto',
  ltServer: 'https://api.languagetool.org',
  wcIgnoreUpper: true,
  wcIgnoreDigits: true,
  wcDictionary: [],
  wcDisabledRules: ['OxfordComma'], // opinionated; Word doesn't require it either
  autocorrect: true,
  autoCapitalize: false,
  reopenLast: true,
  readonlyDefault: false,
  imageDir: 'assets',
  copyImages: true,
  sidebar: true,
  sidebarTab: 'outline',
  sidebarWidth: 260,
  focus: false,
  typewriter: false,
  vim: false,
  startInSource: false,
  exportTheme: 'paper', // 'paper' | 'sepia' | 'current' — PDF/print & HTML export palette
  nativeTitlebar: false, // mirrored from Rust's ui.json at startup (decides decorations)
  customCSS: '',
}
const settings = { ...DEFAULTS, ...readJSON('folio.settings', {}) }
let recent = readJSON('folio.recent', [])

function readJSON(k, d) {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d
  } catch {
    return d
  }
}
function saveSettings() {
  if (S.cli) return
  try {
    localStorage.setItem('folio.settings', JSON.stringify(settings))
  } catch {}
}

const S = {
  path: null, // current file
  root: null, // folder shown in the file tree
  mode: 'wysiwyg', // or 'source'
  dirty: false,
  baseline: '', // markdown representation considered "clean" for the active mode (null = dirty until saved)
  diskText: '', // last loaded/saved file text (normalized \n)
  eol: '\n',
  mtime: 0,
  readonly: false,
  externalChange: false,
  cli: false,
  vimMode: null, // 'normal' | 'insert' | 'visual …' | 'replace' while Vim is active in source mode
}

let crepe = null
let source = null // lazy source-mode API
let sourceMod = null

// ════════════════════════════════════════ diagnostics
const log = (...a) => invoke('log_line', { line: `${new Date().toISOString()} ${a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}` }).catch(() => {})
addEventListener('error', (e) => log('error:', e.error || e.message))
addEventListener('unhandledrejection', (e) => log('unhandled:', e.reason instanceof Error ? e.reason : String(e.reason)))

// ════════════════════════════════════════ small utilities
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const debounce = (fn, ms) => {
  let t
  return (...a) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}
const isDark = () => ['ink', 'slate'].includes(html.dataset.theme)
const isMdPath = (p) => ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx', 'txt'].includes(P.extname(p))
const isImgPath = (p) => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'].includes(P.extname(p))

let toastT
function toast(msg, ms = 1600) {
  const t = $('#toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toastT)
  toastT = setTimeout(() => t.classList.remove('show'), ms)
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k))
  return e
}

// ════════════════════════════════════════ modal dialogs
function dialog({ title, body = '', buttons = [{ label: 'OK', value: true, primary: true }], input, wide, onMount }) {
  return new Promise((resolve) => {
    const m = $('#modal')
    const box = el('div', { class: 'modal-box' + (wide ? ' wide' : '') })
    if (title) box.append(el('h3', {}, title))
    if (typeof body === 'string') {
      if (body) box.append(el('p', {}, body))
    } else box.append(body)
    let inp
    if (input) {
      inp = el('input', { type: 'text', value: input.value ?? '', placeholder: input.placeholder ?? '', spellcheck: 'false' })
      box.append(inp)
    }
    const done = (v) => {
      m.hidden = true
      m.innerHTML = ''
      document.removeEventListener('keydown', onKey, true)
      resolve(input && v !== undefined && v !== false && v !== null ? (v === true ? inp.value : v) : v)
    }
    const row = el('div', { class: 'modal-btns' })
    for (const b of buttons) row.append(el('button', { class: b.primary ? 'primary' : '', onclick: () => done(b.value) }, b.label))
    box.append(row)
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        done(buttons.find((b) => b.cancel)?.value ?? null)
      } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        e.preventDefault()
        e.stopPropagation()
        done(buttons.find((b) => b.primary)?.value ?? true)
      }
    }
    document.addEventListener('keydown', onKey, true)
    m.append(box)
    m.hidden = false
    m.onmousedown = (e) => e.target === m && done(buttons.find((b) => b.cancel)?.value ?? null)
    onMount?.(box, done)
    ;(inp || row.querySelector('.primary') || row.lastChild)?.focus()
    if (inp) {
      inp.select()
      if (input.selectStem) inp.setSelectionRange(0, inp.value.replace(/\.[^.]+$/, '').length)
    }
  })
}

/** Synchronous dirty check (the editor's change listener is debounced). */
function syncDirty() {
  try {
    const t = S.mode === 'source' ? source?.getText() : crepe?.getMarkdown()
    if (t != null) setDirty(S.baseline === null ? true : t !== S.baseline)
  } catch {}
  return S.dirty
}

async function confirmDiscard() {
  if (!syncDirty()) return true
  const r = await dialog({
    title: 'Unsaved changes',
    body: `Do you want to save the changes to “${S.path ? P.basename(S.path) : 'Untitled'}”?`,
    buttons: [
      { label: 'Cancel', value: 'cancel', cancel: true },
      { label: "Don't Save", value: 'discard' },
      { label: 'Save', value: 'save', primary: true },
    ],
  })
  if (r === 'save') return await save()
  return r === 'discard'
}

// ════════════════════════════════════════ editor (WYSIWYG)
const folioKey = new PluginKey('folio')
const find = { query: '', cs: false, word: false, regex: false }

function buildRegex(q, o) {
  if (!q) return null
  try {
    let src = o.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (o.word) src = `\\b(?:${src})\\b`
    return new RegExp(src, 'g' + (o.cs ? '' : 'i') + 'u')
  } catch {
    return null
  }
}

function findMatches(doc, re) {
  const res = []
  if (!re) return res
  doc.descendants((node, pos) => {
    if (res.length > 9999) return false
    if (!node.isTextblock) return true
    let text = ''
    const map = []
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i)
        text += child.text
      } else {
        map.push(pos + 1 + offset)
        text += '￼'
      }
    })
    map.push(pos + 1 + node.content.size)
    re.lastIndex = 0
    for (let m; (m = re.exec(text)); ) {
      if (!m[0].length) {
        re.lastIndex++
        continue
      }
      res.push({ from: map[m.index], to: map[m.index + m[0].length - 1] + 1, text: m[0] })
    }
    return false
  })
  return res
}

const folioPlugin = $prose(
  () =>
    new Plugin({
      key: folioKey,
      state: {
        init: () => ({ re: null, matches: [], current: -1, deco: DecorationSet.empty }),
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(folioKey) || {}
          let { re, matches, current } = prev
          if ('re' in meta) re = meta.re
          if ('re' in meta || tr.docChanged) matches = findMatches(state.doc, re)
          if ('current' in meta) current = meta.current
          if (current >= matches.length) current = matches.length ? 0 : -1
          if (current < 0 && matches.length && 're' in meta) current = 0
          const decos = []
          matches.forEach((m, i) => decos.push(Decoration.inline(m.from, m.to, { class: i === current ? 'find-hit current' : 'find-hit' })))
          if (settings.focus) {
            const $f = state.selection.$from
            if ($f.depth >= 1) decos.push(Decoration.node($f.before(1), $f.after(1), { class: 'is-focused' }))
          }
          const deco = decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty
          return { re, matches, current, deco }
        },
      },
      props: {
        decorations: (state) => folioKey.getState(state).deco,
        handlePaste(view, event) {
          const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
          if (!files.length || S.readonly) return false
          event.preventDefault()
          ;(async () => {
            for (const f of files) insertImage(await storeImageFile(f), P.stem(f.name) || 'image')
          })()
          return true
        },
      },
      view: () => ({ update: (view, prev) => onViewUpdate(view, prev) }),
    }),
)

function onViewUpdate(view, prev) {
  const selChanged = !prev.selection.eq(view.state.selection)
  if (view.state.doc !== prev.doc) scheduleDocInfo()
  if (selChanged || view.state.doc !== prev.doc) {
    if (settings.typewriter && view.hasFocus()) centerAt(view.coordsAtPos(view.state.selection.head))
    scheduleActiveHeading()
  }
}

function centerAt(c) {
  if (!c) return
  const r = scroller.getBoundingClientRect()
  scroller.scrollTop += c.top - (r.top + r.height / 2)
}

let mmId = 0
let mermaidP = null
function renderPreview(lang, content, apply) {
  if ((lang || '').toLowerCase() !== 'mermaid' || !content.trim()) return null
  mermaidP ||= import('mermaid').then((m) => m.default)
  mermaidP.then(async (mermaid) => {
    mermaid.initialize({ startOnLoad: false, theme: isDark() ? 'dark' : 'default', securityLevel: 'strict', flowchart: { htmlLabels: false } })
    const id = 'mmd' + ++mmId
    try {
      const { svg } = await mermaid.render(id, content)
      apply(svg)
    } catch (e) {
      document.getElementById('d' + id)?.remove()
      apply(`<pre class="mermaid-error">${esc(String(e?.message || e))}</pre>`)
    }
  })
  return undefined
}

function resolveSrc(url) {
  if (!url || /^(https?:|data:|blob:|asset:|tauri:|file:)/i.test(url) || url.startsWith('http://asset.localhost')) return url
  const p = P.decodeSrc(url)
  const abs = P.isAbs(p) ? p : S.path ? P.join(P.dirname(S.path), p) : null
  return abs ? convertFileSrc(abs) : url
}

function view() {
  return crepe ? crepe.editor.ctx.get(editorViewCtx) : null
}

// ── writing check (spelling, grammar, AutoCorrect)
const writingProse = $prose(() => writingPlugin())
const isEnglishCheck = () => settings.wcEngine !== 'languagetool' || /^en/i.test(settings.ltLanguage || '')
const autocorrectInput = $inputRule(() => autocorrectRule(() => ({ enabled: settings.autocorrect, capitalize: settings.autoCapitalize, english: isEnglishCheck() })))
const run = (cmd, payload) => crepe?.editor.action(callCommand(cmd.key, payload))

async function createEditor(markdown) {
  if (crepe) {
    const old = crepe
    crepe = null
    await old.destroy()
  }
  const root = $('#wysiwyg')
  root.innerHTML = ''
  const c = new Crepe({
    root,
    defaultValue: markdown,
    features: { [Crepe.Feature.TopBar]: false, [Crepe.Feature.AI]: false },
    featureConfigs: {
      [Crepe.Feature.ImageBlock]: { onUpload: storeImageFile, proxyDomURL: resolveSrc },
      [Crepe.Feature.CodeMirror]: { renderPreview, previewOnlyByDefault: true },
      [Crepe.Feature.Placeholder]: { text: 'Start writing…  (type / for blocks)', mode: 'doc' },
      [Crepe.Feature.Toolbar]: {
        // add Underline to the selection toolbar, next to bold / italic / strikethrough
        buildToolbar: (builder) => {
          builder.getGroup('formatting').addItem('underline', {
            icon: UNDERLINE_ICON,
            label: 'Underline',
            shortcut: 'Ctrl+U',
            active: (ctx) => ctx.get(commandsCtx).call(cmk.isMarkSelectedCommand.key, underlineSchema.type(ctx)),
            onRun: (ctx) => ctx.get(commandsCtx).call(toggleUnderlineCommand.key),
          })
        },
      },
    },
  })
  c.editor.config(calloutConfig).use(underlinePlugin).use(pageBreakPlugin).use(calloutPlugins).use(folioPlugin).use(writingProse).use(autocorrectInput)
  c.on((api) => api.markdownUpdated((_ctx, md) => c === crepe && onMarkdown(md)))
  await c.create()
  crepe = c
  if (S.readonly) c.setReadonly(true)
  return c
}

function onMarkdown(md) {
  setDirty(S.baseline === null ? true : md !== S.baseline)
  scheduleAutoSave()
}

function setDirty(d) {
  if (d === S.dirty) return
  S.dirty = d
  updateTitle()
}

// ════════════════════════════════════════ source mode
async function ensureSourceMod() {
  if (sourceMod) return sourceMod
  sourceMod = await import('./source.js')
  const resolve = (name) => (P.isAbs(name) ? name : P.join(S.path ? P.dirname(S.path) : S.root || '', name))
  sourceMod.defineVimCommands({
    save: () => save(),
    saveAs: (name) => saveAs(resolve(/\.\w+$/.test(name) ? name : name + '.md')),
    close: () => win.close(),
    forceClose: () => {
      S.dirty = false
      S.baseline = null
      win.destroy()
    },
    toggleMode: () => toggleSource(),
    quickOpen: () => quickOpen(),
    open: (name) => openFile(resolve(name)),
  })
  return sourceMod
}

function setVimMode(m) {
  S.vimMode = m
  updateFlags()
}

async function enterSource() {
  const mod = await ensureSourceMod()
  const ratio = scrollRatio()
  const text = S.dirty ? crepe.getMarkdown() : S.diskText
  const clean = !S.dirty
  if (crepe) {
    const old = crepe
    crepe = null
    await old.destroy()
  }
  $('#wysiwyg').hidden = true
  $('#wysiwyg').innerHTML = ''
  const host = $('#source')
  host.hidden = false
  host.innerHTML = ''
  source = mod.createSource(host, {
    text,
    vim: settings.vim,
    extensions: [writingSourceExtension()],
    onVimMode: setVimMode,
    onChange: (t) => {
      setDirty(S.baseline === null ? true : t !== S.baseline)
      scheduleDocInfo()
      scheduleAutoSave()
    },
    onSelection: () => {
      if (settings.typewriter && source?.view.hasFocus) source.centerCursor(scroller)
      scheduleActiveHeading()
    },
  })
  S.mode = 'source'
  S.baseline = clean ? text : null
  source.view.contentDOM.spellcheck = false // Folio checks spelling itself (writing.js)
  if (S.readonly) source.view.contentDOM.contentEditable = 'false'
  requestAnimationFrame(() => setScrollRatio(ratio))
  source.focus()
  afterModeSwitch()
}

async function exitSource() {
  const ratio = scrollRatio()
  const text = source.getText()
  const clean = !S.dirty
  source.destroy()
  source = null
  setVimMode(null)
  $('#source').hidden = true
  $('#source').innerHTML = ''
  $('#wysiwyg').hidden = false
  S.mode = 'wysiwyg'
  await createEditor(text)
  S.baseline = clean ? crepe.getMarkdown() : null
  requestAnimationFrame(() => setScrollRatio(ratio))
  afterModeSwitch()
}

function afterModeSwitch() {
  $('#st-mode').classList.toggle('on', S.mode === 'source')
  if (!$('#findbar').hidden) runFind()
  scheduleDocInfo()
}

const toggleSource = () => (S.mode === 'source' ? exitSource() : enterSource())

const scrollRatio = () => scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight)
const setScrollRatio = (r) => (scroller.scrollTop = r * (scroller.scrollHeight - scroller.clientHeight))

// ════════════════════════════════════════ document text
function currentText() {
  if (S.mode === 'source') return source.getText()
  return crepe ? crepe.getMarkdown() : ''
}

async function loadText(text, { keepScroll = false } = {}) {
  const top = scroller.scrollTop
  S.diskText = text
  if (S.mode === 'source') {
    source.setText(text)
    S.baseline = text
  } else {
    await createEditor(text)
    S.baseline = crepe.getMarkdown()
  }
  S.dirty = false
  scroller.scrollTop = keepScroll ? top : 0
  updateTitle()
  scheduleDocInfo(true)
}

// ════════════════════════════════════════ file operations
function normalizeEol(t) {
  return t.replace(/\r\n?/g, '\n')
}

async function openFile(p, { force = false } = {}) {
  try {
    if (await invoke('is_dir', { path: p })) return setRoot(p, true)
    if (!force && !(await confirmDiscard())) return false
    const raw = await invoke('read_text', { path: p })
    S.eol = raw.includes('\r\n') ? '\r\n' : '\n'
    S.path = p
    S.mtime = await invoke('mtime', { path: p }).catch(() => 0)
    S.readonly = settings.readonlyDefault
    hideNotice()
    if (!S.root || !P.isInside(p, S.root)) S.root = P.dirname(p)
    await loadText(normalizeEol(raw))
    addRecent(p)
    renderTree()
    applyReadonly()
    if (settings.startInSource && S.mode === 'wysiwyg') await enterSource()
    return true
  } catch (e) {
    toast('Could not open file: ' + e, 3000)
    return false
  }
}

async function newFile() {
  if (!(await confirmDiscard())) return
  S.path = null
  S.mtime = 0
  S.eol = '\n'
  S.readonly = false
  hideNotice()
  await loadText('')
  applyReadonly()
  renderTree()
  focusEditor()
}

async function openFileDialog() {
  const p = await openDialog({
    multiple: false,
    directory: false,
    defaultPath: S.path ? P.dirname(S.path) : S.root || undefined,
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (p) await openFile(p)
}

async function openFolderDialog() {
  const p = await openDialog({ directory: true, defaultPath: S.root || undefined })
  if (p) setRoot(p, true)
}

async function save() {
  if (!S.path) return saveAs()
  const text = currentText()
  try {
    const m = await invoke('mtime', { path: S.path }).catch(() => 0)
    if (S.mtime && m && m !== S.mtime) {
      const r = await dialog({
        title: 'File changed on disk',
        body: `“${P.basename(S.path)}” was modified by another program since it was opened. Overwrite it?`,
        buttons: [
          { label: 'Cancel', value: false, cancel: true },
          { label: 'Overwrite', value: true, primary: true },
        ],
      })
      if (!r) return false
    }
    await writeDoc(S.path, text)
    toast('Saved')
    return true
  } catch (e) {
    log('save failed:', e)
    await dialog({ title: 'Save failed', body: String(e) })
    return false
  }
}

async function writeDoc(path, text) {
  const out = (text.endsWith('\n') ? text : text + '\n').replace(/\n/g, S.eol)
  S.mtime = await invoke('write_text', { path, content: out })
  S.diskText = text
  S.baseline = text
  S.externalChange = false
  hideNotice()
  setDirty(false)
  updateTitle()
}

async function saveAs(target) {
  const suggested = S.path || P.join(S.root || '', (firstHeading() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) + '.md')
  const p =
    typeof target === 'string' ? target : await saveDialog({ defaultPath: suggested, filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] })
  if (!p) return false
  const text = currentText()
  const oldDir = S.path ? P.dirname(S.path) : null
  S.path = p
  try {
    await writeDoc(p, text)
  } catch (e) {
    await dialog({ title: 'Save failed', body: String(e) })
    return false
  }
  addRecent(p)
  if (!S.root || !P.isInside(p, S.root)) S.root = P.dirname(p)
  renderTree()
  if (oldDir !== P.dirname(p) && S.mode === 'wysiwyg') {
    // re-render so relative images resolve against the new location
    await loadText(text, { keepScroll: true })
  }
  toast('Saved')
  return true
}

const autoSave = debounce(() => {
  if (settings.autoSave && S.path && S.dirty && !S.externalChange) save()
}, 1200)
function scheduleAutoSave() {
  if (settings.autoSave) autoSave()
}

async function reloadFromDisk() {
  if (!S.path) return
  if (!(await confirmDiscard())) return
  await openFile(S.path, { force: true })
}

function addRecent(p) {
  if (S.cli) return // headless exports must not touch the user's recent files
  recent = [p, ...recent.filter((r) => r.toLowerCase() !== p.toLowerCase())].slice(0, 20)
  try {
    localStorage.setItem('folio.recent', JSON.stringify(recent))
  } catch {}
}

// Watch the current file for external modifications
async function checkExternal() {
  if (!S.path || document.hidden) return
  let m
  try {
    m = await invoke('mtime', { path: S.path })
  } catch {
    return
  }
  if (!S.mtime || m === S.mtime || S.externalChange) return
  if (!syncDirty()) {
    const raw = await invoke('read_text', { path: S.path })
    S.mtime = m
    const text = normalizeEol(raw)
    if (text !== S.diskText) {
      await loadText(text, { keepScroll: true })
      toast('Reloaded — file changed on disk')
    }
  } else {
    S.externalChange = true
    showNotice('This file was changed by another program.', [
      { label: 'Reload', fn: () => openFile(S.path, { force: true }) },
      {
        label: 'Keep mine',
        fn: () => {
          S.mtime = m
          S.externalChange = false
          hideNotice()
        },
      },
    ])
  }
}

function showNotice(msg, actions = []) {
  const n = $('#notice')
  n.innerHTML = ''
  n.append(el('span', {}, msg), el('span', { class: 'spacer' }))
  for (const a of actions) n.append(el('button', { onclick: a.fn }, a.label))
  n.hidden = false
}
const hideNotice = () => ($('#notice').hidden = true)

// ════════════════════════════════════════ images
async function storeImageFile(file) {
  if (!S.path) {
    return await new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.readAsDataURL(file)
    })
  }
  const ext = P.extname(file.name) || (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
  const base = (P.stem(file.name) || 'image').replace(/[^\w.-]+/g, '-').slice(0, 40)
  const name = `${base}-${Date.now().toString(36)}.${ext}`
  const dir = P.join(P.dirname(S.path), settings.imageDir || 'assets')
  const data = Array.from(new Uint8Array(await file.arrayBuffer()))
  await invoke('write_bytes', { path: P.join(dir, name), data })
  return P.encodeSrc((settings.imageDir || 'assets').replace(/[\\/]+$/, '') + '/' + name)
}

async function srcForDroppedImage(abs) {
  if (!S.path) return P.encodeSrc(abs)
  const docDir = P.dirname(S.path)
  if (settings.copyImages && !P.isInside(abs, docDir)) {
    const dir = settings.imageDir || 'assets'
    let target = P.join(P.join(docDir, dir), P.basename(abs))
    if (await invoke('exists', { path: target })) target = P.join(P.join(docDir, dir), `${P.stem(abs)}-${Date.now().toString(36)}.${P.extname(abs)}`)
    await invoke('copy_file', { from: abs, to: target })
    abs = target
  }
  return P.encodeSrc(P.relative(docDir, abs) ?? abs)
}

function insertImage(src, alt = '', pos) {
  if (S.mode === 'source') return source.insert(`![${alt}](${src})`)
  const v = view()
  if (!v) return
  if (pos != null) v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(pos))))
  run(cmk.insertImageCommand, { src, alt })
}

async function insertImageDialog() {
  const p = await openDialog({ multiple: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }] })
  if (p) insertImage(await srcForDroppedImage(p), P.stem(p))
}

// ════════════════════════════════════════ links
async function openLink(href) {
  if (!href) return
  if (/^(https?:|mailto:)/i.test(href)) return openUrl(href)
  if (href.startsWith('#')) return jumpToSlug(decodeURIComponent(href.slice(1)))
  const [pathPart, hash] = href.split('#')
  const p = P.decodeSrc(pathPart)
  const abs = P.isAbs(p) ? p : S.path ? P.join(P.dirname(S.path), p) : p
  if (isMdPath(abs) || (await invoke('exists', { path: abs + '.md' }).catch(() => false))) {
    const target = isMdPath(abs) ? abs : abs + '.md'
    if (await openFile(target)) {
      if (hash) setTimeout(() => jumpToSlug(decodeURIComponent(hash)), 50)
    }
    return
  }
  osOpenPath(abs).catch((e) => toast(String(e)))
}

const slugify = (s) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')

function jumpToSlug(slug) {
  const h = collectHeadings().find((h) => slugify(h.text) === slug.toLowerCase() || h.text.toLowerCase() === slug.toLowerCase())
  if (h) jumpToHeading(h)
}

// ════════════════════════════════════════ outline
let headingsCache = []
function collectHeadings() {
  const out = []
  if (S.mode === 'source' && source) {
    const lines = source.getText().split('\n')
    let fence = null
    lines.forEach((ln, i) => {
      const f = /^\s*(```|~~~)/.exec(ln)
      if (f) fence = fence ? (ln.trim().startsWith(fence) ? null : fence) : f[1]
      if (fence) return
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(ln)
      if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, ''), line: i + 1 })
    })
  } else {
    const v = view()
    v?.state.doc.descendants((n, pos) => {
      if (n.type.name === 'heading') out.push({ level: n.attrs.level, text: n.textContent, pos })
      return !n.isTextblock && n.type.name !== 'code_block'
    })
  }
  return out
}
const firstHeading = () => collectHeadings()[0]?.text

function renderOutline() {
  headingsCache = collectHeadings()
  const box = $('#outline')
  box.innerHTML = ''
  if (!headingsCache.length) {
    box.append(el('div', { class: 'sb-hint' }, 'No headings yet. Start a line with # to create one.'))
    return
  }
  const min = Math.min(...headingsCache.map((h) => h.level))
  headingsCache.forEach((h, i) => {
    box.append(
      el(
        'div',
        { class: `ol-item l${h.level - min + 1}`, style: `padding-left:${8 + (h.level - min) * 14}px`, 'data-i': i, title: h.text, onclick: () => jumpToHeading(h) },
        h.text || '(empty heading)',
      ),
    )
  })
  updateActiveHeading()
}

function headingTop(h) {
  if (h.line != null) return source ? source.lineTop(h.line) + $('#source').offsetTop : 0
  const v = view()
  const dom = v?.nodeDOM(h.pos)
  if (!dom) return 0
  return dom.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
}

function jumpToHeading(h) {
  if (h.line != null) {
    source?.gotoLine(h.line)
    return
  }
  const v = view()
  if (!v) return
  scroller.scrollTo({ top: Math.max(0, headingTop(h) - 24), behavior: 'smooth' })
  try {
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, h.pos + 1 + v.state.doc.nodeAt(h.pos).content.size)))
    v.focus()
  } catch {}
}

function updateActiveHeading() {
  const items = $('#outline').querySelectorAll('.ol-item')
  if (!items.length) return
  const y = scroller.scrollTop + 90
  let idx = 0
  for (let i = 0; i < headingsCache.length; i++) {
    if (headingTop(headingsCache[i]) <= y) idx = i
    else break
  }
  items.forEach((it, i) => it.classList.toggle('active', i === idx))
}
const scheduleActiveHeading = debounce(updateActiveHeading, 80)

// ════════════════════════════════════════ word count & doc info
const countWords = (t) => {
  const cjk = (t.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g) || []).length
  const words = (t.replace(/[぀-ヿ㐀-䶿一-鿿가-힯]/g, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length
  return words + cjk
}
function updateCount() {
  let text
  let sel = ''
  if (S.mode === 'source' && source) {
    text = source.getText()
    sel = source.selectedText()
  } else {
    const v = view()
    if (!v) return
    text = v.state.doc.textBetween(0, v.state.doc.content.size, '\n', ' ')
    const { from, to, empty } = v.state.selection
    if (!empty && v.hasFocus() && v.state.selection instanceof TextSelection) sel = v.state.doc.textBetween(from, to, '\n', ' ')
  }
  const w = countWords(text)
  const min = Math.max(1, Math.round(w / 230))
  const st = $('#st-count')
  st.textContent = sel ? `${countWords(sel).toLocaleString()} of ${w.toLocaleString()} words` : `${w.toLocaleString()} words · ${min} min read`
  st.title = `${text.length.toLocaleString()} characters\n${text.replace(/\s/g, '').length.toLocaleString()} characters (no spaces)\n${text.split('\n').length.toLocaleString()} lines`
}

const docInfo = debounce(() => {
  renderOutline()
  updateCount()
}, 180)
function scheduleDocInfo(now) {
  if (pagePreviewOpen()) schedulePreview()
  if (now) {
    renderOutline()
    updateCount()
  } else docInfo()
}
document.addEventListener('selectionchange', debounce(updateCount, 200))

// ════════════════════════════════════════ file tree
function setRoot(p, showFiles) {
  S.root = p
  renderTree()
  if (showFiles) {
    setSidebar(true)
    setTab('files')
  }
  quickCache = null
}

async function renderTree() {
  const tree = $('#tree')
  const root = S.root
  $('#root-name').textContent = root ? P.basename(root) || root : 'No folder'
  $('#root-name').title = root || ''
  if (!root) {
    tree.innerHTML = ''
    tree.append(el('div', { class: 'tree-empty' }, 'Open a file or folder (Ctrl+Shift+O) to browse documents here.'))
    return
  }
  const open = new Set(readJSON('folio.openDirs', []))
  const frag = document.createDocumentFragment()
  await renderDir(root, frag, open, 0)
  tree.innerHTML = ''
  tree.append(frag)
}

async function renderDir(dir, parent, open, depth) {
  let entries = []
  try {
    entries = await invoke('list_dir', { path: dir })
  } catch {}
  if (!entries.length && depth === 0) parent.append(el('div', { class: 'tree-empty' }, 'No markdown files in this folder.'))
  for (const e of entries) {
    const isCur = S.path && e.path.toLowerCase() === S.path.toLowerCase()
    const row = el(
      'div',
      { class: 'tree-row' + (e.dir ? ' dir' : '') + (isCur ? ' current' : ''), title: e.path },
      el('span', { class: 'tw' }, e.dir ? (open.has(e.path) ? '▾' : '▸') : ''),
      el('span', { class: 'nm' }, e.dir ? e.name : e.name.replace(/\.(md|markdown)$/i, '')),
    )
    parent.append(row)
    let kids = null
    if (e.dir) {
      kids = el('div', { class: 'tree-kids' })
      parent.append(kids)
      if (open.has(e.path)) await renderDir(e.path, kids, open, depth + 1)
      else kids.hidden = true
    }
    row.onclick = async () => {
      if (!e.dir) return openFile(e.path)
      const o = new Set(readJSON('folio.openDirs', []))
      if (o.has(e.path)) {
        o.delete(e.path)
        kids.hidden = true
        row.firstChild.textContent = '▸'
      } else {
        o.add(e.path)
        kids.innerHTML = ''
        await renderDir(e.path, kids, o, depth + 1)
        kids.hidden = false
        row.firstChild.textContent = '▾'
      }
      localStorage.setItem('folio.openDirs', JSON.stringify([...o].slice(-200)))
    }
    row.oncontextmenu = (ev) => {
      ev.preventDefault()
      const items = e.dir
        ? [
            ['New File Here…', () => createFileIn(e.path)],
            ['Set as Root Folder', () => setRoot(e.path)],
            '-',
            ['Reveal in Explorer', () => revealItemInDir(e.path)],
            ['Copy Path', () => navigator.clipboard.writeText(e.path)],
          ]
        : [
            ['Open', () => openFile(e.path)],
            ['Open in New Window', () => invoke('new_window', { path: e.path })],
            '-',
            ['Rename…', () => renameFile(e.path)],
            ['Reveal in Explorer', () => revealItemInDir(e.path)],
            ['Copy Path', () => navigator.clipboard.writeText(e.path)],
          ]
      showContextMenu(ev.clientX, ev.clientY, items)
    }
  }
}

async function createFileIn(dir) {
  dir ||= S.root || (S.path && P.dirname(S.path))
  if (!dir) return saveAs()
  const name = await dialog({
    title: 'New file',
    input: { value: 'Untitled.md', selectStem: true },
    buttons: [
      { label: 'Cancel', value: null, cancel: true },
      { label: 'Create', value: true, primary: true },
    ],
  })
  if (!name) return
  const p = P.join(dir, /\.\w+$/.test(name) ? name : name + '.md')
  if (await invoke('exists', { path: p })) return toast('A file with that name already exists', 2500)
  if (!(await confirmDiscard())) return
  await invoke('write_text', { path: p, content: '' })
  await openFile(p, { force: true })
  focusEditor()
}

async function renameFile(p) {
  const name = await dialog({
    title: 'Rename',
    input: { value: P.basename(p), selectStem: true },
    buttons: [
      { label: 'Cancel', value: null, cancel: true },
      { label: 'Rename', value: true, primary: true },
    ],
  })
  if (!name || name === P.basename(p)) return
  const target = P.join(P.dirname(p), name)
  try {
    await invoke('rename_path', { from: p, to: target })
    if (S.path && S.path.toLowerCase() === p.toLowerCase()) {
      S.path = target
      S.mtime = await invoke('mtime', { path: target })
      addRecent(target)
      updateTitle()
    }
    renderTree()
    quickCache = null
  } catch (e) {
    toast('Rename failed: ' + e, 3000)
  }
}

// ════════════════════════════════════════ folder search
const runFolderSearch = debounce(async () => {
  const q = $('#search-input').value.trim()
  const box = $('#search-results')
  box.innerHTML = ''
  const root = S.root || (S.path && P.dirname(S.path))
  if (!q) return
  if (!root) return box.append(el('div', { class: 'sb-hint' }, 'Open a folder first.'))
  const hits = await invoke('search_files', { root, query: q })
  if (!hits.length) return box.append(el('div', { class: 'sb-hint' }, 'No results.'))
  let lastFile = null
  const ql = q.toLowerCase()
  for (const h of hits) {
    if (h.path !== lastFile) {
      lastFile = h.path
      box.append(el('div', { class: 'sr-file', title: h.path }, P.relative(root, h.path) || P.basename(h.path)))
    }
    const i = h.text.toLowerCase().indexOf(ql)
    const item = el('div', { class: 'sr-item' }, el('span', { class: 'ln' }, String(h.line)))
    if (i >= 0) item.append(h.text.slice(0, i), el('b', {}, h.text.slice(i, i + q.length)), h.text.slice(i + q.length))
    else item.append(h.text)
    item.onclick = async () => {
      if (S.path?.toLowerCase() !== h.path.toLowerCase() && !(await openFile(h.path))) return
      openFind(false, q)
    }
    box.append(item)
  }
  if (hits.length >= 500) box.append(el('div', { class: 'sb-hint' }, 'Showing the first 500 matches.'))
}, 250)

// ════════════════════════════════════════ find & replace
function openFind(replace = false, preset) {
  const fb = $('#findbar')
  fb.hidden = false
  $('#replace-row').hidden = !replace && $('#replace-row').hidden
  if (replace) $('#replace-row').hidden = false
  const inp = $('#find-input')
  const selected = preset ?? selectedPlainText()
  if (selected && !selected.includes('\n') && selected.length < 200) inp.value = selected
  inp.focus()
  inp.select()
  runFind()
}

function selectedPlainText() {
  if (S.mode === 'source') return source?.selectedText() || ''
  const v = view()
  if (!v || v.state.selection.empty) return ''
  return v.state.doc.textBetween(v.state.selection.from, v.state.selection.to, ' ')
}

function closeFind() {
  $('#findbar').hidden = true
  if (S.mode === 'source') source?.search('', {})
  else {
    const v = view()
    v?.dispatch(v.state.tr.setMeta(folioKey, { re: null, current: -1 }))
  }
  focusEditor()
}

let cmQuery = null
function runFind(jump = true) {
  find.query = $('#find-input').value
  const opts = { cs: find.cs, word: find.word, regex: find.regex, replace: $('#replace-input').value }
  let total = 0
  let index = -1
  if (S.mode === 'source' && source) {
    cmQuery = source.search(find.query, opts)
    if (jump && find.query) {
      const { view: cmv } = source
      const head = cmv.state.selection.main.from
      cmv.dispatch({ selection: { anchor: head } })
      source.findNext()
    }
    ;({ total, index } = source.countMatches(cmQuery))
  } else {
    const v = view()
    if (!v) return
    const re = buildRegex(find.query, find)
    let current = 0
    if (re && jump) {
      const ms = findMatches(v.state.doc, re)
      const from = v.state.selection.from
      current = Math.max(0, ms.findIndex((m) => m.from >= from))
    }
    v.dispatch(v.state.tr.setMeta(folioKey, { re, current }))
    const st = folioKey.getState(v.state)
    total = st.matches.length
    index = st.current
    if (jump && index >= 0) revealMatch(index)
  }
  showFindCount(total, index)
}

function showFindCount(total, index) {
  $('#find-count').textContent = find.query ? (total ? `${index + 1 || '?'} of ${total > 9999 ? '9999+' : total}` : 'No results') : ''
  $('#find-input').classList.toggle('nomatch', !!find.query && !total)
}

function revealMatch(i) {
  const v = view()
  const m = folioKey.getState(v.state).matches[i]
  if (!m) return
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, m.from, m.to)).setMeta(folioKey, { current: i }))
  const c = v.coordsAtPos(m.from)
  const r = scroller.getBoundingClientRect()
  if (c.top < r.top + 60 || c.bottom > r.bottom - 60) centerAt(c)
}

function findStep(dir) {
  if ($('#findbar').hidden) return openFind()
  if (S.mode === 'source') {
    dir > 0 ? source.findNext() : source.findPrev()
    const { total, index } = source.countMatches(cmQuery)
    return showFindCount(total, index)
  }
  const v = view()
  const st = folioKey.getState(v.state)
  if (!st.matches.length) return
  const i = (st.current + dir + st.matches.length) % st.matches.length
  revealMatch(i)
  showFindCount(st.matches.length, i)
}

function expandReplacement(m, rep) {
  if (!find.regex) return rep
  const re = buildRegex(find.query, find)
  return m.text.replace(new RegExp(re.source, re.flags.replace('g', '')), rep)
}

function replaceOne() {
  if (S.readonly) return
  const rep = $('#replace-input').value
  if (S.mode === 'source') {
    source.search(find.query, { ...find, replace: rep })
    source.replaceNext()
    const { total, index } = source.countMatches(cmQuery)
    return showFindCount(total, index)
  }
  const v = view()
  const st = folioKey.getState(v.state)
  const m = st.matches[st.current]
  if (!m) return
  const text = expandReplacement(m, rep)
  v.dispatch(text ? v.state.tr.insertText(text, m.from, m.to) : v.state.tr.delete(m.from, m.to))
  const st2 = folioKey.getState(v.state)
  if (st2.matches.length) revealMatch(Math.min(st.current, st2.matches.length - 1))
  showFindCount(st2.matches.length, folioKey.getState(v.state).current)
}

function replaceAllMatches() {
  if (S.readonly) return
  const rep = $('#replace-input').value
  if (S.mode === 'source') {
    source.search(find.query, { ...find, replace: rep })
    source.replaceAll()
    const { total, index } = source.countMatches(cmQuery)
    return showFindCount(total, index)
  }
  const v = view()
  const ms = folioKey.getState(v.state).matches
  if (!ms.length) return
  let tr = v.state.tr
  for (let i = ms.length - 1; i >= 0; i--) {
    const t = expandReplacement(ms[i], rep)
    tr = t ? tr.insertText(t, ms[i].from, ms[i].to) : tr.delete(ms[i].from, ms[i].to)
  }
  v.dispatch(tr)
  toast(`Replaced ${ms.length} occurrence${ms.length === 1 ? '' : 's'}`)
  showFindCount(folioKey.getState(v.state).matches.length, -1)
}

// ════════════════════════════════════════ formatting commands
const inSource = () => S.mode === 'source' && source
const blockInfo = () => {
  const v = view()
  const $f = v.state.selection.$from
  return { v, node: $f.parent, $f }
}

function heading(n) {
  if (inSource()) return source.linePrefix(n ? '#'.repeat(n) + ' ' : '', /^#{1,6}\s+/)
  const { node } = blockInfo()
  if (n === 0 || (node.type.name === 'heading' && node.attrs.level === n)) run(cmk.turnIntoTextCommand)
  else run(cmk.wrapInHeadingCommand, n)
}
function headingStep(d) {
  if (inSource()) {
    const line = source.view.state.doc.lineAt(source.view.state.selection.main.head).text
    const lvl = (/^(#{1,6})\s/.exec(line) || [, ''])[1].length
    const next = lvl === 0 ? (d < 0 ? 6 : 0) : lvl + (d < 0 ? -1 : 1)
    return source.linePrefix(next >= 1 && next <= 6 ? '#'.repeat(next) + ' ' : '', /^#{1,6}\s+/)
  }
  const { node } = blockInfo()
  const lvl = node.type.name === 'heading' ? node.attrs.level : 0
  // d<0 = promote (bigger), d>0 = demote (smaller)
  const next = lvl === 0 ? (d < 0 ? 6 : 0) : lvl + (d < 0 ? -1 : 1)
  if (next >= 1 && next <= 6) run(cmk.wrapInHeadingCommand, next)
  else if (lvl) run(cmk.turnIntoTextCommand)
}
const mark = (cmd, md) => () => (inSource() ? source.wrap(md[0], md[1] ?? md[0]) : run(cmd))

function codeBlock(lang = '') {
  if (inSource()) return source.insert('\n```' + lang + '\n' + source.selectedText() + '\n```\n')
  run(cmk.createCodeBlockCommand, lang)
}

// ── page breaks & callouts
function pageBreak() {
  if (inSource()) return source.insert('\n' + PAGE_BREAK_HTML + '\n\n')
  run(insertPageBreakCommand)
  if (pagePreviewOpen()) schedulePreview()
}

/** Wrap the current block (or selection) in a GitHub-style alert: > [!WARNING] … */
function callout(kind) {
  const marker = `[!${kind.toUpperCase()}]`
  if (inSource()) {
    const sel = source.selectedText()
    const body = (sel || '').split('\n').map((l) => '> ' + l).join('\n')
    return source.insert(`\n> ${marker}\n${sel ? body : '> '}\n`)
  }
  const v = view()
  if (!v) return
  const { schema } = v.state
  const $f = v.state.selection.$from
  // inside an existing quote: just (re)set its marker
  for (let d = $f.depth; d > 0; d--) {
    if ($f.node(d).type.name === 'blockquote') {
      const bq = $f.node(d)
      const start = $f.start(d) + 1 // inside first paragraph
      const m = /^\[!(note|tip|important|warning|caution)\][ \t]*/i.exec(bq.firstChild.textContent)
      const tr = m ? v.state.tr.insertText(marker, start, start + m[0].trimEnd().length) : v.state.tr.insert($f.start(d), schema.nodes.paragraph.create(null, schema.text(marker)))
      v.dispatch(tr)
      return v.focus()
    }
  }
  const block = $f.depth >= 1 ? $f.node(1) : null
  const from = $f.depth >= 1 ? $f.before(1) : $f.pos
  const to = $f.depth >= 1 ? $f.after(1) : $f.pos
  const head = schema.nodes.paragraph.create(null, schema.text(marker))
  let quote
  let tr
  if (block && !block.isTextblock) {
    // lists, tables, code…: keep the block intact and put it inside the callout
    try {
      quote = schema.nodes.blockquote.createChecked(null, [head, block])
      tr = v.state.tr.replaceWith(from, to, quote)
    } catch {
      quote = schema.nodes.blockquote.create(null, [head, schema.nodes.paragraph.create()])
      tr = v.state.tr.insert(from, quote)
    }
    v.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1 + head.nodeSize + 1))).scrollIntoView())
    return v.focus()
  }
  // paragraphs/headings: their text becomes the callout body (inline marks are kept)
  const content = block && block.content.size ? schema.nodes.paragraph.create(null, block.content) : schema.nodes.paragraph.create()
  quote = schema.nodes.blockquote.create(null, [head, content])
  tr = block ? v.state.tr.replaceWith(from, to, quote) : v.state.tr.insert(from, quote)
  // caret at the end of the body paragraph
  const end = from + 1 + head.nodeSize + 1 + content.content.size
  v.dispatch(tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView())
  v.focus()
}

/** Insert a code block with content (replaces the current block if it is an empty paragraph). */
function insertCodeBlock(lang, code) {
  if (inSource()) return source.insert('\n```' + lang + '\n' + code + '\n```\n')
  const v = view()
  if (!v) return
  const { schema } = v.state
  const node = schema.nodes.code_block.create({ language: lang }, code ? schema.text(code) : null)
  const $f = v.state.selection.$from
  let tr = v.state.tr
  if ($f.parent.type.name === 'paragraph' && $f.parent.content.size === 0 && $f.depth >= 1) {
    tr = tr.replaceWith($f.before(), $f.after(), node)
  } else tr = tr.replaceSelectionWith(node)
  v.dispatch(tr.scrollIntoView())
  v.focus()
}

const MERMAID_TEMPLATES = [
  ['Flowchart', 'Processes and decisions', 'flowchart LR\n  A[Start] --> B{Is it working?}\n  B -- Yes --> C[Great]\n  B -- No --> D[Debug]\n  D --> B'],
  ['Sequence', 'Messages between participants', 'sequenceDiagram\n  participant U as User\n  participant A as App\n  participant S as Server\n  U->>A: Click save\n  A->>S: PUT /doc\n  S-->>A: 200 OK\n  A-->>U: Saved ✓'],
  ['Class', 'Classes and relationships', 'classDiagram\n  class Animal {\n    +String name\n    +move()\n  }\n  class Dog {\n    +bark()\n  }\n  Animal <|-- Dog'],
  ['State', 'States and transitions', 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review: submit\n  Review --> Draft: changes requested\n  Review --> Published: approve\n  Published --> [*]'],
  ['Entity relationship', 'Database tables', 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  PRODUCT ||--o{ LINE_ITEM : "ordered in"'],
  ['Gantt', 'Project schedule', 'gantt\n  title Project plan\n  dateFormat YYYY-MM-DD\n  section Design\n    Research      :a1, 2026-01-05, 7d\n    Mockups       :after a1, 5d\n  section Build\n    Implementation:2026-01-19, 14d\n    Testing       :7d'],
  ['Pie chart', 'Parts of a whole', 'pie title Time spent\n  "Writing" : 45\n  "Editing" : 30\n  "Research" : 25'],
  ['Mindmap', 'Ideas around a topic', 'mindmap\n  root((Folio))\n    Editing\n      WYSIWYG\n      Source mode\n    Export\n      PDF\n      HTML\n    Themes'],
  ['Timeline', 'Events in order', 'timeline\n  title Release history\n  2026-10 : 0.1.0 first release\n  2026-11 : 0.1.1 Vim fixes\n          : RPM package'],
  ['User journey', 'Steps and satisfaction', 'journey\n  title Writing a document\n  section Draft\n    Open Folio: 5: Me\n    Write outline: 3: Me\n  section Finish\n    Export PDF: 4: Me'],
  ['Git graph', 'Branches and merges', 'gitGraph\n  commit\n  branch feature\n  checkout feature\n  commit\n  commit\n  checkout main\n  merge feature\n  commit'],
  ['Quadrant', 'Two-axis comparison', 'quadrantChart\n  title Effort vs impact\n  x-axis Low effort --> High effort\n  y-axis Low impact --> High impact\n  quadrant-1 Plan\n  quadrant-2 Do now\n  quadrant-3 Skip\n  quadrant-4 Delegate\n  Feature A: [0.3, 0.8]\n  Feature B: [0.7, 0.6]\n  Feature C: [0.2, 0.2]'],
]

async function mermaidGallery() {
  const grid = el('div', { class: 'mm-grid' })
  let closeDialog
  const cards = [['Blank diagram', 'Start from scratch', 'flowchart TD\n  A --> B']].concat(MERMAID_TEMPLATES).map(([name, desc, code], i) => {
    const prev = el('div', { class: 'mm-prev' }, i === 0 ? el('span', { class: 'mm-blank' }, '+') : el('span', { class: 'mm-loading' }, '…'))
    const card = el('button', { class: 'mm-card', type: 'button' }, prev, el('b', {}, name), el('small', {}, desc))
    card.onclick = () => {
      closeDialog?.(true)
      insertCodeBlock('mermaid', i === 0 ? '' : code)
    }
    grid.append(card)
    return { prev, code, i }
  })
  const p = dialog({
    title: 'Insert Mermaid diagram',
    body: el('div', {}, el('p', { class: 'mm-intro' }, 'Pick a template to start from — you can edit it right after inserting.'), grid),
    wide: true,
    buttons: [{ label: 'Cancel', value: null, cancel: true }],
    onMount: (_b, done) => (closeDialog = done),
  })
  // render previews one by one (mermaid is loaded lazily)
  mermaidP ||= import('mermaid').then((m) => m.default)
  const mermaid = await mermaidP
  mermaid.initialize({ startOnLoad: false, theme: isDark() ? 'dark' : 'default', securityLevel: 'strict', flowchart: { htmlLabels: false } })
  for (const c of cards) {
    if (c.i === 0 || $('#modal').hidden) continue
    try {
      const { svg } = await mermaid.render('mmg' + ++mmId, c.code)
      c.prev.innerHTML = svg
    } catch {
      c.prev.textContent = ''
    }
  }
  return p
}
function blockquote() {
  if (inSource()) return source.linePrefix('> ', /^>\s?/)
  run(cmk.wrapInBlockquoteCommand)
}
function list(kind) {
  if (inSource()) return source.linePrefix(kind === 'ol' ? '1. ' : kind === 'task' ? '- [ ] ' : '- ', /^(\s*)([-*+]|\d+\.)\s(\[[ xX]\]\s)?/)
  if (kind === 'ol') return run(cmk.wrapInOrderedListCommand)
  const v = view()
  let $f = v.state.selection.$from
  const inList = () => {
    for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === 'list_item') return d
    return 0
  }
  if (!inList()) run(cmk.wrapInBulletListCommand)
  if (kind === 'task') {
    $f = v.state.selection.$from
    const d = inList()
    if (d) {
      const n = $f.node(d)
      v.dispatch(v.state.tr.setNodeMarkup($f.before(d), undefined, { ...n.attrs, checked: n.attrs.checked == null ? false : null }))
    }
  }
}
// ── tables
/** Ask for a table size with a hover grid (like word processors) plus exact inputs. */
function pickTableSize() {
  const MAXR = 10
  const MAXC = 10
  let rows = 3
  let cols = 3
  const grid = el('div', { class: 'tsize-grid' })
  const label = el('div', { class: 'tsize-label' })
  const rIn = el('input', { type: 'number', min: 1, max: 100, value: rows })
  const cIn = el('input', { type: 'number', min: 1, max: 30, value: cols })
  const paint = () => {
    for (const cell of grid.children) cell.classList.toggle('on', +cell.dataset.r < rows && +cell.dataset.c < cols)
    label.textContent = `${cols} × ${rows}  (columns × rows, incl. header)`
  }
  for (let r = 0; r < MAXR; r++)
    for (let c = 0; c < MAXC; c++) {
      const cell = el('div', { 'data-r': r, 'data-c': c })
      cell.onmouseenter = () => {
        rows = r + 1
        cols = c + 1
        rIn.value = rows
        cIn.value = cols
        paint()
      }
      grid.append(cell)
    }
  rIn.oninput = () => ((rows = Math.max(1, Math.min(100, +rIn.value || 1))), paint())
  cIn.oninput = () => ((cols = Math.max(1, Math.min(30, +cIn.value || 1))), paint())
  paint()
  const body = el(
    'div',
    { class: 'tsize' },
    grid,
    label,
    el('div', { class: 'tsize-inputs' }, el('label', {}, 'Columns ', cIn), el('label', {}, 'Rows ', rIn)),
  )
  return dialog({
    title: 'Insert table',
    body,
    buttons: [
      { label: 'Cancel', value: null, cancel: true },
      { label: 'Insert', value: 'ok', primary: true },
    ],
    onMount: (_box, done) => grid.addEventListener('click', () => done('ok')),
  }).then((r) => (r ? { rows, cols } : null))
}

async function table() {
  const size = await pickTableSize()
  if (!size) return focusEditor()
  const { rows, cols } = size
  if (inSource()) {
    const line = (cells) => '| ' + cells.join(' | ') + ' |'
    const head = line(Array.from({ length: cols }, (_, i) => `Column ${i + 1}`))
    const sep = line(Array(cols).fill('---'))
    const body = Array.from({ length: Math.max(0, rows - 1) }, () => line(Array(cols).fill(' ')))
    return source.insert('\n' + [head, sep, ...body].join('\n') + '\n')
  }
  focusEditor()
  run(gfm.insertTableCommand, { row: rows, col: cols })
}

/** Locate the table/row/cell around the cursor. */
function tableContext(state) {
  const $f = state.selection.$from
  for (let d = $f.depth; d > 1; d--) {
    const n = $f.node(d)
    if (n.type.name === 'table_cell' || n.type.name === 'table_header') {
      return { tablePos: $f.before(d - 2), table: $f.node(d - 2), row: $f.index(d - 2), col: $f.index(d - 1) }
    }
  }
  return null
}
function cellInside(doc, tablePos, r, c) {
  const t = doc.nodeAt(tablePos)
  if (!t || r >= t.childCount) return null
  let pos = tablePos + 1
  for (let i = 0; i < r; i++) pos += t.child(i).nodeSize
  const row = t.child(r)
  pos += 1
  for (let j = 0; j < Math.min(c, row.childCount - 1); j++) pos += row.child(j).nodeSize
  return pos + 1
}
function selectCell(v, tablePos, r, c) {
  const p = cellInside(v.state.doc, tablePos, r, c)
  if (p == null) return
  v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(p))).scrollIntoView())
  v.focus()
}

/** Enter in a table cell moves down a row; in the last row it adds a new row first. */
function tableEnter() {
  const v = view()
  const ctx = v && tableContext(v.state)
  if (!ctx) return false
  if (ctx.row === ctx.table.childCount - 1) run(gfm.addRowAfterCommand)
  selectCell(view(), ctx.tablePos, ctx.row + 1, ctx.col)
  return true
}

/** Hover "+" buttons below / beside a table to add a row or column at the end. */
function wireTablePlus() {
  const addRow = el('button', { class: 'table-plus row', title: 'Add row (or press Enter in the last row)' }, '+')
  const addCol = el('button', { class: 'table-plus col', title: 'Add column' }, '+')
  $('#scroller').append(addRow, addCol)
  let current = null
  const hide = () => {
    addRow.hidden = addCol.hidden = true
    current = null
  }
  hide()
  const place = (block) => {
    const tbl = block.querySelector('table') || block
    const r = tbl.getBoundingClientRect()
    const sr = scroller.getBoundingClientRect()
    const top = r.top - sr.top + scroller.scrollTop
    const left = r.left - sr.left
    Object.assign(addRow.style, { top: top + r.height + 4 + 'px', left: left + 'px', width: r.width + 'px' })
    Object.assign(addCol.style, { top: top + 'px', left: left + r.width + 4 + 'px', height: r.height + 'px' })
    addRow.hidden = addCol.hidden = S.readonly
    current = block
  }
  scroller.addEventListener('mousemove', (e) => {
    if (S.mode !== 'wysiwyg') return hide()
    if (e.target.closest('.table-plus')) return
    const block = e.target.closest('.milkdown-table-block')
    if (block) return place(block)
    if (!current) return
    // keep the buttons while the pointer travels from the table to them
    const r = (current.querySelector('table') || current).getBoundingClientRect()
    if (e.clientX > r.right + 36 || e.clientY > r.bottom + 36 || e.clientX < r.left - 8 || e.clientY < r.top - 8) hide()
  })
  scroller.addEventListener('scroll', () => current && place(current), { passive: true })
  const act = (kind) => {
    const v = view()
    const cell = current?.querySelector('td, th')
    if (!v || !cell) return
    const pos = v.posAtDOM(cell, 0)
    v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(pos))))
    const ctx = tableContext(v.state)
    if (!ctx) return
    const lastRow = ctx.table.childCount - 1
    const lastCol = ctx.table.child(0).childCount - 1
    if (kind === 'row') {
      selectCell(v, ctx.tablePos, lastRow, 0)
      run(gfm.addRowAfterCommand)
      selectCell(view(), ctx.tablePos, lastRow + 1, 0)
    } else {
      selectCell(v, ctx.tablePos, 0, lastCol)
      run(gfm.addColAfterCommand)
      selectCell(view(), ctx.tablePos, 0, lastCol + 1)
    }
    requestAnimationFrame(() => current && place(current))
  }
  for (const [b, kind] of [
    [addRow, 'row'],
    [addCol, 'col'],
  ]) {
    b.onmousedown = (e) => e.preventDefault()
    b.onclick = () => act(kind)
  }
}
function hr() {
  if (inSource()) return source.insert('\n---\n')
  run(cmk.insertHrCommand)
}
function link() {
  if (inSource()) {
    const t = source.selectedText()
    return source.insert(/^https?:\/\//.test(t) ? `[](${t})` : `[${t}]()`)
  }
  run(toggleLinkCommand)
}
function mathBlock() {
  if (inSource()) return source.insert('\n$$\n' + source.selectedText() + '\n$$\n')
  run(cmk.createCodeBlockCommand, 'latex')
}
function inlineMath() {
  if (inSource()) return source.wrap('$', '$')
  const v = view()
  const { from, to } = v.state.selection
  const t = v.state.doc.textBetween(from, to) || 'x'
  const type = v.state.schema.nodes.math_inline
  if (type) {
    v.dispatch(v.state.tr.replaceSelectionWith(type.create({ value: t })))
    v.focus()
  } else toast('Type $…$ to insert inline math')
}
function clearFormat() {
  if (inSource()) return
  const v = view()
  const { from, to } = v.state.selection
  v.dispatch(v.state.tr.removeMark(from, to))
}
function undo() {
  inSource() ? source.undo() : run(undoCommand)
}
function redo() {
  inSource() ? source.redo() : run(redoCommand)
}

function selectionMarkdown() {
  if (inSource()) return source.selectedText() || source.getText()
  let md = ''
  crepe.editor.action((ctx) => {
    const v = ctx.get(editorViewCtx)
    const { from, to, empty } = v.state.selection
    if (empty) return (md = crepe.getMarkdown())
    const slice = v.state.doc.slice(from, to)
    const schema = v.state.schema
    try {
      let content = slice.content
      if (content.firstChild?.isInline) content = schema.nodes.paragraph.create(null, content)
      md = ctx.get(serializerCtx)(schema.topNodeType.create(null, content))
    } catch {
      md = v.state.doc.textBetween(from, to, '\n')
    }
  })
  return md
}

async function copyMarkdown() {
  await navigator.clipboard.writeText(selectionMarkdown())
  toast('Copied as Markdown')
}

// ════════════════════════════════════════ export
/** Theme used for exports: a light print palette by default, or the editor's current theme. */
function exportThemeName() {
  return settings.exportTheme === 'current' ? html.dataset.theme : settings.exportTheme || 'paper'
}
const DARK_THEMES = ['ink', 'slate']

function themeVars(theme = exportThemeName()) {
  // Read the palette of `theme` by switching the root attribute for one synchronous style read
  const prev = html.dataset.theme
  if (theme !== prev) html.dataset.theme = theme
  const cs = getComputedStyle(html)
  const vars = [
    '--bg', '--fg', '--fg-strong', '--muted', '--chrome', '--border', '--link', '--code-bg', '--code-fg', '--quote', '--quote-bar',
    '--doc-font', '--doc-size', '--doc-width', '--doc-lh', '--font-mono',
  ]
    .map((v) => `${v}:${cs.getPropertyValue(v)}`)
    .join(';')
  if (theme !== prev) html.dataset.theme = prev
  return vars + `;color-scheme:${DARK_THEMES.includes(theme) ? 'dark' : 'light'}`
}

async function exportHtml() {
  const target = await saveDialog({
    defaultPath: S.path ? S.path.replace(/\.[^.\\/]+$/, '') + '.html' : 'document.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  })
  if (!target) return
  await exportHtmlTo(target)
  toast('Exported ' + P.basename(target))
}

async function exportHtmlTo(target) {
  const { toHtml } = await import('./export.js')
  const out = await toHtml(currentText(), {
    title: docTitle(),
    docDir: S.path && P.dirname(S.path),
    targetDir: P.dirname(target),
    themeVars: themeVars(),
    dark: DARK_THEMES.includes(exportThemeName()),
  })
  await invoke('write_text', { path: target, content: out })
}

const docTitle = () => firstHeading() || (S.path ? P.stem(S.path) : 'Document')

// ── PDF export (direct to file, with page numbers / header / footer / properties)
const PAPER = { a4: [210, 297, 'A4'], letter: [215.9, 279.4, 'Letter'], legal: [215.9, 355.6, 'Legal'], a5: [148, 210, 'A5'], a3: [297, 420, 'A3'] }
const PDF_DEFAULTS = {
  paper: 'a4',
  landscape: false,
  margin: 18,
  pageNumbers: 'n/N',
  header: '',
  footer: '',
  skipFirst: false,
  author: '',
  subject: '',
  keywords: '',
  openAfter: true,
}

/** Expand {title} {file} {date} {author} placeholders. */
function expandPlaceholders(s, meta) {
  const date = new Date().toLocaleDateString()
  return (s || '')
    .replace(/\{title\}/gi, meta.title || '')
    .replace(/\{file\}/gi, S.path ? P.basename(S.path) : 'Untitled')
    .replace(/\{date\}/gi, date)
    .replace(/\{author\}/gi, meta.author || '')
}

function pdfOptionsFor(p, overrides = {}) {
  p = { ...PDF_DEFAULTS, ...p, ...overrides }
  const [w, h] = PAPER[p.paper] || PAPER.a4
  const meta = { title: p.title ?? docTitle(), author: p.author }
  return {
    pageWidthMm: w,
    pageHeightMm: h,
    landscape: !!p.landscape,
    marginMm: +p.margin || 18,
    pageNumbers: p.pageNumbers || '',
    header: expandPlaceholders(p.header, meta),
    footer: expandPlaceholders(p.footer, meta),
    skipFirstPage: !!p.skipFirst,
    title: meta.title || '',
    author: p.author || '',
    subject: p.subject || '',
    keywords: p.keywords || '',
  }
}

async function exportPdfTo(out, options) {
  const { toHtml } = await import('./export.js')
  const htmlDoc = await toHtml(currentText(), {
    title: options.title || docTitle(),
    docDir: S.path && P.dirname(S.path),
    resolveForView: convertFileSrc,
    themeVars: themeVars(),
    dark: DARK_THEMES.includes(exportThemeName()),
    inlineKatex: true,
    forPdf: true,
  })
  const tmp = out.replace(/\.pdf$/i, '') + '.folio-tmp.html'
  await invoke('write_text', { path: tmp, content: htmlDoc })
  try {
    await invoke('export_pdf', { url: convertFileSrc(tmp), out, options })
  } finally {
    invoke('remove_temp', { path: tmp }).catch(() => {})
  }
}

/** @param settingsOnly  just edit the saved PDF settings (used by the page preview) */
async function exportPdfDialog(settingsOnly = false) {
  const p = { ...PDF_DEFAULTS, ...(settings.pdf || {}) }
  const meta = { title: docTitle(), subject: '', keywords: p.keywords }
  const row = (label, hint, control) => el('div', { class: 'pref-row' }, el('label', {}, label, hint ? el('small', {}, hint) : null), control)
  const text = (val, ph, w = '220px') => el('input', { type: 'text', value: val, placeholder: ph, spellcheck: 'false', style: `width:${w}` })
  const toggleEl = (on) => el('input', { type: 'checkbox', checked: on })

  const paper = customSelect(Object.entries(PAPER).map(([k2, v]) => [k2, v[2]]), p.paper, (v) => (p.paper = v))
  const orient = customSelect([['p', 'Portrait'], ['l', 'Landscape']], p.landscape ? 'l' : 'p', (v) => (p.landscape = v === 'l'))
  const margin = customSelect([[10, 'Narrow (10 mm)'], [18, 'Normal (18 mm)'], [25, 'Wide (25 mm)']], p.margin, (v) => (p.margin = +v))
  const nums = customSelect(
    [['', 'None'], ['n', '1'], ['n/N', '1 / 5'], ['page n of N', 'Page 1 of 5']],
    p.pageNumbers,
    (v) => (p.pageNumbers = v),
  )
  const theme = customSelect([['paper', 'Paper (light)'], ['sepia', 'Sepia'], ['current', 'Same as editor']], settings.exportTheme, (v) => {
    settings.exportTheme = v
    saveSettings()
  })
  const header = text(p.header, 'e.g. {title}')
  const footer = text(p.footer, 'e.g. {author} · {date}')
  const skipFirst = toggleEl(p.skipFirst)
  const title = text(meta.title, 'Document title')
  const author = text(p.author, 'Your name')
  const subject = text('', 'Optional')
  const keywords = text(p.keywords, 'comma, separated')
  const openAfter = toggleEl(p.openAfter)

  const section = (t) => el('div', { class: 'pdf-section' }, t)
  const body = el(
    'div',
    {},
    section('Page'),
    row('Paper size', null, paper),
    row('Orientation', null, orient),
    row('Margins', null, margin),
    row('Theme', null, theme),
    section('Header & footer'),
    row('Page numbers', 'Bottom right, or centered when there is no footer text', nums),
    row('Header', 'Centered at the top of each page', header),
    row('Footer', 'Bottom left', footer),
    row('Skip on first page', null, skipFirst),
    el('div', { class: 'pdf-hint' }, 'Placeholders: {title} {file} {date} {author}'),
    section('Document properties'),
    row('Title', null, title),
    row('Author', null, author),
    row('Subject', null, subject),
    row('Keywords', null, keywords),
    section(''),
    row('Open PDF after export', null, openAfter),
  )
  const go = await dialog({
    title: settingsOnly ? 'PDF page settings' : 'Export as PDF',
    body,
    wide: true,
    buttons: [
      { label: 'Cancel', value: false, cancel: true },
      { label: settingsOnly ? 'Apply' : 'Export PDF…', value: true, primary: true },
    ],
  })
  if (!go) return
  Object.assign(p, {
    header: header.value,
    footer: footer.value,
    skipFirst: skipFirst.checked,
    author: author.value,
    keywords: keywords.value,
    openAfter: openAfter.checked,
  })
  settings.pdf = { ...p } // remembered for next time (title/subject are per document)
  saveSettings()
  if (pagePreviewOpen()) schedulePreview(0)
  if (settingsOnly) return
  const out = await saveDialog({
    defaultPath: S.path ? S.path.replace(/\.[^.\\/]+$/, '') + '.pdf' : (title.value || 'document').replace(/[\\/:*?"<>|]+/g, '') + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!out) return
  toast('Exporting PDF…', 20000)
  try {
    await exportPdfTo(out, pdfOptionsFor(p, { title: title.value, subject: subject.value }))
    toast('Exported ' + P.basename(out))
    if (p.openAfter) osOpenPath(out).catch(() => {})
  } catch (e) {
    log('pdf export failed:', e)
    await dialog({ title: 'PDF export failed', body: String(e) })
  }
}

// ── page preview: the real PDF (same pipeline as Export as PDF), rendered with pdf.js
const PV = { open: false, doc: null, busy: false, pending: false, zoom: 0, file: null, token: 0, fitScale: 1 }
const pagePreviewOpen = () => PV.open
const pvStatus = (t) => ($('#pv-status').textContent = t)

function togglePagePreview() {
  PV.open ? closePagePreview() : openPagePreview()
}
function openPagePreview() {
  PV.open = true
  $('#pagepreview').hidden = false
  $('#pv-resizer').hidden = false
  html.style.setProperty('--pv-width', (settings.pvWidth || 520) + 'px')
  pvStatus('Rendering…')
  schedulePreview(0)
}
function closePagePreview() {
  PV.open = false
  PV.token++
  $('#pagepreview').hidden = true
  $('#pv-resizer').hidden = true
  $('#pv-pages').innerHTML = ''
  PV.doc?.destroy()
  PV.doc = null
  if (PV.file) invoke('remove_temp', { path: PV.file }).catch(() => {})
  PV.file = null
}
let pvTimer
function schedulePreview(ms = 1500) {
  clearTimeout(pvTimer)
  pvTimer = setTimeout(refreshPreview, ms)
}
async function refreshPreview() {
  if (!PV.open) return
  if (PV.busy) {
    PV.pending = true
    return
  }
  PV.busy = true
  pvStatus('Updating…')
  try {
    PV.file ||= P.join(await invoke('temp_dir'), `folio-preview-${Math.random().toString(36).slice(2, 10)}.pdf`)
    await exportPdfTo(PV.file, pdfOptionsFor(settings.pdf))
    if (!PV.open) return
    const bytes = await invoke('read_bytes', { path: PV.file })
    const pdfjs = await loadPdfjs()
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
    if (!PV.open) return doc.destroy()
    const old = PV.doc
    PV.doc = doc
    await layoutPages()
    old?.destroy()
    pvStatus(`${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`)
  } catch (e) {
    log('page preview failed:', e)
    pvStatus('Preview failed — ' + String(e).slice(0, 80))
  } finally {
    PV.busy = false
    if (PV.pending) {
      PV.pending = false
      schedulePreview(200)
    }
  }
}
let pdfjsP
function loadPdfjs() {
  pdfjsP ||= (async () => {
    // legacy build: polyfills new JS APIs (Map.getOrInsertComputed, Math.sumPrecise…) that
    // WebKitGTK on many Linux distros doesn't have yet
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs')
    const { default: workerSrc } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
    return pdfjs
  })()
  return pdfjsP
}
/** (Re)build the page list. Old canvases stay as stand-ins until the new page is drawn (no flicker). */
async function layoutPages() {
  const doc = PV.doc
  if (!doc) return
  const box = $('#pv-pages')
  const ratio = box.scrollTop / Math.max(1, box.scrollHeight - box.clientHeight)
  const token = ++PV.token
  const oldCanvases = [...box.querySelectorAll('.pv-page canvas')]
  const first = await doc.getPage(1)
  PV.fitScale = Math.max(0.15, (box.clientWidth - 40) / first.getViewport({ scale: 1 }).width)
  const scale = PV.zoom || PV.fitScale
  $('#pv-zoom').textContent = PV.zoom ? Math.round(PV.zoom * 100) + '%' : 'Fit'
  const frag = document.createDocumentFragment()
  const wraps = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = i === 1 ? first : await doc.getPage(i)
    if (token !== PV.token) return
    const vp = page.getViewport({ scale })
    const wrap = el('div', { class: 'pv-page', style: `width:${vp.width}px;height:${vp.height}px` }, el('span', { class: 'pv-num' }, String(i)))
    if (oldCanvases[i - 1]) wrap.prepend(oldCanvases[i - 1])
    wrap._page = page
    wrap._scale = scale
    wraps.push(wrap)
    frag.append(wrap)
  }
  box.innerHTML = ''
  box.append(frag)
  box.scrollTop = ratio * Math.max(0, box.scrollHeight - box.clientHeight)
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries)
        if (en.isIntersecting) {
          io.unobserve(en.target)
          drawPage(en.target, token)
        }
    },
    { root: box, rootMargin: '600px 0px' },
  )
  wraps.forEach((w) => io.observe(w))
}
async function drawPage(wrap, token) {
  if (token !== PV.token) return
  const dpr = devicePixelRatio || 1
  const vp = wrap._page.getViewport({ scale: wrap._scale * dpr })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(vp.width)
  canvas.height = Math.floor(vp.height)
  try {
    await wrap._page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise
  } catch (e) {
    return log('pdf page render failed:', e)
  }
  if (token !== PV.token) return
  wrap.querySelector('canvas')?.remove()
  wrap.prepend(canvas)
  if (PV.debug) {
    PV.debug = false
    log('preview: rendered', PV.doc?.numPages, 'pages; first canvas', canvas.width + 'x' + canvas.height)
  }
}
function wirePagePreview() {
  $('#pv-close').onclick = closePagePreview
  $('#pv-refresh').onclick = () => schedulePreview(0)
  $('#pv-settings').onclick = () => exportPdfDialog(true)
  $('#pv-export').onclick = () => exportPdfDialog()
  const zoomBy = (f) => {
    PV.zoom = Math.max(0.25, Math.min(3, (PV.zoom || PV.fitScale) * f))
    layoutPages()
  }
  $('#pv-zoom-in').onclick = () => zoomBy(1.2)
  $('#pv-zoom-out').onclick = () => zoomBy(1 / 1.2)
  $('#pv-zoom').onclick = () => {
    PV.zoom = 0
    layoutPages()
  }
  $('#pv-zoom').title = 'Click to fit width'
  new ResizeObserver(debounce(() => PV.open && !PV.zoom && PV.doc && layoutPages(), 150)).observe($('#pv-pages'))
  const rz = $('#pv-resizer')
  rz.onmousedown = (e) => {
    e.preventDefault()
    rz.classList.add('drag')
    const move = (ev) => {
      settings.pvWidth = Math.max(280, Math.min(innerWidth - 360, innerWidth - ev.clientX))
      html.style.setProperty('--pv-width', settings.pvWidth + 'px')
    }
    const up = () => {
      rz.classList.remove('drag')
      removeEventListener('mousemove', move)
      removeEventListener('mouseup', up)
      saveSettings()
    }
    addEventListener('mousemove', move)
    addEventListener('mouseup', up)
  }
  addEventListener('beforeunload', () => PV.file && invoke('remove_temp', { path: PV.file }))
}

// ── about
const fmtPct = (p) => (p >= 100 ? '100' : (Math.floor(p * 10) / 10).toFixed(1)) + '%'
function showAbout() {
  const s = aiStats
  const body = el(
    'div',
    { class: 'about' },
    el('p', {}, 'A fast, seamless Markdown reader & editor.'),
    el('p', { class: 'about-sub' }, 'Built with Tauri, ProseMirror (Milkdown), CodeMirror, KaTeX, Mermaid and pdf.js.'),
  )
  if (s && !s.unavailable && s.total && s.byAuthor) {
    const pct = (s.ai / s.total) * 100
    const bar = (p, kind) => el('div', { class: 'ai-bar' }, el('span', { class: kind, style: `width:${Math.min(100, p)}%` }))
    const rows = [...s.byAuthor]
    if (s.uncommitted) rows.push({ name: 'Not committed yet', kind: 'pending', lines: s.uncommitted })
    const tbl = el('div', { class: 'ai-table' }, el('b', {}, 'Written by'), el('b', {}, 'Lines'), el('b', {}, 'Share'), el('b', {}, ''))
    for (const a of rows) {
      const ap = (a.lines / s.total) * 100
      tbl.append(
        el('span', { class: 'ai-who' }, el('i', { class: 'ai-dot ' + a.kind }), a.name, a.kind === 'human' ? el('small', {}, ' (person)') : null),
        el('span', {}, a.lines.toLocaleString()),
        el('span', {}, fmtPct(ap)),
        bar(ap, a.kind),
      )
    }
    body.append(
      el('h4', {}, 'Who wrote Folio'),
      el('div', { class: 'ai-hero' }, el('b', {}, s.total.toLocaleString()), el('span', {}, `lines of code and docs, ${fmtPct(pct)} of them written by AI models`)),
      tbl,
      el(
        'p',
        { class: 'about-note' },
        `Counted with git blame when this build was made (commit ${s.commit}, ${s.files} files). Each line is credited to the commit that last changed it: to the AI model named in that commit's "Co-Authored-By" line, otherwise to the person who made the commit. Blank lines, lock files and images are not counted.`,
      ),
    )
  } else body.append(el('p', { class: 'about-note' }, 'AI statistics are not available in this build.'))
  dialog({ title: `Folio ${APP_VERSION}`, body, wide: true, buttons: [{ label: 'Close', value: true, primary: true, cancel: true }] })
}

async function printDoc() {
  toast('Preparing…')
  const { toHtml, printHtml } = await import('./export.js')
  const out = await toHtml(currentText(), {
    title: S.path ? P.stem(S.path) : firstHeading() || 'Document',
    docDir: S.path && P.dirname(S.path),
    resolveForView: convertFileSrc,
    themeVars: themeVars(),
    dark: DARK_THEMES.includes(exportThemeName()),
    inlineKatex: true,
  })
  await printHtml(out)
}

async function copyHtml() {
  const { toHtml } = await import('./export.js')
  const full = await toHtml(selectionMarkdown(), { themeVars: themeVars(), resolveForView: convertFileSrc, docDir: S.path && P.dirname(S.path) })
  const body = /<body>([\s\S]*)<\/body>/.exec(full)[1]
  await navigator.clipboard.write([
    new ClipboardItem({ 'text/html': new Blob([body], { type: 'text/html' }), 'text/plain': new Blob([body], { type: 'text/plain' }) }),
  ])
  toast('Copied as HTML')
}

// ════════════════════════════════════════ view settings
function applySettings() {
  let t = settings.theme
  if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'paper'
  html.dataset.theme = t
  const st = html.style
  st.setProperty('--doc-size', settings.fontSize + 'px')
  st.setProperty('--doc-lh', settings.lineHeight)
  st.setProperty('--doc-width', settings.width + 'px')
  st.setProperty('--sb-width', settings.sidebarWidth + 'px')
  if (settings.font === 'auto') st.removeProperty('--doc-font')
  else st.setProperty('--doc-font', { sans: 'var(--font-sans)', serif: 'var(--font-serif)', mono: 'var(--font-mono)' }[settings.font] || settings.font)
  document.body.classList.toggle('wide', settings.wide)
  document.body.classList.toggle('focus-mode', settings.focus)
  document.body.classList.toggle('no-sidebar', !settings.sidebar)
  $('#wysiwyg').spellcheck = false // Folio checks spelling itself (writing.js)
  if (source) {
    source.setVim(settings.vim)
  }
  document.body.classList.toggle('vim-on', settings.vim)
  let css = $('#custom-css')
  if (!css) document.head.append((css = el('style', { id: 'custom-css' })))
  css.textContent = settings.customCSS || ''
  updateFlags()
  saveSettings()
}

function updateFlags() {
  const f = $('#st-flags')
  f.innerHTML = ''
  if (settings.vim && S.mode === 'source' && S.vimMode)
    f.append(el('span', { class: 'vim-flag', title: 'Vim keybindings — :w save, :q close, :wq both, :pre back to WYSIWYG' }, `VIM · ${S.vimMode.toUpperCase()}`))
  else if (settings.vim) f.append(el('span', { title: 'Vim keybindings are active in source mode (Ctrl+/)', style: 'opacity:.6' }, 'VIM'))
  if (S.readonly) f.append(el('span', { title: 'Read-only (Ctrl+Shift+R)' }, 'Read-only'))
  if (settings.focus) f.append(el('span', { title: 'Focus mode (F8)' }, 'Focus'))
  if (settings.typewriter) f.append(el('span', { title: 'Typewriter mode (F9)' }, 'Typewriter'))
  if (settings.autoSave) f.append(el('span', { title: 'Auto-save is on' }, 'Auto-save'))
}

function setTheme(t) {
  settings.theme = t
  applySettings()
  mermaidP = null
  // Re-render to refresh diagram colors
  if (S.mode === 'wysiwyg' && crepe && currentText().includes('```mermaid')) {
    const md = crepe.getMarkdown()
    const clean = !S.dirty
    const top = scroller.scrollTop
    createEditor(md).then(() => {
      S.baseline = clean ? crepe.getMarkdown() : null
      scroller.scrollTop = top
    })
  }
}

const WRITING_KEYS = ['spellcheck', 'wcGrammar', 'wcStyle', 'autocorrect']
const toggle = (k) => () => {
  settings[k] = !settings[k]
  applySettings()
  if (WRITING_KEYS.includes(k)) {
    writingSettingsChanged()
    toast({ spellcheck: 'Spelling & grammar check', wcGrammar: 'Grammar check', wcStyle: 'Style suggestions', autocorrect: 'AutoCorrect' }[k] + (settings[k] ? ' on' : ' off'))
  }
  const v = view()
  if (k === 'focus' && v) v.dispatch(v.state.tr.setMeta(folioKey, {}))
  if (k === 'typewriter' || k === 'focus') toast(`${k === 'focus' ? 'Focus' : 'Typewriter'} mode ${settings[k] ? 'on' : 'off'}`)
}

async function toggleVim() {
  settings.vim = !settings.vim
  applySettings()
  if (settings.vim && S.mode !== 'source') {
    const r = await dialog({
      title: 'Vim keybindings on',
      body: 'Vim keys work in source-code mode (Ctrl+/). Switch to source mode now?\n\nTip: :w saves, :q closes, :wq does both, :pre returns to the rendered view.',
      buttons: [
        { label: 'Not now', value: false, cancel: true },
        { label: 'Switch to source mode', value: true, primary: true },
      ],
    })
    if (r) await enterSource()
  } else toast(settings.vim ? 'Vim keybindings on' : 'Vim keybindings off')
  if (inSource()) source.focus()
}

function zoom(d) {
  settings.fontSize = d === 0 ? 16 : Math.max(10, Math.min(32, settings.fontSize + d))
  applySettings()
  toast(`Font size ${settings.fontSize}px`, 900)
}

function setSidebar(show = !settings.sidebar) {
  settings.sidebar = show
  applySettings()
}
function setTab(tab) {
  settings.sidebarTab = tab
  for (const b of document.querySelectorAll('.sb-tabs button')) b.classList.toggle('active', b.dataset.tab === tab)
  for (const p of document.querySelectorAll('.sb-pane')) p.classList.toggle('active', p.id === 'sb-' + tab)
  saveSettings()
  if (tab === 'search') setTimeout(() => $('#search-input').focus(), 0)
}
const showTab = (tab) => () => {
  if (settings.sidebar && settings.sidebarTab === tab && tab !== 'search') return setSidebar(false)
  setSidebar(true)
  setTab(tab)
}

function applyReadonly() {
  crepe?.setReadonly(S.readonly)
  if (source) source.view.contentDOM.contentEditable = S.readonly ? 'false' : 'true'
  document.body.classList.toggle('readonly', S.readonly)
  updateFlags()
}
function toggleReadonly() {
  S.readonly = !S.readonly
  applyReadonly()
  toast(S.readonly ? 'Read-only' : 'Editing enabled')
}

async function toggleFullscreen() {
  await win.setFullscreen(!(await win.isFullscreen()))
}
let onTop = false
async function toggleOnTop() {
  onTop = !onTop
  await win.setAlwaysOnTop(onTop)
  toast(onTop ? 'Always on top' : 'Always on top off')
}
function toggleZen() {
  document.body.classList.toggle('app-zen')
}

// ── custom title bar: menus share one row with the window buttons (default on every OS).
//    The decorations themselves are chosen by Rust when the window is created.
const OS = IS_LINUX ? 'linux' : /Windows/i.test(navigator.userAgent) ? 'windows' : 'mac'
// Fluent glyphs on Windows (Segoe Fluent Icons / MDL2), SVG elsewhere
const WIN_GLYPHS = { min: '', max: '', restore: '', close: '' }
function applyTitlebar() {
  document.body.classList.add('os-' + OS)
  const custom = !settings.nativeTitlebar
  document.body.classList.toggle('custom-titlebar', custom)
  if (OS === 'windows') {
    $('#wc-min').innerHTML = `<span class="glyph">${WIN_GLYPHS.min}</span>`
    $('#wc-close').innerHTML = `<span class="glyph">${WIN_GLYPHS.close}</span>`
  }
  if (custom) syncMaximized()
}
async function syncMaximized() {
  const max = await win.isMaximized().catch(() => false)
  document.body.classList.toggle('maximized', max)
  $('#wc-max').title = max ? 'Restore' : 'Maximize'
  if (OS === 'windows') $('#wc-max').innerHTML = `<span class="glyph">${max ? WIN_GLYPHS.restore : WIN_GLYPHS.max}</span>`
  else
    $('#wc-max').innerHTML = max
      ? '<svg viewBox="0 0 10 10"><rect x="1.5" y="3" width="5.5" height="5.5" rx="1"/><path d="M3.5 3V2.2a.7.7 0 0 1 .7-.7h3.6a.7.7 0 0 1 .7.7v3.6a.7.7 0 0 1-.7.7H7"/></svg>'
      : '<svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" rx="1"/></svg>'
}
function wireTitlebar() {
  $('#wc-min').onclick = () => win.minimize()
  $('#wc-max').onclick = () => win.toggleMaximize()
  $('#wc-close').onclick = () => win.close()
  for (const b of document.querySelectorAll('#win-controls button')) b.onmousedown = (e) => e.preventDefault()
  for (const edge of document.querySelectorAll('#resize-edges div'))
    edge.onmousedown = (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      win.startResizeDragging(edge.dataset.dir).catch((err) => log('resize failed:', err))
    }
  win.onResized(debounce(() => !settings.nativeTitlebar && syncMaximized(), 100))
}
async function toggleNativeTitlebar() {
  const native = !settings.nativeTitlebar
  await invoke('set_native_titlebar', { native })
  settings.nativeTitlebar = native
  saveSettings()
  if (OS === 'windows') {
    // Win32 can switch decorations on a live window
    await win.setDecorations(native).catch((e) => log('setDecorations failed:', e))
    applyTitlebar()
    return
  }
  // GTK can't reliably add decorations back to a mapped window (this used to leave the
  // window with no buttons at all), so the new title bar applies on restart.
  const r = await dialog({
    title: 'Restart to apply',
    body: `Folio will use the ${native ? 'system' : 'Folio'} title bar after a restart.`,
    buttons: [
      { label: 'Later', value: false, cancel: true },
      { label: 'Restart now', value: true, primary: true },
    ],
  })
  if (r && (await confirmDiscard())) {
    S.dirty = false
    await invoke('restart', { path: S.path })
  }
}

function updateTitle() {
  const name = S.path ? P.basename(S.path) : 'Untitled'
  $('#tb-title').textContent = `${name}${S.dirty ? ' •' : ''} — Folio`
  win.setTitle(`${name}${S.dirty ? ' •' : ''} — Folio`).catch(() => {})
  const sp = $('#st-path')
  sp.textContent = (S.dirty ? '● ' : '') + (S.path || 'Untitled — not saved yet')
  sp.title = S.path ? 'Click to reveal in Explorer' : ''
}

function focusEditor() {
  if (inSource()) source.focus()
  else view()?.focus()
}

// ════════════════════════════════════════ preferences
function openPrefs(section) {
  const row = (label, hint, control) => el('div', { class: 'pref-row' }, el('label', {}, label, hint ? el('small', {}, hint) : null), control)
  const sel = (key, opts, onChange) =>
    customSelect(opts, settings[key], (v) => {
      settings[key] = v
      onChange ? onChange(v) : applySettings()
    })
  const chk = (key) => {
    const c = el('input', { type: 'checkbox', checked: settings[key] })
    c.onchange = () => {
      settings[key] = c.checked
      applySettings()
      if (WRITING_KEYS.includes(key) || key.startsWith('wc')) writingSettingsChanged()
    }
    return c
  }
  const num = (key, min, max, step, unit) => {
    const wrap = el('span', {})
    const out = el('span', { style: 'min-width:48px;display:inline-block;text-align:right;color:var(--muted)' })
    const r = el('input', { type: 'range', min, max, step, value: settings[key] })
    const show = () => (out.textContent = settings[key] + unit)
    r.oninput = () => {
      settings[key] = +r.value
      show()
      applySettings()
    }
    show()
    wrap.append(r, out)
    return wrap
  }
  const txt = (key) => {
    const i = el('input', { type: 'text', value: settings[key], spellcheck: 'false', style: 'width:120px' })
    i.onchange = () => {
      settings[key] = i.value.trim() || DEFAULTS[key]
      applySettings()
    }
    return i
  }
  const css = el('textarea', { class: 'pref-css', spellcheck: 'false', placeholder: '/* Custom CSS, e.g. */\n#wysiwyg .ProseMirror h1 { color: tomato; }' })
  css.value = settings.customCSS
  css.oninput = debounce(() => {
    settings.customCSS = css.value
    applySettings()
  }, 300)

  const body = el(
    'div',
    {},
    row('Theme', null, sel('theme', [['paper', 'Paper'], ['sepia', 'Sepia'], ['ink', 'Ink (dark)'], ['slate', 'Slate (dark)'], ['system', 'Follow system']], setTheme)),
    row('Document font', null, sel('font', [['auto', 'Theme default'], ['sans', 'Sans-serif'], ['serif', 'Serif'], ['mono', 'Monospace']])),
    row('Font size', 'Ctrl+Shift+= / Ctrl+Shift+-', num('fontSize', 11, 28, 1, 'px')),
    row('Line height', null, num('lineHeight', 1.3, 2.2, 0.05, '')),
    row('Content width', null, num('width', 560, 1400, 20, 'px')),
    row('Full-width content', 'Ignore the width above', chk('wide')),
    row('Vim keybindings', 'Normal/insert/visual modes and :w :q :wq in source-code mode (Ctrl+/)', chk('vim')),
    row('Open files in source mode', 'Show raw Markdown instead of the rendered view when opening', chk('startInSource')),
    row('Auto-save', 'Save automatically a moment after you stop typing', chk('autoSave')),
    row('Reopen last file on startup', null, chk('reopenLast')),
    row('Open files read-only', 'Reader mode — toggle with Ctrl+Shift+R', chk('readonlyDefault')),
    row('Image folder', 'Pasted / dropped images go to this folder next to the document', txt('imageDir')),
    row('Copy dropped images into image folder', null, chk('copyImages')),
    row('Export / PDF theme', 'Colors used for Print / Export PDF and HTML export', sel('exportTheme', [['paper', 'Paper (light)'], ['sepia', 'Sepia'], ['current', 'Same as editor']], () => saveSettings())),
    row('Use system title bar', 'Off = Folio draws its own title bar matching the theme', (() => {
      const c = el('input', { type: 'checkbox', checked: settings.nativeTitlebar })
      c.onchange = () => c.checked !== settings.nativeTitlebar && toggleNativeTitlebar()
      return c
    })()),
    writingPrefs(row, chk, sel),
    el('div', { class: 'pref-h' }, 'Custom CSS'),
    css,
  )
  dialog({
    title: 'Preferences',
    body,
    wide: true,
    buttons: [{ label: 'Done', value: true, primary: true, cancel: true }],
    onMount: () => section && body.querySelector(`[data-section="${section}"]`)?.scrollIntoView({ block: 'start' }),
  })
}

function writingPrefs(row, chk, sel) {
  const changed = () => {
    saveSettings()
    writingSettingsChanged()
    showLt()
  }
  const server = el('input', { type: 'text', value: settings.ltServer, spellcheck: 'false', style: 'width:220px' })
  server.onchange = () => {
    settings.ltServer = server.value.trim() || DEFAULTS.ltServer
    changed()
  }
  const LT_LANGS = [
    ['auto', 'Detect automatically'],
    ['en-US', 'English (US)'],
    ['en-GB', 'English (UK)'],
    ['de-DE', 'German (Germany)'],
    ['de-AT', 'German (Austria)'],
    ['de-CH', 'German (Switzerland)'],
    ['fr', 'French'],
    ['es', 'Spanish'],
    ['it', 'Italian'],
    ['pt-PT', 'Portuguese (Portugal)'],
    ['pt-BR', 'Portuguese (Brazil)'],
    ['nl', 'Dutch'],
    ['pl-PL', 'Polish'],
    ['sv', 'Swedish'],
    ['da-DK', 'Danish'],
    ['uk-UA', 'Ukrainian'],
    ['ru-RU', 'Russian'],
    ['ca-ES', 'Catalan'],
  ]
  const ltRows = [
    row('Language', 'For LanguageTool', sel('ltLanguage', LT_LANGS, changed)),
    row('LanguageTool server', 'Your text is sent here. The free public server allows about 20 checks a minute; a self-hosted server has no limit', server),
  ]
  const harperRows = [row('English variant', null, sel('wcDialect', [['american', 'American'], ['british', 'British'], ['canadian', 'Canadian'], ['australian', 'Australian'], ['indian', 'Indian']], changed))]
  const showLt = () => {
    const lt = settings.wcEngine === 'languagetool'
    for (const r of ltRows) r.hidden = !lt
    for (const r of harperRows) r.hidden = lt
  }
  showLt()
  const rules = el('span', {})
  const drawRules = () => {
    rules.innerHTML = ''
    const n = (settings.wcDisabledRules || []).length
    rules.append(el('span', { style: 'color:var(--muted);margin-right:8px' }, n ? `${n} turned off` : 'All on'))
    if (n) {
      const b = el('button', { class: 'fsel' }, 'Turn all back on')
      b.onclick = () => {
        settings.wcDisabledRules = []
        changed()
        drawRules()
      }
      rules.append(b)
    }
  }
  drawRules()
  return el(
    'div',
    { 'data-section': 'writing' },
    el('div', { class: 'pref-h' }, 'Writing'),
    row('Check spelling & grammar as you type', 'F7 reviews all issues, Alt+F7 jumps to the next one', chk('spellcheck')),
    row('Check grammar', 'Agreement, wrong words (their/there, could of), punctuation, repeated words', chk('wcGrammar')),
    row('Style suggestions', 'Wordiness, redundancy and readability hints', chk('wcStyle')),
    row(
      'Checker',
      'Harper runs on your computer and never sends text anywhere. LanguageTool supports German, French, Spanish and more',
      sel('wcEngine', [['harper', 'Harper (offline, English)'], ['languagetool', 'LanguageTool (online, 30+ languages)']], changed),
    ),
    ...harperRows,
    ...ltRows,
    row('Ignore words in UPPERCASE', null, chk('wcIgnoreUpper')),
    row('Ignore words with numbers', null, chk('wcIgnoreDigits')),
    row('Rules', 'Rules turned off from the right-click menu', rules),
    row('AutoCorrect while typing', 'Fixes common typos (teh → the, dont → don’t, i → I) in English. Backspace right after undoes it', chk('autocorrect')),
    row('Capitalize first letter of sentences', 'Part of AutoCorrect', chk('autoCapitalize')),
    el('div', { class: 'pref-sub' }, 'Custom dictionary', el('small', {}, 'Words that are never marked as misspelled, one per line')),
    dictionaryEditor(),
  )
}

// ════════════════════════════════════════ menus & commands
const ACTIONS = []
const k = (label, keys, fn, opt = {}) => ({ label, keys, fn, ...opt })
const MENU = [
  {
    label: 'File',
    items: [
      k('New', 'Ctrl+N', newFile),
      k('New Window', 'Ctrl+Shift+N', () => invoke('new_window', { path: null })),
      k('New File in Folder…', null, () => createFileIn()),
      '-',
      k('Open…', 'Ctrl+O', openFileDialog),
      k('Open Folder…', 'Ctrl+Shift+O', openFolderDialog),
      k('Quick Open…', 'Ctrl+P', () => quickOpen()),
      { label: 'Open Recent', sub: () => recentMenu() },
      '-',
      k('Save', 'Ctrl+S', save),
      k('Save As…', 'Ctrl+Shift+S', saveAs),
      k('Reload from Disk', null, reloadFromDisk, { enabled: () => !!S.path }),
      k('Rename…', null, () => S.path && renameFile(S.path), { enabled: () => !!S.path }),
      '-',
      k('Export as HTML…', null, exportHtml),
      k('Export as PDF…', 'Ctrl+Alt+E', exportPdfDialog),
      k('Print…', 'Ctrl+Alt+P', printDoc),
      '-',
      k('Reveal in Explorer', null, () => S.path && revealItemInDir(S.path), { enabled: () => !!S.path }),
      k('Copy File Path', null, () => S.path && navigator.clipboard.writeText(S.path).then(() => toast('Path copied')), { enabled: () => !!S.path }),
      '-',
      k('Preferences…', 'Ctrl+,', openPrefs),
      k('Close Window', 'Ctrl+W', () => win.close()),
    ],
  },
  {
    label: 'Edit',
    items: [
      k('Undo', 'Ctrl+Z', undo, { native: true }),
      k('Redo', 'Ctrl+Y', redo, { native: true }),
      '-',
      k('Copy as Markdown', 'Ctrl+Shift+C', copyMarkdown),
      k('Copy as HTML', null, copyHtml),
      '-',
      k('Find…', 'Ctrl+F', () => openFind(false)),
      k('Replace…', 'Ctrl+H', () => openFind(true)),
      k('Find Next', 'F3', () => findStep(1)),
      k('Find Previous', 'Shift+F3', () => findStep(-1)),
      k('Find in Folder…', 'Ctrl+Shift+F', () => {
        setSidebar(true)
        setTab('search')
        const s = selectedPlainText()
        if (s) {
          $('#search-input').value = s
          runFolderSearch()
        }
      }),
      '-',
      k('Spelling & Grammar…', 'F7', toggleWritingPanel),
      k('Next Spelling or Grammar Issue', 'Alt+F7', nextIssueMenu),
      '-',
      k('Read-only Mode', 'Ctrl+Shift+R', toggleReadonly, { checked: () => S.readonly }),
    ],
  },
  {
    label: 'Paragraph',
    items: [
      ...[1, 2, 3, 4, 5, 6].map((n) => k(`Heading ${n}`, `Ctrl+${n}`, () => heading(n))),
      k('Paragraph', 'Ctrl+0', () => heading(0)),
      k('Promote Heading', 'Ctrl+=', () => headingStep(-1)),
      k('Demote Heading', 'Ctrl+-', () => headingStep(1)),
      '-',
      k('Table', 'Ctrl+T', table),
      k('Code Block', 'Ctrl+Shift+K', () => codeBlock()),
      k('Math Block', 'Ctrl+Shift+M', mathBlock),
      k('Mermaid Diagram…', 'Ctrl+Shift+D', mermaidGallery),
      k('Quote', 'Ctrl+Shift+Q', blockquote),
      {
        label: 'Callout',
        sub: () => Object.entries(CALLOUTS).map(([kind, label]) => k(label, null, () => callout(kind))),
      },
      '-',
      k('Ordered List', 'Ctrl+Shift+[', () => list('ol')),
      k('Bullet List', 'Ctrl+Shift+]', () => list('ul')),
      k('Task List', 'Ctrl+Shift+X', () => list('task')),
      '-',
      k('Horizontal Rule', 'Ctrl+Shift+H', hr),
      k('Page Break', 'Ctrl+Enter', pageBreak),
    ],
  },
  {
    label: 'Format',
    items: [
      k('Bold', 'Ctrl+B', mark(cmk.toggleStrongCommand, ['**'])),
      k('Italic', 'Ctrl+I', mark(cmk.toggleEmphasisCommand, ['*'])),
      k('Underline', 'Ctrl+U', mark(toggleUnderlineCommand, ['<u>', '</u>'])),
      k('Strikethrough', 'Alt+Shift+5', mark(gfm.toggleStrikethroughCommand, ['~~'])),
      k('Inline Code', 'Ctrl+Shift+`', mark(cmk.toggleInlineCodeCommand, ['`'])),
      k('Inline Math', 'Ctrl+Shift+E', inlineMath),
      '-',
      k('Link', 'Ctrl+K', link),
      k('Image…', 'Ctrl+Shift+I', insertImageDialog),
      '-',
      k('Clear Formatting', 'Ctrl+\\', clearFormat),
    ],
  },
  {
    label: 'View',
    items: [
      k('Source Code Mode', 'Ctrl+/', toggleSource, { checked: () => S.mode === 'source' }),
      '-',
      k('Sidebar', 'Ctrl+Shift+L', () => setSidebar(), { checked: () => settings.sidebar }),
      k('Outline', 'Ctrl+Shift+1', showTab('outline')),
      k('Files', 'Ctrl+Shift+2', showTab('files')),
      k('Search', 'Ctrl+Shift+3', showTab('search')),
      '-',
      k('Focus Mode', 'F8', toggle('focus'), { checked: () => settings.focus }),
      k('Typewriter Mode', 'F9', toggle('typewriter'), { checked: () => settings.typewriter }),
      k('Zen Mode (hide chrome)', 'Ctrl+Shift+J', toggleZen),
      '-',
      k('Zoom In', 'Ctrl+Shift+=', () => zoom(1)),
      k('Zoom Out', 'Ctrl+Shift+-', () => zoom(-1)),
      k('Actual Size', 'Ctrl+Shift+9', () => zoom(0)),
      k('Full-width Content', null, toggle('wide'), { checked: () => settings.wide }),
      '-',
      k('Always on Top', null, toggleOnTop, { checked: () => onTop }),
      k('Full Screen', 'F11', toggleFullscreen),
      k('Page Preview', 'Ctrl+Alt+L', togglePagePreview, { checked: () => pagePreviewOpen() }),
      k('Command Palette…', 'Ctrl+Shift+P', () => commandPalette()),
    ],
  },
  {
    label: 'Themes',
    items: [
      ['paper', 'Paper'],
      ['sepia', 'Sepia'],
      ['ink', 'Ink'],
      ['slate', 'Slate'],
      ['system', 'Follow System'],
    ].map(([id, l]) => k(l, null, () => setTheme(id), { checked: () => settings.theme === id })),
  },
  {
    label: 'Settings',
    items: [
      k('Vim Keybindings', 'Ctrl+Alt+V', toggleVim, { checked: () => settings.vim, hint: 'Vim keys in source-code mode' }),
      k('Open Files in Source Mode', null, toggle('startInSource'), { checked: () => settings.startInSource }),
      '-',
      k('Auto-save', null, toggle('autoSave'), { checked: () => settings.autoSave }),
      k('Check Spelling & Grammar', null, toggle('spellcheck'), { checked: () => settings.spellcheck }),
      k('AutoCorrect While Typing', null, toggle('autocorrect'), { checked: () => settings.autocorrect }),
      k('Open Files Read-only', null, toggle('readonlyDefault'), { checked: () => settings.readonlyDefault }),
      k('Reopen Last File on Startup', null, toggle('reopenLast'), { checked: () => settings.reopenLast }),
      k('Copy Dropped Images into Folder', null, toggle('copyImages'), { checked: () => settings.copyImages }),
      k('Use System Title Bar', null, toggleNativeTitlebar, { checked: () => settings.nativeTitlebar }),
      {
        label: 'Export / PDF Theme',
        sub: () =>
          [
            ['paper', 'Paper (light, recommended for print)'],
            ['sepia', 'Sepia'],
            ['current', 'Same as Editor'],
          ].map(([id, l]) =>
            k(l, null, () => {
              settings.exportTheme = id
              saveSettings()
              toast('Export theme: ' + l.replace(/ \(.*/, ''))
            }, { checked: () => settings.exportTheme === id }),
          ),
      },
      '-',
      k('Preferences…', 'Ctrl+,', openPrefs),
    ],
  },
  {
    label: 'Help',
    items: [
      k('Markdown Guide', null, openGuide),
      k('Command Palette…', 'F1', () => commandPalette()),
      k('Keyboard Shortcuts', 'Shift+F1', showShortcuts),
      '-',
      k('About Folio', null, showAbout),
    ],
  },
]

async function openGuide() {
  if (!(await confirmDiscard())) return
  S.path = null
  S.mtime = 0
  S.readonly = false
  await loadText(guideMd)
  S.baseline = S.mode === 'source' ? guideMd : crepe.getMarkdown()
  applyReadonly()
  renderTree()
}

function recentMenu() {
  if (!recent.length) return [{ label: 'No recent files', enabled: () => false }]
  return [
    ...recent.map((p) => k(P.basename(p), null, () => openFile(p), { hint: P.dirname(p) })),
    '-',
    k('Clear Recent', null, () => {
      recent = []
      localStorage.setItem('folio.recent', '[]')
    }),
  ]
}

// collect all actions for keyboard & palette
for (const m of MENU) for (const it of m.items) if (typeof it === 'object' && it.fn) ACTIONS.push({ ...it, group: m.label })

// ── menubar rendering
let openMenu = null
function buildMenubar() {
  const bar = $('#menus')
  for (const m of MENU) {
    const root = el('div', { class: 'menu-root' })
    const btn = el('button', {}, m.label)
    root.append(btn)
    btn.onmousedown = (e) => {
      e.preventDefault()
      openMenu === root ? closeMenus() : showMenu(root, m.items)
    }
    btn.onmouseenter = () => openMenu && openMenu !== root && showMenu(root, m.items)
    bar.append(root)
  }
  document.addEventListener('mousedown', (e) => {
    if (openMenu && !e.target.closest('.menu-root')) closeMenus()
    if (!e.target.closest('#ctxmenu')) $('#ctxmenu').hidden = true
  })
}

function buildPop(items) {
  const pop = el('div', { class: 'menu-pop' })
  for (const it of typeof items === 'function' ? items() : items) {
    if (it === '-') {
      pop.append(el('div', { class: 'menu-sep' }))
      continue
    }
    const enabled = it.enabled ? it.enabled() : true
    const b = el(
      'button',
      { class: 'menu-item' + (it.checked?.() ? ' checked' : '') + (enabled ? '' : ' disabled') + (it.sub ? ' has-sub' : ''), title: it.hint || '' },
      el('span', { class: 'lbl' }, it.label),
      it.keys ? el('span', { class: 'kbd' }, it.keys) : null,
    )
    if (it.sub) {
      b.onmouseenter = () => {
        pop.querySelectorAll(':scope > .menu-pop').forEach((p) => p.remove())
        pop.querySelectorAll('.sub-open').forEach((x) => x.classList.remove('sub-open'))
        const sp = buildPop(it.sub)
        sp.style.top = b.offsetTop - 6 + 'px'
        b.classList.add('sub-open')
        pop.append(sp)
      }
    } else {
      b.onmouseenter = () => {
        pop.querySelectorAll(':scope > .menu-pop').forEach((p) => p.remove())
        pop.querySelectorAll('.sub-open').forEach((x) => x.classList.remove('sub-open'))
      }
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = () => {
        closeMenus()
        it.fn?.()
      }
    }
    pop.append(b)
  }
  return pop
}

function showMenu(root, items) {
  closeMenus()
  openMenu = root
  root.classList.add('open')
  root.append(buildPop(items))
}
function closeMenus() {
  if (!openMenu) return
  openMenu.classList.remove('open')
  openMenu.querySelector('.menu-pop')?.remove()
  openMenu = null
}

/**
 * Self-drawn dropdown. Native <select> popups are GTK popovers on Linux (a known source
 * of WebKitGTK hangs on Wayland) and look out of place, so Folio draws its own.
 * @param opts [[value, label], …]
 */
function customSelect(opts, value, onChange) {
  let cur = String(value)
  const label = () => (opts.find(([v]) => String(v) === cur) || opts[0])[1]
  const btn = el('button', { type: 'button', class: 'fsel' }, el('span', {}, label()))
  btn.value = cur
  btn.onclick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const m = $('#ctxmenu')
    if (!m.hidden && m.dataset.owner === 'fsel') {
      m.hidden = true
      return
    }
    m.innerHTML = ''
    m.dataset.owner = 'fsel'
    for (const [v, l] of opts) {
      const it = el('button', { class: 'menu-item' + (String(v) === cur ? ' checked' : '') }, el('span', { class: 'lbl' }, l))
      it.onmousedown = (ev) => ev.preventDefault()
      it.onclick = (ev) => {
        ev.stopPropagation()
        m.hidden = true
        cur = String(v)
        btn.value = cur
        btn.firstChild.textContent = l
        onChange(v)
      }
      m.append(it)
    }
    m.hidden = false
    const r = btn.getBoundingClientRect()
    m.style.minWidth = r.width + 'px'
    m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + 'px'
    const below = r.bottom + 4
    m.style.top = (below + m.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - m.offsetHeight - 4) : below) + 'px'
  }
  return btn
}

function showContextMenu(x, y, items) {
  $('#ctxmenu').dataset.owner = ''
  const m = $('#ctxmenu')
  m.innerHTML = ''
  for (const it of items) {
    if (it === '-') {
      m.append(el('div', { class: 'menu-sep' }))
      continue
    }
    m.append(
      el(
        'button',
        {
          class: 'menu-item',
          onclick: () => {
            m.hidden = true
            it[1]()
          },
        },
        el('span', { class: 'lbl' }, it[0]),
      ),
    )
  }
  m.hidden = false
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px'
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px'
}

// ── keyboard
const MOD_ORDER = ['Ctrl', 'Alt', 'Shift']
const canon = (s) => {
  const parts = s.split('+').filter(Boolean)
  const key = s.endsWith('++') ? '+' : parts.pop()
  return [...MOD_ORDER.filter((m) => parts.includes(m)), key.length === 1 ? key.toUpperCase() : key].join('+')
}
const CODE_KEYS = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backquote: '`', Slash: '/', Backslash: '\\', Comma: ',', Period: '.', Semicolon: ';', Quote: "'",
}
/**
 * Candidate shortcut strings for a key event, most specific first. Layout-aware:
 * letters & symbols match the character the key produces (so Ctrl+/ works on
 * German layouts where / is Shift+7), digits and US-symbol positions match the
 * physical key as a fallback.
 */
function eventCombos(e) {
  const ctrl = e.ctrlKey || e.metaKey
  // AltGr reports as Ctrl+Alt on Windows; treat it as plain character input
  const altGr = e.getModifierState?.('AltGraph')
  const mods = (shift, alt = e.altKey && !altGr, c = ctrl && !altGr) => [c && 'Ctrl', alt && 'Alt', shift && 'Shift'].filter(Boolean)
  const out = []
  const push = (m, k) => k && out.push([...m, k].join('+'))
  const ch = e.key.length === 1 ? e.key.toUpperCase() : null
  // Synthetic input (remote desktop, AutoHotkey, on-screen keyboards) may lack e.code: use keyCode
  if (!e.code && ((e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 65 && e.keyCode <= 90))) {
    const kc = String.fromCharCode(e.keyCode)
    if (e.keyCode <= 57) push(mods(e.shiftKey), kc)
    else if (!ch || !/[A-Z]/.test(ch)) push(mods(e.shiftKey), kc)
  }
  const codeKey = /^Key[A-Z]$/.test(e.code)
    ? e.code.slice(3)
    : /^Digit\d$/.test(e.code)
      ? e.code.slice(5)
      : /^Numpad\d$/.test(e.code)
        ? e.code.slice(6)
        : CODE_KEYS[e.code]
  if (/^Digit\d$/.test(e.code)) push(mods(e.shiftKey), codeKey)
  if (ch) {
    push(mods(e.shiftKey), ch)
    if (e.shiftKey && !/[A-Z0-9]/.test(ch)) push(mods(false), ch) // symbol produced via Shift
  } else push(mods(e.shiftKey), e.key)
  if (codeKey) push(mods(e.shiftKey, e.altKey, ctrl), codeKey)
  return out
}
const KEYMAP = new Map()
const RELOAD_KEYS = ['F5', 'Ctrl+R', 'Ctrl+F5', 'Shift+F5']
const VIM_PASSTHROUGH = new Set(
  ['F', 'B', 'D', 'U', 'E', 'Y', 'O', 'I', 'V', 'R', 'A', 'X', 'W', 'H', 'T', '['].map((c) => 'Ctrl+' + c),
)
function bindKeys() {
  for (const a of ACTIONS) if (a.keys && !a.native) KEYMAP.set(canon(a.keys), a.fn)
  KEYMAP.set('Ctrl+Shift+Q', blockquote)
  KEYMAP.set('F1', () => commandPalette())

  window.addEventListener(
    'keydown',
    (e) => {
      document.body.classList.toggle('ctrl-down', e.ctrlKey)
      if (!$('#modal').hidden) return
      if (languagePickerKey(e)) return
      const combos = eventCombos(e)
      const combo = combos.find((c) => KEYMAP.has(c)) || combos[0]
      const inVim = settings.vim && inSource() && source.vimOn() && !!e.target.closest?.('.cm-editor')
      // Vim owns its Ctrl keys (scrolling, jumps, visual block, redo, …) inside the source editor.
      // Reload keys are still blocked by the bubble-phase guard below.
      if (inVim && VIM_PASSTHROUGH.has(combo)) return
      // Never let the webview reload / navigate away
      if (RELOAD_KEYS.includes(combo)) {
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        if (openMenu) return closeMenus()
        if (inVim) return // Vim needs Esc
        if (!$('#palette').hidden) return
        if (!$('#findbar').hidden) {
          e.preventDefault()
          return closeFind()
        }
        if (document.body.classList.contains('app-zen')) return toggleZen()
      }
      const inFind = e.target.closest?.('#findbar')
      if (inFind && e.key === 'Enter') {
        e.preventDefault()
        if (e.target.id === 'replace-input') return e.ctrlKey ? replaceAllMatches() : replaceOne()
        return findStep(e.shiftKey ? -1 : 1)
      }
      // Tables: Enter moves to the next row, adding one when in the last row
      if (
        combo === 'Enter' &&
        !e.isComposing &&
        S.mode === 'wysiwyg' &&
        !S.readonly &&
        e.target.closest?.('.ProseMirror') &&
        !e.target.closest('.milkdown-code-block') &&
        tableEnter()
      ) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // Ctrl+Enter keeps its normal meaning inside code blocks (exit the block)
      if (combo === 'Ctrl+Enter' && e.target.closest?.('.milkdown-code-block')) return
      const fn = KEYMAP.get(combo)
      if (!fn) return
      const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.closest('.cm-editor')
      // In plain inputs, only allow global (non-formatting) shortcuts
      if (inInput && !/^(Ctrl\+(S|O|N|P|W|F|H|,|\/)|Ctrl\+Shift\+[PNOFL]|F\d+|Shift\+F3)$/.test(combo)) return
      e.preventDefault()
      e.stopPropagation()
      if (!$('#palette').hidden) closePalette()
      fn()
    },
    true,
  )
  // Bubble-phase safety net: whatever an editor did with the key, never reload the page.
  window.addEventListener('keydown', (e) => {
    if (eventCombos(e).some((c) => RELOAD_KEYS.includes(c))) e.preventDefault()
  })
  window.addEventListener('keyup', (e) => document.body.classList.toggle('ctrl-down', e.ctrlKey))
  window.addEventListener('blur', () => document.body.classList.remove('ctrl-down'))
}

// ── code-block language picker: keyboard navigation + keep it on screen
function languagePickerKey(e) {
  const picker = e.target.closest?.('.milkdown-code-block .language-picker')
  if (!picker || !['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Home', 'End'].includes(e.key) || e.ctrlKey || e.altKey) return false
  const items = [...picker.querySelectorAll('.language-list-item:not(.no-result)')]
  const block = picker.closest('.milkdown-code-block')
  const stop = () => {
    e.preventDefault()
    e.stopPropagation()
    return true
  }
  if (e.key === 'Escape') {
    block.querySelector('.language-button')?.click()
    return stop()
  }
  if (!items.length) return e.key === 'Enter' ? stop() : false
  const at = items.indexOf(document.activeElement)
  if (e.key === 'Enter') {
    ;(items[at] || items.find((i) => i.classList.contains('kb-active')) || items[0]).click()
    return stop()
  }
  let next
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = items.length - 1
  else if (at < 0) next = e.key === 'ArrowDown' ? 0 : items.length - 1
  else next = Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))
  items.forEach((i) => i.classList.remove('kb-active'))
  items[next].classList.add('kb-active')
  items[next].focus({ preventScroll: true })
  items[next].scrollIntoView({ block: 'nearest' })
  return stop()
}

/** When a picker opens, flip it upwards if it would run off the bottom of the editor. */
function wireLanguagePicker() {
  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest?.('.milkdown-code-block .language-button')
      if (!btn) return
      const fit = (tries = 0) => {
        const picker = btn.parentElement.querySelector('.language-picker')
        const wrap = picker?.querySelector('.list-wrapper')
        if (!wrap) return tries < 5 && requestAnimationFrame(() => fit(tries + 1))
        picker.classList.remove('open-up')
        const bounds = scroller.getBoundingClientRect()
        const r = wrap.getBoundingClientRect()
        const below = bounds.bottom - btn.getBoundingClientRect().bottom
        const above = btn.getBoundingClientRect().top - bounds.top
        if (r.bottom > bounds.bottom - 8 && above > below) picker.classList.add('open-up')
        // keep it fully visible
        const r2 = wrap.getBoundingClientRect()
        if (r2.bottom > bounds.bottom - 8 || r2.top < bounds.top + 8) wrap.scrollIntoView({ block: 'nearest' })
      }
      requestAnimationFrame(() => fit())
    },
    true,
  )
}

function showShortcuts() {
  const grid = el('div', { class: 'keys-grid' })
  for (const m of MENU) {
    const acts = m.items.filter((i) => typeof i === 'object' && i.keys)
    if (!acts.length) continue
    grid.append(el('h4', {}, m.label))
    for (const a of acts) grid.append(el('span', {}, a.label), el('kbd', {}, a.keys))
  }
  grid.append(el('h4', {}, 'Editor'))
  for (const [l, kk] of [
    ['Block menu', '/'],
    ['Open link', 'Ctrl+Click'],
    ['Replace all (in replace box)', 'Ctrl+Enter'],
    ['Indent / outdent list', 'Tab / Shift+Tab'],
  ])
    grid.append(el('span', {}, l), el('kbd', {}, kk))
  dialog({ title: 'Keyboard Shortcuts', body: grid, wide: true, buttons: [{ label: 'Close', value: true, primary: true, cancel: true }] })
}

// ════════════════════════════════════════ palette (quick open + commands)
let quickCache = null
let palItems = []
let palSel = 0
let palMode = 'files'

function fuzzy(q, s) {
  if (!q) return { score: 0, idx: [] }
  const ql = q.toLowerCase()
  const sl = s.toLowerCase()
  const sub = sl.indexOf(ql)
  if (sub >= 0) return { score: 1000 - sub - s.length * 0.1, idx: [...Array(q.length)].map((_, i) => sub + i) }
  let j = 0
  const idx = []
  let score = 0
  let prev = -2
  for (let i = 0; i < sl.length && j < ql.length; i++) {
    if (sl[i] === ql[j]) {
      idx.push(i)
      score += prev === i - 1 ? 8 : 1
      if (i === 0 || /[\s\\/_\-.]/.test(sl[i - 1])) score += 6
      prev = i
      j++
    }
  }
  return j === ql.length ? { score: score - s.length * 0.05, idx } : null
}
const hl = (s, idx) => {
  const set = new Set(idx)
  return [...s].map((c, i) => (set.has(i) ? `<mark>${esc(c)}</mark>` : esc(c))).join('')
}

async function quickOpen() {
  palMode = 'files'
  const root = S.root || (S.path && P.dirname(S.path))
  openPalette('Search files by name…')
  if (root && !quickCache) {
    renderPalette()
    quickCache = await invoke('walk_md', { root })
  }
  renderPalette()
}

function commandPalette() {
  palMode = 'commands'
  openPalette('Type a command…')
  renderPalette()
}

function openPalette(ph) {
  closeMenus()
  const p = $('#palette')
  const i = $('#pal-input')
  i.value = ''
  i.placeholder = ph
  p.hidden = false
  palSel = 0
  i.focus()
}
function closePalette() {
  $('#palette').hidden = true
}

function renderPalette() {
  const q = $('#pal-input').value.trim()
  const list = $('#pal-list')
  let rows = []
  if (palMode === 'files') {
    const root = S.root || (S.path && P.dirname(S.path))
    const seen = new Set()
    const pool = []
    for (const r of recent) {
      seen.add(r.toLowerCase())
      pool.push({ path: r, recent: true })
    }
    for (const f of quickCache || []) if (!seen.has(f.toLowerCase())) pool.push({ path: f })
    for (const it of pool) {
      const name = P.basename(it.path)
      const rel = root ? P.relative(root, it.path) : it.path
      const m = fuzzy(q, name) || (q && fuzzy(q, rel || it.path))
      if (!m) continue
      const nameMatch = !!fuzzy(q, name)
      rows.push({
        score: m.score + (it.recent ? 50 : 0) + (nameMatch ? 100 : 0),
        html: nameMatch ? hl(name, m.idx) : esc(name),
        desc: (it.recent ? '★ ' : '') + (P.dirname(it.path) || ''),
        run: () => openFile(it.path),
      })
    }
    if (!q) rows.sort((a, b) => b.score - a.score)
  } else {
    for (const a of ACTIONS) {
      const label = `${a.group}: ${a.label}`
      const m = fuzzy(q, label)
      if (!m) continue
      rows.push({ score: m.score, html: hl(label, m.idx), desc: a.keys || '', run: a.fn, ltr: true })
    }
  }
  if (q) rows.sort((a, b) => b.score - a.score)
  rows = rows.slice(0, 80)
  palItems = rows
  palSel = Math.min(palSel, Math.max(0, rows.length - 1))
  list.innerHTML = ''
  if (!rows.length) {
    list.append(
      el(
        'div',
        { class: 'pal-empty' },
        palMode === 'files' && !quickCache && !recent.length ? 'Open a folder to quickly jump between its files.' : 'No matches',
      ),
    )
    return
  }
  rows.forEach((r, i) => {
    const item = el('div', { class: 'pal-item' + (i === palSel ? ' sel' : '') })
    const t = el('span', { class: 't' })
    t.innerHTML = r.html
    item.append(t, el('span', { class: 'd', style: r.ltr ? 'direction:ltr' : '' }, r.desc))
    item.onmousemove = () => {
      if (palSel !== i) {
        palSel = i
        list.querySelectorAll('.pal-item').forEach((x, j) => x.classList.toggle('sel', j === i))
      }
    }
    item.onmousedown = (e) => {
      e.preventDefault()
      choosePalette(i)
    }
    list.append(item)
  })
  list.children[palSel]?.scrollIntoView({ block: 'nearest' })
}
function choosePalette(i) {
  const r = palItems[i]
  closePalette()
  if (r) r.run()
  else focusEditor()
}

$('#pal-input').addEventListener('input', () => {
  palSel = 0
  renderPalette()
})
$('#pal-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    palSel = (palSel + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % Math.max(1, palItems.length)
    renderPalette()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choosePalette(palSel)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closePalette()
    focusEditor()
  }
})
$('#palette').addEventListener('mousedown', (e) => e.target.id === 'palette' && (closePalette(), focusEditor()))

// ════════════════════════════════════════ wiring
function wireUi() {
  wireLanguagePicker()
  wirePagePreview()
  wireTablePlus()
  // sidebar
  for (const b of document.querySelectorAll('.sb-tabs button')) b.onclick = () => setTab(b.dataset.tab)
  $('#sb-toggle').onclick = () => setSidebar()
  $('#btn-openfolder').onclick = openFolderDialog
  $('#btn-newfile').onclick = () => createFileIn()
  $('#search-input').addEventListener('input', runFolderSearch)
  $('#st-mode').onclick = toggleSource
  $('#st-path').onclick = () => S.path && revealItemInDir(S.path)

  // sidebar resize
  const rz = $('#resizer')
  rz.onmousedown = (e) => {
    e.preventDefault()
    rz.classList.add('drag')
    const move = (ev) => {
      settings.sidebarWidth = Math.max(160, Math.min(560, ev.clientX))
      html.style.setProperty('--sb-width', settings.sidebarWidth + 'px')
    }
    const up = () => {
      rz.classList.remove('drag')
      removeEventListener('mousemove', move)
      removeEventListener('mouseup', up)
      saveSettings()
    }
    addEventListener('mousemove', move)
    addEventListener('mouseup', up)
  }

  // find bar
  $('#find-input').addEventListener('input', () => runFind())
  $('#replace-input').addEventListener('input', () => S.mode === 'source' && runFind(false))
  $('#find-next').onclick = () => findStep(1)
  $('#find-prev').onclick = () => findStep(-1)
  $('#find-close').onclick = closeFind
  $('#find-toggle-replace').onclick = () => ($('#replace-row').hidden = !$('#replace-row').hidden)
  $('#replace-one').onclick = replaceOne
  $('#replace-all').onclick = replaceAllMatches
  for (const [id, key] of [
    ['#find-case', 'cs'],
    ['#find-word', 'word'],
    ['#find-regex', 'regex'],
  ]) {
    $(id).onclick = () => {
      find[key] = !find[key]
      $(id).classList.toggle('on', find[key])
      runFind()
    }
  }

  // Ctrl+click on links (and plain click in read-only mode)
  $('#wysiwyg').addEventListener(
    'click',
    (e) => {
      const a = e.target.closest('a[href]')
      if (!a) return
      if (e.ctrlKey || e.metaKey || S.readonly) {
        e.preventDefault()
        e.stopPropagation()
        openLink(a.getAttribute('href'))
      }
    },
    true,
  )
  // Never let the webview navigate
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]')
    if (a && !e.defaultPrevented) e.preventDefault()
  })

  // Clicking blank space around/below the document focuses the editor (caret at end when below)
  scroller.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.ProseMirror, .cm-content, .milkdown-code-block, button, input, a')) return
    e.preventDefault()
    if (inSource()) {
      const cmv = source.view
      const end = cmv.state.doc.length
      const pos = cmv.posAtCoords({ x: e.clientX, y: e.clientY }, false) ?? end
      cmv.dispatch({ selection: { anchor: pos } })
      return cmv.focus()
    }
    const v = view()
    if (!v) return
    const dom = v.dom.getBoundingClientRect()
    const below = e.clientY > dom.bottom - parseFloat(getComputedStyle(v.dom).paddingBottom)
    let pos = below ? null : v.posAtCoords({ left: Math.min(Math.max(e.clientX, dom.left + 70), dom.right - 70), top: e.clientY })?.pos
    pos ??= v.state.doc.content.size
    v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(pos), pos >= v.state.doc.content.size ? -1 : 1)))
    v.focus()
  })

  scroller.addEventListener('scroll', scheduleActiveHeading, { passive: true })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => settings.theme === 'system' && setTheme('system'))

  // file watching
  setInterval(checkExternal, 1500)
  addEventListener('focus', checkExternal)

  // drag & drop from Explorer
  getCurrentWebview().onDragDropEvent(async (ev) => {
    if (ev.payload.type !== 'drop') return
    const paths = ev.payload.paths || []
    const md = paths.find((p) => isMdPath(p))
    const dir = !md && paths.length === 1 && (await invoke('is_dir', { path: paths[0] }))
    if (dir) return setRoot(paths[0], true)
    if (md) {
      await openFile(md)
      for (const extra of paths.filter((p) => p !== md && isMdPath(p))) invoke('new_window', { path: extra })
      return
    }
    const imgs = paths.filter(isImgPath)
    if (!imgs.length || S.readonly) return
    let pos
    if (S.mode === 'wysiwyg') {
      const dpr = devicePixelRatio || 1
      const v = view()
      pos = v?.posAtCoords({ left: ev.payload.position.x / dpr, top: ev.payload.position.y / dpr })?.pos
    }
    for (const p of imgs) {
      insertImage(await srcForDroppedImage(p), P.stem(p), pos)
      pos = undefined
    }
  })

  // unsaved-changes guard
  win.onCloseRequested(async (e) => {
    if (!syncDirty()) return
    e.preventDefault()
    try {
      if (await confirmDiscard()) {
        S.dirty = false
        await win.destroy()
      }
    } catch (err) {
      log('close failed:', err)
    }
  })
}

// ════════════════════════════════════════ boot
/**
 * Headless command-line export (window stays hidden):
 *   folio --export-pdf  input.md output.pdf
 *   folio --export-html input.md output.html
 * Uses the PDF options saved in the app. Exit code 0 on success, 1 on failure.
 */
async function runCliExport(args) {
  S.cli = true // never write settings or recent files from a headless export
  const i = args.findIndex((a) => a === '--export-pdf' || a === '--export-html')
  const input = await invoke('initial_path')
  const output = args[i + 2]
  try {
    if (!input || !output) throw new Error('usage: folio --export-pdf <input.md> <output.pdf>')
    S.readonly = false
    settings.startInSource = false
    if (!(await openFile(input, { force: true }))) throw new Error('could not open ' + input)
    const out = P.isAbs(output) ? output : P.join(P.dirname(input), output)
    // optional overrides: --title --author --subject --keywords --header --footer
    //                     --page-numbers (none|n|n/N|page n of N) --paper (a4|letter|…) --landscape --theme
    const flag = (name) => {
      const j = args.indexOf('--' + name)
      return j >= 0 ? args[j + 1] : undefined
    }
    const o = {}
    for (const k2 of ['title', 'author', 'subject', 'keywords', 'header', 'footer', 'paper']) if (flag(k2) !== undefined) o[k2] = flag(k2)
    if (flag('page-numbers') !== undefined) o.pageNumbers = flag('page-numbers') === 'none' ? '' : flag('page-numbers')
    if (args.includes('--landscape')) o.landscape = true
    if (flag('theme')) settings.exportTheme = flag('theme')
    if (args[i] === '--export-pdf') await exportPdfTo(out, pdfOptionsFor(settings.pdf, o))
    else await exportHtmlTo(out)
    await invoke('exit_app', { code: 0 })
  } catch (e) {
    log('cli export failed:', e)
    await invoke('exit_app', { code: 1 })
  }
}

async function boot() {
  try {
    settings.nativeTitlebar = await invoke('native_titlebar')
  } catch {}
  applySettings()
  buildMenubar()
  initWriting({
    settings,
    saveSettings,
    el,
    toast,
    log,
    mode: () => S.mode,
    pmView: view,
    cmView: () => source?.view ?? null,
    openOptions: () => openPrefs('writing'),
  })
  writingStatus($('#st-wc'))
  bindKeys()
  wireUi()
  wireTitlebar()
  applyTitlebar()
  setTab(settings.sidebarTab)

  const args = await invoke('cli_args').catch(() => [])
  if (args.includes('--export-pdf') || args.includes('--export-html')) return runCliExport(args)

  let path = null
  try {
    path = await invoke('initial_path')
  } catch {}
  // forget recent files that no longer exist (moved, deleted, temp files)
  const alive = await Promise.all(recent.map((r) => invoke('exists', { path: r }).catch(() => false)))
  if (alive.includes(false)) {
    recent = recent.filter((_, i) => alive[i])
    try {
      localStorage.setItem('folio.recent', JSON.stringify(recent))
    } catch {}
  }
  if (!path && settings.reopenLast && recent[0]) path = recent[0]

  let opened = false
  if (path && (await invoke('exists', { path }).catch(() => false))) {
    if (await invoke('is_dir', { path })) setRoot(path, true)
    else opened = await openFile(path, { force: true })
  }
  if (!opened) {
    await loadText('')
    if (settings.startInSource) await enterSource()
  }
  renderTree()
  updateTitle()
  await win.show()
  focusEditor()
  if (args.includes('--preview')) {
    PV.debug = true // logs one line once the first page is drawn (used by tests)
    openPagePreview() // `folio --preview file.md`
  }
  if (args.includes('--about')) showAbout()
}

boot().catch((e) => {
  console.error(e)
  win.show()
})
