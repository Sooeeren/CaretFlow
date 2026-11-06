// Checks for the MCP tools in the frontend (src/mcp.js). The Rust server is stood in for: the test
// delivers `mcp-call` events the way Tauri would and records the app's `mcp_reply` answers.
import { check, summary, stubBackend, wait } from './lib.mjs'

const AI = { extensions: ['ai'], aiEnabled: false, mcpEnabled: true, autocorrect: false }

function backend(log) {
  const secrets = {}
  return {
    secret_get: ({ key }) => secrets[key] ?? null,
    secret_set: ({ key, value }) => void (value ? (secrets[key] = value) : delete secrets[key]),
    mcp_start: (a) => void log.push(['start', a]),
    mcp_stop: () => void log.push(['stop']),
    mcp_status: () => ({ running: true, port: 38457, clients: [{ name: 'Claude Desktop', version: '1.0', lastSeenMs: Date.now() }] }),
    mcp_reply: (a) => void log.push(['reply', a]),
    exe_path: () => 'C:\\Program Files\\CaretFlow\\caretflow.exe',
  }
}

/** Keep the event callbacks the app registers, so the test can deliver events like Tauri does. */
const captureEvents = (page) =>
  page.addInitScript(() => {
    const T = window.__TAURI_INTERNALS__
    const transform = T.transformCallback
    window.__cbs = {}
    T.transformCallback = (fn, once) => {
      const id = transform(fn, once)
      window.__cbs[id] = fn
      return id
    }
    const invoke = T.invoke
    window.__listens = []
    T.invoke = (cmd, a = {}) => {
      if (cmd === 'plugin:event|listen') window.__listens.push(a)
      return invoke(cmd, a)
    }
  })

export const scenes = {
  'mcp-tools': {
    open: 'Welcome.md',
    settings: AI,
    async setup(page) {
      this.log = []
      await stubBackend(page, backend(this.log))
      await captureEvents(page)
    },
    async run(page) {
      const log = this.log
      let id = 0
      const call = async (tool, args = {}, client = 'Claude Desktop') => {
        const n = ++id
        await page.evaluate(
          ([n, tool, args, client]) => {
            const l = window.__listens.find((x) => x.event === 'mcp-call')
            window.__cbs[l.handler]({ event: 'mcp-call', id: n, payload: { id: n, client, tool, args } })
          },
          [n, tool, args, client],
        )
        for (let i = 0; i < 40; i++) {
          const r = log.find((x) => x[0] === 'reply' && x[1].id === n)
          if (r) return r[1]
          await wait(100)
        }
        return null
      }
      await wait(1500)
      const start = log.find((x) => x[0] === 'start')
      check('server starts with the port and a long token', start && start[1].port === 38457 && /^[0-9a-f]{64}$/.test(start[1].token), JSON.stringify(start))

      const before = await page.$eval('#wysiwyg .ProseMirror', (e) => e.textContent)
      let r = await call('get_document')
      check('get_document returns the Markdown', /# A quiet place to write/.test(r?.result?.markdown) && /Welcome\.md$/.test(r?.result?.path), JSON.stringify(r).slice(0, 160))

      // select the title; a click can land on the heading's handle instead, so try until it's selected
      for (let i = 0; i < 5; i++) {
        await page.click('#wysiwyg .ProseMirror h1')
        await page.keyboard.press('Home')
        await page.keyboard.press('Shift+End')
        await wait(150)
        if (await page.evaluate(() => getSelection().toString() === 'A quiet place to write')) break
      }
      r = await call('get_selection')
      check('get_selection returns the selected text', r?.result?.text === 'A quiet place to write', JSON.stringify(r))

      r = await call('add_suggestions', { suggestions: [{ quote: 'quiet place', replacement: 'calm place', message: 'Softer.', kind: 'word choice' }, { quote: 'not in the document', replacement: 'x' }] })
      check('add_suggestions: placed and skipped', r?.result?.placed === 1 && r?.result?.skipped === 1, JSON.stringify(r))
      await wait(2500) // underlines are drawn with the spelling check's results, which may still be loading
      const marks = await page.$$eval('#wysiwyg .wc-ai-rec', (xs) => xs.map((x) => x.textContent))
      check('suggestion is underlined', marks.includes('quiet place'), JSON.stringify(marks))
      const notice = await page.$eval('#notice', (n) => (n.hidden ? '' : n.textContent))
      check('first call from an app shows a notice with Disconnect', /Claude Desktop connected over MCP/.test(notice) && /Disconnect/.test(notice), notice)

      await page.keyboard.press('F7')
      await wait(300)
      const tabs = await page.$$eval('#wc-panel .wc-tab', (xs) => xs.map((x) => x.textContent))
      if (tabs.length) await page.click('#wc-panel .wc-tab:nth-child(2)')
      await wait(300)
      const panel = await page.$eval('#wc-panel', (p) => p.textContent)
      check('AI tab lists it with the app name', /Claude Desktop/.test(panel) && /calm place/.test(panel), panel.slice(0, 200))
      await page.keyboard.press('Escape')

      await call('add_suggestions', { suggestions: [{ quote: 'This week', replacement: 'This Week', kind: 'consistency' }] }, 'Cursor')
      r = await call('clear_suggestions')
      await wait(600)
      const left = await page.$$eval('#wysiwyg .wc-ai-rec, #wysiwyg .wc-ai-fix', (xs) => xs.map((x) => x.textContent))
      check("clear_suggestions removes only that app's", r?.result?.removed === 1 && left.includes('This week') && !left.includes('quiet place'), JSON.stringify([r, left]))

      r = await call('get_writing_issues')
      check('get_writing_issues answers with a list', Array.isArray(r?.result), JSON.stringify(r).slice(0, 120))
      r = await call('get_document', {}, 'Cursor')
      check('no tool changed the document', (await page.$eval('#wysiwyg .ProseMirror', (e) => e.textContent)) === before)

      // Preferences: snippets with the exe path, new token restarts the server
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("AI")')
      await wait(800)
      const snippets = await page.$$eval('.mcp-snippet', (xs) => xs.map((x) => x.textContent))
      check('Claude Desktop setup has the exe path and --mcp', snippets.some((t) => /caretflow\.exe/.test(t) && /--mcp/.test(t)), snippets[0]?.slice(0, 160))
      check('HTTP setups carry the token', snippets.some((t) => /Bearer [0-9a-f]{64}/.test(t) && /127\.0\.0\.1:38457\/mcp/.test(t)))
      const clients = await page.$eval('.mcp-clients', (e) => e.textContent).catch(() => '')
      check('connected apps are listed', /Claude Desktop/.test(clients), clients)
      const n = log.length
      await page.click('.prefs-page:not([hidden]) button:has-text("New token")')
      await wait(500)
      const after = log.slice(n).map((x) => x[0])
      const newStart = log.slice(n).find((x) => x[0] === 'start')
      check('New token restarts the server with another token', after.includes('stop') && newStart && newStart[1].token !== start[1].token, JSON.stringify(after))
      await page.keyboard.press('Escape')

      // removing the extension stops the server and clears MCP suggestions
      await page.keyboard.press('Control+,')
      await wait(300)
      await page.click('.prefs-nav button:has-text("Extensions")')
      await wait(200)
      const m = log.length
      await page.click('.ext-card:nth-child(3) button.ext-act')
      await wait(300)
      if (await page.$('#modal button:has-text("Remove")')) await page.click('#modal button:has-text("Remove")')
      await wait(800)
      const gone = await page.$$eval('#wysiwyg .wc-ai-rec, #wysiwyg .wc-ai-fix', (xs) => xs.length)
      check('removing AI Writing Help stops MCP and clears its suggestions', log.slice(m).some((x) => x[0] === 'stop') && gone === 0, `${gone}`)
      summary()
    },
  },
}
