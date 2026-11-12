// Analysis directives (.op/.tran/.ac/.dc/.noise/.tf/.sens/.pz/.disto/.sp/.four) <-> structured form for the dialog. Pure TS.

export type Sweep = 'dec' | 'oct' | 'lin'
type Freqs = { sweep: Sweep; points: string; fstart: string; fstop: string }
// .tf / .sens output: v(output[,ref]) or, with current, i(output) where output is a V source
type OutVar = { current: boolean; output: string; ref: string }
export type Analysis =
  | { kind: 'op' }
  | { kind: 'tran'; step: string; stop: string; start: string; maxStep: string; uic: boolean } // '' = omitted
  | { kind: 'ac'; sweep: Sweep; points: string; fstart: string; fstop: string }
  | { kind: 'dc'; source: string; start: string; stop: string; step: string; source2: string; start2: string; stop2: string; step2: string } // source2 '' = no nested sweep
  | { kind: 'noise'; output: string; ref: string; source: string; sweep: Sweep; points: string; fstart: string; fstop: string } // output = net name, ref '' = ground
  | ({ kind: 'tf'; source: string } & OutVar)
  | ({ kind: 'sens'; ac: boolean } & OutVar & Freqs) // ac false: DC sensitivity (the sweep fields are kept for the form)
  | { kind: 'pz'; in1: string; in2: string; out1: string; out2: string; tf: 'vol' | 'cur'; find: 'pz' | 'pol' | 'zer' } // nodes, '0' = ground
  | ({ kind: 'disto'; f2: string } & Freqs) // f2 = f2overf1, '' = omitted
  | ({ kind: 'sp'; noise: boolean } & Freqs)
  | { kind: 'four'; freq: string; outputs: string[] } // outputs: vectors as typed, e.g. v(out)

export const ANALYSES: { kind: Analysis['kind']; title: string }[] = [
  { kind: 'tran', title: 'Transient' },
  { kind: 'ac', title: 'AC sweep' },
  { kind: 'dc', title: 'DC sweep' },
  { kind: 'noise', title: 'Noise' },
  { kind: 'op', title: 'Operating point' },
  { kind: 'tf', title: 'Transfer function' },
  { kind: 'sens', title: 'Sensitivity' },
  { kind: 'pz', title: 'Pole-zero' },
  { kind: 'disto', title: 'Distortion' },
  { kind: 'sp', title: 'S-parameters' },
  { kind: 'four', title: 'Fourier (THD)' }
]

const FREQS: Freqs = { sweep: 'dec', points: '100', fstart: '1', fstop: '1meg' }
export function defaultAnalysis(kind: Analysis['kind']): Analysis {
  switch (kind) {
    case 'op': return { kind }
    case 'tran': return { kind, step: '10u', stop: '10m', start: '', maxStep: '', uic: false }
    case 'ac': return { kind, ...FREQS }
    case 'dc': return { kind, source: 'V1', start: '0', stop: '5', step: '0.1', source2: '', start2: '', stop2: '', step2: '' }
    case 'noise': return { kind, output: 'out', ref: '', source: 'V1', ...FREQS }
    case 'tf': return { kind, current: false, output: 'out', ref: '', source: 'V1' }
    case 'sens': return { kind, current: false, output: 'out', ref: '', ac: false, ...FREQS, points: '10' }
    case 'pz': return { kind, in1: 'in', in2: '0', out1: 'out', out2: '0', tf: 'vol', find: 'pz' }
    case 'disto': return { kind, ...FREQS, points: '10', fstart: '100', f2: '' }
    case 'sp': return { kind, ...FREQS, points: '20', fstart: '1meg', fstop: '1g', noise: false }
    case 'four': return { kind, freq: '1k', outputs: ['v(out)'] }
  }
}

const outVar = (a: OutVar) => (a.current ? `i(${a.output})` : `v(${a.output}${a.ref ? ',' + a.ref : ''})`)
const freqs = (a: Freqs) => `${a.sweep} ${a.points} ${a.fstart} ${a.fstop}`

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
    case 'ac': return `.ac ${freqs(a)}`
    case 'dc': return `.dc ${a.source} ${a.start} ${a.stop} ${a.step}` + (a.source2 ? ` ${a.source2} ${a.start2} ${a.stop2} ${a.step2}` : '')
    case 'noise': return `.noise v(${a.output}${a.ref ? ',' + a.ref : ''}) ${a.source} ${freqs(a)}`
    case 'tf': return `.tf ${outVar(a)} ${a.source}`
    case 'sens': return `.sens ${outVar(a)}` + (a.ac ? ` ac ${freqs(a)}` : '')
    case 'pz': return `.pz ${a.in1} ${a.in2} ${a.out1} ${a.out2} ${a.tf} ${a.find}`
    case 'disto': return `.disto ${freqs(a)}` + (a.f2 ? ' ' + a.f2 : '')
    case 'sp': return `.sp ${freqs(a)}` + (a.noise ? ' 1' : '')
    case 'four': return ['.four', a.freq, ...a.outputs].join(' ')
  }
}

const SWEEPS = ['dec', 'oct', 'lin']

const BRACES = /\{[^{}]*\}/g, squash = (m: string) => m.replace(/\s+/g, '')
export function parseAnalysis(text: string): Analysis | null {
  const s = text.trim()
  if (!s || s.includes('\n')) return null
  const t = s.replace(BRACES, squash).replace(/\s*\(([^)]*)\)/g, squash).split(/\s+/) // "v( out , ref )", "{ a * 2 }" -> one token
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
  // freqs at t[i..i+3]
  const fq = (i: number): Freqs | null => {
    const sw = sweep(t[i] ?? '')
    return sw && n >= i + 4 ? { sweep: sw, points: t[i + 1], fstart: t[i + 2], fstop: t[i + 3] } : null
  }
  const out = (x = ''): OutVar | null => {
    const v = /^v\(([^,()]+)(?:,([^,()]+))?\)$/i.exec(x), i = /^i\(([^,()]+)\)$/i.exec(x)
    return v ? { current: false, output: v[1], ref: v[2] ?? '' } : i ? { current: true, output: i[1], ref: '' } : null
  }
  if (kind === '.ac') {
    const f = n === 5 && fq(1)
    return f ? { kind: 'ac', ...f } : null
  }
  if (kind === '.dc') {
    const [, source, start, stop, step, source2 = '', start2 = '', stop2 = '', step2 = ''] = t
    return n === 5 || n === 9 ? { kind: 'dc', source, start, stop, step, source2, start2, stop2, step2 } : null
  }
  if (kind === '.noise') {
    const m = /^v\(([^,()]+)(?:,([^,()]+))?\)$/i.exec(t[1] ?? '')
    const f = n === 7 && m && fq(3)
    return f ? { kind: 'noise', output: m![1], ref: m![2] ?? '', source: t[2], ...f } : null
  }
  if (kind === '.tf') {
    const o = n === 3 && out(t[1])
    return o ? { kind: 'tf', ...o, source: t[2] } : null
  }
  if (kind === '.sens') {
    const o = out(t[1]), f = n === 7 && t[2].toLowerCase() === 'ac' && fq(3)
    if (o && n === 2) return { ...(defaultAnalysis('sens') as Extract<Analysis, { kind: 'sens' }>), ...o }
    return o && f ? { kind: 'sens', ...o, ac: true, ...f } : null
  }
  if (kind === '.pz') {
    const [tf, find] = [t[5]?.toLowerCase(), t[6]?.toLowerCase()]
    return n === 7 && (tf === 'vol' || tf === 'cur') && (find === 'pz' || find === 'pol' || find === 'zer')
      ? { kind: 'pz', in1: t[1], in2: t[2], out1: t[3], out2: t[4], tf, find } : null
  }
  if (kind === '.disto') {
    const f = (n === 5 || n === 6) && fq(1)
    return f ? { kind: 'disto', ...f, f2: t[5] ?? '' } : null
  }
  if (kind === '.sp') {
    const f = (n === 5 || (n === 6 && /^[01]$/.test(t[5]))) && fq(1)
    return f ? { kind: 'sp', ...f, noise: t[5] === '1' } : null
  }
  if (kind === '.four' || kind === '.fourier') return n >= 3 ? { kind: 'four', freq: t[1], outputs: t.slice(2) } : null
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

// ctx.tran: whether the sheet has a .tran (.four needs one); undefined = unknown
export function validate(a: Analysis, ctx: { tran?: boolean } = {}): string[] {
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
      if (!a.source2.trim()) break
      if (a.source2.trim().toLowerCase() === a.source.trim().toLowerCase()) e.push('The second source must not be the swept source')
      num(a.start2, 'Second start', '0'), num(a.stop2, 'Second stop', '5')
      if (num(a.step2, 'Second increment', '1') && val(a.step2) === 0) e.push('Second increment must not be 0')
      break
    }
    case 'noise': {
      if (!a.output.trim()) e.push('Pick an output net (e.g. out)')
      if (!a.source.trim()) e.push('Pick an input source (e.g. V1)')
      freqs(a)
      break
    }
    case 'tf':
    case 'sens': {
      if (!a.output.trim()) e.push(a.current ? 'Pick a voltage source to measure the current through (e.g. V1)' : 'Pick an output net (e.g. out)')
      if (!a.current && a.ref.trim() && a.ref.trim() === a.output.trim()) e.push('The reference node must differ from the output node')
      if (a.kind === 'tf' && !a.source.trim()) e.push('Pick an input source (e.g. V1)')
      if (a.kind === 'sens' && a.ac) freqs(a)
      break
    }
    case 'pz': {
      if (!a.in1.trim() || !a.out1.trim()) e.push('Pick the input and output nodes (e.g. in, out)')
      if (a.in1.trim() === a.in2.trim()) e.push('The two input nodes must differ')
      if (a.out1.trim() === a.out2.trim()) e.push('The two output nodes must differ')
      break
    }
    case 'disto': {
      freqs(a)
      if (num(a.f2, 'F2/F1 ratio', '0.9', true) && a.f2.trim() && !(val(a.f2) > 0 && val(a.f2) < 1)) e.push('F2/F1 ratio must be between 0 and 1 (e.g. 0.9)')
      break
    }
    case 'sp': freqs(a); break
    case 'four': {
      // the Fourier pass runs .four as a `fourier` command, where {param} braces are not expanded
      if (num(a.freq, 'Fundamental frequency', '1k') && a.freq.includes('{')) e.push('Fundamental frequency must be a plain number like 1k, not a {parameter}')
      else if (val(a.freq) <= 0) e.push('Fundamental frequency must be above 0')
      if (!a.outputs.length) e.push('Pick at least one output (e.g. v(out))')
      if (ctx.tran === false) e.push('Add a .tran analysis as well: Fourier analysis works on its result')
      break
    }
  }
  return e
}

// ---- .options line <-> form. Known keys get fields; every other token is kept verbatim in `extra`. ----
export const OPTION_FIELDS: { key: string; label: string; unit: string; ph: string; help: string; int?: boolean }[] = [
  { key: 'reltol', label: 'Relative tolerance', unit: '', ph: '1e-3', help: 'reltol: looser (3e-3) is faster and converges more easily' },
  { key: 'abstol', label: 'Current tolerance', unit: 'A', ph: '1e-12', help: 'abstol' },
  { key: 'vntol', label: 'Voltage tolerance', unit: 'V', ph: '1e-6', help: 'vntol' },
  { key: 'gmin', label: 'Minimum conductance', unit: 'S', ph: '1e-12', help: 'gmin: added across every junction' },
  { key: 'itl1', label: 'DC iteration limit', unit: '', ph: '100', help: 'itl1', int: true },
  { key: 'itl4', label: 'Transient iteration limit', unit: '', ph: '10', help: 'itl4: per time step', int: true },
  { key: 'temp', label: 'Temperature', unit: '°C', ph: '27', help: 'temp: circuit temperature' },
  { key: 'tnom', label: 'Nominal temperature', unit: '°C', ph: '27', help: 'tnom: temperature the models were measured at' }
]
export type Method = '' | 'trap' | 'gear'
export type Options = Record<string, string> & { method: Method; extra: string } // '' = not set (ngspice default)

const OPT = /^\s*\.opt(?:ions?)?(?=\s|$)/i
export const isOptionsLine = (line: string) => OPT.test(line)
// "a = 1 b=2 flag" -> [['a','a=1'], ['b','b=2'], ['flag','flag']]
const optTokens = (s: string): [string, string][] =>
  s.replace(OPT, '').replace(/\s*=\s*/g, '=').trim().split(/\s+/).filter(Boolean).map((t) => [t.split('=')[0].toLowerCase(), t])

export const emptyOptions = (): Options => ({ ...Object.fromEntries(OPTION_FIELDS.map((f) => [f.key, ''])), method: '', extra: '' }) as Options

export function parseOptions(text: string): Options | null {
  if (text.includes('\n') || !isOptionsLine(text)) return null
  const o = emptyOptions(), extra: string[] = []
  for (const [k, t] of optTokens(text)) {
    const v = t.slice(k.length + 1)
    if (OPTION_FIELDS.some((f) => f.key === k) && v && !o[k]) o[k] = v
    else if (k === 'method' && /^(trap|gear)$/i.test(v) && !o.method) o.method = v.toLowerCase() as Method
    else extra.push(t)
  }
  o.extra = extra.join(' ')
  return o
}

export function optionsText(o: Options): string {
  const kv = [...OPTION_FIELDS.map((f) => f.key), 'method'].filter((k) => o[k]?.trim()).map((k) => `${k}=${o[k].trim()}`)
  return ['.options', ...kv, ...(o.extra.trim() ? [o.extra.trim().replace(/\s+/g, ' ')] : [])].join(' ')
}

// merge the options in `add` into the .options line `base`, key by key (add wins); base '' = start fresh
export function mergeOptions(base: string, add: string): string {
  const out = optTokens(base)
  for (const [k, t] of optTokens(add)) {
    const i = out.findIndex(([q]) => q === k)
    if (i < 0) out.push([k, t])
    else out[i] = [k, t]
  }
  return ['.options', ...out.map(([, t]) => t)].join(' ')
}

export function validateOptions(o: Options): string[] {
  const e: string[] = []
  for (const f of OPTION_FIELDS) {
    const v = o[f.key].trim()
    if (!v) continue
    if (!isSpiceNumber(v)) e.push(`${f.label} must be a number like ${f.ph}`)
    else if (f.int && !(Number.isInteger(spiceValue(v)) && spiceValue(v) >= 1)) e.push(`${f.label} must be a whole number like ${f.ph}`)
    else if (f.key !== 'temp' && f.key !== 'tnom' && spiceValue(v) <= 0) e.push(`${f.label} must be above 0`)
  }
  return e
}

// ---- .ic / .nodeset line <-> net + value rows. Tokens other than v(net)=value are kept verbatim in `extra`. ----
export type SetupKind = 'options' | 'ic' | 'nodeset'
export type NodeVals = { rows: { net: string; value: string }[]; extra: string }
const IC = /^\s*\.(ic|nodeset)(?=\s|$)/i
// which setup directive a line is (.options/.option/.opt, .ic, .nodeset), else null
export const setupKind = (line: string): SetupKind | null =>
  isOptionsLine(line) ? 'options' : (IC.exec(line)?.[1].toLowerCase() as SetupKind | undefined) ?? null

export function parseNodeVals(text: string): NodeVals | null {
  if (text.includes('\n') || !IC.test(text)) return null
  const nv: NodeVals = { rows: [], extra: '' }, extra: string[] = []
  // "v( a ) = 1" -> "v(a)=1"
  for (const t of text.replace(IC, '').replace(BRACES, squash).replace(/\s*=\s*/g, '=').replace(/\(\s*([^()]*?)\s*\)/g, '($1)').trim().split(/\s+/).filter(Boolean)) {
    const m = /^v\(([^,()]+)\)=(\S+)$/i.exec(t)
    if (m) nv.rows.push({ net: m[1], value: m[2] })
    else extra.push(t)
  }
  nv.extra = extra.join(' ')
  return nv
}

export const nodeValsText = (kind: 'ic' | 'nodeset', nv: NodeVals): string =>
  [`.${kind}`, ...nv.rows.map((r) => `v(${r.net.trim()})=${r.value.trim()}`), ...(nv.extra.trim() ? [nv.extra.trim().replace(/\s+/g, ' ')] : [])].join(' ')

export function validateNodeVals(nv: NodeVals): string[] {
  const e: string[] = [], seen = new Set<string>()
  if (!nv.rows.length && !nv.extra.trim()) e.push('Add at least one net')
  for (const r of nv.rows) {
    const net = r.net.trim()
    if (!net) e.push('Pick a net for every row')
    else if (seen.has(net.toLowerCase())) e.push(`v(${net}) is set twice`)
    else if (!isSpiceNumber(r.value.trim())) e.push(`v(${net}) needs a value like 0 or 2.5`)
    seen.add(net.toLowerCase())
  }
  return e
}

// `.plot tran v(out) i(r1)` lines -> one stacked chart pane each on that analysis's results tab. ngspice ignores .plot
// when it writes a rawfile, so they only steer the results panel. Entries are raw vector names, else Plot expressions
// ('=' + text: v(a,b), I(D1), maths); no spaces inside an entry, as in SPICE. An inline comment titles the chart:
// `.plot tran v(ecg) ; Amplified ECG`.
const PLOT_OF: Record<string, RegExp> = {
  tran: /^transient/i, ac: /^ac\b/i, dc: /^dc\b/i, noise: /^noise/i, op: /^operating/i,
  tf: /^transfer function/i, sens: /^sensitivity/i, pz: /^pole-zero/i, disto: /^distortion/i, sp: /^sp analysis/i
}
export function plotPanes(text: string, plotname: string, vars: string[]): { title: string; sel: string[] }[] {
  const has = new Set(vars.map((v) => v.toLowerCase()))
  return [...text.matchAll(/^[ \t]*\.plot[ \t]+(\w+)[ \t]+(.*\S)/gim)]
    .filter((m) => PLOT_OF[m[1].toLowerCase()]?.test(plotname))
    .map((m) => {
      const [v, ...t] = m[2].split(';')
      return { title: t.join(';').trim(), sel: v.trim().split(/\s+/).filter(Boolean).map((x) => (has.has(x.toLowerCase()) ? x.toLowerCase() : '=' + x)) }
    })
}

// where the deck first asks for a plot's analysis, so result tabs follow the directive order rather than ngspice's
// (it writes AC before transient); plots of other analyses sort last
export function analysisPos(text: string, plotname: string): number {
  const k = Object.keys(PLOT_OF).find((a) => PLOT_OF[a].test(plotname))
  const m = k ? new RegExp(`^[ \\t]*\\.${k}\\b`, 'im').exec(text) : null
  return m ? m.index : Number.MAX_SAFE_INTEGER
}
