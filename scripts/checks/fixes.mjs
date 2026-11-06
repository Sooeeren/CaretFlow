// Checks for the findings of the final review (AI queue after turning off, provider addresses,
// MCP restarts, idle redraws, the visible AI status, MCP suggestion limits).
import { check, summary, run, stubBackend, wait } from './lib.mjs'
import { fakeAi, openaiAnswer, aiBackend } from './ai.mjs'

const AI = (o) => ({ extensions: ['ai'], aiEnabled: true, aiModel: 'm1', aiProvider: 'custom', autocorrect: false, spellcheck: false, ...o })
const clearDoc = async (page) => {
  await page.click('#wysiwyg .ProseMirror h1')
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Control+0')
}
const useServer = (page, url) =>
  page.addInitScript((u) => {
    const st = JSON.parse(localStorage.getItem('folio.settings'))
    localStorage.setItem('folio.settings', JSON.stringify({ ...st, aiBaseUrls: { custom: u } }))
    localStorage.removeItem('folio.ai.usage')
  }, url)

export const scenes = {
  // 1. turning AI off empties the queue: nothing more leaves
  'fix-queue': {
    open: 'Welcome.md',
    settings: AI({ aiFixWhen: 'manual', aiRecWhen: 'manual' }),
    async setup(page) {
      this.srv = await fakeAi(() => ({ ...openaiAnswer('{"findings":[]}'), delay: 1500 }))
      await stubBackend(page, aiBackend({}))
      await useServer(page, this.srv.url + '/v1')
    },
    async run(page) {
      await clearDoc(page)
      for (let i = 0; i < 6; i++) {
        if (i) await page.keyboard.press('Enter')
        await page.keyboard.type(`Paragraph number ${i} is long enough for the AI to check it.`)
      }
      await page.keyboard.press('F7')
      await wait(300)
      await page.click('#wc-panel .wc-tab:nth-child(2)')
      await page.click('#wc-panel button:has-text("Check whole document")')
      await wait(300)
      await page.click('#modal button.primary')
      await wait(500)
      // turn AI writing help off while the first request is on its way
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("AI")')
      await wait(600)
      await page.click('.prefs-page:not([hidden]) .pref-row:has-text("Turn on AI writing help") input')
      await wait(6000)
      check('turning AI off stops the queue', this.srv.seen.length === 1, `${this.srv.seen.length} requests`)
      this.srv.close()
      summary()
    },
  },
  // 2. an address typed for a local server never applies to a cloud provider
  'fix-address': {
    open: 'Welcome.md',
    settings: {},
    async run(page) {
      const r = await run(page, async () => {
        const m = await import('/src/ai.js')
        const settings = { aiProvider: 'ollama', aiBaseUrls: { ollama: 'http://localhost:11500/v1' } }
        m.initAi({ settings, saveSettings() {}, log() {} })
        const local = m.baseUrl()
        settings.aiProvider = 'anthropic'
        const cloud = m.baseUrl()
        settings.aiProvider = 'openai'
        return { local, cloud, openai: m.baseUrl() }
      })
      check('local address is used for Ollama', r.local === 'http://localhost:11500/v1', JSON.stringify(r))
      check('cloud providers keep their own address', r.cloud === 'https://api.anthropic.com/v1' && r.openai === 'https://api.openai.com/v1', JSON.stringify(r))
      summary()
    },
  },
  // 4. no endless redraws while the caret stays in a paragraph
  'fix-idle': {
    open: 'Welcome.md',
    settings: AI({ aiPause: 2 }),
    async setup(page) {
      this.srv = await fakeAi(() => openaiAnswer('{"findings":[]}'))
      await stubBackend(page, aiBackend({}))
      await useServer(page, this.srv.url + '/v1')
    },
    async run(page) {
      await clearDoc(page)
      await page.keyboard.type('A paragraph that is still being written and stays under the cursor.')
      await wait(1500)
      await page.evaluate(() =>
        import('/src/ai.js').then((m) => {
          const orig = m.aiSource.issues
          window.__calls = 0
          m.aiSource.issues = function (...a) {
            window.__calls++
            return orig.apply(this, a)
          }
        }),
      )
      await wait(6000)
      const calls = await page.evaluate(() => window.__calls)
      check('idle with the cursor in a paragraph: no repeated checks', calls <= 2, `${calls} checks in 6 s`)
      await page.keyboard.press('Enter')
      await wait(4500)
      check('moving to the next paragraph still sends it', this.srv.seen.length === 1, `${this.srv.seen.length}`)
      this.srv.close()
      summary()
    },
  },
  // 5. the status bar shows when AI checking is paused
  'fix-status': {
    open: 'Welcome.md',
    settings: AI({ aiFixWhen: 'manual', aiRecWhen: 'manual', aiPerDay: 1 }),
    async setup(page) {
      this.srv = await fakeAi(() => openaiAnswer('{"findings":[]}'))
      await stubBackend(page, aiBackend({}))
      await useServer(page, this.srv.url + '/v1')
    },
    async run(page) {
      await clearDoc(page)
      await page.keyboard.type('The first paragraph is long enough to be checked by the AI.')
      await page.keyboard.press('Enter')
      await page.keyboard.type('The second paragraph is long enough to be checked as well.')
      await page.keyboard.press('Control+Alt+K')
      await wait(1200)
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Control+Alt+K')
      await wait(1200)
      const st = await page.$eval('#st-wc', (e) => e.textContent)
      check('status bar shows that AI is paused', /AI paused/.test(st), st)
      this.srv.close()
      summary()
    },
  },
}
