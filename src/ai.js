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
