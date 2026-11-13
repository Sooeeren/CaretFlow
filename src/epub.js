// EPUB 3 e-book export (lazy). One chapter per top-level heading, a table of contents from the
// headings, images packed into the book, math as MathML and diagrams as SVG, so it reads well on
// e-readers, Apple Books, Calibre and phones.
import { zip } from './zip.js'
import { bodyHtml, highlightCss } from './export.js'
import { slug, prepareImage, xesc } from './docmodel.js'
import { isAbs, join, decodeSrc, extname } from './paths.js'

const KEEP = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }
const CONVERT = { bmp: 'image/bmp', avif: 'image/avif' }

const CSS = `body{font-family:serif;line-height:1.5;margin:0 4%}
h1,h2,h3,h4,h5,h6{font-family:sans-serif;line-height:1.25;margin:1.4em 0 .5em;page-break-after:avoid}
h1{font-size:1.8em}h2{font-size:1.45em}h3{font-size:1.2em}h4{font-size:1.05em}
p{margin:0 0 .8em}
a{color:#0b5cad}
img{max-width:100%;height:auto}
code,kbd,samp{font-family:monospace;font-size:.9em;background:#f3f4f6;padding:0 .2em;border-radius:3px}
pre{font-family:monospace;font-size:.85em;background:#f6f8fa;border:1px solid #e1e4e8;padding:.6em .8em;white-space:pre-wrap;word-wrap:break-word;border-radius:4px}
pre code{background:none;padding:0;font-size:1em}
blockquote{margin:1em 0;padding:0 1em;border-left:3px solid #bbb;color:#555}
table{border-collapse:collapse;margin:1em 0}
th,td{border:1px solid #bbb;padding:.3em .6em}th{background:#f2f2f2}
hr{border:0;border-top:1px solid #bbb;margin:2em 0}
.callout{border-left:4px solid;padding:.4em 1em;color:inherit}
.callout-title{font-weight:bold;margin:0 0 .3em}
.callout-note{border-color:#2f74d0;background:#eaf1fa}.callout-note .callout-title{color:#2f74d0}
.callout-tip{border-color:#2c9a4b;background:#eaf5ed}.callout-tip .callout-title{color:#2c9a4b}
.callout-important{border-color:#8250df;background:#f3eefc}.callout-important .callout-title{color:#8250df}
.callout-warning{border-color:#b7791f;background:#f8f2e9}.callout-warning .callout-title{color:#b7791f}
.callout-caution{border-color:#cf3a33;background:#faebea}.callout-caution .callout-title{color:#cf3a33}
.math-block{margin:1em 0;text-align:center}
.mermaid{text-align:center;margin:1em 0}.mermaid svg{max-width:100%;height:auto}
.title-page{text-align:center;margin-top:30%}.title-page h1{font-size:2.2em;border:0}.title-page p{color:#555}
nav ol{list-style:none;padding-left:1em}
`

const page = (title, lang, body) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xesc(lang)}" lang="${xesc(lang)}">` +
  `<head><meta charset="utf-8"/><title>${xesc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`

/** the code colors with the export theme's values filled in (readers don't all know CSS variables) */
function codeCss(themeVars) {
  const vars = Object.fromEntries((themeVars || '').split(';').map((d) => d.split(':').map((x) => x.trim())))
  return highlightCss().replace(/var\((--[\w-]+)\)/g, (m, v) => vars[v] || 'inherit')
}

/**
 * Markdown → .epub bytes.
 * o: { title, meta: { title, author, … }, lang, docDir, readFile(path) → Uint8Array, themeVars }
 */
export async function toEpub(md, model, o = {}) {
  const meta = { ...model.meta, ...Object.fromEntries(Object.entries(o.meta || {}).filter(([, v]) => v)) }
  const title = meta.title || o.title || 'Document'
  const lang = meta.lang || meta.language || o.lang || 'en'
  const html = await bodyHtml(md, { math: 'mathml', plainLabels: true, dark: false })
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
  const body = doc.body

  // check boxes become characters: readers show disabled inputs badly or not at all
  for (const box of body.querySelectorAll('input[type=checkbox]')) box.replaceWith(doc.createTextNode(box.checked ? '☒ ' : '☐ '))

  // images: packed into the book (web images stay out; the book is made offline)
  const images = []
  for (const img of body.querySelectorAll('img')) {
    const src = img.getAttribute('src') || ''
    let bytes = null
    let mime = null
    try {
      if (/^data:/i.test(src)) {
        const r = await fetch(src)
        bytes = new Uint8Array(await r.arrayBuffer())
        mime = r.headers.get('content-type')
      } else if (!/^(https?:|blob:)/i.test(src)) {
        const raw = decodeSrc(src)
        const abs = isAbs(raw) ? raw : o.docDir ? join(o.docDir, raw) : null
        mime = KEEP[extname(raw)] || CONVERT[extname(raw)]
        if (abs && mime) bytes = await o.readFile(abs)
      }
      if (bytes && !Object.values(KEEP).includes(mime)) ({ data: bytes, mime } = await prepareImage(bytes, mime))
    } catch {
      bytes = null
    }
    if (!bytes || !mime) {
      const a = doc.createElement(/^https?:/i.test(src) ? 'a' : 'span')
      if (a.nodeName === 'A') a.setAttribute('href', src)
      a.textContent = `[${img.getAttribute('alt') || 'image'}]`
      img.replaceWith(a)
      continue
    }
    const ext = Object.entries(KEEP).find(([, m]) => m === mime)[0]
    const name = `images/${images.length + 1}.${ext}`
    images.push({ name, data: bytes, mime })
    img.setAttribute('src', name)
    if (!img.getAttribute('alt')) img.setAttribute('alt', '')
  }

  // ids for the headings, and chapters: one per top-level heading when there are several
  const used = new Set()
  const heads = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  for (const h of heads) {
    let id = h.id || slug(h.textContent) || 'section'
    for (let k = 1, base = id; used.has(id); k++) id = `${base}-${k}`
    used.add(id)
    h.id = id
  }
  const top = heads.filter((h) => h.parentNode === body && h.nodeName === 'H1')
  const chapters = []
  let cur = { nodes: [] }
  chapters.push(cur)
  for (const n of [...body.childNodes]) {
    if (top.length > 1 && n.nodeName === 'H1' && cur.nodes.some((x) => x.nodeType === 1)) chapters.push((cur = { nodes: [] }))
    cur.nodes.push(n)
  }
  const fileOf = new Map()
  chapters.forEach((c, i) => {
    c.file = `chapter${i + 1}.xhtml`
    c.title = c.nodes.find((n) => /^H[1-6]$/.test(n.nodeName))?.textContent || title
    for (const n of c.nodes) if (n.nodeType === 1) for (const h of [n, ...n.querySelectorAll('[id]')]) h.id && fileOf.set(h.id, c.file)
  })
  // links between chapters
  for (const a of body.querySelectorAll('a[href^="#"]')) {
    const f = fileOf.get(a.getAttribute('href').slice(1))
    if (f) a.setAttribute('href', f + a.getAttribute('href'))
  }

  const xhtml = (nodes) => {
    const holder = doc.createElement('div')
    for (const n of nodes) holder.appendChild(n)
    // XMLSerializer writes well-formed XHTML; the wrapper's own tag is cut off again
    return new XMLSerializer()
      .serializeToString(holder)
      .replace(/^<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml">/, '')
      .replace(/<\/div>$/, '')
  }
  const files = []
  const manifest = []
  if (model.fmTitle) {
    const sub = [meta.subtitle, meta.author, meta.date].filter(Boolean).map((s) => `<p>${xesc(s)}</p>`).join('')
    files.push({ name: 'OEBPS/title.xhtml', data: page(title, lang, `<section class="title-page" epub:type="titlepage"><h1>${xesc(title)}</h1>${sub}</section>`) })
    manifest.push({ id: 'title', href: 'title.xhtml', type: 'application/xhtml+xml', spine: true })
  }
  chapters.forEach((c, i) => {
    const inner = xhtml(c.nodes)
    const props = [inner.includes('http://www.w3.org/1998/Math/MathML') && 'mathml', inner.includes('<svg') && 'svg'].filter(Boolean).join(' ')
    files.push({ name: 'OEBPS/' + c.file, data: page(c.title, lang, inner) })
    manifest.push({ id: 'c' + (i + 1), href: c.file, type: 'application/xhtml+xml', props, spine: true })
  })

  // table of contents: headings down to level 3, nested
  const tocHeads = heads.filter((h) => +h.nodeName[1] <= 3)
  const root = { kids: [] }
  const stack = [{ lvl: 0, node: root }]
  for (const h of tocHeads) {
    const lvl = +h.nodeName[1]
    while (stack.length > 1 && stack[stack.length - 1].lvl >= lvl) stack.pop()
    const node = { h, kids: [] }
    stack[stack.length - 1].node.kids.push(node)
    stack.push({ lvl, node })
  }
  const render = (kids) =>
    `<ol>${kids.map((k) => `<li><a href="${fileOf.get(k.h.id)}#${xesc(k.h.id)}">${xesc(k.h.textContent.trim() || 'Section')}</a>${k.kids.length ? render(k.kids) : ''}</li>`).join('')}</ol>`
  const nav = tocHeads.length ? render(root.kids) : `<ol><li><a href="${chapters[0].file}">${xesc(title)}</a></li></ol>`
  files.push({ name: 'OEBPS/nav.xhtml', data: page('Contents', lang, `<nav epub:type="toc" id="toc"><h1>Contents</h1>${nav}</nav>`) })
  manifest.push({ id: 'nav', href: 'nav.xhtml', type: 'application/xhtml+xml', props: 'nav' })
  files.push({ name: 'OEBPS/style.css', data: CSS + codeCss(o.themeVars) })
  manifest.push({ id: 'css', href: 'style.css', type: 'text/css' })
  images.forEach((im, i) => manifest.push({ id: 'img' + (i + 1), href: im.name, type: im.mime }))

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const opf =
    `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${xesc(lang)}">` +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:${crypto.randomUUID()}</dc:identifier>` +
    `<dc:title>${xesc(title)}</dc:title><dc:language>${xesc(lang)}</dc:language>` +
    (meta.author ? `<dc:creator>${xesc(meta.author)}</dc:creator>` : '') +
    (meta.description || meta.subject ? `<dc:description>${xesc(meta.description || meta.subject)}</dc:description>` : '') +
    (meta.keywords || meta.tags ? `<dc:subject>${xesc(meta.keywords || meta.tags)}</dc:subject>` : '') +
    `<meta property="dcterms:modified">${now}</meta></metadata><manifest>` +
    manifest.map((m) => `<item id="${m.id}" href="${xesc(m.href)}" media-type="${m.type}"${m.props ? ` properties="${m.props}"` : ''}/>`).join('') +
    `</manifest><spine>${manifest
      .filter((m) => m.spine)
      .map((m) => `<itemref idref="${m.id}"/>`)
      .join('')}</spine></package>`
  const container =
    '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>' +
    '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'

  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    ...files,
    ...images.map((im) => ({ name: 'OEBPS/' + im.name, data: im.data, store: true })),
  ])
}
