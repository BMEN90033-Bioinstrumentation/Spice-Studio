// LTspice-style .step param / .step temp sweeps and .mc Monte Carlo, run as one ngspice job each. Pure TS.
import { spiceValue } from './analysis.ts'

export interface Step { param: string; values: number[]; temp?: true } // temp: `.step temp …` (param 'temp')
export interface SweepRun { label: string; netlist: string } // "R=1k", "R=1k, T=25", "run 3"; '' when no .step/.mc

const MAX_RUNS = 50, MAX_STEPS = 3, MAX_MC = 500
const STEP = /^\s*\.step\b/i, MC = /^\s*\.mc\b/i, TEMP = /^\s*\.temp\b/i
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
function setParam(lines: string[], name: string, value: number): string[] {
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
  if (lines.some((l) => STEP.test(l))) return bad('.mc cannot be combined with .step: use one or the other')
  if (!Number.isInteger(n) || n < 1 || n > MAX_MC) return bad(`${mc[0].trim()}: expected ".mc N" with N from 1 to ${MAX_MC}`)
  const base = lines.filter((l) => !MC.test(l))
  return {
    runs: Array.from({ length: n }, (_, k) => ({ label: `run ${k + 1}`, netlist: [base[0], `.options seed=${k + 1}`, ...base.slice(1)].join('\n') })),
    errors: []
  }
}

export function expandSweep(netlist: string): { runs: SweepRun[]; errors: string[] } {
  if (netlist.split('\n').some((l) => MC.test(l))) return monteCarlo(netlist)
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
