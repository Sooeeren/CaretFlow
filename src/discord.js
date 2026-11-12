// Discord Status (an extension): shows on your Discord profile that you are writing in CaretFlow,
// with the logo, what you are doing, the word count and how long you have been at it.
// Only talks to the Discord app on this computer (src-tauri/src/discord.rs); off until installed,
// and the file name stays private unless the user turns it on.
import { invoke } from '@tauri-apps/api/core'
import localLogo from '../src-tauri/icons/128x128.png' // the preview stays offline

// The Discord application "CaretFlow" (discord.com/developers): its name is the "Playing …" line
const APP_ID = '1570493606807207966'
const LOGO = 'https://raw.githubusercontent.com/Sooeeren/CaretFlow/main/src-tauri/icons/128x128@2x.png'
const SITE = 'https://caretflow.vercel.app/'
const TICK = 15000 // Discord accepts about one update per 15 seconds
const WRITING = 2 * 60000 // words changed this recently: "Writing", else "Reading"
const IDLE = 15 * 60000 // nothing typed and the window in the background this long: "Idle"

/** @type {{ settings, version: string, doc: () => { name: string|null, words: number, mode: string } }} */
let H = null
let timer = null
let last = '' // the activity Discord shows now, as JSON
let status = 'Not connected'
let docKey = null // the document the elapsed time belongs to
let since = 0
let words = -1
let mode = ''
let typedAt = 0
let seenAt = Date.now()
const listeners = new Set()

export const appId = () => (H?.settings.discordAppId || APP_ID).trim()
export const statusText = () => status
export function onStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function setStatus(s) {
  if (s === status) return
  status = s
  for (const fn of listeners) fn(s)
}

export function startDiscord(host) {
  H = host
  if (timer) return refresh()
  timer = setInterval(tick, TICK)
  window.addEventListener('focus', onFocus)
  tick()
}

export function stopDiscord() {
  if (!timer) return
  clearInterval(timer)
  timer = null
  window.removeEventListener('focus', onFocus)
  last = ''
  invoke('discord_clear').catch(() => {})
  setStatus('Off')
}

/** Settings or the document changed: update now instead of at the next tick. */
export function refresh() {
  if (timer) tick()
}

function onFocus() {
  seenAt = Date.now()
}

const clip = (s) => (s.length > 128 ? s.slice(0, 127) + '…' : s.padEnd(2, ' ')) // Discord wants 2–128 characters

function activity() {
  const s = H.settings
  const d = H.doc()
  const now = Date.now()
  const key = d.name || ''
  if (key !== docKey) {
    docKey = key
    since = now
    words = d.words
  }
  // source mode counts Markdown syntax too: switching modes is not typing
  if (d.mode !== mode) {
    mode = d.mode
    words = d.words
  }
  if (d.words !== words) {
    words = d.words
    typedAt = now
  }
  if (document.hasFocus()) seenAt = now
  const verb = now - typedAt < WRITING ? 'Writing' : now - Math.max(typedAt, seenAt) > IDLE ? 'Idle' : 'Reading'
  const what = s.discordFileName && d.name ? d.name : 'a Markdown document'
  const details = verb === 'Idle' ? 'Idle' : `${verb} ${what}`
  const parts = []
  if (s.discordWords) parts.push(`${d.words.toLocaleString('en')} word${d.words === 1 ? '' : 's'}`)
  if (s.discordMode && d.mode) parts.push(d.mode)
  const a = {
    details: clip(details),
    assets: { large_image: LOGO, large_text: `CaretFlow ${H.version}` },
  }
  if (parts.length) a.state = clip(parts.join(' · '))
  if (s.discordElapsed) a.timestamps = { start: Math.floor(since / 1000) }
  if (s.discordButton) a.buttons = [{ label: 'Get CaretFlow', url: SITE }]
  return a
}

async function tick() {
  const id = appId()
  if (!id) return setStatus('No Discord application ID set')
  const a = activity()
  const json = JSON.stringify(a)
  if (json === last) return
  last = json // set before the await: a refresh meanwhile must not send it again
  try {
    await invoke('discord_set', { clientId: id, activity: a })
    setStatus('Showing on Discord')
  } catch (e) {
    last = '' // try again at the next tick: Discord may start later
    setStatus(String(e))
  }
}

const clock = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600)
  const mm = String(Math.floor(t / 60) % 60).padStart(h ? 2 : 1, '0')
  return `${h ? h + ':' : ''}${mm}:${String(t % 60).padStart(2, '0')} elapsed`
}

/** Preferences → Discord: roughly what others see on your profile, kept up to date while it is open. */
export function previewCard(el, host) {
  H ||= host
  const card = el('div', { class: 'dc-card' })
  const draw = () => {
    const a = activity()
    card.replaceChildren(
      el('div', { class: 'dc-head' }, 'Playing'),
      el(
        'div',
        { class: 'dc-body' },
        el('img', { src: localLogo, alt: '', class: 'dc-logo' }),
        el(
          'div',
          { class: 'dc-text' },
          el('b', {}, 'CaretFlow'),
          el('span', {}, a.details.trim()),
          a.state ? el('span', {}, a.state.trim()) : null,
          a.timestamps ? el('span', {}, clock(Date.now() - a.timestamps.start * 1000)) : null,
        ),
      ),
      a.buttons ? el('div', { class: 'dc-btn' }, a.buttons[0].label) : null,
    )
  }
  draw()
  const t = setInterval(() => (card.isConnected ? draw() : clearInterval(t)), 1000)
  return card
}
