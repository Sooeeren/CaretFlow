// Word export (.docx, lazy): writes WordprocessingML from the document model (docmodel.js).
// The result uses Word's own styles (Heading 1–6, Title, Quote, List numbering, Hyperlink, a
// table style), so it can be restyled, gets a navigation pane and a table of contents in Word,
// and math becomes real Word equations (omml.js).
import { zip } from './zip.js'
import { xesc } from './docmodel.js'
import { texToOmml } from './omml.js'

const CALLOUT_COLORS = { note: '2F74D0', tip: '2C9A4B', important: '8250DF', warning: 'B7791F', caution: 'CF3A33' }
const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const EMU = 9525 // per CSS pixel
const TWIP_MM = 56.6929

class Writer {
  constructor(page) {
    this.rels = [] // [{ id, type, target, external }]
    this.media = [] // [{ name, data }]
    this.nums = [] // [{ abstract, start, level }]
    this.drawingId = 0
    this.bookmarkId = 0
    this.relId = 10 // rId1–9 are the fixed parts
    // text width in pixels, for scaling images down to fit
    this.maxPx = Math.round((page.textWidthTwips / 1440) * 96)
  }

  rel(type, target, external) {
    const id = 'rId' + ++this.relId
    this.rels.push({ id, type, target, external })
    return id
  }

  // ── runs
  text(s) {
    // tabs become <w:tab/>, the rest is one <w:t>
    return s
      .split('\t')
      .map((p) => (p ? `<w:t xml:space="preserve">${xesc(p)}</w:t>` : ''))
      .join('<w:tab/>')
  }

  rPr(r, extra = {}) {
    const st = { ...extra, ...r }
    let x = ''
    if (st.code) x += '<w:rStyle w:val="VerbatimChar"/>'
    else if (st.link) x += '<w:rStyle w:val="Hyperlink"/>'
    if (st.font) x += `<w:rFonts w:ascii="${st.font}" w:hAnsi="${st.font}" w:cs="${st.font}"/>`
    if (st.b) x += '<w:b/>'
    if (st.i) x += '<w:i/>'
    if (st.s) x += '<w:strike/>'
    if (st.color) x += `<w:color w:val="${st.color}"/>`
    if (st.mark) x += '<w:highlight w:val="yellow"/>'
    if (st.u) x += '<w:u w:val="single"/>'
    if (st.sub) x += '<w:vertAlign w:val="subscript"/>'
    else if (st.sup) x += '<w:vertAlign w:val="superscript"/>'
    return x ? `<w:rPr>${x}</w:rPr>` : ''
  }

  image(img) {
    const name = `image${this.media.length + 1}.${img.ext}`
    this.media.push({ name, data: img.data })
    const id = this.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', 'media/' + name)
    let w = img.w || 300
    let h = img.h || 200
    if (w > this.maxPx) [w, h] = [this.maxPx, (h * this.maxPx) / w]
    const cx = Math.round(w * EMU)
    const cy = Math.round(h * EMU)
    const n = ++this.drawingId
    return (
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${xesc(img.alt || '')}"/>` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    )
  }

  runs(runs, extra = {}) {
    let out = ''
    let i = 0
    while (i < runs.length) {
      const r = runs[i]
      // a link: the runs that share it go into one <w:hyperlink>
      if (r.link && !extra.noLinks) {
        const link = r.link
        let inner = ''
        while (i < runs.length && runs[i].link === link) inner += this.run(runs[i++], extra)
        if (link.startsWith('#')) out += `<w:hyperlink w:anchor="${xesc(bookmarkName(link.slice(1)))}" w:history="1">${inner}</w:hyperlink>`
        else {
          const id = this.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', link, true)
          out += `<w:hyperlink r:id="${id}" w:history="1">${inner}</w:hyperlink>`
        }
        continue
      }
      out += this.run(r, extra)
      i++
    }
    return out
  }

  run(r, extra) {
    if (r.br) return '<w:r><w:br/></w:r>'
    if (r.math !== undefined) return texToOmml(r.math, false)
    if (r.img) return this.image(r.img)
    if (r.imgMissing !== undefined) return `<w:r>${this.rPr({ i: true, color: '7F7F7F' }, extra)}${this.text(`[${r.imgMissing || 'image'}]`)}</w:r>`
    return `<w:r>${this.rPr(r, extra)}${this.text(r.text)}</w:r>`
  }

  // ── blocks
  /** ctx: { indent (twips), depth (list level), quote: { color, fill }, style } */
  blocks(blocks, ctx = {}) {
    return blocks.map((b) => this.block(b, ctx)).join('')
  }

  pPr({ style, numId, ilvl, indent, hanging, align, quote, keepNext, extra = '' }) {
    let x = ''
    if (style) x += `<w:pStyle w:val="${style}"/>`
    if (keepNext) x += '<w:keepNext/>'
    if (numId) x += `<w:numPr><w:ilvl w:val="${ilvl || 0}"/><w:numId w:val="${numId}"/></w:numPr>`
    if (quote) x += `<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${quote.color}"/></w:pBdr>`
    if (quote?.fill) x += `<w:shd w:val="clear" w:color="auto" w:fill="${quote.fill}"/>`
    x += extra
    if (indent || hanging) x += `<w:ind w:left="${indent || 0}"${hanging ? ` w:hanging="${hanging}"` : ''}/>`
    if (align) x += `<w:jc w:val="${{ center: 'center', right: 'right', justify: 'both', left: 'left' }[align] || 'left'}"/>`
    return x ? `<w:pPr>${x}</w:pPr>` : ''
  }

  para(runsXml, props) {
    return `<w:p>${this.pPr(props)}${runsXml}</w:p>`
  }

  block(b, ctx) {
    const base = { indent: ctx.indent, quote: ctx.quote, style: ctx.style }
    switch (b.t) {
      case 'h': {
        const id = ++this.bookmarkId
        const bm = `<w:bookmarkStart w:id="${id}" w:name="${xesc(bookmarkName(b.id))}"/>`
        return this.para(bm + this.runs(b.runs) + `<w:bookmarkEnd w:id="${id}"/>`, { ...base, style: 'Heading' + b.level })
      }
      case 'p':
        return this.para(this.runs(b.runs), { ...base, align: b.align, style: ctx.style || (ctx.quote ? 'Quote' : undefined) })
      case 'math':
        return this.para(texToOmml(b.tex, true), base)
      case 'code': {
        const lines = b.lines.length ? b.lines : [[]]
        return lines.map((line) => this.para(line.map((r) => `<w:r>${this.rPr(r)}${this.text(r.text)}</w:r>`).join(''), { ...base, style: 'SourceCode', quote: undefined })).join('')
      }
      case 'hr':
        return this.para('', { ...base, style: 'HorizontalLine' })
      case 'pagebreak':
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
      case 'quote': {
        const color = b.callout ? CALLOUT_COLORS[b.callout] : 'BFBFBF'
        const q = { color, fill: b.callout ? tint(color) : undefined }
        const indent = (ctx.indent || 0) + (ctx.quote ? 240 : 0)
        let x = ''
        if (b.callout) x += this.para(`<w:r>${this.rPr({ b: true, color })}${this.text(b.title || '')}</w:r>`, { indent, quote: q, keepNext: true, style: 'CalloutTitle' })
        x += this.blocks(b.blocks, { ...ctx, indent, quote: q, style: b.callout ? 'Callout' : undefined })
        return x
      }
      case 'list':
        return this.list(b, ctx)
      case 'table':
        return this.table(b, ctx)
    }
    return ''
  }

  list(b, ctx) {
    const level = Math.min((ctx.depth ?? -1) + 1, 8)
    const indent = 720 * (level + 1) // the same indents as the numbering levels
    let numId = null
    if (!b.task) {
      this.nums.push({ abstract: b.ordered ? 2 : 1, start: b.start, level })
      numId = this.nums.length
    }
    // task lists have no bullets: their items start with a check box instead
    const props = numId ? { numId, ilvl: level, quote: ctx.quote, style: 'ListParagraph' } : { indent, hanging: 360, quote: ctx.quote, style: 'ListParagraph' }
    let x = ''
    for (const it of b.items) {
      const [first, ...rest] = it.blocks.length ? it.blocks : [{ t: 'p', runs: [] }]
      if (first.t === 'p') {
        const box = it.check === null ? '' : `<w:r><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol"/></w:rPr><w:t>${it.check ? '☒' : '☐'}</w:t></w:r><w:r><w:tab/></w:r>`
        x += this.para(box + this.runs(first.runs), props)
      } else {
        // an item that starts with a code block, table…: an empty numbered line, then the block
        x += this.para('', props)
        rest.unshift(first)
      }
      x += this.blocks(rest, { ...ctx, indent, depth: level, style: undefined })
    }
    return x
  }

  table(b, ctx) {
    const cols = b.align.length
    const width = this.maxTwips - (ctx.indent || 0)
    const colW = Math.floor(width / cols)
    const cell = (runs, i, head) =>
      `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''}</w:tcPr>` +
      this.para(this.runs(runs, head ? { b: true } : {}), { style: 'TableContents', align: b.align[i] }) +
      '</w:tc>'
    const row = (r, head) => `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${r.map((c, i) => cell(c, i, head)).join('')}</w:tr>`
    return (
      `<w:tbl><w:tblPr><w:tblStyle w:val="CaretFlowTable"/><w:tblW w:w="${width}" w:type="dxa"/>${ctx.indent ? `<w:tblInd w:w="${ctx.indent}" w:type="dxa"/>` : ''}` +
      `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
      `<w:tblGrid>${'<w:gridCol w:w="' + colW + '"/>'.repeat(cols)}</w:tblGrid>` +
      (b.head ? row(b.head, true) : '') +
      b.rows.map((r) => row(r, false)).join('') +
      // Word wants a paragraph between two tables and after a table at the end
      '</w:tbl><w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>'
    )
  }
}

/** Word bookmark names: letters, digits and _, starting with a letter, at most 40 characters */
const bookmarkName = (id) => ('h_' + id.replace(/[^\p{L}\p{N}_]/gu, '_')).slice(0, 40)

/** A pale background for a callout, from its color */
function tint(hex) {
  const n = parseInt(hex, 16)
  const mix = (c) => Math.round(c + (255 - c) * 0.9)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function stylesXml(font) {
  const heading = (n, sz, color, before, after, extra = '') =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/>${extra}<w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>` +
    `<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:cstheme="majorBidi"/><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`
  const bottomLine = '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D9D9D9"/></w:pBdr>'
  return (
    XML +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:cstheme="minorBidi"/>` +
    `<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr>` : ''}</w:style>` +
    `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>` +
    `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
    `<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="11"/><w:qFormat/><w:pPr><w:spacing w:after="320"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>` +
    heading(1, 36, '1F1F1F', 360, 120, bottomLine) +
    heading(2, 30, '1F1F1F', 320, 100) +
    heading(3, 26, '262626', 280, 80) +
    heading(4, 24, '262626', 240, 60) +
    heading(5, 22, '404040', 200, 40) +
    heading(6, 22, '595959', 200, 40) +
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:color w:val="595959"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Callout"><w:name w:val="Callout"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="CalloutTitle"><w:name w:val="Callout Title"/><w:basedOn w:val="Callout"/><w:next w:val="Callout"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="40"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="E1E4E8"/><w:left w:val="single" w:sz="4" w:space="4" w:color="E1E4E8"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="E1E4E8"/><w:right w:val="single" w:sz="4" w:space="4" w:color="E1E4E8"/></w:pBdr>` +
    `<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/><w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/><w:ind w:left="100" w:right="100"/><w:contextualSpacing/></w:pPr>` +
    `<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:noProof/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>` +
    `<w:style w:type="character" w:styleId="VerbatimChar"><w:name w:val="Verbatim Char"/><w:uiPriority w:val="1"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:noProof/><w:color w:val="C7254E"/><w:sz w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:rPr></w:style>` +
    `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="HorizontalLine"><w:name w:val="Horizontal Line"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr><w:spacing w:before="120" w:after="240"/></w:pPr><w:rPr><w:sz w:val="8"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="TableContents"><w:name w:val="Table Contents"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="18"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Header"/></w:style>` +
    `<w:style w:type="table" w:styleId="CaretFlowTable"><w:name w:val="CaretFlow Table"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
    `<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/></w:tblBorders>` +
    `<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
    `</w:styles>`
  )
}

function numberingXml(nums) {
  const bullets = ['•', '◦', '▪']
  const formats = [['decimal', '%N.'], ['lowerLetter', '%N.'], ['lowerRoman', '%N.']]
  const lvl = (i, fmt, text) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr>${fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr>' : ''}</w:lvl>`
  const abs = (id, lv) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${lv.join('')}</w:abstractNum>`
  const levels = [...Array(9).keys()]
  return (
    XML +
    `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    abs(1, levels.map((i) => lvl(i, 'bullet', bullets[i % 3]))) +
    abs(2, levels.map((i) => lvl(i, formats[i % 3][0], formats[i % 3][1].replace('N', i + 1)))) +
    nums
      .map(
        (n, i) =>
          `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${n.abstract}"/>` +
          // each list starts again at its own first number
          (n.abstract === 2 ? `<w:lvlOverride w:ilvl="${n.level}"><w:startOverride w:val="${n.start}"/></w:lvlOverride>` : '') +
          `</w:num>`,
      )
      .join('') +
    `</w:numbering>`
  )
}

function headerFooterXml(kind, text, pageNumbers) {
  const tag = kind === 'header' ? 'w:hdr' : 'w:ftr'
  const field = (instr) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
  const t = (s) => (s ? `<w:r><w:t xml:space="preserve">${xesc(s)}</w:t></w:r>` : '')
  let num = ''
  if (pageNumbers === 'n') num = field('PAGE')
  else if (pageNumbers === 'n/N') num = field('PAGE') + t(' / ') + field('NUMPAGES')
  else if (pageNumbers) num = t('Page ') + field('PAGE') + t(' of ') + field('NUMPAGES')
  // text on the left, the page number on the right (or centered when there's no text)
  const body = text ? t(text) + (num ? '<w:r><w:tab/></w:r><w:r><w:tab/></w:r>' + num : '') : num
  const jc = !text && num ? '<w:jc w:val="center"/>' : ''
  return XML + `<${tag} ${NS}><w:p><w:pPr><w:pStyle w:val="${kind === 'header' ? 'Header' : 'Footer'}"/>${jc}</w:pPr>${body}</w:p></${tag}>`
}

/**
 * model (docmodel.js) → .docx bytes.
 * o: { page: { widthMm, heightMm, landscape, marginMm }, header, footer, pageNumbers, meta: { title, author, subject, keywords } }
 */
export async function toDocx(model, o = {}) {
  const pg = { widthMm: 210, heightMm: 297, marginMm: 25, ...o.page }
  let [wT, hT] = [Math.round(pg.widthMm * TWIP_MM), Math.round(pg.heightMm * TWIP_MM)]
  if (pg.landscape) [wT, hT] = [hT, wT]
  const mT = Math.round(pg.marginMm * TWIP_MM)
  const w = new Writer({ textWidthTwips: wT - 2 * mT })
  w.maxTwips = wT - 2 * mT

  const meta = { ...model.meta, ...Object.fromEntries(Object.entries(o.meta || {}).filter(([, v]) => v)) }
  let body = ''
  if (model.fmTitle) {
    body += w.para(`<w:r>${w.text(meta.title)}</w:r>`, { style: 'Title' })
    const sub = [meta.subtitle, meta.author, meta.date].filter(Boolean).join(' · ')
    if (sub) body += w.para(`<w:r>${w.text(sub)}</w:r>`, { style: 'Subtitle' })
  }
  body += w.blocks(model.blocks)

  let sectRefs = ''
  const extraParts = []
  const hf = (kind, text) => {
    const name = `${kind}1.xml`
    const id = w.rel(`http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}`, name)
    extraParts.push({ name: 'word/' + name, data: headerFooterXml(kind, text, kind === 'footer' ? o.pageNumbers : '') })
    sectRefs += `<w:${kind}Reference w:type="default" r:id="${id}"/>`
  }
  if (o.header) hf('header', o.header)
  if (o.footer || o.pageNumbers) hf('footer', o.footer)

  const sect =
    `<w:sectPr>${sectRefs}<w:pgSz w:w="${wT}" w:h="${hT}"${pg.landscape ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${mT}" w:right="${mT}" w:bottom="${mT}" w:left="${mT}" w:header="${Math.round(mT / 2)}" w:footer="${Math.round(mT / 2)}" w:gutter="0"/></w:sectPr>`
  const document = XML + `<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`

  const fixed = [
    ['rId1', 'styles', 'styles.xml'],
    ['rId2', 'numbering', 'numbering.xml'],
    ['rId3', 'settings', 'settings.xml'],
  ]
  const rels =
    XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    fixed.map(([id, t, f]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}" Target="${f}"/>`).join('') +
    w.rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xesc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('') +
    '</Relationships>'

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const core =
    XML +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xesc(meta.title || '')}</dc:title><dc:subject>${xesc(meta.subject || meta.description || '')}</dc:subject><dc:creator>${xesc(meta.author || '')}</dc:creator>` +
    `<cp:keywords>${xesc(meta.keywords || meta.tags || '')}</cp:keywords>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
  const app = XML + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>CaretFlow</Application></Properties>'
  const settings =
    XML +
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
    '<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>' +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    '<m:mathPr><m:mathFont m:val="Cambria Math"/><m:dispDef/><m:wrapIndent m:val="1440"/></m:mathPr></w:settings>'
  const types =
    XML +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    extraParts.map((p) => `<Override PartName="/${p.name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${p.name.includes('header') ? 'header' : 'footer'}+xml"/>`).join('') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'
  const pkgRels =
    XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'

  return zip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: pkgRels },
    { name: 'word/document.xml', data: document },
    { name: 'word/_rels/document.xml.rels', data: rels },
    { name: 'word/styles.xml', data: stylesXml(o.font) },
    { name: 'word/numbering.xml', data: numberingXml(w.nums) },
    { name: 'word/settings.xml', data: settings },
    ...extraParts,
    ...w.media.map((m) => ({ name: 'word/media/' + m.name, data: m.data, store: true })),
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app },
  ])
}

