// Image size, like Typora: right-click an image (or Format → Image Size) and pick 10 %, 25 %, …
// The size is a zoom of the image as it would show, written the way Typora writes it, so the file
// stays readable there and in browsers:
//   <img src="pic.png" alt="A cat" style="zoom:50%;" />
// An image at its normal size stays plain Markdown: ![A cat](pic.png "caption"). A size in pixels
// (Custom Size…) is a width, which GitHub shows too: <img src="pic.png" alt="A cat" width="300" />
//
// Milkdown's image block keeps a height ratio in the alt text (`![1.00](pic.png)`), which threw the
// real alt text away on every save. Here the alt text is kept; a number there is still read as the
// old ratio.
import { $remark, $prose } from '@milkdown/kit/utils'
import { imageBlockSchema } from '@milkdown/kit/component/image-block'
import { Plugin, PluginKey, NodeSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

export const IMAGE_ZOOMS = [10, 25, 33, 50, 66, 75, 100, 150, 200]
const MIN_ZOOM = 5
const MAX_ZOOM = 400
export const MAX_WIDTH = 4000 // px

export const clampZoom = (z) => Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)))
/** 0 or 100 mean "normal size"; everything else is a percentage. */
const isZoomed = (z) => !!z && z !== 100

// ───────────────────────────── Markdown in: a lone <img> with nothing but a zoom becomes an image
const STYLE_ZOOM = /^\s*zoom\s*:\s*(\d+(?:\.\d+)?)\s*(%?)\s*;?\s*$/i

/** `<img src=… alt=… style="zoom:50%">` or `width="300"` → { src, alt, title, zoom, width }, or null for any other HTML. */
export function parseImgTag(html) {
  const t = html.trim()
  if (!/^<img\b[^<>]*\/?>$/i.test(t)) return null
  const img = new DOMParser().parseFromString(t, 'text/html').body.firstElementChild
  if (!img || img.tagName !== 'IMG' || !img.getAttribute('src')) return null
  // anything else (width, height, align, other styles) stays HTML, exactly as written
  if ([...img.attributes].some((a) => !['src', 'alt', 'title', 'style', 'width'].includes(a.name))) return null
  let width = 0
  if (img.hasAttribute('width')) {
    const m = img.getAttribute('width').trim().match(/^(\d+)(px)?$/i)
    if (!m || +m[1] < 1) return null // 50% and friends stay HTML
    width = Math.min(MAX_WIDTH, +m[1])
  }
  let zoom = 0
  const style = img.getAttribute('style')
  if (style != null && style.trim()) {
    const m = style.match(STYLE_ZOOM)
    if (!m) return null
    zoom = clampZoom(m[2] ? +m[1] : +m[1] * 100)
  }
  if (zoom && width) return null // both at once: leave it as written
  return { src: img.getAttribute('src'), alt: img.getAttribute('alt') || '', title: img.getAttribute('title') || '', zoom, width }
}

const BLOCK_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition'])

function imgTagsToImages(tree) {
  const walk = (node) => {
    if (!Array.isArray(node.children)) return
    node.children = node.children.map((c) => {
      // `<img …>` on its own line: an html block, or a paragraph that holds only it
      const html = c.type === 'html' && BLOCK_PARENTS.has(node.type) ? c : c.type === 'paragraph' && c.children?.length === 1 && c.children[0].type === 'html' ? c.children[0] : null
      const img = html && parseImgTag(html.value)
      if (img) return { type: 'image-block', url: img.src, alt: img.alt, title: img.title, zoom: img.zoom, width: img.width, position: c.position }
      walk(c)
      return c
    })
  }
  walk(tree)
}

export const imageSizeRemark = $remark('cfImageSize', () => () => imgTagsToImages)

// ───────────────────────────── the image block, with alt text and a zoom
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The `<img>` tag for a resized image (Typora's attribute order: src, alt, style). */
export function imgTag({ src, alt, caption, zoom, width }) {
  const size = width ? `width="${width}"` : `style="zoom:${zoom}%;"`
  return `<img src="${escAttr(src)}"${alt ? ` alt="${escAttr(alt)}"` : ''}${caption ? ` title="${escAttr(caption)}"` : ''} ${size} />`
}

const NUMBER = /^\d+(\.\d+)?$/

function extendImageBlock(prev) {
  return (ctx) => {
    const s = prev(ctx)
    return {
      ...s,
      attrs: { ...s.attrs, alt: { default: '', validate: 'string' }, zoom: { default: 0, validate: 'number' }, width: { default: 0, validate: 'number' } },
      parseDOM: [
        {
          tag: 'img[data-type="image-block"]',
          getAttrs: (dom) => ({
            src: dom.getAttribute('src') || '',
            caption: dom.getAttribute('caption') || '',
            ratio: Number(dom.getAttribute('ratio') ?? 1) || 1,
            alt: dom.getAttribute('alt') || '',
            zoom: Number(dom.getAttribute('zoom')) || 0,
            width: Number(dom.getAttribute('width')) || 0,
          }),
        },
      ],
      parseMarkdown: {
        match: ({ type }) => type === 'image-block',
        runner: (state, node, type) => {
          const alt = node.alt || ''
          // Milkdown's own format: a height ratio where the alt text belongs
          const ratio = NUMBER.test(alt) && +alt > 0 ? +alt : 1
          state.addNode(type, { src: node.url || '', caption: node.title ?? '', ratio, alt: NUMBER.test(alt) ? '' : alt, zoom: node.zoom || 0, width: node.width || 0 })
        },
      },
      toMarkdown: {
        match: (node) => node.type.name === 'image-block',
        runner: (state, node) => {
          const { src, caption, ratio, alt, zoom, width } = node.attrs
          state.openNode('paragraph')
          if (width || isZoomed(zoom)) state.addNode('html', undefined, imgTag({ src, alt, caption, zoom, width }))
          else {
            // a dragged height (the handle under the image) is still kept Milkdown's way, when
            // there is no alt text it would replace
            const r = Number.parseFloat(ratio)
            const altText = alt || (r && Math.abs(r - 1) > 0.005 ? r.toFixed(2) : '')
            state.addNode('image', undefined, undefined, { url: src, alt: altText, title: caption || null })
          }
          state.closeNode()
        },
      },
    }
  }
}

export const imageSizeConfig = (ctx) => ctx.update(imageBlockSchema.key, extendImageBlock)

// ───────────────────────────── showing the zoom, right-click
// The zoom is CSS zoom on the <img>: like Typora, 50 % is half of what the image would show at
// (its own width, or the page width for a wide one). Above 100 % it still never gets wider than
// the page.
function zoomDecorations(doc) {
  const decos = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'image-block') return node.isBlock && !node.isAtom
    if (node.attrs.width) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'cf-sized', style: `--cf-width: ${node.attrs.width}px` }))
    else if (isZoomed(node.attrs.zoom)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'cf-zoomed', style: `--cf-zoom: ${node.attrs.zoom / 100}` }))
    return node.isBlock && !node.isAtom
  })
  return DecorationSet.create(doc, decos)
}

const sizeKey = new PluginKey('cf-image-size')

/** opts.onMenu(view, pos, event): the right-click menu for the image at pos (main.js). */
export const imageSizePlugin = (opts) =>
  $prose(
    () =>
      new Plugin({
        key: sizeKey,
        state: {
          init: (_, { doc }) => zoomDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? zoomDecorations(tr.doc) : old),
        },
        props: {
          decorations: (state) => sizeKey.getState(state),
          handleDOMEvents: {
            contextmenu(view, e) {
              const blk = e.target.closest?.('.milkdown-image-block')
              // the caption field keeps the text menu
              if (!blk || !view.editable || e.target.closest('input')) return false
              const pos = imagePosOf(view, blk)
              if (pos == null) return false
              e.preventDefault()
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
              opts.onMenu(view, pos, e)
              return true
            },
          },
        },
      }),
  )

function imagePosOf(view, dom) {
  let found = null
  view.state.doc.descendants((node, pos) => {
    if (found != null) return false
    if (node.type.name === 'image-block' && view.nodeDOM(pos) === dom) found = pos
    return node.isBlock && !node.isAtom
  })
  return found
}

/** The image block that is selected (clicked), as { pos, node }, or null. */
export function selectedImage(view) {
  const sel = view?.state.selection
  return sel instanceof NodeSelection && sel.node.type.name === 'image-block' ? { pos: sel.from, node: sel.node } : null
}

/** Current size in percent (100 = normal), or null when it has a width in pixels. */
export const zoomOf = (node) => (node.attrs.width ? null : isZoomed(node.attrs.zoom) ? node.attrs.zoom : 100)

function setSize(view, pos, zoom, width) {
  const tr = view.state.tr.setNodeAttribute(pos, 'zoom', zoom).setNodeAttribute(pos, 'width', width)
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
}
export const setImageZoom = (view, pos, zoom) => setSize(view, pos, zoom === 100 || !zoom ? 0 : clampZoom(zoom), 0)
export const setImageWidth = (view, pos, width) => setSize(view, pos, 0, Math.round(Math.min(MAX_WIDTH, Math.max(1, width))))

/** The next preset size up (dir 1) or down (dir -1). */
export function stepZoom(current, dir) {
  if (dir > 0) return IMAGE_ZOOMS.find((z) => z > current) ?? clampZoom(current * 1.5)
  return [...IMAGE_ZOOMS].reverse().find((z) => z < current) ?? clampZoom(current / 1.5)
}
