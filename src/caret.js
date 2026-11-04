// A caret drawn by CaretFlow for the rendered editor, used on Linux instead of the native one.
// WebKitGTK sometimes doesn't repaint where its caret was (seen on Hyprland/Wayland with
// fractional scaling): an old caret stays on screen next to the new one, and when a table cell
// selection hides the caret, it can leave one as tall as the table. A plain element that we move
// ourselves is repainted like any other element. The native caret is made transparent in CSS
// (.drawn-caret in style.css); selections, code blocks (CodeMirror draws its own) and the gap
// cursor are untouched.
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'

/**
 * layerParent: the scroll container; the caret scrolls with it and is clipped by it.
 * enabled: () => boolean, read on every update so the setting applies at once.
 */
export function drawnCaretPlugin(layerParent, enabled) {
  return new Plugin({
    view(view) {
      const caret = document.createElement('div')
      caret.className = 'pm-caret'
      caret.setAttribute('aria-hidden', 'true')
      caret.hidden = true
      layerParent.append(caret)
      let frame = 0

      const draw = () => {
        frame = 0
        const { selection } = view.state
        const show =
          enabled() &&
          document.activeElement === view.dom && view.editable && !view.composing && selection instanceof TextSelection && selection.empty && !view.dom.closest('[hidden]')
        if (!show) {
          caret.hidden = true
          return
        }
        let c
        try {
          c = view.coordsAtPos(selection.head)
        } catch {
          caret.hidden = true
          return
        }
        const base = layerParent.getBoundingClientRect()
        const top = c.top - base.top + layerParent.scrollTop
        caret.style.transform = `translate(${Math.round(c.left - base.left)}px, ${Math.round(top)}px)`
        caret.style.height = `${Math.max(8, Math.round(c.bottom - c.top))}px`
        caret.hidden = false
        // stay solid while the caret moves, blink once it rests (like the native one)
        caret.classList.remove('blink')
        void caret.offsetWidth
        caret.classList.add('blink')
      }
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(draw)
      }

      const hide = () => {
        caret.hidden = true
      }
      view.dom.addEventListener('focus', schedule)
      view.dom.addEventListener('blur', hide)
      view.dom.addEventListener('compositionstart', hide)
      view.dom.addEventListener('compositionend', schedule)
      // layout changes that aren't transactions: images loading, font size, window width
      const ro = new ResizeObserver(schedule)
      ro.observe(view.dom)
      window.addEventListener('resize', schedule)
      schedule()

      return {
        update: schedule,
        destroy() {
          cancelAnimationFrame(frame)
          ro.disconnect()
          window.removeEventListener('resize', schedule)
          view.dom.removeEventListener('focus', schedule)
          view.dom.removeEventListener('blur', hide)
          view.dom.removeEventListener('compositionstart', hide)
          view.dom.removeEventListener('compositionend', schedule)
          caret.remove()
        },
      }
    },
  })
}
