// Images in the rendered view: a full-screen button next to Milkdown's caption button, the
// full-screen viewer itself, and the caption (the image's alt text) hidden unless the user wants
// it shown (settings.showAltText → no body.cf-hide-captions) or is editing it right now.

const FULL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'

/** The end of an image's path (folder and file name), for the message on one that didn't load. */
function shortSrc(img) {
  let s = img.getAttribute('src') || ''
  try {
    // the view loads a converted URL (http://asset.localhost/C%3A%5C…): decode it back to the path
    s = decodeURIComponent(s)
  } catch {}
  if (/^(https?:)?\/\//i.test(s) && !/asset\.localhost/i.test(s)) return s
  return s.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
}

// An image that can't load (a wrong path, a deleted file, no network) shows as a small box that
// says so and keeps the place in the text, instead of an empty gap as tall as the last image
function watchBrokenImages(root) {
  root.addEventListener(
    'error',
    (e) => {
      const img = e.target
      const block = img?.tagName === 'IMG' && img.closest('.milkdown-image-block')
      if (!block || !img.getAttribute('src')) return
      block.classList.add('cf-img-broken')
      img.parentElement.dataset.cfBroken = `Image not found: ${shortSrc(img)}`
    },
    true,
  )
  root.addEventListener(
    'load',
    (e) => {
      const block = e.target?.tagName === 'IMG' && e.target.closest('.milkdown-image-block.cf-img-broken')
      if (block) block.classList.remove('cf-img-broken')
    },
    true,
  )
}

export function watchImageTools(root) {
  watchBrokenImages(root)
  // Milkdown (Vue) draws the image block; the button is added on the first hover, and again
  // whenever a re-render dropped it
  root.addEventListener('mouseover', (e) => {
    const op = e.target.closest?.('.milkdown-image-block')?.querySelector(':scope > .image-wrapper > .operation')
    if (!op || op.querySelector('.cf-img-full')) return
    const b = document.createElement('div')
    b.className = 'operation-item cf-img-full'
    b.title = 'View full screen'
    b.innerHTML = `<span class="milkdown-icon">${FULL_ICON}</span>`
    op.prepend(b)
  })
  // pointerdown, the event Milkdown's caption button listens to; on the way down (capture), so
  // these run first
  const down = (e) => {
    const full = e.target.closest?.('.milkdown-image-block .cf-img-full')
    if (full) {
      // before ProseMirror selects the block or starts a drag
      e.preventDefault()
      e.stopPropagation()
      if (e.type === 'pointerdown') showImageFull(full.closest('.milkdown-image-block').querySelector('img'))
      return
    }
    const cap = e.type === 'pointerdown' && e.target.closest?.('.milkdown-image-block .operation-item')
    if (!cap) return
    const block = cap.closest('.milkdown-image-block')
    // Milkdown's button hides a caption that has text; while captions are hidden it only shows
    // the field to edit it. An empty block has no field yet: Milkdown makes one first
    if (document.body.classList.contains('cf-hide-captions') && block.querySelector(':scope > .caption-input')) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (document.body.classList.contains('cf-hide-captions')) openCaption(block)
  }
  root.addEventListener('pointerdown', down, true)
  root.addEventListener('mousedown', down, true)
  // leaving the caption field hides it again (only matters while captions are hidden)
  root.addEventListener('focusout', (e) => {
    const block = e.target.closest?.('.milkdown-image-block.cf-caption-open')
    if (!block || !e.target.matches('.caption-input')) return
    setTimeout(() => block.contains(document.activeElement) || block.classList.remove('cf-caption-open'), 0)
  })
}

function openCaption(block) {
  if (!block) return
  block.classList.add('cf-caption-open')
  let tries = 0
  const focus = () => {
    const input = block.querySelector(':scope > .caption-input')
    if (input) return input.focus()
    if (++tries < 10) requestAnimationFrame(focus)
    else block.classList.remove('cf-caption-open')
  }
  requestAnimationFrame(focus)
}

/** Right-click → Edit Alt Text: open the caption field (Milkdown shows it after its button). */
export function editCaption(block) {
  if (!block?.classList?.contains('milkdown-image-block')) return
  if (block.querySelector(':scope > .caption-input')) return openCaption(block)
  // no field yet: Milkdown's caption button makes one (and the handler above opens it)
  block.querySelector('.operation-item:not(.cf-img-full)')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
  if (!document.body.classList.contains('cf-hide-captions')) openCaption(block)
}

let viewer = null
/** The image filling the screen; arrow keys go through the document's images, Esc or a click closes. */
export function showImageFull(img) {
  if (!img?.src) return
  viewer?.close()
  const all = [...document.querySelectorAll('#wysiwyg .milkdown-image-block img')].filter((x) => x.src)
  let at = Math.max(0, all.indexOf(img))
  const box = document.createElement('div')
  box.className = 'cf-img-viewer'
  box.tabIndex = -1
  const pic = document.createElement('img')
  const cap = document.createElement('div')
  cap.className = 'cf-img-viewer-cap'
  const close = document.createElement('button')
  close.className = 'cf-img-viewer-close'
  close.title = 'Close (Esc)'
  close.textContent = '×'
  box.append(pic, cap, close)
  const show = () => {
    const cur = all[at] || img
    pic.src = cur.src
    pic.alt = cur.alt || ''
    cap.textContent = [cur.alt, all.length > 1 ? `${at + 1} / ${all.length}` : ''].filter(Boolean).join('  ·  ')
    cap.hidden = !cap.textContent
  }
  const onKey = (e) => {
    if (e.key === 'Escape') done()
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') && all.length > 1) (at = (at + 1) % all.length), show()
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && all.length > 1) (at = (at - 1 + all.length) % all.length), show()
    else return
    e.preventDefault()
    e.stopPropagation()
  }
  const done = () => {
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('fullscreenchange', onFs)
    if (document.fullscreenElement === box) document.exitFullscreen?.().catch(() => {})
    box.remove()
    viewer = null
  }
  // leaving the system's full screen (F11, Esc handled by the webview) closes the viewer too
  const onFs = () => !document.fullscreenElement && box.isConnected && entered && done()
  let entered = false
  box.addEventListener('click', (e) => e.target !== pic && done())
  pic.addEventListener('click', () => done())
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('fullscreenchange', onFs)
  show()
  document.body.append(box)
  box.focus()
  // the whole screen where the webview allows it; otherwise the window, which the overlay fills
  box.requestFullscreen?.().then(() => (entered = true)).catch(() => {})
  viewer = { close: done }
}
