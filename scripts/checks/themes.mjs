// Checks for cat styles (companion.js) and custom themes (themes.js): picking a style shows the
// cat in that look; a new theme is made in the editor, applied over the right base theme, kept
// after a reload, left alone by Cancel, recolors the export only with "Same as editor", deleted.
import { check, summary, run, wait } from './lib.mjs'

const cssVar = (page, v) => run(page, (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), v)
const stored = (page) => run(page, () => JSON.parse(localStorage.getItem('caretflow.settings')))

async function viewMenu(page, sub, item, menu = 'View') {
  await page.click(`#menus .menu-root > button:has-text("${menu}")`)
  await page.hover(`.menu-pop .menu-item:has-text("${sub}") >> nth=0`)
  await wait(100)
  await page.click(`.menu-pop .menu-pop .menu-item:has-text("${item}")`)
  await wait(200)
}

const prefsAppearance = async (page) => {
  await page.keyboard.press('Control+,')
  await wait(300)
  await page.click('.prefs-nav button:has-text("Appearance")')
  await wait(150)
}

export const scenes = {
  'cat-styles': {
    open: 'Welcome.md',
    settings: { theme: 'paper', bongo: false, sidebar: false },
    async run(page) {
      check('no cat by default', (await run(page, () => !document.querySelector('#bongo') || document.querySelector('#bongo').hidden)) === true)
      await viewMenu(page, 'Cat Style', 'Ginger Tabby', 'Tools')
      let r = await run(page, () => {
        const c = document.querySelector('#bongo')
        return { shown: c && !c.hidden, style: c?.dataset.style, stripes: c && getComputedStyle(c.querySelector('.m-stripes')).display, fur: c && getComputedStyle(c.querySelector('.fur')).fill }
      })
      check('picking a style shows the cat', r.shown, JSON.stringify(r))
      check('…in that style, with stripes', r.style === 'ginger' && r.stripes !== 'none', JSON.stringify(r))
      check('ginger fur', r.fur === 'rgb(243, 166, 75)', r.fur)
      check('style saved', (await stored(page)).catStyle === 'ginger')

      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Typing")')
      await wait(150)
      const n = await run(page, () => document.querySelectorAll('.cat-styles .cat-style:not(.cat-make)').length)
      check('eight styles and Your Own in Preferences', n === 9, String(n))
      check('…and a Make Your Own button', await page.isVisible('.cat-styles .cat-make'))
      check('current one marked', (await run(page, () => document.querySelector('.cat-style.on')?.title)) === 'Ginger Tabby')
      await page.click('.cat-style[title="Tuxedo"]')
      await wait(150)
      r = await run(page, () => {
        const c = document.querySelector('#bongo')
        return { style: c.dataset.style, bib: getComputedStyle(c.querySelector('.m-bib')).display, stripes: getComputedStyle(c.querySelector('.m-stripes')).display }
      })
      check('Tuxedo: white bib, no stripes', r.style === 'tuxedo' && r.bib !== 'none' && r.stripes === 'none', JSON.stringify(r))
      check('picker follows', (await run(page, () => document.querySelector('.cat-style.on')?.title)) === 'Tuxedo')
      const ids = await run(page, () => [...document.querySelectorAll('clipPath[id^="cf-cat-clip"]')].map((c) => c.id))
      check('each drawing has its own clip id', new Set(ids).size === ids.length && ids.length >= 9, String(ids.length))
      summary()
    },
  },
  'custom-cat': {
    open: 'Welcome.md',
    settings: { theme: 'ink', bongo: false, sidebar: false, catStyle: 'classic' },
    async run(page) {
      const catNow = () =>
        run(page, () => {
          const c = document.querySelector('#bongo')
          const d = (s) => getComputedStyle(c.querySelector(s)).display
          return { shown: !c.hidden, style: c.dataset.style, marks: c.dataset.marks, fur: getComputedStyle(c.querySelector('.fur')).fill, stripes: d('.m-stripes'), mask: d('.m-mask'), bib: d('.m-bib') }
        })
      // "Your Own" with nothing made yet opens the editor
      await viewMenu(page, 'Cat Style', 'Your Own', 'Tools')
      await wait(300)
      check('Your Own opens the cat editor', await page.isVisible('.cat-maker'))
      await page.click('.cat-maker .fsel')
      await page.click('#ctxmenu .menu-item:has-text("Siamese")')
      await wait(100)
      const draft = await run(page, () => ({ fur: document.querySelector('.cat-maker .te-hex').value, mask: document.querySelector('.cat-maker .cm-marks input').closest('.cm-marks').textContent, checked: [...document.querySelectorAll('.cat-maker .cm-marks input')].map((c) => c.checked) }))
      await page.click('.cat-maker .fsel')
      await page.click('#ctxmenu .menu-item:has-text("Cookie")')
      await wait(100)
      check('Start from Cookie: blush on', await run(page, () => [...document.querySelectorAll('.cat-maker .cm-marks input')].at(-1).checked))
      await page.click('.cat-maker .fsel')
      await page.click('#ctxmenu .menu-item:has-text("Siamese")')
      await wait(100)
      check('Start from Siamese: its colors and mask', draft.fur === '#f4e8d2' && JSON.stringify(draft.checked) === '[false,false,true,false,false]', JSON.stringify(draft))
      await page.fill('.cat-maker .te-color >> nth=0 >> .te-hex', '#33cc66')
      await page.press('.cat-maker .te-color >> nth=0 >> .te-hex', 'Tab')
      await page.click('.cat-maker .cm-marks label:has-text("Stripes") input')
      await wait(100)
      const pv = await run(page, () => {
        const p = document.querySelector('.cat-maker .cat-preview')
        return { fur: getComputedStyle(p.querySelector('.fur')).fill, stripes: getComputedStyle(p.querySelector('.m-stripes')).display }
      })
      check('preview follows', pv.fur === 'rgb(51, 204, 102)' && pv.stripes !== 'none', JSON.stringify(pv))
      check('the cat in the corner waits for Save', !(await run(page, () => document.querySelector('#bongo') && !document.querySelector('#bongo').hidden)))
      await page.click('.modal-btns button:has-text("Save")')
      await wait(300)
      let c = await catNow()
      check('saved: cat shown in your style', c.shown && c.style === 'custom' && c.fur === 'rgb(51, 204, 102)', JSON.stringify(c))
      check('…with stripes and mask, no bib', c.marks === 'stripes mask' && c.stripes !== 'none' && c.mask !== 'none' && c.bib === 'none', JSON.stringify(c))
      const st = await stored(page)
      check('stored', st.catStyle === 'custom' && st.customCat?.fur === '#33cc66' && st.customCat.marks.join() === 'stripes,mask', JSON.stringify(st.customCat))

      // Cancel changes nothing
      await viewMenu(page, 'Cat Style', 'Make Your Own Cat', 'Tools')
      await page.fill('.cat-maker .te-color >> nth=0 >> .te-hex', '#000000')
      await page.press('.cat-maker .te-color >> nth=0 >> .te-hex', 'Tab')
      await page.click('.modal-btns button:has-text("Cancel")')
      await wait(200)
      c = await catNow()
      check('Cancel keeps your cat', c.fur === 'rgb(51, 204, 102)', c.fur)

      // switching away and back keeps it; the picker shows it
      await viewMenu(page, 'Cat Style', 'Calico', 'Tools')
      check('built-in styles have no data-marks', (await catNow()).marks === undefined)
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Typing")')
      await wait(150)
      const tile = await run(page, () => getComputedStyle(document.querySelector('.cat-style[title="Your Own"] .fur')).fill)
      check('picker tile shows your cat', tile === 'rgb(51, 204, 102)', tile)
      check('button says Edit', (await run(page, () => document.querySelector('.cat-make small').textContent)) === 'Edit Your Own…')
      await page.click('.cat-style[title="Your Own"]')
      await wait(150)
      c = await catNow()
      check('Your Own picked again', c.style === 'custom' && c.marks === 'stripes mask', JSON.stringify(c))
      summary()
    },
  },
  'custom-themes': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: true, exportTheme: 'paper' },
    async run(page) {
      await viewMenu(page, 'Theme', 'New Custom Theme')
      check('editor opens', await page.isVisible('.theme-editor'))
      const start = await run(page, () => document.querySelector('.te-hex').value)
      check('starts from the current theme (Paper background)', start === '#ffffff', start)
      await page.fill('.theme-editor .te-name', 'Night Owl')
      // background and accent through the hex fields
      const setHex = async (i, v) => {
        await page.fill(`.te-color >> nth=${i} >> .te-hex`, v)
        await page.press(`.te-color >> nth=${i} >> .te-hex`, 'Tab')
        await wait(50)
      }
      await setHex(0, '#102030')
      await setHex(1, '#e0e8f0')
      await setHex(4, '#ff8800')
      const pv = await run(page, () => getComputedStyle(document.querySelector('.tp')).backgroundColor)
      check('preview follows the colors', pv === 'rgb(16, 32, 48)', pv)
      check('app unchanged before saving', (await cssVar(page, '--bg')) === '#ffffff')
      await page.click('.modal-btns button:has-text("Save")')
      await wait(300)
      check('saved theme applied', (await cssVar(page, '--bg')) === '#102030', await cssVar(page, '--bg'))
      check('dark background → dark base theme', (await run(page, () => document.documentElement.dataset.theme)) === 'ink')
      check('accent', (await cssVar(page, '--accent')) === '#ff8800')
      let st = await stored(page)
      check('stored', st.customThemes.length === 1 && st.theme === 'custom:' + st.customThemes[0].id && st.customThemes[0].name === 'Night Owl', JSON.stringify(st.customThemes))

      // exports: Paper colors unless "Same as editor"
      const exp = await run(page, () => {
        const h = document.documentElement
        const id = h.dataset.custom
        delete h.dataset.custom
        const plain = getComputedStyle(h).getPropertyValue('--bg').trim()
        h.dataset.custom = id
        return plain
      })
      check('without the custom rule the base theme shows (what exports use)', exp === '#1d1f23', exp)
      await page.click('#menus .menu-root > button:has-text("View")')
      await page.hover('.menu-pop .menu-item:has-text("Theme") >> nth=0')
      await wait(100)
      await page.hover('.menu-pop .menu-pop .menu-item:has-text("Custom Themes")')
      await wait(150)
      const listed = await run(page, () => [...document.querySelectorAll('.menu-pop .menu-pop .menu-pop .menu-item .lbl')].map((l) => l.textContent))
      check('listed under View → Theme → Custom Themes', listed.includes('Night Owl'), JSON.stringify(listed))
      await page.keyboard.press('Escape')
      await page.mouse.click(700, 500)

      // Cancel leaves it as it was
      await viewMenu(page, 'Theme', 'Edit Custom Theme')
      await setHex(0, '#ffffff')
      await page.click('.modal-btns button:has-text("Cancel")')
      await wait(200)
      check('Cancel keeps the colors', (await cssVar(page, '--bg')) === '#102030')

      // Preferences: listed, switch to Sepia and back, delete
      await prefsAppearance(page)
      check('listed in Preferences', (await run(page, () => [...document.querySelectorAll('.ct-item .ct-name')].map((e) => e.textContent))).join() === 'Night Owl')
      await page.click('.ct-item .ct-swatch')
      await wait(100)
      await page.click('.ct-item button:has-text("Delete")')
      await wait(150)
      await page.click('.modal-btns button:has-text("Delete")')
      await wait(300)
      st = await stored(page)
      check('deleted', st.customThemes.length === 0, JSON.stringify(st.customThemes))
      check('back to the dark built-in theme', st.theme === 'ink' && (await cssVar(page, '--bg')) === '#1d1f23', st.theme + ' ' + (await cssVar(page, '--bg')))
      check('Preferences open again on Appearance', await page.isVisible('.ct-new'))
      check('list empty, New Theme… left', (await run(page, () => document.querySelectorAll('.ct-item').length)) === 0 && (await page.isVisible('.ct-new')))
      summary()
    },
  },
}
