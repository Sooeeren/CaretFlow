// Make your own typing cat (Tools → Cat Style → Make Your Own Cat…, Preferences → Typing): colors
// for fur, outline, ears, eyes, mouth, paws and markings, which markings it has, and blush, with a
// big live preview. Loaded on first use. The result is settings.customCat, shown as the "Your Own"
// style (companion.js).
import { CAT_STYLES, CAT_COLORS, CAT_MARKS, catPreview, customCatVars } from './companion.js'

const HEX = /^#[0-9a-f]{6}$/i
// built-in styles' markings, for "Start from"
const STYLE_MARKS = { ginger: ['stripes'], calico: ['patches'], siamese: ['mask'], tuxedo: ['bib'], cookie: ['stripes', 'bib'] }

function toHex(c) {
  const ctx = (toHex.ctx ||= document.createElement('canvas').getContext('2d'))
  ctx.fillStyle = '#000000'
  ctx.fillStyle = String(c).trim()
  const v = ctx.fillStyle
  if (HEX.test(v)) return v.toLowerCase()
  const m = v.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/)
  return m ? '#' + m.slice(1, 4).map((x) => Math.round(+x).toString(16).padStart(2, '0')).join('') : '#000000'
}

/** The colors of a built-in style, read from style.css through a hidden drawing. */
export function styleColors(style) {
  const probe = catPreview(style, 10)
  probe.style.cssText = 'position:fixed;left:-99px;top:-99px;visibility:hidden'
  document.body.append(probe)
  const cs = getComputedStyle(probe)
  const read = (v) => cs.getPropertyValue(v).trim()
  const out = Object.fromEntries(CAT_COLORS.map(([k, , v]) => [k, read(v)]))
  // transparent / var() leftovers → something sensible to edit
  for (const [k] of CAT_COLORS) if (!out[k] || out[k] === 'transparent') out[k] = k === 'mark2' ? '#ffffff' : k === 'mark' ? '#f0a24e' : out.fur
  for (const k in out) out[k] = toHex(out[k])
  const blush = +read('--cat-blush') > 0 // before the probe goes: a removed element has no style
  probe.remove()
  return { ...out, marks: STYLE_MARKS[style] || [], blush }
}

/** host: { el, dialog, customSelect }. Resolves to the new cat, or null when cancelled. */
export async function editCat(host, current, startStyle) {
  const { el, dialog, customSelect } = host
  const draft = current ? { ...current, marks: [...(current.marks || [])] } : styleColors(startStyle || 'classic')

  const preview = catPreview('custom', 220)
  preview.classList.add('draft')
  const fields = {}
  const checks = {}
  let blush
  const show = () => {
    preview.setAttribute('style', customCatVars(draft))
    preview.dataset.marks = draft.marks.join(' ')
    for (const [k] of CAT_COLORS) {
      fields[k].color.value = draft[k]
      fields[k].hex.value = draft[k]
    }
    for (const [m] of CAT_MARKS) checks[m].checked = draft.marks.includes(m)
    blush.checked = draft.blush !== false
  }

  const colors = el('div', { class: 'te-colors' })
  for (const [k, label] of CAT_COLORS) {
    const color = el('input', { type: 'color', title: label })
    const hex = el('input', { type: 'text', maxlength: 7, spellcheck: 'false', class: 'te-hex' })
    color.oninput = () => ((draft[k] = color.value), show())
    hex.onchange = () => {
      const v = hex.value.trim().replace(/^([0-9a-f]{6})$/i, '#$1')
      if (HEX.test(v)) draft[k] = v.toLowerCase()
      show()
    }
    fields[k] = { color, hex }
    colors.append(el('label', { class: 'te-color' }, color, hex, el('span', {}, label)))
  }
  const marks = el('div', { class: 'cm-marks' })
  for (const [m, label] of CAT_MARKS) {
    const c = el('input', { type: 'checkbox' })
    c.onchange = () => {
      draft.marks = CAT_MARKS.map(([x]) => x).filter((x) => (x === m ? c.checked : draft.marks.includes(x)))
      show()
    }
    checks[m] = c
    marks.append(el('label', {}, c, label))
  }
  blush = el('input', { type: 'checkbox' })
  blush.onchange = () => ((draft.blush = blush.checked), show())
  marks.append(el('label', {}, blush, 'Blush'))

  const start = customSelect([['', 'Choose…'], ...CAT_STYLES.filter(([id]) => id !== 'custom')], '', (v) => {
    if (!v) return
    Object.assign(draft, styleColors(v))
    show()
  })

  const body = el(
    'div',
    { class: 'theme-editor cat-maker' },
    el('div', { class: 'te-top' }, el('label', {}, 'Start from', start)),
    el('div', { class: 'te-main' }, el('div', { class: 'cm-left' }, colors, marks), el('div', { class: 'cm-stage' }, preview)),
  )
  show()
  const ok = await dialog({
    title: current ? 'Your own cat' : 'Make your own cat',
    body,
    wide: true,
    buttons: [
      { label: 'Cancel', value: false, cancel: true },
      { label: 'Save', value: true, primary: true },
    ],
  })
  return ok ? draft : null
}
