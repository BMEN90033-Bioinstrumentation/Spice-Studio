import { Fragment, useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { RawPlot, RawVar } from '../../main/rawfile'

const HUES = [199, 36, 123, 0, 291, 54, 174, 340]
// one hue per vector; with several sweep runs each run gets its own lightness (light -> dark)
const color = (i: number, run = 0, n = 1) => `hsl(${HUES[i % HUES.length]} 75% ${n > 1 ? 78 - (36 * run) / (n - 1) : 64}%)`
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

const UNIT: Record<string, string> = { time: 's', frequency: 'Hz', voltage: 'V', current: 'A' }
type Mode = 'db' | 'phase'
export type PlotRun = { label: string; plot: RawPlot }

export const isCurrent = (name: string) => /^(i\(|@)|#branch/i.test(name)
// Display names: ngspice's raw names → readable ("i(@r1[i])" → "I(R1)", "i(@q1[ic])" → "Ic(Q1)", "v(out)" → "V(out)")
export function pretty(name: string): string {
  const m = /^i\(@([^[\]]+)\[(\w+)\]\)$/i.exec(name)
  // devices inside subckts come back as "<type>.x1.r1": drop the type letter → X1.R1
  if (m) return `I${/^(i|id|current)$/i.test(m[2]) ? '' : m[2].slice(1).toLowerCase()}(${m[1].replace(/^[a-z]\.(?=.*\.)/i, '').toUpperCase()})`
  const b = /^i\(([^)]+)\)$/i.exec(name)
  if (b) return `I(${b[1].toUpperCase()})`
  return name.replace(/^v\(/i, 'V(')
}
const lc = (v: RawVar) => v.name.toLowerCase()
// default selection: the first ≤4 voltages (else the first 4 vectors)
export function defaultSel(plot: RawPlot): string[] {
  const sig = plot.vars.slice(1), volts = sig.filter((v) => v.type === 'voltage')
  return (volts.length ? volts : sig).slice(0, 4).map(lc)
}

// dB of an exactly-zero AC magnitude (e.g. a DC supply node) is -Infinity, which wrecks uPlot's y range for the
// whole chart: non-finite points become gaps (null) instead
function series(v: RawVar, complex: boolean, mode: Mode): Float64Array | (number | null)[] {
  if (!complex) return v.re
  return Array.from(v.re, (re, i) => {
    const y = mode === 'db' ? 20 * Math.log10(Math.hypot(re, v.im![i])) : (Math.atan2(v.im![i], re) * 180) / Math.PI
    return Number.isFinite(y) ? y : null
  })
}

export function Plot({ runs, sel, onSel }: { runs: PlotRun[]; sel: string[]; onSel: (sel: string[]) => void }) {
  const first = runs[0].plot
  const [scale, ...signals] = first.vars
  const [mode, setMode] = useState<Mode>('db')
  const host = useRef<HTMLDivElement>(null)
  const list = [...signals.filter((v) => !isCurrent(v.name)), ...signals.filter((v) => isCurrent(v.name))]
  const hue = (name: string) => signals.findIndex((v) => lc(v) === name)
  const grouped = isCurrent(list[0]?.name ?? '') !== isCurrent(list[list.length - 1]?.name ?? '') // both kinds present

  useEffect(() => {
    if (first.points < 2 || !host.current) return
    const el = host.current
    const yUnit = first.complex ? (mode === 'db' ? 'dB' : '°') : ''
    const axis = { stroke: '#9aa3b2', grid: { stroke: '#262a33' }, ticks: { stroke: '#262a33' } }
    const shown = signals.filter((v) => sel.includes(lc(v))).map(lc)
    const ser: uPlot.Series[] = [], tables: uPlot.AlignedData[] = []
    // volts and amps get separate y scales (mA next to V would draw as a flat line); dB/phase share one
    const sc = (v: RawVar) => (first.complex ? 'y' : isCurrent(v.name) ? 'A' : 'V')
    runs.forEach(({ label, plot }, r) => {
      const vs = shown.map((n) => plot.vars.find((v) => lc(v) === n)).filter((v) => v !== undefined)
      tables.push([plot.vars[0].re, ...vs.map((v) => series(v, plot.complex, mode))])
      for (const v of vs)
        ser.push({
          label: label ? `${pretty(v.name)} · ${label}` : pretty(v.name),
          scale: sc(v),
          stroke: color(hue(lc(v)), r, runs.length),
          width: 1.5,
          spanGaps: true,
          value: (_u: uPlot, y: number | null) => (yUnit ? (y == null ? '—' : y.toFixed(2) + yUnit) : eng(y, UNIT[v.type]))
        })
    })
    // sweep runs have their own (adaptive) x points: join onto a common x, gaps as undefined
    const data = tables.length > 1 ? uPlot.join(tables) : tables[0]
    const used = [...new Set(ser.map((x) => x.scale!))]
    const yAxes: uPlot.Axis[] = (used.length ? used : ['y']).map((k, i) => ({
      ...axis, scale: k, size: i ? 76 : 64, side: i ? 1 : 3, grid: i ? { show: false } : axis.grid,
      values: (_u, t) => t.map((v) => (yUnit ? v + yUnit : eng(v, k === 'y' ? '' : k)))
    }))
    const u = new uPlot(
      {
        width: el.clientWidth - PAD_X,
        height: el.clientHeight - PAD_Y,
        scales: { x: { time: false, distr: first.complex ? 3 : 1, log: 10 }, ...Object.fromEntries(used.map((k) => [k, { auto: true }])) },
        series: [{ label: scale.name, value: (_u, v) => eng(v, UNIT[scale.type]) }, ...ser],
        axes: [
          { ...axis, values: (_u, s) => s.map((v) => (v == null ? '' : eng(v, UNIT[scale.type]))) }, // log axes pass null for unlabelled minor ticks
          ...yAxes
        ],
        cursor: { drag: { x: true, y: true, uni: 20 } },
        legend: { live: true }
      },
      data,
      // mount by callback: uPlot's `instanceof HTMLElement` check fails for the pop-out window's elements (other realm)
      (u, init) => (el.appendChild(u.root), init())
    )
    // the element's own window: an opener-window observer never fires for the pop-out's elements
    const ro = new (el.ownerDocument.defaultView ?? window).ResizeObserver(() => u.setSize({ width: el.clientWidth - PAD_X, height: el.clientHeight - PAD_Y - legendH(el) }))
    ro.observe(el)
    return () => (ro.disconnect(), u.destroy())
  }, [runs, sel, mode])

  if (first.points < 2) {
    // .op or single-point results: a table reads better than a chart; one column per sweep run
    return (
      <table className="op">
        {runs.length > 1 && (
          <thead>
            <tr><th />{runs.map((r, i) => <th key={i}>{r.label}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {list.map((v) => (
            <tr key={v.name}>
              <td>{pretty(v.name)}</td>
              {runs.map(({ plot }, i) => (
                <td key={i}>{eng(plot.vars.find((w) => lc(w) === lc(v))?.re[0] ?? null, UNIT[v.type])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const toggle = (n: string) => onSel(sel.includes(n) ? sel.filter((s) => s !== n) : [...sel, n])
  return (
    <div className="plot">
      <div className="vars">
        {first.complex && (
          <div className="seg">
            {(['db', 'phase'] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'db' ? 'Magnitude' : 'Phase'}
              </button>
            ))}
          </div>
        )}
        {list.map((v, i) => (
          <Fragment key={v.name}>
            {grouped && (i === 0 || isCurrent(v.name) !== isCurrent(list[i - 1].name)) && (
              <h4>{isCurrent(v.name) ? 'Currents' : 'Voltages'}</h4>
            )}
            <label style={{ '--c': color(hue(lc(v))) } as React.CSSProperties}>
              <input type="checkbox" checked={sel.includes(lc(v))} onChange={() => toggle(lc(v))} />
              {pretty(v.name)}
            </label>
          </Fragment>
        ))}
      </div>
      <div className="chart" ref={host} />
      <div className="hint">Drag to zoom · double-click to reset</div>
    </div>
  )
}

const PAD_X = 16, PAD_Y = 8 // .chart padding (style.css): uPlot sizes the canvas, not the box
const legendH = (el: HTMLElement) => (el.querySelector('.u-legend') as HTMLElement | null)?.offsetHeight ?? 0
