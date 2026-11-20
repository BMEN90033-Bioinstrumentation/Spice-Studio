// Logic view of the plots: which vectors are digital signals (and their threshold), and buses. Pure TS.
import { logicalLines, spiceValue } from '../sim/analysis.ts'
import { DIGITAL_PARTS } from '../schematic/digital.ts'

const PARTS = new Set(DIGITAL_PARTS.map((p) => p.name.toLowerCase()))

// vector name ('v(net)', lowercase) -> input threshold (vdd/2) of the digital part on that net; NaN when vdd is an
// expression (the caller falls back to mid-swing).
// ponytail: top-level instances only; nets inside hierarchical blocks (v(x1.q)) plot as analog, walk the subckts if needed
export function logicNets(netlist: string): Record<string, number> {
  const out: Record<string, number> = {}
  let depth = 0
  for (const { text } of logicalLines(netlist)) {
    const t = text.split(/\s+/)
    if (/^\.subckt$/i.test(t[0])) depth++
    else if (/^\.ends$/i.test(t[0])) depth--
    if (depth || !/^x/i.test(t[0])) continue
    const end = t.findIndex((w, i) => i > 0 && (/^params:$/i.test(w) || w.includes('='))), name = (end < 0 ? t.length : end) - 1
    if (name < 2 || !PARTS.has(t[name].toLowerCase())) continue
    const th = spiceValue(/\bvdd=(\S+)/i.exec(text)?.[1] ?? '5') / 2
    for (const net of t.slice(1, name)) if (net !== '0') out[`v(${net.toLowerCase()})`] = th
  }
  return out
}

// threshold to use for a vector: the part's, else halfway between the vector's extremes
export function threshold(y: ArrayLike<number>, th?: number): number {
  if (th != null && Number.isFinite(th)) return th
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < y.length; i++) (lo = Math.min(lo, y[i])), (hi = Math.max(hi, y[i]))
  return (lo + hi) / 2
}
export const bits = (y: ArrayLike<number>, th: number) => Float64Array.from(y, (v) => +(v > th))

// A bus is a selection entry '=bus(q1, q0)' (an expression by contracts.ts isExpr, so it is kept across runs): the
// member nets, most significant bit first. Returns their vector names (lowercase), or null if `sel` isn't a bus.
export function busOf(sel: string): string[] | null {
  const m = /^=?\s*bus\s*\((.*)\)\s*$/i.exec(sel)
  if (!m) return null
  return (m[1].match(/[a-z]+\([^()]*\)|[^\s,()]+/gi) ?? []).map((n) => (/\(/.test(n) ? n : `v(${n})`).toLowerCase().replace(/\s+/g, ''))
}
// the bus as a number per sample (members' bits, MSB first)
// ponytail: doubles, so exact up to 53 bits
export function busValues(members: ArrayLike<number>[]): Float64Array {
  const out = new Float64Array(members[0]?.length ?? 0)
  for (const b of members) for (let i = 0; i < out.length; i++) out[i] = out[i] * 2 + b[i]
  return out
}
export const busText = (v: number, n: number, radix: 'hex' | 'dec') =>
  radix === 'hex' ? v.toString(16).toUpperCase().padStart(Math.ceil(n / 4), '0') : String(v)

// the value in force at x = v: the last sample at or before it (logic levels are held, not interpolated); null outside the data
export function stepAt(x: ArrayLike<number>, y: ArrayLike<number>, v: number): number | null {
  const n = x.length
  if (!n || !(v >= x[0] && v <= x[n - 1])) return null
  let a = 0, b = n
  while (b - a > 1) {
    const m = (a + b) >> 1
    if (x[m] <= v) a = m
    else b = m
  }
  return y[a]
}
