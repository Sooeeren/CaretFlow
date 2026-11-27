// Line numbers for the rendered view, like Word's line numbering: every n-th line on screen gets
// its number in the left margin. Lines are measured from the text layout (Range.getClientRects),
// so a wrapped paragraph counts once per screen line. Source mode has its own (source.js).
//
// Long documents: each top-level block's lines are measured once and kept until the block changes
// (or the text width does), and only the numbers near the window are drawn, again as it scrolls.
// Measuring every block after every keystroke made typing lag behind in a long file.

// text that isn't part of a line of the document: math (KaTeX draws many boxes per formula),
// code block toolbars and diagram previews
const SKIP = '.katex, .tools, .preview-panel, .language-picker, .cm-gutters'
const MARGIN = 1 // screens above and below the window that get numbers too
const BUDGET = 30 // ms of measuring blocks out of view at a time

/**
 * host: the rendered editor (#wysiwyg); layerParent: its scroll container, which gets the numbers
 * (outside host, so drawing them doesn't trigger the host's mutation observer again).
 */
export function createLineNumbers(host, layerParent) {
  const layer = document.createElement('div')
  layer.className = 'wv-lines'
  layer.setAttribute('aria-hidden', 'true')
  layerParent.append(layer)
  let every = 0
  let timer = 0
  let frame = 0
  let idle = 0
  let width = -1
  let cache = new WeakMap() // top-level block -> lines as [top, bottom] from the block's top
  const range = document.createRange()

  const pmOf = () => host.querySelector('.ProseMirror')

  /** The lines of one block, measured from its text. */
  const measure = (block) => {
    const base = block.getBoundingClientRect().top
    const boxes = []
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    for (let n; (n = walker.nextNode()); ) {
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) boxes.push([r.top - base, r.bottom - base])
    }
    // callout titles ("Tip", "Note", …) are drawn by CSS, not text nodes
    for (const m of block.querySelectorAll('.callout-marker:not(.editing)')) {
      const r = m.getBoundingClientRect()
      if (r.height > 0) boxes.push([r.top - base, r.bottom - base])
    }
    boxes.sort((a, b) => a[0] - b[0])
    // boxes whose middle lies inside the previous line are on that line (bold, inline code, table cells)
    const lines = []
    for (const [top, bottom] of boxes) {
      const last = lines[lines.length - 1]
      const mid = (top + bottom) / 2
      if (last && mid > last[0] && mid < last[1]) {
        last[0] = Math.min(last[0], top)
        last[1] = Math.max(last[1], bottom)
      } else lines.push([top, bottom])
    }
    return lines
  }
  const linesOf = (block) => {
    let l = cache.get(block)
    if (!l) cache.set(block, (l = measure(block)))
    return l
  }

  /** The first block whose bottom is below `y` (window coordinates), by halving. */
  const firstBelow = (blocks, y) => {
    let lo = 0
    let hi = blocks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (blocks[mid].getBoundingClientRect().bottom < y) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const draw = () => {
    frame = 0
    const pm = pmOf()
    if (!every || host.hidden || !pm) return layer.replaceChildren()
    if (pm.clientWidth !== width) {
      width = pm.clientWidth
      cache = new WeakMap()
    }
    const blocks = [...pm.children]
    const base = layerParent.getBoundingClientRect()
    const contentLeft = pm.getBoundingClientRect().left + parseFloat(getComputedStyle(pm).paddingLeft) - base.left
    const offset = layerParent.scrollTop - base.top
    const span = base.height * MARGIN
    const first = firstBelow(blocks, base.top - span)
    const last = firstBelow(blocks, base.bottom + span)
    // lines above the drawn part only need counting (measured once, then kept). Measuring a block
    // out of view costs a layout of it (long documents don't lay out what isn't shown): after a
    // jump far down, the numbers come once the blocks above are counted, a slice at a time
    let n = 0
    const t0 = performance.now()
    for (let i = 0; i < first; i++) {
      if (!cache.has(blocks[i]) && performance.now() - t0 > BUDGET) {
        layer.replaceChildren()
        return wake(true)
      }
      n += linesOf(blocks[i]).length
    }
    const out = []
    for (let i = first; i <= last && i < blocks.length; i++) {
      const top = blocks[i].getBoundingClientRect().top
      for (const [a, b] of linesOf(blocks[i])) {
        if (++n % every) continue
        const s = document.createElement('span')
        s.textContent = n
        s.style.top = `${top + (a + b) / 2 + offset}px`
        s.style.left = `${contentLeft}px`
        out.push(s)
      }
    }
    layer.replaceChildren(...out)
    // the rest of the document is measured while nobody types, so a jump down is quick
    if (blocks.some((b) => !cache.has(b))) wake(false)
  }

  // Measuring in the background: in pauses of typing, a few blocks per idle moment, so it never
  // delays a keystroke. `then` draws again when done (numbers waiting for the blocks above them).
  let redrawAfter = false
  const later = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 50))
  const wake = (thenDraw) => {
    redrawAfter ||= thenDraw
    if (!idle) idle = later(warm)
  }
  const warm = (deadline) => {
    idle = 0
    const pm = pmOf()
    if (!every || !pm) return
    if (performance.now() - lastInput < 800) return (idle = later(warm))
    // many blocks left: lay the whole document out once (style.css: .cf-measure-all shows every
    // block for a moment) and measure them all in that one layout, instead of one layout per block
    const left = [...pm.children].filter((b) => !cache.has(b))
    if (left.length > 40 && host.classList.contains('cf-big')) {
      host.classList.add('cf-measure-all')
      try {
        for (const b of left) linesOf(b)
      } finally {
        host.classList.remove('cf-measure-all')
      }
    }
    const end = performance.now() + Math.min(BUDGET, deadline?.timeRemaining ? Math.max(4, deadline.timeRemaining() - 4) : 12)
    for (const b of pm.children) {
      if (cache.has(b)) continue
      if (performance.now() > end) return (idle = later(warm))
      linesOf(b)
    }
    if (redrawAfter) {
      redrawAfter = false
      redraw()
    }
  }
  let lastInput = 0
  for (const ev of ['keydown', 'beforeinput', 'compositionupdate']) host.addEventListener(ev, () => (lastInput = performance.now()), true)

  const redraw = () => {
    if (every && !frame) frame = requestAnimationFrame(draw)
  }
  const schedule = () => {
    if (!every) return
    clearTimeout(timer)
    timer = setTimeout(redraw, 120)
  }

  // an edit measures again only the block it happened in
  new MutationObserver((muts) => {
    if (!every) return
    const pm = pmOf()
    for (const m of muts) {
      let b = m.target.nodeType === 1 ? m.target : m.target.parentElement
      while (b && b.parentElement !== pm) b = b.parentElement
      if (b) cache.delete(b)
    }
    schedule()
  }).observe(host, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] })
  // only a new width moves text to other lines; heights change as images and diagrams load
  new ResizeObserver(schedule).observe(host)
  layerParent.addEventListener('scroll', redraw, { passive: true })
  document.fonts?.ready.then(() => {
    cache = new WeakMap()
    schedule()
  })

  return {
    /** n = number every n-th line; 0 = off */
    set(n) {
      if (n === every) return
      every = n
      if (every) schedule()
      else layer.replaceChildren()
    },
    refresh: () => {
      cache = new WeakMap()
      schedule()
    },
  }
}
