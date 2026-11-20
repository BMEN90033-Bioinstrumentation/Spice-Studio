import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import uPlot from 'uplot'
import { ChartColumn, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tip } from '@/components/ui/tip'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { RawPlot, RawVar } from '../../main/rawfile'
import { isExpr } from './contracts'
import { useCommands } from './commands'
import { isDark, useDark, usePrefs } from './Preferences'
import { evalExpr, isCurrent, pretty } from './plot/expr'
import { fft, nextPow2 } from './plot/fft'
import { busSegs, toCsv, toPng, toSvg, type BusOpt, type CsvRun } from './plot/export'
import { bits, busOf, busText, busValues, stepAt, threshold } from './plot/logic'
import { instPath } from './sim/probe'
import { traceWav } from './sim/wav'
import { ComplexView, type CTrace, type CvApi, type CvKind } from './plot/ComplexView'
import { Eye } from './plot/Eye'
import { SELECT } from './plot/Tune'
import { Histogram } from './plot/Histogram'
import { unwrap } from './plot/views'
import { spiceValue } from './sim/analysis'
export { isCurrent, pretty }

const HUES = [199, 36, 123, 0, 291, 54, 174, 340]
// one hue per vector; with several sweep runs each run gets its own lightness (light -> dark)
// light theme: darker, so lines hold up on white
const color = (i: number, run = 0, n = 1) => `hsl(${HUES[i % HUES.length]} 75% ${isDark() ? (n > 1 ? 78 - (36 * run) / (n - 1) : 64) : n > 1 ? 50 - (28 * run) / (n - 1) : 36}%)`
const PREFIX: [number, string][] = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']
]

export function eng(v: number | null, unit = ''): string {
  if (v == null || !isFinite(v)) return '—'
  if (v === 0) return '0' + unit
  const a = Math.abs(v)
  const [m, p] = PREFIX.find(([m]) => a >= m * 0.9995) ?? PREFIX[PREFIX.length - 1]
  return `${+(v / m).toPrecision(4)}${p}${unit}`
}
// dB and degrees read better fixed-point than with SI prefixes
const fmt = (v: number | null, unit: string) => (/^(dB|°)/.test(unit) ? (v == null || !isFinite(v) ? '—' : v.toFixed(2) + unit) : eng(v, unit))

const UNIT: Record<string, string> = { time: 's', frequency: 'Hz', voltage: 'V', current: 'A', impedance: 'Ω', admittance: 'S', 's-param': '1' } // the last three: .sp
const INV: Record<string, string> = { s: 'Hz', Hz: 's' } // unit of 1/Δx
// axis titles: "Voltage (V)"; units without a quantity name show as "(V/s)", dimensionless as nothing
const QTY: Record<string, string> = { V: 'Voltage', A: 'Current', W: 'Power', 'Ω': 'Impedance', dB: 'Magnitude', '°': 'Phase', s: 'Time', Hz: 'Frequency' }
const axisTitle = (unit: string, name = '') => (unit && unit !== '1' ? `${QTY[unit] ?? name} (${unit})`.trim() : name)
// AC: bode = magnitude and phase stacked (two uPlots, shared x); nyquist/polar/smith: plot/ComplexView
type Mode = 'bode' | 'db' | 'phase' | CvKind
type View = 'time' | 'fft' | 'eye'
type Cur = { a?: number; b?: number }
const CPLX: Mode[] = ['nyquist', 'polar', 'smith']
let SYNC = 0 // uPlot cursor-sync keys, one per Bode chart pair
export type PlotRun = { label: string; plot: RawPlot }
// One chart of a results tab (the plot builder, layout/ResultsPanel.tsx): its title, ticked vectors / expressions (contracts.ts
// isExpr), and the user's labels: names by trace key (legend), axes by the automatic axis title ('x:' + title for the x axis)
export type Chart = { id: number; title: string; sel: string[]; names?: Record<string, string>; axes?: Record<string, string> }
// cursors outlive the Plot (tab switches, pop-out) until the next run replaces the plot objects
const CURS = new WeakMap<RawPlot, Record<View, Cur>>()

const lc = (v: { name: string }) => v.name.toLowerCase()
// default selection: the first ≤4 voltages (else the first 4 vectors)
export function defaultSel(plot: RawPlot): string[] {
  const sig = plot.vars.slice(1), volts = sig.filter((v) => v.type === 'voltage')
  return (volts.length ? volts : sig).slice(0, 4).map(lc)
}

// One drawn line: a vector or expression in one run. x/y as drawn (dB/° for AC, dB for FFT); re/im the raw values, vu
// their unit. pane: which stacked chart (Bode: 0 magnitude, 1 phase; logic rows: 1).
// logic: a row of the logic chart (a digital signal as 0/1, or a bus); re = the bits / the bus value per sample
type Trace = { logic?: BusOpt & { bus: boolean }; key: string; name: string; run: number; unit: string; scale: string; x: Float64Array; y: ArrayLike<number | null>; re: Float64Array; im: Float64Array | null; vu: string; pane: number }

// dB of an exactly-zero AC magnitude (e.g. a DC supply node) is -Infinity, which wrecks uPlot's y range for the
// whole chart: non-finite points become gaps (null) instead
const ac = (re: Float64Array, im: Float64Array, mode: 'db' | 'phase', unw = false) => {
  const y = Array.from(re, (r, i) => {
    const y = mode === 'db' ? 20 * Math.log10(Math.hypot(r, im[i])) : (Math.atan2(im[i], r) * 180) / Math.PI
    return Number.isFinite(y) ? y : null
  })
  return unw && mode === 'phase' ? unwrap(y) : y
}
const clean = (a: Float64Array): ArrayLike<number | null> => (a.every(Number.isFinite) ? a : Array.from(a, (v) => (Number.isFinite(v) ? v : null)))

// y at x = v by linear interpolation (x ascending); null outside the data
function at(x: ArrayLike<number>, y: ArrayLike<number | null>, v: number): number | null {
  const n = x.length
  if (!n || !(v >= x[0] && v <= x[n - 1])) return null
  let a = 0, b = n - 1
  while (b - a > 1) {
    const m = (a + b) >> 1
    if (x[m] <= v) a = m
    else b = m
  }
  const ya = y[a], yb = y[b]
  if (ya == null || yb == null) return ya ?? yb
  return x[b] === x[a] ? ya : ya + ((yb - ya) * (v - x[a])) / (x[b] - x[a])
}

// hold: new data replaces the old for the same view (live tuning): keep the x zoom
// logic: the digital nets and their thresholds (plot/logic.ts logicNets): drawn as rows of a logic chart under the analog one
// insts: block / subcircuit instances (sim/probe.ts instances): the vector list groups by them
export function Plot({ runs, chart, onChart, hold, logic = NONE, insts = NO_INSTS }: { runs: PlotRun[]; chart: Chart; onChart: (c: Chart) => void; hold?: boolean; logic?: Record<string, number>; insts?: Record<string, string> }) {
  const { sel } = chart, onSel = (sel: string[]) => onChart({ ...chart, sel })
  const lab = (auto: string, x = false) => chart.axes?.[(x ? 'x:' : '') + auto] || auto // an axis title: the user's, else the automatic one
  const first = runs[0].plot
  const [scale, ...signals] = first.vars
  const dark = useDark() // re-render (and redraw the canvas) when the theme changes
  const lw = usePrefs().plotWidth // Settings › Simulation and plots
  const [mode, setMode] = useState<Mode>('bode')
  const [unw, setUnw] = useState(false) // unwrapped phase
  const [z0, setZ0] = useState('50') // Smith chart reference impedance
  const [view, setView] = useState<View>('time')
  const [fftLog, setFftLog] = useState(true)
  const [fftRange, setFftRange] = useState<[number, number] | null>(null)
  const [logicOn, setLogicOn] = useState(true) // digital signals as logic rows (off: as voltages)
  const [radix, setRadix] = useState<'hex' | 'dec'>('hex') // bus values
  const [eye, setEye] = useState({ key: '', period: '', offset: '0' }) // eye diagram: trace, bit period, offset (SPICE numbers)
  const [hist, setHist] = useState<string | null>(null) // histogram over the runs: a trace at cursor A (id) or an .op row ('op:' + name)
  const [curs, setCurs] = useState<Record<View, Cur>>(() => CURS.get(first) ?? { time: {}, fft: {}, eye: {} })
  useEffect(() => void CURS.set(first, curs), [curs, first])
  const [draft, setDraft] = useState(''), [draftErr, setDraftErr] = useState('')
  const [q, setQ] = useState('') // vector search
  const [note, setNote] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const uref = useRef<uPlot[]>([]) // the chart(s) on screen: one, the Bode pair, or the eye diagram
  const cv = useRef<CvApi | null>(null)
  const zoom = useRef<{ key: string; x: [number, number] } | null>(null) // last x zoom, restored with `hold`
  const cur = curs[view], curRef = useRef(cur)
  curRef.current = cur
  const place = useRef(() => {})
  const [menu, setMenu] = useState<{ x: number; y: number; val: number } | null>(null) // the chart's right-click menu: where, and the x value there
  // the whole run again; the y scales follow (uPlot re-ranges them with x), stacked charts too (follow)
  const resetZoom = () => { const u = uref.current[0], xs = u?.data[0]; if (xs?.length) u.setScale('x', { min: xs[0], max: xs[xs.length - 1] }) }
  useEffect(() => {
    if (!menu) return
    const doc = host.current?.ownerDocument ?? document, esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    doc.addEventListener('keydown', esc)
    return () => doc.removeEventListener('keydown', esc)
  }, [menu])
  // inductors/V-like parts come back twice with savecurrents (branch i(l1) and device i(@l1[i])): list the branch only
  const dup = (v: RawVar) => { const m = /^i\(@([^[\]]+)\[i\]\)$/i.exec(v.name); return !!m && signals.some((w) => lc(w) === `i(${m[1].toLowerCase()})`) }
  const list = [...signals.filter((v) => !isCurrent(v.name)), ...signals.filter((v) => isCurrent(v.name) && !dup(v))]
  // .op rawfiles have no scale vector (vars[0] is a real result): the table lists every vector
  const rows = first.points >= 2 ? list : [scale, ...list]
  const exprs = sel.filter(isExpr) // buses too: '=bus(q1,q0)'
  const hue = (key: string) => (isExpr(key) ? signals.length + exprs.indexOf(key) : signals.findIndex((v) => lc(v) === key))
  const canFft = scale.type === 'time' && !first.complex
  const fftv = view === 'fft' && canFft
  const eyev = view === 'eye' && canFft
  const bodev = first.complex && mode === 'bode'
  const cplxv = first.complex && CPLX.includes(mode)
  const timev = canFft && !fftv && !eyev // the view with logic rows and buses
  const yUnitOf = (p: number) => (fftv ? 'dB' : first.complex ? (bodev ? ['dB', '°'][p] : mode === 'db' ? 'dB' : '°') : '')
  const yTitle = (k: string, p: number) => axisTitle(k === 'y' ? yUnitOf(p) : k === '1' ? '' : k)

  const { traces, errors, fftInfo } = useMemo(() => {
    const shown = [...signals.filter((v) => sel.includes(lc(v))).map(lc), ...sel.filter(isExpr)]
    const traces: Trace[] = [], errors: Record<string, string> = {}
    // logic rows, top to bottom: ticked digital signals and buses, one row per run
    const has = (p: RawPlot, n: string) => p.vars.find((w) => lc(w) === n)
    const lkeys = shown.filter((k) => { const b = busOf(k); return timev && (b ? b.length > 0 && b.every((n) => has(first, n)) : logicOn && k in logic) })
    const rows = lkeys.length * runs.length
    const n = nextPow2(Math.max(...runs.map((r) => r.plot.points)))
    let df = 0
    runs.forEach(({ plot }, run) => {
      const x = plot.vars[0].re
      for (const key of shown) {
        const bus = busOf(key), row = lkeys.indexOf(key) * runs.length + run
        if (bus) {
          const vs = bus.map((n) => has(plot, n)), miss = bus.find((_, i) => !vs[i])
          if (miss || !bus.length) errors[key] ??= miss ? `No vector ${miss}` : 'bus(…) takes nets, most significant first: bus(q1,q0)'
          else if (timev) {
            const v = busValues(vs.map((w) => bits(w!.re, threshold(w!.re, logic[lc(w!)]))))
            traces.push({ key, name: key.slice(1), run, unit: '', scale: 'L', x, y: v, re: v, im: null, vu: '', pane: 1, logic: { row, rows, bus: true, text: (n) => busText(n, bus.length, radix) } })
          }
          continue
        }
        let re: Float64Array, im: Float64Array | null, unit: string, name: string, sc: string, vu: string
        if (isExpr(key)) {
          const v = evalExpr(key.slice(1), plot)
          if ('error' in v) {
            errors[key] ??= v.error
            continue
          }
          ;({ re, im, unit } = v)
          name = key.slice(1), vu = unit
          sc = plot.complex ? (im || unit === 'dB' || unit === '°' ? 'y' : unit || '1') : unit || '1'
        } else {
          const v = plot.vars.find((w) => lc(w) === key)
          if (!v) continue
          re = v.re, im = plot.complex ? (v.im ?? null) : null, name = pretty(v.name)
          unit = vu = UNIT[v.type] ?? (isCurrent(v.name) ? 'A' : 'V')
          // volts and amps get separate y scales (mA next to V would draw as a flat line); dB/phase share one
          sc = plot.complex ? 'y' : isCurrent(v.name) ? 'A' : 'V'
        }
        if (lkeys.includes(key)) {
          const b = bits(re, threshold(re, logic[key]))
          traces.push({ key, name, run, unit: '', scale: 'L', x, y: b.map((v) => rows - row - 0.85 + 0.7 * v), re: b, im: null, vu, pane: 1, logic: { row, rows, bus: false, text: String } })
        } else if (fftv) {
          const s = fft(x, re, { n, t0: fftRange?.[0], t1: fftRange?.[1] }), k = fftLog ? 1 : 0 // log axis: no DC bin
          df = s.df
          traces.push({ key, name, run, unit: 'dB' + (unit === 'V' || unit === 'A' ? unit : ''), scale: 'y', x: s.f.subarray(k), y: clean(s.mag.subarray(k).map((m) => 20 * Math.log10(m))), re, im: null, vu, pane: 0 })
        } else if (im) {
          const t = { key, name, run, scale: sc, x, re, im, vu }
          if (mode !== 'phase') traces.push({ ...t, unit: 'dB', y: ac(re, im, 'db'), pane: 0 }) // the Nyquist/polar/Smith views use re/im
          if (mode === 'phase' || bodev) traces.push({ ...t, unit: '°', y: ac(re, im, 'phase', unw), pane: +bodev })
        } else traces.push({ key, name, run, unit, scale: sc, x, y: isExpr(key) ? clean(re) : re, re, im: null, vu, pane: +(bodev && unit === '°') })
      }
    })
    for (const t of traces) t.name = chart.names?.[t.key] || t.name // renamed in Labels
    return { traces, errors, fftInfo: { n, df } }
  }, [runs, sel, mode, unw, fftv, fftLog, fftRange, timev, logic, logicOn, radix, chart.names])

  useEffect(() => {
    if (first.points < 2 || !host.current) return
    const el = host.current, doc = el.ownerDocument
    const xUnit = fftv ? 'Hz' : UNIT[scale.type]
    const axis = dark // ≈ --muted-foreground / --border (canvas can't read CSS vars)
      ? { stroke: '#a1a1a1', grid: { stroke: 'rgba(255,255,255,0.1)' }, ticks: { stroke: 'rgba(255,255,255,0.15)' } }
      : { stroke: '#737373', grid: { stroke: 'rgba(0,0,0,0.08)' }, ticks: { stroke: 'rgba(0,0,0,0.15)' } }
    // one chart per pane: Bode stacks magnitude over phase, both following one x zoom and one hover cursor
    // logic rows: their own chart (pane 1) under the analog one, or alone when every trace is a logic row
    const rowNames: string[] = []
    for (const t of traces) if (t.logic) rowNames[t.logic.row] ??= t.name.length > 10 ? t.name.slice(0, 9) + '…' : t.name
    const nRows = traces.find((t) => t.logic)?.logic!.rows ?? 0
    const panes = bodev ? [0, 1] : nRows ? (traces.some((t) => !t.logic) ? [0, 1] : [1]) : [0], sync = panes.length > 1 ? { key: `bode${++SYNC}` } : undefined
    const boxes = panes.map(() => el.appendChild(doc.createElement('div')))
    const height = (pi: number) => {
      const all = el.clientHeight - PAD_Y - boxes.reduce((h, b) => h + legendH(b), 0), lh = Math.min(all * 0.7, nRows * 24 + 76) // the logic chart: 24 px a row + its x axis, at most 70%
      return Math.max(40, !nRows || panes.length < 2 ? all / panes.length : panes[pi] ? lh : all - lh)
    }
    const drawBus = (u: uPlot) => {
      const segs = busSegs(u)
      if (!segs.length) return
      const c = u.ctx, r = c.canvas.width / u.width, { left, top, width, height } = u.bbox
      c.save(), c.beginPath(), c.rect(left, top, width, height), c.clip()
      c.font = `${11 * r}px ui-monospace, Menlo, monospace`, c.textAlign = 'center', c.textBaseline = 'middle', c.lineWidth = lw * r, c.fillStyle = axis.stroke
      for (const s of segs) {
        c.strokeStyle = s.color
        c.strokeRect(left + s.x0 * r, top + s.y0 * r, (s.x1 - s.x0) * r, (s.y1 - s.y0) * r)
        if (s.text) c.fillText(s.text, left + ((s.x0 + s.x1) / 2) * r, top + ((s.y0 + s.y1) / 2) * r)
      }
      c.restore()
    }
    const built = panes.map((p) => {
      const yUnit = yUnitOf(p)
      const ser: uPlot.Series[] = [], tables: uPlot.AlignedData[] = []
      runs.forEach(({ label }, r) => {
        const ts = traces.filter((t) => t.run === r && t.pane === p)
        if (!ts.length) return
        tables.push([ts[0].x, ...ts.map((t) => t.y as uPlot.AlignedData[1])])
        for (const t of ts)
          ser.push({
            label: label ? `${t.name} · ${label}` : t.name,
            scale: t.scale,
            stroke: color(hue(t.key), r, runs.length),
            width: lw,
            spanGaps: true,
            value: (_u: uPlot, y: number | null) => (y == null ? '' : fmt(y, t.unit)), // blank off-hover: reads as a plain legend
            // logic rows read 0/1 (drawn at row + 0.15 / 0.85); a bus (data = its value) is drawn by drawBus, not as a line
            ...(t.logic && { value: (_u: uPlot, y: number | null) => (y == null ? '' : t.logic!.bus ? t.logic!.text(y) : String(+(y % 1 > 0.5))) }),
            ...(t.logic?.bus && { bus: t.logic, paths: () => null })
          })
      })
      if (!tables.length) tables.push([fftv ? new Float64Array([1, 2]) : scale.re])
      // sweep runs have their own (adaptive) x points: join onto a common x, gaps as undefined
      const data = tables.length > 1 ? uPlot.join(tables) : tables[0]
      const used = [...new Set(ser.map((x) => x.scale!))]
      return { yUnit, ser, data, used: used.length ? used : ['y'] }
    })
    const axesN = Math.max(...built.map((b) => b.used.length)) // stacked charts get as many y axes, so their plot areas line up
    const us: uPlot[] = [], lines: HTMLDivElement[][] = []
    const draw = (u: uPlot) =>
      lines[us.indexOf(u)]?.forEach((d, i) => {
        const x = curRef.current[i ? 'b' : 'a'], p = x == null ? NaN : u.valToPos(x, 'x')
        const ok = p >= 0 && p <= u.over.clientWidth
        d.style.display = ok ? '' : 'none'
        if (ok) d.style.left = p + 'px'
      })
    let syncing = false
    const follow = (u: uPlot, k: string) => {
      if (k !== 'x' || syncing || !us.includes(u)) return
      syncing = true
      for (const o of us) if (o !== u) o.setScale('x', { min: u.scales.x.min!, max: u.scales.x.max! })
      syncing = false
    }
    // cursors: A / B keys put one at the mouse, drag a line to move it; right-click: the menu (place, remove, reset zoom)
    const set = (k: 'a' | 'b', x: number) => setCurs((c) => ({ ...c, [view]: { ...c[view], [k]: x } }))
    let hover: number | null = null // the x value under the mouse, while it is over a chart
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (hover == null || (k !== 'a' && k !== 'b') || e.metaKey || e.ctrlKey || e.altKey || (e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return
      e.preventDefault(), e.stopPropagation() // not a schematic shortcut too
      set(k, hover)
    }
    doc.addEventListener('keydown', onKey)
    // Bode: one legend, under the phase chart, its hover values "dB · °"; the magnitude chart keeps a legend only for traces
    // the phase chart lacks (real dB expressions)
    const below = new Set(bodev ? built[1].ser.map((x) => x.label) : [])
    const topLegend = !bodev || built[0].ser.some((x) => !below.has(x.label))
    const val = (x: uPlot.Series, u: uPlot, y: number, i: number, idx: number | null) => String((x.value as (u: uPlot, y: number, i: number, idx: number | null) => string)(u, y, i, idx))
    if (bodev)
      built[1].ser = built[1].ser.map((x) => ({
        ...x,
        value: (u: uPlot, y: number | null, si: number, idx: number | null) => {
          const own = val(x, u, y!, si, idx), t = us[0], j = t?.series.findIndex((s) => s.label === x.label) ?? -1
          const ty = y != null && j > 0 && idx != null && t.data[0][idx] === u.data[0][idx] ? t.data[j][idx] : null
          return ty == null ? own : `${val(t.series[j], t, ty, j, idx)} · ${own}`
        }
      }))
    built.forEach(({ yUnit, ser, data, used }, pi) => {
      const p = panes[pi]
      const yAxes: uPlot.Axis[] = used.map((k, i) => k === 'L' ? {
        // one tick per row, labelled with the signal; sized like the analog chart's axis so the plot areas line up
        ...axis, scale: k, size: 72, labelSize: 18, label: 'Logic', grid: { show: false },
        splits: () => Array.from({ length: nRows }, (_, r) => nRows - r - 0.5), values: () => Array.from({ length: nRows }, (_, r) => rowNames[r] ?? '')
      } : {
        ...axis, scale: k, size: i ? 84 : 72, side: i ? 1 : 3, grid: i ? { show: false } : axis.grid, labelSize: 18,
        label: lab(yTitle(k, p)),
        values: (_u, t) => t.map((v) => (k === 'y' && yUnit ? v + yUnit : eng(v, k === 'y' || k === '1' ? '' : k)))
      })
      while (yAxes.length < axesN) yAxes.push({ scale: used[0], side: 1, size: 84, values: (_u, t) => t.map(() => ''), grid: { show: false }, ticks: { show: false } })
      // the top Bode chart: x grid without labels
      const xAxis: uPlot.Axis = pi < panes.length - 1
        ? { ...axis, size: 8, values: (_u, s) => s.map(() => '') }
        : { ...axis, labelSize: 18, label: lab(axisTitle(xUnit, scale.name), true), values: (_u, s) => s.map((v) => (v == null ? '' : eng(v, xUnit))) } // log axes pass null for unlabelled minor ticks
      const u: uPlot = new uPlot(
        {
          width: el.clientWidth - PAD_X,
          height: height(pi),
          scales: { x: { time: false, distr: (fftv ? fftLog : first.complex) ? 3 : 1, log: 10 }, ...Object.fromEntries(used.map((k) => [k, k === 'L' ? { range: [0, nRows] as uPlot.Range.MinMax } : { auto: true }])) },
          series: [{ label: fftv ? 'frequency' : scale.name, value: (_u, v) => (v == null ? '' : eng(v, xUnit)) }, ...ser],
          axes: [xAxis, ...yAxes],
          cursor: { drag: { x: true, y: true, uni: 20, dist: 4 }, sync, ...(used[0] === 'L' && { points: { show: false } }) }, // dist: a click must not zoom (it places cursor A)
          legend: { live: true, show: pi > 0 || topLegend },
          hooks: { draw: [drawBus, draw], setScale: [follow] }
        },
        data,
        // mount by callback: uPlot's `instanceof HTMLElement` check fails for the pop-out window's elements (other realm)
        (u, init) => (boxes[pi].appendChild(u.root), init())
      )
      us.push(u)

      const xAt = (cx: number) => u.posToVal(Math.min(u.over.clientWidth, Math.max(0, cx - u.over.getBoundingClientRect().left)), 'x')
      lines.push((['a', 'b'] as const).map((k) => {
        const d = doc.createElement('div')
        d.className = 'pcur'
        d.dataset.k = k.toUpperCase()
        d.addEventListener('mousedown', (e) => {
          if (e.button) return
          e.stopPropagation(), e.preventDefault() // not a zoom drag
          const move = (ev: MouseEvent) => set(k, xAt(ev.clientX))
          const up = () => (doc.removeEventListener('mousemove', move), doc.removeEventListener('mouseup', up))
          doc.addEventListener('mousemove', move)
          doc.addEventListener('mouseup', up)
        })
        u.over.appendChild(d)
        return d
      }))
      draw(u)
      u.over.addEventListener('mousemove', (e) => (hover = xAt(e.clientX)))
      u.over.addEventListener('mouseleave', () => (hover = null))
      u.over.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        const r = el.parentElement!.getBoundingClientRect() // .plot: the menu is positioned in it
        setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, val: xAt(e.clientX) })
      })
      // uPlot resets the zoom for a double-click on the plot itself, not one that landed on a cursor line: do it here
      u.over.addEventListener('dblclick', (e) => e.target !== u.over && resetZoom())
    })
    uref.current = us
    place.current = () => us.forEach(draw)
    const zk = fftv ? `fft${fftLog}` : 'x'
    if (hold && zoom.current?.key === zk) us[0].setScale('x', { min: zoom.current.x[0], max: zoom.current.x[1] }) // follow() zooms the rest

    // the element's own window: an opener-window observer never fires for the pop-out's elements
    const ro = new (doc.defaultView ?? window).ResizeObserver(() => el.clientWidth && us.forEach((u, i) => u.setSize({ width: el.clientWidth - PAD_X, height: height(i) })))
    ro.observe(el)
    return () => {
      // remember a zoom (a range inside the data) for the next chart, see `hold`
      const { min, max } = us[0].scales.x, xs = us[0].data[0]
      zoom.current = min != null && max != null && xs.length && (min > xs[0] || max < xs[xs.length - 1]) ? { key: zk, x: [min, max] } : null
      ro.disconnect(), doc.removeEventListener('keydown', onKey), us.forEach((u) => u.destroy()), boxes.forEach((b) => b.remove())
      uref.current = []
      place.current = () => {}
    }
  }, [traces, eyev, cplxv, dark, lw, chart.axes])
  useEffect(() => place.current(), [cur])

  const csv = () => {
    const out: CsvRun[] = runs.map(({ label }, r) => {
      const ts = traces.filter((t) => t.run === r)
      return {
        label,
        x: ts[0]?.x ?? new Float64Array(0),
        cols: ts.flatMap((t) =>
          t.im
            ? t.pane ? [] : [{ name: `${t.name} dB`, y: ac(t.re, t.im, 'db') }, { name: `${t.name} phase °`, y: ac(t.re, t.im, 'phase', unw) }] // Bode: once, not per pane
            : [{ name: fftv ? `${t.name} ${t.unit}` : t.name, y: t.logic ? t.re : t.y }] // logic rows: 0/1, buses: the value
        )
      }
    })
    return toCsv(fftv ? 'frequency' : scale.name, out.filter((r) => r.cols.length))
  }
  const save = async (kind: 'png' | 'svg' | 'csv' | 'wav') => {
    const u = uref.current, c = cplxv && cv.current
    if (!u.length && !c) return
    try {
      const marks = eyev ? [] : [cur.a, cur.b], base = (first.plotname.split(' ')[0] || 'plot').toLowerCase() + (fftv ? '-fft' : eyev ? '-eye' : cplxv ? '-' + mode : '')
      const ts = traces.filter((t) => t.run === 0), w = kind === 'wav' ? traceWav(ts[0].x, ts.map((t) => (t.logic ? t.re : t.y))) : null // one channel per trace, 44.1 kHz
      const data = w ? w.wav : c ? (kind === 'png' ? await c.png() : kind === 'svg' ? c.svg() : c.csv()) : kind === 'png' ? await toPng(u, marks) : kind === 'svg' ? toSvg(u, marks) : csv()
      const p = await window.api.exportSave(`${base}.${kind}`, data, [{ name: { png: 'PNG image', svg: 'SVG image', csv: 'CSV', wav: 'WAV audio' }[kind], extensions: [kind] }])
      if (p && w) return setNote(`Saved ${p}: ${ts.length} channel${ts.length > 1 ? 's' : ''}, 44.1 kHz, full scale ±${eng(w.scale)}`)
      setNote(p ? `Saved ${p}` : '')
    } catch (e) {
      setNote(`Export failed: ${(e as Error).message}`)
    }
  }
  // the Nyquist/polar/Smith view's traces (complex ones only) and the eye diagram's (the picked trace, every run)
  const ctraces = useMemo<CTrace[]>(() => (cplxv ? traces.filter((t) => t.im).map((t) => ({ label: runs.length > 1 && runs[t.run].label ? `${t.name} · ${runs[t.run].label}` : t.name, color: color(hue(t.key), t.run, runs.length), x: t.x, re: t.re, im: t.im!, unit: t.vu })) : []), [traces, cplxv, dark])
  const eyeKey = traces.some((t) => t.key === eye.key) ? eye.key : (traces[0]?.key ?? '')
  const eyeTraces = useMemo(() => (eyev ? traces.filter((t) => t.key === eyeKey).map((t) => ({ x: t.x, y: t.re, color: color(hue(t.key), t.run, runs.length).replace(')', ' / 0.45)') })) : []), [traces, eyev, eyeKey, dark])
  const isChart = first.points >= 2
  const canWav = canFft && !fftv && !eyev && traces.some((t) => t.run === 0) // time-domain traces: Export > Plot as WAV
  const can = () => uref.current.length > 0 || (cplxv && !!cv.current)
  useCommands(isChart ? [
    { id: 'file.export.plotPng', run: () => void save('png'), enabled: can },
    { id: 'file.export.plotSvg', run: () => void save('svg'), enabled: can },
    { id: 'file.export.plotCsv', run: () => void save('csv'), enabled: () => can() && !eyev && traces.length > 0 },
    { id: 'file.export.plotWav', run: () => void save('wav'), enabled: () => can() && canWav }
  ] : [])
  const many = runs.length > 2 // sweeps / Monte Carlo / worst case: histograms over the runs
  const histBtn = (id: string, what: string) => (
    <Tip label={`Histogram and statistics of ${what} over the ${runs.length} runs`}>
      <Button variant="ghost" size="icon-xs" className="ml-1 size-4 align-middle text-muted-foreground" aria-label={`Histogram of ${what}`} onClick={() => setHist(id)}><ChartColumn className="size-3" /></Button>
    </Tip>
  )

  if (!isChart) {
    // .op or single-point results: a table reads better than a chart; one column per sweep run
    const opv = (plot: RawPlot, v: RawVar) => plot.vars.find((w) => lc(w) === lc(v))?.re[0] ?? null
    const hv = hist?.startsWith('op:') ? rows.find((v) => 'op:' + lc(v) === hist) : undefined
    return (
      <div className="absolute inset-0 overflow-auto">
        {hv && (
          <div className="m-4 mb-0">
            <Histogram id={hist!} title={`${pretty(hv.name)} over ${runs.length} runs`} values={runs.map(({ plot }) => opv(plot, hv))} labels={runs.map((r) => r.label)} unit={UNIT[hv.type] ?? ''} onClose={() => setHist(null)} />
          </div>
        )}
        <table className="m-4 font-mono text-xs">
          {runs.length > 1 && (
            <TableHeader>
              <TableRow className="hover:bg-transparent"><TableHead className="h-8 px-4" />{runs.map((r, i) => <TableHead key={i} className="h-8 px-4 text-right font-medium text-muted-foreground">{r.label}</TableHead>)}</TableRow>
            </TableHeader>
          )}
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.name}>
                <TableCell className="px-4 py-1">{pretty(v.name)}{many && histBtn('op:' + lc(v), pretty(v.name))}</TableCell>
                {runs.map(({ plot }, i) => (
                  <TableCell key={i} className="px-4 py-1 text-right text-hl">{eng(opv(plot, v), UNIT[v.type])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
    )
  }

  const shown = q.trim() ? list.filter((v) => [v.name, pretty(v.name)].some((n) => n.toLowerCase().includes(q.trim().toLowerCase()))) : list
  const toggle = (n: string) => onSel(sel.includes(n) ? sel.filter((s) => s !== n) : [...sel, n])
  const vecRows = (vs: RawVar[]) => {
    const both = vs.some((v) => isCurrent(v.name)) && vs.some((v) => !isCurrent(v.name))
    return vs.map((v, i) => (
      <Fragment key={v.name}>
        {both && (i === 0 || isCurrent(v.name) !== isCurrent(vs[i - 1].name)) && <h4 className={H4}>{isCurrent(v.name) ? 'Currents' : 'Voltages'}</h4>}
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-xs" style={{ '--c': color(hue(lc(v))) } as CSSProperties}>
          <Checkbox checked={sel.includes(lc(v))} onCheckedChange={() => toggle(lc(v))} className={CHECK} />
          {pretty(v.name)}
        </label>
      </Fragment>
    ))
  }
  // with blocks or subcircuits: one foldable group per sheet instance, the top sheet first
  const by = new Map<string, RawVar[]>()
  if (Object.keys(insts).length) for (const v of shown) { const p = instPath(v.name, insts); by.set(p, [...(by.get(p) ?? []), v]) }
  const groups = by.size ? [...by].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })) : null
  // Labels: an axis title or a legend name, empty = the automatic one; applied on Enter / leaving the box (the chart is redrawn)
  const labelBox = (what: 'axes' | 'names', k: string, auto: string, aria: string) => (
    <Input key={chart[what]?.[k] ?? ''} className={field + ' min-w-0'} defaultValue={chart[what]?.[k] ?? ''} placeholder={auto} aria-label={aria}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (chart[what]?.[k] ?? '')) onChart({ ...chart, [what]: { ...chart[what], [k]: v } }) }} />
  )
  const autoName = (k: string) => (isExpr(k) ? k.slice(1) : pretty(signals.find((v) => lc(v) === k)?.name ?? k))
  const yTitles = [...new Set(traces.filter((t) => !t.logic).map((t) => yTitle(t.scale, t.pane)))]
  const addExpr = () => {
    const t = draft.trim().replace(/^=\s*/, '')
    if (!t) return
    const bus = busOf(t), miss = bus?.find((n) => !signals.some((v) => lc(v) === n))
    if (bus) {
      if (!canFft || !bus.length || miss) return setDraftErr(!canFft ? 'Buses are for transient results' : miss ? `No vector ${miss}` : 'List the nets, most significant first: bus(q1,q0)')
    } else {
      const r = evalExpr(t, first)
      if ('error' in r) return setDraftErr(r.error)
    }
    if (!sel.includes('=' + t)) onSel([...sel, '=' + t])
    setDraft(''), setDraftErr('')
  }
  const toFft = () => {
    const { a, b } = curs.time
    setFftRange(a != null && b != null && a !== b ? [Math.min(a, b), Math.max(a, b)] : null)
    setView('fft')
  }
  const xUnit = fftv ? 'Hz' : UNIT[scale.type] ?? ''
  const dx = cur.a != null && cur.b != null ? cur.b - cur.a : null
  const seg = <T extends string>(opts: [T, string][], v: T, set: (v: T) => void) => (
    <ToggleGroup type="single" variant="outline" size="sm" className="mb-2 w-full" value={v} onValueChange={(x) => x && set(x as T)}>
      {opts.map(([k, t]) => <ToggleGroupItem key={k} value={k} className="h-7 flex-1 text-xs">{t}</ToggleGroupItem>)}
    </ToggleGroup>
  )
  const field = 'h-7 font-mono text-xs md:text-xs'
  const bad = 'w-full font-sans text-[11px] leading-tight text-err'
  const z0v = spiceValue(z0), eyeT = spiceValue(eye.period), eyeOff = eye.offset.trim() ? spiceValue(eye.offset) : 0
  const ht = hist && !cplxv && !eyev ? traces.find((t) => `${t.key}|${t.pane}` === hist) : undefined // histogram of a trace at cursor A
  return (
    <div className="plot">
      <div className="row-span-3 flex flex-col gap-1 overflow-y-auto border-r p-2.5">
        {first.complex && seg([['bode', 'Bode'], ['db', 'Magnitude'], ['phase', 'Phase']], mode, setMode)}
        {first.complex && seg([['nyquist', 'Nyquist'], ['polar', 'Polar'], ['smith', 'Smith']], mode, setMode)}
        {first.complex && (bodev || mode === 'phase') && (
          <label className="mb-2 flex cursor-pointer items-center gap-1.5 text-xs"><Checkbox checked={unw} onCheckedChange={(c) => setUnw(!!c)} className="size-3.5" />Unwrap phase</label>
        )}
        {first.complex && mode === 'smith' && (
          <Tip label="Reference impedance. Impedance traces (Ω, e.g. v(in)/i(v1)) are drawn as Γ = (Z − Z0)/(Z + Z0); S-parameters as they are" side="right">
            <label className="mb-2 flex items-center gap-1.5 text-xs">Z0<Input className={field + ' w-20'} aria-invalid={!(z0v > 0)} aria-label="Reference impedance Z0" value={z0} onChange={(e) => setZ0(e.target.value)} />Ω</label>
          </Tip>
        )}
        {canFft && seg([['time', 'Time'], ['fft', 'FFT'], ['eye', 'Eye']], view, (v) => (v === 'fft' ? toFft() : setView(v)))}
        {fftv && seg([['log', 'Log f'], ['lin', 'Linear f']], fftLog ? 'log' : 'lin', (v) => setFftLog(v === 'log'))}
        {timev && signals.some((v) => lc(v) in logic) && (
          <Tip label="Draw the nets on digital parts as high/low rows under the plot, split at each part's threshold (vdd/2). Off: as voltages" side="right">
            <label className="mb-2 flex cursor-pointer items-center gap-1.5 text-xs"><Checkbox checked={logicOn} onCheckedChange={(c) => setLogicOn(!!c)} className="size-3.5" />Logic rows</label>
          </Tip>
        )}
        {timev && sel.some((k) => busOf(k)) && seg([['hex', 'Bus: hex'], ['dec', 'Bus: decimal']], radix, setRadix)}
        {eyev && (
          <div className="mb-2 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-xs">
            <span>Trace</span>
            {/* native <select>: Radix Select lists open off-screen in the pop-out window */}
            <select value={eyeKey} onChange={(e) => setEye({ ...eye, key: e.target.value })} className={SELECT + ' h-7 w-full min-w-0 font-mono'} aria-label="Eye diagram trace">
              {!traces.length && <option value="">Tick a trace</option>}
              {traces.filter((t) => !t.run).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
            <span>Bit period</span>
            <Input className={field} aria-invalid={!!eye.period && !(eyeT > 0)} aria-label="Bit period" placeholder="e.g. 1u" value={eye.period} onChange={(e) => setEye({ ...eye, period: e.target.value })} />
            <span>Offset</span>
            <Input className={field} aria-invalid={isNaN(eyeOff)} aria-label="Offset" placeholder="0" value={eye.offset} onChange={(e) => setEye({ ...eye, offset: e.target.value })} />
          </div>
        )}
        <Tip label="Filter by name, e.g. ecg, i(d1), x3. Enter toggles the first match" side="right">
          <Input
            className={field}
            type="search"
            value={q}
            placeholder="Search vectors"
            aria-label="Search vectors"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQ('')
              if (e.key === 'Enter' && shown[0]) toggle(lc(shown[0]))
            }}
          />
        </Tip>
        {q && !shown.length && <div className="text-xs text-muted-foreground">No vectors match "{q}"</div>}
        {groups
          ? groups.map(([p, vs]) => {
              const n = vs.filter((v) => sel.includes(lc(v))).length
              return (
                <details key={p} open={!p || !!q.trim()}>
                  <summary className="cursor-pointer py-0.5 text-xs font-medium select-none">
                    {p ? `${p.toUpperCase()} · ${insts[p]}` : 'Top sheet'}
                    {n > 0 && <span className="ml-1.5 font-normal text-muted-foreground">{n} plotted</span>}
                  </summary>
                  <div className="flex flex-col gap-1 pb-1.5 pl-3.5">{vecRows(vs)}</div>
                </details>
              )
            })
          : vecRows(shown)}
        <h4 className={H4}>Expressions</h4>
        {exprs.map((e) => (
          <div key={e} className="flex flex-wrap items-center font-mono text-xs" style={{ '--c': color(hue(e)) } as CSSProperties}>
            <span className="sw" />
            <code className="min-w-0 flex-1 truncate" title={errors[e] ?? e.slice(1)}>{e.slice(1)}</code>
            <Tip label="Remove">
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`Remove ${e.slice(1)}`} onClick={() => onSel(sel.filter((s) => s !== e))}><X /></Button>
            </Tip>
            {errors[e] && <div className={bad}>{errors[e]}</div>}
          </div>
        ))}
        <Tip label="e.g. v(out)-v(in), v(a,b)*i(r1), db(v(out)/v(in)), deriv(v(out)), gd(v(out)) · functions: db mag abs ph re im sqrt deriv gd · bus(q1,q0): nets as one logic bus, most significant first" side="right">
          <Input
            className={'mt-0.5 ' + field}
            value={draft}
            placeholder="＋ expression"
            aria-label="Add an expression"
            onChange={(e) => (setDraft(e.target.value), setDraftErr(''))}
            onKeyDown={(e) => e.key === 'Enter' && addExpr()}
          />
        </Tip>
        {draftErr && <div className={bad}>{draftErr}</div>}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none">Labels</summary>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 pt-1.5 text-xs">
            {!cplxv && !eyev && (
              <>
                <span>X axis</span>{labelBox('axes', 'x:' + axisTitle(xUnit, scale.name), axisTitle(xUnit, scale.name), 'X axis label')}
                {yTitles.map((a) => <Fragment key={a}><span>Y axis</span>{labelBox('axes', a, a || 'no unit', `Y axis label for ${a || 'the unitless axis'}`)}</Fragment>)}
              </>
            )}
            {[...new Set(traces.map((t) => t.key))].map((k) => (
              <Fragment key={k}><span className="sw mr-0" style={{ '--c': color(hue(k)) } as CSSProperties} />{labelBox('names', k, autoName(k), `Legend name for ${autoName(k)}`)}</Fragment>
            ))}
            {!traces.length && <span className="col-span-2 text-muted-foreground">Tick a vector to name it</span>}
          </div>
        </details>
      </div>
      {cplxv ? (
        <ComplexView key={mode} kind={mode as CvKind} traces={ctraces} z0={z0v > 0 ? z0v : 50} curs={cur} xUnit={xUnit} api={cv}
          onCur={(k, x) => setCurs((c) => ({ ...c, [view]: { ...c[view], [k]: x } }))} />
      ) : eyev ? (
        eyeT > 0 && !isNaN(eyeOff) && eyeTraces.length ? <Eye traces={eyeTraces} period={eyeT} offset={eyeOff} unit={traces.find((t) => t.key === eyeKey)!.unit} name={traces.find((t) => t.key === eyeKey)!.name} onChart={(u) => (uref.current = u ? [u] : [])} />
          : <div className="chart grid place-items-center text-xs text-muted-foreground">{eyeTraces.length ? 'Enter the bit period (and an offset) to fold the trace into an eye diagram' : 'Tick a trace for the eye diagram'}</div>
      ) : <div className="chart" ref={host} />}
      {(cur.a != null || cur.b != null) && !cplxv && !eyev && (
        <div className="max-h-[140px] min-w-0 overflow-auto border-t px-2">
          {/* plain <table>, not <Table>: its own scroll wrapper would break the sticky header */}
          <table className="w-full font-mono text-[11px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={RH}>
                  <Tip label="Clear cursors">
                    <Button variant="ghost" size="icon-xs" className="size-5 text-muted-foreground" aria-label="Clear cursors" onClick={() => setCurs({ ...curs, [view]: {} })}><X /></Button>
                  </Tip>
                </TableHead>
                <TableHead className={RH}>A</TableHead><TableHead className={RH}>B</TableHead><TableHead className={RH}>B − A</TableHead><TableHead className={RH}>{dx != null ? 'slope' : ''}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className={RD}>{fftv ? 'frequency' : scale.name}</TableCell>
                <TableCell className={RD}>{eng(cur.a ?? null, xUnit)}</TableCell>
                <TableCell className={RD}>{eng(cur.b ?? null, xUnit)}</TableCell>
                <TableCell className={RD}>{dx != null && eng(dx, xUnit)}</TableCell>
                <TableCell className={RD}>{dx != null && dx !== 0 && `1/Δ ${eng(1 / Math.abs(dx), INV[xUnit] ?? '')}`}</TableCell>
              </TableRow>
              {traces.map((t) => {
                const rd = (c?: number) => (c == null ? null : t.logic ? stepAt(t.x, t.re, c) : at(t.x, t.y, c)), ya = rd(cur.a), yb = rd(cur.b)
                const dy = ya != null && yb != null && !t.logic ? yb - ya : null // logic rows: levels only
                const show = (v: number | null) => (t.logic ? (v == null ? '—' : t.logic.text(v)) : fmt(v, t.unit))
                const label = runs.length > 1 && runs[t.run].label ? `${t.name} · ${runs[t.run].label}` : t.name
                return (
                  <TableRow key={t.run + ' ' + t.key + ' ' + t.pane}>
                    <TableCell className={RD} style={{ '--c': color(hue(t.key), t.run, runs.length) } as CSSProperties}>
                      <span className="sw" />{label}{many && !t.run && !t.logic && cur.a != null && histBtn(`${t.key}|${t.pane}`, `${t.name}${bodev ? ` (${t.unit})` : ''} at A`)}
                    </TableCell>
                    <TableCell className={RD}>{show(ya)}</TableCell>
                    <TableCell className={RD}>{show(yb)}</TableCell>
                    <TableCell className={RD}>{dy != null && fmt(dy, t.unit)}</TableCell>
                    <TableCell className={RD}>{dy != null && dx ? eng(dy / dx, `${t.unit}/${xUnit}`) : ''}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </table>
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2 px-3 pt-0.5 pb-1.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {note ||
            (fftv
              ? `Hann window · N = ${fftInfo.n} · Δf = ${eng(fftInfo.df, 'Hz')} · ${fftRange ? `${eng(fftRange[0], 's')} – ${eng(fftRange[1], 's')} (cursors A–B)` : 'whole run (place cursors A and B to pick a window)'} · set a fine max step (.tran … 0 tmax) for an accurate spectrum`
              : cplxv ? `Hover a trace for its frequency and value · click: cursor A · ⇧click: cursor B${mode === 'smith' ? '' : ' · wheel: zoom · double-click: reset'}${cur.a != null ? ` · A = ${eng(cur.a, xUnit)}` : ''}${cur.b != null ? ` · B = ${eng(cur.b, xUnit)}` : ''}`
              : eyev ? 'Every bit period from the offset on, drawn over each other · drag to zoom · double-click to reset'
              : 'Drag to zoom · double-click to reset · A / B: cursor at the mouse · drag a cursor to move it · right-click for more')}
        </span>
        <span className="flex gap-0.5">
          {(eyev ? (['png', 'svg'] as const) : (['png', 'svg', 'csv', ...(canWav ? ['wav' as const] : [])] as const)).map((k) => (
            <Tip key={k} label={`Export ${k.toUpperCase()}`}>
              <Button variant="ghost" size="xs" className="h-5 px-1.5 text-[10px] text-muted-foreground" onClick={() => void save(k)}>{k.toUpperCase()}</Button>
            </Tip>
          ))}
        </span>
      </div>
      {menu && !cplxv && !eyev && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))} />
          <div role="menu" className="absolute z-40 min-w-48 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md" style={{ left: `min(${menu.x}px, calc(100% - 13rem))`, top: `min(${menu.y}px, calc(100% - 9rem))` }}>
            {([
              ['Place cursor A here', 'A', () => setCurs({ ...curs, [view]: { ...cur, a: menu.val } })],
              ['Place cursor B here', 'B', () => setCurs({ ...curs, [view]: { ...cur, b: menu.val } })],
              ...(cur.a != null ? [['Remove cursor A', '', () => setCurs({ ...curs, [view]: { ...cur, a: undefined } })] as const] : []),
              ...(cur.b != null ? [['Remove cursor B', '', () => setCurs({ ...curs, [view]: { ...cur, b: undefined } })] as const] : []),
              ['Reset zoom', 'double-click', resetZoom]
            ] as const).map(([label, key, run]) => (
              <button key={label} role="menuitem" className="flex w-full items-center justify-between gap-6 rounded-sm px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground" onClick={() => (run(), setMenu(null))}>
                {label}<span className="text-muted-foreground">{key}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {ht && (
        <div className="absolute inset-0 z-20 overflow-auto bg-background p-3">
          <Histogram id={hist!} title={`${ht.name}${bodev ? ` (${ht.unit})` : ''} at A = ${eng(cur.a ?? null, xUnit)} over ${runs.length} runs`} unit={ht.unit} onClose={() => setHist(null)}
            labels={runs.map((r) => r.label)} values={runs.map((_, r) => { const t = traces.find((t) => t.run === r && `${t.key}|${t.pane}` === hist); return t && cur.a != null ? at(t.x, t.y, cur.a) : null })} />
        </div>
      )}
    </div>
  )
}

const NONE: Record<string, number> = {}
const NO_INSTS: Record<string, string> = {}
const PAD_X = 16, PAD_Y = 8 // .chart padding (style.css): uPlot sizes the canvas, not the box
const H4 = 'mt-2 mb-0.5 text-xs font-medium text-muted-foreground first-of-type:mt-0'
// per-trace colour from the row's --c
const CHECK = 'size-3.5 data-[state=checked]:border-(--c) data-[state=checked]:bg-(--c) dark:data-[state=checked]:bg-(--c) [&_svg]:size-3'
// readout: compact, right-aligned numbers, name column left
const RH = 'sticky top-0 h-auto bg-background px-2 py-px text-right font-medium text-muted-foreground first:text-left'
const RD = 'px-2 py-px text-right first:text-left'
const legendH = (el: HTMLElement) => (el.querySelector('.u-legend') as HTMLElement | null)?.offsetHeight ?? 0
