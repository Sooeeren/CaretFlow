// Spelling, grammar & style checking for both editors (rendered + source mode).
//
//  - Text is split into blocks (paragraphs, headings, list items, table cells). Each block is checked
//    once and cached by its text, so typing only re-checks the paragraph being edited.
//  - Engines live in writing-engine.js and are loaded on first use (Harper by default, offline).
//  - UI: wavy underlines (red spelling, blue grammar, amber style), right-click suggestions,
//    F7 review panel, Alt+F7 next issue, a status-bar counter, custom dictionary.
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { StateField, StateEffect } from '@codemirror/state'
import { EditorView as CMView, Decoration as CMDeco, ViewPlugin } from '@codemirror/view'

/** @type {{ settings, saveSettings, el, toast, mode: () => string, pmView, cmView, readonly: () => boolean, openOptions, log }} */
let H = null
export function initWriting(host) {
  H = host
  window.addEventListener('keydown', menuKeys, true) // before the app's shortcuts
}
// Other sources of findings (AI Writing Help): { id, active(), issues(blocks, ctx), ignore?(issue) }.
// Their findings use the same underlines, menu and review panel as the spelling checker's.
const sources = []
const harperOn = () => !!H?.settings.spellcheck
const on = () => harperOn() || sources.some((src) => src.active())

export function registerSource(src) {
  if (!sources.includes(src)) sources.push(src)
  // a document may already be open: tell the source what was there before any new writing
  const ad = adapter()
  if (ad) src.opened?.(ad.view, ad.blocks())
  refresh(0)
}
/** The open document's blocks and the cursor's block, for commands like AI: Check Paragraph. */
export function blockHelpers() {
  const ad = adapter()
  return ad && { blocks: () => ad.blocks(), caretBlock: () => checkContext(ad, ad.blocks()).caretBlock }
}

/** What the spelling checker found in the open document (for MCP's get_writing_issues). */
export function currentIssues() {
  return (adapter()?.issues() || []).filter((x) => !x.source).map((x) => ({ quote: x.problem, kind: x.kind, message: x.message }))
}

/** main.js loaded a file (or a reload from disk) into the editor: that text isn't new writing. */
export function documentLoaded() {
  const ad = adapter()
  if (ad) for (const src of sources) src.opened?.(ad.view, ad.blocks())
}
/** An editor opened a document: sources learn its text right away, before any check runs. */
function opened(view, blocks) {
  for (const src of sources) src.opened?.(view, blocks())
}
/** A source has new findings (or was turned on or off): redraw. */
export function sourceChanged() {
  if (!on()) return clearAll()
  publish()
  refresh(0)
}
/** The cursor moved: a source waiting for it to leave a paragraph looks again. */
function caretMoved() {
  if (sources.some((src) => src.active() && src.wantsCaret?.())) refresh(200)
}
const sameIssues = (a, b) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.to === b[i].to && x.message === b[i].message && x.source === b[i].source)

// ════════════════════════════════════════ engine + cache
let engine = null
let enginePromise = null
let engineState = 'idle' // 'loading' | 'ready' | 'error'
let engineError = ''
let engineKey = '' // engine options the current engine was made with
const cache = new Map() // block text -> issues
const CACHE_MAX = 5000

function engineOptions() {
  const s = H.settings
  return s.wcEngine === 'languagetool'
    ? { kind: 'languagetool', server: s.ltServer || 'https://api.languagetool.org', language: s.ltLanguage || 'auto', picky: !!s.wcStyle }
    : { kind: 'harper', dialect: s.wcDialect || 'american', ignoreUpper: s.wcIgnoreUpper !== false, ignoreDigits: s.wcIgnoreDigits !== false }
}

function getEngine() {
  if (enginePromise) return enginePromise
  engineState = 'loading'
  publish()
  const o = engineOptions()
  engineKey = JSON.stringify(o)
  enginePromise = import('./writing-engine.js')
    .then((m) => (o.kind === 'languagetool' ? m.createLanguageTool(o) : m.createHarper(o)))
    .then((e) => {
      engine = e
      engineState = 'ready'
      engineError = ''
      return e
    })
    .catch((err) => {
      engineState = 'error'
      engineError = String(err?.message || err)
      enginePromise = null
      H.log?.('writing check: engine failed', err)
      throw err
    })
  return enginePromise
}

/** Call after any writing-check setting changed. */
export function writingSettingsChanged() {
  const nativeOff = () => {
    const w = document.querySelector('#wysiwyg')
    if (w) w.spellcheck = false
  }
  nativeOff()
  // only rebuild the engine when its own options changed; filters (style, grammar, rules) apply on the fly
  if (!harperOn() || JSON.stringify(engineOptions()) !== engineKey) {
    engine?.dispose()
    engine = null
    enginePromise = null
    engineKey = ''
    engineState = 'idle'
    cache.clear()
  }
  if (!on()) {
    clearAll()
    closePanel()
  }
  refresh(0)
}

async function checkTexts(texts) {
  if (!harperOn()) return texts.map(() => [])
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))]
  if (missing.length) {
    const eng = await getEngine()
    // check in slices so other work (and newer edits) can interleave
    for (let i = 0; i < missing.length; i += 40) {
      const part = missing.slice(i, i + 40)
      const res = await eng.check(part)
      part.forEach((t, j) => cache.set(t, res[j] || []))
    }
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  }
  return texts.map((t) => cache.get(t) || [])
}

// ════════════════════════════════════════ filtering (dictionary, ignored, settings)
const session = { ignoreAll: new Set(), ignoreOnce: new Set() }
const dict = () => new Set((H.settings.wcDictionary || []).map((w) => w.toLowerCase()))
const contextKey = (iss) => `${iss.rule}|${iss.problem}|${iss.block.slice(Math.max(0, iss.start - 24), iss.end + 24)}`
const allKey = (iss) => `${iss.rule}|${iss.problem.toLowerCase()}`

function keep(iss, words) {
  const s = H.settings
  if (iss.cat === 'style' && !s.wcStyle) return false
  if (iss.cat === 'grammar' && s.wcGrammar === false) return false
  if (iss.source && words.has(iss.problem.trim().toLowerCase())) return false
  if ((s.wcDisabledRules || []).includes(iss.rule)) return false
  if (iss.cat === 'spelling' && words.has(iss.problem.toLowerCase())) return false
  if (session.ignoreAll.has(allKey(iss)) || session.ignoreOnce.has(contextKey(iss))) return false
  if (iss.masks?.some(([a, b]) => iss.start < b && iss.end > a)) return false
  if (iss.problem.includes('￼') || !iss.problem.trim()) return false // atoms; spacing (invisible in Markdown)
  return true
}

/** Issues for blocks: [{ text, at(i) -> doc position, masks }] → absolute, filtered issues. */
async function issuesFor(blocks, ctx) {
  // other sources first: they must see the document as it is now, not after the spelling
  // checker has loaded (AI Writing Help tells opened text from new writing this way)
  const extras = sources.filter((src) => src.active()).map((src) => src.issues(blocks, ctx))
  const results = await checkTexts(blocks.map((b) => b.text))
  for (const extra of extras) {
    extra.forEach((list, i) => {
      // the spelling checker already marks exactly these words: one underline is enough
      const own = list.filter((x) => !results[i].some((r) => !r.source && r.start === x.start && r.end === x.end))
      if (own.length) results[i] = [...results[i], ...own].sort((a, b) => a.start - b.start)
    })
  }
  const words = dict()
  const out = []
  blocks.forEach((b, i) => {
    for (const r of results[i]) {
      const iss = { ...r, block: b.text, masks: b.masks, problem: b.text.slice(r.start, r.end) }
      if (!keep(iss, words)) continue
      iss.from = b.at(r.start)
      iss.to = r.end > r.start ? b.at(r.end - 1) + 1 : iss.from
      iss.id = `${iss.from}:${iss.rule}`
      out.push(iss)
    }
  })
  return out
}

// ════════════════════════════════════════ block extraction
/** Rendered editor: every textblock outside code, with inline code / atoms masked out. */
function pmBlocks(doc) {
  const out = []
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false
    if (!node.isTextblock) return true
    let text = ''
    const masks = []
    node.forEach((child) => {
      if (child.isText) {
        if (child.marks.some((m) => m.type.spec.code || /code/i.test(m.type.name))) masks.push([text.length, text.length + child.text.length])
        text += child.text
      } else {
        masks.push([text.length, text.length + 1])
        text += /break/i.test(child.type.name) ? '\n' : '￼'
      }
    })
    const base = pos + 1
    if (/\p{L}/u.test(text)) out.push({ text, masks, at: (i) => base + i })
    return false
  })
  return out
}

/**
 * Source mode: split Markdown into prose blocks and strip the syntax around the words
 * (list markers, emphasis, link targets, HTML tags…), keeping a map back to document offsets.
 */
export function mdBlocks(src) {
  const blocks = []
  const lines = src.split('\n')
  let off = 0
  let fence = null
  let math = false
  let front = lines[0] === '---'
  let para = null // { start, end }
  const flush = () => {
    if (para) blocks.push(proseOf(src, para.start, para.end))
    para = null
  }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const start = off
    const end = off + line.length
    off = end + 1
    if (front) {
      if (li > 0 && /^(---|\.\.\.)\s*$/.test(line)) front = false
      continue
    }
    if (fence) {
      if (line.trimStart().startsWith(fence)) fence = null
      continue
    }
    const fm = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fm) {
      flush()
      fence = fm[1]
      continue
    }
    if (math) {
      if (/^\s*\$\$\s*$/.test(line)) math = false
      continue
    }
    if (/^\s*\$\$/.test(line)) {
      flush()
      if (!/\$\$\s*$/.test(line.trim().slice(2))) math = true
      continue
    }
    if (!line.trim() || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line) || /^\s*<(div|!--|table|pre|script|style|details|summary|img|br)\b/i.test(line)) {
      flush()
      continue
    }
    if (/^\s*\|/.test(line)) {
      // table row: every cell is its own block
      flush()
      const re = /[^|]+/g
      for (let m; (m = re.exec(line)); ) if (m[0].trim()) blocks.push(proseOf(src, start + m.index, start + m.index + m[0].length))
      continue
    }
    const newBlock = /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(line)
    if (newBlock || !para) {
      flush()
      para = { start, end }
      if (/^\s{0,3}#{1,6}\s/.test(line)) flush() // headings stand alone
    } else para.end = end
  }
  flush()
  return blocks.filter((b) => /\p{L}/u.test(b.text))
}

function proseOf(src, start, end) {
  const raw = src.slice(start, end)
  const n = raw.length
  const kind = new Uint8Array(n) // 0 keep, 1 drop, 2 keep but never report
  const set = (a, b, k) => {
    for (let i = a; i < b; i++) if (!kind[i] || k === 2) kind[i] = k
  }
  const each = (re, fn) => {
    re.lastIndex = 0
    for (let m; (m = re.exec(raw)); ) {
      if (kind[m.index] === 2) continue
      fn(m)
      if (!m[0].length) re.lastIndex++
    }
  }
  // code spans and math first: their content is never checked
  each(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => {
    set(m.index, m.index + m[0].length, 2)
    set(m.index, m.index + m[1].length, 1)
    set(m.index + m[0].length - m[1].length, m.index + m[0].length, 1)
  })
  each(/\$[^$\n]+\$/g, (m) => set(m.index, m.index + m[0].length, 1))
  // line prefixes: quotes, list markers, task boxes, headings, table pipes
  each(/^[ \t]*((>[ \t]?)*)([-*+][ \t]+|\d+[.)][ \t]+)?(\[[ xX]\][ \t]+)?(#{1,6}[ \t]+)?/gm, (m) => set(m.index, m.index + m[0].length, 1))
  each(/[ \t]#+[ \t]*$/gm, (m) => set(m.index, m.index + m[0].length, 1))
  each(/\|/g, (m) => set(m.index, m.index + 1, 1))
  // images, links, footnotes, callout markers, autolinks, html tags
  each(/!\[[^\]]*\]\([^)]*\)/g, (m) => set(m.index, m.index + m[0].length, 1))
  each(/\[([^\]\n]+)\](\([^)]*\)|\[[^\]]*\])/g, (m) => {
    set(m.index, m.index + 1, 1)
    set(m.index + 1 + m[1].length, m.index + m[0].length, 1)
  })
  each(/\[[!^][^\]]*\]/g, (m) => set(m.index, m.index + m[0].length, 1))
  each(/<https?:[^>]+>|<\/?[A-Za-z][^>]*>/g, (m) => set(m.index, m.index + m[0].length, 1))
  // emphasis markers
  each(/\*{1,3}|~~|(?<![\p{L}\p{N}])_{1,3}|_{1,3}(?![\p{L}\p{N}])/gu, (m) => set(m.index, m.index + m[0].length, 1))
  each(/\\(?=[\\`*_{}[\]()#+\-.!|~<>$])/g, (m) => set(m.index, m.index + 1, 1))

  let text = ''
  const map = []
  const masks = []
  for (let i = 0; i < n; i++) {
    if (kind[i] === 1) continue
    if (kind[i] === 2) {
      const last = masks[masks.length - 1]
      if (last && last[1] === text.length) last[1]++
      else masks.push([text.length, text.length + 1])
    }
    map.push(start + i)
    text += raw[i]
  }
  return { text, masks, at: (i) => (i < map.length ? map[i] : (map[map.length - 1] ?? start - 1) + 1) }
}

// ════════════════════════════════════════ shared scheduling
let issues = [] // issues of the active editor, in document order
let current = null // id of the issue shown in the review panel
let timer = null
let running = false
let again = false
let typingAt = 0
let waits = 0

function delay() {
  return H.settings.wcEngine === 'languagetool' ? 1800 : 300
}

/** (Re)check the active editor after `ms`. */
export function refresh(ms = delay()) {
  clearTimeout(timer)
  if (!H || !on()) return
  timer = setTimeout(run, ms)
}

async function run() {
  if (running) {
    // the spelling checker is still busy (loading, or waiting for LanguageTool): other sources
    // look at the text anyway, so their requests don't wait for it
    const ad = adapter()
    if (ad && sources.some((src) => src.active())) sources.filter((src) => src.active()).forEach((src) => src.issues(ad.blocks(), checkContext(ad, ad.blocks())))
    again = true
    return
  }
  const ad = adapter()
  if (!ad) {
    // the editor is still being created
    if (++waits < 40) refresh(250)
    return
  }
  waits = 0
  running = true
  try {
    const snap = ad.snapshot()
    const blocks = ad.blocks()
    const found = await issuesFor(blocks, checkContext(ad, blocks))
    if (!on() || !ad.alive()) return
    if (ad.snapshot() !== snap) {
      again = true
      return
    }
    if (!sameIssues(found, ad.issues())) ad.setIssues(found)
    else publish()
  } catch (e) {
    if (engineState !== 'error') H.log?.('writing check failed', e)
    publish()
  } finally {
    running = false
    if (again) {
      again = false
      refresh(delay())
    }
  }
}

/** What a source needs to know besides the text: where the caret is, how long since the last keystroke. */
function checkContext(ad, blocks) {
  const caret = ad.caret()
  const caretBlock = blocks.findIndex((b) => caret >= b.at(0) && caret <= b.at(Math.max(0, b.text.length - 1)) + 1)
  return { caretBlock, idle: Date.now() - typingAt, view: ad.view }
}

function clearAll() {
  issues = []
  const v = H.pmView()
  if (v && pmKey.getState(v.state)?.issues.length) v.dispatch(v.state.tr.setMeta(pmKey, { issues: [] }).setMeta('addToHistory', false))
  const c = H.cmView()
  if (c && c.state.field(cmField, false)?.issues.length) c.dispatch({ effects: setCmIssues.of([]) })
  publish()
}

/** The active editor as a uniform interface. */
function adapter() {
  if (!H) return null
  if (H.mode() === 'source') {
    const v = H.cmView()
    return v ? cmAdapter(v) : null
  }
  const v = H.pmView()
  return v ? pmAdapter(v) : null
}

// ════════════════════════════════════════ rendered editor (ProseMirror)
const pmKey = new PluginKey('folio-writing')

function pmDeco(doc, list, sel) {
  const hide = Date.now() - typingAt < 1500 && sel.empty ? sel.head : -1
  const decos = []
  for (const iss of list) {
    if (iss.to <= iss.from || iss.to > doc.content.size) continue
    // don't flag the word that is still being typed
    if (iss.cat === 'spelling' && hide >= iss.from && hide <= iss.to) continue
    decos.push(Decoration.inline(iss.from, iss.to, { class: `wc-err wc-${iss.cat}${iss.id === current ? ' wc-cur' : ''}`, nodeName: 'span' }))
  }
  return DecorationSet.create(doc, decos)
}

/** Move issues along with an edit; drop the ones whose text changed. */
function mapIssues(list, map, textAt) {
  const out = []
  for (const iss of list) {
    const from = map(iss.from, 1)
    const to = map(iss.to, -1)
    if (to <= from || textAt(from, to) !== iss.problem) continue
    out.push({ ...iss, from, to, id: `${from}:${iss.rule}` })
  }
  return out
}

export const writingPlugin = () =>
  new Plugin({
    key: pmKey,
    state: {
      init: () => ({ issues: [], deco: DecorationSet.empty, hidden: false }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(pmKey)
        if (meta) return { issues: meta.issues, deco: pmDeco(state.doc, meta.issues, state.selection) }
        if (tr.docChanged) {
          if (tr.getMeta('uiEvent') !== 'paste' && tr.steps.length) typingAt = Date.now()
          const list = mapIssues(prev.issues, (p, a) => tr.mapping.map(p, a), (a, b) => state.doc.textBetween(a, b, '\n', '￼'))
          return { issues: list, deco: pmDeco(state.doc, list, state.selection) }
        }
        if (tr.selectionSet && prev.issues.length) return { issues: prev.issues, deco: pmDeco(state.doc, prev.issues, state.selection) }
        return prev
      },
    },
    props: {
      decorations: (state) => pmKey.getState(state)?.deco,
      handleDOMEvents: {
        contextmenu: (view, e) => {
          const p = view.posAtCoords({ left: e.clientX, top: e.clientY })
          return p ? openIssueMenu(e, p.pos) : false
        },
        // touch screens have no right-click: tapping an underlined word opens its suggestions
        click: (view, e) => {
          if (e.pointerType !== 'touch') return false
          const p = view.posAtCoords({ left: e.clientX, top: e.clientY })
          return p ? openIssueMenu(e, p.pos) : false
        },
      },
    },
    view: (v) => {
      opened(v, () => pmBlocks(v.state.doc))
      refresh(150)
      return {
        update(v, prev) {
          if (v.state.doc !== prev.doc) refresh()
          else if (!v.state.selection.eq(prev.selection)) caretMoved()
          const st = pmKey.getState(v.state)
          if (st.issues !== issues && H.mode() !== 'source') {
            issues = st.issues
            publish()
          }
        },
      }
    },
  })

function pmAdapter(v) {
  return {
    kind: 'pm',
    view: v,
    alive: () => !v.isDestroyed && H.pmView() === v,
    snapshot: () => v.state.doc,
    blocks: () => pmBlocks(v.state.doc),
    setIssues: (list) => v.dispatch(v.state.tr.setMeta(pmKey, { issues: list }).setMeta('addToHistory', false)),
    issues: () => pmKey.getState(v.state)?.issues || [],
    textAt: (a, b) => v.state.doc.textBetween(a, b, '\n', '￼'),
    replace(iss, text) {
      if (this.textAt(iss.from, iss.to) !== iss.problem) return false
      const tr = text ? v.state.tr.insertText(text, iss.from, iss.to) : v.state.tr.delete(iss.from, iss.to)
      v.dispatch(tr.scrollIntoView())
      return true
    },
    select(iss) {
      try {
        v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, iss.from, iss.to)).scrollIntoView())
      } catch {}
      v.dom.querySelector('.wc-cur')?.scrollIntoView({ block: 'center' })
    },
    coords: (pos) => v.coordsAtPos(pos),
    focus: () => v.focus(),
    redraw: () => v.dispatch(v.state.tr.setMeta(pmKey, { issues: pmKey.getState(v.state).issues }).setMeta('addToHistory', false)),
    caret: () => v.state.selection.head,
    plainText: () => v.state.doc.textBetween(0, v.state.doc.content.size, '\n\n', ' '),
  }
}

// ════════════════════════════════════════ source editor (CodeMirror)
const setCmIssues = StateEffect.define()
const redrawCm = StateEffect.define()

function cmDeco(state, list) {
  const ranges = []
  const len = state.doc.length
  const head = state.selection.main
  const hide = Date.now() - typingAt < 1500 && head.empty ? head.head : -1
  for (const iss of list) {
    if (iss.to <= iss.from || iss.to > len) continue
    if (iss.cat === 'spelling' && hide >= iss.from && hide <= iss.to) continue
    ranges.push(CMDeco.mark({ class: `wc-err wc-${iss.cat}${iss.id === current ? ' wc-cur' : ''}` }).range(iss.from, iss.to))
  }
  return CMDeco.set(ranges, true)
}

const cmField = StateField.define({
  create: () => ({ issues: [], deco: CMDeco.none }),
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setCmIssues)) return { issues: e.value, deco: cmDeco(tr.state, e.value) }
      if (e.is(redrawCm)) return { issues: val.issues, deco: cmDeco(tr.state, val.issues) }
    }
    if (tr.docChanged) {
      typingAt = Date.now()
      const list = mapIssues(val.issues, (p, a) => tr.changes.mapPos(p, a), (a, b) => tr.state.sliceDoc(a, b))
      return { issues: list, deco: cmDeco(tr.state, list) }
    }
    if (tr.selection && val.issues.length) return { issues: val.issues, deco: cmDeco(tr.state, val.issues) }
    return val
  },
  provide: (f) => CMView.decorations.from(f, (v) => v.deco),
})

/** CodeMirror extension for source mode. */
export function writingSourceExtension() {
  return [
    cmField,
    ViewPlugin.fromClass(
      class {
        constructor(v) {
          opened(v, () => mdBlocks(v.state.doc.toString()))
          refresh(150)
        }
        update(u) {
          if (u.docChanged) refresh()
          else if (u.selectionSet) caretMoved()
          const st = u.state.field(cmField)
          if (st.issues !== issues && H.mode() === 'source') {
            issues = st.issues
            publish()
          }
        }
      },
    ),
    CMView.domEventHandlers({
      contextmenu(e, view) {
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        return pos != null ? openIssueMenu(e, pos) : false
      },
      click(e, view) {
        if (e.pointerType !== 'touch') return false
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        return pos != null ? openIssueMenu(e, pos) : false
      },
    }),
  ]
}

function cmAdapter(v) {
  return {
    kind: 'cm',
    view: v,
    alive: () => H.cmView() === v,
    snapshot: () => v.state.doc,
    blocks: () => mdBlocks(v.state.doc.toString()),
    setIssues: (list) => v.dispatch({ effects: setCmIssues.of(list) }),
    issues: () => v.state.field(cmField, false)?.issues || [],
    textAt: (a, b) => v.state.sliceDoc(a, b),
    replace(iss, text) {
      if (this.textAt(iss.from, iss.to) !== iss.problem) return false
      v.dispatch({ changes: { from: iss.from, to: iss.to, insert: text }, scrollIntoView: true })
      return true
    },
    select(iss) {
      v.dispatch({ selection: { anchor: iss.from, head: iss.to }, scrollIntoView: true })
    },
    coords: (pos) => v.coordsAtPos(pos),
    focus: () => v.focus(),
    redraw: () => v.dispatch({ effects: redrawCm.of(null) }),
    caret: () => v.state.selection.main.head,
    plainText: () => mdBlocks(v.state.doc.toString()).map((b) => b.text).join('\n\n'),
  }
}

// ════════════════════════════════════════ actions
function applyFix(ad, iss, text) {
  if (H.readonly()) {
    H.toast('Read-only mode is on (Ctrl+Shift+R)')
    return false
  }
  if (!ad.replace(iss, text)) {
    H.toast('The text changed; checking again…')
    refresh(0)
    return false
  }
  refresh(60)
  return true
}

function ignoreOnce(ad, iss) {
  if (iss.source) sources.find((src) => iss.source === src.id || iss.source.startsWith(src.id + ':'))?.ignore?.(iss)
  session.ignoreOnce.add(contextKey(iss))
  dropIssues(ad, (x) => x === iss)
}
function ignoreAll(ad, iss) {
  session.ignoreAll.add(allKey(iss))
  dropIssues(ad, (x) => allKey(x) === allKey(iss))
}
function addToDictionary(ad, iss) {
  const w = iss.problem.trim()
  const s = H.settings
  s.wcDictionary = [...new Set([...(s.wcDictionary || []), w])].sort((a, b) => a.localeCompare(b))
  H.saveSettings()
  dropIssues(ad, (x) => x.cat === 'spelling' && x.problem.toLowerCase() === w.toLowerCase())
  H.toast(`“${w}” added to the dictionary`)
}
function disableRule(ad, iss) {
  const s = H.settings
  s.wcDisabledRules = [...new Set([...(s.wcDisabledRules || []), iss.rule])]
  H.saveSettings()
  dropIssues(ad, (x) => x.rule === iss.rule)
  H.toast(`Turned off “${ruleLabel(iss)}” (Preferences → Writing to turn it back on)`, 2600)
}
function dropIssues(ad, pred) {
  ad.setIssues(ad.issues().filter((x) => !pred(x)))
}

const ruleLabel = (iss) =>
  iss.rule
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())

// ════════════════════════════════════════ right-click menu
let menuFor = null

function openIssueMenu(e, pos) {
  if (!on() || H.readonly()) return false
  const ad = adapter()
  const iss = ad?.issues().find((x) => pos >= x.from && pos <= x.to && x.to > x.from)
  if (!iss) return false
  e.preventDefault()
  e.stopPropagation()
  showIssueMenu(ad, iss, e.clientX, e.clientY)
  return true
}

function showIssueMenu(ad, iss, x, y, viaKeyboard = false) {
  const { el } = H
  const m = document.querySelector('#ctxmenu')
  m.innerHTML = ''
  m.dataset.owner = 'writing'
  const item = (label, fn, cls = '') => {
    const b = el('button', { class: 'menu-item ' + cls }, el('span', { class: 'lbl' }, label))
    b.onmousedown = (ev) => ev.preventDefault()
    b.onclick = () => {
      closeMenu()
      fn()
      ad.focus()
    }
    m.append(b)
    return b
  }
  m.append(el('div', { class: 'wc-menu-head' }, el('span', { class: `wc-tag wc-${iss.cat}` }, iss.kind), el('p', {}, iss.message)))
  const sugg = iss.sugg.slice(0, 7)
  if (sugg.length) for (const s of sugg) item(s.label || '(delete)', () => applyFix(ad, iss, s.text), 'wc-sugg')
  else m.append(el('div', { class: 'wc-none' }, 'No suggestions'))
  m.append(el('div', { class: 'menu-sep' }))
  item('Ignore', () => ignoreOnce(ad, iss))
  const src = iss.source && sources.find((x) => iss.source === x.id || iss.source.startsWith(x.id + ':'))
  if (src) for (const [label, fn] of src.menuExtras?.(iss) || []) item(label, () => (fn(), refresh(0)))
  else {
    item('Ignore All', () => ignoreAll(ad, iss))
    if (iss.cat === 'spelling') item('Add to Dictionary', () => addToDictionary(ad, iss))
    else if (iss.rule) item('Turn Off This Rule', () => disableRule(ad, iss))
  }
  m.append(el('div', { class: 'menu-sep' }))
  item('Spelling & Grammar…  F7', () => ((tab = iss.source ? 'ai' : 'wc'), openPanel(iss.id)))
  item('Writing Check Options…', () => H.openOptions())
  m.hidden = false
  m.style.minWidth = '240px'
  m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)) + 'px'
  m.style.top = Math.max(8, y + m.offsetHeight > innerHeight - 8 ? y - m.offsetHeight - 22 : y) + 'px'
  menuFor = { ad, iss }
  if (viaKeyboard) m.querySelector('.menu-item')?.classList.add('kb-active')
}

function closeMenu() {
  const m = document.querySelector('#ctxmenu')
  if (m.dataset.owner === 'writing') m.hidden = true
  menuFor = null
}

function menuKeys(e) {
  const m = document.querySelector('#ctxmenu')
  if (!menuFor || m.hidden || m.dataset.owner !== 'writing') {
    menuFor = null
    return
  }
  const items = [...m.querySelectorAll('.menu-item')]
  const at = items.findIndex((i) => i.classList.contains('kb-active'))
  const stop = () => {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    stop()
    const next = at < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items.forEach((i) => i.classList.remove('kb-active'))
    items[next].classList.add('kb-active')
  } else if (e.key === 'Enter' && at >= 0) {
    stop()
    items[at].click()
  } else if (e.key === 'Escape') {
    stop()
    closeMenu()
  } else if (!['Shift', 'Control', 'Alt'].includes(e.key)) closeMenu()
}

/** Alt+F7: jump to the next issue after the caret and show its suggestions. */
export function nextIssueMenu(onlySources = false) {
  if (!on()) return H.toast('Spelling & grammar checking is off (Preferences → Writing)')
  const ad = adapter()
  const list = (ad?.issues() || []).filter((x) => !onlySources || x.source)
  if (!list.length) return H.toast(onlySources ? 'No AI suggestions' : engineState === 'loading' ? 'Loading the writing checker…' : 'No spelling or grammar issues')
  const caret = ad.caret()
  const iss = list.find((x) => x.from > caret) || list[0]
  ad.select(iss)
  requestAnimationFrame(() => {
    const c = ad.coords(iss.from)
    showIssueMenu(ad, iss, c.left, c.bottom + 4, true)
  })
}

// ════════════════════════════════════════ status bar + review panel
let statusEl = null
export function writingStatus(el) {
  statusEl = el
  statusEl.onclick = () => togglePanel()
  publish()
}

function publish() {
  if (statusEl) {
    statusEl.hidden = !on()
    const n = issues.length
    statusEl.classList.toggle('has-issues', n > 0)
    statusEl.textContent = engineState === 'loading' && !n ? '◌ Checking' : engineState === 'error' ? '⚠ Check off' : n ? `✎ ${n}` : '✓'
    statusEl.title =
      engineState === 'error'
        ? `Writing check could not start: ${engineError}`
        : n
          ? `${n} spelling/grammar ${n === 1 ? 'issue' : 'issues'} — click or press F7 to review`
          : 'No spelling or grammar issues (F7)'
    const extra = panelSource()?.statusText?.()
    if (extra) statusEl.title += '\n' + extra
    const badge = panelSource()?.statusBadge?.()
    if (badge) statusEl.textContent += ' · ' + badge
  }
  if (panel && !panel.hidden) renderPanel()
}

let panel = null
let tab = 'wc' // review panel tab: 'wc' (spelling checker) | 'ai' (AI and MCP findings)
export const panelOpen = () => !!panel && !panel.hidden
/** A source with its own tab in the review panel (AI Writing Help), if it is on. */
const panelSource = () => sources.find((src) => src.panel && src.active())
const inTab = (x) => (tab === 'ai' ? !!x.source : !x.source)

/** F7 panel on the AI tab. */
export function openAiPanel() {
  tab = 'ai'
  panelOpen() ? renderPanel(true) : openPanel()
}

export function togglePanel() {
  panelOpen() ? closePanel(true) : openPanel()
}

function openPanel(id) {
  if (!on()) {
    H.toast('Spelling & grammar checking is off (Preferences → Writing)')
    return
  }
  if (!panel) {
    panel = H.el('aside', { id: 'wc-panel', tabindex: '-1' })
    panel.addEventListener('keydown', panelKeys)
    document.querySelector('#content').append(panel)
  }
  panel.hidden = false
  const ad = adapter()
  if (!panelSource()) tab = 'wc'
  const list = (ad?.issues() || []).filter(inTab)
  current = id || (list.find((x) => x.from >= (ad?.caret() ?? 0)) || list[0])?.id || null
  refresh(0)
  renderPanel(true)
  panel.focus()
}

export function closePanel(focusEditor) {
  if (!panel || panel.hidden) return
  panel.hidden = true
  current = null
  adapter()?.redraw()
  if (focusEditor) adapter()?.focus()
}

let shownId = null
function renderPanel(select = false) {
  const { el } = H
  const ad = adapter()
  const src = panelSource()
  if (!src) tab = 'wc'
  const all = ad?.issues() || []
  const list = all.filter(inTab)
  let idx = list.findIndex((x) => x.id === current)
  if (idx < 0 && list.length) {
    // the shown issue was fixed: continue with the one that took its place
    const caret = ad.caret()
    idx = Math.max(0, list.findIndex((x) => x.from >= caret))
    current = list[idx].id
    select = true
  }
  const iss = list[idx]
  panel.innerHTML = ''
  const close = el('button', { class: 'wc-x', title: 'Close (Esc)' }, '✕')
  close.onclick = () => closePanel(true)
  const count = list.length ? `${idx + 1} of ${list.length}` : ''
  if (src) {
    const tabBtn = (id, label) => {
      const n = all.filter((x) => (id === 'ai' ? !!x.source : !x.source)).length
      const b2 = el('button', { class: 'wc-tab' + (tab === id ? ' on' : ''), title: id === 'ai' ? 'Corrections and suggestions from your AI' : 'The offline spelling & grammar check' }, label + (n ? ` (${n})` : ''))
      b2.onclick = () => {
        tab = id
        current = null
        renderPanel(true)
        panel.focus()
      }
      return b2
    }
    panel.append(el('div', { class: 'wc-head' }, el('div', { class: 'wc-tabs' }, tabBtn('wc', 'Spelling & Grammar'), tabBtn('ai', 'AI')), close))
    if (count) panel.append(el('div', { class: 'wc-count wc-count-row' }, count))
  } else panel.append(el('div', { class: 'wc-head' }, el('b', {}, 'Spelling & Grammar'), el('span', { class: 'wc-count' }, count), close))
  const aiBox = () => src.panel({ blocks: () => ad.blocks(), caretBlock: () => checkContext(ad, ad.blocks()).caretBlock })

  if (!iss && tab === 'ai') {
    panel.append(el('div', { class: 'wc-done' }, el('div', { class: 'wc-check' }, '✓'), el('p', {}, 'No AI suggestions here.')), aiBox())
    shownId = null
    return
  }
  if (!iss) {
    const done = engineState === 'loading' ? 'Loading the checker…' : engineState === 'error' ? `The checker could not start: ${engineError}` : 'No spelling or grammar issues found.'
    panel.append(el('div', { class: 'wc-done' }, el('div', { class: 'wc-check' }, engineState === 'ready' ? '✓' : '…'), el('p', {}, done)))
    if (ad) panel.append(readabilityBox(ad.plainText()))
    panel.append(footer())
    shownId = null
    return
  }

  // sentence context with the problem highlighted
  const a = Math.max(0, iss.start - 60)
  const b = Math.min(iss.block.length, iss.end + 60)
  const ctx = el(
    'div',
    { class: 'wc-ctx' },
    (a > 0 ? '…' : '') + iss.block.slice(a, iss.start),
    el('mark', { class: `wc-${iss.cat}` }, iss.problem || ' '),
    iss.block.slice(iss.end, b) + (b < iss.block.length ? '…' : ''),
  )
  panel.append(el('div', { class: 'wc-kind' }, el('span', { class: `wc-tag wc-${iss.cat}` }, iss.kind)), el('p', { class: 'wc-msg' }, iss.message), ctx)

  const sg = el('div', { class: 'wc-suggs' })
  iss.sugg.slice(0, 9).forEach((s, i) => {
    const b2 = el('button', { class: 'wc-chip', title: `Change to this (${i + 1})` }, el('small', {}, String(i + 1)), s.label || '(delete)')
    b2.onclick = () => change(i)
    sg.append(b2)
  })
  if (!iss.sugg.length) sg.append(el('span', { class: 'wc-none' }, 'No suggestions'))
  panel.append(sg)

  const btn = (label, title, fn, cls = '') => {
    const x = el('button', { class: cls, title }, label)
    x.onclick = fn
    return x
  }
  const nav = (d) => () => {
    current = list[(idx + d + list.length) % list.length].id
    renderPanel(true)
  }
  panel.append(
    el(
      'div',
      { class: 'wc-actions' },
      iss.sugg.length ? btn('Change', 'Use the first suggestion (Enter)', () => change(0), 'primary') : null,
      btn('Ignore', 'Ignore this once (I)', () => act(ignoreOnce)),
      iss.source ? null : btn('Ignore All', 'Ignore everywhere in this session (A)', () => act(ignoreAll)),
      iss.source ? null : iss.cat === 'spelling' ? btn('Add to Dictionary', 'Never flag this word again (D)', () => act(addToDictionary)) : btn('Turn Off Rule', 'Stop checking for this (T)', () => act(disableRule)),
    ),
    el('div', { class: 'wc-nav' }, btn('‹ Previous', 'Previous issue (←)', nav(-1)), btn('Next ›', 'Next issue (→)', nav(1))),
    tab === 'ai' ? aiBox() : footer(),
  )
  if (select || shownId !== iss.id) {
    ad.redraw()
    ad.select(iss)
  }
  shownId = iss.id
}

function footer() {
  const { el } = H
  const s = H.settings
  const name = s.wcEngine === 'languagetool' ? `LanguageTool (${s.ltLanguage === 'auto' || !s.ltLanguage ? 'auto-detect' : s.ltLanguage})` : `Harper · ${(s.wcDialect || 'american').replace(/^./, (c) => c.toUpperCase())} English · offline`
  const opt = el('button', { class: 'wc-link' }, 'Options…')
  opt.onclick = () => H.openOptions()
  return el('div', { class: 'wc-foot' }, el('span', {}, name), opt)
}

function current_() {
  const ad = adapter()
  const iss = ad?.issues().find((x) => x.id === current)
  return [ad, iss]
}
function change(i) {
  const [ad, iss] = current_()
  if (!iss || !iss.sugg[i]) return
  current = null // continue with the issue after this one
  if (applyFix(ad, iss, iss.sugg[i].text)) setTimeout(() => panelOpen() && renderPanel(true), 120)
  panel.focus()
}
function act(fn) {
  const [ad, iss] = current_()
  if (!iss) return
  current = null
  fn(ad, iss)
  // continue with the first issue after the one just handled
  const list = ad.issues()
  current = (list.find((x) => x.from >= iss.to) || list[0])?.id ?? null
  renderPanel(true)
  panel.focus()
}

function panelKeys(e) {
  if (e.target.closest('input, textarea')) return
  const k = e.key
  const stop = () => {
    e.preventDefault()
    e.stopPropagation()
  }
  if (k === 'Escape') return stop(), closePanel(true)
  if (e.ctrlKey || e.altKey || e.metaKey) return
  if (k === 'Enter' && e.target.tagName !== 'BUTTON') return stop(), change(0)
  if (/^[1-9]$/.test(k)) return stop(), change(+k - 1)
  const map = { i: ignoreOnce, a: ignoreAll, d: addToDictionary, t: disableRule }
  if (map[k.toLowerCase()]) return stop(), act(map[k.toLowerCase()])
  if (k === 'ArrowRight' || k === 'ArrowDown' || k.toLowerCase() === 'n') return stop(), panel.querySelector('.wc-nav button:last-child')?.click()
  if (k === 'ArrowLeft' || k === 'ArrowUp' || k.toLowerCase() === 'p') return stop(), panel.querySelector('.wc-nav button:first-child')?.click()
}

// ════════════════════════════════════════ readability (shown when the document is clean)
export function readability(text) {
  const words = text.match(/\p{L}[\p{L}'’-]*/gu) || []
  const sentences = Math.max(1, (text.match(/[.!?]+(?=\s|$)|\n{2,}/g) || []).length)
  const syl = words.reduce((s, w) => s + syllables(w), 0)
  const wps = words.length / sentences
  const spw = syl / Math.max(1, words.length)
  return {
    words: words.length,
    sentences,
    wordsPerSentence: wps,
    ease: Math.max(0, Math.min(100, 206.835 - 1.015 * wps - 84.6 * spw)),
    grade: Math.max(0, 0.39 * wps + 11.8 * spw - 15.59),
  }
}
function syllables(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, '')
  if (w.length <= 3) return 1
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  return Math.max(1, (w.match(/[aeiouy]{1,2}/g) || []).length)
}
function readabilityBox(text) {
  const { el } = H
  const r = readability(text)
  if (r.words < 30) return el('span')
  const s = H.settings
  const english = s.wcEngine !== 'languagetool' || /^(auto|en)/.test(s.ltLanguage || 'auto')
  const label = r.ease >= 70 ? 'easy to read' : r.ease >= 50 ? 'fairly easy' : r.ease >= 30 ? 'fairly difficult' : 'difficult'
  const rows = [
    ['Words', r.words.toLocaleString()],
    ['Sentences', r.sentences.toLocaleString()],
    ['Words per sentence', r.wordsPerSentence.toFixed(1)],
  ]
  if (english) rows.push(['Reading ease', `${Math.round(r.ease)} · ${label}`], ['Grade level', r.grade.toFixed(1)])
  return el('div', { class: 'wc-read' }, el('h5', {}, 'Readability'), ...rows.map(([k, v]) => el('div', {}, el('span', {}, k), el('b', {}, v))))
}

/** Custom-dictionary editor body for the preferences dialog. */
export function dictionaryEditor() {
  const { el } = H
  const ta = el('textarea', { class: 'pref-css wc-dict', spellcheck: 'false', placeholder: 'One word per line' })
  ta.value = (H.settings.wcDictionary || []).join('\n')
  ta.onchange = () => {
    H.settings.wcDictionary = [...new Set(ta.value.split(/\r?\n/).map((w) => w.trim()).filter(Boolean))]
    H.saveSettings()
    refresh(0)
  }
  return ta
}
