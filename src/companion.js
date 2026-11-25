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
  applyCustomCat(H.settings.customCat)
  if (cat) {
    cat.hidden = !H.settings.bongo
    cat.dataset.style = catStyle(H.settings.catStyle)
    markings(cat)
  }
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
  wrap.innerHTML = catSvg(140)
  document.querySelector('#content').append(wrap)
  return wrap
}

/** The looks the cat comes in (Preferences → Typing, View → Cat Style). Colors in style.css. */
export const CAT_STYLES = [
  ['classic', 'Classic'],
  ['midnight', 'Midnight'],
  ['ginger', 'Ginger Tabby'],
  ['blue', 'Russian Blue'],
  ['calico', 'Calico'],
  ['siamese', 'Siamese'],
  ['tuxedo', 'Tuxedo'],
  ['cookie', 'Cookie'],
  ['custom', 'Your Own'],
]
const catStyle = (s) => (CAT_STYLES.some(([id]) => id === s) ? s : 'classic')

/** A small still cat of one style, for the picker. */
export function catPreview(style, width = 64) {
  const span = document.createElement('span')
  span.className = 'cat-preview'
  span.dataset.style = catStyle(style)
  span.innerHTML = catSvg(width)
  markings(span)
  return span
}

// ── your own cat (Tools → Cat Style → Make Your Own Cat…, catmaker.js)
// Its colors are one CSS rule, like the built-in styles; which markings it has is data-marks on
// the drawing (the editor's preview sets both inline).
export const CAT_COLORS = [
  ['fur', 'Fur', '--cat-fur'],
  ['line', 'Outline', '--cat-line'],
  ['ear', 'Ears', '--cat-ear'],
  ['earIn', 'Inside the ears', '--cat-ear-in'],
  ['eye', 'Eyes', '--cat-eye'],
  ['mouth', 'Mouth', '--cat-mouth'],
  ['paw', 'Paws', '--cat-paw'],
  ['mark', 'Stripes, mask, first patch', '--cat-mark'],
  ['mark2', 'Bib, second patch', '--cat-mark-2'],
]
export const CAT_MARKS = [
  ['stripes', 'Stripes'],
  ['patches', 'Patches'],
  ['mask', 'Mask'],
  ['bib', 'Bib'],
]
let customCat = null

/** CSS declarations for a custom cat (also the editor's live preview). */
export function customCatVars(c) {
  return CAT_COLORS.filter(([k]) => /^#[0-9a-f]{6}$/i.test(c?.[k] || '')).map(([k, , v]) => `${v}: ${c[k]};`).join(' ') + ` --cat-blush: ${c?.blush === false ? 0 : 0.5};`
}

function applyCustomCat(c) {
  customCat = c || null
  let st = document.getElementById('cf-custom-cat')
  if (!st) {
    st = document.createElement('style')
    st.id = 'cf-custom-cat'
    document.head.append(st)
  }
  st.textContent = customCat ? `:is(#bongo, .cat-preview)[data-style='custom'] { ${customCatVars(customCat)} }` : ''
  document.querySelectorAll(".cat-preview[data-style='custom']").forEach(markings)
}

/** The markings a custom cat has (built-in styles get theirs from style.css). */
function markings(node) {
  if (node.classList.contains('draft')) return // the editor's preview shows the unsaved cat
  if (node.dataset.style === 'custom') node.dataset.marks = (customCat?.marks || []).join(' ')
  else delete node.dataset.marks
}

// An original drawing: round cat behind a desk with a tiny keyboard; each paw has an "up" and a
// "down" pose. The markings (stripes, patches, a mask, a white bib) are clipped to the head, and
// style.css shows the ones a style has.
let svgN = 0
function catSvg(width) {
  const clip = `cf-cat-clip-${++svgN}`
  const head = 'M26 96 C24 52 46 28 80 28 C114 28 136 52 134 96 Z'
  return CAT_SVG.replace('{W}', width)
    .replace('{H}', Math.round((width * 104) / 160))
    .replaceAll('{CLIP}', clip)
    .replaceAll('{HEAD}', head)
}

const CAT_SVG = `
<svg viewBox="0 0 160 104" width="{W}" height="{H}">
  <defs><clipPath id="{CLIP}"><path d="{HEAD}"/></clipPath></defs>
  <g class="cat-body">
    <path class="ear" d="M42 52 L46 14 L72 34 Z"/>
    <path class="ear" d="M118 52 L114 14 L88 34 Z"/>
    <path class="ear-in" d="M48 40 L50 24 L62 34 Z"/>
    <path class="ear-in" d="M112 40 L110 24 L98 34 Z"/>
    <path class="fur" d="{HEAD}"/>
    <g class="marks" clip-path="url(#{CLIP})">
      <path class="m-patch m-patch-1" d="M92 22 C122 22 142 46 140 72 C124 68 108 56 98 46 C94 40 90 30 92 22 Z"/>
      <path class="m-patch m-patch-2" d="M20 78 C28 68 44 70 48 84 C48 94 34 100 20 98 Z"/>
      <ellipse class="m-mask" cx="80" cy="64" rx="24" ry="17"/>
      <path class="m-bib" d="M80 59 C70 59 63 66 63 75 C63 86 60 96 60 96 L100 96 C100 96 97 86 97 75 C97 66 90 59 80 59 Z"/>
      <g class="m-stripes"><path d="M80 29 V41 M71 31 L74 41 M89 31 L86 41"/><path d="M24 66 L38 69 M24 76 L37 76 M136 66 L122 69 M136 76 L123 76"/></g>
    </g>
    <path class="fur-line" d="{HEAD}"/>
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
