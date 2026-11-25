// Customize Menus (menueditor.js): opened from Preferences → Menus; a new menu and a submenu made and
// renamed, commands dragged in from the list and out of the tree, kept after a reload, back to the
// default with Reset; a command taken out of every menu still works with its shortcut.
//   node scripts/screenshots.mjs menus --extra scripts/checks/menus.mjs --out <tmp dir>
import { check, summary, run, wait, stubBackend } from './lib.mjs'

const stored = (page) => run(page, () => JSON.parse(localStorage.getItem('caretflow.settings')))
const barMenus = (page) => run(page, () => [...document.querySelectorAll('#menus .menu-root > button')].map((b) => b.textContent))
const treeRows = (page) => run(page, () => [...document.querySelectorAll('.me-tree .me-row')].map((r) => r.querySelector('.me-label')?.textContent ?? '—'))

/** Drag with the mouse from one element's middle to a point in another (fy: 0 top … 1 bottom). */
async function dragTo(page, from, to, fy = 0.5) {
  await page.locator(to).first().scrollIntoViewIfNeeded()
  await page.locator(from).first().scrollIntoViewIfNeeded()
  const a = await page.locator(from).first().boundingBox()
  const b = await page.locator(to).first().boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * fy, { steps: 8 })
  await wait(50)
  await page.mouse.up()
  await wait(100)
}

async function openEditor(page) {
  await page.keyboard.press('Control+,')
  await wait(300)
  await page.click('.prefs-nav button:has-text("Menus")')
  await wait(100)
  await page.click('button:has-text("Customize Menus…")')
  await wait(400)
}

export const scenes = {
  menus: {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false },
    setup: (page) => stubBackend(page),
    async run(page) {
      const defaults = await barMenus(page)
      await openEditor(page)
      check('editor opens from Preferences', await page.isVisible('.me-dialog'))
      const tops = await run(page, () => [...document.querySelectorAll('.me-tree .me-row.top .me-label')].map((x) => x.textContent))
      check('tree starts with the default menus', JSON.stringify(tops) === JSON.stringify(defaults), tops.join(','))

      // a new menu, renamed; Enter in the name box must not save the dialog
      await page.click('.me-tools button:has-text("New Menu")')
      await wait(100)
      check('name box opens', await page.isVisible('.me-input'))
      await page.fill('.me-input', 'Mine')
      await page.keyboard.press('Enter')
      await wait(100)
      check('Enter renames, dialog stays open', (await page.isVisible('.me-dialog')) && (await treeRows(page)).includes('Mine'))

      // a command dragged in from the list
      await page.fill('.me-cmd-pane .kb-filter', 'save as')
      await wait(100)
      await dragTo(page, '.me-cmd:has-text("Save As…") .me-grip', '.me-row.me-t-menu:has-text("Mine")')
      let rows = await treeRows(page)
      check('dragged command lands in the menu', rows[rows.indexOf('Mine') + 1] === 'Save As…', rows.slice(rows.indexOf('Mine')).join(','))
      check('…and is marked as placed in the list', await page.isVisible('.me-cmd.placed:has-text("Save As…")'))

      // a submenu inside it, with a command dropped on its empty row
      await page.click('.me-row.me-t-menu:has-text("Mine") .me-label')
      await page.click('.me-tools button:has-text("New Submenu")')
      await wait(100)
      await page.fill('.me-input', 'Sub')
      await page.keyboard.press('Enter')
      await wait(100)
      await page.fill('.me-cmd-pane .kb-filter', 'print')
      await wait(100)
      await dragTo(page, '.me-cmd:has-text("Print…") .me-grip', '.me-emptyrow')
      rows = await treeRows(page)
      check('submenu made and filled', rows.slice(rows.indexOf('Mine'), rows.indexOf('Mine') + 4).join(',') === 'Mine,Save As…,Sub,Print…', rows.slice(rows.indexOf('Mine')).join(','))

      // reorder: Sub dragged above Save As…
      await dragTo(page, '.me-row.me-t-menu:has-text("Sub") .me-grip', '.me-row:has-text("Save As…") >> nth=-1', 0.2)
      rows = await treeRows(page)
      check('submenu moved above the command', rows.slice(rows.indexOf('Mine'), rows.indexOf('Mine') + 4).join(',') === 'Mine,Sub,Print…,Save As…', rows.slice(rows.indexOf('Mine')).join(','))

      // a command dragged out to the list is removed
      await dragTo(page, '.me-row:has-text("Quick Open…")', '.me-cmds')
      check('dragged out of the tree: removed', !(await treeRows(page)).includes('Quick Open…'))
      // Undo brings it back, redo by dragging again
      await page.click('.me-bottom button:has-text("Undo")')
      await wait(100)
      check('Undo brings it back', (await treeRows(page)).includes('Quick Open…'))
      await dragTo(page, '.me-row:has-text("Quick Open…")', '.me-cmds')

      // keyboard: Alt+Up moves the selected row
      await page.click('.me-row:has-text("Open Folder…") .me-label')
      const before = await treeRows(page)
      await page.keyboard.press('Alt+ArrowUp')
      await wait(100)
      const after = await treeRows(page)
      const i = before.indexOf('Open Folder…')
      check('Alt+Up moves a row', after[i - 1] === 'Open Folder…' && after[i] === before[i - 1], `${before[i - 1]} → ${after[i]}`)

      await page.click('.modal-btns button:has-text("Save")')
      await wait(300)
      check('back in Preferences after saving', await page.isVisible('.prefs-dialog'))
      await page.keyboard.press('Escape')
      await wait(100)
      const bar = await barMenus(page)
      check('menu bar shows the new menu', bar.includes('Mine'), bar.join(','))
      await page.click('#menus .menu-root > button:has-text("Mine")')
      await wait(100)
      const mine = await run(page, () => [...document.querySelectorAll('#menus .menu-pop > .menu-item .lbl')].map((x) => x.textContent))
      check('new menu has the submenu and command', mine.join(',') === 'Sub,Save As…', mine.join(','))
      await page.hover('.menu-pop .menu-item:has-text("Sub")')
      await wait(100)
      const sub = await run(page, () => [...document.querySelectorAll('.menu-pop .menu-pop .menu-item .lbl')].map((x) => x.textContent))
      check('submenu shows its command', sub.join(',') === 'Print…', sub.join(','))
      await page.keyboard.press('Escape')
      await page.click('#menus .menu-root > button:has-text("File")')
      await wait(100)
      const file = await run(page, () => [...document.querySelectorAll('#menus .menu-pop > .menu-item .lbl')].map((x) => x.textContent))
      check('removed command is gone from File', !file.includes('Quick Open…') && file.includes('Open…'), file.join(','))
      check('moved command is in its new place', file.indexOf('Open Folder…') < file.indexOf('Open Recent'), file.join(','))
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+p')
      await wait(200)
      check('its shortcut still works', await page.isVisible('#palette'))
      await page.keyboard.press('Escape')

      const st = await stored(page)
      check('layout saved', st.menuLayout?.menus?.some((m) => m.label === 'Mine') && st.menuLayout.known.length > 50)
      // the harness writes the scene's settings on every load; this carries the layout over
      await run(page, (l) => sessionStorage.setItem('test.override', JSON.stringify({ menuLayout: l })), st.menuLayout)
      await page.reload()
      await wait(1500)
      check('kept after a reload', (await barMenus(page)).includes('Mine'))

      // a command from a newer version is put after its neighbor
      await run(page, () => {
        const s = JSON.parse(localStorage.getItem('caretflow.settings'))
        s.menuLayout.known = s.menuLayout.known.filter((id) => id !== 'File/Save')
        s.menuLayout.menus[0].items = s.menuLayout.menus[0].items.filter((id) => id !== 'File/Save')
        sessionStorage.setItem('test.override', JSON.stringify({ menuLayout: s.menuLayout }))
      })
      await page.reload()
      await wait(1500)
      await page.click('#menus .menu-root > button:has-text("File")')
      await wait(100)
      const file2 = await run(page, () => [...document.querySelectorAll('#menus .menu-pop > .menu-item .lbl')].map((x) => x.textContent))
      check('a new command shows up in its default place', file2.includes('Save') && file2.indexOf('Save') < file2.indexOf('Save As…'), file2.join(','))
      await page.keyboard.press('Escape')

      // Cancel leaves the menus alone
      await openEditor(page)
      await page.click('.me-bottom button:has-text("Reset to Default")')
      await page.click('.modal-btns button:has-text("Cancel")')
      await wait(200)
      await page.keyboard.press('Escape')
      await wait(100)
      check('Cancel keeps your menus', (await barMenus(page)).includes('Mine'))

      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Menus")')
      await page.click('.me-pref-btns button:has-text("Reset to Default")')
      await wait(200)
      check('Reset to Default in Preferences', JSON.stringify(await barMenus(page)) === JSON.stringify(defaults))
      check('…and forgets the layout', (await stored(page)).menuLayout === null)
      await page.keyboard.press('Escape')

      // all four themes and a small window: the editor fits
      for (const theme of ['paper', 'ink']) {
        await run(page, (t) => document.documentElement.setAttribute('data-theme', t), theme)
        await page.setViewportSize({ width: 560, height: 640 })
        await page.click('#menus .menu-root > button:has-text("Help")').catch(() => {})
        await page.click('.menu-item:has-text("Customize Menus…")').catch(() => {})
        await wait(300)
        const fits = await run(page, () => {
          const b = document.querySelector('.me-dialog').getBoundingClientRect()
          const panes = [...document.querySelectorAll('.me-pane')].map((p) => p.getBoundingClientRect().height)
          return b.right <= innerWidth && b.bottom <= innerHeight && panes.every((h) => h > 80)
        })
        check(`fits a small window (${theme})`, fits)
        await page.screenshot({ path: process.env.OUT_DIR ? `${process.env.OUT_DIR}/menus-${theme}.png` : undefined }).catch(() => {})
        await page.keyboard.press('Escape')
        await wait(100)
      }
      await page.setViewportSize({ width: 1280, height: 800 })
      summary()
    },
  },
  // templates: every id they name exists, each one picked from the popup becomes the menu bar and
  // keeps the way back (Preferences…, Customize Menus…); Preferences opens the editor with one
  'menu-templates': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false, extensions: ['ai', 'cloud', 'typing', 'discord'] },
    setup: (page) => stubBackend(page),
    async run(page) {
      await page.click('#menus .menu-root > button:has-text("Help")')
      await page.click('.menu-item:has-text("Customize Menus…")')
      await wait(400)
      const r = await run(page, async () => {
        const ids = new Set([...document.querySelectorAll('.me-tree .me-row')].map((x) => x._node.id).filter(Boolean))
        const folders = new Set()
        const walk = (rows) => {
          const stack = []
          for (const x of rows) {
            const d = +x.style.getPropertyValue('--depth')
            stack.length = d
            if (x._node.t === 'menu') {
              stack[d] = x._node.label
              folders.add(stack.slice(0, d + 1).join('/'))
            }
          }
        }
        walk(document.querySelectorAll('.me-tree .me-row'))
        const { MENU_TEMPLATES } = await import('/src/menutemplates.js')
        const missing = []
        const check = (items, t) => {
          for (const x of items) {
            if (x === '-') continue
            if (typeof x === 'string') (x.startsWith('@') ? folders.has(x.slice(1)) : ids.has(x)) || missing.push(`${t}: ${x}`)
            else check(x.items, t)
          }
        }
        for (const t of MENU_TEMPLATES) check(t.menus, t.id)
        return { missing, names: MENU_TEMPLATES.map((t) => [t.id, t.menus.map((m) => m.label)]) }
      })
      if (r.error) return check('templates read', false, r.error)
      check('every command a template names exists', !r.missing.length, r.missing.join(', '))
      check('five templates', r.names.length === 5)

      for (const [id, labels] of r.names) {
        await page.click('.me-bottom button:has-text("Templates…")')
        await wait(100)
        check(`${id}: popup lists the templates`, (await page.locator('.me-tpl').count()) === 5)
        await page.click(`.me-tpl[data-tpl="${id}"]`)
        await wait(100)
        const tops = await run(page, () => [...document.querySelectorAll('.me-tree .me-row.top .me-label')].map((x) => x.textContent))
        check(`${id}: tree shows its menus`, JSON.stringify(tops) === JSON.stringify(labels), tops.join(','))
        await page.click('.modal-btns button:has-text("Save")')
        await wait(300)
        const bar = await run(page, () => [...document.querySelectorAll('#menus .menu-root > button')].map((b) => b.textContent))
        check(`${id}: menu bar follows`, JSON.stringify(bar) === JSON.stringify(labels), bar.join(','))
        const all = await run(page, () => {
          const ids = []
          const walk = (items) => items.forEach((x) => (typeof x === 'string' ? ids.push(x) : x && walk(x.items)))
          walk(JSON.parse(localStorage.getItem('caretflow.settings')).menuLayout.menus)
          return ids
        })
        check(`${id}: keeps Preferences and Customize Menus`, all.some((x) => x.endsWith('/Preferences…')) && all.includes('Help/Customize Menus…'))
        // every menu opens with something in it
        for (const l of labels) {
          await page.click(`#menus .menu-root > button:text-is("${l}")`)
          await wait(60)
          const n = await run(page, () => document.querySelectorAll('#menus .menu-pop > .menu-item:not(.disabled)').length)
          if (n < 2) check(`${id}: ${l} has commands`, false, String(n))
          await page.keyboard.press('Escape')
        }
        await page.click('#menus .menu-root > button:has-text("Help")')
        await page.click('.menu-item:has-text("Customize Menus…")')
        await wait(300)
      }
      // Undo after a template brings back the menus you had
      const before = await run(page, () => [...document.querySelectorAll('.me-tree .me-row.top .me-label')].map((x) => x.textContent))
      await page.click('.me-bottom button:has-text("Templates…")')
      await page.click('.me-tpl[data-tpl="minimal"]')
      await page.click('.me-bottom button:has-text("Undo")')
      await wait(100)
      const after = await run(page, () => [...document.querySelectorAll('.me-tree .me-row.top .me-label')].map((x) => x.textContent))
      check('Undo after a template', JSON.stringify(before) === JSON.stringify(after), after.join(','))
      // Esc closes the popup, not the dialog
      await page.click('.me-bottom button:has-text("Templates…")')
      await page.keyboard.press('Escape')
      await wait(100)
      check('Esc closes only the popup', !(await page.isVisible('.me-tpls')) && (await page.isVisible('.me-dialog')))
      await page.screenshot({ path: process.env.OUT_DIR ? `${process.env.OUT_DIR}/menu-templates.png` : undefined }).catch(() => {})
      await page.click('.modal-btns button:has-text("Cancel")')
      await wait(200)

      // Preferences → Menus → Start from a template opens the editor with it
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Menus")')
      await page.click('.pref-row:has-text("Start from a template") .fsel')
      await wait(100)
      await page.click('text="Writer"')
      await wait(400)
      const tops = await run(page, () => [...document.querySelectorAll('.me-tree .me-row.top .me-label')].map((x) => x.textContent))
      check('Preferences opens the editor with the template', tops.includes('Review') && tops.includes('Format'), tops.join(','))
      summary()
    },
  },
}
