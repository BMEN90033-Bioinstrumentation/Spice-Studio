import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { RawPlot, RawVar } from '../../main/rawfile'
import { isExpr } from './contracts'
import { useCommands } from './commands'
import { evalExpr, isCurrent, pretty } from './plot/expr'
import { fft, nextPow2 } from './plot/fft'
import { toCsv, toPng, toSvg, type CsvRun } from './plot/export'
export { isCurrent, pretty }

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
// dB and degrees read better fixed-point than with SI prefixes
const fmt = (v: number | null, unit: string) => (/^(dB|°)/.test(unit) ? (v == null || !isFinite(v) ? '—' : v.toFixed(2) + unit) : eng(v, unit))

const UNIT: Record<string, string> = { time: 's', frequency: 'Hz', voltage: 'V', current: 'A' }
const INV: Record<string, string> = { s: 'Hz', Hz: 's' } // unit of 1/Δx
type Mode = 'db' | 'phase'
type View = 'time' | 'fft'
type Cur = { a?: number; b?: number }
export type PlotRun = { label: string; plot: RawPlot }
// cursors outlive the Plot (tab switches, pop-out) until the next run replaces the plot objects
const CURS = new WeakMap<RawPlot, Record<View, Cur>>()

const lc = (v: { name: string }) => v.name.toLowerCase()
// default selection: the first ≤4 voltages (else the first 4 vectors)
export function defaultSel(plot: RawPlot): string[] {
  const sig = plot.vars.slice(1), volts = sig.filter((v) => v.type === 'voltage')
  return (volts.length ? volts : sig).slice(0, 4).map(lc)
}

// One drawn line: a vector or expression in one run. x/y as drawn (dB/° for AC, dB for FFT); re/im the raw values.
type Trace = { key: string; name: string; run: number; unit: string; scale: string; x: Float64Array; y: ArrayLike<number | null>; re: Float64Array; im: Float64Array | null }

// dB of an exactly-zero AC magnitude (e.g. a DC supply node) is -Infinity, which wrecks uPlot's y range for the
// whole chart: non-finite points become gaps (null) instead
const ac = (re: Float64Array, im: Float64Array, mode: Mode) =>
  Array.from(re, (r, i) => {
    const y = mode === 'db' ? 20 * Math.log10(Math.hypot(r, im[i])) : (Math.atan2(im[i], r) * 180) / Math.PI
    return Number.isFinite(y) ? y : null
  })
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

export function Plot({ runs, sel, onSel }: { runs: PlotRun[]; sel: string[]; onSel: (sel: string[]) => void }) {
  const first = runs[0].plot
  const [scale, ...signals] = first.vars
  const [mode, setMode] = useState<Mode>('db')
  const [view, setView] = useState<View>('time')
  const [fftLog, setFftLog] = useState(true)
  const [fftRange, setFftRange] = useState<[number, number] | null>(null)
  const [curs, setCurs] = useState<Record<View, Cur>>(() => CURS.get(first) ?? { time: {}, fft: {} })
  useEffect(() => void CURS.set(first, curs), [curs])
  const [draft, setDraft] = useState(''), [draftErr, setDraftErr] = useState('')
  const [note, setNote] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const uref = useRef<uPlot | null>(null)
  const cur = curs[view], curRef = useRef(cur)
  curRef.current = cur
  const place = useRef(() => {})
  // inductors/V-like parts come back twice with savecurrents (branch i(l1) and device i(@l1[i])): list the branch only
  const dup = (v: RawVar) => { const m = /^i\(@([^[\]]+)\[i\]\)$/i.exec(v.name); return !!m && signals.some((w) => lc(w) === `i(${m[1].toLowerCase()})`) }
  const list = [...signals.filter((v) => !isCurrent(v.name)), ...signals.filter((v) => isCurrent(v.name) && !dup(v))]
  // .op rawfiles have no scale vector (vars[0] is a real result): the table lists every vector
  const rows = first.points >= 2 ? list : [scale, ...list]
  const exprs = sel.filter(isExpr)
  const hue = (key: string) => (isExpr(key) ? signals.length + exprs.indexOf(key) : signals.findIndex((v) => lc(v) === key))
  const grouped = isCurrent(list[0]?.name ?? '') !== isCurrent(list[list.length - 1]?.name ?? '') // both kinds present
  const canFft = scale.type === 'time' && !first.complex
  const fftv = view === 'fft' && canFft

  const { traces, errors, fftInfo } = useMemo(() => {
    const shown = [...signals.filter((v) => sel.includes(lc(v))).map(lc), ...sel.filter(isExpr)]
    const traces: Trace[] = [], errors: Record<string, string> = {}
    const n = nextPow2(Math.max(...runs.map((r) => r.plot.points)))
    let df = 0
    runs.forEach(({ plot }, run) => {
      const x = plot.vars[0].re
      for (const key of shown) {
        let re: Float64Array, im: Float64Array | null, unit: string, name: string, sc: string
        if (isExpr(key)) {
          const v = evalExpr(key.slice(1), plot)
          if ('error' in v) {
            errors[key] ??= v.error
            continue
          }
          ;({ re, im, unit } = v)
          name = key.slice(1)
          sc = plot.complex ? (im || unit === 'dB' || unit === '°' ? 'y' : unit || '1') : unit || '1'
        } else {
          const v = plot.vars.find((w) => lc(w) === key)
          if (!v) continue
          re = v.re, im = plot.complex ? (v.im ?? null) : null, name = pretty(v.name)
          unit = UNIT[v.type] ?? (isCurrent(v.name) ? 'A' : 'V')
          // volts and amps get separate y scales (mA next to V would draw as a flat line); dB/phase share one
          sc = plot.complex ? 'y' : isCurrent(v.name) ? 'A' : 'V'
        }
        if (fftv) {
          const s = fft(x, re, { n, t0: fftRange?.[0], t1: fftRange?.[1] }), k = fftLog ? 1 : 0 // log axis: no DC bin
          df = s.df
          traces.push({ key, name, run, unit: 'dB' + (unit === 'V' || unit === 'A' ? unit : ''), scale: 'y', x: s.f.subarray(k), y: clean(s.mag.subarray(k).map((m) => 20 * Math.log10(m))), re, im: null })
        } else if (im) traces.push({ key, name, run, unit: mode === 'db' ? 'dB' : '°', scale: sc, x, y: ac(re, im, mode), re, im })
        else traces.push({ key, name, run, unit, scale: sc, x, y: isExpr(key) ? clean(re) : re, re, im: null })
      }
    })
    return { traces, errors, fftInfo: { n, df } }
  }, [runs, sel, mode, fftv, fftLog, fftRange])

  useEffect(() => {
    if (first.points < 2 || !host.current) return
    const el = host.current, doc = el.ownerDocument
    const yUnit = fftv ? 'dB' : first.complex ? (mode === 'db' ? 'dB' : '°') : ''
    const xUnit = fftv ? 'Hz' : UNIT[scale.type]
    const axis = { stroke: '#9aa3b2', grid: { stroke: '#262a33' }, ticks: { stroke: '#262a33' } }
    const ser: uPlot.Series[] = [], tables: uPlot.AlignedData[] = []
    runs.forEach(({ label }, r) => {
      const ts = traces.filter((t) => t.run === r)
      if (!ts.length) return
      tables.push([ts[0].x, ...ts.map((t) => t.y as uPlot.AlignedData[1])])
      for (const t of ts)
        ser.push({
          label: label ? `${t.name} · ${label}` : t.name,
          scale: t.scale,
          stroke: color(hue(t.key), r, runs.length),
          width: 1.5,
          spanGaps: true,
          value: (_u: uPlot, y: number | null) => fmt(y, t.unit)
        })
    })
    if (!tables.length) tables.push([fftv ? new Float64Array([1, 2]) : scale.re])
    // sweep runs have their own (adaptive) x points: join onto a common x, gaps as undefined
    const data = tables.length > 1 ? uPlot.join(tables) : tables[0]
    const used = [...new Set(ser.map((x) => x.scale!))]
    const yAxes: uPlot.Axis[] = (used.length ? used : ['y']).map((k, i) => ({
      ...axis, scale: k, size: i ? 76 : 64, side: i ? 1 : 3, grid: i ? { show: false } : axis.grid,
      values: (_u, t) => t.map((v) => (k === 'y' && yUnit ? v + yUnit : eng(v, k === 'y' || k === '1' ? '' : k)))
    }))
    let lines: HTMLDivElement[] = []
    const draw = () =>
      lines.forEach((d, i) => {
        const x = curRef.current[i ? 'b' : 'a'], p = x == null ? NaN : u.valToPos(x, 'x')
        const ok = p >= 0 && p <= u.over.clientWidth
        d.style.display = ok ? '' : 'none'
        if (ok) d.style.left = p + 'px'
      })
    const u: uPlot = new uPlot(
      {
        width: el.clientWidth - PAD_X,
        height: el.clientHeight - PAD_Y,
        scales: { x: { time: false, distr: (fftv ? fftLog : first.complex) ? 3 : 1, log: 10 }, ...Object.fromEntries(used.map((k) => [k, { auto: true }])) },
        series: [{ label: fftv ? 'frequency' : scale.name, value: (_u, v) => eng(v, xUnit) }, ...ser],
        axes: [
          { ...axis, values: (_u, s) => s.map((v) => (v == null ? '' : eng(v, xUnit))) }, // log axes pass null for unlabelled minor ticks
          ...yAxes
        ],
        cursor: { drag: { x: true, y: true, uni: 20, dist: 4 } }, // dist: a click must not zoom (it places cursor A)
        legend: { live: true },
        hooks: { draw: [draw] }
      },
      data,
      // mount by callback: uPlot's `instanceof HTMLElement` check fails for the pop-out window's elements (other realm)
      (u, init) => (el.appendChild(u.root), init())
    )
    uref.current = u
    place.current = draw

    // cursors: click sets A, Shift+click sets B, drag a line to move it
    const xAt = (cx: number) => u.posToVal(Math.min(u.over.clientWidth, Math.max(0, cx - u.over.getBoundingClientRect().left)), 'x')
    const set = (k: 'a' | 'b', x: number) => setCurs((c) => ({ ...c, [view]: { ...c[view], [k]: x } }))
    lines = (['a', 'b'] as const).map((k) => {
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
      for (const ev of ['click', 'dblclick']) d.addEventListener(ev, (e) => e.stopPropagation())
      u.over.appendChild(d)
      return d
    })
    draw()
    let down = { x: NaN, y: NaN }, before: Cur = {}
    u.over.addEventListener('mousedown', (e) => (down = { x: e.clientX, y: e.clientY }))
    u.over.addEventListener('click', (e) => {
      if (!(Math.abs(e.clientX - down.x) < 4 && Math.abs(e.clientY - down.y) < 4)) return // that was a zoom drag
      if (e.detail <= 1) before = curRef.current
      set(e.shiftKey ? 'b' : 'a', xAt(e.clientX))
    })
    // double-click resets the zoom: undo the cursor moves its two clicks made
    u.over.addEventListener('dblclick', () => setCurs((c) => ({ ...c, [view]: before })))

    // the element's own window: an opener-window observer never fires for the pop-out's elements
    const ro = new (doc.defaultView ?? window).ResizeObserver(() => u.setSize({ width: el.clientWidth - PAD_X, height: el.clientHeight - PAD_Y - legendH(el) }))
    ro.observe(el)
    return () => {
      ro.disconnect(), u.destroy()
      uref.current = null
      place.current = () => {}
    }
  }, [traces])
  useEffect(() => place.current(), [cur])

  const csv = () => {
    const out: CsvRun[] = runs.map(({ label }, r) => {
      const ts = traces.filter((t) => t.run === r)
      return {
        label,
        x: ts[0]?.x ?? new Float64Array(0),
        cols: ts.flatMap((t) =>
          t.im
            ? [{ name: `${t.name} dB`, y: ac(t.re, t.im, 'db') }, { name: `${t.name} phase °`, y: ac(t.re, t.im, 'phase') }]
            : [{ name: fftv ? `${t.name} ${t.unit}` : t.name, y: t.y }]
        )
      }
    })
    return toCsv(fftv ? 'frequency' : scale.name, out.filter((r) => r.cols.length))
  }
  const save = async (kind: 'png' | 'svg' | 'csv') => {
    const u = uref.current
    if (!u) return
    try {
      const marks = [cur.a, cur.b], base = (first.plotname.split(' ')[0] || 'plot').toLowerCase() + (fftv ? '-fft' : '')
      const data = kind === 'png' ? await toPng(u, marks) : kind === 'svg' ? toSvg(u, marks) : csv()
      const p = await window.api.exportSave(`${base}.${kind}`, data, [{ name: { png: 'PNG image', svg: 'SVG image', csv: 'CSV' }[kind], extensions: [kind] }])
      setNote(p ? `Saved ${p}` : '')
    } catch (e) {
      setNote(`Export failed: ${(e as Error).message}`)
    }
  }
  const chart = first.points >= 2
  useCommands(chart ? [
    { id: 'file.export.plotPng', run: () => void save('png'), enabled: () => !!uref.current },
    { id: 'file.export.plotSvg', run: () => void save('svg'), enabled: () => !!uref.current },
    { id: 'file.export.plotCsv', run: () => void save('csv'), enabled: () => !!uref.current && traces.length > 0 }
  ] : [])

  if (!chart) {
    // .op or single-point results: a table reads better than a chart; one column per sweep run
    return (
      <table className="op">
        {runs.length > 1 && (
          <thead>
            <tr><th />{runs.map((r, i) => <th key={i}>{r.label}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {rows.map((v) => (
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
  const addExpr = () => {
    const t = draft.trim().replace(/^=\s*/, '')
    if (!t) return
    const r = evalExpr(t, first)
    if ('error' in r) return setDraftErr(r.error)
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
    <div className="seg">
      {opts.map(([k, t]) => (
        <button key={k} className={v === k ? 'on' : ''} onClick={() => set(k)}>{t}</button>
      ))}
    </div>
  )
  return (
    <div className="plot">
      <div className="vars">
        {first.complex && seg([['db', 'Magnitude'], ['phase', 'Phase']], mode, setMode)}
        {canFft && seg([['time', 'Time'], ['fft', 'FFT']], view, (v) => (v === 'fft' ? toFft() : setView(v)))}
        {fftv && seg([['log', 'Log f'], ['lin', 'Linear f']], fftLog ? 'log' : 'lin', (v) => setFftLog(v === 'log'))}
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
        <h4>Expressions</h4>
        {exprs.map((e) => (
          <div key={e} className="expr" style={{ '--c': color(hue(e)) } as React.CSSProperties}>
            <span className="sw" />
            <code title={errors[e] ?? e.slice(1)}>{e.slice(1)}</code>
            <button className="icon" title="Remove" onClick={() => onSel(sel.filter((s) => s !== e))}>×</button>
            {errors[e] && <div className="bad">{errors[e]}</div>}
          </div>
        ))}
        <input
          className="addexpr"
          value={draft}
          placeholder="＋ expression"
          title="e.g. v(out)-v(in), v(a,b)*i(r1), db(v(out)/v(in)), deriv(v(out)), gd(v(out)) · functions: db mag abs ph re im sqrt deriv gd"
          onChange={(e) => (setDraft(e.target.value), setDraftErr(''))}
          onKeyDown={(e) => e.key === 'Enter' && addExpr()}
        />
        {draftErr && <div className="bad">{draftErr}</div>}
      </div>
      <div className="chart" ref={host} />
      {(cur.a != null || cur.b != null) && (
        <div className="readout">
          <table>
            <thead>
              <tr>
                <th><button className="icon" title="Clear cursors" onClick={() => setCurs({ ...curs, [view]: {} })}>×</button></th>
                <th>A</th><th>B</th><th>B − A</th><th>{dx != null ? 'slope' : ''}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{fftv ? 'frequency' : scale.name}</td>
                <td>{eng(cur.a ?? null, xUnit)}</td>
                <td>{eng(cur.b ?? null, xUnit)}</td>
                <td>{dx != null && eng(dx, xUnit)}</td>
                <td>{dx != null && dx !== 0 && `1/Δ ${eng(1 / Math.abs(dx), INV[xUnit] ?? '')}`}</td>
              </tr>
              {traces.map((t) => {
                const ya = cur.a != null ? at(t.x, t.y, cur.a) : null, yb = cur.b != null ? at(t.x, t.y, cur.b) : null
                const dy = ya != null && yb != null ? yb - ya : null
                const label = runs.length > 1 && runs[t.run].label ? `${t.name} · ${runs[t.run].label}` : t.name
                return (
                  <tr key={t.run + ' ' + t.key}>
                    <td style={{ '--c': color(hue(t.key), t.run, runs.length) } as React.CSSProperties}><span className="sw" />{label}</td>
                    <td>{fmt(ya, t.unit)}</td>
                    <td>{fmt(yb, t.unit)}</td>
                    <td>{dy != null && fmt(dy, t.unit)}</td>
                    <td>{dy != null && dx ? eng(dy / dx, `${t.unit}/${xUnit}`) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="hint">
        <span>
          {note ||
            (fftv
              ? `Hann window · N = ${fftInfo.n} · Δf = ${eng(fftInfo.df, 'Hz')} · ${fftRange ? `${eng(fftRange[0], 's')} – ${eng(fftRange[1], 's')} (cursors A–B)` : 'whole run (place cursors A and B to pick a window)'} · set a fine max step (.tran … 0 tmax) for an accurate spectrum`
              : 'Drag to zoom · double-click to reset · click: cursor A · ⇧click: cursor B · drag a cursor to move it')}
        </span>
        <span className="exp">
          {(['png', 'svg', 'csv'] as const).map((k) => (
            <button key={k} className="icon" title={`Export ${k.toUpperCase()}`} onClick={() => void save(k)}>{k.toUpperCase()}</button>
          ))}
        </span>
      </div>
    </div>
  )
}

const PAD_X = 16, PAD_Y = 8 // .chart padding (style.css): uPlot sizes the canvas, not the box
const legendH = (el: HTMLElement) => (el.querySelector('.u-legend') as HTMLElement | null)?.offsetHeight ?? 0
