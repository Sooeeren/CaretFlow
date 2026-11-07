// Checks for the Material You style (material.js): off by default, colors from the seed in light
// and dark themes, the menu toggle, the color swatches in Preferences, and turning it off again.
import { check, summary, run, wait } from './lib.mjs'

const accent = (page) => run(page, () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
const isOn = (page) => run(page, () => document.body.classList.contains('material'))
const toggleInMenu = async (page) => {
  await page.click('#menus .menu-root > button:has-text("Themes")')
  await page.click('.menu-pop .menu-item:has-text("Material You Style")')
  await wait(150)
}

export const scenes = {
  'material-light': {
    open: 'Welcome.md',
    settings: { theme: 'paper' },
    async run(page) {
      check('off by default', !(await isOn(page)))
      check('paper accent unchanged while off', (await accent(page)) === '#4178c8', await accent(page))
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Appearance")')
      await page.click('.m-seeds .m-seed[title="#0061a4"]')
      await wait(150)
      check('picking a color while off keeps it off', !(await isOn(page)))
      await page.keyboard.press('Escape')
      await wait(200)
      await toggleInMenu(page)
      check('Themes → Material You Style turns it on', await isOn(page))
      check('…in the color picked before (blue)', (await accent(page)) !== '#4178c8' && (await accent(page)) !== '#634ca0', await accent(page))
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Appearance")')
      await wait(150)
      const swatches = await run(page, () => document.querySelectorAll('.m-seeds .m-seed').length)
      check('eight color swatches (no wallpaper color off Android)', swatches === 8, swatches)
      await page.click('.m-seeds .m-seed[title="#006a60"]')
      await wait(150)
      const saved = await run(page, () => JSON.parse(localStorage.getItem('folio.settings')).materialSeed)
      check('picking a swatch saves the seed', saved === '#006a60', saved)
      check('…and recolors the app', (await accent(page)) !== '#634ca0', await accent(page))
    },
  },
  'material-dark': {
    open: 'Welcome.md',
    settings: { theme: 'ink', material: true, materialSeed: '#386a20' },
    async run(page) {
      check('on from settings', await isOn(page))
      const a = await accent(page)
      check('dark scheme has a light accent', parseInt(a.slice(1, 3), 16) > 140, a)
      const onPrimary = await run(page, () => getComputedStyle(document.documentElement).getPropertyValue('--m-on-primary').trim())
      check('dark "on primary" is dark', parseInt(onPrimary.slice(1, 3), 16) < 90, onPrimary)
      await page.click('#menus .menu-root > button:has-text("File")')
      await wait(150)
      const r = await run(page, () => getComputedStyle(document.querySelector('.menu-pop')).borderRadius)
      check('menus are rounded', r === '16px', r)
      await page.keyboard.press('Escape')
      await page.mouse.click(700, 500)
      await toggleInMenu(page)
      check('turning it off restores the Ink accent', (await accent(page)) === '#6aa0f0', await accent(page))
      check('…and the shapes', !(await isOn(page)))
      // on again, with Preferences open, for the screenshot
      await toggleInMenu(page)
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Appearance")')
      await wait(200)
      summary()
    },
  },
}
