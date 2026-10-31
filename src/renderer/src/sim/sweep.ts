// LTspice-style .step param sweeps, run as one ngspice job per value combination. Pure TS.
import { spiceValue } from './analysis.ts'

export interface Step { param: string; values: number[] }
export interface SweepRun { label: string; netlist: string } // label like "R=1k" or "R=1k, C=10n"; '' when no .step

const MAX_RUNS = 50, MAX_STEPS = 3
const STEP = /^\s*\.step\b/i
const round = (v: number) => Number(v.toPrecision(12)) // kills 0.30000000000000004-style drift

export function parseSteps(netlist: string): { steps: Step[]; errors: string[] } {
  const steps: Step[] = [], errors: string[] = []
  for (const line of netlist.split('\n').filter((l) => STEP.test(l))) {
    const t = line.trim().split(/\s+/).slice(1)
    const mode = /^(dec|oct|lin)$/i.test(t[0] ?? '') ? t.shift()!.toLowerCase() : ''
    if (t[0]?.toLowerCase() !== 'param' || !t[1]) {
      errors.push(`${line.trim()}: only ".step param NAME …" is supported`)
      continue
    }
    const param = t[1], args = t.slice(2)
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
    steps.push({ param, values })
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

export function expandSweep(netlist: string): { runs: SweepRun[]; errors: string[] } {
  const { steps, errors } = parseSteps(netlist)
  if (errors.length) return { runs: [], errors }
  if (!steps.length) return { runs: [{ label: '', netlist }], errors }
  const total = steps.reduce((n, s) => n * s.values.length, 1)
  if (total > MAX_RUNS) return { runs: [], errors: [`.step sweep needs ${total} runs (max ${MAX_RUNS})`] }
  const base = netlist.split('\n').filter((l) => !STEP.test(l))
  let combos: number[][] = [[]]
  for (const s of steps) combos = combos.flatMap((c) => s.values.map((v) => [...c, v])) // first .step varies slowest
  const runs = combos.map((c) => ({
    label: c.map((v, i) => `${steps[i].param}=${eng(v)}`).join(', '),
    netlist: c.reduce((ls, v, i) => setParam(ls, steps[i].param, v), base).join('\n')
  }))
  return { runs, errors }
}
