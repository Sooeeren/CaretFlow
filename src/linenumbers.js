// Line numbers for the rendered view, like Word's line numbering: every n-th line on screen gets
// its number in the left margin. Lines are measured from the text layout (Range.getClientRects),
// so a wrapped paragraph counts once per screen line. Source mode has its own (source.js).

// text that isn't part of a line of the document: math (KaTeX draws many boxes per formula),
// code block toolbars and diagram previews
const SKIP = '.katex, .tools, .preview-panel, .language-picker, .cm-gutters'

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
  const range = document.createRange()

  const measure = (pm) => {
    const boxes = []
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    for (let n; (n = walker.nextNode()); ) {
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) boxes.push([r.top, r.bottom])
    }
    // callout titles ("Tip", "Note", …) are drawn by CSS, not text nodes
    for (const m of pm.querySelectorAll('.callout-marker:not(.editing)')) {
      const r = m.getBoundingClientRect()
      if (r.height > 0) boxes.push([r.top, r.bottom])
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

  const draw = () => {
    const pm = host.querySelector('.ProseMirror')
    if (!every || host.hidden || !pm) return layer.replaceChildren()
    const base = layerParent.getBoundingClientRect()
    const box = pm.getBoundingClientRect()
    const contentLeft = box.left + parseFloat(getComputedStyle(pm).paddingLeft) - base.left
    const offset = layerParent.scrollTop - base.top
    const out = []
    measure(pm).forEach(([top, bottom], i) => {
      if ((i + 1) % every) return
      const s = document.createElement('span')
      s.textContent = i + 1
      s.style.top = `${(top + bottom) / 2 + offset}px`
      s.style.left = `${contentLeft}px`
      out.push(s)
    })
    layer.replaceChildren(...out)
  }

  const schedule = () => {
    if (!every) return
    clearTimeout(timer)
    timer = setTimeout(() => requestAnimationFrame(draw), 120)
  }
  new MutationObserver(schedule).observe(host, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] })
  new ResizeObserver(schedule).observe(host)
  document.fonts?.ready.then(schedule)

  return {
    /** n = number every n-th line; 0 = off */
    set(n) {
      if (n === every) return
      every = n
      if (every) schedule()
      else layer.replaceChildren()
    },
    refresh: schedule,
  }
}
