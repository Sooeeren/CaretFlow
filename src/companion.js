// Typing companions, both optional and off by default:
//  - WPM meter in the status bar (rolling 10-second speed, session average and best in the tooltip)
//  - a little cat in the corner that taps along while you type (paw by keyboard side)

/** @type {{ settings, el, isTypingKey: (e: KeyboardEvent) => boolean }} */
let H = null
let wpmEl = null
let cat = null

export function initCompanion(host) {
  H = host
  wpmEl = document.querySelector('#st-wpm')
  window.addEventListener('keydown', onKey, true)
  setInterval(tick, 500)
  companionSettingsChanged()
}

export function companionSettingsChanged() {
  if (!H) return
  wpmEl.hidden = !H.settings.wpm
  if (H.settings.bongo && !cat) cat = makeCat()
  if (cat) cat.hidden = !H.settings.bongo
  tick()
}

// ════════════════════════════════════════ speed
const WINDOW = 10000 // ms of typing the live speed is based on
const IDLE = 3000 // a pause this long ends a burst
const keys = [] // timestamps of recent keystrokes
let burstStart = 0
let last = 0
let lastWpm = 0
const session = { chars: 0, active: 0, best: 0 }

/** Count a keystroke for the meter and the cat (also used by the typing test). */
export function companionKey(key) {
  const now = performance.now()
  if (now - last > IDLE) burstStart = now
  else session.active += now - last
  last = now
  keys.push(now)
  session.chars++
  paw(key)
  if (H?.settings.wpm) tick()
}

function onKey(e) {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return
  if (!(e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) return
  if (!H.isTypingKey(e)) return
  companionKey(e.key)
}

function liveWpm(now) {
  while (keys.length && now - keys[0] > WINDOW) keys.shift()
  if (!keys.length || now - last > IDLE) return null
  const span = Math.max(3000, Math.min(WINDOW, now - burstStart))
  return keys.length / 5 / (span / 60000)
}

function tick() {
  if (!H?.settings.wpm || !wpmEl) return
  const now = performance.now()
  const w = liveWpm(now)
  if (w != null) {
    lastWpm = Math.round(w)
    if (now - burstStart > 5000) session.best = Math.max(session.best, lastWpm)
  }
  wpmEl.textContent = lastWpm ? `${lastWpm} WPM` : '– WPM'
  wpmEl.classList.toggle('idle', w == null)
  const avg = session.active > 5000 ? Math.round(session.chars / 5 / (session.active / 60000)) : 0
  wpmEl.title =
    'Typing speed over the last 10 seconds (5 characters = 1 word)' +
    (avg ? `\nThis session: ${avg} WPM average, ${session.best} WPM best, ${Math.round(session.chars / 5).toLocaleString()} words typed` : '') +
    '\nTyping test: Ctrl+Alt+T'
}

// ════════════════════════════════════════ cat
const LEFT_KEYS = new Set('`1234560qwertasdfgzxcvb~!@#$%^QWERTASDFGZXCVB\t'.split(''))
let pawSide = 'l'
let pawT = null
let idleT = null

function paw(key) {
  if (!cat || cat.hidden) return
  const side = key === ' ' || key === 'Enter' ? 'both' : LEFT_KEYS.has(key) ? 'l' : 'r'
  // the same key twice in a row alternates, so fast typing still looks like drumming
  pawSide = side === 'both' ? 'both' : side === pawSide && side !== 'both' ? (side === 'l' ? 'r' : 'l') : side
  cat.classList.remove('l', 'r', 'both')
  void cat.offsetWidth
  cat.classList.add(pawSide, 'typing')
  clearTimeout(pawT)
  clearTimeout(idleT)
  pawT = setTimeout(() => cat.classList.remove('l', 'r', 'both'), 110)
  idleT = setTimeout(() => cat.classList.remove('typing'), 1400)
}

function makeCat() {
  const wrap = document.createElement('div')
  wrap.id = 'bongo'
  wrap.setAttribute('aria-hidden', 'true')
  wrap.title = ''
  wrap.innerHTML = CAT_SVG
  document.querySelector('#content').append(wrap)
  return wrap
}

// An original drawing: round cat behind a desk with a tiny keyboard; each paw has an "up" and a "down" pose.
const CAT_SVG = `
<svg viewBox="0 0 160 104" width="140" height="91">
  <g class="cat-body">
    <path class="ear" d="M42 52 L46 14 L72 34 Z"/>
    <path class="ear" d="M118 52 L114 14 L88 34 Z"/>
    <path class="ear-in" d="M48 40 L50 24 L62 34 Z"/>
    <path class="ear-in" d="M112 40 L110 24 L98 34 Z"/>
    <path class="fur" d="M26 96 C24 52 46 28 80 28 C114 28 136 52 134 96 Z"/>
    <ellipse class="blush" cx="58" cy="66" rx="7" ry="4"/>
    <ellipse class="blush" cx="102" cy="66" rx="7" ry="4"/>
    <g class="eyes-open"><circle cx="66" cy="58" r="3.4"/><circle cx="94" cy="58" r="3.4"/></g>
    <g class="eyes-happy"><path d="M61 59 q5 -6 10 0"/><path d="M89 59 q5 -6 10 0"/></g>
    <path class="mouth" d="M73 66 q3.5 4 7 0 q3.5 4 7 0"/>
  </g>
  <rect class="desk" x="4" y="93" width="152" height="10" rx="3"/>
  <rect class="kbd" x="44" y="86" width="72" height="8" rx="2"/>
  <g class="kbd-keys"><rect x="49" y="88" width="8" height="3" rx="1"/><rect x="60" y="88" width="8" height="3" rx="1"/><rect x="71" y="88" width="18" height="3" rx="1"/><rect x="92" y="88" width="8" height="3" rx="1"/><rect x="103" y="88" width="8" height="3" rx="1"/></g>
  <g class="paw paw-l up"><ellipse cx="40" cy="70" rx="10" ry="8"/></g>
  <g class="paw paw-r up"><ellipse cx="120" cy="70" rx="10" ry="8"/></g>
  <g class="paw paw-l down"><ellipse cx="60" cy="86" rx="12" ry="6"/><path class="hit" d="M46 78 l-6 -4 M50 74 l-3 -6"/></g>
  <g class="paw paw-r down"><ellipse cx="100" cy="86" rx="12" ry="6"/><path class="hit" d="M114 78 l6 -4 M110 74 l3 -6"/></g>
</svg>`
