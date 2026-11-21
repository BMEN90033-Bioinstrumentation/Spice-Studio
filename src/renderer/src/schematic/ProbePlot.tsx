// A probe plot on the schematic: a small chart of the probed points, floating over the canvas at a fixed place and size
// (the canvas pans and zooms under it). The chart is uPlot set up like the results panel's (Plot.tsx): same colours
// and axes, drag or wheel to zoom, double-click to reset; kept compact, so the hover values go in the title bar beside each
// point's name instead of a legend row. The Schematic owns the plots and their points.
import { useEffect, useMemo, useRef, type PointerEvent as RPE } from 'react'
import uPlot from 'uplot'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tip'
import { axisLook, axisTitle, eng, seriesColor } from '../Plot'
import { useDark, usePrefs } from '../Preferences'
import type { ProbeTarget } from './Schematic'

// one probe point's trace in the results tab on show: y absent = no data (not run yet, or not in this analysis);
// key: its entry in a results chart; why: a reason there can never be data (ground, a block…); note: for the status bar
export interface ProbeSeries { key: string | null; label: string; unit: string; y?: Float64Array; why?: string; note?: string }
// scale: the x axis of that tab (null before a run, and for single-point results like .op); log: an AC sweep
export interface ProbeSrc { scale: { x: Float64Array; log: boolean; unit: string; name: string } | null; ran: boolean; of(ts: ProbeTarget[]): ProbeSeries[] }
export type ProbeMode = 'all' | 'delta' // every point as its own trace, or the first point minus each of the others

const val = (v: number, unit: string) => (unit === 'dB' ? +v.toFixed(2) + 'dB' : eng(v, unit))
const stop = (e: RPE) => e.stopPropagation() // header buttons don't start a move
const FONT = '10px system-ui, sans-serif' // smaller than the results panel's 12px

export function ProbePlot({ x, y, w, h, series, scale, ran, mode, adding, onMode, onAdd, onRemove, onClose, onMove, onSize }: {
  x: number; y: number; w: number; h: number; series: ProbeSeries[]; scale: ProbeSrc['scale']; ran: boolean; mode: ProbeMode; adding: boolean
  onMode: (m: ProbeMode) => void; onAdd: () => void; onRemove: (i: number) => void; onClose: () => void
  onMove: (e: RPE<HTMLDivElement>) => void; onSize: (w: number, h: number) => void
}) {
  const dark = useDark(), lw = usePrefs().plotWidth
  const card = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null)
  const traces = useMemo(() => {
    const all = series.map((s, i) => ({ label: s.label, unit: s.unit, y: s.y, color: seriesColor(i) }))
    if (mode !== 'delta' || all.length < 2) return all
    const a = all[0]
    return all.slice(1).map((b) => ({ label: `${a.label} − ${b.label}`, unit: a.unit === b.unit ? a.unit : '', color: b.color, y: a.y && b.y ? a.y.map((v, i) => v - b.y![i]) : undefined }))
  }, [series, mode])
  const live = traces.filter((t) => t.y), single = !scale && live.some((t) => t.y!.length === 1) // .op: values, no chart

  // the card's own resize handle (CSS resize)
  useEffect(() => {
    const el = card.current!, ro = new ResizeObserver(() => (el.offsetWidth !== w || el.offsetHeight !== h) && onSize(el.offsetWidth, el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  })

  useEffect(() => {
    const el = host.current
    if (!el || single) return
    const axis = { ...axisLook(dark), font: FONT, labelFont: FONT, labelSize: 14, labelGap: 0 }, has = !!scale && live.length > 0
    // hover values: beside each point's name (Δ: trace j is point j + 1 against the first)
    const slots = [...card.current!.querySelectorAll<HTMLElement>('[data-val]')], off = traces.length < slots.length ? 1 : 0
    const hover = (u: uPlot) => live.forEach((t, j) => { const i = u.cursor.idx, v = i == null ? null : u.data[j + 1][i], el = slots[traces.indexOf(t) + off]; if (el) el.textContent = v == null ? '' : val(v, t.unit) })
    const units = [...new Set(live.map((t) => t.unit))].slice(0, 2) // left axis, right axis; a third unit shares the right one
    const sk = (unit: string) => 'y' + Math.max(0, units.indexOf(unit) < 0 ? units.length - 1 : units.indexOf(unit))
    const blank = (_u: uPlot, s: number[]) => s.map(() => '')
    const u = new uPlot(
      {
        width: el.clientWidth,
        height: el.clientHeight,
        scales: { x: { time: false, distr: has && scale.log ? 3 : 1, log: 10 }, ...(has ? Object.fromEntries(units.map((_, i) => ['y' + i, { auto: true }])) : { y0: { range: [0, 1] as uPlot.Range.MinMax } }) },
        series: has
          ? [{ label: scale.name, value: (_u, v) => (v == null ? '' : eng(v, scale.unit)) }, ...live.map((t) => ({ label: t.label, scale: sk(t.unit), stroke: t.color, width: lw, spanGaps: true, value: (_u: uPlot, v: number | null) => (v == null ? '' : val(v, t.unit)) }))]
          : [{}, { scale: 'y0', show: false }],
        axes: has
          ? [
              { ...axis, size: 26, label: axisTitle(scale.unit, scale.name), values: (_u, s) => s.map((v) => (v == null ? '' : eng(v, scale.unit))) }, // log axes pass null for unlabelled minor ticks
              ...units.map((unit, i): uPlot.Axis => ({ ...axis, scale: 'y' + i, size: 46, side: i ? 1 : 3, grid: i ? { show: false } : axis.grid, label: axisTitle(unit), values: (_u, t) => t.map((v) => val(v, unit)) }))
            ]
          : [{ ...axis, size: 26, values: blank }, { ...axis, scale: 'y0', size: 46, values: blank }],
        cursor: has ? { drag: { x: true, y: true, uni: 20, dist: 4 } } : { show: false },
        legend: { show: false },
        hooks: { setCursor: [hover] }
      },
      has ? [scale.x, ...live.map((t) => t.y!)] : [[0, 1], [null, null]],
      (u, init) => (el.appendChild(u.root), init())
    )
    // the wheel over a plot zooms its x axis about the pointer (pinch too; sideways scrolls it), within the data; it
    // never reaches the page or the canvas under the plot
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      if (!has) return
      const log = scale.log, T = (v: number) => (log ? Math.log10(v) : v), xs = scale.x, lo = T(xs[0]), hi = T(xs[xs.length - 1])
      const r = u.over.getBoundingClientRect(), a = T(u.scales.x.min!), b = T(u.scales.x.max!), at = T(u.posToVal(e.clientX - r.left, 'x'))
      const f = Math.exp(Math.max(-50, Math.min(50, e.deltaY)) * (e.ctrlKey ? 0.01 : 0.002)), pan = (e.deltaX / r.width) * (b - a)
      let min = at - (at - a) * f + pan, max = at + (b - at) * f + pan
      if (max - min >= hi - lo) (min = lo), (max = hi)
      else if (min < lo) (max += lo - min), (min = lo)
      else if (max > hi) (min -= max - hi), (max = hi)
      if (max - min > (hi - lo) * 1e-6) u.setScale('x', { min: log ? 10 ** min : min, max: log ? 10 ** max : max })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => (el.removeEventListener('wheel', wheel), u.destroy(), slots.forEach((s) => (s.textContent = '')))
  }, [traces, scale, dark, lw, w, h, single])

  const none = !live.length ? (ran ? (series.find((s) => s.why)?.why ?? 'No results for this point in the analysis on show') : 'Run the simulation to fill this plot') : ''
  return (
    <div ref={card} className="pcard absolute flex flex-col overflow-hidden rounded-md border bg-card text-card-foreground shadow-md" style={{ left: x, top: y, width: w, height: h }}>
      <div className="flex h-6 shrink-0 cursor-move items-center gap-1 border-b pr-0.5 pl-2 text-[11px] select-none" onPointerDown={onMove}>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {series.map((s, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              <span className="size-2 shrink-0 rounded-full" style={{ background: seriesColor(i) }} />
              <span className="truncate font-mono">{s.label}</span>
              <span data-val className="shrink-0 font-mono text-muted-foreground tabular-nums" />
              {series.length > 1 && <button type="button" className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground" aria-label={`Remove ${s.label} from this plot`} onPointerDown={stop} onClick={() => onRemove(i)}><X className="size-3" /></button>}
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center" onPointerDown={stop}>
          {series.length > 1 && <>
            <Tip label="Every point as its own trace"><Button variant={mode === 'all' ? 'secondary' : 'ghost'} size="xs" className="h-5 px-1.5 text-[11px]" aria-pressed={mode === 'all'} onClick={() => onMode('all')}>All</Button></Tip>
            <Tip label={`The difference: ${series[0].label} minus each other point`}><Button variant={mode === 'delta' ? 'secondary' : 'ghost'} size="xs" className="h-5 px-1.5 text-[11px]" aria-pressed={mode === 'delta'} onClick={() => onMode('delta')}>Δ</Button></Tip>
          </>}
          <Tip label={adding ? 'Done adding points (Esc)' : 'Add points to this plot: then click wires or parts'}><Button variant={adding ? 'secondary' : 'ghost'} size="icon-xs" className="size-5" aria-label="Add points to this plot" aria-pressed={adding} onClick={onAdd}><Plus /></Button></Tip>
          <Tip label="Remove this plot"><Button variant="ghost" size="icon-xs" className="size-5" aria-label="Remove this plot" onClick={onClose}><X /></Button></Tip>
        </div>
      </div>
      {single
        ? <div className="flex flex-col gap-1 p-2 font-mono text-[11px]">{live.map((t, i) => <div key={i} className="flex justify-between gap-4"><span style={{ color: t.color }}>{t.label}</span><span>{val(t.y![0], t.unit)}</span></div>)}</div>
        : <div ref={host} className="relative min-h-0 flex-1">{none && <p className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6 text-center text-xs text-muted-foreground">{none}</p>}</div>}
    </div>
  )
}
