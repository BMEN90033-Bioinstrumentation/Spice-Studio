// Live tuning (plot/Tune.tsx): the values a slider can drive and the netlist with the sliders' values applied. Pure TS.
import { spiceValue } from './analysis.ts'
import { eng, setParam } from './sweep.ts'

// kind 'param': a .param with a plain number; 'part': a top-level R/C/L whose value is a plain number
export type Knob = { kind: 'param' | 'part'; name: string; value: number }

// lines outside .subckt … .ends (a part ref or .param inside a subckt is local to it)
const top = (lines: string[]) => {
  let d = 0
  return lines.map((l) => (/^\s*\.subckt\b/i.test(l) ? (d++, false) : /^\s*\.ends\b/i.test(l) ? (d = Math.max(0, d - 1), false) : !d))
}
const num = (s: string) => spiceValue(s.replace(/^\{\s*([^{}]*?)\s*\}$/, '$1')) // 1k, {1k}

export function knobs(netlist: string): Knob[] {
  const lines = netlist.split('\n'), ok = top(lines), out: Knob[] = []
  const add = (k: Knob) => !out.some((o) => o.kind === k.kind && o.name.toLowerCase() === k.name.toLowerCase()) && out.push(k)
  lines.forEach((l, i) => {
    if (!ok[i]) return
    if (/^\s*\.param\b/i.test(l)) {
      for (const m of l.matchAll(/([a-z_]\w*)\s*=\s*(\{[^}]*\}|'[^']*'|[^\s,]+)/gi)) if (!isNaN(num(m[2]))) add({ kind: 'param', name: m[1], value: num(m[2]) })
    } else {
      const t = l.trim().split(/\s+/)
      if (/^[rcl]/i.test(t[0]) && t.length >= 4 && !isNaN(num(t[3]))) add({ kind: 'part', name: t[0], value: num(t[3]) })
    }
  })
  return out
}

export function withKnobs(netlist: string, ks: Knob[]): string {
  let lines = netlist.split('\n')
  for (const k of ks) {
    if (k.kind === 'param') lines = setParam(lines, k.name, k.value)
    else {
      const ok = top(lines)
      lines = lines.map((l, i) => {
        const t = l.trim().split(/\s+/)
        return ok[i] && t[0].toLowerCase() === k.name.toLowerCase() && t.length >= 4 ? [...t.slice(0, 3), String(k.value), ...t.slice(4)].join(' ') : l
      })
    }
  }
  return lines.join('\n')
}

// .step params, from the run labels expandSweep gives ("R=1k, T=25"): lowercase names
export const steppedNames = (labels: string[]) => [...new Set(labels.flatMap((l) => l.split(', ').flatMap((p) => /^([^=\s]+)=/.exec(p)?.[1].toLowerCase() ?? [])))]

// for the run log: "Tuned: R=2.2k, C1=10n"
export const tunedNote = (ks: Knob[]) => `Tuned: ${ks.map((k) => `${k.name}=${eng(k.value)}`).join(', ')}`

// slider position 0…1 <-> value, linear or logarithmic between min and max (log needs 0 < min < max)
export const STEPS = 1000
export const toValue = (p: number, min: number, max: number, log: boolean) => (log ? min * (max / min) ** p : min + p * (max - min))
export const toPos = (v: number, min: number, max: number, log: boolean) =>
  Math.min(1, Math.max(0, log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min))) || 0
// a starting range: a decade either side for a positive value (log), else ±|value| (or ±1 around 0)
export const range = (v: number): { min: number; max: number; log: boolean } =>
  v > 0 ? { min: v / 10, max: v * 10, log: true } : v < 0 ? { min: 2 * v, max: -2 * v, log: false } : { min: -1, max: 1, log: false }
