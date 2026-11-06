// AI Writing Help (lazy, an extension): corrections and recommendations from the AI the user chooses.
// Two request formats cover every provider: Anthropic's Messages API, and OpenAI's Chat Completions,
// which Gemini, DeepSeek, Mistral, xAI, OpenRouter, Groq and local servers (Ollama, LM Studio,
// llama.cpp, vLLM) all speak. Requests go through the Rust `cloud_http` command; nothing is sent
// until the user set up a provider. Every request is counted against the user's limits.
import { invoke } from '@tauri-apps/api/core'

let ctx // { settings, saveSettings, log, … } from main.js
const s = () => ctx.settings
export function initAi(c) {
  ctx = c
}

// ════════════════════════════════════════ providers
// [id, label, { format, base, key }]: key = whether an API key is needed
export const PRESETS = [
  ['anthropic', 'Anthropic (Claude)', { format: 'anthropic', base: 'https://api.anthropic.com/v1', key: true }],
  ['openai', 'OpenAI (ChatGPT models)', { format: 'openai', base: 'https://api.openai.com/v1', key: true }],
  ['gemini', 'Google Gemini', { format: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: true }],
  ['deepseek', 'DeepSeek', { format: 'openai', base: 'https://api.deepseek.com/v1', key: true }],
  ['mistral', 'Mistral', { format: 'openai', base: 'https://api.mistral.ai/v1', key: true }],
  ['xai', 'xAI (Grok)', { format: 'openai', base: 'https://api.x.ai/v1', key: true }],
  ['openrouter', 'OpenRouter', { format: 'openai', base: 'https://openrouter.ai/api/v1', key: true }],
  ['groq', 'Groq', { format: 'openai', base: 'https://api.groq.com/openai/v1', key: true }],
  ['ollama', 'Ollama (on this computer)', { format: 'openai', base: 'http://localhost:11434/v1', key: false }],
  ['lmstudio', 'LM Studio (on this computer)', { format: 'openai', base: 'http://localhost:1234/v1', key: false }],
  ['custom', 'Other OpenAI-compatible server', { format: 'openai', base: '', key: false }],
]
export const preset = (id = s().aiProvider) => (PRESETS.find((p) => p[0] === id) || PRESETS[0])[2]
/** The API base: the preset's, unless the user entered one (custom servers, local ports, proxies). */
export const baseUrl = () => (s().aiBaseUrl || preset().base).replace(/\/+$/, '')
export const secretKey = (id = s().aiProvider) => 'ai:' + id

export class AiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'AiError'
    this.status = status
  }
}

const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (str) => {
  const bytes = enc.encode(str)
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}
const unb64 = (str) => dec.decode(Uint8Array.from(atob(str || ''), (c) => c.charCodeAt(0)))

async function request(method, path, body, headers = {}) {
  const key = (await invoke('secret_get', { key: secretKey() }).catch(() => null)) || ''
  const p = preset()
  const h = { 'content-type': 'application/json', ...headers }
  if (key && p.format === 'anthropic') {
    h['x-api-key'] = key
    h['anthropic-version'] = '2023-06-01'
  } else if (key) h.authorization = 'Bearer ' + key
  else if (p.format === 'anthropic') h['anthropic-version'] = '2023-06-01'
  let r
  try {
    r = await invoke('cloud_http', { req: { method, url: baseUrl() + path, headers: Object.entries(h), body: body ? b64(JSON.stringify(body)) : null, timeoutMs: 60000 } })
  } catch (e) {
    throw new AiError(`Could not reach ${baseUrl()}: ${e}`)
  }
  let data = null
  try {
    data = JSON.parse(unb64(r.body) || 'null')
  } catch {}
  if (r.status < 200 || r.status >= 300) {
    const msg = data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : '') || `HTTP ${r.status}`
    throw new AiError(r.status === 401 || r.status === 403 ? `The provider refused the API key (${r.status}): ${msg}` : msg, r.status)
  }
  return data
}

// OpenAI's newer models want max_completion_tokens and only their default temperature
const reasoningModel = (m) => /^(o\d|gpt-5)/i.test(m || '')

/** One request to the model. Returns its text and the provider's token counts. */
export async function complete({ system, user, maxTokens = s().aiMaxOut }) {
  const model = s().aiModel
  if (!model) throw new AiError('Choose a model in Preferences → AI.')
  const p = preset()
  const temperature = +s().aiTemperature
  if (p.format === 'anthropic') {
    const d = await request('POST', '/messages', { model, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] })
    const text = (d?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
    return { text, inTokens: d?.usage?.input_tokens || 0, outTokens: d?.usage?.output_tokens || 0, model: d?.model || model }
  }
  const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }
  if (s().aiProvider === 'openai') {
    body.max_completion_tokens = maxTokens
    if (!reasoningModel(model)) body.temperature = temperature
  } else {
    body.max_tokens = maxTokens
    body.temperature = temperature
  }
  const d = await request('POST', '/chat/completions', body)
  const text = d?.choices?.[0]?.message?.content || ''
  return { text: typeof text === 'string' ? text : '', inTokens: d?.usage?.prompt_tokens || 0, outTokens: d?.usage?.completion_tokens || 0, model: d?.model || model }
}

/** Models the provider lists (not every provider has a list; the model can always be typed). */
export async function listModels() {
  const d = await request('GET', '/models')
  return (d?.data || d?.models || []).map((m) => m.id || m.name).filter(Boolean)
}

/** One tiny request: does the key work, does the model answer? Counts toward the limits. */
export async function testConnection() {
  try {
    const r = await complete({ system: 'Answer with the single word OK.', user: 'Say OK.', maxTokens: 16 })
    record(r.inTokens, r.outTokens)
    return { ok: true, msg: `Connected: ${r.model} answered (${r.inTokens + r.outTokens} tokens).` }
  } catch (e) {
    return { ok: false, msg: e.message || String(e) }
  }
}

// ════════════════════════════════════════ limits & usage
const USAGE_KEY = 'folio.ai.usage'
const pad = (n) => String(n).padStart(2, '0')
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hourKey = (d = new Date()) => `${dayKey(d)}T${pad(d.getHours())}`

function loadUsage() {
  let u = {}
  try {
    u = JSON.parse(localStorage.getItem(USAGE_KEY)) || {}
  } catch {}
  if (u.day !== dayKey()) u = { day: dayKey(), hour: hourKey(), req: 0, reqHour: 0, tokens: 0 }
  if (u.hour !== hourKey()) Object.assign(u, { hour: hourKey(), reqHour: 0 })
  return u
}
function saveUsage(u) {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u))
  } catch {}
}

/** Today's usage: { day, req, reqHour, tokens }. */
export const usage = () => loadUsage()
export function record(inTokens, outTokens) {
  const u = loadUsage()
  u.req++
  u.reqHour++
  u.tokens += (inTokens || 0) + (outTokens || 0)
  saveUsage(u)
}
export function resetUsage() {
  saveUsage({ day: dayKey(), hour: hourKey(), req: 0, reqHour: 0, tokens: 0 })
}

/** May another request go out? If not: why, and when that limit resets. */
export function budget() {
  const u = loadUsage()
  const now = new Date()
  const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1).getTime()
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  if (u.req >= +s().aiPerDay) return { ok: false, reason: 'day', resetAt: nextDay }
  if (u.tokens >= +s().aiTokensDay) return { ok: false, reason: 'tokens', resetAt: nextDay }
  if (u.reqHour >= +s().aiPerHour) return { ok: false, reason: 'hour', resetAt: nextHour }
  return { ok: true }
}

// ════════════════════════════════════════ checking while you write
// Unit = one paragraph (a block from writing.js). A block is sent once, after you finished it (or
// paused), and the answer is cached by its text, so undo/redo and reopening cost nothing.
// Blocks that were already there when the document opened are never sent on their own.
const LEVELS = { relaxed: 1, balanced: 3, strict: 6 } // findings per feature and paragraph
const FIX_KINDS = ['spelling', 'grammar', 'punctuation']
const ASPECTS = {
  clarity: 'unclear or ambiguous wording',
  concise: 'wordiness and redundancy',
  words: 'weak or imprecise word choice',
  structure: 'long, tangled or awkward sentences',
  consistency: 'inconsistent terms, spelling or style',
  tone: 'tone',
}
const CACHE_KEY = 'folio.ai.cache'
const IGNORED_KEY = 'folio.ai.ignored'

let onChange = () => {} // set by main.js: writing.js sourceChanged
export const setOnChange = (fn) => (onChange = fn)

const cache = new Map(loadList(CACHE_KEY)) // key → findings
const ignored = new Set(loadList(IGNORED_KEY))
const failed = new Set() // keys whose request failed this session: not retried in a loop
const queued = new Set()
const queue = []
let inflight = 0
let pollTimer = null
let baseline = new Set()
let lastView = null
let lastTexts = new Set()
const statusLog = []
let paused = null

function loadList(k) {
  try {
    return JSON.parse(localStorage.getItem(k)) || []
  } catch {
    return []
  }
}
function saveList(k, list, max) {
  try {
    localStorage.setItem(k, JSON.stringify(list.slice(-max)))
  } catch {}
}
function note(msg) {
  statusLog.push({ at: Date.now(), msg })
  if (statusLog.length > 8) statusLog.shift()
  ctx.log?.('ai: ' + msg)
}
/** What the AI is doing, for the status bar and the review panel. */
export const status = () => ({ checking: inflight + queue.length, paused, last: statusLog.at(-1)?.msg || '', history: statusLog.map((x) => x.msg) })

const features = () =>
  [
    s().aiFix && { id: 'fix', when: s().aiFixWhen, level: s().aiFixLevel },
    s().aiRec && { id: 'rec', when: s().aiRecWhen, level: s().aiRecLevel },
  ].filter(Boolean)

/** Everything that changes what the model answers for a paragraph. */
function sig(f) {
  const st = s()
  const common = [st.aiProvider, st.aiModel, st.aiLanguage, st.aiInstructions, st.wcDialect]
  return JSON.stringify(f === 'fix' ? [...common, st.aiFixLevel] : [...common, st.aiRecLevel, st.aiRecAspects, st.aiTone])
}
const keyOf = (f, text) => `${f}|${sig(f)}|${text}`

/** The text that may leave the computer: inline code and embedded objects masked out. */
export function sendable(b) {
  let out = ''
  let i = 0
  for (const [a, z] of [...(b.masks || [])].sort((x, y) => x[0] - y[0])) {
    if (a < i) continue
    out += b.text.slice(i, a) + (b.text.slice(a, z) === '￼' ? ' ' : '[code]')
    i = z
  }
  return (out + b.text.slice(i)).replace(/￼/g, ' ')
}

export const aiSource = {
  id: 'ai',
  active: () => !!ctx?.installed?.() && !!s().aiEnabled && (s().aiFix || s().aiRec),
  /** Findings for each block (from the cache), and requests for blocks that are due. */
  issues(blocks, info) {
    const texts = blocks.map(sendable)
    observe(texts, info)
    return blocks.map((b, i) => place(b, texts[i]))
  },
  /** A document was opened: its paragraphs are not new writing and are never sent on their own. */
  opened(view, blocks) {
    lastView = view
    baseline = new Set(blocks.map(sendable))
    lastTexts = new Set(baseline)
  },
  ignore(iss) {
    if (!iss.aiKey) return
    ignored.add(iss.aiKey)
    saveList(IGNORED_KEY, [...ignored], 2000)
  },
}

function observe(texts, info) {
  if (info.view !== lastView) {
    // a document was opened (or the editor switched modes): what is there now isn't new writing
    lastView = info.view
    baseline = new Set(texts)
    lastTexts = new Set(texts)
    return
  }
  lastTexts = new Set(texts)
  let waiting = false
  texts.forEach((t, i) => {
    if (baseline.has(t) || t.replace(/\[code\]/g, '').trim().length < +s().aiMinChars || t.length > +s().aiMaxChars) return
    const due = features().filter((f) => {
      if (f.when === 'manual') return false
      const k = keyOf(f.id, t)
      if (cache.has(k) || failed.has(k) || queued.has(k)) return false
      const ready = info.idle >= +s().aiPause * 1000 && (f.when === 'pause' || i !== info.caretBlock)
      if (!ready) waiting = true
      return ready
    })
    if (due.length) enqueue(t, s().aiContext ? texts[i - 1] || '' : '', due.map((f) => f.id))
  })
  // nothing happens in the editor while you pause or move the caret: look again shortly
  clearTimeout(pollTimer)
  if (waiting) pollTimer = setTimeout(() => onChange(), 1000)
  pump()
}

function enqueue(text, prev, feats, force = false) {
  for (const f of feats) queued.add(keyOf(f, text))
  queue.push({ text, prev, feats, force })
}

function pump() {
  while (inflight < Math.max(1, +s().aiParallel) && queue.length) {
    const job = queue[0]
    const b = budget()
    if (!b.ok && !job.force) {
      paused = b
      for (const j of queue.splice(0)) for (const f of j.feats) queued.delete(keyOf(f, j.text))
      onChange()
      return
    }
    paused = null
    queue.shift()
    inflight++
    send(job).finally(() => {
      inflight--
      for (const f of job.feats) queued.delete(keyOf(f, job.text))
      onChange()
      pump()
    })
  }
}

function prompt(feats) {
  const st = s()
  const lines = [
    'You check writing in a Markdown editor. Report problems only in TEXT. CONTEXT, if given, is the paragraph before it: use it to understand TEXT, never report anything in it.',
    '[code] marks code that was removed; leave it alone.',
  ]
  let max = 0
  const kinds = []
  if (feats.includes('fix')) {
    const lvl = st.aiFixLevel
    lines.push(lvl === 'relaxed' ? 'Report only clear spelling and grammar mistakes.' : lvl === 'strict' ? 'Report every spelling, grammar, punctuation and typographic mistake.' : 'Report spelling, grammar and punctuation mistakes.')
    max += LEVELS[lvl] || 3
    kinds.push(...FIX_KINDS)
  }
  if (feats.includes('rec')) {
    const lvl = st.aiRecLevel
    const aspects = (st.aiRecAspects || []).filter((a) => ASPECTS[a])
    const list = aspects.map((a) => (a === 'tone' && st.aiTone ? `a tone that is not ${st.aiTone}` : ASPECTS[a]))
    lines.push(`Suggest improvements for: ${list.join('; ') || 'clarity'}.`)
    lines.push(lvl === 'relaxed' ? 'Suggest only changes that clearly make the text better.' : lvl === 'strict' ? 'Suggest every change that would make the text better.' : 'Suggest changes that noticeably make the text better.')
    max += LEVELS[lvl] || 3
    kinds.push('clarity', 'conciseness', 'word choice', 'structure', 'consistency', 'tone')
  }
  lines.push(st.aiLanguage && st.aiLanguage !== 'auto' ? `The text is in ${st.aiLanguage}.` : 'Keep the language of the text.')
  if (st.wcDialect) lines.push(`If the text is English, follow ${st.wcDialect} spelling.`)
  lines.push(
    `Report at most ${max} findings, the most important first. Answer with JSON only, no other text:`,
    `{"findings":[{"quote":"exact words copied from TEXT, as few as possible","replacement":"the corrected words","kind":"${kinds.join('|')}","message":"one short sentence"}]}`,
    'If there is nothing to report, answer {"findings":[]}.',
  )
  if (st.aiInstructions?.trim()) lines.push('The writer’s own instructions: ' + st.aiInstructions.trim())
  return { system: lines.join('\n'), max }
}

/** The JSON in a model's answer: plain, in a code fence, or between the first { and the last }. */
export function parseFindings(text) {
  const fence = /`{3}(?:json)?\s*([\s\S]*?)`{3}/i.exec(text)?.[1]
  const tries = [text, fence, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]
  for (const t of tries) {
    if (!t) continue
    try {
      const o = JSON.parse(t)
      const list = Array.isArray(o) ? o : o?.findings
      if (Array.isArray(list)) return list.filter((f) => f && typeof f.quote === 'string' && f.quote && typeof (f.replacement ?? '') === 'string')
    } catch {}
  }
  return null
}

async function send(job) {
  const { system } = prompt(job.feats)
  const user = (job.prev ? `CONTEXT:\n${job.prev}\n\n` : '') + `TEXT:\n${job.text}`
  let r
  try {
    r = await complete({ system, user, maxTokens: +s().aiMaxOut })
  } catch (e) {
    record(0, 0) // it still went out; failures must never loop past the limits
    for (const f of job.feats) failed.add(keyOf(f, job.text))
    note(`AI request failed: ${e.message || e}`)
    return
  }
  record(r.inTokens, r.outTokens)
  const found = parseFindings(r.text)
  if (!found) note('AI answer could not be read (it was not the expected JSON).')
  for (const f of job.feats) {
    const mine = (found || []).filter((x) => (f === 'fix') === FIX_KINDS.includes(String(x.kind || '').toLowerCase()))
    cache.set(keyOf(f, job.text), mine.slice(0, LEVELS[f === 'fix' ? s().aiFixLevel : s().aiRecLevel] || 3))
  }
  while (cache.size > 500) cache.delete(cache.keys().next().value)
  saveList(CACHE_KEY, [...cache], 500)
}

const label = (kind) => 'AI · ' + String(kind || 'suggestion').replace(/^./, (c) => c.toUpperCase())
const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Findings for one block, positioned in its text; unplaceable or pointless ones are dropped. */
function place(b, text) {
  const out = []
  for (const f of features()) {
    for (const x of cache.get(keyOf(f.id, text)) || []) {
      const rep = x.replacement ?? ''
      if (rep === x.quote) continue
      const aiKey = `${x.quote}→${rep}@${b.text}`
      if (ignored.has(aiKey)) continue
      let start = b.text.indexOf(x.quote)
      let len = x.quote.length
      if (start < 0) {
        // the model may have tidied the spacing
        const m = new RegExp(x.quote.trim().split(/\s+/).map(escRe).join('\\s+')).exec(b.text)
        if (!m) continue
        start = m.index
        len = m[0].length
      }
      if ((b.masks || []).some(([a, z]) => start < z && start + len > a)) continue
      const kind = String(x.kind || (f.id === 'fix' ? 'grammar' : 'clarity')).toLowerCase()
      out.push({
        start,
        end: start + len,
        cat: f.id === 'fix' ? 'ai-fix' : 'ai-rec',
        kind: label(kind),
        message: String(x.message || ''),
        sugg: [{ label: rep || `Delete “${x.quote}”`, text: rep }],
        rule: 'ai:' + kind,
        source: 'ai',
        aiKey,
      })
    }
  }
  return out
}
