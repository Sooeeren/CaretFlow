// The document as plain data for the Word, OpenDocument, LaTeX and plain-text writers (lazy).
// It is read from the same HTML the PDF export uses (export.js bodyHtml), so HTML inside the
// Markdown (<u>, <sub>, <kbd>, <details>…), callouts, diagrams and code colors come out the same.
//
// Blocks: { t: 'h', level, runs, id } | { t: 'p', runs, align? } | { t: 'code', lang, lines: [[run]] }
//   | { t: 'list', ordered, start, task, items: [{ check: null | true | false, blocks }] }
//   | { t: 'quote', callout?: kind, title?, blocks } | { t: 'table', align: [], head: [runs], rows: [[runs]] }
//   | { t: 'math', tex } | { t: 'hr' } | { t: 'pagebreak' }
// Runs: { text, b, i, u, s, code, sub, sup, mark, link, color } | { br: true } | { math: tex }
//   | { img: { data, mime, ext, w, h, alt } } | { imgMissing: alt, link? }
import { bodyHtml, highlightCss, frontMatter } from './export.js'
import { isAbs, join, decodeSrc, extname } from './paths.js'

const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'MAIN', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'ADDRESS', 'CENTER'])
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' }

/** GitHub-style heading anchor: "Hello, World!" → hello-world */
export const slug = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')

/** code token classes → { color, i, b }, from the highlight rules and the export theme's colors */
function tokenStyles(themeVars) {
  const vars = Object.fromEntries((themeVars || '').split(';').map((d) => d.split(':').map((x) => x.trim())))
  const map = {}
  for (const m of highlightCss().matchAll(/\.([^\s{.]+)\s*\{([^}]*)\}/g)) {
    const st = {}
    const color = /color:\s*var\((--[\w-]+)\)/.exec(m[2]) || /color:\s*(#[0-9a-f]+)/i.exec(m[2])
    if (color) st.color = (color[1].startsWith('--') ? vars[color[1]] : color[1])?.replace('#', '')
    if (/font-style:\s*italic/.test(m[2])) st.i = true
    if (/font-weight:\s*bold/.test(m[2])) st.b = true
    map[m[1]] = st
  }
  return map
}

// ── images: bytes and size; formats Word / LibreOffice can't show are turned into PNG
function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('image did not load'))
    img.src = url
  })
}

/** An SVG without a pixel size (mermaid uses width="100%") gets one from its viewBox. */
function sizedSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.nodeName !== 'svg') return text
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
  const px = (v) => (/^[\d.]+(px)?$/.test(v || '') ? parseFloat(v) : 0)
  let w = px(svg.getAttribute('width'))
  let h = px(svg.getAttribute('height'))
  if ((!w || !h) && vb.length === 4 && vb[2] > 0) {
    w = w || vb[2]
    h = h || (vb[3] * w) / vb[2]
  }
  if (!w || !h) [w, h] = [600, 400]
  svg.setAttribute('width', w)
  svg.setAttribute('height', h)
  svg.removeAttribute('style') // max-width etc.
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(doc)
}

async function toPng(blob, scale) {
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * scale))
    c.height = Math.max(1, Math.round(h * scale))
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0, c.width, c.height)
    const out = await new Promise((r) => c.toBlob(r, 'image/png'))
    if (!out) throw new Error('canvas is empty')
    return { data: new Uint8Array(await out.arrayBuffer()), mime: 'image/png', ext: 'png', w, h }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** bytes + mime → { data, mime, ext, w, h } with w/h in CSS pixels */
export async function prepareImage(bytes, mime) {
  if (mime === 'image/svg+xml') {
    const text = sizedSvg(new TextDecoder().decode(bytes))
    return toPng(new Blob([text], { type: mime }), 2) // sharp when printed
  }
  const blob = new Blob([bytes], { type: mime })
  if (!['image/png', 'image/jpeg', 'image/gif'].includes(mime)) return toPng(blob, 1)
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    return { data: bytes, mime, ext: mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1], w: img.naturalWidth, h: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * The bytes behind an image source, without the network (exports stay offline):
 * { bytes, mime } | null for web images and files that can't be read.
 */
async function readSource(src, o) {
  if (/^data:/i.test(src)) {
    const r = await fetch(src)
    return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/png' }
  }
  if (/^(https?:|blob:|mailto:)/i.test(src)) return null
  // file:///C:/x.png → C:/x.png, file:///home/x.png → /home/x.png
  const raw = decodeSrc(src.replace(/^file:\/\//i, '').replace(/^\/([a-z]:)/i, '$1'))
  const abs = isAbs(raw) ? raw : o.docDir ? join(o.docDir, raw) : null
  const mime = MIME[extname(raw)]
  if (!abs || !mime || !o.readFile) return null
  try {
    return { bytes: await o.readFile(abs), mime }
  } catch {
    return null
  }
}

// ── HTML → blocks
class Builder {
  constructor(o) {
    this.o = o
    this.tok = tokenStyles(o.themeVars)
    this.pending = [] // image jobs: filled in after the walk
    this.ids = new Set()
  }

  blocks(parent) {
    const out = []
    let inline = []
    const flush = () => {
      const runs = this.finishRuns(inline)
      if (runs.length) out.push({ t: 'p', runs })
      inline = []
    }
    for (const n of parent.childNodes) {
      if (n.nodeType === 3 || (n.nodeType === 1 && !BLOCK.has(n.nodeName) && !n.matches('span.math-src.display'))) {
        if (n.nodeType === 1 && n.nodeName === 'INPUT') continue
        inline.push(n)
        continue
      }
      if (n.nodeType !== 1) continue
      flush()
      out.push(...this.block(n))
    }
    flush()
    return out
  }

  block(n) {
    const tag = n.nodeName
    if (/^H[1-6]$/.test(tag)) {
      const runs = this.finishRuns([...n.childNodes])
      let id = n.id || slug(n.textContent)
      for (let k = 1, base = id; this.ids.has(id); k++) id = `${base}-${k}`
      this.ids.add(id)
      return [{ t: 'h', level: +tag[1], runs, id }]
    }
    if (tag === 'P') {
      if (n.classList.contains('callout-title')) return []
      const runs = this.finishRuns([...n.childNodes])
      const align = n.getAttribute('align') || n.style?.textAlign || ''
      return runs.length ? [{ t: 'p', runs, ...(align ? { align } : {}) }] : []
    }
    if (tag === 'PRE') return [this.code(n)]
    if (tag === 'UL' || tag === 'OL') return [this.list(n)]
    if (tag === 'BLOCKQUOTE') {
      const kind = /callout-(\w+)/.exec(n.className)?.[1]
      const title = n.querySelector(':scope > .callout-title')?.textContent
      return [{ t: 'quote', ...(kind ? { callout: kind, title } : {}), blocks: this.blocks(n) }]
    }
    if (tag === 'TABLE') return [this.table(n)]
    if (tag === 'HR') return [{ t: 'hr' }]
    if (tag === 'SPAN') return [{ t: 'math', tex: n.dataset.tex || '' }]
    if (tag === 'DIV') {
      if (/page-break-after/i.test(n.getAttribute('style') || '')) return [{ t: 'pagebreak' }]
      const m = n.querySelector(':scope > span.math-src')
      if (n.classList.contains('math-block') && m) return [{ t: 'math', tex: m.dataset.tex || '' }]
      if (n.classList.contains('mermaid')) {
        const svg = n.querySelector('svg')
        if (!svg) return []
        const run = { imgMissing: 'Diagram' }
        this.pending.push(async () => {
          try {
            const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(svg))
            run.img = { ...(await prepareImage(bytes, 'image/svg+xml')), alt: 'Diagram' }
            delete run.imgMissing
          } catch {}
        })
        return [{ t: 'p', runs: [run], align: 'center' }]
      }
    }
    if (tag === 'DT') return [{ t: 'p', runs: this.finishRuns([...n.childNodes], { b: true }) }]
    if (tag === 'SUMMARY') return [{ t: 'p', runs: this.finishRuns([...n.childNodes], { b: true }) }]
    if (tag === 'DD') return [{ t: 'quote', blocks: this.blocks(n) }]
    return this.blocks(n) // div, details, section, figure…: just their content
  }

  code(pre) {
    const codeEl = pre.querySelector('code') || pre
    const lang = /language-([\w+#.-]+)/.exec(codeEl.className)?.[1] || ''
    const lines = [[]]
    const walk = (node, st) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          const parts = c.nodeValue.split('\n')
          parts.forEach((p, i) => {
            if (i) lines.push([])
            if (p) lines[lines.length - 1].push({ text: p, ...st })
          })
        } else if (c.nodeType === 1) {
          let s2 = st
          for (const cls of c.classList) if (this.tok[cls]) s2 = { ...s2, ...this.tok[cls] }
          walk(c, s2)
        }
      }
    }
    walk(codeEl, {})
    while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop()
    return { t: 'code', lang, lines }
  }

  list(n) {
    const items = []
    for (const li of n.children) {
      if (li.nodeName !== 'LI') continue
      const box = li.querySelector(':scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]')
      const check = box ? box.checked || box.hasAttribute('checked') : null
      box?.remove()
      items.push({ check, blocks: this.blocks(li) })
    }
    const ordered = n.nodeName === 'OL'
    return { t: 'list', ordered, start: ordered ? +(n.getAttribute('start') || 1) : 1, task: items.some((i) => i.check !== null), items }
  }

  table(n) {
    const rows = [...n.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')]
    const cells = (tr) => [...tr.children].filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH')
    const first = rows[0] ? cells(rows[0]) : []
    const hasHead = !!n.querySelector(':scope > thead') || (first.length && first.every((c) => c.nodeName === 'TH'))
    const align = first.map((c) => c.getAttribute('align') || c.style.textAlign || '')
    const runsOf = (c) => this.finishRuns([...c.childNodes])
    const head = hasHead ? first.map(runsOf) : null
    const body = (hasHead ? rows.slice(1) : rows).map((tr) => cells(tr).map(runsOf))
    const cols = Math.max(head?.length || 0, ...body.map((r) => r.length), 1)
    const pad = (r) => [...r, ...Array(cols - r.length).fill([])]
    return { t: 'table', align: pad(align).map((a) => (Array.isArray(a) ? '' : a)), head: head && pad(head), rows: body.map(pad) }
  }

  // inline nodes → runs (whitespace collapsed like a browser does)
  finishRuns(nodes, base = {}) {
    const runs = []
    const walk = (node, st) => {
      if (node.nodeType === 3) {
        const text = st.pre ? node.nodeValue : node.nodeValue.replace(/\s+/g, ' ')
        if (text) runs.push({ ...st, text })
        return
      }
      if (node.nodeType !== 1) return
      const tag = node.nodeName
      if (tag === 'BR') return runs.push({ br: true })
      if (tag === 'IMG') return runs.push(this.image(node, st.link))
      if (tag === 'INPUT') return node.type === 'checkbox' && runs.push({ ...st, text: node.checked ? '☒ ' : '☐ ' })
      if (tag === 'SPAN' && node.classList.contains('math-src')) return runs.push({ math: node.dataset.tex || '' })
      if (tag === 'svg' || tag === 'SCRIPT' || tag === 'STYLE') return
      const s = { ...st }
      if (tag === 'STRONG' || tag === 'B') s.b = true
      else if (tag === 'EM' || tag === 'I' || tag === 'CITE' || tag === 'VAR') s.i = true
      else if (tag === 'U' || tag === 'INS') s.u = true
      else if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') s.s = true
      else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') s.code = true
      else if (tag === 'SUB') s.sub = true
      else if (tag === 'SUP') s.sup = true
      else if (tag === 'MARK') s.mark = true
      else if (tag === 'A' && node.getAttribute('href')) s.link = node.getAttribute('href')
      for (const c of node.childNodes) walk(c, s)
    }
    for (const n of nodes) walk(n, base)
    // trim the edges and double spaces between runs
    const out = []
    for (const r of runs) {
      if (r.text !== undefined) {
        const prev = out[out.length - 1]
        let text = r.text
        if (!prev || prev.br || prev.text?.endsWith(' ')) text = text.replace(/^ +/, '')
        if (!text) continue
        r.text = text
      }
      out.push(r)
    }
    while (out.length && out[out.length - 1].text !== undefined) {
      const last = out[out.length - 1]
      last.text = last.text.replace(/ +$/, '')
      if (last.text) break
      out.pop()
    }
    while (out.length && out[out.length - 1].br) out.pop()
    return out
  }

  image(node, link) {
    const alt = node.getAttribute('alt') || ''
    const src = node.getAttribute('src') || ''
    const run = { imgMissing: alt || src, src, ...(link || /^https?:/i.test(src) ? { link: link || src } : {}) }
    const want = { w: +node.getAttribute('width') || 0, h: +node.getAttribute('height') || 0 }
    this.pending.push(async () => {
      try {
        const s = await readSource(src, this.o)
        if (!s) return
        const img = await prepareImage(s.bytes, s.mime)
        // width/height on an <img> tag win, keeping the aspect ratio when only one is given
        if (want.w && !want.h) [img.h, img.w] = [(img.h * want.w) / img.w, want.w]
        else if (want.h && !want.w) [img.w, img.h] = [(img.w * want.h) / img.h, want.h]
        else if (want.w && want.h) [img.w, img.h] = [want.w, want.h]
        run.img = { ...img, alt }
        delete run.imgMissing
      } catch {}
    })
    return run
  }
}

/**
 * Markdown → { meta, blocks }.
 * o: { docDir, readFile(path) → Uint8Array, themeVars (light export theme), title }
 */
export async function buildModel(md, o = {}) {
  const fm = frontMatter(md)
  const html = await bodyHtml(md, { math: 'source', plainLabels: true, dark: false })
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
  const b = new Builder(o)
  const blocks = b.blocks(doc.body)
  for (const job of b.pending) await job()
  return { meta: { ...fm, title: fm.title || o.title || '' }, fmTitle: !!fm.title, blocks }
}

/** All the text of some runs, for headings in outlines and plain text */
export const runsText = (runs) => runs.map((r) => r.text ?? (r.br ? ' ' : r.math ?? r.img?.alt ?? r.imgMissing ?? '')).join('')

/** Remove characters XML 1.0 doesn't allow (control characters from pasted text) */
export const xmlSafe = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
export const xesc = (s) => xmlSafe(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
