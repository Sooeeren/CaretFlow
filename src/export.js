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
.callout{border-left:4px solid var(--c);background:color-mix(in srgb,var(--c) 8%,transparent);border-radius:0 6px 6px 0;padding:.55em 1em;color:var(--fg)}
.callout-title{font-weight:650;color:var(--c);margin:0 0 .3em}
.callout>:last-child{margin-bottom:0}
.callout-note{--c:#2f74d0}.callout-tip{--c:#2c9a4b}.callout-important{--c:#8250df}.callout-warning{--c:#b7791f}.callout-caution{--c:#cf3a33}`
const tex = (s, displayMode) => katex.renderToString(s, { displayMode, throwOnError: false })

marked.use({
  gfm: true,
  extensions: [
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
async function renderMermaidBlocks(html, dark) {
  if (!html.includes('language-mermaid')) return html
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' })
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

/**
 * @param md markdown source
 * @param o { title, docDir, targetDir, resolveForView, themeVars, dark, inlineKatex }
 */
export async function toHtml(md, o) {
  // Strip front matter (YAML or TOML)
  md = md.replace(/^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1[ \t]*(\r?\n|$)/, '')
  // Math code fences → display math
  md = md.replace(/^```(?:math|latex|tex|katex)\s*\n([\s\S]*?)\n```/gm, (_, s) => `$$\n${s}\n$$`)
  // the document's own HTML is kept, minus scripts and event handlers: the export page is
  // loaded by CaretFlow (print, PDF export, page preview), where a script could reach its commands
  let html = DOMPurify.sanitize(marked.parse(md))
  html = await renderMermaidBlocks(html, o.dark)
  html = await highlightBlocks(html)
  html = renderCallouts(html)

  // Rewrite relative image paths
  html = html.replace(/(<img[^>]*?\ssrc=")([^"]+)(")/g, (all, a, src, b) => {
    if (/^(https?:|data:|blob:|mailto:)/i.test(src)) return all
    const raw = decodeSrc(src)
    const abs = isAbs(raw) ? raw : o.docDir ? join(o.docDir, raw) : null
    if (!abs) return all
    if (o.resolveForView) return a + o.resolveForView(abs) + b
    const rel = o.targetDir ? relative(o.targetDir, abs) : null
    return a + (rel ? encodeSrc(rel) : 'file:///' + encodeSrc(abs)) + b
  })

  const katexLink = o.inlineKatex
    ? `<style>${katexCss}</style>`
    : `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css">`

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title || 'Document')}</title>
${katexLink}
<style>${highlightCss()}${CALLOUT_CSS}
div[style*="page-break-after"]{height:0;margin:0;border:0}</style>
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
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
code{font-family:var(--font-mono);font-size:.88em;background:var(--code-bg);color:var(--code-fg);padding:.1em .35em;border-radius:4px}
pre{background:var(--code-bg);padding:14px 16px;border-radius:6px;overflow:auto;line-height:1.5}
pre code{background:none;color:var(--fg);padding:0;font-size:.86em}
blockquote{margin:1em 0;padding:0 1.1em;color:var(--quote);border-left:3px solid var(--quote-bar)}
table{border-collapse:collapse;margin:1em 0;display:block;overflow:auto}
th,td{border:1px solid var(--border);padding:6px 13px}th{background:var(--chrome)}
tr:nth-child(2n) td{background:color-mix(in srgb,var(--chrome) 50%,transparent)}
img{max-width:100%}hr{border:0;border-top:1px solid var(--border);margin:2em 0}
li>input[type=checkbox]{margin-right:.4em}
.math-block{overflow-x:auto;margin:1em 0}.mermaid{text-align:center;margin:1em 0}
@media print{body{padding:0;max-width:none}pre,blockquote,table,img,.mermaid{break-inside:avoid}h1,h2,h3{break-after:avoid}}
${o.forPdf ? '' : '@page{margin:18mm 16mm}'}
${o.forPdf ? 'body{padding:0;max-width:none}' : ''}
</style></head>
<body>
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
