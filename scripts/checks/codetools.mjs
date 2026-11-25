// Code block tools and the title bar in narrow windows: the language button never covers code
// (wrapped or not), its open list lies over the other blocks, and the window buttons stay visible
// while menus that don't fit move into a » menu.
//   node scripts/screenshots.mjs codetools --extra scripts/checks/codetools.mjs --out <tmp dir>
import { check, summary, stubBackend, wait, run } from './lib.mjs'

const LONG = 'print("Hello, World! This first line is long enough to reach the tools in a narrow window")'
const DOC = `# Code\n\n\`\`\`python\nprint("Hello, World!")\n\`\`\`\n\n\`\`\`python\nprint("Hello, World!")\n\`\`\`\n\n\`\`\`python\n${LONG}\nx = 1\n\`\`\`\n`

/** Per block: does the tools box overlap any code text? (rects of every text run in the block) */
const overlaps = (page) =>
  run(page, async () => {
    await new Promise((r) => setTimeout(r, 300))
    return [...document.querySelectorAll('#wysiwyg .milkdown-code-block')].map((b) => {
      const t = b.querySelector(':scope > .tools').getBoundingClientRect()
      // only the text: a line's own box is as wide as the block
      const w = document.createTreeWalker(b.querySelector('.cm-content'), NodeFilter.SHOW_TEXT)
      const rects = []
      while (w.nextNode()) {
        const r = document.createRange()
        r.selectNodeContents(w.currentNode)
        rects.push(...r.getClientRects())
      }
      const hit = rects.some((q) => q.width > 0 && q.left < t.right && q.right > t.left && q.top < t.bottom && q.bottom > t.top)
      return { hit, above: b.classList.contains('cf-tools-above') }
    })
  })

export const scenes = {
  codetools: {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false },
    setup: (page) => stubBackend(page, { read_text: () => DOC }),
    async run(page) {
      await page.setViewportSize({ width: 620, height: 700 })
      await wait(1200)
      for (const b of await page.$$('#wysiwyg .milkdown-code-block')) await b.scrollIntoViewIfNeeded()
      await run(page, () => (document.querySelector('#scroller').scrollTop = 0))
      let o = await overlaps(page)
      check('wrapped: tools cover no code', o.length === 3 && o.every((x) => !x.hit), JSON.stringify(o))
      check('wrapped: tools stay beside the code', o.every((x) => !x.above), JSON.stringify(o))
      await page.hover('#wysiwyg .milkdown-code-block >> nth=0')
      await wait(200)
      o = await overlaps(page)
      check('hovered, with Copy shown: still no code covered', !o[0].hit, JSON.stringify(o[0]))

      await page.keyboard.press('Alt+Z')
      await wait(400)
      o = await overlaps(page)
      check('unwrapped: tools cover no code', o.every((x) => !x.hit), JSON.stringify(o))
      check('unwrapped: only the long first line moves the tools up', !o[0].above && !o[1].above && o[2].above, JSON.stringify(o))
      await page.keyboard.press('Alt+Z')
      await wait(300)

      // the open language list over the next blocks' tools
      await page.click('#wysiwyg .milkdown-code-block >> nth=0 >> .language-button')
      await wait(300)
      const top = await run(page, () => {
        const next = document.querySelectorAll('#wysiwyg .milkdown-code-block .tools')[1].getBoundingClientRect()
        const list = document.querySelector('.list-wrapper')?.getBoundingClientRect()
        if (!list) return { error: 'no list' }
        const x = Math.max(next.left, list.left) + 4
        const y = next.top + next.height / 2
        if (x > list.right || y > list.bottom) return { error: 'list not over the next tools', list, next }
        return { onTop: !!document.elementFromPoint(x, y)?.closest('.list-wrapper') }
      })
      check('open language list is on top of the other blocks', top.onTop, JSON.stringify(top))
      await page.keyboard.press('Escape')
      await wait(100)

      // title bar: window buttons first, menus that don't fit go into »
      for (const w of [900, 520, 360]) {
        await page.setViewportSize({ width: w, height: 700 })
        await wait(300)
        const r = await run(page, () => {
          const c = document.querySelector('#win-controls').getBoundingClientRect()
          const shown = [...document.querySelectorAll('#menus .menu-root:not([hidden])')]
          const last = shown.at(-1)?.getBoundingClientRect()
          return { custom: document.body.classList.contains('custom-titlebar'), controlsIn: c.width === 0 || c.right <= innerWidth + 0.5, noOverlap: !last || c.width === 0 || last.right <= c.left, more: !!document.querySelector('.menu-more'), menus: shown.map((x) => x.textContent) }
        })
        check(`${w}px: window buttons fully visible`, r.controlsIn, JSON.stringify(r))
        check(`${w}px: menus end before them`, r.noOverlap, r.menus.join(','))
        if (w < 600) check(`${w}px: hidden menus are under »`, r.more, r.menus.join(','))
      }
      await page.click('.menu-more > button')
      await wait(150)
      const pop = await run(page, () => {
        const p = document.querySelector('.menu-more > .menu-pop').getBoundingClientRect()
        return { inside: p.left >= 0 && p.right <= innerWidth, items: [...document.querySelectorAll('.menu-more > .menu-pop > .menu-item .lbl')].map((x) => x.textContent) }
      })
      check('» menu opens inside the window', pop.inside, JSON.stringify(pop))
      check('» menu lists the hidden menus', pop.items.includes('Help'), pop.items.join(','))
      // along the left edge, where a submenu laid over the menu leaves the labels free
      const help = await page.locator('.menu-more > .menu-pop > .menu-item:has-text("Help")').boundingBox()
      await page.mouse.move(help.x + 12, help.y + help.height / 2, { steps: 4 })
      await wait(150)
      const sub = await run(page, () => {
        const p = document.querySelector('.menu-more .menu-pop .menu-pop').getBoundingClientRect()
        return p.left >= 0 && p.right <= innerWidth
      })
      check('its submenus open inside the window', sub)
      await page.click('.menu-more .menu-pop .menu-pop .menu-item:has-text("Keyboard Shortcuts")')
      await wait(200)
      check('a command from » works', await page.isVisible('.keys-grid'))
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 1280, height: 800 })
      await wait(300)
      check('wide again: all menus back, no »', !(await page.isVisible('.menu-more')) && (await run(page, () => document.querySelectorAll('#menus .menu-root[hidden]').length)) === 0)
      summary()
    },
  },
}
