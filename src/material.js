// Material You style (View → Theme → Material You Style, off by default): a Material 3 color scheme
// made from one seed color, laid over the current theme (which still decides light or dark and
// the document font). The tonal palettes are built in OKLCH, which keeps them close to Material's
// HCT tones without its full color science. Shapes live in style.css under body.material.

/** Material's baseline purple, and the swatches offered in Preferences */
export const SEEDS = ['#6750a4', '#0061a4', '#006a60', '#386a20', '#7c5800', '#a43c12', '#b3261e', '#984061']

// sRGB ⇄ OKLab (Björn Ottosson)
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function hexToOklch(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  const n = m ? parseInt(m[1], 16) : 0x6750a4
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => lin(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s
  return { C: Math.hypot(A, B), h: Math.atan2(B, A) }
}

function oklchToRgb(L, C, h) {
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

/**
 * A Material tone (0 black … 100 white) of hue `h` with chroma up to `C`. Tone is CIE L*; for
 * greys OKLab's L is the cube root of luminance, which gives the mapping below. Chroma is reduced
 * until the color fits into sRGB, as Material does.
 */
function tone(t, C, h) {
  const L = t <= 0 ? 0 : t >= 100 ? 1 : (t + 16) / 116
  let c = C
  let rgb = oklchToRgb(L, c, h)
  for (let i = 0; i < 24 && rgb.some((v) => v < -0.0005 || v > 1.0005); i++) rgb = oklchToRgb(L, (c *= 0.85), h)
  return '#' + rgb.map((v) => Math.round(gam(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0')).join('')
}

/** The CaretFlow color variables for `seed` in light or dark */
export function scheme(seed, dark) {
  let { C, h } = hexToOklch(seed)
  if (C < 0.02) h = hexToOklch(SEEDS[0]).h // a grey seed has no hue of its own
  const c = Math.max(C, 0.09) // some color even for a grey seed
  const p = (t) => tone(t, c, h) // primary
  const s = (t) => tone(t, c / 3, h) // secondary
  const r = (t) => tone(t, c * 0.8, h + 1.05) // tertiary: hue turned by 60°
  const n = (t) => tone(t, 0.012, h) // neutral surfaces, tinted with the seed
  const v = (t) => tone(t, 0.024, h) // neutral variant (outlines, secondary text)
  const T = dark
    ? { primary: 80, onPrimary: 20, pc: 30, onPc: 90, sc: 30, onSc: 90, tertiary: 80, surface: 6, low: 10, cont: 12, high: 17, highest: 22, on: 90, onVar: 80, outline: 60, outVar: 30, inv: 90, onInv: 20 }
    : { primary: 40, onPrimary: 100, pc: 90, onPc: 10, sc: 90, onSc: 10, tertiary: 40, surface: 98, low: 96, cont: 94, high: 92, highest: 90, on: 10, onVar: 30, outline: 50, outVar: 80, inv: 20, onInv: 95 }
  return {
    '--bg': n(T.surface),
    '--fg': n(T.on),
    '--fg-strong': n(T.on),
    '--muted': v(T.onVar),
    '--chrome': n(T.cont),
    '--chrome-2': n(T.high),
    '--border': v(T.outVar),
    '--accent': p(T.primary),
    '--accent-soft': s(T.sc),
    '--link': p(T.primary),
    '--code-bg': n(T.high),
    '--code-fg': r(T.tertiary),
    '--quote': v(T.onVar),
    '--quote-bar': p(T.pc),
    '--sel': p(T.pc),
    // Material roles the shapes in style.css use
    '--m-on-primary': p(T.onPrimary),
    '--m-primary-container': p(T.pc),
    '--m-on-primary-container': p(T.onPc),
    '--m-on-secondary-container': s(T.onSc),
    '--m-surface-low': n(T.low),
    '--m-surface-highest': n(T.highest),
    '--m-outline': v(T.outline),
    '--m-inverse-surface': n(T.inv),
    '--m-inverse-on-surface': n(T.onInv),
  }
}

let applied = []
/** Lay the scheme over the theme (inline on <html>, so it wins), or take it off again */
export function applyMaterial(on, seed, dark) {
  const st = document.documentElement.style
  for (const k of applied) st.removeProperty(k)
  applied = []
  document.body.classList.toggle('material', on)
  if (!on) return
  for (const [k, val] of Object.entries(scheme(seed, dark))) {
    st.setProperty(k, val)
    applied.push(k)
  }
}

// Ripples: Material's touch feedback, a circle that spreads from where you pressed. One listener
// for the whole page; it does nothing while the style is off.
const RIPPLE_ON = 'button, .menu-item, .m-item, .m-group, .tree-row, .ol-item, .sr-item, .pal-item, .fb-row'
let rippling = false
export function ripples() {
  if (rippling) return
  rippling = true
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!document.body.classList.contains('material') || e.button > 0) return
      const host = e.target.closest?.(RIPPLE_ON)
      if (!host || host.disabled || host.matches('.m-seed')) return
      const r = host.getBoundingClientRect()
      const d = Math.hypot(r.width, r.height) * 2
      const dot = document.createElement('span')
      dot.className = 'm-ripple'
      dot.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`
      host.classList.add('m-rippling')
      host.append(dot)
      dot.addEventListener('animationend', () => {
        dot.remove()
        if (!host.querySelector('.m-ripple')) host.classList.remove('m-rippling')
      })
    },
    { passive: true },
  )
}
