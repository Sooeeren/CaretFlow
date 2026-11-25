// Checks for image size (src/imagesize.js): right-click an image → 10 % … 200 %, written as
// Typora's <img style="zoom:…">; plain images keep their alt text; other <img> HTML stays as written.
import { check, summary, run, stubBackend, wait } from './lib.mjs'

// an 800 × 400 picture that loads without a file
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#6a9"/></svg>').toString('base64')
const SRC = `data:image/svg+xml;base64,${SVG}`
const DOC = `# Pictures

![A cat](${SRC} "Caption")

<img src="${SRC}" alt="Small" style="zoom:25%;" />

<img src="x.png" width="50%">

![1.00](${SRC})

End.
`

let saved = null
async function save(page) {
  saved = null
  await page.keyboard.press('Control+S')
  for (let i = 0; i < 30 && saved === null; i++) await wait(100)
  return saved ?? ''
}
const imgWidth = (page, i) => page.$$eval('#wysiwyg .milkdown-image-block img', (ims, i) => Math.round(ims[i].getBoundingClientRect().width), i)

async function rightClickImage(page, i) {
  const img = page.locator('#wysiwyg .milkdown-image-block img').nth(i)
  await img.scrollIntoViewIfNeeded()
  const box = await img.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await wait(200)
  return run(page, () => {
    const m = document.querySelector('#ctxmenu')
    return {
      open: !m.hidden,
      chips: [...m.querySelectorAll('.menu-chip')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')),
      items: [...m.querySelectorAll('.menu-item .lbl')].map((b) => b.textContent),
    }
  })
}

export const scenes = {
  'image-size': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false, vim: false },
    setup: (page) => stubBackend(page, { read_text: () => DOC, write_text: ({ content }) => void (saved = content) }),
    async run(page) {
      await wait(800)
      const blocks = await page.$$eval('#wysiwyg .milkdown-image-block', (b) => b.length)
      check('Markdown images and a zoomed <img> are image blocks', blocks === 3, String(blocks))
      check('an <img> with a width in percent stays HTML', (await page.$$eval('#wysiwyg .cf-html img', (b) => b.length)) === 1)

      // nothing changed by opening and saving
      await page.keyboard.press('Control+End')
      await page.keyboard.type('!')
      await wait(300)
      let md = await save(page)
      check('alt text and caption kept', md.includes(`![A cat](${SRC} "Caption")`), md.slice(0, 200))
      check('zoom tag kept as written', md.includes(`<img src="${SRC}" alt="Small" style="zoom:25%;" />`))
      check('other <img> HTML kept as written', md.includes('<img src="x.png" width="50%">'))
      check('old ratio-in-alt image read as no alt', md.includes(`![](${SRC})`))

      const full = await imgWidth(page, 0)
      const small = await imgWidth(page, 1)
      check('25 % shows at a quarter', Math.abs(small - full / 4) <= 3, `${small} vs ${full}`)

      // right-click → menu with the sizes
      let r = await rightClickImage(page, 0)
      check('right-click opens the image menu', r.open && r.chips.length === 9, JSON.stringify(r))
      check('current size marked', r.chips.includes('100%*'), JSON.stringify(r.chips))
      check('menu items', ['Zoom Image In', 'Zoom Image Out', 'Custom Size…', 'Original Size', 'Delete Image'].every((x) => r.items.includes(x)), JSON.stringify(r.items))
      await page.click('#ctxmenu .menu-chip >> text="50%"')
      await wait(300)
      check('50 % shows at half', Math.abs((await imgWidth(page, 0)) - full / 2) <= 3, String(await imgWidth(page, 0)))
      md = await save(page)
      check('50 % saved as Typora zoom', md.includes(`<img src="${SRC}" alt="A cat" title="Caption" style="zoom:50%;" />`), md.split('\n')[2].slice(-60))

      // shortcuts on the selected image
      await page.keyboard.press('Control+Alt+=')
      await wait(200)
      md = await save(page)
      check('Zoom Image In: 50 % → 66 %', md.includes('alt="A cat" title="Caption" style="zoom:66%;"'))
      await page.keyboard.press('Control+Alt+-')
      await page.keyboard.press('Control+Alt+-')
      await wait(200)
      md = await save(page)
      check('Zoom Image Out twice: 66 % → 33 %', md.includes('alt="A cat" title="Caption" style="zoom:33%;"'))

      // custom size
      r = await rightClickImage(page, 0)
      check('chip follows the size', r.chips.includes('33%*'), JSON.stringify(r.chips))
      await page.click('#ctxmenu .menu-item:has-text("Custom Size")')
      await wait(200)
      await page.fill('.modal-box input', '40')
      await page.keyboard.press('Enter')
      await wait(300)
      md = await save(page)
      check('custom 40 %', md.includes('style="zoom:40%;"'))

      // views: source mode shows the tag, back again keeps it
      await page.keyboard.press('Control+/')
      await wait(700)
      const src = await run(page, () => document.querySelector('.cm-content')?.textContent || '')
      check('source mode shows the <img> tag', src.includes('style="zoom:40%;"'))
      await page.keyboard.press('Control+/')
      await wait(700)
      check('back in the rendered view: still an image block', (await page.$$eval('#wysiwyg .milkdown-image-block', (b) => b.length)) === 3)

      // HTML export keeps the zoom
      const html = await run(page, async (md) => (await import('/src/export.js')).bodyHtml(md), md)
      check('HTML export keeps style="zoom:40%"', typeof html === 'string' && /zoom:\s*40%/.test(html), String(html).slice(0, 120))

      // custom size in pixels: the unit converts the number, width="…" is written
      r = await rightClickImage(page, 0)
      await page.click('#ctxmenu .menu-item:has-text("Custom Size")')
      await wait(200)
      const hint = await run(page, () => document.querySelector('.is-hint')?.textContent)
      check('dialog shows the original size', /Original 800 × 400 px · now 320 × 160 px/.test(hint), hint)
      await page.click('.image-size-dlg .fsel')
      await page.click('#ctxmenu .menu-item:has-text("Pixels wide")')
      check('switching to pixels converts 40 % → 320', (await page.inputValue('.image-size-dlg .is-num')) === '320', await page.inputValue('.image-size-dlg .is-num'))
      await page.fill('.image-size-dlg .is-num', '300')
      await page.keyboard.press('Enter')
      await wait(300)
      md = await save(page)
      check('300 px saved as width="300"', md.includes(`<img src="${SRC}" alt="A cat" title="Caption" width="300" />`) && !md.includes('zoom:40%'), md.split('\n')[2].slice(-70))
      check('shows 300 px wide', (await imgWidth(page, 0)) === 300, String(await imgWidth(page, 0)))
      r = await rightClickImage(page, 0)
      check('no size chip marked for a pixel width', !r.chips.some((c) => c.endsWith('*')), JSON.stringify(r.chips))
      await page.keyboard.press('Escape')
      // 300 px of 800 is 37 %; the next size up is 50 %
      await page.keyboard.press('Control+Alt+=')
      await wait(200)
      md = await save(page)
      check('Zoom In from a pixel width: 50 %', md.includes('alt="A cat" title="Caption" style="zoom:50%;"'), md.split('\n')[2].slice(-70))
      // a pixel width written by hand opens as an image
      const typed = await run(page, async () => (await import('/src/imagesize.js')).parseImgTag('<img src="a.png" width="240px">'))
      check('<img width="240px"> is read as a 240 px image', typed?.width === 240 && typed.zoom === 0, JSON.stringify(typed))

      // original size → plain Markdown again
      await rightClickImage(page, 0)
      await page.click('#ctxmenu .menu-item:has-text("Original Size")')
      await wait(300)
      md = await save(page)
      check('Original Size: plain Markdown again', md.includes(`![A cat](${SRC} "Caption")`) && !md.includes('alt="A cat"'))

      // the caption field keeps the text menu
      r = await run(page, () => {
        const inp = document.querySelector('#wysiwyg .milkdown-image-block input')
        if (!inp) return { items: ['no caption field'] }
        inp.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }))
        const m = document.querySelector('#ctxmenu')
        const items = m.hidden ? [] : [...m.querySelectorAll('.menu-item .lbl')].map((b) => b.textContent)
        m.hidden = true
        return { items }
      })
      check('caption field: text menu, not the image menu', !r.items.includes('Original Size'), JSON.stringify(r.items))
      summary()
    },
  },
}
