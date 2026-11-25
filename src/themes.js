// Custom themes: your own colors, made in a small editor (View → Theme → New Custom Theme…,
// Preferences → Appearance). A custom theme rides on a built-in one: Paper when its background is
// light, Ink when it is dark, so code colors, diagrams, callouts and the title bar follow along.
// Its colors go into one CSS rule (not inline styles), so Material You and Custom CSS still lie on
// top of it. Stored in settings.customThemes; settings.theme is then 'custom:<id>'.

export const BUILT_IN_THEMES = [
  ['paper', 'Paper'],
  ['sepia', 'Sepia'],
  ['ink', 'Ink'],
  ['slate', 'Slate'],
]

/** The colors you can set, as CSS variables without `--`, with their names in the editor. */
export const THEME_COLORS = [
  ['bg', 'Background'],
  ['fg', 'Text'],
  ['fg-strong', 'Headings and bold'],
  ['muted', 'Secondary text'],
  ['accent', 'Accent'],
  ['link', 'Links'],
  ['chrome', 'Sidebar and bars'],
  ['chrome-2', 'Panels and hover'],
  ['border', 'Lines and borders'],
  ['code-bg', 'Code background'],
  ['code-fg', 'Inline code'],
  ['quote-bar', 'Quote bar'],
  ['sel', 'Selection'],
]

const FONTS = [
  ['', 'Sans-serif'],
  ['serif', 'Serif'],
  ['mono', 'Monospace'],
]

const html = document.documentElement

export const customId = (theme) => (typeof theme === 'string' && theme.startsWith('custom:') ? theme.slice(7) : null)
export const findCustomTheme = (list, theme) => (customId(theme) ? (list || []).find((t) => t.id === customId(theme)) || null : null)

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
/** Dark themes get the dark code colors, diagrams and title bar. */
export const isDarkTheme = (t) => luminance(t.colors.bg || '#ffffff') < 0.18
export const baseTheme = (t) => (isDarkTheme(t) ? 'ink' : 'paper')

const HEX = /^#[0-9a-f]{6}$/i

/** Any CSS color → #rrggbb (the editor's color fields need that form). */
function toHex(c) {
  const ctx = (toHex.ctx ||= document.createElement('canvas').getContext('2d'))
  ctx.fillStyle = '#000000'
  ctx.fillStyle = String(c).trim()
  const v = ctx.fillStyle
  if (HEX.test(v)) return v.toLowerCase()
  const m = v.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/)
  return m ? '#' + m.slice(1, 4).map((x) => Math.round(+x).toString(16).padStart(2, '0')).join('') : '#000000'
}

/** The colors of a built-in theme, read from style.css (switching the root for one style read). */
export function builtInColors(name) {
  const prev = { theme: html.dataset.theme, custom: html.dataset.custom }
  const inline = THEME_COLORS.map(([k]) => [k, html.style.getPropertyValue('--' + k)])
  html.dataset.theme = name
  delete html.dataset.custom
  for (const [k] of inline) html.style.removeProperty('--' + k) // Material You's colors
  const cs = getComputedStyle(html)
  const colors = Object.fromEntries(THEME_COLORS.map(([k]) => [k, toHex(cs.getPropertyValue('--' + k))]))
  html.dataset.theme = prev.theme
  if (prev.custom) html.dataset.custom = prev.custom
  for (const [k, v] of inline) if (v) html.style.setProperty('--' + k, v)
  return colors
}

/** The variables of a custom theme as declarations (also used by the editor's preview). */
export function themeDeclarations(t) {
  const c = t.colors
  const d = THEME_COLORS.filter(([k]) => HEX.test(c[k] || '')).map(([k]) => `--${k}: ${c[k]};`)
  // the soft accent and the quote text follow from the others
  if (c.accent && c.bg) d.push(`--accent-soft: color-mix(in srgb, ${c.accent} 18%, ${c.bg});`)
  if (c.fg && c.bg) d.push(`--quote: color-mix(in srgb, ${c.fg} 62%, ${c.bg});`)
  d.push(`--doc-font: var(--font-${t.font || 'sans'});`)
  return d.join(' ')
}

/** Lay a custom theme over its base theme, or take it off (t = null). */
export function applyCustomTheme(t) {
  let style = document.getElementById('cf-custom-theme')
  if (!t) {
    delete html.dataset.custom
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = 'cf-custom-theme'
    document.head.append(style)
  }
  // [data-theme][data-custom] outranks style.css's :root[data-theme='…'] rules
  style.textContent = `:root[data-theme][data-custom] { ${themeDeclarations(t)} }`
  html.dataset.custom = t.id
}

/** A small page in the theme's colors: sidebar, heading, text, link, code, quote, selection. */
function previewBox(el) {
  return el(
    'div',
    { class: 'tp' },
    el('div', { class: 'tp-side' }, el('i', {}), el('i', { class: 'on' }), el('i', {}), el('i', {})),
    el(
      'div',
      { class: 'tp-page' },
      el('div', { class: 'tp-h' }, 'A heading'),
      el('div', {}, 'Text with a ', el('span', { class: 'tp-link' }, 'link'), ', ', el('span', { class: 'tp-code' }, 'code'), ' and ', el('span', { class: 'tp-sel' }, 'selected words'), '.'),
      el('div', { class: 'tp-quote' }, 'A quote'),
      el('div', { class: 'tp-foot' }, el('span', { class: 'tp-muted' }, 'Secondary text'), el('span', { class: 'tp-btn' }, 'Accent')),
    ),
  )
}

/**
 * The editor. theme: the one to change, or null for a new one starting from `from` (a built-in
 * name or the current custom theme). host: { el, dialog, customSelect, toast }.
 * Resolves to the saved theme, or null when cancelled.
 */
export async function editTheme(host, theme, from) {
  const { el, dialog, customSelect } = host
  const draft = theme
    ? { ...theme, colors: { ...theme.colors } }
    : { id: Date.now().toString(36), name: 'My Theme', font: from?.font || '', colors: from?.colors ? { ...from.colors } : builtInColors(from || 'paper') }

  const preview = previewBox(el)
  const fields = {}
  const show = () => {
    preview.setAttribute('style', themeDeclarations(draft))
    preview.classList.toggle('dark', isDarkTheme(draft))
    for (const [k] of THEME_COLORS) {
      fields[k].color.value = draft.colors[k]
      fields[k].hex.value = draft.colors[k]
    }
  }
  const grid = el('div', { class: 'te-colors' })
  for (const [k, label] of THEME_COLORS) {
    const color = el('input', { type: 'color', title: label })
    const hex = el('input', { type: 'text', maxlength: 7, spellcheck: 'false', class: 'te-hex' })
    color.oninput = () => {
      draft.colors[k] = color.value
      show()
    }
    hex.onchange = () => {
      const v = hex.value.trim().replace(/^([0-9a-f]{6})$/i, '#$1')
      if (HEX.test(v)) draft.colors[k] = v.toLowerCase()
      show()
    }
    fields[k] = { color, hex }
    grid.append(el('label', { class: 'te-color' }, color, hex, el('span', {}, label)))
  }
  const name = el('input', { type: 'text', value: draft.name, spellcheck: 'false', maxlength: 40, class: 'te-name' })
  const start = customSelect([['', 'Choose…'], ...BUILT_IN_THEMES], '', (v) => {
    if (!v) return
    draft.colors = builtInColors(v)
    if (v === 'sepia') draft.font = 'serif'
    font.replaceWith((font = fontSel()))
    show()
  })
  const fontSel = () => customSelect(FONTS, draft.font || '', (v) => ((draft.font = v), show()))
  let font = fontSel()

  const body = el(
    'div',
    { class: 'theme-editor' },
    el('div', { class: 'te-top' }, el('label', {}, 'Name', name), el('label', {}, 'Start from', start), el('label', {}, 'Document font', font)),
    el('div', { class: 'te-main' }, grid, preview),
    el('p', { class: 'about-note' }, 'A dark background makes it a dark theme: code colors, diagrams and the title bar follow. Material You and Custom CSS still apply on top.'),
  )
  show()
  const ok = await dialog({
    title: theme ? 'Edit theme' : 'New theme',
    body,
    wide: true,
    buttons: [
      { label: 'Cancel', value: false, cancel: true },
      { label: 'Save', value: true, primary: true },
    ],
    onMount: () => setTimeout(() => name.select()),
  })
  if (!ok) return null
  draft.name = name.value.trim() || 'My Theme'
  return draft
}
