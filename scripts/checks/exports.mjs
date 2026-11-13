// Checks for File → Export as Word / OpenDocument / EPUB / LaTeX / Plain Text: each command writes
// a file through the palette, the ZIP formats unpack, and their parts hold the document's content.
// The files are also saved next to the screenshots (--out), to open them in Word or LibreOffice.
import { inflateRawSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { check, summary, stubBackend, wait } from './lib.mjs'

const outIdx = process.argv.indexOf('--out')
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : null

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" rx="8" fill="#2f74d0"/><circle cx="30" cy="30" r="18" fill="#fff"/></svg>`
// a 1×1 red PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export const DOC = `---
title: Export Test
author: Ada Lovelace
---

# Introduction

Some **bold**, *italic*, <u>underlined</u>, ~~struck~~ and \`inline code\` text, H<sub>2</sub>O and x<sup>2</sup>,
a [link](https://example.com) and a [jump](#details). Math: $E = mc^2$ and $\\frac{a}{b}$.

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

> [!WARNING]
> Careful with the oven.

> A plain quote.

## Details

1. First
2. Second
   - nested bullet
   - another
3. Third

- [x] done task
- [ ] open task

| Name | Count |
| :--- | ---: |
| Apples | 3 |
| Pears & plums | 12 |

\`\`\`js
const answer = 42 // the answer
\`\`\`

![Blue box](assets/box.svg) ![Red dot](${PNG})

<div style="page-break-after: always;"></div>

---

The end.
`

/** { name: Uint8Array } from a ZIP file */
function unzip(buf) {
  const files = {}
  let p = 0
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8)
    const size = buf.readUInt32LE(p + 18)
    const nameLen = buf.readUInt16LE(p + 26)
    const extra = buf.readUInt16LE(p + 28)
    const name = buf.slice(p + 30, p + 30 + nameLen).toString('utf8')
    const data = buf.slice(p + 30 + nameLen + extra, p + 30 + nameLen + extra + size)
    files[name] = method === 8 ? inflateRawSync(data) : data
    p += 30 + nameLen + extra + size
  }
  return files
}

const written = {}
async function exportVia(page, label, path) {
  await page.evaluate((p) => (window.__savePath = p), path)
  await page.keyboard.press('Control+Shift+P')
  await page.keyboard.type(label)
  await wait(250)
  await page.keyboard.press('Enter')
  for (let i = 0; i < 100 && !written[path]; i++) await wait(100)
  return written[path]
}

const xmlOk = (s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s) && !/<[^>]*<|&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/i.test(s)

export const scenes = {
  'export-formats': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false },
    setup: async (page) => {
      await stubBackend(page, {
        read_text: () => DOC,
        read_bytes: ({ path }) => (path.endsWith('box.svg') ? [...Buffer.from(SVG)] : []),
        write_text: ({ path, content }) => void (written[path] = Buffer.from(content)),
        save_binary: ({ path, b64 }) => void (written[path] = Buffer.from(b64, 'base64')),
      })
      await page.addInitScript(() => {
        const extra = (window.__stubExtra = window.__stubExtra || {})
        extra['plugin:dialog|save'] = () => window.__savePath
        // write_binary gets raw bytes and the path (base64) in a header
        extra.write_binary = (bytes, opts) => {
          const path = new TextDecoder().decode(Uint8Array.from(atob(opts.headers.path), (c) => c.charCodeAt(0)))
          let s = ''
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          return window.__node('save_binary', { path, b64: btoa(s) })
        }
      })
    },
    async run(page) {
      await wait(500)
      const save = (name, buf) => {
        if (!OUT || !buf) return
        mkdirSync(OUT, { recursive: true })
        writeFileSync(join(OUT, name), buf)
      }

      // ── Word
      const docx = await exportVia(page, 'Export as Word', 'C:\\out\\Export Test.docx')
      check('docx written', !!docx)
      if (docx) {
        save('Export Test.docx', docx)
        const z = unzip(docx)
        const doc = z['word/document.xml']?.toString() || ''
        check('docx has its parts', ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml'].every((n) => z[n]), Object.keys(z).join(' '))
        check('docx XML is well-formed text', Object.entries(z).filter(([n]) => /\.(xml|rels)$/.test(n)).every(([, b]) => xmlOk(b.toString())))
        check('docx title from front matter', doc.includes('w:val="Title"') && doc.includes('Export Test') && z['docProps/core.xml'].toString().includes('<dc:creator>Ada Lovelace</dc:creator>'))
        check('docx headings', doc.includes('w:val="Heading1"') && doc.includes('w:val="Heading2"'))
        check('docx inline formats', ['<w:b/>', '<w:i/>', '<w:u w:val="single"/>', '<w:strike/>', 'VerbatimChar', 'subscript', 'superscript'].every((x) => doc.includes(x)))
        check('docx links', doc.includes('<w:hyperlink r:id=') && doc.includes('w:anchor="h_details"') && /w:name="h_details"/.test(doc))
        check('docx math is OMML', doc.includes('<m:oMath>') && doc.includes('<m:f>') && doc.includes('<m:nary>') && doc.includes('<m:oMathPara>'))
        check('docx callout', doc.includes('Warning') && doc.includes('B7791F'))
        check('docx lists numbered', doc.includes('<w:numId w:val="1"/>') && (z['word/numbering.xml'] || '').toString().includes('w:startOverride'))
        check('docx task boxes', doc.includes('☒') && doc.includes('☐'))
        check('docx table', doc.includes('<w:tbl>') && doc.includes('Pears &amp; plums') && doc.includes('<w:jc w:val="right"/>'))
        check('docx code colored', doc.includes('SourceCode') && /w:color w:val="[0-9a-fA-F]{6}"/.test(doc))
        check('docx images embedded', Object.keys(z).filter((n) => n.startsWith('word/media/')).length === 2 && (doc.match(/<pic:pic>/g) || []).length === 2)
        check('docx page break', doc.includes('<w:br w:type="page"/>'))
        check('docx page numbers in footer', !!z['word/footer1.xml']?.toString().includes('PAGE'))
      }

      // ── OpenDocument
      const odt = await exportVia(page, 'OpenDocument', 'C:\\out\\Export Test.odt')
      check('odt written', !!odt)
      if (odt) {
        save('Export Test.odt', odt)
        const z = unzip(odt)
        const first = odt.slice(30, 38).toString()
        check('odt mimetype first and stored', first === 'mimetype' && z.mimetype?.toString() === 'application/vnd.oasis.opendocument.text')
        const c = z['content.xml']?.toString() || ''
        check('odt XML is well-formed text', ['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml'].every((n) => z[n] && xmlOk(z[n].toString())))
        check('odt headings and lists', c.includes('text:outline-level="1"') && c.includes('<text:list text:style-name="Numbering_20_123">') && c.includes('List_20_Task'))
        check('odt table and link', c.includes('<table:table ') && c.includes('xlink:href="https://example.com"'))
        check('odt images', Object.keys(z).filter((n) => n.startsWith('Pictures/')).length === 2 && c.includes('<draw:frame'))
        check('odt code keeps spaces', c.includes('Preformatted_20_Text'))
      }

      // ── EPUB
      const epub = await exportVia(page, 'EPUB', 'C:\\out\\Export Test.epub')
      check('epub written', !!epub)
      if (epub) {
        save('Export Test.epub', epub)
        const z = unzip(epub)
        check('epub mimetype first', epub.slice(30, 38).toString() === 'mimetype' && z.mimetype?.toString() === 'application/epub+zip')
        const opf = z['OEBPS/content.opf']?.toString() || ''
        check('epub package', opf.includes('<dc:title>Export Test</dc:title>') && opf.includes('<dc:creator>Ada Lovelace</dc:creator>') && opf.includes('properties="nav"'))
        const ch = Object.entries(z).filter(([n]) => /chapter\d+\.xhtml$/.test(n)).map(([, b]) => b.toString()).join('')
        check('epub chapter has MathML', ch.includes('http://www.w3.org/1998/Math/MathML') && opf.includes('mathml'))
        check('epub images packed', Object.keys(z).some((n) => n.startsWith('OEBPS/images/')) && !ch.includes('assets/box.svg'))
        check('epub nav lists headings', (z['OEBPS/nav.xhtml']?.toString() || '').includes('#details'))
        check('epub XHTML well-formed', Object.entries(z).filter(([n]) => n.endsWith('.xhtml')).every(([, b]) => xmlOk(b.toString())))
      }

      // ── LaTeX
      const tex = (await exportVia(page, 'LaTeX', 'C:\\out\\Export Test.tex'))?.toString() || ''
      save('Export Test.tex', tex)
      check('tex document', tex.includes('\\documentclass') && tex.includes('\\begin{document}') && tex.includes('\\end{document}'))
      check('tex title and sections', tex.includes('\\title{Export Test}') && tex.includes('\\section{Introduction}') && tex.includes('\\label{details}'))
      check('tex math kept', tex.includes('$E = mc^2$') && tex.includes('\\sum_{i=1}^{n}'))
      check('tex escapes', tex.includes('Pears \\& plums'))
      check('tex lists and table', tex.includes('\\begin{enumerate}') && tex.includes('[$\\boxtimes$]') && tex.includes('\\begin{longtable}'))
      check('tex image path', tex.includes('\\includegraphics[max width=\\linewidth]{../Users/you/Documents/Notes/assets/box.svg}') || /includegraphics.*box\.svg/.test(tex), (/includegraphics[^\n]*/.exec(tex) || [''])[0])

      // ── Plain text
      const txt = (await exportVia(page, 'Plain Text', 'C:\\out\\Export Test.txt'))?.toString() || ''
      save('Export Test.txt', txt)
      check('txt has no Markdown marks', txt.includes('Some bold, italic') && !txt.includes('**'))
      check('txt headings underlined', /Introduction\n=+/.test(txt) && /Details\n-+/.test(txt))
      check('txt lists', txt.includes('1. First') && txt.includes('   - nested bullet') && txt.includes('[x] done task'))
      check('txt table aligned', /Name\s+Count\n-+\s+-+\nApples\s+3/.test(txt))
      check('txt link address', txt.includes('link (https://example.com)'))
      summary()
    },
  },
}
