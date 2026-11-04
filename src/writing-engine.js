// Writing-check engines (lazy-loaded): Harper (offline, English) and LanguageTool (HTTP API).
// Both take a list of plain-text blocks and return, per block, a list of issues:
//   { start, end, cat: 'spelling'|'grammar'|'style', kind, message, rule, sugg: [{ label, text }] }
// `start`/`end` are offsets in the block (JS string units); `text` replaces start..end.

const SPELLING = new Set(['Spelling', 'Typo'])
const STYLE = new Set(['Style', 'Readability', 'Redundancy', 'Enhancement', 'Regionalism', 'Formatting'])
const category = (kind) => (SPELLING.has(kind) ? 'spelling' : STYLE.has(kind) ? 'style' : 'grammar')

/**
 * Text Harper should skip: things that are code or names rather than prose.
 * Rust regex syntax (passed into the WebAssembly module).
 */
function maskPattern({ ignoreUpper = true, ignoreDigits = true } = {}) {
  const parts = [
    String.raw`https?://\S+`,
    String.raw`www\.\S+`,
    String.raw`[\w.+-]+@[\w-]+\.[\w.]+`,
    String.raw`\b[A-Za-z]*[a-z][A-Z][A-Za-z]*\b`, // camelCase, CodeMirror
    String.raw`\b\w+_\w*\b`, // snake_case
    String.raw`\S*[/\\]\S*[/\\]\S*`, // paths
    String.raw`\b[\w-]+\.(md|markdown|js|mjs|ts|tsx|jsx|json|rs|toml|yml|yaml|css|html|py|sh|exe|png|jpg|svg|pdf|txt)\b`,
  ]
  if (ignoreDigits) parts.push(String.raw`\b\w*\d\w*\b`)
  if (ignoreUpper) parts.push(String.raw`\b[A-Z]{2,}s?\b`)
  return parts.join('|')
}

// A name Harper skips (masked: camelCase, ALLCAPS, …) leaves a gap that looks like a sentence
// boundary, so "CaretFlow opens …" got "opens" flagged as a sentence without a capital letter.
const SKIPPED_WORD_BEFORE = /\b(?:[A-Za-z]*[a-z][A-Z][A-Za-z]*|[A-Z]{2,}s?|\w*\d\w*|\w+_\w*)\s+$/
const capitalAfterSkippedWord = (rule, text, start) => /capitali[sz]/i.test(rule) && SKIPPED_WORD_BEFORE.test(text.slice(Math.max(0, start - 60), start))

// ─────────────────────────────── Harper
const DIALECTS = { american: 0, british: 1, australian: 2, canadian: 3, indian: 4 }

export async function createHarper({ dialect = 'american', ignoreUpper, ignoreDigits } = {}) {
  const [{ WorkerLinter, LocalLinter }, { binary }] = await Promise.all([import('harper.js'), import('harper.js/binary')])
  const init = { binary, dialect: DIALECTS[dialect] ?? 0 }
  let linter
  // The worker keeps typing smooth; fall back to the main thread where workers can't load the module.
  try {
    linter = new WorkerLinter(init)
    await withTimeout(linter.setup(), 20000)
  } catch {
    linter = new LocalLinter(init)
    await linter.setup()
  }
  let mask = maskPattern({ ignoreUpper, ignoreDigits })
  let disabled = []

  return {
    name: 'harper',
    async setOptions(o) {
      if ('dialect' in o) await linter.setDialect(DIALECTS[o.dialect] ?? 0)
      mask = maskPattern({ ignoreUpper: o.ignoreUpper ?? true, ignoreDigits: o.ignoreDigits ?? true })
      if (o.disabledRules) {
        // turn rules back on that were re-enabled, off the ones listed
        const cfg = {}
        for (const r of disabled) cfg[r] = null
        for (const r of o.disabledRules) cfg[r] = false
        disabled = [...o.disabledRules]
        await linter.setLintConfig({ ...(await linter.getLintConfig()), ...cfg })
      }
    },
    async check(blocks) {
      const out = []
      for (const text of blocks) {
        if (!/\p{L}{2}/u.test(text)) {
          out.push([])
          continue
        }
        const groups = await linter.organizedLints(text, { language: 'plaintext', regex_mask: mask })
        const issues = []
        for (const [rule, lints] of Object.entries(groups)) {
          for (const l of lints) {
            const span = l.span()
            if (capitalAfterSkippedWord(rule, text, span.start)) {
              l.free?.()
              continue
            }
            const problem = l.get_problem_text()
            const kind = l.lint_kind()
            const sugg = l.suggestions().map((s) => {
              const rep = s.get_replacement_text()
              const k = s.kind() // 0 replace, 1 remove, 2 insert after
              if (k === 1) return { label: `Delete “${problem.trim() || problem}”`, text: '' }
              if (k === 2) return { label: `Add “${rep}”`, text: problem + rep }
              return { label: rep, text: rep }
            })
            issues.push({ start: span.start, end: span.end, cat: category(kind), kind: l.lint_kind_pretty(), message: tidy(l.message()), rule, sugg: dedupe(sugg) })
            l.free?.()
          }
        }
        issues.sort((a, b) => a.start - b.start)
        out.push(issues)
      }
      return out
    },
    dispose() {
      linter.dispose?.()
    },
  }
}

/** Harper writes `word`; show it as “word”. */
const tidy = (m) => m.replace(/`([^`]+)`/g, '“$1”')
/** Drop suggestions that only differ by surrounding spaces. */
function dedupe(list) {
  const seen = new Set()
  return list.filter((s) => {
    const k = s.text.trim()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

// ─────────────────────────────── LanguageTool
const LT_STYLE = new Set(['style', 'locale-violation', 'register', 'inconsistency'])
const SEP = '\n\n'

/**
 * LanguageTool over HTTP: the public server (api.languagetool.org, ~20 requests/minute and 20 KB per
 * request without an account) or a self-hosted one. Blocks are joined into as few requests as possible.
 */
export function createLanguageTool({ server = 'https://api.languagetool.org', language = 'auto', motherTongue = '', picky = false } = {}) {
  let disabled = []
  let opts = { server, language, motherTongue, picky }
  const endpoint = () => opts.server.replace(/\/+$/, '').replace(/\/v2(\/check)?$/, '') + '/v2/check'

  async function request(text) {
    const body = new URLSearchParams({ text, language: opts.language || 'auto' })
    if (opts.language === 'auto') body.set('preferredVariants', 'en-US,de-AT,pt-PT,ca-ES')
    if (opts.motherTongue) body.set('motherTongue', opts.motherTongue)
    if (opts.picky) body.set('level', 'picky')
    if (disabled.length) body.set('disabledRules', disabled.join(','))
    const res = await fetch(endpoint(), { method: 'POST', body, headers: { Accept: 'application/json' } })
    if (res.status === 429) throw new Error('LanguageTool: too many requests, slowing down')
    if (!res.ok) throw new Error(`LanguageTool: ${res.status} ${res.statusText}`)
    return res.json()
  }

  return {
    name: 'languagetool',
    async setOptions(o) {
      opts = { ...opts, ...o }
      if (o.disabledRules) disabled = [...o.disabledRules]
    },
    async check(blocks) {
      const out = blocks.map(() => [])
      // pack blocks into requests of at most ~18k characters
      let batch = []
      let size = 0
      const flush = async () => {
        if (!batch.length) return
        const text = batch.map((b) => blocks[b]).join(SEP)
        const starts = []
        let at = 0
        for (const b of batch) {
          starts.push(at)
          at += blocks[b].length + SEP.length
        }
        const json = await request(text)
        for (const m of json.matches || []) {
          let i = starts.length - 1
          while (i > 0 && starts[i] > m.offset) i--
          const start = m.offset - starts[i]
          const end = start + m.length
          if (end > blocks[batch[i]].length) continue // spans the separator
          const type = m.rule?.issueType || ''
          const cat = type === 'misspelling' || type === 'typographical' && /spell|typo/i.test(m.rule?.id) ? 'spelling' : LT_STYLE.has(type) ? 'style' : 'grammar'
          out[batch[i]].push({
            start,
            end,
            cat,
            kind: m.rule?.category?.name || m.shortMessage || 'Suggestion',
            message: m.message,
            rule: m.rule?.id || '',
            sugg: dedupe((m.replacements || []).slice(0, 8).map((r) => ({ label: r.value || '(delete)', text: r.value }))),
          })
        }
        batch = []
        size = 0
      }
      for (let i = 0; i < blocks.length; i++) {
        if (!/\p{L}{2}/u.test(blocks[i])) continue
        if (size + blocks[i].length > 18000) await flush()
        batch.push(i)
        size += blocks[i].length + SEP.length
      }
      await flush()
      return out
    },
    dispose() {},
  }
}
