// OpenDocument export (.odt, lazy) for LibreOffice, OnlyOffice, Google Docs and Word. Written from
// the document model (docmodel.js) with LibreOffice's standard style names (Heading 1–6, Text
// Body, Quotations, Preformatted Text, List Bullet/Number…), so it restyles like any document.
import { zip } from './zip.js'
import { xesc } from './docmodel.js'

const CALLOUT_COLORS = { note: '#2f74d0', tip: '#2c9a4b', important: '#8250df', warning: '#b7791f', caution: '#cf3a33' }
const CM = 2.54 / 96 // per CSS pixel
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" office:version="1.3"'
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n'
const sn = (name) => name.replace(/ /g, '_20_') // ODF style names encode spaces

/** text with ODF's whitespace rules: runs of spaces, tabs and line starts need elements */
function odfText(s) {
  let out = ''
  for (const part of xesc(s).split(/(\t| {2,}|^ )/)) {
    if (part === '\t') out += '<text:tab/>'
    else if (/^ +$/.test(part)) out += part.length === 1 ? '<text:s/>' : `<text:s text:c="${part.length}"/>`
    else out += part
  }
  return out
}

class Writer {
  constructor(maxCm) {
    this.maxCm = maxCm
    this.auto = new Map() // automatic style xml → name
    this.media = []
    this.frame = 0
    this.table = 0
  }

  /** an automatic style for a set of properties, made once */
  style(family, props, parent) {
    const key = family + '|' + (parent || '') + '|' + props
    if (!this.auto.has(key)) {
      const name = { text: 'T', paragraph: 'P', 'table-cell': 'C', table: 'Tb', graphic: 'G' }[family] + (this.auto.size + 1)
      this.auto.set(key, { name, xml: `<style:style style:name="${name}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ''}>${props}</style:style>` })
    }
    return this.auto.get(key).name
  }

  textStyle(r) {
    let p = ''
    if (r.b) p += ' fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"'
    if (r.i) p += ' fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"'
    if (r.u) p += ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"'
    if (r.s) p += ' style:text-line-through-style="solid" style:text-line-through-type="single"'
    if (r.sub) p += ' style:text-position="sub 58%"'
    else if (r.sup) p += ' style:text-position="super 58%"'
    if (r.mark) p += ' fo:background-color="#ffff00"'
    if (r.color) p += ` fo:color="#${r.color}"`
    return p ? this.style('text', `<style:text-properties${p}/>`) : ''
  }

  runs(runs, extra = {}) {
    let out = ''
    let i = 0
    while (i < runs.length) {
      const r = runs[i]
      if (r.link) {
        const link = r.link
        let inner = ''
        while (i < runs.length && runs[i].link === link) inner += this.run(runs[i++], extra)
        const href = link.startsWith('#') ? '#' + bookmarkName(link.slice(1)) : link
        out += `<text:a xlink:type="simple" xlink:href="${xesc(href)}" text:style-name="Internet_20_link" text:visited-style-name="Visited_20_Internet_20_Link">${inner}</text:a>`
        continue
      }
      out += this.run(r, extra)
      i++
    }
    return out
  }

  run(r, extra) {
    if (r.br) return '<text:line-break/>'
    if (r.math !== undefined) return `<text:span text:style-name="Math">${odfText(r.math)}</text:span>`
    if (r.img) return this.image(r.img)
    if (r.imgMissing !== undefined) return `<text:span text:style-name="${this.textStyle({ i: true, color: '7f7f7f' })}">${odfText(`[${r.imgMissing || 'image'}]`)}</text:span>`
    const st = { ...extra, ...r }
    let t = odfText(r.text)
    if (st.code) t = `<text:span text:style-name="Source_20_Text">${t}</text:span>`
    const s = this.textStyle({ ...st, code: false })
    return s ? `<text:span text:style-name="${s}">${t}</text:span>` : t
  }

  image(img) {
    const name = `Pictures/${this.media.length + 1}.${img.ext}`
    this.media.push({ name, data: img.data, mime: img.mime })
    let w = (img.w || 300) * CM
    let h = (img.h || 200) * CM
    if (w > this.maxCm) [w, h] = [this.maxCm, (h * this.maxCm) / w]
    const n = ++this.frame
    return (
      `<draw:frame draw:style-name="Graphics" draw:name="Image${n}" text:anchor-type="as-char" svg:width="${w.toFixed(3)}cm" svg:height="${h.toFixed(3)}cm" draw:z-index="0">` +
      `<draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${img.mime}"/>` +
      (img.alt ? `<svg:desc>${xesc(img.alt)}</svg:desc>` : '') +
      `</draw:frame>`
    )
  }

  /** a paragraph style: a named one, or an automatic child with an indent, border or alignment */
  pstyle(name, { indent = 0, align, quote } = {}) {
    let p = ''
    if (indent) p += ` fo:margin-left="${indent.toFixed(2)}cm"`
    if (align) p += ` fo:text-align="${{ center: 'center', right: 'end', justify: 'justify', left: 'start' }[align] || 'start'}"`
    if (quote) p += ` fo:border-left="1.5pt solid ${quote.color}" fo:padding-left="0.3cm"${quote.fill ? ` fo:background-color="${quote.fill}"` : ''}`
    return p ? this.style('paragraph', `<style:paragraph-properties${p}/>`, sn(name)) : sn(name)
  }

  blocks(blocks, ctx = {}) {
    return blocks.map((b) => this.block(b, ctx)).join('')
  }

  block(b, ctx) {
    const at = { indent: ctx.indent, quote: ctx.quote }
    switch (b.t) {
      case 'h':
        return `<text:h text:style-name="${this.pstyle('Heading ' + b.level, at)}" text:outline-level="${b.level}"><text:bookmark text:name="${xesc(bookmarkName(b.id))}"/>${this.runs(b.runs)}</text:h>`
      case 'p':
        return `<text:p text:style-name="${this.pstyle(ctx.style || (ctx.quote ? 'Quotations' : 'Text Body'), { ...at, align: b.align })}">${this.runs(b.runs)}</text:p>`
      case 'math':
        return `<text:p text:style-name="${this.pstyle('Formula', at)}"><text:span text:style-name="Math">${odfText(b.tex)}</text:span></text:p>`
      case 'code': {
        const st = this.pstyle('Preformatted Text', at)
        const lines = b.lines.length ? b.lines : [[]]
        return lines.map((line) => `<text:p text:style-name="${st}">${line.map((r) => this.run(r, {})).join('')}</text:p>`).join('')
      }
      case 'hr':
        return `<text:p text:style-name="Horizontal_20_Line"/>`
      case 'pagebreak':
        return `<text:p text:style-name="${this.style('paragraph', '<style:paragraph-properties fo:break-before="page"/>', 'Standard')}"/>`
      case 'quote': {
        const color = b.callout ? CALLOUT_COLORS[b.callout] : '#bfbfbf'
        const q = { color, fill: b.callout ? tint(color) : undefined }
        const indent = (ctx.indent || 0) + (ctx.quote ? 0.5 : 0)
        let x = ''
        if (b.callout) x += `<text:p text:style-name="${this.pstyle('Callout Title', { indent, quote: q })}"><text:span text:style-name="${this.textStyle({ b: true, color: color.slice(1) })}">${xesc(b.title || '')}</text:span></text:p>`
        return x + this.blocks(b.blocks, { ...ctx, indent, quote: q, style: b.callout ? 'Callout' : undefined })
      }
      case 'list':
        return this.list(b, ctx)
      case 'table':
        return this.tableXml(b, ctx)
    }
    return ''
  }

  list(b, ctx) {
    const style = b.task ? 'List_20_Task' : b.ordered ? 'Numbering_20_123' : 'List_20_1'
    let x = `<text:list text:style-name="${style}">`
    b.items.forEach((it, n) => {
      const start = n === 0 && b.ordered && b.start !== 1 ? ` text:start-value="${b.start}"` : ''
      x += `<text:list-item${start}>`
      const [first, ...rest] = it.blocks.length ? it.blocks : [{ t: 'p', runs: [] }]
      const pst = this.pstyle(b.task ? 'List Task' : 'List Contents', { quote: ctx.quote })
      if (first.t === 'p') x += `<text:p text:style-name="${pst}">${it.check === null ? '' : (it.check ? '☒' : '☐') + '<text:tab/>'}${this.runs(first.runs)}</text:p>`
      else rest.unshift(first)
      // nested content stays inside the item, so it is indented like the item's text
      x += this.blocks(rest, { ...ctx, indent: 0, style: rest.length && !ctx.quote ? 'List Contents' : ctx.style })
      x += '</text:list-item>'
    })
    return x + '</text:list>'
  }

  tableXml(b, ctx) {
    const n = ++this.table
    const cols = b.align.length
    const tst = this.style('table', `<style:table-properties style:width="${(this.maxCm - (ctx.indent || 0)).toFixed(2)}cm" table:align="margins" fo:margin-top="0.2cm" fo:margin-bottom="0.3cm"/>`)
    const cell = this.style('table-cell', '<style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #bfbfbf"/>')
    const head = this.style('table-cell', '<style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #bfbfbf" fo:background-color="#f2f2f2"/>')
    const row = (r, isHead) =>
      '<table:table-row>' +
      r
        .map(
          (c, i) =>
            `<table:table-cell table:style-name="${isHead ? head : cell}" office:value-type="string"><text:p text:style-name="${this.pstyle(isHead ? 'Table Heading' : 'Table Contents', { align: b.align[i] || (isHead ? 'left' : '') })}">${this.runs(c)}</text:p></table:table-cell>`,
        )
        .join('') +
      '</table:table-row>'
    return (
      `<table:table table:name="Table${n}" table:style-name="${tst}"><table:table-column table:number-columns-repeated="${cols}"/>` +
      (b.head ? `<table:table-header-rows>${row(b.head, true)}</table:table-header-rows>` : '') +
      b.rows.map((r) => row(r, false)).join('') +
      '</table:table>'
    )
  }
}

const bookmarkName = (id) => 'h_' + id.replace(/[^\p{L}\p{N}_-]/gu, '_')

function tint(hex) {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c) => Math.round(c + (255 - c) * 0.9)
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')
}

function listStyles() {
  const levels = (fn) => [...Array(10).keys()].map(fn).join('')
  const pos = (i) =>
    `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${(0.635 * (i + 1)).toFixed(3)}cm" fo:text-indent="-0.635cm" fo:margin-left="${(0.635 * (i + 1)).toFixed(3)}cm"/></style:list-level-properties>`
  const bullets = ['•', '◦', '▪']
  const nums = ['1', 'a', 'i']
  return (
    `<text:list-style style:name="List_20_1" style:display-name="List 1">${levels((i) => `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${bullets[i % 3]}">${pos(i)}</text:list-level-style-bullet>`)}</text:list-style>` +
    `<text:list-style style:name="Numbering_20_123" style:display-name="Numbering 123">${levels((i) => `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${nums[i % 3]}">${pos(i)}</text:list-level-style-number>`)}</text:list-style>` +
    `<text:list-style style:name="List_20_Task" style:display-name="List Task">${levels((i) => `<text:list-level-style-number text:level="${i + 1}" style:num-format="">${pos(i)}</text:list-level-style-number>`)}</text:list-style>`
  )
}

function stylesXml(page, font, header, footer, pageNumbers) {
  const para = (name, props, parent = 'Standard', extra = '', cls = 'text') =>
    `<style:style style:name="${sn(name)}" style:display-name="${name}" style:family="paragraph" style:parent-style-name="${parent}" style:class="${cls}"${extra}>${props}</style:style>`
  const heading = (n, size) =>
    para(
      'Heading ' + n,
      `<style:paragraph-properties fo:margin-top="${(0.5 - n * 0.04).toFixed(2)}cm" fo:margin-bottom="0.2cm" fo:keep-with-next="always"${n === 1 ? ' fo:border-bottom="0.5pt solid #d9d9d9" fo:padding-bottom="0.08cm"' : ''}/>` +
        `<style:text-properties fo:font-size="${size}pt" fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"${n === 6 ? ' fo:color="#595959"' : ''}/>`,
      'Heading',
      ` style:next-style-name="Text_20_body" style:default-outline-level="${n}"`,
    )
  const pn =
    pageNumbers === 'n'
      ? '<text:page-number text:select-page="current">1</text:page-number>'
      : pageNumbers === 'n/N'
        ? '<text:page-number text:select-page="current">1</text:page-number> / <text:page-count>1</text:page-count>'
        : pageNumbers
          ? 'Page <text:page-number text:select-page="current">1</text:page-number> of <text:page-count>1</text:page-count>'
          : ''
  const foot = footer || pn ? `<style:footer><text:p text:style-name="Footer">${xesc(footer || '')}${footer && pn ? '<text:tab/><text:tab/>' : ''}${pn}</text:p></style:footer>` : ''
  const head = header ? `<style:header><text:p text:style-name="Header">${xesc(header)}</text:p></style:header>` : ''
  const hfProps = (tag) => `<style:${tag}-style><style:header-footer-properties fo:min-height="0cm" fo:margin-${tag === 'header' ? 'bottom' : 'top'}="0.4cm"/></style:${tag}-style>`
  const fontDecl = font ? `<style:font-face style:name="${xesc(font)}" svg:font-family="'${xesc(font)}'"/>` : ''
  return (
    XML +
    `<office:document-styles ${NS}>` +
    `<office:font-face-decls><style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'" style:font-family-generic="roman"/>` +
    `<style:font-face style:name="Liberation Sans" svg:font-family="'Liberation Sans'" style:font-family-generic="swiss"/>` +
    `<style:font-face style:name="Liberation Mono" svg:font-family="'Liberation Mono'" style:font-family-generic="modern" style:font-pitch="fixed"/>${fontDecl}</office:font-face-decls>` +
    `<office:styles>` +
    `<style:default-style style:family="paragraph"><style:paragraph-properties fo:hyphenation-ladder-count="no-limit" style:writing-mode="page"/><style:text-properties style:font-name="${xesc(font || 'Liberation Serif')}" fo:font-size="11pt" fo:language="en" fo:country="US"/></style:default-style>` +
    `<style:style style:name="Standard" style:family="paragraph" style:class="text"/>` +
    para('Text Body', '<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.25cm" fo:line-height="115%"/>') +
    para('Heading', '<style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.21cm" fo:keep-with-next="always"/><style:text-properties style:font-name="Liberation Sans" fo:font-size="14pt"/>', 'Standard', ' style:next-style-name="Text_20_body"') +
    [22, 18, 15, 13, 12, 11].map((s, i) => heading(i + 1, s)).join('') +
    para('Title', '<style:paragraph-properties fo:margin-bottom="0.1cm"/><style:text-properties style:font-name="Liberation Sans" fo:font-size="28pt"/>', 'Heading', ' style:next-style-name="Subtitle"', 'chapter') +
    para('Subtitle', '<style:paragraph-properties fo:margin-bottom="0.5cm"/><style:text-properties fo:font-size="13pt" fo:color="#595959"/>', 'Standard', '', 'chapter') +
    para('Quotations', '<style:paragraph-properties fo:margin-left="0.5cm" fo:margin-right="0.5cm" fo:margin-bottom="0.2cm"/><style:text-properties fo:color="#595959"/>', 'Standard', '', 'html') +
    para('Callout', '<style:paragraph-properties fo:margin-bottom="0.1cm"/>', 'Text_20_body') +
    para('Callout Title', '<style:paragraph-properties fo:margin-top="0.2cm" fo:margin-bottom="0.05cm" fo:keep-with-next="always"/>', 'Callout') +
    para('Formula', '<style:paragraph-properties fo:text-align="center" fo:margin-top="0.15cm" fo:margin-bottom="0.25cm"/>', 'Standard') +
    para('List Contents', '<style:paragraph-properties fo:margin-bottom="0.1cm"/>', 'Text_20_body', '', 'list') +
    para('List Task', '', 'List_20_Contents', '', 'list') +
    para(
      'Preformatted Text',
      '<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:background-color="#f6f8fa" fo:padding="0.1cm" fo:border="0.5pt solid #e1e4e8" style:join-border="true" fo:keep-together="auto"/><style:text-properties style:font-name="Liberation Mono" fo:font-size="9.5pt"/>',
      'Standard',
      '',
      'html',
    ) +
    para('Table Contents', '<style:paragraph-properties fo:margin-bottom="0cm"/>', 'Standard', '', 'extra') +
    para('Table Heading', '<style:text-properties fo:font-weight="bold"/>', 'Table_20_Contents', '', 'extra') +
    para('Horizontal Line', '<style:paragraph-properties fo:margin-top="0.1cm" fo:margin-bottom="0.4cm" fo:border-bottom="0.5pt solid #bfbfbf" fo:padding="0cm"/><style:text-properties fo:font-size="4pt"/>', 'Standard', '', 'html') +
    para('Header', '<style:text-properties fo:font-size="9pt" fo:color="#7f7f7f"/>', 'Standard', '', 'extra') +
    para('Footer', '<style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="9pt" fo:color="#7f7f7f"/>', 'Standard', '', 'extra') +
    `<style:style style:name="Source_20_Text" style:display-name="Source Text" style:family="text"><style:text-properties style:font-name="Liberation Mono" fo:font-size="90%" fo:color="#c7254e" fo:background-color="#f3f4f6"/></style:style>` +
    `<style:style style:name="Math" style:family="text"><style:text-properties style:font-name="Liberation Serif" fo:font-style="italic"/></style:style>` +
    `<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text"><style:text-properties fo:color="#0563c1" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>` +
    `<style:style style:name="Visited_20_Internet_20_Link" style:display-name="Visited Internet Link" style:family="text"><style:text-properties fo:color="#954f72" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>` +
    `<style:style style:name="Graphics" style:family="graphic"><style:graphic-properties text:anchor-type="as-char" svg:y="0cm" style:vertical-pos="top" style:vertical-rel="baseline"/></style:style>` +
    listStyles() +
    `</office:styles>` +
    `<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${page.w}cm" fo:page-height="${page.h}cm" style:print-orientation="${page.landscape ? 'landscape' : 'portrait'}" ` +
    `fo:margin-top="${page.m}cm" fo:margin-bottom="${page.m}cm" fo:margin-left="${page.m}cm" fo:margin-right="${page.m}cm"/>${head ? hfProps('header') : ''}${foot ? hfProps('footer') : ''}</style:page-layout></office:automatic-styles>` +
    `<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1">${head}${foot}</style:master-page></office:master-styles>` +
    `</office:document-styles>`
  )
}

/** model (docmodel.js) → .odt bytes. o: like toDocx in docx.js */
export async function toOdt(model, o = {}) {
  const pg = { widthMm: 210, heightMm: 297, marginMm: 25, ...o.page }
  let [w, h] = [pg.widthMm / 10, pg.heightMm / 10]
  if (pg.landscape) [w, h] = [h, w]
  const m = pg.marginMm / 10
  const wr = new Writer(w - 2 * m)
  const meta = { ...model.meta, ...Object.fromEntries(Object.entries(o.meta || {}).filter(([, v]) => v)) }

  let body = ''
  if (model.fmTitle) {
    body += `<text:p text:style-name="Title">${odfText(meta.title)}</text:p>`
    const sub = [meta.subtitle, meta.author, meta.date].filter(Boolean).join(' · ')
    if (sub) body += `<text:p text:style-name="Subtitle">${odfText(sub)}</text:p>`
  }
  body += wr.blocks(model.blocks)

  const content =
    XML +
    `<office:document-content ${NS}><office:automatic-styles>${[...wr.auto.values()].map((s) => s.xml).join('')}</office:automatic-styles>` +
    `<office:body><office:text>${body || '<text:p text:style-name="Text_20_body"/>'}</office:text></office:body></office:document-content>`
  const now = new Date().toISOString().replace(/\.\d+Z$/, '')
  const metaXml =
    XML +
    `<office:document-meta ${NS}><office:meta><meta:generator>CaretFlow</meta:generator><dc:title>${xesc(meta.title || '')}</dc:title>` +
    (meta.author ? `<meta:initial-creator>${xesc(meta.author)}</meta:initial-creator><dc:creator>${xesc(meta.author)}</dc:creator>` : '') +
    (meta.subject || meta.description ? `<dc:subject>${xesc(meta.subject || meta.description)}</dc:subject>` : '') +
    (meta.keywords || meta.tags ? (meta.keywords || meta.tags).split(/\s*,\s*/).map((k) => `<meta:keyword>${xesc(k)}</meta:keyword>`).join('') : '') +
    `<meta:creation-date>${now}</meta:creation-date><dc:date>${now}</dc:date></office:meta></office:document-meta>`
  const manifest =
    XML +
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
    '<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
    ['content.xml', 'styles.xml', 'meta.xml'].map((f) => `<manifest:file-entry manifest:full-path="${f}" manifest:media-type="text/xml"/>`).join('') +
    wr.media.map((f) => `<manifest:file-entry manifest:full-path="${f.name}" manifest:media-type="${f.mime}"/>`).join('') +
    '</manifest:manifest>'

  return zip([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true },
    { name: 'META-INF/manifest.xml', data: manifest },
    { name: 'content.xml', data: content },
    { name: 'styles.xml', data: stylesXml({ w: w.toFixed(2), h: h.toFixed(2), m: m.toFixed(2), landscape: pg.landscape }, o.font, o.header, o.footer, o.pageNumbers) },
    { name: 'meta.xml', data: metaXml },
    ...wr.media.map((f) => ({ name: f.name, data: f.data, store: true })),
  ])
}
