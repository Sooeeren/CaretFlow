// Hunspell (the spell checker of LibreOffice, compiled to WebAssembly) for languages Harper doesn't
// know. Runs in spell-worker.js; writing-engine.js falls back to the main thread where workers fail.
// the CommonJS build: the ES module build imports nanoid in a way that fails in browsers
import { loadModule } from 'hunspell-asm/dist/cjs/index.js'

let factory = null
const dicts = new Map() // dictionary id -> hunspell instance

/** Load a dictionary from its two files (once). */
export async function load(id, aff, dic) {
  if (dicts.has(id)) return true
  factory ||= await loadModule()
  const a = factory.mountBuffer(new Uint8Array(aff), `${id}.aff`)
  const d = factory.mountBuffer(new Uint8Array(dic), `${id}.dic`)
  dicts.set(id, factory.create(a, d))
  // Hunspell has read both files into memory: the virtual files can go
  factory.unmount(a)
  factory.unmount(d)
  return true
}

const WORD = /[\p{L}\p{M}](?:[\p{L}\p{M}'’-]*[\p{L}\p{M}])?/gu
const MAX_SUGGEST = 40 // per call: Hunspell's suggestions take up to ~0.2 s per word

/**
 * Misspelled words in each text, as issues like Harper's.
 * `mask` is a regex source for text to skip (links, code-like names), shared with Harper.
 */
export function check(texts, id, { mask = '', name = '' } = {}) {
  const h = dicts.get(id)
  if (!h) throw new Error(`dictionary ${id} not loaded`)
  let suggested = 0
  return texts.map((text) => {
    const skip = []
    if (mask) {
      const re = new RegExp(mask, 'g')
      for (let m; (m = re.exec(text)); ) {
        skip.push([m.index, m.index + m[0].length])
        if (!m[0].length) re.lastIndex++
      }
    }
    const out = []
    WORD.lastIndex = 0
    for (let m; (m = WORD.exec(text)); ) {
      const word = m[0]
      const start = m.index
      const end = start + word.length
      if (word.length < 2 || skip.some(([a, b]) => start < b && end > a)) continue
      if (correct(h, word)) continue
      const sugg = suggested++ < MAX_SUGGEST ? h.suggest(word.replace(/’/g, "'")).slice(0, 6) : []
      out.push({
        start,
        end,
        cat: 'spelling',
        kind: 'Spelling',
        message: `“${word}” is not in the ${name || id} dictionary.`,
        rule: 'Hunspell',
        sugg: sugg.map((s) => ({ label: s, text: word.includes('’') ? s.replace(/'/g, '’') : s })),
      })
    }
    return out
  })
}

function correct(h, word) {
  const w = word.replace(/’/g, "'")
  if (h.spell(w)) return true
  // hyphenated words: fine when every part is ("Ost-West-Konflikt", "porte-monnaie")
  if (w.includes('-')) return w.split('-').every((p) => !p || h.spell(p))
  return false
}
