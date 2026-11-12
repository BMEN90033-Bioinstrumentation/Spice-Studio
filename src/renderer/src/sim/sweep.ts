// LTspice-style .step param / .step temp sweeps, .mc Monte Carlo and .wc worst case, run as one ngspice job each. Pure TS.
import { spiceValue } from './analysis.ts'
import { parseMeas } from './meas.ts'

export interface Step { param: string; values: number[]; temp?: true } // temp: `.step temp …` (param 'temp')
export interface SweepRun { label: string; netlist: string } // "R=1k", "R=1k, T=25", "run 3", "R+ C−"; '' when no .step/.mc/.wc
// note: a line for the log (.wc says what it ran); observe: called with each finished run's log, in order (.wc's
// sensitivity fallback picks its last corners from the earlier runs' .meas results, so those runs' fields are getters)
export interface Sweep { runs: SweepRun[]; errors: string[]; note?: string; observe?: (log: string) => void }

const MAX_RUNS = 50, MAX_STEPS = 3, MAX_MC = 500
export const MAX_WC = 8 // .wc runs all 2^n corners up to n = 8 toleranced values (256 corners), else the sensitivity fallback
const STEP = /^\s*\.step\b/i, MC = /^\s*\.mc\b/i, TEMP = /^\s*\.temp\b/i, WC = /^\s*\.wc\b/i
const round = (v: number) => Number(v.toPrecision(12)) // kills 0.30000000000000004-style drift

export function parseSteps(netlist: string): { steps: Step[]; errors: string[] } {
  const steps: Step[] = [], errors: string[] = []
  for (const line of netlist.split('\n').filter((l) => STEP.test(l))) {
    const t = line.trim().split(/\s+/).slice(1)
    const mode = /^(dec|oct|lin)$/i.test(t[0] ?? '') ? t.shift()!.toLowerCase() : ''
    const temp = t[0]?.toLowerCase() === 'temp'
    if (!temp && (t[0]?.toLowerCase() !== 'param' || !t[1])) {
      errors.push(`${line.trim()}: only ".step param NAME …" and ".step temp …" are supported`)
      continue
    }
    const param = temp ? 'temp' : t[1], args = t.slice(temp ? 1 : 2)
    const fail = (why: string) => errors.push(`${line.trim()}: ${why}`)
    if (steps.some((s) => s.param.toLowerCase() === param.toLowerCase())) {
      fail(`${param} is already stepped`)
      continue
    }
    let values: number[] = []
    if (args[0]?.toLowerCase() === 'list') {
      if (mode) { fail('list cannot be combined with dec/oct/lin'); continue }
      values = args.slice(1).map(spiceValue)
      if (!values.length || values.some(isNaN)) { fail('list needs numbers, e.g. "list 1k 2k 5k"'); continue }
    } else {
      const [a, b, c] = args.map(spiceValue)
      if (args.length !== 3 || [a, b, c].some(isNaN)) { fail('expected start stop increment (numbers)'); continue }
      if (mode === 'dec' || mode === 'oct') {
        if (!(a > 0 && b >= a && c >= 1)) { fail(`${mode} needs 0 < start <= stop and points >= 1`); continue }
        // points per decade/octave; stop included when within 1e-9 relative
        const count = Math.floor(Math.log(b / a) / Math.log(mode === 'dec' ? 10 : 2) * c + 1e-9) + 1
        if (count > MAX_RUNS) { fail(`${count} values (max ${MAX_RUNS})`); continue }
        values = Array.from({ length: count }, (_, i) => round(a * (mode === 'dec' ? 10 : 2) ** (i / c)))
      } else {
        if (c === 0 || (b - a) / c < 0) { fail('increment must be non-zero and point from start towards stop'); continue }
        const count = Math.floor((b - a) / c + 1e-9) + 1
        if (count > MAX_RUNS) { fail(`${count} values (max ${MAX_RUNS})`); continue }
        values = Array.from({ length: count }, (_, i) => round(a + i * c))
      }
    }
    steps.push(temp ? { param, values, temp } : { param, values })
  }
  if (steps.length > MAX_STEPS) errors.push(`At most ${MAX_STEPS} nested .step sweeps are supported (found ${steps.length})`)
  return { steps, errors }
}

const SUFFIX: [number, string][] = [[1e12, 't'], [1e9, 'g'], [1e6, 'meg'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']]
export function eng(v: number): string {
  if (v === 0 || !isFinite(v)) return String(v)
  const [s, x] = SUFFIX.find(([s]) => Math.abs(v) >= s * (1 - 1e-12)) ?? SUFFIX[SUFFIX.length - 1]
  return Number((v / s).toPrecision(6)) + x
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ngspice: a later `.param X=` overrides an earlier one (checked on ngspice-47), so editing every existing
// assignment in place keeps dependent params ({2*X}) consistent; otherwise a new .param goes before .end.
export function setParam(lines: string[], name: string, value: number): string[] {
  const re = new RegExp(`(^|[\\s,])(${esc(name)})(\\s*=\\s*)(\\{[^}]*\\}|'[^']*'|[^\\s,]+)`, 'gi')
  let hit = false
  const out = lines.map((l) => (/^\s*\.param\b/i.test(l) ? l.replace(re, (_, pre, n, eq) => ((hit = true), `${pre}${n}${eq}${value}`)) : l))
  if (hit) return out
  const end = out.findLastIndex((l) => /^\s*\.end\s*$/i.test(l))
  out.splice(end < 0 ? out.length : end, 0, `.param ${name}=${value}`)
  return out
}

// .step temp: one `.temp X` before .end replaces any .temp lines (checked on ngspice-47: .temp and .options temp= both
// work, and .temp beats .options temp)
function setTemp(lines: string[], value: number): string[] {
  const out = lines.filter((l) => !TEMP.test(l)), end = out.findLastIndex((l) => /^\s*\.end\s*$/i.test(l))
  out.splice(end < 0 ? out.length : end, 0, `.temp ${value}`)
  return out
}

// .mc N: an app directive. Run k gets `.options seed=k` right after the title: on ngspice-47 -b that reseeds
// agauss/aunif/gauss/unif reproducibly, and the first seed= in a deck wins (so ours beats one the user wrote).
function monteCarlo(netlist: string): { runs: SweepRun[]; errors: string[] } {
  const lines = netlist.split('\n'), mc = lines.filter((l) => MC.test(l))
  const n = Number(mc[0].trim().split(/\s+/)[1])
  const bad = (e: string) => ({ runs: [], errors: [e] })
  if (mc.length > 1) return bad('Only one .mc line is allowed')
  // ponytail: .mc with .step would need a seed per (combination, run); reject until someone asks
  if (lines.some((l) => STEP.test(l) || WC.test(l))) return bad('.mc cannot be combined with .step or .wc: use one of them')
  if (!Number.isInteger(n) || n < 1 || n > MAX_MC) return bad(`${mc[0].trim()}: expected ".mc N" with N from 1 to ${MAX_MC}`)
  const base = lines.filter((l) => !MC.test(l))
  return {
    runs: Array.from({ length: n }, (_, k) => ({ label: `run ${k + 1}`, netlist: [base[0], `.options seed=${k + 1}`, ...base.slice(1)].join('\n') })),
    errors: []
  }
}

// Tolerances, written as for .mc: gauss(nom, rel, sigma) / unif(nom, rel) vary by ±rel·nom at their limit,
// agauss(nom, abs, sigma) / aunif(nom, abs) / limit(nom, abs) by ±abs. Each call in the deck is one toleranced value,
// named after its .param (R), its element (R1) or its .model parameter (QN.BF).
export type Tol = { name: string; line: number; start: number; end: number; nom: string; dev: string; rel: boolean }
export function tolerances(lines: string[]): Tol[] {
  const out: Tol[] = [], FN = /\b(agauss|gauss|aunif|unif|limit)\s*\(/gi
  lines.forEach((l, line) => {
    if (/^\s*\*/.test(l)) return
    for (const m of l.matchAll(FN)) {
      const args: string[] = []
      let d = 0, a = m.index + m[0].length, end = -1
      for (let i = a; i < l.length && end < 0; i++) {
        if (l[i] === '(') d++
        else if (l[i] === ')' && d-- === 0) args.push(l.slice(a, i)), (end = i + 1)
        else if (l[i] === ',' && !d) args.push(l.slice(a, i)), (a = i + 1)
      }
      if (end < 0 || args.length < 2) continue
      const pre = l.slice(0, m.index), first = l.trim().split(/\s+/)
      const assigned = /([a-z_]\w*)\s*=[^=]*$/i.exec(pre)?.[1]
      let name = !/^\s*\./.test(l) ? first[0] : /^\.model$/i.test(first[0]) && assigned ? `${first[1]}.${assigned}` : (assigned ?? `tol${out.length + 1}`)
      if (out.some((t) => t.name === name)) name += `#${out.length + 1}`
      out.push({ name, line, start: m.index, end, nom: args[0].trim(), dev: args[1].trim(), rel: !/^(agauss|aunif|limit)$/i.test(m[1]) })
    }
  })
  return out
}
// the deck with every tolerance at sign -1 (low limit), 0 (nominal) or +1 (high limit), as expressions ngspice evaluates
export function atCorner(lines: string[], tols: Tol[], signs: number[]): string[] {
  const out = [...lines]
  tols.map((t, j) => [t, signs[j]] as const).sort(([a], [b]) => b.line - a.line || b.start - a.start).forEach(([t, s]) => {
    const v = !s ? `(${t.nom})` : t.rel ? `((${t.nom})*(1${s < 0 ? '-' : '+'}(${t.dev})))` : `((${t.nom})${s < 0 ? '-' : '+'}(${t.dev}))`
    out[t.line] = out[t.line].slice(0, t.start) + v + out[t.line].slice(t.end)
  })
  return out
}

// .wc [meas …]: worst case over the tolerances. Up to MAX_WC values: the nominal circuit, then all 2^n corners. Above
// that, extreme-value selection by sensitivity: nominal, each value alone at its high limit, then per measurement (the
// named ones, else every .meas) the corner that maximises it and the one that minimises it, assuming each measurement
// is monotonic in each value.
function worstCase(netlist: string): Sweep {
  const lines = netlist.split('\n'), wc = lines.filter((l) => WC.test(l))
  const bad = (e: string) => ({ runs: [], errors: [e] })
  if (wc.length > 1) return bad('Only one .wc line is allowed')
  if (lines.some((l) => STEP.test(l))) return bad('.wc cannot be combined with .step: use one or the other')
  const base = lines.filter((l) => !WC.test(l)), tols = tolerances(base), n = tols.length
  if (!n) return bad('.wc: no toleranced values. Write them as for .mc, e.g. .param R={gauss(1k,0.05,3)} or R1 a b {unif(1k,0.01)}')
  const at = (signs: number[]) => atCorner(base, tols, signs).join('\n')
  const label = (signs: number[]) => tols.map((t, j) => t.name + (signs[j] > 0 ? '+' : '−')).join(' ')
  const nominal = { label: 'nominal', netlist: at(tols.map(() => 0)) }, names = tols.map((t) => t.name).join(', ')
  if (n <= MAX_WC) {
    const corners = Array.from({ length: 2 ** n }, (_, k) => tols.map((_, j) => ((k >> j) & 1 ? 1 : -1)))
    return { runs: [nominal, ...corners.map((s) => ({ label: label(s), netlist: at(s) }))], errors: [], note: `Worst case: ${n} toleranced value${n > 1 ? 's' : ''} (${names}): the nominal circuit and all ${2 ** n} corners` }
  }
  const named = wc[0].trim().split(/\s+/).slice(1).map((m) => m.toLowerCase())
  const meas = named.length ? named : base.flatMap((l) => (/^\s*\.meas(ure)?\s/i.test(l) ? [l.trim().split(/\s+/)[2]?.toLowerCase()].filter(Boolean) : []))
  if (!meas.length) return bad(`.wc: ${n} toleranced values need ${2 ** n} corners (more than ${2 ** MAX_WC}). Add a .meas line: the app then picks each measurement's worst corners from its sensitivity to each value`)
  const logs: string[] = [], val = (run: number, m: string) => parseMeas(logs[run] ?? '').find((x) => x.name === m)?.value ?? null
  // +1: this value at its high limit raises measurement m (from the sensitivity runs; 0 change or a failed .meas counts as +1)
  const dir = (m: string) => tols.map((_, j) => { const a = val(0, m), b = val(1 + j, m); return a != null && b != null && b < a ? -1 : 1 })
  const pick = (m: string, s: 1 | -1) => ({ get label() { return `${s > 0 ? 'max' : 'min'} ${m}: ${label(dir(m).map((d) => d * s))}` }, get netlist() { return at(dir(m).map((d) => d * s)) } })
  return {
    runs: [nominal, ...tols.map((t, j) => ({ label: `${t.name}+ alone`, netlist: at(tols.map((_, k) => +(k === j))) })), ...meas.flatMap((m) => [pick(m, 1), pick(m, -1)])],
    errors: [],
    note: `Worst case: ${n} toleranced values (${names}) would need ${2 ** n} corners (more than ${2 ** MAX_WC}), so they are estimated from sensitivities: the nominal circuit, each value alone at its high limit, then for ${meas.join(', ')} the corner that maximises and the one that minimises it. This assumes each measurement changes monotonically with each value.`,
    observe: (log) => void logs.push(log)
  }
}

export function expandSweep(netlist: string): Sweep {
  if (netlist.split('\n').some((l) => MC.test(l))) return monteCarlo(netlist)
  if (netlist.split('\n').some((l) => WC.test(l))) return worstCase(netlist)
  const { steps, errors } = parseSteps(netlist)
  if (errors.length) return { runs: [], errors }
  if (!steps.length) return { runs: [{ label: '', netlist }], errors }
  const total = steps.reduce((n, s) => n * s.values.length, 1)
  if (total > MAX_RUNS) return { runs: [], errors: [`.step sweep needs ${total} runs (max ${MAX_RUNS})`] }
  const base = netlist.split('\n').filter((l) => !STEP.test(l))
  let combos: number[][] = [[]]
  for (const s of steps) combos = combos.flatMap((c) => s.values.map((v) => [...c, v])) // first .step varies slowest
  const runs = combos.map((c) => ({
    label: c.map((v, i) => (steps[i].temp ? `T=${v}` : `${steps[i].param}=${eng(v)}`)).join(', '),
    netlist: c.reduce((ls, v, i) => (steps[i].temp ? setTemp(ls, v) : setParam(ls, steps[i].param, v)), base).join('\n')
  }))
  return { runs, errors }
}
