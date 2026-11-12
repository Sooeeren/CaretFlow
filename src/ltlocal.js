// Advanced Grammar (an extension, desktop only, lazy): LanguageTool running on this computer.
// The Rust side (src-tauri/src/langtool.rs) downloads LanguageTool and a Java runtime and runs the
// server; this module starts it when the spelling checker asks for it, stops it after a while
// without checking, and draws Preferences → Advanced Grammar. Until the server answers (a few
// seconds), writing.js keeps checking with Harper.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** @type {{ settings, saveSettings, el, toast, changed: () => void, customSelect }} */
let H = null
let port = null
let starting = null
let failedAt = 0
let error = ''
let installed = null // unknown until the first status
let lastUse = 0
let idleTimer = null
const listeners = new Set()
const notify = () => listeners.forEach((f) => f())

/** Languages with n-gram data, and the download sizes. */
export const NGRAMS = [
  ['en', 'English', '9 GB'],
  ['de', 'German', '1.7 GB'],
  ['fr', 'French', '1.8 GB'],
  ['es', 'Spanish', '1.7 GB'],
  ['nl', 'Dutch', '1.2 GB'],
]

export function initLtLocal(host) {
  H = host
  idleTimer ||= setInterval(idleCheck, 60_000)
}

/** The server's address, or null while it isn't running (and then it starts in the background). */
export function url() {
  lastUse = Date.now()
  if (port) return `http://127.0.0.1:${port}`
  start()
  return null
}

export const statusText = () =>
  port ? `Running on this computer (port ${port})` : starting ? 'Starting…' : error ? `Could not start: ${error}` : installed === false ? 'Not downloaded yet' : 'Ready (starts when needed)'

export function onStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function start() {
  // after a failure, wait a minute before trying again: checks run on every pause in typing
  if (starting || installed === false || Date.now() - failedAt < 60_000) return starting
  const s = H.settings
  starting = invoke('lt_status')
    .then((st) => {
      installed = st.installed
      if (!st.installed) throw new Error('not downloaded')
      notify()
      return invoke('lt_start', { memoryMb: s.ltLocalMemory || 1024, ngrams: s.ltLocalNgrams !== false })
    })
    .then((p) => {
      port = p
      error = ''
      H.changed()
    })
    .catch((e) => {
      if (installed !== false) {
        error = String(e?.message || e)
        failedAt = Date.now()
      }
    })
    .finally(() => {
      starting = null
      notify()
    })
  notify()
  return starting
}

export async function stop() {
  port = null
  await invoke('lt_stop').catch(() => {})
  notify()
  H?.changed()
}

function idleCheck() {
  const mins = H.settings.ltLocalIdleStop === false ? 0 : 15
  if (port && mins && Date.now() - lastUse > mins * 60_000) stop()
}

// ════════════════════════════════════════ Preferences → Advanced Grammar
const fmt = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB')

export function prefsPage(row, chk) {
  const { el, settings } = H
  const state = el('p', { class: 'about-note lt-state' }, 'Checking…')
  const bar = el('div', { class: 'lt-progress', hidden: true }, el('div', {}))
  const actions = el('div', { class: 'lt-actions' })
  const ngrams = el('div', { class: 'wc-langs' })
  let st = null
  let progress = null

  const button = (label, fn, primary = false) => {
    const b = el('button', { class: primary ? 'fsel pref-btn lt-primary' : 'fsel pref-btn' }, label)
    b.onclick = async () => {
      b.disabled = true
      try {
        await fn()
      } catch (e) {
        if (!/cancelled/.test(String(e))) H.toast(String(e?.message || e), 4000)
      }
      draw()
    }
    return b
  }

  async function draw() {
    if (!state.isConnected && st) return
    st = await invoke('lt_status').catch(() => null)
    if (!st) return (state.textContent = 'Not available')
    installed = st.installed
    const using = settings.wcEngine === 'languagetool' && settings.ltServer === 'local'
    state.textContent = st.busy
      ? progress && progress.total
        ? `${progress.what}: ${fmt(progress.done)} of ${fmt(progress.total)}`
        : progress?.what || `Downloading ${st.busy}…`
      : st.installed
        ? `${statusText()} · ${fmt(st.bytes)} on disk${using ? '' : ' · not used for checking yet'}`
        : 'Not downloaded. LanguageTool and a Java runtime need about 300 MB.'
    bar.hidden = !st.busy
    bar.firstChild.style.width = progress?.total ? (progress.done / progress.total) * 100 + '%' : '100%'
    bar.classList.toggle('indeterminate', !progress?.total)
    actions.replaceChildren(
      ...(st.busy
        ? [button('Cancel', () => invoke('lt_cancel'))]
        : st.installed
          ? [
              using
                ? null
                : button(
                    'Use for Checking',
                    () => {
                      settings.wcEngine = 'languagetool'
                      settings.ltServer = 'local'
                      H.saveSettings()
                      H.changed()
                    },
                    true,
                  ),
              port ? button('Stop', stop) : button('Start Now', () => ((failedAt = 0), (error = ''), start())),
              button(`Remove (${fmt(st.bytes)})`, async () => {
                if (!confirm('Remove LanguageTool, the Java runtime and all n-gram data from this computer?')) return
                await stop()
                await invoke('lt_remove', { what: 'all' })
                if (settings.ltServer === 'local') {
                  settings.ltServer = 'https://api.languagetool.org'
                  settings.wcEngine = 'harper'
                  H.saveSettings()
                  H.changed()
                }
              }),
            ].filter(Boolean)
          : [button('Download (about 300 MB)', () => invoke('lt_install').then(() => H.toast('LanguageTool is ready')), true)]),
    )
    ngrams.replaceChildren(
      ...NGRAMS.map(([id, name, size]) => {
        const have = st.ngrams.includes(id)
        const b = have
          ? button('Remove', async () => {
              await stop()
              await invoke('lt_remove', { what: 'ngrams:' + id })
            })
          : button(`Download · ${size}`, async () => {
              await invoke('lt_ngrams', { lang: id })
              await stop() // the server reads n-grams when it starts
              H.toast(`${name} n-gram data is ready`)
            })
        b.disabled = !!st.busy || !st.installed
        return el('div', { class: 'wc-lang' + (have ? ' on' : '') }, el('span', {}, name, have ? el('small', {}, ' · installed') : null), b)
      }),
    )
  }

  listen('lt-progress', (e) => {
    progress = e.payload
    draw()
  }).then((un) => {
    // stop listening once Preferences closed
    const t = setInterval(() => !state.isConnected && (un(), clearInterval(t)), 2000)
  })
  const off = onStatus(() => (state.isConnected ? draw() : off()))

  const memory = H.customSelect(
    [
      [512, '512 MB'],
      [1024, '1 GB'],
      [2048, '2 GB'],
      [4096, '4 GB'],
    ],
    settings.ltLocalMemory || 1024,
    (v) => {
      settings.ltLocalMemory = +v
      H.saveSettings()
      if (port) stop()
    },
  )
  const useNgrams = chk('ltLocalNgrams')
  useNgrams.addEventListener('change', () => port && stop())
  draw()
  return el(
    'div',
    { class: 'lt-prefs' },
    el(
      'p',
      { class: 'about-note' },
      'LanguageTool’s full grammar and style checking for 30+ languages, running on this computer: no request limits, and your text never leaves it. CaretFlow downloads it once from languagetool.org (and Java from adoptium.net), starts it when you write and stops it when you don’t. Harper checks while it starts.',
    ),
    state,
    bar,
    actions,
    row('Memory', 'More helps with long documents and n-gram data', memory),
    row('Stop after 15 minutes without checking', 'Frees the memory; it starts again in a few seconds when you type', chk('ltLocalIdleStop')),
    row('Use n-gram data', 'Statistics from large amounts of text that catch confused words (their/there, then/than, seit/seid)', useNgrams),
    el('div', { class: 'pref-sub' }, 'N-gram data', el('small', {}, 'Optional, per language. Large, but read from disk rather than memory')),
    ngrams,
  )
}
