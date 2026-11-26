// The tools of a code block (language button and Copy, Milkdown's) sit in its top right corner,
// laid over the code. They must never cover code: the first line keeps clear of them
// (--cf-tools-w, a right padding in style.css), and where that can't help, a long first line
// with Wrap Code Lines off, the tools move up into a row of their own (.cf-tools-above).

export function watchCodeTools(root) {
  const seen = new WeakSet()
  let queued = false
  const schedule = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      for (const b of root.querySelectorAll('.milkdown-code-block')) fit(b)
    })
  }
  // tools change size with the language name; blocks with the window and Wrap Code Lines
  const ro = new ResizeObserver(schedule)

  function fit(b) {
    const tools = b.querySelector(':scope > .tools')
    const line = b.querySelector('.cm-line')
    if (!tools || !line) return
    if (!seen.has(tools)) {
      seen.add(tools)
      ro.observe(tools)
      ro.observe(b)
      // the Copy button shows only its icon (style.css), so it says what it does on hover
      const copy = tools.querySelector('.copy-button')
      if (copy) copy.title = 'Copy code'
    }
    const t = tools.getBoundingClientRect()
    const box = b.getBoundingClientRect()
    const right = box.right - t.right // the gap between the tools and the block's edge
    // Copy folds away when the block isn't hovered (style.css); reserve its room anyway, so the
    // first line doesn't rewrap every time the mouse passes over the block
    const group = tools.querySelector('.tools-button-group')
    const folded = group ? Math.max(0, group.scrollWidth - group.getBoundingClientRect().width - Math.min(0, parseFloat(getComputedStyle(group).marginLeft) || 0)) : 0
    const width = t.width + folded
    b.style.setProperty('--cf-tools-w', Math.ceil(width + right) + 'px')
    b.style.setProperty('--cf-tools-h', Math.ceil(t.height) + 'px')
    let above = false
    if (!document.body.classList.contains('wrap-code')) {
      // where the first line's text ends when the block isn't scrolled sideways
      const r = document.createRange()
      r.selectNodeContents(line)
      const end = r.getBoundingClientRect().right + (b.querySelector('.cm-scroller')?.scrollLeft || 0)
      above = end > box.right - width - right - 6
    }
    if (b.classList.contains('cf-tools-above') !== above) b.classList.toggle('cf-tools-above', above)
  }

  // typing in a code block, new blocks, and switching Wrap Code Lines (a class on <body>)
  new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement
      if (t?.closest('.milkdown-code-block') || [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches('.milkdown-code-block') || n.querySelector('.milkdown-code-block')))) return schedule()
    }
  }).observe(root, { childList: true, subtree: true, characterData: true })
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] })
  schedule()
}
