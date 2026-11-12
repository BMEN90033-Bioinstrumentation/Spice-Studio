// Results of .tf/.sens/.pz/.sp/nested .dc (rawfile plots) shaped for the results panel. Pure TS. (.four: meas.ts)
//   .tf   -> "Transfer Function", 1 point: v(Transfer_function), v(v1#Input_impedance), v(output_impedance_at_V(out)) (or v(vm#Output_impedance))
//   .sens -> "Sensitivity Analysis": DC 1 real point, AC complex over frequency (scale first); one vector per device / parameter, mostly 0
//   .pz   -> "Pole-Zero Analysis", 1 complex point: v(pole(1)) … v(zero(1)) … in rad/s
//   .dc with two sources -> one "DC transfer characteristic" plot, the inner sweep repeated per outer value; with several
//         .dc lines the plots come in reverse deck order (checked with 4), so a plot is matched to its line by its
//         numbers, and by that order when the numbers fit more than one line
// (checked on ngspice-47; .options savecurrents adds i(@x[i]) vectors to all of them)
import type { RawPlot } from '../../../main/rawfile.ts'
import { logicalLines, parseAnalysis, spiceValue, type Analysis } from './analysis.ts'
import { eng } from './sweep.ts'

type Run = { label: string; plot: RawPlot }
const bare = (name: string) => name.replace(/^v\((.*)\)$/i, '$1') // ngspice writes these scalars as v(name)
const junk = (name: string) => /^i\(@/i.test(name) // savecurrents device currents: meaningless in these plots

// one rawfile plot of a run -> the runs the plot shows: a nested .dc splits into one run per outer value (a family of
// curves, overlaid like .step runs), sensitivities lose their all-zero vectors; anything else passes through.
// nth: the plot's place among the run's DC plots (1 = the first written), 0 = unknown
export function plotRuns(label: string, plot: RawPlot, netlist: string, nth = 0): Run[] {
  if (/^sensitivity/i.test(plot.plotname)) {
    const vars = plot.vars.filter((v, i) => (i === 0 && plot.complex) || (!junk(v.name) && (v.re.some((x) => x !== 0) || !!v.im?.some((x) => x !== 0))))
    return [{ label, plot: { ...plot, vars } }]
  }
  const x = plot.vars[0]?.re, n = x ? x.indexOf(x[0], 1) : -1 // inner sweep length: where the scale restarts
  if (!/^dc\b/i.test(plot.plotname) || n < 1 || plot.points % n) return [{ label, plot }]
  const all = logicalLines(netlist).filter((l) => /^\.dc\b/i.test(l.text)).map((l) => parseAnalysis(l.text) as DC | null)
  const nested = all.filter((d): d is DC => !!d?.source2)
  if (!nested.length) return [{ label, plot }]
  const fits = (d: DC) => near(spiceValue(d.start), x[0]) && count(d.start, d.stop, d.step) === n && n * count(d.start2, d.stop2, d.step2) === plot.points
  const own = nth ? all[all.length - nth] : null, fit = nested.filter(fits) // own: this plot's line by the reverse order
  // {expr} values fit nothing: then its own line, or the only nested one
  const dc = (own && fit.includes(own) ? own : fit[0]) ?? (own?.source2 ? own : nested.length === 1 ? nested[0] : undefined)
  const a = dc ? spiceValue(dc.start2) : NaN, step = dc ? spiceValue(dc.step2) : NaN // NaN: numbered labels
  return Array.from({ length: plot.points / n }, (_, k) => {
    const v = a + k * step, at = isFinite(v) ? `${dc!.source2}=${eng(Number(v.toPrecision(12)))}` : `${dc?.source2 ?? 'sweep'} #${k + 1}`
    const cut = (f: Float64Array) => f.slice(k * n, (k + 1) * n)
    return { label: label ? `${label}, ${at}` : at, plot: { ...plot, points: n, vars: plot.vars.map((w) => ({ ...w, re: cut(w.re), ...(w.im && { im: cut(w.im) }) })) } }
  })
}

type DC = Extract<Analysis, { kind: 'dc' }>
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
// points of a start/stop/step sweep, NaN for {expr} values
const count = (a: string, b: string, s: string) => Math.floor((spiceValue(b) - spiceValue(a)) / spiceValue(s) + 1e-9) + 1

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

export type Scalar = { name: string; value: number; unit: string; phase?: number } // phase (°): an AC value, value = magnitude
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

// one-point .sens: the non-zero sensitivities, largest first. "r1" is per ohm of R1, "r1_m" per unit of its multiplier m, …
// An AC one (complex, a lin 1 sweep) leads with its frequency and gives magnitude and phase.
export const sensRows = (plot: RawPlot): Scalar[] =>
  plot.vars.slice(plot.complex ? 1 : 0).filter((v) => !junk(v.name) && (v.re[0] !== 0 || !!v.im?.[0]))
    .map((v) => ({ name: bare(v.name), value: plot.complex ? Math.hypot(v.re[0], v.im![0]) : v.re[0], unit: '', ...(plot.complex && { phase: (Math.atan2(v.im![0], v.re[0]) * 180) / Math.PI }) }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

// .pz: roots in rad/s with their natural frequency (Hz) and, for a complex pair, Q
export type Root = { kind: 'pole' | 'zero'; re: number; im: number; f: number; q: number | null }
export const pzRows = (plot: RawPlot): Root[] =>
  plot.vars.flatMap((v) => {
    const m = /\b(pole|zero)\(\d+\)/i.exec(v.name), re = v.re[0], im = v.im?.[0] ?? 0, w = Math.hypot(re, im)
    return m ? [{ kind: m[1].toLowerCase() as Root['kind'], re, im, f: w / (2 * Math.PI), q: im && re ? w / (-2 * re) : null }] : []
  })

