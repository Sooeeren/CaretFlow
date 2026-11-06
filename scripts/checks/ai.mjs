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
}
