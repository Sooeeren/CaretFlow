// Checks for issues #28 and #29: Vim scrolling (Ctrl-E / Ctrl-Y), the color of command-line messages,
// insert-mode Ctrl-W on an indented empty line, :Explore, and the cursor keeping its place when the
// mode changes.
import { check, summary, stubBackend, wait } from './lib.mjs'

const DIR = 'C:\\Users\\you\\Documents\\Notes'
// written the way a person would (`*` bullets, `__bold__`), so the rendered editor's own Markdown
// differs from the file and the cursor has to be matched between the two
const section = (n) => `## Section ${n}\n\nParagraph ${n} has __bold__ words and a [link](https://example.com/${n}) inside, unique tok${n} here.\n\n* bullet one ${n}\n* bullet two ${n}\n`
const DOC = '# Title\n\nIntro paragraph.\n\n' + Array.from({ length: 60 }, (_, i) => section(i + 1)).join('\n')

const backend = () => ({
  read_text: ({ path }) => (path.endsWith('Other.md') ? '# Other file\n\nOther text.\n' : DOC),
  is_dir: ({ path }) => path === DIR || path === DIR + '\\Sub',
  list_dir: ({ path }) =>
    path === DIR
      ? [
          { name: 'Sub', path: DIR + '\\Sub', dir: true },
          { name: 'Other.md', path: DIR + '\\Other.md', dir: false },
          { name: 'Welcome.md', path: DIR + '\\Welcome.md', dir: false },
        ]
      : path === DIR + '\\Sub'
        ? [{ name: 'Deep.md', path: DIR + '\\Sub\\Deep.md', dir: false }]
        : [],
})
const VIM = { vim: true, lastMode: 'source', sidebar: false, spellcheck: false, autocorrect: false }
const top = (page) => page.evaluate(() => document.querySelector('#scroller').scrollTop)
const title = (page) => page.evaluate(() => document.title)
const scrollTo = async (page, part) => {
  await page.evaluate((f) => {
    const sc = document.querySelector('#scroller')
    sc.scrollTop = sc.scrollHeight * f
  }, part)
  await wait(400)
}
/** the line the source cursor is on, and whether it is inside the visible part */
const srcCursor = (page) =>
  page.evaluate(() => {
    const line = document.querySelector('#source .cm-activeLine')
    const box = document.querySelector('#scroller').getBoundingClientRect()
    const r = line?.getBoundingClientRect()
    return { text: line?.textContent ?? null, visible: !!r && r.top >= box.top - 2 && r.bottom <= box.bottom + 2, y: r ? Math.round(r.top - box.top) : null }
  })
/** where the rendered cursor is: the text around it, and whether it is inside the visible part */
const pmCursor = (page) =>
  page.evaluate(() => {
    const sel = getSelection()
    const n = sel.anchorNode
    const box = document.querySelector('#scroller').getBoundingClientRect()
    const el = n?.nodeType === 3 ? n.parentElement : n
    const r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
    const y = r && r.height ? r.top : el?.getBoundingClientRect?.().top
    return {
      inEditor: !!el?.closest?.('#wysiwyg .ProseMirror'),
      focused: !!document.activeElement?.closest?.('#wysiwyg .ProseMirror'),
      before: n?.nodeType === 3 ? n.textContent.slice(0, sel.anchorOffset) : '',
      after: n?.nodeType === 3 ? n.textContent.slice(sel.anchorOffset) : '',
      block: el?.closest?.('p, li, h1, h2, h3')?.textContent ?? '',
      visible: y != null && y >= box.top - 2 && y <= box.bottom + 2,
      y: y != null ? Math.round(y - box.top) : null,
    }
  })
const ex = async (page, cmd) => {
  await page.keyboard.press('Escape')
  await page.keyboard.type(':' + cmd)
  await page.keyboard.press('Enter')
  await wait(350)
}
const toSource = async (page) => {
  await page.keyboard.press('Control+/')
  await page.waitForSelector('#source .cm-editor')
  await wait(700)
}
const toRendered = async (page) => {
  await page.keyboard.press('Control+/')
  await page.waitForSelector('#wysiwyg .ProseMirror')
  await wait(700)
}

export const scenes = {
  // #28: Ctrl-E / Ctrl-Y scroll the text line by line; the page keys move by what is visible
  'vim-scroll': {
    open: 'Welcome.md',
    settings: VIM,
    setup: (page) => stubBackend(page, backend()),
    async run(page) {
      await page.click('#source .cm-content')
      await page.keyboard.press('Escape')
      await page.keyboard.type('gg')
      await wait(200)
      const lineH = await page.evaluate(() => [...document.querySelectorAll('#source .cm-line')].find((l) => l.textContent.startsWith('Intro')).getBoundingClientRect().height)
      const t0 = await top(page)
      for (let i = 0; i < 3; i++) await page.keyboard.press('Control+e')
      await wait(250)
      const t1 = await top(page)
      check('Ctrl-E scrolls down line by line', Math.abs(t1 - t0 - 3 * lineH) < lineH, `${t0} → ${t1}, line ${lineH}`)
      const c1 = await srcCursor(page)
      check('the cursor stays in view after Ctrl-E', c1.visible, JSON.stringify(c1))
      await page.keyboard.press('Control+y')
      await wait(250)
      const t2 = await top(page)
      check('Ctrl-Y scrolls up one line', Math.abs(t1 - t2 - lineH) < lineH * 0.6, `${t1} → ${t2}`)
      for (let i = 0; i < 5; i++) await page.keyboard.press('Control+y')
      await wait(250)
      check('Ctrl-Y stops at the top', (await top(page)) === 0, String(await top(page)))

      // a count: 5 CTRL-E
      await page.keyboard.type('5')
      await page.keyboard.press('Control+e')
      await wait(250)
      const t3 = await top(page)
      check('5 Ctrl-E scrolls five lines', Math.abs(t3 - 5 * lineH) < lineH * 1.5, String(t3))

      // Ctrl-F: one page forward, not the end of the document
      await page.keyboard.type('gg')
      await wait(200)
      const view = await page.evaluate(() => document.querySelector('#scroller').clientHeight)
      const max = await page.evaluate(() => document.querySelector('#scroller').scrollHeight - document.querySelector('#scroller').clientHeight)
      await page.keyboard.press('Control+f')
      await wait(300)
      const f = await srcCursor(page)
      const t4 = await top(page)
      check('Ctrl-F moves about one page', t4 > view * 0.3 && t4 < view * 1.6 && t4 < max - view, `top ${t4}, page ${view}, end ${max}`)
      check('the cursor is in view after Ctrl-F', f.visible, JSON.stringify(f))
      await page.keyboard.press('Control+b')
      await wait(300)
      check('Ctrl-B moves back', (await top(page)) < t4, String(await top(page)))

      // Ctrl-D: half a page
      await page.keyboard.type('gg')
      await wait(200)
      await page.keyboard.press('Control+d')
      await wait(300)
      const t5 = await top(page)
      check('Ctrl-D scrolls about half a page', t5 > view * 0.25 && t5 < view * 0.8, `top ${t5}, page ${view}`)

      // zt / zz put the cursor's line at the top / in the middle
      await page.keyboard.type('60Gzt')
      await wait(300)
      const zt = await srcCursor(page)
      check('zt puts the line at the top', zt.y != null && zt.y < lineH * 2.5, JSON.stringify(zt))
      await page.keyboard.type('zz')
      await wait(300)
      const zz = await srcCursor(page)
      check('zz centers the line', zz.y != null && Math.abs(zz.y - view / 2) < lineH * 2.5, `${zz.y} of ${view}`)
      // H / L: the first and last line that can be seen (the text itself hardly moves)
      const before = await top(page)
      await page.keyboard.type('H')
      await wait(250)
      const hi = await srcCursor(page)
      check('H goes to the top line of the window', hi.visible && hi.y < lineH * 3 && Math.abs((await top(page)) - before) < lineH * 2, JSON.stringify(hi))
      await page.keyboard.type('L')
      await wait(250)
      const lo = await srcCursor(page)
      check('L goes to the bottom line of the window', lo.visible && lo.y > view - lineH * 4 && Math.abs((await top(page)) - before) < lineH * 2, JSON.stringify(lo))
      summary()
    },
  },

  // #29: messages are red only when something failed
  'vim-messages': {
    open: 'Welcome.md',
    settings: VIM,
    setup: (page) => stubBackend(page, backend()),
    async run(page) {
      await page.click('#source .cm-content')
      await page.keyboard.press('Escape')
      const msg = () =>
        page.evaluate(() => {
          const m = document.querySelector('#source-panels .cm-vim-message')
          const probe = document.createElement('span')
          probe.style.color = 'red'
          document.body.append(probe)
          const red = getComputedStyle(probe).color
          probe.remove()
          return m ? { text: m.textContent, color: getComputedStyle(m).color, red, fg: getComputedStyle(document.querySelector('#source-panels .cm-panels')).color } : null
        })
      await page.keyboard.type('3yy')
      await wait(300)
      const ok = await msg()
      check('a message is shown after 3yy', !!ok && /3 lines yanked/.test(ok.text), JSON.stringify(ok))
      check('a success message has the normal text color', !!ok && ok.color === ok.fg && ok.color !== ok.red, JSON.stringify(ok))
      await ex(page, 'nosuchcommand')
      const bad = await msg()
      check('an unknown command is reported', !!bad && /Not an editor command/.test(bad.text), JSON.stringify(bad))
      check('an error message stands out', !!bad && bad.color !== bad.fg, JSON.stringify(bad))
      await ex(page, 'set nosuchoption')
      const bad2 = await msg()
      check('a wrong option is an error too', !!bad2 && bad2.color !== bad2.fg, JSON.stringify(bad2))
      summary()
    },
  },

  // #29: Ctrl-W on a line of indentation deletes back to the start of that line only
  'vim-ctrlw': {
    open: 'Welcome.md',
    settings: VIM,
    setup: (page) => stubBackend(page, backend()),
    async run(page) {
      await page.click('#source .cm-content')
      await page.keyboard.press('Escape')
      await page.keyboard.type('ggo')
      await page.keyboard.type('alpha beta')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      const lines = () =>
        page.evaluate(() => {
          const cur = document.querySelector('#source .cm-activeLine')
          return { cur: cur.textContent, prev: cur.previousElementSibling?.textContent, n: document.querySelectorAll('#source .cm-line').length }
        })
      const before = await lines()
      check('the line holds only indentation', /^\s+$/.test(before.cur) && before.prev === 'alpha beta', JSON.stringify(before))
      await page.keyboard.press('Control+w')
      await wait(200)
      const after = await lines()
      check('Ctrl-W empties the indented line', after.cur === '', JSON.stringify(after))
      check('the line above keeps its last word', after.prev === 'alpha beta' && after.n === before.n, JSON.stringify(after))
      // at the start of a line it joins the line above, as Backspace does
      await page.keyboard.press('Control+w')
      await wait(200)
      const joined = await lines()
      check('at the start of a line Ctrl-W joins it to the line above', joined.cur === 'alpha beta' && joined.n === before.n - 1, JSON.stringify(joined))
      // a word and the blanks after it
      await page.keyboard.type(' gamma   ')
      await page.keyboard.press('Control+w')
      await wait(200)
      check('Ctrl-W deletes the word before the cursor', (await lines()).cur === 'alpha beta ', JSON.stringify(await lines()))
      await page.keyboard.type('x.,;')
      await page.keyboard.press('Control+w')
      await wait(200)
      check('punctuation is a word of its own', (await lines()).cur === 'alpha beta x', JSON.stringify(await lines()))
      await page.keyboard.type('!')
      check('still in insert mode', (await lines()).cur === 'alpha beta x!', JSON.stringify(await lines()))
      summary()
    },
  },

  // #29: :Explore opens the file tree with Vim keys; Escape goes back; :Explore again closes it
  'vim-explore': {
    open: 'Welcome.md',
    settings: VIM,
    setup: (page) => stubBackend(page, backend()),
    async run(page) {
      const state = () =>
        page.evaluate(() => ({
          sidebar: !document.body.classList.contains('no-sidebar'),
          files: !!document.querySelector('#sb-files')?.classList.contains('active'),
          inTree: !!document.activeElement?.closest?.('#tree'),
          inEditor: !!document.activeElement?.closest?.('#source .cm-editor'),
          sel: document.querySelector('#tree .tree-row.kb .nm')?.textContent ?? null,
          rows: [...document.querySelectorAll('#tree .tree-row')].filter((r) => r.offsetParent).map((r) => r.querySelector('.nm').textContent),
          title: document.title,
        }))
      // the keys do nothing in a tree that was opened the usual way
      await page.click('#source .cm-content')
      await page.keyboard.press('Control+Shift+2') // View → Files
      await wait(400)
      let s = await state()
      check('the file tree is open the usual way', s.sidebar && s.files && s.rows.length === 3, JSON.stringify(s))
      await page.click('#tree .tree-row.dir')
      await wait(300)
      await page.keyboard.press('j')
      s = await state()
      check('without :Explore the tree has no Vim keys', s.sel === null, JSON.stringify(s))
      await page.click('#tree .tree-row.dir')
      await wait(300)
      await page.keyboard.press('Control+Shift+2') // again: closes the sidebar
      await wait(300)
      check('the sidebar is closed again', !(await state()).sidebar, JSON.stringify(await state()))

      await page.click('#source .cm-content')
      await ex(page, 'Explore')
      s = await state()
      check(':Explore opens the file tree', s.sidebar && s.files, JSON.stringify(s))
      check('the keyboard is in the tree', s.inTree, JSON.stringify(s))
      check('the open file is selected', s.sel === 'Welcome', JSON.stringify(s))
      await page.keyboard.press('k')
      check('k moves up', (await state()).sel === 'Other', JSON.stringify(await state()))
      await page.keyboard.press('k')
      check('k moves to the folder', (await state()).sel === 'Sub')
      await page.keyboard.press('k')
      check('k stops at the first row', (await state()).sel === 'Sub')
      await page.keyboard.press('l')
      await wait(300)
      s = await state()
      check('l opens a folder', s.rows.includes('Deep') && s.sel === 'Sub', JSON.stringify(s))
      await page.keyboard.press('l')
      check('l again goes into it', (await state()).sel === 'Deep')
      await page.keyboard.press('h')
      check('h goes to the folder of a file', (await state()).sel === 'Sub')
      await page.keyboard.press('h')
      await wait(300)
      s = await state()
      check('h closes an open folder', !s.rows.includes('Deep') && s.sel === 'Sub', JSON.stringify(s))
      await page.keyboard.press('G')
      check('G goes to the last row', (await state()).sel === 'Welcome')
      await page.keyboard.type('gg')
      check('gg goes to the first row', (await state()).sel === 'Sub')
      await page.keyboard.press('j')
      check('j moves down', (await state()).sel === 'Other')

      // Escape: back to the text, the tree stays
      await page.keyboard.press('Escape')
      await wait(200)
      s = await state()
      check('Escape puts the cursor back in the document', s.inEditor && s.sidebar, JSON.stringify(s))
      await page.keyboard.type('gg')
      await wait(200)
      check('keys go to the editor again', (await srcCursor(page)).text === '# Title', JSON.stringify(await srcCursor(page)))

      // :Explore again closes it
      await ex(page, 'Explore')
      s = await state()
      check(':Explore again closes the file tree', !s.sidebar && s.inEditor, JSON.stringify(s))

      // Enter opens the selected file and goes to its text
      await ex(page, 'Ex')
      s = await state()
      check(':Ex is short for :Explore', s.sidebar && s.inTree, JSON.stringify(s))
      await page.keyboard.type('gg')
      await page.keyboard.press('j')
      await page.keyboard.press('Enter')
      await wait(800)
      s = await state()
      const opened = await page.evaluate(() => document.querySelector('#source .cm-content').textContent)
      check('Enter opens the file', opened.startsWith('# Other file'), opened.slice(0, 60))
      check('the tree marks it as the open file', (await page.evaluate(() => document.querySelector('#tree .tree-row.current .nm')?.textContent)) === 'Other')
      check('and puts the cursor in it', s.inEditor, JSON.stringify(s))
      await ex(page, 'Explore')
      check('the tree closes with :Explore after opening a file', !(await state()).sidebar, JSON.stringify(await state()))
      summary()
    },
  },

  // #29: the cursor keeps its place when the mode changes (rendered → source → rendered)
  'mode-cursor': {
    open: 'Welcome.md',
    settings: { vim: false, sidebar: false, spellcheck: false, autocorrect: false },
    setup: (page) => stubBackend(page, backend()),
    async run(page) {
      const t0 = await title(page)
      // rendered → source: the end of a paragraph far down
      await page.evaluate(() => [...document.querySelectorAll('#wysiwyg p')].find((p) => p.textContent.includes('tok30 '))?.scrollIntoView({ block: 'center' }))
      await wait(300)
      await page.locator('#wysiwyg p', { hasText: 'tok30 ' }).click()
      await page.keyboard.press('End')
      await wait(200)
      const a = await pmCursor(page)
      check('the cursor is at the end of paragraph 30', a.block.includes('tok30') && a.after === '', JSON.stringify(a))
      await toSource(page)
      let s = await srcCursor(page)
      check('source mode: the cursor is on the same paragraph', !!s.text && s.text.includes('tok30 here.'), JSON.stringify(s))
      check('source mode: that line is in view', s.visible, JSON.stringify(s))
      check('source mode: at about the same height', s.y != null && Math.abs(s.y - a.y) < 60, `${a.y} → ${s.y}`)
      check('the document does not count as changed', (await title(page)) === t0, await title(page))
      await page.keyboard.type('Z')
      s = await srcCursor(page)
      check('source mode: at the same place in the line', !!s.text && s.text.endsWith('tok30 here.Z'), JSON.stringify(s))
      await page.keyboard.press('Backspace')

      // source → rendered: a place inside a line, right after the bold word
      await scrollTo(page, 0.72)
      const lineText = await page.evaluate(() => {
        const box = document.querySelector('#scroller').getBoundingClientRect()
        const l = [...document.querySelectorAll('#source .cm-line')].find((l) => /^Paragraph \d+ has/.test(l.textContent) && l.getBoundingClientRect().top > box.top + 60)
        l.dataset.pick = '1'
        return l.textContent
      })
      const num = /^Paragraph (\d+)/.exec(lineText)[1]
      await page.click('#source .cm-line[data-pick]')
      await page.keyboard.press('Home')
      for (let i = lineText.indexOf(' words'); i > 0; i--) await page.keyboard.press('ArrowRight')
      await wait(200)
      const b = await srcCursor(page)
      await toRendered(page)
      let r = await pmCursor(page)
      check('rendered view: the cursor is in the same paragraph', r.inEditor && r.block.startsWith(`Paragraph ${num} has`), JSON.stringify(r))
      check('rendered view: right after the bold word', r.before.endsWith('bold') && r.block.startsWith(`Paragraph ${num} has bold words`), JSON.stringify(r))
      check('rendered view: the editor has the keyboard', r.focused, JSON.stringify(r))
      check('rendered view: the cursor is in view', r.visible, JSON.stringify(r))
      check('rendered view: at about the same height', r.y != null && Math.abs(r.y - b.y) < 60, `${b.y} → ${r.y}`)
      check('the document still does not count as changed', (await title(page)) === t0, await title(page))
      await page.keyboard.type('Q')
      r = await pmCursor(page)
      check('typing goes to that place', r.block.startsWith(`Paragraph ${num} has boldQ words`), JSON.stringify(r))

      // and back: the document is edited now, the cursor is right after the Q
      await toSource(page)
      await page.keyboard.type('W')
      s = await srcCursor(page)
      check('back in source mode after an edit: same place', !!s.text && /boldQ(\*\*|__)W words|boldQW(\*\*|__) words/.test(s.text) && s.text.startsWith(`Paragraph ${num} `), JSON.stringify(s))
      check('and in view', s.visible, JSON.stringify(s))

      // the end of a list item
      await scrollTo(page, 0.3)
      const item = await page.evaluate(() => {
        const box = document.querySelector('#scroller').getBoundingClientRect()
        const l = [...document.querySelectorAll('#source .cm-line')].find((l) => /^[*-] bullet two \d+/.test(l.textContent) && l.getBoundingClientRect().top > box.top + 60)
        l.dataset.pick2 = '1'
        return l.textContent
      })
      await page.click('#source .cm-line[data-pick2]')
      await page.keyboard.press('End')
      await toRendered(page)
      r = await pmCursor(page)
      check('a list item: the cursor is at its end', r.block === item.slice(2) && r.after === '' && r.visible, JSON.stringify(r) + ' ' + item)

      // a heading, from the rendered view
      await scrollTo(page, 0.55)
      const h2 = await page.evaluate(() => {
        const box = document.querySelector('#scroller').getBoundingClientRect()
        const r = [...document.querySelectorAll('#wysiwyg h2')].find((h) => h.getBoundingClientRect().top > box.top + 60)
        const b = r.getBoundingClientRect()
        return { text: r.textContent, x: b.left + 40, y: b.top + b.height / 2 }
      })
      const head = h2.text
      await page.mouse.click(h2.x, h2.y)
      await page.keyboard.press('Home')
      await toSource(page)
      await page.keyboard.type('Y')
      s = await srcCursor(page)
      check('a heading: the cursor is at the start of its text', s.text === '## Y' + head && s.visible, JSON.stringify(s))
      summary()
    },
  },

  // #29 with Vim: /search, :pre and back
  'mode-cursor-vim': {
    open: 'Welcome.md',
    settings: VIM,
    setup: (page) => stubBackend(page, backend()),
    async run(page) {
      await page.click('#source .cm-content')
      await page.keyboard.press('Escape')
      await page.keyboard.type('/tok41 ')
      await page.keyboard.press('Enter')
      await wait(400)
      const s0 = await srcCursor(page)
      check('the search found the line', !!s0.text && s0.text.includes('tok41 '), JSON.stringify(s0))
      await ex(page, 'pre')
      await page.waitForSelector('#wysiwyg .ProseMirror')
      await wait(700)
      const r = await pmCursor(page)
      check(':pre keeps the cursor on the word', r.after.startsWith('tok41 here.') && r.block.startsWith('Paragraph 41 '), JSON.stringify(r))
      check(':pre shows that place', r.visible && r.focused, JSON.stringify(r))
      // back to Vim: the cursor is on the same character, in normal mode
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await toSource(page)
      const s1 = await srcCursor(page)
      check('back in Vim: the cursor is on the same line', !!s1.text && s1.text.includes('tok41 here.') && s1.visible, JSON.stringify(s1))
      await page.keyboard.type('x')
      await wait(200)
      const s2 = await srcCursor(page)
      check('back in Vim: on the same character', !!s2.text && s2.text.includes('unique to41 here.'), JSON.stringify(s2))
      summary()
    },
  },
}
