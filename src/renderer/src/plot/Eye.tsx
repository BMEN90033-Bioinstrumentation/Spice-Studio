// Eye diagram: one transient trace cut into bit periods (from an offset) and the periods overlaid, on a uPlot.
import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import { eng } from '../Plot'
import { fold } from './views'

const AXIS = { stroke: '#a1a1a1', grid: { stroke: 'rgba(255,255,255,0.1)' }, ticks: { stroke: 'rgba(255,255,255,0.15)' }, labelSize: 18 } // = Plot.tsx
const MAX_SEGS = 2000 // over all runs: more periods than this are dropped (the first ones are kept)

export function Eye({ traces, period, offset, unit, name, onChart }: {
  traces: { x: Float64Array; y: Float64Array; color: string }[]; period: number; offset: number; unit: string; name: string; onChart: (u: uPlot | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current!, segs: { y: Float64Array; color: string }[] = []
    let t = new Float64Array([0, period || 1]), total = 0
    for (const tr of traces) {
      const f = fold(tr.x, tr.y, period, offset, 256, Math.floor(MAX_SEGS / traces.length))
      ;(t = f.t), (total += f.total)
      for (const y of f.segs) segs.push({ y, color: tr.color })
    }
    const count = segs.length < total ? `the first ${segs.length} of ${total} periods` : `${total} period${total === 1 ? '' : 's'}`
    const u = new uPlot(
      {
        width: el.clientWidth - 16,
        height: el.clientHeight - 8,
        legend: { show: false },
        cursor: { drag: { x: true, y: true, uni: 20 }, points: { show: false } },
        scales: { x: { time: false } },
        series: [{}, ...segs.map((s) => ({ stroke: s.color, width: 1 }))],
        axes: [
          { ...AXIS, label: `Time in period (s) · ${count} of ${name}`, values: (_u, v) => v.map((x) => eng(x, 's')) },
          { ...AXIS, size: 72, label: unit ? `${name} (${unit})` : name, values: (_u, v) => v.map((x) => eng(x, unit)) }
        ]
      },
      [t, ...segs.map((s) => s.y)],
      (u, init) => (el.appendChild(u.root), init()) // see Plot.tsx: pop-out window elements
    )
    onChart(u)
    const ro = new (el.ownerDocument.defaultView ?? window).ResizeObserver(() => u.setSize({ width: el.clientWidth - 16, height: el.clientHeight - 8 }))
    ro.observe(el)
    return () => (ro.disconnect(), u.destroy(), onChart(null))
  }, [traces, period, offset])
  return <div className="chart" ref={host} />
}
