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
/** The API base: the preset's, unless the user entered one for this provider (custom server, local port).
 *  Kept per provider, so an address typed for Ollama never receives a cloud provider's API key. */
export const baseUrl = () => ((s().aiBaseUrls || {})[s().aiProvider] || preset().base).replace(/\/+$/, '')
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
let waitingLeave = false // a paragraph waits for the cursor to leave it (writing.js tells us)
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
  let nextDue = Infinity
  waitingLeave = false
  texts.forEach((t, i) => {
    if (baseline.has(t) || t.replace(/\[code\]/g, '').trim().length < +s().aiMinChars || t.length > +s().aiMaxChars) return
    const due = features().filter((f) => {
      if (f.when === 'manual') return false
      const k = keyOf(f.id, t)
      if (cache.has(k) || failed.has(k) || queued.has(k)) return false
      const left = f.when === 'pause' || i !== info.caretBlock
      const wait = +s().aiPause * 1000 - info.idle
      if (left && wait <= 0) return true
      if (left) nextDue = Math.min(nextDue, wait)
      else waitingLeave = true // no timer: the cursor moving away brings it back
      return false
    })
    if (due.length) enqueue(t, s().aiContext ? texts[i - 1] || '' : '', due.map((f) => f.id))
  })
  // a paragraph becomes due when the pause is over: one timer for the earliest one
  clearTimeout(pollTimer)
  if (nextDue < Infinity) pollTimer = setTimeout(() => onChange(), nextDue + 50)
  pump()
}

/** AI turned off or removed: drop everything that hasn't been sent yet. */
export function stop() {
  for (const j of queue.splice(0)) for (const f of j.feats) queued.delete(keyOf(f, j.text))
  clearTimeout(pollTimer)
  waitingLeave = false
  paused = null
}

function enqueue(text, prev, feats, force = false) {
  for (const f of feats) queued.add(keyOf(f, text))
  queue.push({ text, prev, feats, force })
}

function pump() {
  if (!aiSource.active()) return stop()
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

// ════════════════════════════════════════ review panel (AI tab), right-click extras, status
const allFeats = () => features().map((f) => f.id)
const remaining = (text) => allFeats().filter((f) => !cache.has(keyOf(f, text)))
const providerName = () => (PRESETS.find((p) => p[0] === s().aiProvider) || PRESETS[0])[1].replace(/ \(.*\)$/, '')
const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Check the paragraph with the cursor now, whatever "when to check" says. force = past the limits. */
function checkCaret(h, force = false) {
  const blocks = h.blocks()
  const i = h.caretBlock()
  if (i < 0) return ctx.toast('Put the cursor in a paragraph first')
  const text = sendable(blocks[i])
  if (text.replace(/\[code\]/g, '').trim().length < +s().aiMinChars) return ctx.toast('This paragraph is too short to check')
  const feats = remaining(text)
  if (!feats.length) return ctx.toast('This paragraph was checked already')
  for (const f of feats) failed.delete(keyOf(f, text))
  enqueue(text, s().aiContext ? (i > 0 ? sendable(blocks[i - 1]) : '') : '', feats, force)
  pump()
  onChange()
}

/** Every paragraph that has no answer yet; asks first, with the number of requests. */
async function checkAll(h) {
  const blocks = h.blocks()
  const todo = []
  blocks.forEach((b, i) => {
    const text = sendable(b)
    if (text.replace(/\[code\]/g, '').trim().length < +s().aiMinChars) return
    const feats = remaining(text)
    if (feats.length) todo.push({ text, prev: s().aiContext && i > 0 ? sendable(blocks[i - 1]) : '', feats })
  })
  if (!todo.length) return ctx.toast('Every paragraph was checked already')
  // a rough estimate: ~4 characters per token, plus the instructions and the answer
  const tokens = todo.reduce((n, j) => n + Math.ceil((j.text.length + j.prev.length) / 4) + 350 + +s().aiMaxOut, 0)
  if (todo.length > 3) {
    const ok = await ctx.dialog({
      title: 'Check the whole document?',
      body: `This sends ${todo.length} requests to ${providerName()}, about ${tokens.toLocaleString()} tokens at most. Your limits still apply.`,
      buttons: [
        { label: 'Cancel', value: false, cancel: true },
        { label: `Check ${todo.length} paragraphs`, value: true, primary: true },
      ],
    })
    if (!ok) return
  }
  for (const j of todo) {
    for (const f of j.feats) failed.delete(keyOf(f, j.text))
    enqueue(j.text, j.prev, j.feats)
  }
  pump()
  onChange()
}

/** The AI tab's own controls: check buttons, limits, usage, provider. */
function panel(h) {
  const { el } = ctx
  const u = usage()
  const st = status()
  const box = el('div', { class: 'wc-ai-box' })
  const btn = (label, title, fn, cls = '') => el('button', { class: cls, title, onclick: fn }, label)
  if (st.paused) {
    const what = { hour: 'hourly limit', day: 'daily limit', tokens: 'daily token limit' }[st.paused.reason]
    box.append(el('p', { class: 'wc-ai-paused' }, `Paused: ${what} reached (until ${time(st.paused.resetAt)}).`), btn('Check anyway', 'Send one request for this paragraph despite the limit', () => checkCaret(h, true)))
  } else if (st.checking) box.append(el('p', { class: 'wc-ai-note' }, `Checking ${st.checking} paragraph${st.checking > 1 ? 's' : ''}…`))
  else if (st.last && /failed|could not/.test(st.last)) box.append(el('p', { class: 'wc-ai-note err' }, st.last))
  box.append(
    el('div', { class: 'wc-actions' }, btn('Check paragraph', 'Check the paragraph with the cursor (Ctrl+Alt+K)', () => checkCaret(h), 'primary'), btn('Check whole document', 'Every paragraph that has no AI answer yet', () => checkAll(h))),
    el('p', { class: 'wc-ai-usage' }, `Today: ${u.req} request${u.req === 1 ? '' : 's'}, ${u.tokens.toLocaleString()} tokens · limits ${s().aiPerHour}/hour, ${s().aiPerDay}/day, ${(+s().aiTokensDay).toLocaleString()} tokens/day`),
    el('div', { class: 'wc-foot' }, el('span', {}, `${providerName()} · ${s().aiModel || 'no model chosen'}`), btn('Options…', 'Preferences → AI', () => ctx.openOptions?.(), 'wc-link')),
  )
  return box
}

const ASPECT_OF = { clarity: 'clarity', conciseness: 'concise', 'word choice': 'words', structure: 'structure', consistency: 'consistency', tone: 'tone' }

function menuExtras(iss) {
  const kind = iss.rule.replace(/^ai:/, '')
  return [
    [
      'Ignore this kind of suggestion',
      () => {
        if (ASPECT_OF[kind]) s().aiRecAspects = (s().aiRecAspects || []).filter((a) => a !== ASPECT_OF[kind])
        else s().wcDisabledRules = [...new Set([...(s().wcDisabledRules || []), iss.rule])]
        ctx.saveSettings()
        ctx.toast(`No more “${kind}” suggestions (Preferences → AI to change)`, 2600)
        onChange()
      },
    ],
    ['Explain more…', () => explain(iss)],
  ]
}

/** One extra request, only when asked: why the AI suggests this. */
async function explain(iss) {
  const rep = iss.sugg[0]?.text ?? ''
  ctx.toast('Asking…')
  try {
    const r = await complete({
      system: 'Explain briefly, in two or three plain sentences, why the suggested change improves the text. No preamble.',
      user: `TEXT:\n${iss.block}\n\nSuggested change: “${iss.problem}” → “${rep}”. (${iss.message})`,
      maxTokens: +s().aiMaxOut,
    })
    record(r.inTokens, r.outTokens)
    await ctx.dialog({ title: 'Why this suggestion', body: r.text.trim() || 'No answer.' })
  } catch (e) {
    record(0, 0)
    ctx.toast('Could not ask: ' + (e.message || e), 4000)
  }
}

function statusText() {
  const st = status()
  if (st.paused) return `AI paused: ${st.paused.reason === 'hour' ? 'hourly' : 'daily'} limit reached`
  if (st.checking) return 'AI checking…'
  return st.last ? 'AI: ' + st.last : ''
}

/** A few characters for the status bar: checking, paused, or a problem. */
function statusBadge() {
  const st = status()
  if (st.paused) return 'AI paused'
  if (st.checking) return 'AI…'
  if (/failed|could not/.test(st.last) && Date.now() - (statusLog.at(-1)?.at || 0) < 10 * 60000) return 'AI ⚠'
  return ''
}

Object.assign(aiSource, { panel, menuExtras, statusText, statusBadge, wantsCaret: () => waitingLeave })
/** Tools → AI: Check Paragraph / Check Document, for menus and shortcuts. */
export const commands = { checkCaret, checkAll }

// ════════════════════════════════════════ MCP setup guide
const GUIDE_URL = 'https://raw.githubusercontent.com/Sooeeren/CaretFlow/main/docs/MCP.md'

/** docs/MCP.md from GitHub (always current), or the copy that comes with the app when offline. */
export async function openSetupGuide() {
  let md = ''
  try {
    const r = await invoke('cloud_http', { req: { method: 'GET', url: GUIDE_URL, headers: [], timeoutMs: 8000 } })
    const text = dec.decode(Uint8Array.from(atob(r.body || ''), (c) => c.charCodeAt(0)))
    if (r.status === 200 && /^#\s/.test(text)) md = text
  } catch {}
  if (!md) md = (await import('../docs/MCP.md?raw')).default
  ctx.openDoc(md)
}

// ════════════════════════════════════════ Preferences → AI
const LANGS = [
  ['auto', 'Same as the text'],
  ['English', 'English'],
  ['German', 'German'],
  ['French', 'French'],
  ['Spanish', 'Spanish'],
  ['Italian', 'Italian'],
  ['Portuguese', 'Portuguese'],
  ['Dutch', 'Dutch'],
  ['Polish', 'Polish'],
  ['Swedish', 'Swedish'],
  ['Danish', 'Danish'],
  ['Norwegian', 'Norwegian'],
  ['Czech', 'Czech'],
  ['Ukrainian', 'Ukrainian'],
  ['Russian', 'Russian'],
  ['Turkish', 'Turkish'],
  ['Japanese', 'Japanese'],
  ['Chinese', 'Chinese'],
]
const WHEN = [
  ['leave', 'When I finish a paragraph'],
  ['pause', 'When I pause typing'],
  ['manual', 'Only when I ask'],
]
const LEVEL = [
  ['relaxed', 'Relaxed'],
  ['balanced', 'Balanced'],
  ['strict', 'Strict'],
]

let mcpSection = null // filled in by mcp.js (Preferences → AI → MCP server)
export const setMcpSection = (fn) => (mcpSection = fn)

export function prefsPage(row) {
  const { el, customSelect } = ctx
  const st = s()
  const changed = () => {
    ctx.saveSettings()
    onChange()
  }
  const check = (key, after) => {
    const c = el('input', { type: 'checkbox', checked: !!st[key] })
    c.onchange = () => {
      st[key] = c.checked
      changed()
      after?.()
    }
    return c
  }
  const pick = (key, opts, after) =>
    customSelect(opts, st[key], (v) => {
      st[key] = v
      changed()
      after?.()
    })
  const text = (key, { placeholder = '', width = 260 } = {}) => {
    const i = el('input', { type: 'text', value: st[key] ?? '', placeholder, spellcheck: 'false', style: `width:${width}px;max-width:100%` })
    i.onchange = () => {
      st[key] = i.value.trim()
      changed()
    }
    return i
  }
  const num = (key, min, max, step = 1) => {
    const i = el('input', { type: 'number', value: st[key], min, max, step, style: 'width:110px' })
    i.onchange = () => {
      const v = Math.min(max, Math.max(min, +i.value || min))
      i.value = v
      st[key] = v
      changed()
    }
    return i
  }
  const sub = (title, hint) => el('div', { class: 'pref-sub' }, title, hint ? el('small', {}, hint) : null)

  // the banner at the top: help with MCP
  const banner = st.aiGuideBanner
    ? el(
        'div',
        { class: 'ai-banner' },
        el('span', {}, el('b', {}, 'Need help setting up MCP?'), ' Connect Claude Desktop, Cursor, VS Code or another AI app to CaretFlow. '),
        el('button', { type: 'button', class: 'ai-guide-btn', onclick: () => openSetupGuide() }, 'Open the setup guide'),
        el('button', {
          type: 'button',
          class: 'ai-banner-x',
          title: 'Hide (Help → AI Setup Guide still opens it)',
          onclick: (e) => {
            st.aiGuideBanner = false
            ctx.saveSettings()
            e.target.closest('.ai-banner').remove()
          },
        }, '✕'),
      )
    : null

  // connection
  const keyRow = row('API key', 'Stored on this computer only, outside the editor’s storage', secretInput())
  const urlInput = el('input', { type: 'text', spellcheck: 'false', style: 'width:300px;max-width:100%' })
  urlInput.onchange = () => {
    st.aiBaseUrls = { ...(st.aiBaseUrls || {}), [st.aiProvider]: urlInput.value.trim() }
    changed()
  }
  const urlRow = row('Address', 'The server’s OpenAI-compatible API, e.g. http://localhost:11434/v1', urlInput)
  const models = el('datalist', { id: 'ai-models' })
  const model = text('aiModel', { placeholder: 'e.g. claude-sonnet-5-5, gpt-5-mini, llama3.2' })
  model.setAttribute('list', 'ai-models')
  const loadModels = el('button', { type: 'button', class: 'fsel' }, 'Load list')
  loadModels.onclick = async () => {
    loadModels.textContent = 'Loading…'
    try {
      models.innerHTML = ''
      const list = await listModels()
      for (const m of list) models.append(el('option', { value: m }))
      loadModels.textContent = `${list.length} models`
      model.focus()
    } catch (e) {
      loadModels.textContent = 'Load list'
      ctx.toast('Could not load the models: ' + (e.message || e), 4000)
    }
  }
  const result = el('div', { class: 'ai-test' })
  const test = el('button', { type: 'button', class: 'fsel' }, 'Test connection')
  test.onclick = async () => {
    result.className = 'ai-test'
    result.textContent = 'Sending one small request…'
    const r = await testConnection()
    result.classList.add(r.ok ? 'ok' : 'err')
    result.textContent = r.msg
    usageLine()
  }
  function secretInput() {
    const i = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', style: 'width:260px;max-width:100%' })
    const show = () =>
      invoke('secret_get', { key: secretKey() })
        .then((v) => (i.placeholder = v ? '•••••••• (saved)' : preset().key ? 'Paste your API key' : 'Optional'))
        .catch(() => {})
    show()
    i.onchange = async () => {
      await invoke('secret_set', { key: secretKey(), value: i.value.trim() })
      i.value = ''
      show()
      ctx.toast('Saved')
    }
    i.refresh = show
    return i
  }
  const showProvider = () => {
    const p = preset()
    const local = !p.base || /localhost/.test(p.base)
    urlRow.hidden = !local
    urlInput.value = (st.aiBaseUrls || {})[st.aiProvider] || ''
    urlInput.placeholder = p.base || 'http://localhost:8080/v1'
    keyRow.hidden = local && st.aiProvider !== 'custom'
    keyRow.querySelector('input').refresh?.()
    result.textContent = ''
  }

  // recommendations: what to look for
  const aspects = el('span', { class: 'ai-aspects' })
  for (const [id, label] of [
    ['clarity', 'Clarity'],
    ['concise', 'Conciseness'],
    ['words', 'Word choice'],
    ['structure', 'Sentence structure'],
    ['consistency', 'Consistency'],
    ['tone', 'Tone'],
  ]) {
    const c = el('input', { type: 'checkbox', checked: (st.aiRecAspects || []).includes(id) })
    c.onchange = () => {
      const set = new Set(st.aiRecAspects || [])
      c.checked ? set.add(id) : set.delete(id)
      st.aiRecAspects = [...set]
      changed()
    }
    aspects.append(el('label', { class: 'ai-aspect' }, c, label))
  }
  const instructions = el('textarea', { class: 'ai-instr', rows: 3, spellcheck: 'false', placeholder: 'e.g. British spelling. I use the Oxford comma. Don’t shorten dialogue.' })
  instructions.value = st.aiInstructions || ''
  instructions.onchange = () => {
    st.aiInstructions = instructions.value
    changed()
  }

  // usage
  const usageOut = el('span', { class: 'ai-usage' })
  function usageLine() {
    const u = usage()
    usageOut.textContent = `Today: ${u.req} request${u.req === 1 ? '' : 's'}, ${u.tokens.toLocaleString()} tokens`
  }
  usageLine()
  const resetBtn = el('button', { type: 'button', class: 'fsel', onclick: () => (resetUsage(), usageLine(), ctx.toast('Usage counter reset')) }, 'Reset')

  const page = el(
    'div',
    { 'data-section': 'ai' },
    banner,
    row('Turn on AI writing help', 'Text is sent only to the provider below, and only once this is on. Nothing changes until you click Apply', check('aiEnabled', () => ctx.aiToggled?.())),
    sub('Connection'),
    row('Provider', 'Your own account and key, or a model on this computer', pick('aiProvider', PRESETS.map(([id, label]) => [id, label]), showProvider)),
    urlRow,
    keyRow,
    row('Model', 'The model’s name at the provider', el('span', { class: 'ai-model' }, model, loadModels, models)),
    row('', null, el('span', {}, test, result)),
    sub('AI spelling & grammar', 'Mistakes the offline check misses: wrong words in context, agreement, any language the model knows'),
    row('Check spelling & grammar with AI', null, check('aiFix')),
    row('When to check', null, pick('aiFixWhen', WHEN)),
    row('Sensitivity', 'Relaxed: only clear mistakes. Strict: everything worth mentioning', pick('aiFixLevel', LEVEL)),
    sub('Recommendations', 'Clearer, shorter, better-fitting wording'),
    row('Suggest improvements', null, check('aiRec')),
    row('When to check', null, pick('aiRecWhen', WHEN)),
    row('Sensitivity', 'Relaxed: only strong improvements. Strict: every idea', pick('aiRecLevel', LEVEL)),
    row('Look for', null, aspects),
    row('Tone to aim for', 'Used when Tone is checked', pick('aiTone', [['', 'No preference'], ['neutral', 'Neutral'], ['formal', 'Formal'], ['friendly', 'Friendly'], ['academic', 'Academic'], ['technical', 'Technical']])),
    sub('Both'),
    row('Language', null, pick('aiLanguage', LANGS)),
    row('Your instructions', 'Added to every request', instructions),
    row('Send the paragraph before as context', 'Better answers; a bit more text per request', check('aiContext')),
    row('Pause before checking', 'Seconds without typing', num('aiPause', 2, 30)),
    row('Skip paragraphs shorter than', 'Characters', num('aiMinChars', 5, 500)),
    sub('Limits & usage', 'Checking pauses when a limit is reached; you can always check one paragraph anyway'),
    row('Max answer length', 'Output tokens per request', num('aiMaxOut', 50, 4000, 50)),
    row('Max text per request', 'Characters; longer paragraphs are checked only when you ask', num('aiMaxChars', 200, 20000, 100)),
    row('Requests per hour', null, num('aiPerHour', 1, 1000)),
    row('Requests per day', null, num('aiPerDay', 1, 10000)),
    row('Tokens per day', 'Sent and received together', num('aiTokensDay', 1000, 10000000, 1000)),
    row('Temperature', '0 = most predictable', num('aiTemperature', 0, 1, 0.1)),
    row('Usage', 'Counted from the provider’s answers', el('span', {}, usageOut, ' ', resetBtn)),
    sub('MCP server', 'Let your AI app (Claude Desktop, Cursor, VS Code…) read the open document and send suggestions'),
    mcpSection ? mcpSection(row) : el('p', { class: 'about-note' }, 'Not available'),
  )
  showProvider()
  return page
}
