// Source-code mode: a lean CodeMirror 6 markdown editor (lazy-loaded).
import { EditorView, keymap, drawSelection, highlightActiveLine, dropCursor, highlightSpecialChars } from '@codemirror/view'
import { EditorState, EditorSelection, Compartment } from '@codemirror/state'
import { vim, getCM, Vim } from '@replit/codemirror-vim'
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language'
import {
  search,
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  highlightSelectionMatches,
} from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { codeStyle } from './codestyle.js'

const style = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', fontSize: '1.35em', color: 'var(--fg-strong)' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.2em', color: 'var(--fg-strong)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--fg-strong)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--fg-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--link)' },
  { tag: t.monospace, color: 'var(--code-fg)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.labelName], color: 'var(--muted)' },
  { tag: t.quote, color: 'var(--quote)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--accent)' },
])

/** Register Vim ex commands (:w, :q, …) once. `h` = { save, close, forceClose, toggleMode, quickOpen, open } */
let exDefined = false
export function defineVimCommands(h) {
  if (exDefined) return
  exDefined = true
  const bang = (p) => /!/.test(p?.argString || '') || p?.bang
  Vim.defineEx('write', 'w', async (_cm, p) => {
    const arg = (p?.argString || '').trim()
    if (arg && arg !== '!') await h.saveAs(arg)
    else await h.save()
  })
  Vim.defineEx('quit', 'q', (_cm, p) => (bang(p) ? h.forceClose() : h.close()))
  Vim.defineEx('wq', 'wq', async () => {
    if (await h.save()) h.forceClose()
  })
  Vim.defineEx('xit', 'x', async () => {
    if (await h.save()) h.forceClose()
  })
  Vim.defineEx('edit', 'e', (_cm, p) => {
    const arg = (p?.argString || '').trim()
    arg ? h.open(arg) : h.quickOpen()
  })
  Vim.defineEx('preview', 'pre', () => h.toggleMode())
  Vim.defineEx('wysiwyg', 'wys', () => h.toggleMode())

  // Visual-mode number increment, missing from the Vim plugin:
  //   {Visual}CTRL-A / CTRL-X   add/subtract [count] to the first number on every selected line
  //   {Visual}g CTRL-A / g CTRL-X   progressive: line n gets n×[count]
  Vim.defineAction('folioVisualIncrement', visualIncrement)
  for (const [keys, increase, progressive] of [
    ['<C-a>', true, false],
    ['<C-x>', false, false],
    ['g<C-a>', true, true],
    ['g<C-x>', false, true],
  ])
    Vim.mapCommand(keys, 'action', 'folioVisualIncrement', { increase, progressive }, { context: 'visual', isEdit: true })
}

const posLess = (a, b) => a.line < b.line || (a.line === b.line && a.ch < b.ch)

export function visualIncrement(cm, args, vimState) {
  const step = BigInt((args.increase ? 1 : -1) * (args.repeat || 1))
  // One segment (line + column range) per selected line. Block mode yields one range per line.
  const byLine = new Map()
  for (const r of cm.listSelections()) {
    const [from, to] = posLess(r.head, r.anchor) ? [r.head, r.anchor] : [r.anchor, r.head]
    for (let ln = from.line; ln <= to.line; ln++) {
      const len = cm.getLine(ln).length
      const s = vimState.visualLine ? 0 : ln === from.line ? from.ch : 0
      const e = vimState.visualLine ? len : ln === to.line ? Math.max(to.ch, s + 1) : len
      if (!byLine.has(ln)) byLine.set(ln, { ln, s, e })
    }
  }
  const segs = [...byLine.values()].sort((a, b) => a.ln - b.ln)
  if (!segs.length) return
  let k = 0
  cm.operation(() => {
    for (const g of segs) {
      const text = cm.getLine(g.ln)
      const m = /(-?)(\d+)/.exec(text.slice(g.s, g.e))
      if (!m) continue
      k++
      const numStart = g.s + m.index + m[1].length
      // a '-' directly after a word character is not a sign (e.g. "item-3")
      const neg = m[1] === '-' && !(numStart - 1 > 0 && /\w/.test(text[numStart - 2]))
      const value = (neg ? -1n : 1n) * BigInt(m[2]) + step * BigInt(args.progressive ? k : 1)
      let digits = (value < 0n ? -value : value).toString()
      if (m[2].length > 1 && m[2][0] === '0') digits = digits.padStart(m[2].length, '0')
      const from = neg ? numStart - 1 : numStart
      cm.replaceRange((value < 0n ? '-' : '') + digits, { line: g.ln, ch: from }, { line: g.ln, ch: numStart + m[2].length })
    }
  })
  Vim.exitVisualMode(cm, false)
  cm.setCursor({ line: segs[0].ln, ch: segs[0].s })
}

export function createSource(parent, { text, onChange, onSelection, vim: vimOn = false, onVimMode, extensions = [] }) {
  const vimSlot = new Compartment()
  let vimListener = null
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        vimSlot.of(vimOn ? vim({ status: false }) : []), // must precede other keymaps
        // Vim visual-block mode (and block insert) is built on multiple selections
        EditorState.allowMultipleSelections.of(true),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(style),
        syntaxHighlighting(codeStyle), // code inside fences: same colors as code blocks and exports
        search({ top: true, createPanel: () => ({ dom: document.createElement('span') }) }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        extensions,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange?.(u.state.doc.toString())
          if (u.selectionSet || u.docChanged) onSelection?.(u)
        }),
      ],
    }),
  })

  const attachVim = () => {
    const cm = getCM(view)
    if (!cm || vimListener) return
    vimListener = (e) => onVimMode?.(e.mode === 'visual' && e.subMode ? `visual ${e.subMode}` : e.mode)
    cm.on('vim-mode-change', vimListener)
    onVimMode?.('normal')
  }
  if (vimOn) attachVim()

  const api = {
    view,
    vimOn: () => vimOn,
    setVim(on) {
      if (on === vimOn) return
      vimOn = on
      vimListener = null
      view.dispatch({ effects: vimSlot.reconfigure(on ? vim({ status: false }) : []) })
      if (on) attachVim()
      else onVimMode?.(null)
    },
    /** true when Vim is in normal/visual mode (not inserting) */
    vimNormal() {
      const st = vimOn && getCM(view)?.state.vim
      return !!st && !st.insertMode
    },
    getText: () => view.state.doc.toString(),
    setText(s) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s } })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    undo: () => undo(view),
    redo: () => redo(view),

    // ── editing helpers ──
    wrap(before, after = before) {
      const { state } = view
      view.dispatch(
        state.changeByRange((r) => {
          const text = state.sliceDoc(r.from, r.to)
          const outer = state.sliceDoc(r.from - before.length, r.to + after.length)
          if (outer.startsWith(before) && outer.endsWith(after) && r.from >= before.length) {
            return {
              changes: [
                { from: r.from - before.length, to: r.from },
                { from: r.to, to: r.to + after.length },
              ],
              range: EditorSelection.range(r.from - before.length, r.to - before.length),
            }
          }
          return {
            changes: { from: r.from, to: r.to, insert: before + text + after },
            range: EditorSelection.range(r.from + before.length, r.to + before.length),
          }
        }),
      )
      view.focus()
    },
    linePrefix(prefix, re) {
      const { state } = view
      const changes = []
      const seen = new Set()
      for (const r of state.selection.ranges) {
        for (let pos = r.from; pos <= r.to; ) {
          const line = state.doc.lineAt(pos)
          if (!seen.has(line.number)) {
            seen.add(line.number)
            const m = re.exec(line.text)
            const cur = m ? m[0] : ''
            const next = cur === prefix ? '' : prefix
            changes.push({ from: line.from, to: line.from + cur.length, insert: next })
          }
          pos = line.to + 1
        }
      }
      view.dispatch({ changes })
      view.focus()
    },
    insert(text) {
      view.dispatch(view.state.replaceSelection(text))
      view.focus()
    },
    selectedText() {
      const r = view.state.selection.main
      return view.state.sliceDoc(r.from, r.to)
    },
    gotoLine(n) {
      const line = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)))
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 60 }) })
      view.focus()
    },
    cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    lineTop(n) {
      const line = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)))
      return view.lineBlockAt(line.from).top
    },
    centerCursor(scroller) {
      const c = view.coordsAtPos(view.state.selection.main.head)
      if (!c) return
      const r = scroller.getBoundingClientRect()
      scroller.scrollTop += c.top - (r.top + r.height / 2)
    },

    // ── search ──
    search(q, opts) {
      const query = new SearchQuery({
        search: q,
        caseSensitive: !!opts.cs,
        regexp: !!opts.regex,
        wholeWord: !!opts.word,
        replace: opts.replace ?? '',
      })
      view.dispatch({ effects: setSearchQuery.of(query) })
      return query
    },
    countMatches(query) {
      if (!query.search || !query.valid) return { total: 0, index: -1 }
      const sel = view.state.selection.main
      let total = 0
      let index = -1
      const cur = query.getCursor(view.state)
      for (let r = cur.next(); !r.done; r = cur.next()) {
        if (r.value.from === sel.from && r.value.to === sel.to) index = total
        total++
        if (total > 9999) break
      }
      return { total, index }
    },
    findNext: () => findNext(view),
    findPrev: () => findPrevious(view),
    replaceNext: () => replaceNext(view),
    replaceAll: () => replaceAll(view),
  }
  return api
}
