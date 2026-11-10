// Checks for right-click: never the webview's own menu (Share → tauri.localhost, Reload…); text
// gets CaretFlow's Cut/Copy/Paste/Select All, spelling suggestions still win on underlined words.
import { check, summary, run, wait } from './lib.mjs'

/** Right-click at an element; returns whether the native menu was blocked and what CaretFlow shows. */
async function rightClick(page, selector) {
  return run(page, (sel) => {
    const t = document.querySelector(sel)
    const r = t.getBoundingClientRect()
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 })
    t.dispatchEvent(e)
    const m = document.querySelector('#ctxmenu')
    const items = m.hidden ? [] : [...m.querySelectorAll('.menu-item')].map((b) => b.querySelector('.lbl').textContent + (b.classList.contains('disabled') ? ' (off)' : ''))
    m.hidden = true
    return { blocked: e.defaultPrevented, items }
  }, selector)
}

export const scenes = {
  'ctx-menu': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: true, sidebarTab: 'files', spellcheck: false },
    async run(page) {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
      await wait(300)
      let r = await rightClick(page, '#wysiwyg .ProseMirror p')
      check('editor: native menu blocked', r.blocked)
      check('editor: Cut/Copy greyed without a selection, Paste, Select All', JSON.stringify(r.items) === '["Cut (off)","Copy (off)","Paste","Select All"]', JSON.stringify(r.items))

      r = await rightClick(page, '#sidebar')
      check('sidebar background: native menu blocked, no menu', r.blocked && !r.items.length, JSON.stringify(r))

      r = await rightClick(page, '#menus')
      check('menu bar: native menu blocked', r.blocked && !r.items.length)

      // Find box: Paste puts the clipboard text in
      await page.keyboard.press('Control+F')
      await wait(200)
      await page.evaluate(() => navigator.clipboard.writeText('pasted words'))
      r = await rightClick(page, '#find-input')
      check('find box: text menu', r.items.includes('Paste') && r.items.includes('Select All'), JSON.stringify(r.items))
      await page.click('#find-input', { button: 'right' })
      await page.click('#ctxmenu .menu-item:has-text("Paste")')
      await wait(200)
      check('Paste fills the find box', (await page.inputValue('#find-input')) === 'pasted words', await page.inputValue('#find-input'))
      await page.keyboard.press('Escape')

      // Select All, then Copy, in the editor
      await page.click('#wysiwyg .ProseMirror p', { button: 'right' })
      await page.click('#ctxmenu .menu-item:has-text("Select All")')
      await wait(100)
      await page.click('#wysiwyg .ProseMirror p', { button: 'right' })
      const copyOn = await page.$eval('#ctxmenu .menu-item:has-text("Copy")', (b) => !b.classList.contains('disabled'))
      check('after Select All, Copy is available', copyOn)
      await page.click('#ctxmenu .menu-item:has-text("Copy")')
      await wait(200)
      const clip = await page.evaluate(() => navigator.clipboard.readText())
      check('Copy copies the document', clip.includes('A quiet place to write'), clip.slice(0, 60))

      // read-only: no Cut / Paste
      await page.keyboard.press('Control+Shift+R')
      await wait(200)
      r = await rightClick(page, '#wysiwyg .ProseMirror p')
      check('read-only: only Copy and Select All', JSON.stringify(r.items.map((x) => x.replace(' (off)', ''))) === '["Copy","Select All"]', JSON.stringify(r.items))
      summary()
    },
  },
}
