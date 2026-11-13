// LaTeX and plain-text export (lazy), written from the document model (docmodel.js).
import { runsText } from './docmodel.js'

const CALLOUT_COLORS = { note: '2F74D0', tip: '2C9A4B', important: '8250DF', warning: 'B7791F', caution: 'CF3A33' }

// ════════════════════════════════════════ LaTeX
const TEX_ESC = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '&': '\\&', '#': '\\#', '^': '\\textasciicircum{}', _: '\\_', '%': '\\%', '~': '\\textasciitilde{}' }
const tesc = (s) => s.replace(/[\\{}$&#^_%~]/g, (c) => TEX_ESC[c])
const urlEsc = (s) => s.replace(/[\\%#{}]/g, (c) => '\\' + c)
const label = (id) => id.replace(/[^A-Za-z0-9:._-]/g, '-')

class TexWriter {
  constructor(o) {
    this.o = o
    this.shift = 0 // heading levels to move up when the only h1 became the title
  }

  runs(runs) {
    let out = ''
    for (const r of runs) {
      if (r.br) out += '\\\\\n'
      else if (r.math !== undefined) out += `$${r.math}$`
      else if (r.img || r.imgMissing !== undefined) {
        const path = r.src && this.o.imagePath?.(r.src)
        out += path ? `\\includegraphics[max width=\\linewidth]{${path.replace(/\\/g, '/')}}` : `[${tesc(r.img?.alt || r.imgMissing || 'image')}]`
      } else {
        let t = tesc(r.text)
        if (r.code) t = `\\texttt{${t}}`
        if (r.b) t = `\\textbf{${t}}`
        if (r.i) t = `\\emph{${t}}`
        if (r.u) t = `\\uline{${t}}`
        if (r.s) t = `\\sout{${t}}`
        if (r.sub) t = `\\textsubscript{${t}}`
        if (r.sup) t = `\\textsuperscript{${t}}`
        if (r.mark) t = `\\colorbox{yellow}{${t}}`
        if (r.link) t = r.link.startsWith('#') ? `\\hyperref[${label(r.link.slice(1))}]{${t}}` : `\\href{${urlEsc(r.link)}}{${t}}`
        out += t
      }
    }
    return out.replace(/^(\\\\\n)+/, '')
  }

  blocks(blocks) {
    return blocks.map((b) => this.block(b)).filter(Boolean).join('\n\n')
  }

  block(b) {
    switch (b.t) {
      case 'h': {
        const cmd = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph'][Math.max(0, b.level - 1 - this.shift)]
        return `\\${cmd}{${this.runs(b.runs)}}\\label{${label(b.id)}}`
      }
      case 'p': {
        const t = this.runs(b.runs)
        return b.align === 'center' ? `\\begin{center}\n${t}\n\\end{center}` : t
      }
      case 'math':
        return `\\[\n${b.tex}\n\\]`
      case 'code':
        return `\\begin{verbatim}\n${b.lines.map((l) => l.map((r) => r.text).join('')).join('\n')}\n\\end{verbatim}`
      case 'hr':
        return '\\noindent\\rule{\\linewidth}{0.4pt}'
      case 'pagebreak':
        return '\\newpage'
      case 'quote': {
        const title = b.callout ? `\\textbf{\\textcolor[HTML]{${CALLOUT_COLORS[b.callout]}}{${tesc(b.title || '')}}}\n\n` : ''
        return `\\begin{quote}\n${title}${this.blocks(b.blocks)}\n\\end{quote}`
      }
      case 'list': {
        const env = b.ordered && !b.task ? 'enumerate' : 'itemize'
        this.depth = (this.depth || 0) + 1
        const counter = ['enumi', 'enumii', 'enumiii', 'enumiv'][Math.min(this.depth, 4) - 1]
        const start = env === 'enumerate' && b.start !== 1 ? `\\setcounter{${counter}}{${b.start - 1}}\n` : ''
        const items = b.items.map((it) => {
          const mark = it.check === null ? '' : it.check ? '[$\\boxtimes$]' : '[$\\square$]'
          return `\\item${mark} ${this.blocks(it.blocks)}`
        })
        this.depth--
        return `\\begin{${env}}\n${start}${items.join('\n')}\n\\end{${env}}`
      }
      case 'table': {
        const n = b.align.length
        const w = (0.96 / n).toFixed(3)
        const col = (a) => `>{${{ center: '\\centering', right: '\\raggedleft' }[a] || '\\raggedright'}\\arraybackslash}p{${w}\\linewidth}`
        const row = (r, head) => r.map((c) => (head ? `\\textbf{${this.runs(c)}}` : this.runs(c))).join(' & ') + ' \\\\'
        return (
          `\\begin{longtable}{@{}${b.align.map(col).join('')}@{}}\n\\toprule\n` +
          (b.head ? `${row(b.head, true)}\n\\midrule\n\\endhead\n` : '') +
          b.rows.map((r) => row(r, false)).join('\n') +
          '\n\\bottomrule\n\\end{longtable}'
        )
      }
    }
    return ''
  }
}

/** model → a LaTeX document (compiles with pdfLaTeX, XeLaTeX and LuaLaTeX). o: { page, meta, imagePath(src) } */
export function toLatex(model, o = {}) {
  const meta = { ...model.meta, ...Object.fromEntries(Object.entries(o.meta || {}).filter(([, v]) => v)) }
  const w = new TexWriter(o)
  let blocks = model.blocks
  let title = model.fmTitle ? tesc(meta.title) : ''
  // a document whose only top-level heading comes first: that heading is the title
  const h1s = blocks.filter((b) => b.t === 'h' && b.level === 1)
  if (!title && h1s.length === 1 && blocks[0] === h1s[0]) {
    title = w.runs(h1s[0].runs)
    blocks = blocks.slice(1)
    w.shift = 1
  }
  const pg = { paper: 'a4', marginMm: 25, ...o.page }
  const paper = { a4: 'a4paper', letter: 'letterpaper', legal: 'legalpaper', a5: 'a5paper', a3: 'a3paper' }[pg.paper] || 'a4paper'
  const pdfMeta = [`pdftitle={${tesc(meta.title || '')}}`, meta.author && `pdfauthor={${tesc(meta.author)}}`, meta.keywords && `pdfkeywords={${tesc(meta.keywords)}}`].filter(Boolean).join(',')
  return `% Exported from CaretFlow
\\documentclass[11pt,${paper}${pg.landscape ? ',landscape' : ''}]{article}
\\usepackage{iftex}
\\ifPDFTeX
  \\usepackage[T1]{fontenc}
  \\usepackage[utf8]{inputenc}
  \\usepackage{lmodern}
\\else
  \\usepackage{fontspec}
\\fi
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage[export]{adjustbox}
\\usepackage[table]{xcolor}
\\usepackage[normalem]{ulem}
\\usepackage{longtable,booktabs,array}
\\usepackage[margin=${pg.marginMm}mm]{geometry}
\\usepackage{hyperref}
\\hypersetup{colorlinks=true,linkcolor=blue!60!black,urlcolor=blue!60!black,${pdfMeta}}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.6em}
${title ? `\\title{${title}}\n\\author{${tesc(meta.author || '')}}\n\\date{${tesc(meta.date || '')}}\n` : ''}
\\begin{document}
${title ? '\\maketitle\n' : ''}
${w.blocks(blocks)}

\\end{document}
`
}

// ════════════════════════════════════════ plain text
const width = (s) => [...s].length

class TextWriter {
  runs(runs) {
    let out = ''
    for (const r of runs) {
      if (r.br) out += '\n'
      else if (r.math !== undefined) out += r.math
      else if (r.img || r.imgMissing !== undefined) out += `[${r.img?.alt || r.imgMissing || 'Image'}]`
      else out += r.text
    }
    // a link: its text, then the address when they differ
    const links = []
    for (const r of runs) if (r.link && !r.link.startsWith('#') && !links.includes(r.link)) links.push(r.link)
    for (const l of links) {
      const text = runsText(runs.filter((r) => r.link === l))
      if (text.trim() !== l && text.trim() !== l.replace(/^mailto:/, '')) out = out.replace(text, (m) => `${m} (${l})`)
    }
    return out
  }

  blocks(blocks) {
    return blocks.map((b) => this.block(b)).filter((x) => x !== null).join('\n\n')
  }

  block(b) {
    switch (b.t) {
      case 'h': {
        const t = this.runs(b.runs)
        if (b.level > 2) return t
        const len = Math.max(...t.split('\n').map(width))
        return t + '\n' + (b.level === 1 ? '=' : '-').repeat(len)
      }
      case 'p':
        return this.runs(b.runs)
      case 'math':
        return '    ' + b.tex.replace(/\n/g, '\n    ')
      case 'code':
        return b.lines.map((l) => '    ' + l.map((r) => r.text).join('')).join('\n')
      case 'hr':
        return '* * *'
      case 'pagebreak':
        return '\f'
      case 'quote': {
        const inner = (b.callout ? `${b.title}:\n` : '') + this.blocks(b.blocks)
        return inner
          .split('\n')
          .map((l) => (l ? '> ' + l : '>'))
          .join('\n')
      }
      case 'list': {
        // a list is "loose" (blank lines between items) only when an item has more than one paragraph
        const loose = b.items.some((it) => it.blocks.filter((x) => x.t !== 'list').length > 1)
        return b.items
          .map((it, n) => {
            const mark = it.check !== null ? (it.check ? '[x] ' : '[ ] ') : b.ordered ? `${b.start + n}. ` : '- '
            const body = it.blocks.map((x) => this.block(x)).filter((x) => x !== null).join(loose ? '\n\n' : '\n')
            const pad = ' '.repeat(mark.length)
            return mark + body.split('\n').map((l, i) => (i && l ? pad + l : l)).join('\n')
          })
          .join(loose ? '\n\n' : '\n')
      }
      case 'table': {
        const rows = [...(b.head ? [b.head] : []), ...b.rows].map((r) => r.map((c) => this.runs(c).replace(/\n/g, ' ')))
        const w = b.align.map((_, i) => Math.max(3, ...rows.map((r) => width(r[i] || ''))))
        const cell = (s, i) => {
          const gap = w[i] - width(s)
          if (b.align[i] === 'right') return ' '.repeat(gap) + s
          if (b.align[i] === 'center') return ' '.repeat(gap >> 1) + s + ' '.repeat(gap - (gap >> 1))
          return s + ' '.repeat(gap)
        }
        const line = (r) => r.map(cell).join('  ').replace(/\s+$/, '')
        const out = rows.map(line)
        if (b.head) out.splice(1, 0, w.map((n) => '-'.repeat(n)).join('  '))
        return out.join('\n')
      }
    }
    return null
  }
}

/** model → plain text: no Markdown marks, lists and tables laid out with spaces */
export function toPlainText(model) {
  const t = new TextWriter()
  let out = ''
  if (model.fmTitle) out += model.meta.title + '\n' + '='.repeat(width(model.meta.title)) + '\n\n'
  return (out + t.blocks(model.blocks)).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
