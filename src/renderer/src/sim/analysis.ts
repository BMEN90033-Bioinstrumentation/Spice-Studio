// Analysis directives (.op/.tran/.ac/.dc/.noise) <-> structured form for the dialog. Pure TS.

export type Sweep = 'dec' | 'oct' | 'lin'
export type Analysis =
  | { kind: 'op' }
  | { kind: 'tran'; step: string; stop: string; start: string; maxStep: string; uic: boolean } // '' = omitted
  | { kind: 'ac'; sweep: Sweep; points: string; fstart: string; fstop: string }
  | { kind: 'dc'; source: string; start: string; stop: string; step: string }
  | { kind: 'noise'; output: string; ref: string; source: string; sweep: Sweep; points: string; fstart: string; fstop: string } // output = net name, ref '' = ground

export const ANALYSES: { kind: Analysis['kind']; title: string }[] = [
  { kind: 'tran', title: 'Transient' },
  { kind: 'ac', title: 'AC sweep' },
  { kind: 'dc', title: 'DC sweep' },
  { kind: 'noise', title: 'Noise' },
  { kind: 'op', title: 'Operating point' }
]

export function defaultAnalysis(kind: Analysis['kind']): Analysis {
  switch (kind) {
    case 'op': return { kind }
    case 'tran': return { kind, step: '10u', stop: '10m', start: '', maxStep: '', uic: false }
    case 'ac': return { kind, sweep: 'dec', points: '100', fstart: '1', fstop: '1meg' }
    case 'dc': return { kind, source: 'V1', start: '0', stop: '5', step: '0.1' }
    case 'noise': return { kind, output: 'out', ref: '', source: 'V1', sweep: 'dec', points: '100', fstart: '1', fstop: '1meg' }
  }
}

export function analysisText(a: Analysis): string {
  switch (a.kind) {
    case 'op': return '.op'
    case 'tran': {
      const t = ['.tran', a.step, a.stop]
      if (a.start || a.maxStep) t.push(a.start || '0') // tmax is positional: needs a tstart before it
      if (a.maxStep) t.push(a.maxStep)
      if (a.uic) t.push('uic')
      return t.join(' ')
    }
    case 'ac': return `.ac ${a.sweep} ${a.points} ${a.fstart} ${a.fstop}`
    case 'dc': return `.dc ${a.source} ${a.start} ${a.stop} ${a.step}`
    case 'noise': return `.noise v(${a.output}${a.ref ? ',' + a.ref : ''}) ${a.source} ${a.sweep} ${a.points} ${a.fstart} ${a.fstop}`
  }
}

const SWEEPS = ['dec', 'oct', 'lin']

export function parseAnalysis(text: string): Analysis | null {
  const s = text.trim()
  if (!s || s.includes('\n')) return null
  const t = s.replace(/\s*\(([^)]*)\)/g, (m) => m.replace(/\s+/g, '')).split(/\s+/) // "v( out , ref )" -> one token
  const kind = t[0].toLowerCase(), n = t.length
  const sweep = (x: string) => (SWEEPS.includes(x.toLowerCase()) ? (x.toLowerCase() as Sweep) : null)
  if (kind === '.op') return n === 1 ? { kind: 'op' } : null
  if (kind === '.tran') {
    const uic = n > 3 && t[n - 1].toLowerCase() === 'uic'
    const v = t.slice(1, uic ? -1 : undefined)
    if (v.length < 2 || v.length > 4) return null
    const maxStep = v[3] ?? ''
    // analysisText writes start '0' only as a placeholder for tmax, so read it back as omitted
    const start = maxStep && v[2] === '0' ? '' : (v[2] ?? '')
    return { kind: 'tran', step: v[0], stop: v[1], start, maxStep, uic }
  }
  if (kind === '.ac') {
    const sw = n === 5 && sweep(t[1])
    return sw ? { kind: 'ac', sweep: sw, points: t[2], fstart: t[3], fstop: t[4] } : null
  }
  if (kind === '.dc') return n === 5 ? { kind: 'dc', source: t[1], start: t[2], stop: t[3], step: t[4] } : null
  if (kind === '.noise') {
    const m = /^v\(([^,()]+)(?:,([^,()]+))?\)$/i.exec(t[1] ?? '')
    const sw = n === 7 && m && sweep(t[3])
    return sw ? { kind: 'noise', output: m![1], ref: m![2] ?? '', source: t[2], sweep: sw, points: t[4], fstart: t[5], fstop: t[6] } : null
  }
  return null
}

// ngspice number: optional sign, mantissa, exponent, scale suffix, then ignored unit letters ("10uF", "1kohm").
// {expr} parameter references are accepted too (used with .param / .step).
const NUM = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[afpnumkgt])?[a-z]*$/i
const SCALE: Record<string, number> = { a: 1e-18, f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, meg: 1e6, g: 1e9, t: 1e12, mil: 25.4e-6 }

export const isSpiceNumber = (s: string): boolean => NUM.test(s) || /^\{[^{}]+\}$/.test(s)

// numeric value of a SPICE number; NaN for anything else (including {expr})
export function spiceValue(s: string): number {
  const m = NUM.exec(s.trim())
  return m ? Number(m[1]) * (m[2] ? SCALE[m[2].toLowerCase()] : 1) : NaN
}

export function validate(a: Analysis): string[] {
  const e: string[] = []
  const num = (v: string, label: string, eg: string, optional = false) => {
    if (optional && !v.trim()) return true
    if (!v.trim()) return e.push(`${label} is required (e.g. ${eg})`), false
    if (!isSpiceNumber(v.trim())) return e.push(`${label} must be a number like ${eg}`), false
    return true
  }
  const val = (v: string) => spiceValue(v) // NaN for {expr}: comparisons below are then skipped
  const freqs = (x: { sweep: Sweep; points: string; fstart: string; fstop: string }) => {
    if (num(x.points, 'Points', '100')) {
      const p = val(x.points)
      if (!(Number.isInteger(p) && p >= 1) && !isNaN(p)) e.push(`Points must be a whole number of at least 1 (e.g. 100)`)
    }
    const okA = num(x.fstart, 'Start frequency', '1'), okB = num(x.fstop, 'Stop frequency', '1meg')
    if (okA && x.sweep !== 'lin' && val(x.fstart) <= 0) e.push('Start frequency must be above 0 for a dec/oct sweep')
    if (okA && okB && val(x.fstop) < val(x.fstart)) e.push('Stop frequency must not be below the start frequency')
  }
  switch (a.kind) {
    case 'tran': {
      const okS = num(a.step, 'Time step', '10u'), okT = num(a.stop, 'Stop time', '20m')
      const okB = num(a.start, 'Start time', '0', true), okM = num(a.maxStep, 'Max step', '1u', true)
      if (okS && val(a.step) <= 0) e.push('Time step must be above 0')
      if (okT && val(a.stop) <= 0) e.push('Stop time must be above 0')
      if (okB && okT && a.start.trim() && val(a.start) >= val(a.stop)) e.push('Start time must be before the stop time')
      if (okM && a.maxStep.trim() && val(a.maxStep) <= 0) e.push('Max step must be above 0')
      break
    }
    case 'ac': freqs(a); break
    case 'dc': {
      if (!a.source.trim()) e.push('Pick a source to sweep (e.g. V1)')
      num(a.start, 'Start value', '0'), num(a.stop, 'Stop value', '5')
      if (num(a.step, 'Increment', '0.1') && val(a.step) === 0) e.push('Increment must not be 0')
      break
    }
    case 'noise': {
      if (!a.output.trim()) e.push('Pick an output net (e.g. out)')
      if (!a.source.trim()) e.push('Pick an input source (e.g. V1)')
      freqs(a)
      break
    }
  }
  return e
}
