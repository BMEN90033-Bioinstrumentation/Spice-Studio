// Results of .tf/.sens/.pz/.sp/nested .dc (rawfile plots) shaped for the results panel. Pure TS. (.four: meas.ts)
//   .tf   -> "Transfer Function", 1 point: v(Transfer_function), v(v1#Input_impedance), v(output_impedance_at_V(out)) (or v(vm#Output_impedance))
//   .sens -> "Sensitivity Analysis": DC 1 real point, AC complex over frequency; one vector per device / parameter, mostly 0
//   .pz   -> "Pole-Zero Analysis", 1 complex point: v(pole(1)) … v(zero(1)) … in rad/s
//   .dc with two sources -> one "DC transfer characteristic" plot, the inner sweep repeated per outer value
// (checked on ngspice-47; .options savecurrents adds i(@x[i]) vectors to all of them)
import type { RawPlot } from '../../../main/rawfile.ts'
import { parseAnalysis, spiceValue } from './analysis.ts'
import { eng } from './sweep.ts'

type Run = { label: string; plot: RawPlot }
const bare = (name: string) => name.replace(/^v\((.*)\)$/i, '$1') // ngspice writes these scalars as v(name)
const junk = (name: string) => /^i\(@/i.test(name) // savecurrents device currents: meaningless in these plots

// one rawfile plot of a run -> the runs the plot shows: a nested .dc splits into one run per outer value (a family of
// curves, overlaid like .step runs), sensitivities lose their all-zero vectors; anything else passes through
export function plotRuns(label: string, plot: RawPlot, netlist: string): Run[] {
  if (/^sensitivity/i.test(plot.plotname)) {
    const vars = plot.vars.filter((v, i) => (i === 0 && plot.points > 1) || (!junk(v.name) && (v.re.some((x) => x !== 0) || !!v.im?.some((x) => x !== 0))))
    return [{ label, plot: { ...plot, vars } }]
  }
  const x = plot.vars[0]?.re, n = x ? x.indexOf(x[0], 1) : -1 // inner sweep length: where the scale restarts
  const dc = netlist.split('\n').map((l) => parseAnalysis(l)).find((a) => a?.kind === 'dc' && a.source2)
  if (!/^dc\b/i.test(plot.plotname) || !dc || dc.kind !== 'dc' || n < 1 || plot.points % n) return [{ label, plot }]
  const a = spiceValue(dc.start2), step = spiceValue(dc.step2) // NaN for {expr}: numbered labels
  return Array.from({ length: plot.points / n }, (_, k) => {
    const v = a + k * step, at = isFinite(v) ? `${dc.source2}=${eng(Number(v.toPrecision(12)))}` : `${dc.source2} #${k + 1}`
    const cut = (f: Float64Array) => f.slice(k * n, (k + 1) * n)
    return { label: label ? `${label}, ${at}` : at, plot: { ...plot, points: n, vars: plot.vars.map((w) => ({ ...w, re: cut(w.re), ...(w.im && { im: cut(w.im) }) })) } }
  })
}

// default vectors for plots the generic pick (first voltages) gets wrong; null = use the generic one
export const startSel = (plot: RawPlot): string[] | null => {
  const s = plot.vars.filter((v) => /^s_\d+_\d+$/i.test(v.name)).map((v) => v.name.toLowerCase())
  return /^sp analysis/i.test(plot.plotname) && s.length ? s.slice(0, 4) : null
}

// plots shown as a table instead of a chart
export type TableKind = 'tf' | 'sens' | 'pz'
export function tableKind(plot: RawPlot): TableKind | null {
  if (/^transfer function/i.test(plot.plotname)) return 'tf'
  if (/^pole-zero/i.test(plot.plotname)) return 'pz'
  return /^sensitivity/i.test(plot.plotname) && plot.points < 2 ? 'sens' : null
}

export type Scalar = { name: string; value: number; unit: string }
// .tf: gain (its unit follows the output and input kinds), input resistance, output resistance
export function tfRows(plot: RawPlot): Scalar[] {
  let gain = NaN, src = '?', out = '?', vin = true, vout = true
  const rows: Scalar[] = []
  for (const v of plot.vars) {
    const n = bare(v.name), val = v.re[0]
    let m
    if (/^transfer_function$/i.test(n)) gain = val
    else if ((m = /^(.+)#input_impedance$/i.exec(n))) (src = m[1].toUpperCase()), (vin = !/^i/i.test(src)), rows.push({ name: `Input resistance at ${src}`, value: val, unit: 'Ω' })
    else if ((m = /^output_impedance_at_(.+)$/i.exec(n))) (out = m[1]), rows.push({ name: `Output resistance at ${out}`, value: val, unit: 'Ω' })
    else if ((m = /^(.+)#output_impedance$/i.exec(n))) (out = `I(${m[1].toUpperCase()})`), (vout = false), rows.push({ name: `Output resistance in ${out}`, value: val, unit: 'Ω' })
  }
  return [{ name: `Gain ${out} / ${src}`, value: gain, unit: vout === vin ? '' : vout ? 'Ω' : 'S' }, ...rows]
}

// DC .sens: the non-zero sensitivities, largest first. "r1" is per ohm of R1, "r1_m" per unit of its multiplier m, …
export const sensRows = (plot: RawPlot): Scalar[] =>
  plot.vars.filter((v) => !junk(v.name) && v.re[0] !== 0).map((v) => ({ name: bare(v.name), value: v.re[0], unit: '' }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

// .pz: roots in rad/s with their natural frequency (Hz) and, for a complex pair, Q
export type Root = { kind: 'pole' | 'zero'; re: number; im: number; f: number; q: number | null }
export const pzRows = (plot: RawPlot): Root[] =>
  plot.vars.flatMap((v) => {
    const m = /\b(pole|zero)\(\d+\)/i.exec(v.name), re = v.re[0], im = v.im?.[0] ?? 0, w = Math.hypot(re, im)
    return m ? [{ kind: m[1].toLowerCase() as Root['kind'], re, im, f: w / (2 * Math.PI), q: im && re ? w / (-2 * re) : null }] : []
  })

