// Waveform maths over a plot's vectors: recursive-descent parser + evaluator, complex-aware for AC plots. Pure TS.
//   expr   := term (('+'|'-') term)*        term := unary (('*'|'/') unary)*        unary := '-' unary | atom
//   atom   := number | '(' expr ')' | func '(' expr ')' | v(a) | v(a,b) | <name>(<raw>) | <raw vector name>
import type { RawPlot, RawVar } from '../../../main/rawfile.ts'
import { spiceValue } from '../sim/analysis.ts'

export const isCurrent = (name: string) => /^(i\(|@)|#branch/i.test(name)
// Display names: ngspice's raw names → readable ("i(@r1[i])" → "I(R1)", "i(@q1[ic])" → "Ic(Q1)", "v(out)" → "V(out)")
export function pretty(name: string): string {
  const m = /^i\(@([^[\]]+)\[(\w+)\]\)$/i.exec(name)
  // devices inside subckts come back as "<type>.x1.r1": drop the type letter → X1.R1
  if (m) return `I${/^(i|id|current)$/i.test(m[2]) ? '' : m[2].slice(1).toLowerCase()}(${m[1].replace(/^[a-z]\.(?=.*\.)/i, '').toUpperCase()})`
  const b = /^i\(([^)]+)\)$/i.exec(name)
  if (b) return `I(${b[1].toUpperCase()})`
  return name.replace(/^v\(/i, 'V(')
}

// unit is a display hint: V, A, W, Ω, dB, °, s, … ('' = unknown / dimensionless)
export type Val = { re: Float64Array; im: Float64Array | null; unit: string }
const UNIT: Record<string, string> = { time: 's', frequency: 'Hz', voltage: 'V', current: 'A' }
const FUNCS = new Set(['db', 'mag', 'abs', 'ph', 're', 'im', 'sqrt', 'deriv', 'gd'])

class ExprError extends Error {}
const fail = (m: string): never => { throw new ExprError(m) }

export function evalExpr(src: string, plot: RawPlot): Val | { error: string } {
  try {
    return new Parser(src, plot).run()
  } catch (e) {
    if (e instanceof ExprError) return { error: e.message }
    throw e
  }
}

// a vector by raw name or by display name ("i(r1)" finds i(@r1[i]), "ic(q1)" finds i(@q1[ic]))
function find(plot: RawPlot, name: string): RawVar | undefined {
  const n = name.toLowerCase()
  return plot.vars.find((v) => v.name.toLowerCase() === n) ?? plot.vars.find((v) => pretty(v.name).toLowerCase() === n)
}

class Parser {
  i = 0
  s: string
  plot: RawPlot
  n: number
  constructor(s: string, plot: RawPlot) {
    this.s = s, this.plot = plot, this.n = plot.points
  }

  run(): Val {
    if (!this.s.trim()) fail('Empty expression')
    const v = this.expr()
    this.ws()
    if (this.i < this.s.length) fail(`Unexpected '${this.s[this.i]}' at ${this.i + 1}`)
    return v
  }
  ws() { while (/\s/.test(this.s[this.i] ?? '')) this.i++ }
  eat(c: string) {
    this.ws()
    if (this.s[this.i] === c) return this.i++, true
    return false
  }
  expect(c: string) { if (!this.eat(c)) fail(`Expected '${c}' at ${this.i + 1}`) }

  expr(): Val {
    let a = this.term()
    for (;;) {
      if (this.eat('+')) a = add(a, this.term(), 1)
      else if (this.eat('-')) a = add(a, this.term(), -1)
      else return a
    }
  }
  term(): Val {
    let a = this.unary()
    for (;;) {
      if (this.eat('*')) a = mul(a, this.unary())
      else if (this.eat('/')) a = div(a, this.unary())
      else return a
    }
  }
  unary(): Val {
    if (this.eat('-')) return scale(this.unary(), -1)
    if (this.eat('+')) return this.unary()
    return this.atom()
  }
  atom(): Val {
    this.ws()
    const rest = this.s.slice(this.i)
    if (this.eat('(')) {
      const v = this.expr()
      this.expect(')')
      return v
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[afpnumkgt])?[a-z]*/i.exec(rest)
    if (num) {
      this.i += num[0].length
      const x = spiceValue(num[0])
      if (isNaN(x)) fail(`Bad number '${num[0]}'`)
      return { re: new Float64Array(this.n).fill(x), im: null, unit: '' }
    }
    const id = /^[a-z_@#][\w#.@[\]:]*/i.exec(rest)?.[0]
    if (!id) fail(this.i < this.s.length ? `Unexpected '${this.s[this.i]}' at ${this.i + 1}` : 'Unexpected end of expression')
    this.i += id!.length
    const name = id!.toLowerCase()
    if (!this.eat('(')) return this.vec(name)
    if (FUNCS.has(name)) {
      const v = this.expr()
      this.expect(')')
      return this.func(name, v)
    }
    // vector reference: the raw text up to ')' (names like @r1[i] aren't expressions)
    const close = this.s.indexOf(')', this.i)
    if (close < 0) fail(`Missing ')' after ${id}(`)
    const arg = this.s.slice(this.i, close).replace(/\s+/g, '')
    this.i = close + 1
    if (name === 'v' && arg.includes(',')) {
      const [a, b, more] = arg.split(',')
      if (more !== undefined || !a || !b) fail(`v(${arg}): expected v(a) or v(a,b)`)
      return add(this.vec(`v(${a})`), this.vec(`v(${b})`), -1)
    }
    return this.vec(`${name}(${arg})`)
  }
  vec(name: string): Val {
    const v = find(this.plot, name) ?? (/^v\((.+)\)$/.exec(name) && find(this.plot, /^v\((.+)\)$/.exec(name)![1]))
    if (!v) fail(`Unknown vector '${name}'`)
    const u = v!.type === 'voltage' || v!.type === 'current' ? UNIT[v!.type] : isCurrent(v!.name) ? 'A' : (UNIT[v!.type] ?? '')
    return { re: v!.re, im: this.plot.complex ? (v!.im ?? null) : null, unit: u }
  }
  func(f: string, a: Val): Val {
    const n = this.n, re = new Float64Array(n), { im } = a
    const real = (g: (r: number, i: number) => number, unit: string): Val => {
      for (let k = 0; k < n; k++) re[k] = g(a.re[k], im ? im[k] : 0)
      return { re, im: null, unit }
    }
    switch (f) {
      case 'db': return real((r, i) => 20 * Math.log10(Math.hypot(r, i)), 'dB')
      case 'mag': case 'abs': return real((r, i) => Math.hypot(r, i), a.unit)
      case 'ph': return real((r, i) => (Math.atan2(i, r) * 180) / Math.PI, '°')
      case 're': return real((r) => r, a.unit)
      case 'im': return real((_r, i) => i, a.unit)
      case 'sqrt': {
        if (!im) return real((r) => Math.sqrt(r), '')
        const out = new Float64Array(n)
        for (let k = 0; k < n; k++) {
          const m = Math.sqrt(Math.hypot(a.re[k], im[k])), t = Math.atan2(im[k], a.re[k]) / 2
          re[k] = m * Math.cos(t), out[k] = m * Math.sin(t)
        }
        return { re, im: out, unit: '' }
      }
      case 'deriv': {
        const x = this.plot.vars[0].re, d = (y: Float64Array) => deriv(x, y)
        const xu = UNIT[this.plot.vars[0].type] ?? ''
        return { re: d(a.re), im: im && d(im), unit: a.unit && xu ? `${a.unit}/${xu}` : '' }
      }
      case 'gd': {
        if (!im) fail('gd() needs an AC (complex) plot')
        // group delay = -dφ/dω with φ unwrapped (radians), ω = 2πf
        const ph = new Float64Array(n)
        for (let k = 0; k < n; k++) {
          ph[k] = Math.atan2(im![k], a.re[k])
          if (k) ph[k] -= 2 * Math.PI * Math.round((ph[k] - ph[k - 1]) / (2 * Math.PI))
        }
        const g = deriv(this.plot.vars[0].re, ph)
        for (let k = 0; k < n; k++) re[k] = -g[k] / (2 * Math.PI)
        return { re, im: null, unit: 's' }
      }
    }
    return fail(`Unknown function ${f}()`)
  }
}

// dy/dx: central differences (non-uniform x), one-sided at the ends
export function deriv(x: Float64Array, y: Float64Array): Float64Array {
  const n = y.length, d = new Float64Array(n)
  if (n < 2) return d
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1)
    d[k] = (y[b] - y[a]) / (x[b] - x[a])
  }
  return d
}

const sameUnit = (a: string, b: string) => (a === b ? a : !a ? b : !b ? a : '')
function add(a: Val, b: Val, sign: 1 | -1): Val {
  const n = a.re.length, re = new Float64Array(n)
  for (let k = 0; k < n; k++) re[k] = a.re[k] + sign * b.re[k]
  let im: Float64Array | null = null
  if (a.im || b.im) {
    im = new Float64Array(n)
    for (let k = 0; k < n; k++) im[k] = (a.im ? a.im[k] : 0) + sign * (b.im ? b.im[k] : 0)
  }
  return { re, im, unit: sameUnit(a.unit, b.unit) }
}
function scale(a: Val, s: number): Val {
  return { re: a.re.map((v) => v * s), im: a.im && a.im.map((v) => v * s), unit: a.unit }
}
const MUL: Record<string, string> = { 'V*A': 'W', 'A*V': 'W', 'A*Ω': 'V', 'Ω*A': 'V' }
const DIV: Record<string, string> = { 'V/A': 'Ω', 'W/V': 'A', 'W/A': 'V', 'V/Ω': 'A' }
function mul(a: Val, b: Val): Val {
  const n = a.re.length, re = new Float64Array(n)
  const unit = !b.unit ? a.unit : !a.unit ? b.unit : (MUL[`${a.unit}*${b.unit}`] ?? '')
  if (!a.im && !b.im) {
    for (let k = 0; k < n; k++) re[k] = a.re[k] * b.re[k]
    return { re, im: null, unit }
  }
  const im = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const ar = a.re[k], ai = a.im ? a.im[k] : 0, br = b.re[k], bi = b.im ? b.im[k] : 0
    re[k] = ar * br - ai * bi, im[k] = ar * bi + ai * br
  }
  return { re, im, unit }
}
function div(a: Val, b: Val): Val {
  const n = a.re.length, re = new Float64Array(n)
  const unit = !b.unit ? a.unit : a.unit === b.unit ? '' : (DIV[`${a.unit}/${b.unit}`] ?? '')
  if (!a.im && !b.im) {
    for (let k = 0; k < n; k++) re[k] = a.re[k] / b.re[k]
    return { re, im: null, unit }
  }
  const im = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const ar = a.re[k], ai = a.im ? a.im[k] : 0, br = b.re[k], bi = b.im ? b.im[k] : 0, d = br * br + bi * bi
    re[k] = (ar * br + ai * bi) / d, im[k] = (ai * br - ar * bi) / d
  }
  return { re, im, unit }
}
