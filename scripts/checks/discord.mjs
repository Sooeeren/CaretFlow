// Checks for the Discord Status extension (discord.js): absent until installed, what it sends to
// the Discord app, the file name kept private, the Tools toggle and the Preferences page.
import { check, summary, run, stubBackend, wait } from './lib.mjs'

const calls = []

const toolsMenu = async (page) => {
  await page.click('#menus .menu-root > button:has-text("Tools")')
  const items = await page.$$eval('.menu-pop .menu-item .lbl', (xs) => xs.map((x) => x.textContent))
  return items
}

export const scenes = {
  'discord-off': {
    open: 'Welcome.md',
    settings: {},
    async setup(page) {
      await stubBackend(page, { discord_set: (a) => void calls.push(['set', a]), discord_clear: () => void calls.push(['clear']) })
    },
    async run(page) {
      await wait(800)
      check('nothing sent while not installed', calls.length === 0, JSON.stringify(calls))
      const items = await toolsMenu(page)
      check('no Discord Status in Tools', !items.includes('Discord Status'), items.join('|'))
      summary()
    },
  },
  'discord-on': {
    open: 'Welcome.md',
    settings: { extensions: ['discord'], discordAppId: '123' },
    async setup(page) {
      calls.length = 0
      await stubBackend(page, { discord_set: (a) => void calls.push(['set', a]), discord_clear: () => void calls.push(['clear']) })
    },
    async run(page) {
      await wait(1200)
      const set = calls.find((c) => c[0] === 'set')?.[1]
      check('status sent on start', !!set, JSON.stringify(calls))
      check('…to the application ID', set?.clientId === '123', set?.clientId)
      const a = set?.activity || {}
      check('logo and version', /^https:\/\//.test(a.assets?.large_image) && /^CaretFlow \d/.test(a.assets?.large_text), JSON.stringify(a.assets))
      check('file name private by default', !JSON.stringify(a).includes('Welcome.md') && /Markdown document/.test(a.details), a.details)
      check('word count, elapsed time, button', /\d+ words/.test(a.state) && a.timestamps?.start > 0 && a.buttons?.[0]?.url?.startsWith('https://'), JSON.stringify(a))

      const items = await toolsMenu(page)
      check('Discord Status in Tools', items.includes('Discord Status'), items.join('|'))
      await page.click('.menu-pop .menu-item:has-text("Discord Status")')
      await wait(400)
      check('Tools → Discord Status hides it (clears the status)', calls.at(-1)?.[0] === 'clear', JSON.stringify(calls.at(-1)))

      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Discord")')
      await wait(600)
      const card = await run(page, () => document.querySelector('.dc-card')?.textContent || '')
      check('Preferences → Discord with a preview', card.includes('CaretFlow') && card.includes('words'), card)
      const n = calls.length
      await page.click('.pref-row:has-text("Show my status on Discord") input')
      await page.click('.pref-row:has-text("Show the file name") input')
      await wait(800)
      const last = calls.slice(n).filter((c) => c[0] === 'set').at(-1)?.[1]?.activity
      check('turned on again, file name shown when asked', last?.details?.includes('Welcome.md'), JSON.stringify(last?.details))
      summary()
    },
  },
}
