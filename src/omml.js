// TeX math → Office Math (OMML), so formulas in a .docx are real, editable Word equations.
// Covers what notes and papers use most: fractions, scripts, roots, big operators, \left…\right,
// accents, font commands, matrices and cases. Anything it doesn't know is kept as text.

const SYM = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ',
  sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '⋅', cdotp: '⋅', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', leqslant: '⩽', geqslant: '⩾', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
  sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫', prec: '≺', succ: '≻', doteq: '≐',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', nexists: '∄', in: '∈', notin: '∉', ni: '∋',
  subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  to: '→', rightarrow: '→', leftarrow: '←', gets: '←', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', leftrightarrow: '↔',
  longrightarrow: '⟶', longleftarrow: '⟵', Longrightarrow: '⟹', implies: '⟹', iff: '⟺', mapsto: '↦', hookrightarrow: '↪',
  uparrow: '↑', downarrow: '↓', ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', prime: '′',
  angle: '∠', oplus: '⊕', otimes: '⊗', wedge: '∧', land: '∧', vee: '∨', lor: '∨', neg: '¬', lnot: '¬',
  langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', mid: '∣', parallel: '∥', perp: '⊥',
  top: '⊤', bot: '⊥', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', wp: '℘', deg: '°', triangle: '△', square: '□',
  checkmark: '✓', dagger: '†', ddagger: '‡', sqcup: '⊔', vdash: '⊢', models: '⊨', colon: ':', lvert: '|', rvert: '|',
  lVert: '‖', rVert: '‖', vert: '|', Vert: '‖', backslash: '\\', S: '§', P: '¶', copyright: '©',
  quad: ' ', qquad: '  ', ',': ' ', ':': ' ', ';': ' ', ' ': ' ', '!': '',
  '{': '{', '}': '}', '|': '‖', '%': '%', $: '$', '#': '#', '&': '&', _: '_',
}
const NARY = { sum: ['∑', 1], prod: ['∏', 1], coprod: ['∐', 1], bigcup: ['⋃', 1], bigcap: ['⋂', 1], bigoplus: ['⨁', 1], bigotimes: ['⨂', 1], int: ['∫', 0], iint: ['∬', 0], iiint: ['∭', 0], oint: ['∮', 0] }
const FUNC = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'hom', 'Pr'])
const LIMFUNC = new Set(['lim', 'max', 'min', 'sup', 'inf', 'limsup', 'liminf', 'argmax', 'argmin'])
const ACC = { hat: '̂', widehat: '̂', bar: '̅', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃', widetilde: '̃', acute: '́', grave: '̀', breve: '̆', check: '̌' }
const FONT = { mathbf: ['p', 'b'], textbf: ['p', 'b'], boldsymbol: ['', 'bi'], mathit: ['', 'i'], textit: ['', 'i'], mathrm: ['roman', 'p'], textrm: ['roman', 'p'], operatorname: ['roman', 'p'], mathsf: ['sans-serif', 'p'], textsf: ['sans-serif', 'p'], mathtt: ['monospace', 'p'], texttt: ['monospace', 'p'], mathbb: ['double-struck', 'p'], mathcal: ['script', 'p'], mathscr: ['script', 'p'], mathfrak: ['fraktur', 'p'] }
const MATRIX = { matrix: ['', ''], smallmatrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''], array: ['', ''] }
const DELIM = { '\\{': '{', '\\}': '}', '\\langle': '⟨', '\\rangle': '⟩', '\\lvert': '|', '\\rvert': '|', '\\|': '‖', '\\lVert': '‖', '\\rVert': '‖', '\\lfloor': '⌊', '\\rfloor': '⌋', '\\lceil': '⌈', '\\rceil': '⌉', '.': '' }

const xe = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function tokenize(s) {
  const out = []
  const re = /\\([a-zA-Z]+)\s*|\\(.)|(\s+)|([\s\S])/g
  for (let m; (m = re.exec(s)); ) {
    if (m[1]) out.push('\\' + m[1])
    else if (m[2]) out.push('\\' + m[2])
    else if (m[3]) continue // spaces don't matter in math
    else out.push(m[4])
  }
  return out
}

class Parser {
  constructor(tex) {
    this.t = tokenize(tex)
    this.i = 0
    this.style = null // { scr, sty } or { nor: true }
  }
  peek() {
    return this.t[this.i]
  }
  next() {
    return this.t[this.i++]
  }
  run(text) {
    if (!text) return ''
    const st = this.style
    let pr = ''
    if (st?.nor) pr = '<m:rPr><m:nor/></m:rPr>'
    else if (st) pr = `<m:rPr>${st.scr ? `<m:scr m:val="${st.scr}"/>` : ''}${st.sty ? `<m:sty m:val="${st.sty}"/>` : ''}</m:rPr>`
    return `<m:r>${pr}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${xe(text)}</m:t></m:r>`
  }
  upright(text) {
    const keep = this.style
    this.style = { sty: 'p' }
    const r = this.run(text)
    this.style = keep
    return r
  }
  /** everything up to one of the stop tokens (not consumed) */
  list(stops = []) {
    let out = ''
    while (this.i < this.t.length && !stops.includes(this.peek())) out += this.scripted()
    return out
  }
  /** a required argument: {group} or one token */
  arg() {
    if (this.peek() === '{') {
      this.next()
      const x = this.list(['}'])
      this.next()
      return x
    }
    return this.atom()
  }
  rawArg() {
    if (this.peek() !== '{') return this.next() || ''
    this.next()
    let depth = 0
    let s = ''
    for (let tok; (tok = this.next()) !== undefined; ) {
      if (tok === '{') depth++
      if (tok === '}' && depth-- === 0) break
      s += tok.startsWith('\\') && /[a-zA-Z]/.test(tok[1] || '') ? tok + ' ' : tok
    }
    return s.trim()
  }
  optArg() {
    if (this.peek() !== '[') return null
    this.next()
    const x = this.list([']'])
    this.next()
    return x
  }
  /** an atom with its ^ and _ */
  scripted() {
    const base = this.atom()
    return this.scripts(base)
  }
  scripts(base) {
    let sub = null
    let sup = null
    while (this.peek() === '^' || this.peek() === '_' || this.peek() === "'") {
      const k = this.next()
      if (k === "'") sup = (sup || '') + this.run('′')
      else if (k === '^') sup = (sup || '') + this.arg()
      else sub = (sub || '') + this.arg()
    }
    if (sub !== null && sup !== null) return `<m:sSubSup><m:e>${base}</m:e><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`
    if (sup !== null) return `<m:sSup><m:e>${base}</m:e><m:sup>${sup}</m:sup></m:sSup>`
    if (sub !== null) return `<m:sSub><m:e>${base}</m:e><m:sub>${sub}</m:sub></m:sSub>`
    return base
  }
  delim(beg, end, inner) {
    return `<m:d><m:dPr><m:begChr m:val="${xe(beg)}"/><m:endChr m:val="${xe(end)}"/></m:dPr><m:e>${inner}</m:e></m:d>`
  }
  atom() {
    const tok = this.next()
    if (tok === undefined) return ''
    if (tok === '{') {
      const x = this.list(['}'])
      this.next()
      return x
    }
    if (tok === '^' || tok === '_') {
      this.i--
      return this.scripts('')
    }
    if (tok === '~') return this.run(' ')
    if (!tok.startsWith('\\')) {
      // digits stay together in one run ("12" rather than "1","2")
      let s = tok
      if (/\d/.test(tok)) while (/^[\d.]$/.test(this.peek() || '')) s += this.next()
      return this.run(s)
    }
    const c = tok.slice(1)
    if (c === 'frac' || c === 'dfrac' || c === 'tfrac' || c === 'cfrac') {
      const n = this.arg()
      return `<m:f><m:num>${n}</m:num><m:den>${this.arg()}</m:den></m:f>`
    }
    if (c === 'binom' || c === 'dbinom' || c === 'tbinom') {
      const n = this.arg()
      return this.delim('(', ')', `<m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num>${n}</m:num><m:den>${this.arg()}</m:den></m:f>`)
    }
    if (c === 'sqrt') {
      const deg = this.optArg()
      const e = this.arg()
      return deg === null
        ? `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${e}</m:e></m:rad>`
        : `<m:rad><m:deg>${deg}</m:deg><m:e>${e}</m:e></m:rad>`
    }
    if (NARY[c]) {
      const [chr, over] = NARY[c]
      let sub = ''
      let sup = ''
      while (this.peek() === '_' || this.peek() === '^' || this.peek() === '\\limits' || this.peek() === '\\nolimits') {
        const k = this.next()
        if (k === '_') sub = this.arg()
        else if (k === '^') sup = this.arg()
      }
      const e = this.i < this.t.length && !['}', '&', '\\\\', '\\right', '\\end'].includes(this.peek()) ? this.scripted() : ''
      return `<m:nary><m:naryPr><m:chr m:val="${chr}"/><m:limLoc m:val="${over ? 'undOvr' : 'subSup'}"/>${sub ? '' : '<m:subHide m:val="1"/>'}${sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e>${e}</m:e></m:nary>`
    }
    if (LIMFUNC.has(c)) {
      const name = this.upright(c)
      if (this.peek() !== '_') return name
      this.next()
      return `<m:limLow><m:e>${name}</m:e><m:lim>${this.arg()}</m:lim></m:limLow>`
    }
    if (FUNC.has(c)) return this.upright(c)
    if (c === 'left') {
      const open = this.next()
      const inner = this.list(['\\right'])
      this.next()
      const close = this.next()
      const d = (x) => DELIM[x] ?? (x?.startsWith('\\') ? SYM[x.slice(1)] ?? '' : x ?? '')
      return this.delim(d(open), d(close), inner)
    }
    if (/^(big|Big|bigg|Bigg)[lr]?$/.test(c)) return this.atom() // fixed sizes: just the delimiter
    if (ACC[c]) return `<m:acc><m:accPr><m:chr m:val="${ACC[c]}"/></m:accPr><m:e>${this.arg()}</m:e></m:acc>`
    if (c === 'overline' || c === 'underline') return `<m:bar><m:barPr><m:pos m:val="${c === 'overline' ? 'top' : 'bot'}"/></m:barPr><m:e>${this.arg()}</m:e></m:bar>`
    if (c === 'overbrace' || c === 'underbrace') {
      const top = c === 'overbrace'
      return `<m:groupChr><m:groupChrPr><m:chr m:val="${top ? '⏞' : '⏟'}"/><m:pos m:val="${top ? 'top' : 'bot'}"/><m:vertJc m:val="${top ? 'bot' : 'top'}"/></m:groupChrPr><m:e>${this.arg()}</m:e></m:groupChr>`
    }
    if (c === 'text' || c === 'mbox' || c === 'textnormal') {
      const keep = this.style
      this.style = { nor: true }
      const r = this.run(this.rawArg().replace(/\\([{}%$&#_ ])/g, '$1'))
      this.style = keep
      return r
    }
    if (FONT[c]) {
      const keep = this.style
      this.style = { scr: FONT[c][0], sty: FONT[c][1] }
      const x = this.arg()
      this.style = keep
      return x
    }
    if (c === 'begin') return this.env(this.rawArg())
    if (c === 'not') {
      const x = this.next() || ''
      const ch = x.startsWith('\\') ? SYM[x.slice(1)] || x : x
      return this.run({ '=': '≠', '∈': '∉', '⊂': '⊄', '≡': '≢' }[ch] || ch + '̸')
    }
    if (c === 'displaystyle' || c === 'textstyle' || c === 'limits' || c === 'nolimits' || c === 'label' || c === 'nonumber' || c === 'notag') {
      if (c === 'label') this.rawArg()
      return ''
    }
    if (c === '\\') return '' // a line break outside an environment
    if (SYM[c] !== undefined) return this.run(SYM[c])
    return this.run(tok) // unknown: keep the command as text
  }
  env(name) {
    const star = name.replace(/\*$/, '')
    if (star === 'array') this.rawArg() // column spec
    const rows = [[]]
    let cell = ''
    const end = () => this.peek() === '\\end'
    while (this.i < this.t.length && !end()) {
      cell += this.list(['&', '\\\\', '\\end'])
      const k = this.peek()
      if (k === '&') {
        this.next()
        rows[rows.length - 1].push(cell)
        cell = ''
      } else if (k === '\\\\') {
        this.next()
        this.optArg() // \\[2pt]
        rows[rows.length - 1].push(cell)
        cell = ''
        rows.push([])
      }
    }
    rows[rows.length - 1].push(cell)
    this.next() // \end
    this.rawArg()
    if (rows.length > 1 && rows[rows.length - 1].every((x) => !x)) rows.pop()
    if (MATRIX[star] !== undefined) {
      const cols = Math.max(...rows.map((r) => r.length))
      const m = `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="${star === 'cases' ? 'left' : 'center'}"/></m:mcPr></m:mc></m:mcs></m:mPr>${rows
        .map((r) => `<m:mr>${[...r, ...Array(cols - r.length).fill('')].map((e) => `<m:e>${e}</m:e>`).join('')}</m:mr>`)
        .join('')}</m:m>`
      const [b, e] = MATRIX[star]
      return b || e ? this.delim(b, e, m) : m
    }
    // aligned, align, gather, split, equation…: one equation per row
    if (rows.length === 1) return rows[0].join('')
    return `<m:eqArr>${rows.map((r) => `<m:e>${r.join('')}</m:e>`).join('')}</m:eqArr>`
  }
}

/** TeX → <m:oMath> (inline) or <m:oMathPara> (display) */
export function texToOmml(tex, display) {
  let body
  try {
    body = new Parser(tex).list()
  } catch {
    body = `<m:r><m:t xml:space="preserve">${xe(tex)}</m:t></m:r>`
  }
  const math = `<m:oMath>${body}</m:oMath>`
  return display ? `<m:oMathPara>${math}</m:oMathPara>` : math
}
