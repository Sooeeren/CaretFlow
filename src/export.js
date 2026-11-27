// HTML export / print (lazy-loaded)
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import katexCss from 'katex/dist/katex.min.css?inline'
import { languages } from '@codemirror/language-data'
import { LanguageDescription } from '@codemirror/language'
import { highlightCode } from '@lezer/highlight'
import { isAbs, join, relative, decodeSrc, encodeSrc } from './paths.js'
import { renderCallouts } from './blocks.js'
import { renderToc, TOC_CSS } from './toc.js'
import { codeStyle } from './codestyle.js'

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const unesc = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/**
 * Syntax-highlight fenced code blocks with the same Lezer parsers and highlight style (codestyle.js)
 * the editor's code blocks use, so exports/PDFs look like the editor. The colors come from the
 * --tok-* variables in themeVars.
 */
async function highlightBlocks(html) {
  const re = /<pre><code class="language-([\w+#.-]+)">([\s\S]*?)<\/code><\/pre>/g
  const parts = []
  let last = 0
  for (let m; (m = re.exec(html)); ) {
    const lang = m[1]
    if (lang === 'mermaid') continue
    const desc = LanguageDescription.matchLanguageName(languages, lang, true)
    if (!desc) continue
    let support
    try {
      support = await desc.load()
    } catch {
      continue
    }
    const code = unesc(m[2]).replace(/\n$/, '')
    const tree = support.language.parser.parse(code)
    let out = ''
    highlightCode(
      code,
      tree,
      codeStyle,
      (text, classes) => (out += classes ? `<span class="${classes}">${esc(text)}</span>` : esc(text)),
      () => (out += '\n'),
    )
    parts.push(html.slice(last, m.index), `<pre><code class="language-${lang}">${out}\n</code></pre>`)
    last = m.index + m[0].length
  }
  parts.push(html.slice(last))
  return parts.join('')
}
const highlightCss = () => codeStyle.module?.getRules() || ''

const CALLOUT_CSS = `
.callout{border-left:4px solid var(--c);background:color-mix(in srgb,var(--c) 9%,transparent);border-radius:0 8px 8px 0;padding:.5em 1em .5em calc(1.1em - 4px);color:var(--fg)}
.callout-title{font-weight:650;color:var(--c);margin:.15em 0 0}
.callout-title+*{margin-top:0}
.callout>:last-child{margin-bottom:.15em}
.callout-note{--c:#2f74d0}.callout-tip{--c:#2c9a4b}.callout-important{--c:#8250df}.callout-warning{--c:#b7791f}.callout-caution{--c:#cf3a33}`

// Same disallowed elements as html.js (no scripts, styles, forms or frames), while keeping id/class
// needed by headings, footnotes, KaTeX and code blocks in the standalone export document
const EXPORT_PURIFY = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'dialog'],
  FORBID_ATTR: ['autofocus', 'contenteditable', 'tabindex', 'popover'],
}

const STYLE_ZOOM = /^\s*zoom\s*:\s*(\d+(?:\.\d+)?)\s*(%?)\s*;?\s*$/i
const MISSING_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>'

/** Same rule as imagesize.js parseImgTag: a lone `<img …>` with only a zoom or pixel width, centered like .milkdown-image-block. */
function isBlockImgTag(html) {
  const t = html.trim()
  if (!/^<img\b[^<>]*\/?>$/i.test(t)) return false
  const img = new DOMParser().parseFromString(t, 'text/html').body.firstElementChild
  if (!img || img.tagName !== 'IMG' || !img.getAttribute('src')) return false
  if ([...img.attributes].some((a) => !['src', 'alt', 'title', 'style', 'width'].includes(a.name))) return false
  const w = img.getAttribute('width')
  if (w != null) {
    const m = w.trim().match(/^(\d+)(px)?$/i)
    if (!m || +m[1] < 1) return false
  }
  const st = img.getAttribute('style')
  if (st != null && st.trim() && !STYLE_ZOOM.test(st)) return false
  return !(w != null && st != null && st.trim())
}

// How math is written: 'html' (KaTeX, for the screen and PDF), 'mathml' (e-book readers), or
// 'source' (the TeX kept in a data attribute, for the Word / OpenDocument / LaTeX writers)
let mathMode = 'html'
const tex = (s, displayMode) =>
  mathMode === 'source'
    ? `<span class="math-src${displayMode ? ' display' : ''}" data-tex="${esc(s)}"></span>`
    : katex.renderToString(s, { displayMode, throwOnError: false, output: mathMode === 'mathml' ? 'mathml' : 'htmlAndMathml' })

// Footnotes ([^1] … [^1]: text), which marked doesn't read: numbered in the order the text first
// refers to them (named ones like [^note] too, as on GitHub and in the editor), with the notes in a
// list at the end. Word, OpenDocument, EPUB, LaTeX and plain text get them from this HTML too.
let notes = null // { num: Map label → n, html: Map label → html } while one document is turned into HTML
const noteNum = (label) => {
  if (!notes.num.has(label)) notes.num.set(label, notes.num.size + 1)
  return notes.num.get(label)
}
const noteId = (label) => String(label).toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-')
function footnotesHtml() {
  if (!notes?.num.size) return ''
  const items = [...notes.num]
    .sort((a, b) => a[1] - b[1])
    .map(([label]) => `<li id="fn-${esc(noteId(label))}">${notes.html.get(label) ?? ''} <a href="#fnref-${esc(noteId(label))}" class="fn-back">↩</a></li>`)
  return `<section class="footnotes"><hr><ol>${items.join('')}</ol></section>`
}

marked.use({
  gfm: true,
  renderer: {
    // GFM task boxes become a marker before DOMPurify runs, so user <input>/<form> HTML is stripped without losing task lists
    checkbox({ checked }) {
      return `<span data-cf-task="${checked ? 1 : 0}"></span>`
    },
    // Standalone Markdown images and resized <img …> lines are centered in the rendered editor (.milkdown-image-block)
    paragraph({ tokens }) {
      const cls =
        tokens.length === 1 && (tokens[0].type === 'image' || (tokens[0].type === 'html' && isBlockImgTag(tokens[0].text)))
          ? ' class="cf-img"'
          : ''
      return `<p${cls}>${this.parser.parseInline(tokens)}</p>\n`
    },
    html({ text, block }) {
      return block && isBlockImgTag(text) ? `<p class="cf-img">${text.trim()}</p>\n` : text
    },
  },
  extensions: [
    {
      name: 'footnoteDef',
      level: 'block',
      start(src) {
        const m = /^\[\^[^\]\s]+\]:/m.exec(src)
        return m ? m.index : undefined
      },
      tokenizer(src) {
        // the note's first line, and lines indented below it
        const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?:[ \t]{2,}|\t)[^\n]*)*)(?:\n|$)/.exec(src)
        if (!m) return
        return { type: 'footnoteDef', raw: m[0], label: m[1], tokens: this.lexer.inlineTokens(m[2].replace(/\n[ \t]+/g, ' ').trim()) }
      },
      renderer(tok) {
        if (notes) {
          noteNum(tok.label)
          notes.html.set(tok.label, this.parser.parseInline(tok.tokens))
        }
        return ''
      },
    },
    {
      name: 'footnoteRef',
      level: 'inline',
      start(src) {
        const i = src.indexOf('[^')
        return i >= 0 ? i : undefined
      },
      tokenizer(src) {
        const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src)
        if (m) return { type: 'footnoteRef', raw: m[0], label: m[1] }
      },
      renderer(tok) {
        if (!notes) return esc(tok.raw)
        const n = noteNum(tok.label)
        const id = esc(noteId(tok.label))
        return `<sup class="fn-ref"><a href="#fn-${id}" id="fnref-${id}">${n}</a></sup>`
      },
    },
    {
      name: 'mathBlock',
      level: 'block',
      start(src) {
        const i = src.indexOf('$$')
        return i >= 0 ? i : undefined
      },
      tokenizer(src) {
        const m = /^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n|$)/.exec(src)
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() }
      },
      renderer: (tok) => `<div class="math-block">${tex(tok.text, true)}</div>\n`,
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src) {
        const i = src.indexOf('$')
        return i >= 0 ? i : undefined
      },
      tokenizer(src) {
        const m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)\$(?!\d)/.exec(src)
        if (m) return { type: 'mathInline', raw: m[0], text: m[1] }
      },
      renderer: (tok) => tex(tok.text, false),
    },
  ],
})

let mmId = 0
async function renderMermaidBlocks(html, dark, plainLabels) {
  if (!html.includes('language-mermaid')) return html
  const { default: mermaid } = await import('mermaid')
  // plainLabels: SVG text instead of HTML labels, so the diagram can be drawn into a canvas
  // (a <foreignObject> would taint it) and shown by e-book readers
  const labels = plainLabels ? { htmlLabels: false, flowchart: { htmlLabels: false } } : { htmlLabels: true, flowchart: { htmlLabels: true } }
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict', ...labels })
  const re = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g
  const parts = []
  let last = 0
  for (let m; (m = re.exec(html)); ) {
    parts.push(html.slice(last, m.index))
    const code = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    try {
      const { svg } = await mermaid.render('exmmd' + ++mmId, code)
      parts.push(`<div class="mermaid">${svg}</div>`)
    } catch {
      parts.push(m[0])
    }
    last = m.index + m[0].length
  }
  parts.push(html.slice(last))
  return parts.join('')
}

const FRONT_MATTER = /^(---|\+\+\+)\r?\n([\s\S]*?)\r?\n\1[ \t]*(\r?\n|$)/

/** title / author / date / … from the simple `key: value` lines of the front matter */
export function frontMatter(md) {
  const m = FRONT_MATTER.exec(md)
  const out = {}
  if (!m) return out
  const unquote = (v) => v.trim().replace(/^(["'])(.*)\1$/, '$2')
  for (const line of m[2].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*)\s*[:=]\s*(.*)$/.exec(line)
    if (!kv) continue
    let v = unquote(kv[2])
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(unquote).join(', ')
    if (v) out[kv[1].toLowerCase()] = v
  }
  return out
}

/**
 * The document as HTML without a page around it: front matter left out; math, diagrams, code
 * colors and callouts done. o: { dark, math: 'html' | 'mathml' | 'source', plainLabels }
 */
export async function bodyHtml(md, o = {}) {
  md = md.replace(FRONT_MATTER, '')
  // Math code fences → display math
  md = md.replace(/^```(?:math|latex|tex|katex)\s*\n([\s\S]*?)\n```/gm, (_, s) => `$$\n${s}\n$$`)
  mathMode = o.math || 'html'
  let html
  try {
    notes = { num: new Map(), html: new Map() }
    // footnotes are numbered in the order of the references: the notes' own order doesn't count
    const refs = new Set()
    for (const m of md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').matchAll(/\[\^([^\]\s]+)\](?!:)/g)) refs.add(m[1])
    for (const r of refs) noteNum(r)
    // the document's own HTML is kept, minus scripts, forms, frames and event handlers: the export
    // page is loaded by CaretFlow (print, PDF export, page preview), and must match the editor
    html = DOMPurify.sanitize(marked.parse(md) + footnotesHtml(), EXPORT_PURIFY)
  } finally {
    mathMode = 'html'
    notes = null
  }
  html = await renderMermaidBlocks(html, o.dark, o.plainLabels)
  html = await highlightBlocks(html)
  // restore GFM task check boxes, with no space after them: the box sits where the bullet would be (like the editor)
  html = html.replace(/<span data-cf-task="([01])"><\/span>[ \t]*/g, (_, c) => `<input ${c === '1' ? 'checked="" ' : ''}disabled="" type="checkbox">`)
  return renderToc(renderCallouts(html))
}

export { highlightCss }

/** Short path for a missing-image box (same tail as imageview.js shortSrc). */
function shortImgSrc(s = '') {
  if (!s) return 'missing path'
  if (/^data:/i.test(s)) return 'embedded image'
  try {
    s = decodeURIComponent(s)
  } catch {}
  if (/^(https?:)?\/\//i.test(s) && !/asset\.localhost/i.test(s)) return s
  return s.split(/[\\/]/).filter(Boolean).slice(-2).join('/') || s
}

function missingImgSpan(doc, src) {
  const span = doc.createElement('span')
  span.className = 'cf-img-missing'
  span.innerHTML = MISSING_ICON
  const txt = doc.createElement('span')
  txt.textContent = `Image not found: ${shortImgSrc(src)}`
  span.append(txt)
  return span
}

async function rewriteImages(html, o) {
  if (!html.includes('<img')) return html
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const doc = tpl.content.ownerDocument
  await Promise.all(
    [...tpl.content.querySelectorAll('img')].map(async (img) => {
      const src = img.getAttribute('src') || ''
      if (!src) {
        img.replaceWith(missingImgSpan(doc, ''))
        return
      }
      // above 100 % zoom, still never wider than the page (matches style.css .cf-zoomed)
      const zm = (img.getAttribute('style') || '').match(STYLE_ZOOM)
      if (zm) {
        const z = zm[2] ? +zm[1] / 100 : +zm[1]
        if (z > 1) img.style.maxWidth = `${100 / z}%`
      }
      if (/^(https?:|data:|blob:|mailto:)/i.test(src)) return
      const raw = decodeSrc(src)
      const abs = isAbs(raw) ? raw : o.docDir ? join(o.docDir, raw) : null
      if (!abs) {
        if (o.resolveForView) img.replaceWith(missingImgSpan(doc, raw))
        return
      }
      if (o.imageExists && !(await o.imageExists(abs))) {
        img.replaceWith(missingImgSpan(doc, raw))
        return
      }
      if (o.resolveForView) {
        img.setAttribute('src', o.resolveForView(abs))
        return
      }
      const rel = o.targetDir ? relative(o.targetDir, abs) : null
      img.setAttribute('src', rel ? encodeSrc(rel) : 'file:///' + encodeSrc(abs))
    }),
  )
  return tpl.innerHTML
}

/**
 * @param md markdown source
 * @param o { title, docDir, targetDir, resolveForView, imageExists, themeVars, dark, inlineKatex }
 */
/** Classes on the exported <body>: the same switches as the editor's (nested lists, wrapped code). */
function bodyClass(o) {
  const c = [o.nestedLists && 'nested-lists', o.wrapCode && 'wrap-code'].filter(Boolean).join(' ')
  return c ? ` class="${c}"` : ''
}

export async function toHtml(md, o) {
  let html = await bodyHtml(md, o)
  html = await rewriteImages(html, o)

  const katexLink = o.inlineKatex
    ? `<style>${katexCss}</style>`
    : `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css">`
  // Temporary PDF pages also replace web or unreadable images that fail at load time, before print-to-PDF runs
  const pdfBrokenImg = o.forPdf
    ? `<script>addEventListener('error',e=>{const i=e.target;if(i?.tagName!=='IMG')return;let u=i.getAttribute('src')||'';if(/^data:/i.test(u))u='embedded image';else{try{u=decodeURIComponent(u)}catch{}if(!/^(https?:)?\\/\\//i.test(u)||/asset\\.localhost/i.test(u))u=u.split(/[\\\\/]/).filter(Boolean).slice(-2).join('/')||u}const s=document.createElement('span');s.className='cf-img-missing';s.innerHTML='${MISSING_ICON}';const t=document.createElement('span');t.textContent='Image not found: '+(u||'missing path');s.append(t);i.replaceWith(s)},true)</script>`
    : ''

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title || 'Document')}</title>${pdfBrokenImg}
${katexLink}
<style>${highlightCss()}${CALLOUT_CSS}${TOC_CSS}
div[style*="page-break-after"]{height:0;margin:0;border:0}
.fn-ref{font-size:.75em;line-height:0}.fn-ref a{padding:0 1px}.footnotes{font-size:.92em;color:var(--muted);margin-top:2em}.footnotes hr{margin-bottom:.6em}.footnotes ol{padding-left:1.6em}.footnotes li{padding:.1em 0}.fn-back{text-decoration:none}</style>
<style>
:root{${o.themeVars}}
html{background:var(--bg);color:var(--fg)}
body{font-family:var(--doc-font);font-size:var(--doc-size);line-height:var(--doc-lh);max-width:var(--doc-width);margin:0 auto;padding:48px 32px 80px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4,h5,h6{color:var(--fg-strong);line-height:1.3;margin:calc(var(--doc-size)*1.4*var(--heading-space,1)) 0 0;font-weight:650}
:is(h1,h2,h3,h4,h5,h6)+*{margin-top:calc(var(--doc-size)*.5*var(--heading-space,1))!important}
h1{font-size:2.15em;border-bottom:1px solid var(--border);padding-bottom:.25em}
h2{font-size:1.65em;border-bottom:1px solid var(--border);padding-bottom:.2em}
h3{font-size:1.35em}h4{font-size:1.15em}h6{color:var(--muted)}
body>:first-child{margin-top:0}
/* the same spacing as the rendered editor (style.css #wysiwyg …), so the page preview and PDF match it */
p{margin:.8em 0}
ul,ol{margin:0;padding-left:34px}li{padding:.2em 0}li>p{margin:0}
li:has(>input[type=checkbox],>p:first-child>input[type=checkbox]){list-style:none}
li>:is(ul,ol){margin-top:.2em}li:has(>ul,>ol){padding-bottom:0}
.nested-lists :is(ul,ol) :is(ul,ol){font-size:.96em}
.nested-lists ul ul{list-style-type:circle}.nested-lists ul ul ul{list-style-type:square}
.nested-lists ol ol{list-style-type:lower-alpha}.nested-lists ol ol ol{list-style-type:lower-roman}
.nested-lists :is(ul,ol) :is(ul,ol) li::marker{color:var(--muted)}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
code{font-family:var(--font-mono);font-size:.88em;background:var(--code-bg);color:var(--code-fg);padding:.1em .35em;border-radius:4px}
pre{background:var(--code-bg);padding:12px 16px;border-radius:8px;overflow:auto;margin:1em 0;line-height:calc(var(--doc-size)*1.4)}
pre code{background:none;color:var(--fg);padding:0;font-size:.88em}
.wrap-code pre,.wrap-code pre code{white-space:pre-wrap;overflow-wrap:anywhere}
blockquote{margin:.9em 0;padding:0 0 0 calc(1.1em - 3px);color:var(--quote);border-left:3px solid var(--quote-bar)}
table{border-collapse:collapse;margin:1em 0;width:100%;table-layout:fixed;overflow-wrap:anywhere}
th,td{border:1px solid var(--border);padding:6px 13px;line-height:1.5}th:not([align]){text-align:left}th{background:var(--chrome)}
tr:nth-child(2n) td{background:color-mix(in srgb,var(--chrome) 50%,transparent)}
img{max-width:100%}.cf-img{text-align:center}[align=left] .cf-img{text-align:left}[align=right] .cf-img{text-align:right}.cf-img>img{vertical-align:middle}li>img:only-child{display:block;margin:0 auto}
.cf-img-missing{display:inline-flex;align-items:center;gap:8px;padding:8px 13px;border:1px dashed var(--border);border-radius:6px;color:var(--muted);background:var(--code-bg);font:.85em/1.4 var(--font-ui,system-ui,sans-serif);text-align:left;overflow-wrap:anywhere;max-width:100%;box-sizing:border-box}.cf-img-missing svg{flex:none}
hr{border:0;height:1px;padding:6px 0;margin:0;background:var(--border);background-clip:content-box;box-sizing:content-box}
li>input[type=checkbox],li>p:first-child>input[type=checkbox]{width:18px;height:18px;margin:0 16px 0 -34px;vertical-align:-.2em}
.math-block{overflow-x:auto;margin:1em 0}.mermaid{text-align:center;margin:1em 0}
@media print{body{padding:0;max-width:none}pre,blockquote,table,img,.mermaid,.cf-img-missing{break-inside:avoid}h1,h2,h3{break-after:avoid}}
${o.forPdf ? '' : '@page{margin:18mm 16mm}'}
${o.forPdf ? 'body{padding:0;max-width:none}' : ''}
</style></head>
<body${bodyClass(o)}>
${html}
</body></html>`
}

export function printHtml(html) {
  return new Promise((resolve) => {
    const f = document.createElement('iframe')
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    // the page holds the document's own HTML, unfiltered: no scripts, so a file with
    // <img onerror=…> can't reach CaretFlow's commands (same origin, for print() from here)
    f.sandbox = 'allow-same-origin allow-modals'
    document.body.appendChild(f)
    f.onload = () => {
      setTimeout(() => {
        try {
          f.contentWindow.focus()
          f.contentWindow.print()
        } finally {
          setTimeout(() => {
            f.remove()
            resolve()
          }, 1000)
        }
      }, 250)
    }
    f.srcdoc = html
  })
}
