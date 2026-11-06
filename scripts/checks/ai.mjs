// Checks for AI Writing Help: providers and limits (ai.js), live checking, the review panel,
// Preferences → AI. Fake AI servers run in Node; the app reaches them through a Node version of
// the cloud_http command.
import http from 'node:http'
import { check, summary, run, stubBackend, wait } from './lib.mjs'

/** A fake AI server. reply(req) → { status?, body } ; every request is kept in `seen`. */
export async function fakeAi(reply) {
  const seen = []
  const server = http.createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', async () => {
      const r = { method: req.method, url: req.url, headers: req.headers, body: data ? JSON.parse(data) : null }
      seen.push(r)
      const out = (await reply(r)) || { body: {} }
      if (out.delay) await wait(out.delay)
      res.writeHead(out.status || 200, { 'content-type': 'application/json' })
      res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() }
}

export const openaiAnswer = (text, model = 'fake-model') => ({ body: { model, choices: [{ message: { content: text } }], usage: { prompt_tokens: 50, completion_tokens: 10 } } })
export const anthropicAnswer = (text, model = 'claude-fake') => ({ body: { model, content: [{ type: 'text', text }], usage: { input_tokens: 40, output_tokens: 8 } } })

/** cloud_http and secrets implemented in Node, as the Rust side does them. */
export function aiBackend(secrets = {}) {
  return {
    async cloud_http({ req }) {
      const init = { method: req.method, headers: Object.fromEntries(req.headers) }
      if (req.body) init.body = Buffer.from(req.body, 'base64')
      try {
        const r = await fetch(req.url, init)
        const buf = Buffer.from(await r.arrayBuffer())
        return { status: r.status, headers: [...r.headers.entries()], body: buf.toString('base64') }
      } catch (e) {
        throw String(e.cause?.message || e.message)
      }
    },
    secret_get: ({ key }) => secrets[key] ?? null,
    secret_set: ({ key, value }) => void (value ? (secrets[key] = value) : delete secrets[key]),
  }
}

// the AI defaults from main.js DEFAULTS (the app always merges them into settings)
const AI_DEFAULTS = { aiProvider: 'anthropic', aiBaseUrl: '', aiModel: '', aiMaxOut: 400, aiMaxChars: 2000, aiPerHour: 30, aiPerDay: 150, aiTokensDay: 100000, aiTemperature: 0.2, aiParallel: 1 }
const AI = (o) => ({ ...AI_DEFAULTS, extensions: ['ai'], aiEnabled: true, aiModel: 'm1', ...o })

export const scenes = {
  'ai-providers': {
    open: 'Welcome.md',
    settings: {},
    async setup(page) {
      this.oa = await fakeAi((r) => (r.url.endsWith('/models') ? { body: { data: [{ id: 'm1' }, { id: 'm2' }] } } : r.body?.model === 'busy' ? { status: 429, body: { error: { message: 'Rate limit' } } } : openaiAnswer('hello')))
      this.an = await fakeAi(() => anthropicAnswer('hi'))
      await stubBackend(page, aiBackend({ 'ai:custom': 'k', 'ai:anthropic': 'k' }))
    },
    async run(page) {
      const { oa, an } = this
      const call = (settings, fn) =>
        run(
          page,
          async ([settings, fn]) => {
            const m = await import('/src/ai.js')
            m.initAi({ settings, saveSettings() {}, log() {} })
            return eval(`(${fn})`)(m)
          },
          [settings, fn.toString()],
        )
      let r = await call(AI({ aiProvider: 'custom', aiBaseUrl: oa.url + '/v1' }), async (m) => m.complete({ system: 'S', user: 'U', maxTokens: 400 }))
      const q = oa.seen.at(-1)
      check('OpenAI format: endpoint', q?.url === '/v1/chat/completions', q?.url)
      check('OpenAI format: bearer key', q?.headers.authorization === 'Bearer k', q?.headers.authorization)
      check('OpenAI format: limits sent', q?.body.max_tokens === 400 && q?.body.temperature === 0.2, JSON.stringify(q?.body))
      check('OpenAI format: system + user', q?.body.messages[0].role === 'system' && q?.body.messages[1].content === 'U')
      check('OpenAI format: text and usage', r.text === 'hello' && r.inTokens === 50 && r.outTokens === 10, JSON.stringify(r))

      r = await call(AI({ aiProvider: 'anthropic', aiBaseUrl: an.url + '/v1' }), async (m) => m.complete({ system: 'S', user: 'U', maxTokens: 300 }))
      const a = an.seen.at(-1)
      check('Anthropic format: endpoint and headers', a?.url === '/v1/messages' && a.headers['x-api-key'] === 'k' && a.headers['anthropic-version'] === '2023-06-01', JSON.stringify(a?.headers))
      check('Anthropic format: system field', a?.body.system === 'S' && a.body.max_tokens === 300 && a.body.messages[0].content === 'U', JSON.stringify(a?.body))
      check('Anthropic format: text and usage', r.text === 'hi' && r.inTokens === 40, JSON.stringify(r))

      const before = oa.seen.length
      await call(AI({ aiProvider: 'ollama', aiBaseUrl: oa.url + '/v1' }), async (m) => m.complete({ system: 'S', user: 'U', maxTokens: 50 }))
      check('local server: request made, no key sent', oa.seen.length === before + 1 && !oa.seen.at(-1)?.headers.authorization)

      r = await call(AI({ aiProvider: 'custom', aiBaseUrl: oa.url + '/v1', aiModel: 'busy' }), async (m) => m.complete({ system: 'S', user: 'U', maxTokens: 50 }).then(() => 'no error', (e) => ({ name: e.name, status: e.status, msg: e.message })))
      check('HTTP 429 becomes AiError', r.name === 'AiError' && r.status === 429 && /Rate limit/.test(r.msg), JSON.stringify(r))

      r = await call(AI({ aiProvider: 'custom', aiBaseUrl: oa.url + '/v1' }), async (m) => m.listModels())
      check('model list', JSON.stringify(r) === '["m1","m2"]', JSON.stringify(r))

      r = await call(AI({ aiPerHour: 30 }), async (m) => {
        m.resetUsage()
        for (let i = 0; i < 30; i++) m.record(10, 10)
        return m.budget()
      })
      check('hourly request limit', r.ok === false && r.reason === 'hour', JSON.stringify(r))
      r = await call(AI({ aiTokensDay: 1000 }), async (m) => {
        m.resetUsage()
        m.record(900, 200)
        return { b: m.budget(), u: m.usage() }
      })
      check('daily token limit', r.b.ok === false && r.b.reason === 'tokens' && r.u.tokens === 1100 && r.u.req === 1, JSON.stringify(r))
      r = await call(AI({}), async (m) => {
        m.resetUsage()
        return m.budget()
      })
      check('fresh budget is ok', r.ok === true, JSON.stringify(r))
      oa.close()
      an.close()
      summary()
    },
  },
  'ai-live': {
    open: 'Welcome.md',
    settings: AI({ aiProvider: 'custom', aiPause: 2, aiContext: true, autocorrect: false }), // AutoCorrect would fix the test's typos itself
    async setup(page) {
      this.srv = await fakeAi((r) => {
        const user = r.body?.messages?.at(-1)?.content || ''
        const text = user.split('TEXT:').pop()
        const f = (quote, replacement, kind = 'grammar') => openaiAnswer(JSON.stringify({ findings: [{ quote, replacement, kind, message: 'Fix it.' }] }))
        if (/32nd of May/.test(text)) return f('32nd', '31st')
        if (/JUNKPROSE/.test(text)) return openaiAnswer('I think this paragraph is fine as it is.')
        if (/FENCEDREPLY/.test(text)) return openaiAnswer('Sure! Here:\n```json\n{"findings":[{"quote":"the parcel yesterday","replacement":"the package yesterday","kind":"word choice","message":"Clearer."}]}\n```')
        if (/MISSINGQUOTE/.test(text)) return f('words that are not there', 'x')
        if (/SAMEREPLACEMENT/.test(text)) return f('stays', 'stays')
        if (/SERVERFAIL/.test(text)) return { status: 500, body: { error: { message: 'boom' } } }
        if (/SLOWREPLY/.test(text)) return { ...f('alpha', 'ALPHA'), delay: 4000 }
        return openaiAnswer('{"findings":[]}')
      })
      await stubBackend(page, aiBackend({}))
      await page.addInitScript((u) => {
        const st = JSON.parse(localStorage.getItem('folio.settings'))
        localStorage.setItem('folio.settings', JSON.stringify({ ...st, aiBaseUrl: u }))
        localStorage.removeItem('folio.ai.usage')
      }, this.srv.url + '/v1')
    },
    async run(page) {
      const { srv } = this
      const sent = () => srv.seen.filter((r) => r.url.endsWith('/chat/completions')).map((r) => r.body.messages.at(-1).content)
      const marks = () => page.$$eval('#wysiwyg .wc-ai-fix, #wysiwyg .wc-ai-rec', (xs) => xs.map((x) => x.textContent))
      await wait(4000)
      check('opening a document sends nothing', sent().length === 0, `${sent().length} requests`)
      // start from an empty document, then use only the keyboard: a click could land in a code or
      // math block of the demo file and put the paragraphs somewhere else
      await page.click('#wysiwyg .ProseMirror h1')
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Delete')
      await page.keyboard.press('Control+0')
      await page.keyboard.type('A first line that stays as it is for this test.')
      const para = async (text) => {
        await page.keyboard.press('Control+End')
        await page.keyboard.press('Enter')
        await page.keyboard.type(text, { delay: 5 })
      }
      await para('The meeting is on the 32nd of May with all of our friends.')
      await para('Short one.')
      await para('CODECHECK has `secretcode` inside of this paragraph here.')
      await para('JUNKPROSE is a paragraph that gets an answer in plain prose.')
      await para('FENCEDREPLY says that we did not receive the parcel yesterday.')
      await para('MISSINGQUOTE gets a finding whose quote is nowhere in here.')
      await para('SAMEREPLACEMENT gets a finding where the text stays the same.')
      await page.keyboard.press('Enter')
      await wait(9000)
      const bodies = sent()
      const texts = bodies.map((b) => b.split('TEXT:').pop())
      check('finished paragraphs are sent', texts.some((b) => /32nd of May/.test(b)) && texts.some((b) => /FENCEDREPLY/.test(b)), `${bodies.length} requests`)
      check('short paragraphs are not sent', !texts.some((b) => /Short one/.test(b)))
      check('inline code is never sent', texts.some((b) => /CODECHECK/.test(b)) && !bodies.some((b) => /secretcode/.test(b)))
      check('previous paragraph goes along as context', bodies.some((b) => /CONTEXT:[\s\S]*JUNKPROSE[\s\S]*TEXT:[\s\S]*FENCEDREPLY/.test(b)))
      let m = await marks()
      check('underline on the finding', m.includes('32nd'), JSON.stringify(m))
      check('fenced JSON answer is read', m.includes('the parcel yesterday'), JSON.stringify(m))
      check('nothing placed for a missing quote or an unchanged replacement', !m.some((x) => /words that|stays/.test(x)), JSON.stringify(m))
      const st = await run(page, () => import('/src/ai.js').then((x) => ({ status: x.status(), usage: x.usage() })))
      check('unreadable answer: status says so, and it still counts', /could not be read/i.test(JSON.stringify(st.status)) && st.usage.req === bodies.length, JSON.stringify(st))

      // apply from the right-click menu
      const b = await (await page.$('#wysiwyg .wc-ai-fix')).boundingBox()
      await page.mouse.click(b.x + 4, b.y + b.height / 2, { button: 'right' })
      await wait(300)
      await page.click('#ctxmenu .menu-item.wc-sugg')
      await wait(400)
      const text = await page.$eval('#wysiwyg .ProseMirror', (e) => e.textContent)
      check('Apply changes the text', /the 31st of May/.test(text))

      // a server error is reported once, not retried in a loop
      const n0 = sent().length
      await para('SERVERFAIL is a paragraph that the server cannot handle at all.')
      await page.keyboard.press('Enter')
      await wait(7000)
      const st2 = await run(page, () => import('/src/ai.js').then((x) => x.status()))
      check('server error: one request, status shows it', sent().slice(n0).filter((b) => /SERVERFAIL/.test(b.split('TEXT:').pop())).length === 1 && /boom/.test(JSON.stringify(st2)), `${sent().length - n0} requests; ${JSON.stringify(st2)}`)

      // typing while the answer is on its way: the stale answer is dropped
      await para('SLOWREPLY alpha beta gamma delta epsilon zeta eta theta.')
      await page.keyboard.press('Enter')
      // sent after the 2 s pause; the answer takes 4 s more: edit while it is on its way
      const n1 = sent().length
      await wait(4000)
      const slow = sent().slice(n1).filter((x) => /SLOWREPLY/.test(x.split('TEXT:').pop())).length
      check('slow request is on its way before the edit', slow === 1, `${slow}`)
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Home')
      for (let i = 0; i < 'SLOWREPLY '.length; i++) await page.keyboard.press('ArrowRight')
      for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
      await page.keyboard.type('omega')
      await page.keyboard.press('Control+End')
      await wait(7000)
      m = await marks()
      check('answer for text that changed meanwhile is dropped', !m.includes('alpha') && !m.includes('omega'), JSON.stringify(m))

      // Ignore is remembered
      const boxes = await page.$$('#wysiwyg .wc-ai-rec')
      let target = null
      for (const x of boxes) if ((await x.textContent()) === 'the parcel yesterday') target = x
      const fb = await target.boundingBox()
      await page.mouse.click(fb.x + 4, fb.y + fb.height / 2, { button: 'right' })
      await wait(300)
      await page.click('#ctxmenu .menu-item:has-text("Ignore")')
      await wait(500)
      m = await marks()
      const ign = await page.evaluate(() => localStorage.getItem('folio.ai.ignored') || '')
      check('Ignore removes it and is remembered', !m.includes('the parcel yesterday') && /parcel/.test(ign), JSON.stringify(m))
      srv.close()
      summary()
    },
  },
  'ai-manual': {
    open: 'Welcome.md',
    settings: AI({ aiProvider: 'custom', aiFixWhen: 'manual', aiRecWhen: 'manual', aiPause: 2 }),
    async setup(page) {
      this.srv = await fakeAi(() => openaiAnswer('{"findings":[]}'))
      await stubBackend(page, aiBackend({}))
      await page.addInitScript((u) => {
        const st = JSON.parse(localStorage.getItem('folio.settings'))
        localStorage.setItem('folio.settings', JSON.stringify({ ...st, aiBaseUrl: u }))
      }, this.srv.url + '/v1')
    },
    async run(page) {
      await page.click('#wysiwyg .ProseMirror')
      await page.keyboard.press('Control+End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('A long enough paragraph that would normally be checked by the AI.')
      await page.keyboard.press('Enter')
      await wait(6000)
      check('"only when I ask": nothing sent while typing', this.srv.seen.length === 0, `${this.srv.seen.length}`)
      this.srv.close()
      summary()
    },
  },
  'ai-nospell': {
    open: 'Welcome.md',
    settings: AI({ aiProvider: 'custom', spellcheck: false, autocorrect: false, aiPause: 2 }),
    async setup(page) {
      this.srv = await fakeAi(() => openaiAnswer(JSON.stringify({ findings: [{ quote: 'Thier', replacement: 'Their', kind: 'spelling', message: 'Spelling.' }] })))
      await stubBackend(page, aiBackend({}))
      await page.addInitScript((u) => {
        const st = JSON.parse(localStorage.getItem('folio.settings'))
        localStorage.setItem('folio.settings', JSON.stringify({ ...st, aiBaseUrl: u }))
      }, this.srv.url + '/v1')
    },
    async run(page) {
      await page.click('#wysiwyg .ProseMirror')
      await page.keyboard.press('Control+End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('Thier car is red and teh dog is brown, said the neighbour.')
      await page.keyboard.press('Enter')
      await wait(6000)
      const r = await page.evaluate(() => ({ ai: [...document.querySelectorAll('#wysiwyg .wc-ai-fix')].map((x) => x.textContent), harper: document.querySelectorAll('#wysiwyg .wc-spelling, #wysiwyg .wc-grammar').length }))
      check("spell check off: AI underlines still appear, Harper's do not", r.ai.includes('Thier') && r.harper === 0, JSON.stringify(r))
      this.srv.close()
      summary()
    },
  },
  'ai-panel': {
    open: 'Welcome.md',
    settings: AI({ aiProvider: 'custom', aiFixWhen: 'manual', aiRecWhen: 'manual', aiRecAspects: ['clarity', 'tone'], autocorrect: false, spellcheck: false }),
    async setup(page) {
      this.srv = await fakeAi((r) => {
        const sys = r.body?.messages?.[0]?.content || ''
        const text = (r.body?.messages?.at(-1)?.content || '').split('TEXT:').pop()
        if (/Explain/i.test(sys)) return openaiAnswer('Because the sentence reads more smoothly that way.')
        if (/TONEPARA/.test(text)) return openaiAnswer(JSON.stringify({ findings: [{ quote: 'TONEPARA', replacement: 'Tonepara', kind: 'tone', message: 'Too loud.' }] }))
        const w = text.trim().split(/\s+/)[1] || 'x'
        return { ...openaiAnswer(JSON.stringify({ findings: [{ quote: w, replacement: w.toUpperCase(), kind: 'clarity', message: 'Clearer.' }] })), delay: /SLOWPARA/.test(text) ? 3000 : 0 }
      })
      await stubBackend(page, aiBackend({}))
      await page.addInitScript((u) => {
        const st = JSON.parse(localStorage.getItem('folio.settings'))
        localStorage.setItem('folio.settings', JSON.stringify({ ...st, aiBaseUrl: u }))
        localStorage.removeItem('folio.ai.usage')
      }, this.srv.url + '/v1')
    },
    async run(page) {
      const { srv } = this
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      const sent = () => srv.seen.filter((r) => r.url.endsWith('/chat/completions'))
      await page.click('#wysiwyg .ProseMirror h1')
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Delete')
      await page.keyboard.press('Control+0')
      const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo']
      for (const [i, w] of words.entries()) {
        if (i) await page.keyboard.press('Enter')
        await page.keyboard.type(`Paragraph ${w} is long enough to be worth an AI check.`)
      }
      await page.keyboard.press('Enter')
      await page.keyboard.type('TONEPARA shouts a little too loudly at the reader here.')
      await wait(1500)
      check('manual mode: nothing sent while typing', sent().length === 0, `${sent().length}`)

      await page.keyboard.press('F7')
      await wait(400)
      const tabs = await page.$$eval('#wc-panel .wc-tab', (xs) => xs.map((x) => x.textContent))
      check('review panel has two tabs', tabs.length === 2 && /Spelling & Grammar/.test(tabs[0]) && /^AI/.test(tabs[1]), JSON.stringify(tabs))
      await page.click('#wc-panel .wc-tab:nth-child(2)')
      await wait(300)
      await page.click('#wc-panel button:has-text("Check whole document")')
      await wait(400)
      const ask = await page.$eval('#modal', (m) => (m.hidden ? '' : m.textContent)).catch(() => '')
      check('whole document asks first, with the request count', /12 requests/.test(ask) && sent().length === 0, ask.slice(0, 160))
      await page.click('#modal button:has-text("Cancel")')
      await wait(200)
      await page.click('#wc-panel .wc-tab:nth-child(2)').catch(() => {})
      await page.click('#wc-panel button:has-text("Check paragraph")')
      await wait(1500)
      check('Check paragraph sends one request', sent().length === 1, `${sent().length}`)
      await page.click('#wc-panel button:has-text("Check whole document")')
      await wait(400)
      const ask2 = await page.$eval('#modal', (m) => (m.hidden ? '' : m.textContent)).catch(() => '')
      check('cached paragraphs are not counted again', /11 requests/.test(ask2), ask2.slice(0, 160))
      await page.click('#modal button.primary')
      await wait(6000)
      check('whole document: one request per paragraph', sent().length === 12, `${sent().length}`)
      const panel = await page.$eval('#wc-panel', (p) => p.textContent)
      check('AI tab lists AI findings and usage', /of 12|1 of/.test(panel) && /Today: 12 requests/.test(panel), panel.slice(0, 300))
      await page.click('#wc-panel .wc-tab:nth-child(1)')
      await wait(300)
      const wcTab = await page.$eval('#wc-panel', (p) => p.textContent)
      check('Spelling & Grammar tab does not list AI findings', !/AI ·/.test(wcTab) && !/Check paragraph/.test(wcTab), wcTab.slice(0, 160))
      await page.click('#wc-panel .wc-tab:nth-child(2)')
      await wait(300)

      // right-click extras on an AI finding
      const tone = await page.$$('#wysiwyg .wc-ai-rec')
      let toneEl = null
      for (const x of tone) if ((await x.textContent()) === 'TONEPARA') toneEl = x
      const tb = await toneEl.boundingBox()
      await page.mouse.click(tb.x + 4, tb.y + tb.height / 2, { button: 'right' })
      await wait(300)
      const items = await page.$$eval('#ctxmenu .menu-item', (xs) => xs.map((x) => x.textContent))
      check('AI menu: Explain more and Ignore this kind', items.some((t) => /Explain more/.test(t)) && items.some((t) => /Ignore this kind/.test(t)), JSON.stringify(items))
      const n0 = sent().length
      await page.click('#ctxmenu .menu-item:has-text("Explain more")')
      await wait(1500)
      const expl = await page.$eval('#modal', (m) => (m.hidden ? '' : m.textContent)).catch(() => '')
      check('Explain more: one request, shows the answer', sent().length === n0 + 1 && /reads more smoothly/.test(expl), expl.slice(0, 120))
      await page.click('#modal button.primary').catch(() => {})
      await wait(200)
      await page.mouse.click(tb.x + 4, tb.y + tb.height / 2, { button: 'right' })
      await wait(300)
      await page.click('#ctxmenu .menu-item:has-text("Ignore this kind")')
      await wait(300)
      const aspects = await page.evaluate(() => JSON.parse(localStorage.getItem('folio.settings')).aiRecAspects)
      check('Ignore this kind turns that aspect off', JSON.stringify(aspects) === '["clarity"]', JSON.stringify(aspects))

      // removing the extension while a request is on its way
      await page.click('#wysiwyg .ProseMirror')
      await page.keyboard.press('Control+End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('SLOWPARA takes a while to come back from the server here.')
      if (!(await page.$eval('#wc-panel', (p) => !p.hidden).catch(() => false))) await page.keyboard.press('F7')
      await wait(300)
      if (!(await page.$('#wc-panel button:has-text("Check paragraph")'))) await page.click('#wc-panel .wc-tab:nth-child(2)')
      await page.click('#wc-panel button:has-text("Check paragraph")')
      await wait(300)
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Extensions")')
      await wait(200)
      await page.click('.ext-card:nth-child(3) button.ext-act')
      await wait(300)
      await page.click('#modal button:has-text("Remove")')
      await wait(4000)
      const left = await page.evaluate(() => document.querySelectorAll('#wysiwyg .wc-ai-fix, #wysiwyg .wc-ai-rec').length)
      check('removed mid-request: no AI underlines, no errors', left === 0 && !errors.length, `${left} ${errors.join('; ')}`)
      srv.close()
      summary()
    },
  },
  'ai-limits': {
    open: 'Welcome.md',
    settings: AI({ aiProvider: 'custom', aiFixWhen: 'manual', aiRecWhen: 'manual', aiPerDay: 1, autocorrect: false, spellcheck: false }),
    async setup(page) {
      this.srv = await fakeAi(() => openaiAnswer('{"findings":[]}'))
      await stubBackend(page, aiBackend({}))
      await page.addInitScript((u) => {
        const st = JSON.parse(localStorage.getItem('folio.settings'))
        localStorage.setItem('folio.settings', JSON.stringify({ ...st, aiBaseUrl: u }))
        localStorage.removeItem('folio.ai.usage')
      }, this.srv.url + '/v1')
    },
    async run(page) {
      const sent = () => this.srv.seen.length
      await page.click('#wysiwyg .ProseMirror h1')
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Delete')
      await page.keyboard.press('Control+0')
      await page.keyboard.type('The first paragraph is long enough to be checked by the AI.')
      await page.keyboard.press('Enter')
      await page.keyboard.type('The second paragraph is long enough to be checked as well.')
      await page.keyboard.press('F7')
      await wait(300)
      await page.click('#wc-panel .wc-tab:nth-child(2)')
      await page.click('#wc-panel button:has-text("Check paragraph")')
      await wait(1200)
      await page.click('#wysiwyg >> text=The first paragraph') // the panel has focus: put the cursor in the first paragraph
      await page.click('#wc-panel button:has-text("Check paragraph")')
      await wait(1200)
      const panel = await page.$eval('#wc-panel', (p) => p.textContent)
      check('daily limit pauses checking and says so', sent() === 1 && /daily limit/i.test(panel), `${sent()} ${panel.slice(0, 200)}`)
      await page.click('#wc-panel button:has-text("Check anyway")')
      await wait(1200)
      check('Check anyway sends exactly one request', sent() === 2, `${sent()}`)
      this.srv.close()
      summary()
    },
  },
}
