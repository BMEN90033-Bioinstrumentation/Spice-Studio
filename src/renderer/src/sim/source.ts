// Independent source values (V/I "DC 0 AC 1 0 PULSE(...)") <-> structured form for the waveform dialog. Pure TS.
// Anything parseSource can't fully account for returns null, so callers keep the raw text untouched.
import { isSpiceNumber, spiceValue } from './analysis.ts'

export type TranKind = 'pulse' | 'sin' | 'pwl' | 'exp' | 'sffm' | 'am' | 'none' | 'pwlfile' | 'wav' // file kinds: sim/filesrc.ts
export interface Source {
  dc: string; acMag: string; acPhase: string // '' = omitted
  tran: { kind: TranKind; args: string[]; r?: string; td?: string } // r/td: PWL repeat start / delay; pwlfile [path], wav [path, chan]
}

// positional argument names per function (ngspice-47 order; SFFM checked against a run: VO VA FC MDI FS)
export const FIELDS: Record<Exclude<TranKind, 'none' | 'pwl' | 'pwlfile' | 'wav'>, string[]> = {
  pulse: ['V1', 'V2', 'TD', 'TR', 'TF', 'PW', 'PER', 'NP'],
  sin: ['VO', 'VA', 'FREQ', 'TD', 'THETA', 'PHASE'],
  exp: ['V1', 'V2', 'TD1', 'TAU1', 'TD2', 'TAU2'],
  sffm: ['VO', 'VA', 'FC', 'MDI', 'FS'],
  am: ['VA', 'VO', 'MF', 'FC', 'TD', 'PHASEM', 'PHASEC']
}
const KINDS = ['pulse', 'sin', 'pwl', 'exp', 'sffm', 'am']

export function parseSource(text: string): Source | null {
  const s: Source = { dc: '', acMag: '', acPhase: '', tran: { kind: 'none', args: [] } }
  const t = text.trim(), re = /\s*(?:([a-z]+)\s*\(([^()]*)\)|((?:[^\s()"]|"[^"]*")+))/iy // file="a b.csv" is one token
  const toks: (string | { fn: string; args: string[] })[] = []
  while (re.lastIndex < t.length) {
    const m = re.exec(t)
    if (!m) return null
    toks.push(m[1] ? { fn: m[1].toLowerCase(), args: m[2].split(/[\s,]+/).filter(Boolean) } : m[3])
  }
  const num = (x: unknown): x is string => typeof x === 'string' && isSpiceNumber(x)
  let dc = false, ac = false
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i], kw = typeof k === 'string' ? k.toLowerCase() : ''
    if (typeof k !== 'string') {
      const n = k.args.length
      if (s.tran.kind !== 'none' || !KINDS.includes(k.fn) || !k.args.every(num)) return null
      const max = k.fn === 'pwl' ? Infinity : FIELDS[k.fn as keyof typeof FIELDS].length
      if (n < 2 || n > max || (k.fn === 'pwl' && n % 2)) return null
      s.tran = { kind: k.fn as TranKind, args: k.args }
      // PWL(...) r=… td=… (ngspice reads them after the closing paren)
      for (let m; k.fn === 'pwl' && typeof toks[i + 1] === 'string' && (m = /^(r|td)=(.+)$/i.exec(toks[i + 1] as string)); i++) {
        const key = m[1].toLowerCase() as 'r' | 'td'
        if (s.tran[key] != null || !isSpiceNumber(m[2])) return null
        s.tran[key] = m[2]
      }
    } else if (kw === 'pwl' || /^wavefile=/.test(kw)) { // PWL file="x.csv" | wavefile="x.wav" [chan=N]
      const f = kw === 'pwl' ? /^file=(?:"([^"]+)"|([^"]+))$/i.exec(String(toks[++i])) : /^wavefile=(?:"([^"]+)"|([^"]+))$/i.exec(k)
      if (!f || s.tran.kind !== 'none') return null
      s.tran = { kind: kw === 'pwl' ? 'pwlfile' : 'wav', args: [f[1] ?? f[2]] }
      const c = /^chan=(\d+)$/i.exec(String(toks[i + 1]))
      if (kw !== 'pwl') s.tran.args.push(c ? ((i += 1), c[1]) : '0')
    } else if (kw === 'dc' && !dc && num(toks[i + 1])) (s.dc = toks[++i] as string), (dc = true)
    else if (kw === 'ac' && !ac && num(toks[i + 1])) {
      ;(s.acMag = toks[++i] as string), (ac = true)
      if (num(toks[i + 1])) s.acPhase = toks[++i] as string
    } else if (i === 0 && num(k)) (s.dc = k), (dc = true) // bare leading value = DC
    else return null
  }
  return s
}

export function sourceText(s: Source): string {
  const out: string[] = [], k = s.tran.kind
  if (s.dc) out.push(s.acMag || k !== 'none' ? 'DC ' + s.dc : s.dc)
  if (s.acMag) out.push('AC ' + s.acMag + (s.acPhase ? ' ' + s.acPhase : ''))
  if (k === 'pwlfile') out.push(`PWL file="${s.tran.args[0]}"`)
  else if (k === 'wav') out.push(`wavefile="${s.tran.args[0]}" chan=${s.tran.args[1] ?? 0}`)
  else if (k !== 'none') {
    out.push(`${k.toUpperCase()}(${s.tran.args.join(' ')})`)
    if (k === 'pwl' && s.tran.r) out.push('r=' + s.tran.r)
    if (k === 'pwl' && s.tran.td) out.push('td=' + s.tran.td)
  }
  return out.join(' ')
}

// Transient value at time t, as ngspice-47's vsrc/isrc load computes it. ctx = the .tran step/stop that some defaults
// depend on. NaN when an argument isn't a plain number ({expr}) or the function isn't modelled (AM: ngspice-47's
// output doesn't follow its documented formula, so no preview rather than a wrong one).
export function evalTran(s: Source, t: number, ctx: { step: number; stop: number } = { step: 1e-6, stop: 1e-3 }): number {
  const a = s.tran.args.map(spiceValue), n = a.length
  const nz = (i: number, d: number) => (i < n && a[i] !== 0 ? a[i] : d) // ngspice: missing or 0 -> default
  const { step, stop } = ctx
  if (a.some(isNaN)) return NaN
  switch (s.tran.kind) {
    case 'none': return spiceValue(s.dc || '0')
    case 'pulse': {
      const [v1, v2] = a, td = n > 2 ? a[2] : 0, tr = nz(3, step), tf = nz(4, step), pw = nz(5, stop), per = nz(6, stop), np = n > 7 ? a[7] : 0
      let x = t - td
      if (x > per) {
        const k = Math.floor(x / per)
        if (np > 0 && k >= np) return v1
        x -= per * k
      }
      if (x <= 0 || x >= tr + pw + tf) return v1
      if (x >= tr && x <= tr + pw) return v2
      if (x < tr) return v1 + ((v2 - v1) * x) / tr
      return v2 + ((v1 - v2) * (x - tr - pw)) / tf
    }
    case 'sin': {
      const [vo, va] = a, f = nz(2, 1 / stop), td = n > 3 ? a[3] : 0, th = n > 4 ? a[4] : 0, ph = ((n > 5 ? a[5] : 0) * Math.PI) / 180
      const x = t - td
      return x <= 0 ? vo + va * Math.sin(ph) : vo + va * Math.sin(2 * Math.PI * f * x + ph) * Math.exp(-x * th)
    }
    case 'exp': {
      const [v1, v2] = a, td1 = nz(2, 0), tau1 = nz(3, step), td2 = nz(4, td1 + step), tau2 = nz(5, step)
      if (t <= td1) return v1
      const r = v1 + (v2 - v1) * (1 - Math.exp(-(t - td1) / tau1))
      return t <= td2 ? r : r + (v1 - v2) * (1 - Math.exp(-(t - td2) / tau2))
    }
    case 'sffm': {
      if (n > 5) return NaN
      const [vo, va] = a, fc = nz(2, 1 / stop), mdi = n > 3 ? a[3] : 0, fs = nz(4, 1 / stop)
      return vo + va * Math.sin(2 * Math.PI * fc * t + mdi * Math.sin(2 * Math.PI * fs * t))
    }
    case 'pwl': {
      const td = s.tran.td ? spiceValue(s.tran.td) : 0, r = s.tran.r != null ? spiceValue(s.tran.r) : NaN
      const T = a.filter((_, i) => i % 2 === 0), V = a.filter((_, i) => i % 2 === 1), last = T[T.length - 1]
      let x = t - td
      if (x >= last && r >= T[0] && r < last) x = r + ((x - r) % (last - r)) // r must be one of the time points (ngspice errors otherwise)
      if (x <= T[0]) return V[0]
      for (let i = 1; i < T.length; i++) if (x <= T[i]) return V[i - 1] + ((V[i] - V[i - 1]) * (x - T[i - 1])) / (T[i] - T[i - 1] || 1)
      return V[V.length - 1]
    }
    default: return NaN
  }
}

// a time span worth previewing: ~2 periods, the PWL span (2 repeats with r=), or a few time constants
export function previewSpan(s: Source): number {
  const a = s.tran.args.map(spiceValue), g = (i: number) => (a[i] > 0 ? a[i] : 0)
  let span = 0
  switch (s.tran.kind) {
    case 'pulse': span = g(2) + 2 * (g(6) || g(3) + g(4) + 2 * g(5)); break
    case 'sin': span = g(3) + 2 / (g(2) || 1); break
    case 'exp': span = Math.max(g(2) + 5 * g(3), g(4) + 5 * g(5)); break
    case 'sffm': span = 2 / (g(4) || g(2) || 1); break
    case 'pwl': {
      const last = a[a.length - 2], r = s.tran.r != null ? spiceValue(s.tran.r) : NaN
      span = (s.tran.td ? spiceValue(s.tran.td) : 0) + (r >= 0 && r < last ? last + (last - r) : last * 1.1)
    }
  }
  return isFinite(span) && span > 0 ? span : 1
}
