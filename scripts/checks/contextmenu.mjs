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
      check('editor: Cut/Copy greyed without a selection, Paste, Select All', JSON.stringify(r.items) === '["Cut (off)","Copy (off)","Paste","Paste as Plain Text","Paste as Markdown","Select All"]', JSON.stringify(r.items))

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
      await page.click('#ctxmenu .menu-item >> text="Paste"')
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
  'ctx-paste': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false },
    async run(page) {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
      await wait(300)
      const html = '<p>See <a href="https://example.com">the site</a> and <b>this</b>.</p>'
      const text = 'See the site and this.'
      const setClip = (h, t) =>
        page.evaluate(([h, t]) => {
          const items = { 'text/plain': new Blob([t], { type: 'text/plain' }) }
          if (h) items['text/html'] = new Blob([h], { type: 'text/html' })
          return navigator.clipboard.write([new ClipboardItem(items)])
        }, [h, t])
      // start from an empty document; each paste goes into a new last paragraph
      await page.click('#wysiwyg .ProseMirror')
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Delete')
      await wait(100)
      let first = true
      const freshLine = async () => {
        await page.keyboard.press('Control+End')
        if (!first) await page.keyboard.press('Enter')
        first = false
        await wait(100)
      }
      const lastPara = () => page.$eval('#wysiwyg .ProseMirror', (pm) => [...pm.querySelectorAll(':scope > p')].filter((p) => p.textContent.trim()).pop()?.innerHTML || '')
      // the menu opened without a real click, so the cursor stays where freshLine put it
      const pasteVia = async (label) => {
        await page.$eval('#wysiwyg .ProseMirror', (pm) => {
          pm.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }))
        })
        await page.click(`#ctxmenu .menu-item >> text="${label}"`)
        await wait(300)
      }

      await setClip(html, text)
      await freshLine()
      await pasteVia('Paste')
      let p = await lastPara()
      check('Paste keeps the link and bold', p.includes('<a') && /<strong>this<\/strong>/.test(p), p)

      await freshLine()
      await pasteVia('Paste as Plain Text')
      p = await lastPara()
      check('Paste as Plain Text: the text, no link or bold', !p.includes('<a') && !p.includes('<strong') && p.includes('See the site and this.'), p)

      await setClip('<pre><span style="color:red">**strong**</span> text</pre>', '**strong** text')
      await freshLine()
      await pasteVia('Paste as Plain Text')
      p = await lastPara()
      check('Paste as Plain Text keeps Markdown characters as text', p.includes('**strong**') && !p.includes('<strong'), p)

      await freshLine()
      await pasteVia('Paste as Markdown')
      p = await lastPara()
      check('Paste as Markdown reads the text as Markdown, not the HTML', /<strong>strong<\/strong> text/.test(p), p)

      await setClip('', 'first line\nsecond line')
      await freshLine()
      await page.keyboard.press('Control+Shift+V')
      await wait(300)
      const two = await page.$eval('#wysiwyg .ProseMirror', (pm) => [...pm.querySelectorAll(':scope > p')].map((p) => p.textContent).slice(-2).join('|'))
      check('Ctrl+Shift+V: one paragraph per line', two === 'first line|second line', two)

      // source mode: Paste as Markdown turns HTML into Markdown
      await page.keyboard.press('Control+/')
      await wait(800)
      await setClip(html, text)
      await page.click('.cm-content')
      await page.keyboard.press('Control+End')
      await page.keyboard.press('Enter')
      await page.$eval('.cm-content', (c) => c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2 })))
      await page.click('#ctxmenu .menu-item >> text="Paste as Markdown"')
      await wait(300)
      // the whole source through Copy as Markdown (CodeMirror only draws the lines on screen)
      await page.keyboard.press('Control+Shift+C')
      await wait(200)
      const src = await page.evaluate(() => navigator.clipboard.readText())
      check('source mode: Paste as Markdown converts the HTML', /\[the site\]\(https:\/\/example\.com\/?\)/.test(src) && src.includes('**this**'), src.slice(-80))
      await page.keyboard.press('Control+/')
      await wait(500)
      summary()
    },
  },
}
