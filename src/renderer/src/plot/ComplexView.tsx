// Nyquist (Im vs Re), polar and Smith views of complex AC / S-parameter traces. uPlot is cartesian only, so this draws
// its own: the chart is a list of shapes (plot/complex.ts), painted on a canvas on screen and for PNG export, written out
// for SVG export.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { eng } from '../Plot'
import { toCsv } from './export'
import { DARK, deg, LIGHT, paint, plane, scene, svgOf, withLegend, type CTrace, type CvKind, type Zoom } from './complex'
export type { CTrace, CvKind }
export type CvApi = { png: () => Promise<Uint8Array>; svg: () => string; csv: () => string }

export function ComplexView({ kind, traces, z0, curs, onCur, xUnit, api }: {
  kind: CvKind; traces: CTrace[]; z0: number; curs: { a?: number; b?: number }; onCur: (k: 'a' | 'b', x: number) => void; xUnit: string; api: RefObject<CvApi | null>
}) {
  const box = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<{ ti: number; i: number } | null>(null)
  const [zoom, setZoom] = useState<Zoom>({ f: 1 }) // Smith stays at |Γ| ≤ 1
  useEffect(() => {
    const el = box.current!
    const ro = new (el.ownerDocument.defaultView ?? window).ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const marks = [curs.a, curs.b]
  const { shapes, pts, hit, toData, mid } = useMemo(() => scene(kind, traces, z0, size.w, size.h, DARK, marks, zoom, eng), [kind, traces, z0, size, curs.a, curs.b, zoom])
  // wheel: zoom (Nyquist about the mouse, polar about the origin); double-click: back to the whole data
  const wheel = (e: React.WheelEvent) => {
    if (kind === 'smith') return
    const r = cv.current!.getBoundingClientRect(), q = e.deltaY < 0 ? 1.25 : 0.8, [px, py] = toData(e.clientX - r.left, e.clientY - r.top)
    setZoom((z) => ({ f: Math.min(1e6, Math.max(1, z.f * q)), c: z.f * q <= 1 ? undefined : [px + (mid[0] - px) / q, py + (mid[1] - py) / q] }))
  }
  const units = [...new Set(traces.map((t) => (t.unit === '1' ? '' : t.unit) || 'no unit'))]
  useEffect(() => {
    const c = cv.current!, pr = c.ownerDocument.defaultView?.devicePixelRatio ?? 1
    ;(c.width = size.w * pr), (c.height = size.h * pr)
    const g = c.getContext('2d')!
    g.scale(pr, pr)
    try {
      paint(g, shapes)
    } catch (e) {
      console.error('complex view:', e) // a bad shape must not take the results panel down
    }
  }, [shapes])

  api.current = {
    svg: () => {
      const { w, h } = size, { shapes } = scene(kind, traces, z0, w, h, LIGHT, marks, zoom, eng), { H, legend } = withLegend(traces, w, h, 7, LIGHT)
      return [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" font-family="Helvetica, Arial, sans-serif" font-size="11">`, `<rect width="${w}" height="${H}" fill="${LIGHT.bg}"/>`, ...svgOf([...shapes, ...legend]), '</svg>'].join('\n')
    },
    png: async () => {
      const { w, h } = size, { H, legend } = withLegend(traces, w, h, 7.5, DARK), pr = 2
      const c = cv.current!.ownerDocument.createElement('canvas')
      ;(c.width = w * pr), (c.height = H * pr)
      const g = c.getContext('2d')!
      g.scale(pr, pr)
      ;(g.fillStyle = DARK.bg), g.fillRect(0, 0, w, H)
      paint(g, [...shapes, ...legend])
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'))
      if (!blob) throw new Error('PNG encoding failed')
      return new Uint8Array(await blob.arrayBuffer())
    },
    csv: () => toCsv('frequency', traces.map((t) => ({ label: '', x: t.x, cols: [{ name: `${t.label} re`, y: t.re }, { name: `${t.label} im`, y: t.im }] })))
  }

  // nearest sample within 12 px of the mouse
  const near = (e: React.MouseEvent) => {
    const r = cv.current!.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top
    let best: { ti: number; i: number } | null = null, bd = 144
    hit.forEach((p, ti) => {
      for (let i = 0; i < p.length; i += 2) {
        const d = (p[i] - mx) ** 2 + (p[i + 1] - my) ** 2
        if (d < bd) (bd = d), (best = { ti, i: i / 2 })
      }
    })
    return best as { ti: number; i: number } | null
  }
  const hv = hover && traces[hover.ti] && pts[hover.ti] && { tr: traces[hover.ti], x: pts[hover.ti][2 * hover.i], y: pts[hover.ti][2 * hover.i + 1] }
  const read = (tr: CTrace, i: number) => {
    const [re, im] = [tr.re[i], tr.im[i]], u = tr.unit === '1' ? '' : tr.unit
    if (kind === 'nyquist') return `Re ${eng(re, u)} · Im ${eng(im, u)}`
    if (kind === 'polar') return `${eng(Math.hypot(re, im), u)} ∠ ${deg(re, im).toFixed(1)}°`
    const [gr, gi] = plane(tr, i, kind, z0), d = (1 - gr) ** 2 + gi ** 2
    const [zr, zi] = tr.unit === 'Ω' ? [re, im] : [(z0 * (1 - gr * gr - gi * gi)) / d, (z0 * 2 * gi) / d] // Z = Z0 (1 + Γ) / (1 − Γ)
    return `Γ ${Math.hypot(gr, gi).toFixed(3)} ∠ ${deg(gr, gi).toFixed(1)}° · Z ${eng(zr)} ${zi < 0 ? '−' : '+'} j${eng(Math.abs(zi))} Ω`
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-col px-2 pt-2">
      <div ref={box} className="relative min-h-0 flex-1 cursor-crosshair">
        <canvas ref={cv} className="absolute inset-0 size-full" onMouseLeave={() => setHover(null)} onMouseMove={(e) => setHover(near(e))} onWheel={wheel} onDoubleClick={() => setZoom({ f: 1 })}
          onClick={(e) => { const n = near(e); if (n) onCur(e.shiftKey ? 'b' : 'a', traces[n.ti].x[n.i]) }} />
        {!traces.length && <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Tick a complex (AC) vector or expression to plot it here</div>}
        {hv && (
          <>
            <div className="pointer-events-none absolute size-2 -translate-1/2 rounded-full ring-2 ring-foreground" style={{ left: hv.x, top: hv.y, background: hv.tr.color }} />
            <div className="pointer-events-none absolute top-0 right-0 z-10 max-w-full rounded-sm border bg-popover px-2 py-1 text-right font-mono text-[11px] shadow-md">
              <div style={{ '--c': hv.tr.color } as CSSProperties}><span className="sw" />{hv.tr.label}</div>
              <div>{eng(hv.tr.x[hover!.i], xUnit)} · {read(hv.tr, hover!.i)}</div>
            </div>
          </>
        )}
      </div>
      <div className="flex max-h-[66px] flex-wrap gap-x-4 overflow-y-auto py-1 text-xs">
        {traces.map((t, i) => <span key={i} style={{ '--c': t.color } as CSSProperties}><span className="sw" />{t.label}</span>)}
        {units.length > 1 && <span className="text-muted-foreground">Different units ({units.join(', ')}) share one scale: untick some, or zoom with the wheel</span>}
      </div>
    </div>
  )
}
