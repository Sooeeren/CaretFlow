// MCP (part of AI Writing Help): CaretFlow's answers to the tools an AI app calls over MCP.
// The server itself is Rust (src-tauri/src/mcp.rs); it sends each tool call here as an `mcp-call`
// event and waits for `mcp_reply`. No tool changes the document: suggestions only show up as
// underlines and in the AI tab, and the writer applies them.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

let ctx // { settings, saveSettings, el, toast, showNotice, hideNotice, doc(), selection(), writingIssues(), onChange, openGuide }
const s = () => ctx.settings
const TOKEN_KEY = 'mcp:token'
let unlisten = null
let started = false
let lastError = ''
const seenClients = new Set()
// suggestions from AI apps: { client, quote, replacement, message, kind }
let suggestions = []

export function initMcp(c) {
  ctx = c
}

const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
async function token(fresh = false) {
  let t = fresh ? '' : await invoke('secret_get', { key: TOKEN_KEY }).catch(() => '')
  if (!t) {
    t = randomToken()
    await invoke('secret_set', { key: TOKEN_KEY, value: t })
  }
  return t
}

/** Start the server (MCP turned on, AI Writing Help installed). Returns an error message or ''. */
export async function startMcp() {
  if (!unlisten) unlisten = await listen('mcp-call', (e) => answer(e.payload))
  try {
    await invoke('mcp_start', { port: +s().mcpPort, token: await token() })
    started = true
    lastError = ''
  } catch (e) {
    started = false
    lastError = String(e)
  }
  return lastError
}

export async function stopMcp() {
  if (started) await invoke('mcp_stop').catch(() => {})
  started = false
  unlisten?.()
  unlisten = null
  suggestions = []
  seenClients.clear()
  ctx.onChange()
}

async function newToken() {
  await invoke('mcp_stop').catch(() => {})
  await token(true)
  return startMcp()
}

// ════════════════════════════════════════ tools
async function answer({ id, client, tool, args }) {
  let result = null
  let error = null
  try {
    result = await TOOLS[tool](args || {}, client)
  } catch (e) {
    error = e?.message || String(e)
  }
  invoke('mcp_reply', { id, result, error }).catch(() => {})
  if (!seenClients.has(client)) {
    seenClients.add(client)
    ctx.showNotice(`${client} connected over MCP: it can read this document and send suggestions.`, [
      {
        label: 'Disconnect',
        fn: async () => {
          ctx.hideNotice()
          s().mcpEnabled = false
          ctx.saveSettings()
          await stopMcp()
          ctx.toast('MCP server stopped (Preferences → AI turns it on again)', 3000)
        },
      },
      { label: 'OK', fn: () => ctx.hideNotice() },
    ])
  }
}

const TOOLS = {
  get_document() {
    const d = ctx.doc()
    if (d.markdown == null) throw new Error('No document is open in CaretFlow')
    return d
  },
  get_selection() {
    return ctx.selection()
  },
  get_writing_issues() {
    return ctx.writingIssues()
  },
  add_suggestions({ suggestions: list }, client) {
    if (!Array.isArray(list)) throw new Error('suggestions must be a list')
    const text = ctx.plainText()
    let placed = 0
    let skipped = 0
    for (const x of list) {
      if (!x || typeof x.quote !== 'string' || !x.quote || x.quote === (x.replacement ?? '') || !text.includes(x.quote)) {
        skipped++
        continue
      }
      suggestions.push({ client, quote: x.quote, replacement: String(x.replacement ?? ''), message: String(x.message || ''), kind: String(x.kind || 'suggestion').toLowerCase() })
      placed++
    }
    ctx.onChange()
    return { placed, skipped }
  },
  clear_suggestions(_, client) {
    const n = suggestions.length
    suggestions = suggestions.filter((x) => x.client !== client)
    ctx.onChange()
    return { removed: n - suggestions.length }
  },
}

// ════════════════════════════════════════ shown in the editor like AI findings
const FIX = ['spelling', 'grammar', 'punctuation']
const label = (client, kind) => `${client} · ${kind.replace(/^./, (c) => c.toUpperCase())}`

export const mcpSource = {
  id: 'mcp',
  active: () => !!ctx?.installed?.() && suggestions.length > 0,
  issues(blocks) {
    return blocks.map((b) => {
      const out = []
      for (const x of suggestions) {
        const start = b.text.indexOf(x.quote)
        if (start < 0 || (b.masks || []).some(([a, z]) => start < z && start + x.quote.length > a)) continue
        out.push({
          start,
          end: start + x.quote.length,
          cat: FIX.includes(x.kind) ? 'ai-fix' : 'ai-rec',
          kind: label(x.client, x.kind),
          message: x.message,
          sugg: [{ label: x.replacement || `Delete “${x.quote}”`, text: x.replacement }],
          rule: 'mcp:' + x.kind,
          source: 'mcp:' + x.client,
          mcp: x,
        })
      }
      return out
    })
  },
  ignore(iss) {
    suggestions = suggestions.filter((x) => x !== iss.mcp)
  },
  /** The AI tab of the review panel when only MCP is on (no live AI checking). */
  panel() {
    const { el } = ctx
    const apps = [...new Set(suggestions.map((x) => x.client))]
    const clear = el('button', { onclick: () => ((suggestions = []), ctx.onChange()) }, 'Clear all')
    return el(
      'div',
      { class: 'wc-ai-box' },
      el('p', { class: 'wc-ai-note' }, 'Suggestions from ' + (apps.join(', ') || 'your AI app') + ' over MCP. Ask your AI app for more.'),
      el('div', { class: 'wc-actions' }, clear),
      el('div', { class: 'wc-foot' }, el('span', {}, 'MCP'), el('button', { class: 'wc-link', onclick: () => ctx.openGuide() }, 'Setup guide…')),
    )
  },
}

// ════════════════════════════════════════ Preferences → AI → MCP server
export function prefsSection(row) {
  const { el, settings: st } = ctx
  const box = el('div', {})
  const statusLine = el('div', { class: 'ai-test' })
  const showStatus = async () => {
    if (!st.mcpEnabled) {
      statusLine.className = 'ai-test'
      statusLine.textContent = 'Off.'
      return
    }
    if (lastError) {
      statusLine.className = 'ai-test err'
      statusLine.textContent = lastError
      return
    }
    const r = await invoke('mcp_status').catch(() => null)
    statusLine.className = 'ai-test ' + (r?.running ? 'ok' : '')
    statusLine.textContent = r?.running ? `Running at http://127.0.0.1:${r.port}/mcp, on this computer only.` : 'Not running.'
    clients.textContent = r?.clients?.length ? 'Connected: ' + r.clients.map((c) => c.name + (c.version ? ' ' + c.version : '')).join(', ') : 'No app has connected yet.'
  }
  const clients = el('div', { class: 'mcp-clients' })
  const on = el('input', { type: 'checkbox', checked: !!st.mcpEnabled })
  on.onchange = async () => {
    st.mcpEnabled = on.checked
    ctx.saveSettings()
    if (on.checked) await startMcp()
    else await stopMcp()
    await draw()
  }
  const port = el('input', { type: 'number', min: 1024, max: 65535, value: st.mcpPort, style: 'width:110px' })
  port.onchange = async () => {
    st.mcpPort = Math.min(65535, Math.max(1024, +port.value || 38457))
    port.value = st.mcpPort
    ctx.saveSettings()
    if (st.mcpEnabled) await startMcp()
    await draw()
  }
  const snippets = el('div', { class: 'mcp-snippets' })
  const draw = async () => {
    await showStatus()
    snippets.innerHTML = ''
    if (!st.mcpEnabled) return
    const t = await token()
    const url = `http://127.0.0.1:${st.mcpPort}/mcp`
    const exe = await invoke('exe_path').catch(() => 'caretflow')
    const auth = { Authorization: `Bearer ${t}` }
    const json = (o) => JSON.stringify(o, null, 2)
    const setups = [
      ['Claude Desktop', 'Settings → Developer → Edit Config, then restart Claude Desktop', json({ mcpServers: { caretflow: { command: exe, args: ['--mcp'] } } })],
      ['Claude Code', 'Run once in a terminal', `claude mcp add --transport http caretflow ${url} --header "Authorization: Bearer ${t}"`],
      ['Cursor', '~/.cursor/mcp.json', json({ mcpServers: { caretflow: { url, headers: auth } } })],
      ['VS Code', '.vscode/mcp.json, or MCP: Add Server', json({ servers: { caretflow: { type: 'http', url, headers: auth } } })],
      ['Gemini CLI', '~/.gemini/settings.json', json({ mcpServers: { caretflow: { httpUrl: url, headers: auth } } })],
    ]
    for (const [name, where, code] of setups) {
      const copy = el('button', { type: 'button', class: 'fsel', onclick: () => navigator.clipboard.writeText(code).then(() => ctx.toast(`${name} setup copied`)) }, 'Copy')
      snippets.append(el('details', { class: 'mcp-app' }, el('summary', {}, name, el('small', {}, ' · ' + where)), el('pre', { class: 'mcp-snippet' }, code), copy))
    }
  }
  const showToken = el('button', { type: 'button', class: 'fsel', onclick: async () => navigator.clipboard.writeText(await token()).then(() => ctx.toast('Token copied')) }, 'Copy token')
  const regen = el('button', {
    type: 'button',
    class: 'fsel',
    onclick: async () => {
      await newToken()
      await draw()
      ctx.toast('New token: copy the setup into your AI apps again', 3000)
    },
  }, 'New token')
  box.append(
    row('Run the MCP server', 'While CaretFlow is open, on this computer only. Apps need the token below', on),
    row('Port', null, port),
    row('Status', null, el('span', {}, statusLine, clients)),
    row('Token', 'Like a password for your AI apps. A new token disconnects them until you copy the setup again', el('span', {}, showToken, ' ', regen)),
    el('div', { class: 'pref-sub' }, 'Set up your AI app', el('small', {}, 'With your token and the path to CaretFlow filled in. ChatGPT can’t connect to apps on your computer: use an OpenAI API key instead')),
    snippets,
    el('button', { type: 'button', class: 'wc-link', onclick: () => ctx.openGuide() }, 'Step-by-step guide…'),
  )
  draw()
  return box
}
