// Typing test (Ctrl+Alt+T): a minimal, Monkeytype-style speed test. Lazy-loaded.
// Modes: time (15/30/60/120 s), words (10/25/50/100) or text from the open document;
// optional punctuation and numbers. Results: WPM, accuracy, raw speed, consistency,
// character breakdown, a per-second chart and personal bests (kept in localStorage).

const WORDS = `the be of and a to in he have it that for they with as not on she at by this we you do but from or which one would
all will there say who make when can more if no man out other so what time up go about than into could state only new year some take
come these know see use get like then first any work now may such give over think most even find day also after way many must look
before great back through long where much should well people down own just because good each those feel seem how high too place little
world very still nation hand old life tell write become here show house both between need mean call develop under last right move thing
general school never same another begin while number part turn real leave might want point form off child few small since against ask
late home interest large person end open public follow during present without again hold govern around possible head consider word
program problem however lead system set order eye plan run keep face fact group play stand increase early course change help line city
put close case force meet once water upon war build hear light unite live every country bring center let side try provide continue name
certain power pay result question study woman member until far night always service away report something company week church toward
start social room figure nature though young less enough almost read include president nothing yet better big boy cost business value
second why clear expect family complete act sense mind experience art next near direct car law industry important girl god several
matter usual rather per often kind among white reason action return foot care simple within love human along appear doctor believe
speak active student month drive concern best door hope example inform body ever least probable understand reach effect different idea
whole control condition field pass fall note special talk particular today measure walk teach low hour type carry rate remain full
street easy although record sit determine level local sure receive thus moment spirit train college religion perhaps music grow free
cause serve age book board recent sound office cut step class true history position above strong friend necessary add court deal tax
support party whether either land material happen education death agree arm mother across quite anything town past view society manage
answer break organize half fire lose money stop actual already effort wait department able political learn voice air together shall
cover common subject draw short wife treat limit road letter color behind produce send term total university rise century success
minute remember purpose test fight watch situation south ago difference stage father table rest bear entire market prepare explain offer`
  .split(/\s+/)
  .filter(Boolean)

const TIME_OPTS = [15, 30, 60, 120]
const WORD_OPTS = [10, 25, 50, 100]
const PB_KEY = 'folio.typing'

/** @type {{ el, docText: () => string, onKey: (key: string) => void, onClose: () => void }} */
let H = null
let root = null
let cfg = { mode: 'time', time: 30, words: 25, punct: false, nums: false }
let T = null // current test state

export const isOpen = () => !!root && !root.hidden

export function openTypingTest(host) {
  H = host
  try {
    cfg = { ...cfg, ...JSON.parse(localStorage.getItem(PB_KEY + '.cfg') || '{}') }
  } catch {}
  if (!root) build()
  root.hidden = false
  newTest()
}

export function closeTypingTest() {
  if (!root || root.hidden) return
  root.hidden = true
  clearInterval(T?.timer)
  T = null
  H.onClose()
}

// ════════════════════════════════════════ layout
let wordsEl, innerEl, caretEl, liveEl, cfgEl, input, resultEl, hintEl

function build() {
  const { el } = H
  root = el('div', { id: 'tt', hidden: true })
  cfgEl = el('div', { class: 'tt-cfg' })
  liveEl = el('div', { class: 'tt-live' })
  innerEl = el('div', { class: 'tt-inner' })
  caretEl = el('div', { class: 'tt-caret' })
  wordsEl = el('div', { class: 'tt-words' }, innerEl, caretEl)
  input = el('input', { class: 'tt-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Type here' })
  resultEl = el('div', { class: 'tt-result', hidden: true })
  hintEl = el('div', { class: 'tt-hint' }, el('kbd', {}, 'Tab'), ' restart  ·  ', el('kbd', {}, 'Esc'), ' close  ·  ', el('kbd', {}, 'Ctrl+Backspace'), ' delete word')
  const close = el('button', { class: 'tt-close', title: 'Close (Esc)' }, '✕')
  close.onclick = closeTypingTest
  root.append(
    el('div', { class: 'tt-top' }, el('div', { class: 'tt-logo' }, el('b', {}, 'folio'), ' type'), cfgEl, close),
    el('div', { class: 'tt-stage' }, liveEl, wordsEl, resultEl),
    hintEl,
    input,
  )
  document.querySelector('#app').append(root)
  input.addEventListener('keydown', onKey)
  input.addEventListener('blur', () => isOpen() && setTimeout(() => isOpen() && input.focus(), 0))
  wordsEl.addEventListener('mousedown', (e) => (e.preventDefault(), input.focus()))
  addEventListener('resize', () => isOpen() && T && layout())
}

function renderCfg() {
  const { el } = H
  cfgEl.innerHTML = ''
  const opt = (label, active, fn, title) => {
    const b = el('button', { class: active ? 'on' : '', title: title || '' }, label)
    b.onmousedown = (e) => e.preventDefault()
    b.onclick = () => {
      fn()
      try {
        localStorage.setItem(PB_KEY + '.cfg', JSON.stringify(cfg))
      } catch {}
      newTest()
    }
    return b
  }
  const sep = () => el('span', { class: 'tt-sep' })
  const docMode = cfg.mode === 'doc'
  cfgEl.append(
    opt('@ punctuation', cfg.punct, () => (cfg.punct = !cfg.punct), docMode ? 'Not used for document text' : ''),
    opt('# numbers', cfg.nums, () => (cfg.nums = !cfg.nums), docMode ? 'Not used for document text' : ''),
    sep(),
    opt('time', cfg.mode === 'time', () => (cfg.mode = 'time')),
    opt('words', cfg.mode === 'words', () => (cfg.mode = 'words')),
    opt('my document', docMode, () => (cfg.mode = 'doc'), 'Practice with the text of the open document'),
    sep(),
    ...(cfg.mode === 'time' ? TIME_OPTS.map((n) => opt(String(n), cfg.time === n, () => (cfg.time = n))) : WORD_OPTS.map((n) => opt(String(n), cfg.words === n, () => (cfg.words = n)))),
  )
  if (docMode) cfgEl.querySelectorAll('button')[0].classList.add('dim'), cfgEl.querySelectorAll('button')[1].classList.add('dim')
}

// ════════════════════════════════════════ words
const rand = (n) => Math.floor(Math.random() * n)

function genWords(n) {
  const out = []
  let capNext = cfg.punct
  for (let i = 0; i < n; i++) {
    let w = WORDS[rand(WORDS.length)]
    if (out.length && w === out[out.length - 1]) w = WORDS[rand(WORDS.length)]
    if (cfg.nums && Math.random() < 0.12) w = String(rand(10 ** (1 + rand(4))))
    if (cfg.punct) {
      if (capNext) w = w[0].toUpperCase() + w.slice(1)
      capNext = false
      const r = Math.random()
      if (r < 0.08) (w += '.'), (capNext = true)
      else if (r < 0.15) w += ','
      else if (r < 0.17) (w += '?'), (capNext = true)
      else if (r < 0.19) (w += '!'), (capNext = true)
      else if (r < 0.21) w += ';'
      else if (r < 0.23) w = `"${w}"`
      else if (r < 0.25) w = `(${w})`
      else if (r < 0.27) w += ':'
    }
    out.push(w)
  }
  return out
}

function docWords(n) {
  const text = H.docText()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[ \t]*([#>|]+|[-*+]|\d+\.)[ \t]*/gm, ' ')
    .replace(/[*_~|]/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
  const all = text.split(/\s+/).filter((w) => w && /\p{L}/u.test(w) && w.length < 30)
  if (all.length < 5) return null
  // start at a sentence beginning when possible
  const starts = all.map((w, i) => (i === 0 || /[.!?]$/.test(all[i - 1]) ? i : -1)).filter((i) => i >= 0 && i < Math.max(1, all.length - n))
  const s = starts.length ? starts[rand(starts.length)] : 0
  const out = all.slice(s, s + n)
  while (out.length < n && all.length) out.push(...all.slice(0, n - out.length))
  return out
}

// ════════════════════════════════════════ test lifecycle
function newTest(repeatWords) {
  clearInterval(T?.timer)
  renderCfg()
  let words
  let note = ''
  if (repeatWords) words = repeatWords
  else if (cfg.mode === 'doc') {
    words = docWords(cfg.words)
    if (!words) {
      note = 'The open document has too little text — using common words instead.'
      words = genWords(cfg.words)
    }
  } else words = genWords(cfg.mode === 'time' ? 120 : cfg.words)
  T = {
    words,
    typed: [''],
    idx: 0,
    started: 0,
    ended: false,
    timer: null,
    keystrokes: 0,
    correctKeys: 0,
    perSec: [], // { raw chars, errors } per second
    note,
  }
  resultEl.hidden = true
  wordsEl.hidden = false
  liveEl.hidden = false
  hintEl.hidden = false
  innerEl.style.marginTop = '0px'
  renderWords()
  updateLive()
  input.value = ''
  input.focus()
}

function limitLabel() {
  return cfg.mode === 'time' ? `${cfg.time}s` : String(T.words.length)
}

function start() {
  T.started = performance.now()
  T.timer = setInterval(() => {
    sec()
    updateLive()
    if (cfg.mode === 'time' && elapsed() >= cfg.time * 1000) finish()
  }, 1000)
}

const elapsed = () => (T.started ? performance.now() - T.started : 0)

function sec() {
  const i = Math.floor(elapsed() / 1000)
  while (T.perSec.length <= i) T.perSec.push({ raw: 0, errors: 0, correct: 0 })
  return T.perSec[i]
}

// ════════════════════════════════════════ input
function onKey(e) {
  if (!T) return
  const k = e.key
  if (k === 'Escape') {
    e.preventDefault()
    return closeTypingTest()
  }
  if (k === 'Tab') {
    e.preventDefault()
    return newTest()
  }
  if (T.ended) {
    if (k === 'Enter') e.preventDefault(), newTest()
    return
  }
  if (e.ctrlKey && k === 'Backspace') {
    e.preventDefault()
    if (T.typed[T.idx]) T.typed[T.idx] = ''
    else if (T.idx > 0 && T.typed[T.idx - 1] !== T.words[T.idx - 1]) T.typed[--T.idx] = ''
    return afterInput()
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return
  if (k === 'Backspace') {
    e.preventDefault()
    if (T.typed[T.idx]) T.typed[T.idx] = T.typed[T.idx].slice(0, -1)
    else if (T.idx > 0 && T.typed[T.idx - 1] !== T.words[T.idx - 1]) T.idx-- // only back into a wrong word
    H.onKey('Backspace')
    return afterInput()
  }
  if (k.length !== 1) return
  e.preventDefault()
  if (!T.started) start()
  H.onKey(k)
  const s = sec()
  const word = T.words[T.idx]
  if (k === ' ') {
    if (!T.typed[T.idx]) return // no empty words
    T.keystrokes++
    s.raw++
    if (T.typed[T.idx] === word) T.correctKeys++, s.correct++
    else s.errors++
    if (T.idx === T.words.length - 1) return finish()
    T.idx++
    T.typed[T.idx] = ''
    if (cfg.mode === 'time' && T.words.length - T.idx < 40) T.words.push(...genWords(60)), renderWords()
    return afterInput()
  }
  const pos = T.typed[T.idx].length
  T.typed[T.idx] += k
  T.keystrokes++
  s.raw++
  if (word[pos] === k) T.correctKeys++, s.correct++
  else s.errors++
  // words mode ends as soon as the last word is typed correctly
  if (T.idx === T.words.length - 1 && T.typed[T.idx] === word) return finish()
  afterInput()
}

function afterInput() {
  renderWord(T.idx)
  if (T.idx > 0) renderWord(T.idx - 1)
  if (T.idx < T.words.length - 1) renderWord(T.idx + 1)
  layout()
  updateLive()
}

// ════════════════════════════════════════ rendering
function renderWords() {
  innerEl.innerHTML = ''
  T.words.forEach((_, i) => innerEl.append(H.el('div', { class: 'tt-word' })))
  T.words.forEach((_, i) => renderWord(i))
  requestAnimationFrame(layout)
}

function renderWord(i) {
  const w = T.words[i]
  const node = innerEl.children[i]
  if (!node) return
  const typed = T.typed[i] ?? ''
  const done = i < T.idx
  node.className = 'tt-word' + (done && typed !== w ? ' wrong' : '') + (i === T.idx ? ' active' : '')
  let html = ''
  for (let j = 0; j < Math.max(w.length, typed.length); j++) {
    const c = j < w.length ? w[j] : typed[j]
    const cls = j >= typed.length ? (done ? 'missed' : '') : j >= w.length ? 'extra' : typed[j] === w[j] ? 'ok' : 'bad'
    html += `<span class="${cls}">${c.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[x])}</span>`
  }
  node.innerHTML = html
}

function layout() {
  if (!T || T.ended) return
  const node = innerEl.children[T.idx]
  if (!node) return
  // offsets are relative to .tt-words and already include the scroll (inner margin)
  const lh = node.offsetHeight + parseFloat(getComputedStyle(node).marginBottom || 0)
  const line = Math.round(node.offsetTop / lh)
  if (line >= 2) innerEl.style.marginTop = parseFloat(innerEl.style.marginTop || 0) - lh * (line - 1) + 'px' // keep the active word on line 2
  const typedLen = (T.typed[T.idx] || '').length
  const letters = node.children
  const ref = letters[Math.min(typedLen, letters.length - 1)]
  if (!ref) return
  const x = typedLen < letters.length ? ref.offsetLeft : ref.offsetLeft + ref.offsetWidth
  caretEl.style.transform = `translate(${x}px, ${ref.offsetTop}px)`
  caretEl.style.height = ref.offsetHeight + 'px'
  caretEl.classList.toggle('blink', !T.started)
}

function updateLive() {
  if (!T) return
  if (!T.started) {
    liveEl.innerHTML = ''
    liveEl.append(H.el('span', { class: 'tt-big' }, cfg.mode === 'time' ? String(cfg.time) : `0/${T.words.length}`), H.el('span', { class: 'tt-sub' }, T.note || bestLine()))
    return
  }
  const t = elapsed()
  const left = cfg.mode === 'time' ? Math.max(0, Math.ceil(cfg.time - t / 1000)) : null
  const wpm = Math.round(stats(false).wpm)
  liveEl.innerHTML = ''
  liveEl.append(H.el('span', { class: 'tt-big' }, left != null ? String(left) : `${T.idx}/${T.words.length}`), H.el('span', { class: 'tt-sub' }, `${wpm} wpm`))
}

// ════════════════════════════════════════ results
function stats(final) {
  const minutes = Math.max(elapsed(), 1000) / 60000
  let correct = 0
  let incorrect = 0
  let extra = 0
  let missed = 0
  let wordChars = 0
  const last = final ? T.idx : T.idx - 1
  for (let i = 0; i <= Math.min(T.idx, T.words.length - 1); i++) {
    const w = T.words[i]
    const t = T.typed[i] ?? ''
    for (let j = 0; j < Math.max(w.length, t.length); j++) {
      if (j >= t.length) {
        if (i < T.idx) missed++
      } else if (j >= w.length) extra++
      else if (t[j] === w[j]) correct++
      else incorrect++
    }
    // WPM counts fully correct words plus the spaces after them
    if (t === w && i <= last) wordChars += w.length + (i < T.idx ? 1 : 0)
    else if (i === T.idx && !final && w.startsWith(t)) wordChars += t.length
  }
  const raw = T.keystrokes / 5 / minutes
  return {
    wpm: wordChars / 5 / minutes,
    raw,
    acc: T.keystrokes ? (T.correctKeys / T.keystrokes) * 100 : 100,
    correct,
    incorrect,
    extra,
    missed,
    time: elapsed() / 1000,
  }
}

function finish() {
  T.ended = true
  clearInterval(T.timer)
  sec()
  const s = stats(true)
  // consistency: how even the per-second raw speed was
  const secs = T.perSec.slice(0, Math.max(1, Math.ceil(s.time))).map((x) => x.raw * 12)
  const mean = secs.reduce((a, b) => a + b, 0) / secs.length
  const sd = Math.sqrt(secs.reduce((a, b) => a + (b - mean) ** 2, 0) / secs.length)
  const consistency = mean ? Math.max(0, Math.min(100, 100 * (1 - sd / mean))) : 0
  const key = pbKey()
  const pbs = readPbs()
  const prev = pbs[key]
  const isPb = s.wpm > 0 && s.acc >= 50 && (!prev || s.wpm > prev.wpm)
  if (isPb) {
    pbs[key] = { wpm: Math.round(s.wpm * 10) / 10, acc: Math.round(s.acc), raw: Math.round(s.raw), date: new Date().toISOString().slice(0, 10) }
    try {
      localStorage.setItem(PB_KEY, JSON.stringify(pbs))
    } catch {}
  }
  showResult(s, consistency, isPb, prev)
}

const pbKey = () => [cfg.mode, cfg.mode === 'time' ? cfg.time : cfg.words, cfg.mode !== 'doc' && cfg.punct ? 'p' : '', cfg.mode !== 'doc' && cfg.nums ? 'n' : ''].join('-')
function readPbs() {
  try {
    return JSON.parse(localStorage.getItem(PB_KEY) || '{}')
  } catch {
    return {}
  }
}
function bestLine() {
  const pb = readPbs()[pbKey()]
  return pb ? `best ${Math.round(pb.wpm)} wpm · ${pb.acc}%` : 'start typing'
}

function showResult(s, consistency, isPb, prev) {
  const { el } = H
  wordsEl.hidden = true
  liveEl.hidden = true
  resultEl.hidden = false
  resultEl.innerHTML = ''
  const big = (label, value, sub) => el('div', { class: 'tt-stat big' }, el('label', {}, label), el('b', {}, value), sub ? el('small', {}, sub) : null)
  const small = (label, value, title) => el('div', { class: 'tt-stat', title: title || '' }, el('label', {}, label), el('b', {}, value))
  const typeLabel = cfg.mode === 'doc' ? `my document, ${T.words.length} words` : `${cfg.mode} ${limitLabel()}${cfg.punct ? ', punctuation' : ''}${cfg.nums ? ', numbers' : ''}`
  const again = el('button', { class: 'primary' }, 'Next test')
  again.onclick = () => newTest()
  const repeat = el('button', {}, 'Repeat these words')
  const words = T.words.slice(0, T.idx + 1)
  repeat.onclick = () => newTest(words)
  const closeB = el('button', {}, 'Back to writing')
  closeB.onclick = closeTypingTest
  resultEl.append(
    el(
      'div',
      { class: 'tt-res-top' },
      el('div', { class: 'tt-res-main' }, big('wpm', String(Math.round(s.wpm)), isPb ? (prev ? `new best (was ${Math.round(prev.wpm)})` : 'first result') : prev ? `best ${Math.round(prev.wpm)}` : ''), big('acc', Math.round(s.acc) + '%')),
      chart(),
    ),
    el(
      'div',
      { class: 'tt-res-row' },
      small('test type', typeLabel),
      small('raw', String(Math.round(s.raw)), 'Speed counting every keystroke, errors included'),
      small('characters', `${s.correct}/${s.incorrect}/${s.extra}/${s.missed}`, 'correct / incorrect / extra / missed'),
      small('consistency', Math.round(consistency) + '%', 'How steady your speed was from second to second'),
      small('time', Math.round(s.time) + 's'),
    ),
    el('div', { class: 'tt-res-btns' }, again, repeat, closeB),
  )
  if (isPb) resultEl.querySelector('.tt-stat.big small')?.classList.add('pb')
  again.focus({ preventScroll: true })
  input.focus()
}

function chart() {
  const W = 560
  const Hh = 150
  const pad = { l: 34, r: 10, t: 10, b: 22 }
  const secs = T.perSec.slice(0, Math.max(1, Math.ceil(elapsed() / 1000)))
  // cumulative wpm per second + raw per second
  let cum = 0
  const wpm = secs.map((x, i) => ((cum += x.correct), cum / 5 / ((i + 1) / 60)))
  const raw = secs.map((x) => x.raw * 12)
  const max = Math.ceil((Math.max(40, ...wpm, ...raw) * 1.1) / 20) * 20
  const X = (i) => pad.l + (secs.length > 1 ? (i / (secs.length - 1)) * (W - pad.l - pad.r) : (W - pad.l - pad.r) / 2)
  const Y = (v) => pad.t + (1 - v / max) * (Hh - pad.t - pad.b)
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f))
  let svg = `<svg class="tt-chart" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">`
  for (const t of ticks) svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${pad.l - 6}" y="${Y(t) + 4}" class="axis" text-anchor="end">${t}</text>`
  svg += `<path d="${path(raw)}" class="raw"/><path d="${path(wpm)}" class="wpm"/>`
  secs.forEach((x, i) => x.errors && (svg += `<text x="${X(i)}" y="${Y(raw[i]) - 6}" class="err" text-anchor="middle">×</text>`))
  svg += `<text x="${W - pad.r}" y="${Hh - 6}" class="axis" text-anchor="end">seconds</text></svg>`
  const wrap = document.createElement('div')
  wrap.className = 'tt-chart-wrap'
  wrap.innerHTML = svg + '<div class="tt-legend"><span class="wpm">wpm</span><span class="raw">raw</span><span class="err">× errors</span></div>'
  return wrap
}
