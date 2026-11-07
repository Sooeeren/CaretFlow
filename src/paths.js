// Small cross-platform path helpers (Windows + POSIX)

export const isAbs = (p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')
export const sepOf = (p) => (p && p.includes('\\') ? '\\' : '/')
/** A file another Android app handed over: a content:// link, not a path (no folder, no siblings) */
export const isUri = (p) => typeof p === 'string' && p.startsWith('content://')
export const basename = (p) => {
  // content://…/document/primary%3ADocuments%2Fnote.md → note.md
  if (isUri(p)) return decodeURIComponent(p.split('/').pop() || '').split(/[\\/:]/).pop() || 'Document'
  return (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop()
}
/** file:// link for an absolute path (Android prints exports from plain files) */
export const fileUrl = (p) => (isAbs(p) ? 'file://' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F') : p)
export const dirname = (p) => {
  if (isUri(p)) return ''
  const s = (p || '').replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i < 0) return ''
  if (i === 2 && s[1] === ':') return s.slice(0, 3)
  return s.slice(0, i) || s.slice(0, 1)
}
export const stem = (p) => basename(p).replace(/\.[^.]+$/, '')
export const extname = (p) => {
  const m = /\.([^.\\/]+)$/.exec(p || '')
  return m ? m[1].toLowerCase() : ''
}

export function normalize(p) {
  const sep = sepOf(p)
  const lead = p.startsWith('\\\\') ? '\\\\' : p.startsWith('/') ? '/' : ''
  const out = []
  for (const seg of p.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..' && !/^[a-zA-Z]:$/.test(out[out.length - 1])) out.pop()
      else if (!lead && !out.length) out.push('..')
      continue
    }
    out.push(seg)
  }
  let r = lead + out.join(sep)
  if (/^[a-zA-Z]:$/.test(r)) r += sep
  return r
}

export function join(dir, rel) {
  if (!dir) return rel
  if (isAbs(rel)) return normalize(rel)
  const sep = sepOf(dir)
  return normalize(dir.replace(/[\\/]+$/, '') + sep + rel.replace(/\//g, sep))
}

const eq = (a, b) => a.toLowerCase() === b.toLowerCase()

/** Relative path from directory `from` to `to`, using forward slashes. Returns null if on different roots. */
export function relative(from, to) {
  const a = normalize(from).split(/[\\/]+/).filter(Boolean)
  const b = normalize(to).split(/[\\/]+/).filter(Boolean)
  if (!a.length || !b.length || !eq(a[0], b[0])) return null
  let i = 0
  while (i < a.length && i < b.length && eq(a[i], b[i])) i++
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/') || '.'
}

export const isInside = (p, root) => {
  if (!p || !root) return false
  const r = normalize(root).toLowerCase().replace(/[\\/]+$/, '')
  const n = normalize(p).toLowerCase()
  return n === r || n.startsWith(r + '\\') || n.startsWith(r + '/')
}

/** Encode a path for use inside a markdown link/image target. */
export const encodeSrc = (p) => p.replace(/\\/g, '/').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
export const decodeSrc = (p) => {
  try {
    return decodeURI(p)
  } catch {
    return p
  }
}
