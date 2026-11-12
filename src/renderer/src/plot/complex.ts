// Nyquist / polar / Smith chart geometry as a list of shapes, painted on a canvas (screen, PNG) or written as SVG. Pure TS.
import { LEG, legendRows } from './export.ts'
import { gamma, smithGrid, ticks } from './views.ts'

export type CTrace = { label: string; color: string; x: Float64Array; re: Float64Array; im: Float64Array; unit: string } // unit 'Ω': an impedance (Smith: Γ from Z0)
export type CvKind = 'nyquist' | 'polar' | 'smith'

export type Shape =
  | { t: 'line'; p: number[]; c: string; w?: number; dash?: boolean } // flat x,y screen points; NaN breaks the line
  | { t: 'dot'; x: number; y: number; r: number; c: string }
  | { t: 'text'; x: number; y: number; s: string; c: string; a?: 'start' | 'middle' | 'end' }
  | { t: 'clip'; rect?: number[]; circle?: number[] } | { t: 'unclip' } // the shapes between are cut at the chart's edge
export type Zoom = { f: number; c?: [number, number] } // wheel zoom: factor, and (Nyquist) the centre in data units
export type Pal = { bg: string; grid: string; axis: string; text: string }
export const DARK: Pal = { bg: '#111316', grid: 'rgba(255,255,255,0.1)', axis: 'rgba(255,255,255,0.3)', text: '#a1a1a1' } // ≈ Plot.tsx axis colours
export const LIGHT: Pal = { bg: '#ffffff', grid: '#e3e6ea', axis: '#999999', text: '#333333' } // = export.ts SVG
const GRID = smithGrid()
export const deg = (re: number, im: number) => (Math.atan2(im, re) * 180) / Math.PI

// the point drawn for sample i: Smith shows Γ (an impedance is converted with Z0), the others the value itself
export const plane = (tr: CTrace, i: number, kind: CvKind, z0: number): [number, number] =>
  kind === 'smith' && tr.unit === 'Ω' ? gamma(tr.re[i], tr.im[i], z0) : [tr.re[i], tr.im[i]]

function at(x: Float64Array, v: number): [number, number] | null {
  if (x.length < 2 || !(v >= x[0] && v <= x[x.length - 1])) return null // live results start with a point or two
  let i = 0
  while (i < x.length - 2 && x[i + 1] < v) i++
  return [i, x[i + 1] === x[i] ? 0 : (v - x[i]) / (x[i + 1] - x[i])]
}

// shapes for a w×h chart; pts: each trace's samples on screen, hit: the same with samples outside the chart as NaN.
// A chart too small to draw (the first render is 0×0, or a very short results panel) has no shapes.
export function scene(kind: CvKind, traces: CTrace[], z0: number, w: number, h: number, pal: Pal, curs: (number | undefined)[], zoom: Zoom = { f: 1 }, eng: (v: number, unit?: string) => string = String) {
  const out: Shape[] = [], m = 28
  let k: number, cx: number, cy: number, clip: Shape, inside: (x: number, y: number) => boolean, mid: [number, number] = [0, 0]
  const none = { shapes: [] as Shape[], pts: traces.map(() => new Float64Array(0)), hit: traces.map(() => new Float64Array(0)), toData: (): [number, number] => [0, 0], mid }
  if (!(Math.min(w, h) >= 2 * m + 40)) return none
  // data bounds (the origin included) and largest magnitude; a loop, not Math.min(...): sweeps have 100k+ points
  let [x0, x1, y0, y1, rmax] = [0, 0, 0, 0, 0]
  for (const tr of traces)
    for (let i = 0; i < tr.re.length; i++) {
      const [a, b] = plane(tr, i, kind, z0)
      if (Number.isFinite(a) && Number.isFinite(b)) (x0 = Math.min(x0, a)), (x1 = Math.max(x1, a)), (y0 = Math.min(y0, b)), (y1 = Math.max(y1, b)), (rmax = Math.max(rmax, Math.hypot(a, b)))
    }
  if (kind === 'nyquist') {
    // equal scales on both axes
    const pad = 0.06 * Math.max(x1 - x0, y1 - y0) || 1
    ;(x0 -= pad), (x1 += pad), (y0 -= pad), (y1 += pad)
    const [mx, my] = zoom.c ?? [(x0 + x1) / 2, (y0 + y1) / 2], hx = (x1 - x0) / 2 / zoom.f, hy = (y1 - y0) / 2 / zoom.f
    ;(x0 = mx - hx), (x1 = mx + hx), (y0 = my - hy), (y1 = my + hy), (mid = [mx, my])
    k = Math.min((w - 2 * m - 30) / (x1 - x0), (h - 2 * m) / (y1 - y0))
    if (!(k > 0 && Number.isFinite(k))) return none
    ;(cx = m + 30 + ((w - 2 * m - 30) - k * (x1 + x0)) / 2), (cy = m + ((h - 2 * m) + k * (y1 + y0)) / 2)
    const X = (v: number) => cx + k * v, Y = (v: number) => cy - k * v
    const step = Math.max(...[ticks(x0, x1, 6), ticks(y0, y1, 6)].map((t) => (t.length > 1 ? t[1] - t[0] : 0)))
    for (const v of ticks(x0, x1, (x1 - x0) / step)) out.push({ t: 'line', p: [X(v), Y(y0), X(v), Y(y1)], c: v ? pal.grid : pal.axis }, { t: 'text', x: X(v), y: Y(y0) + 13, s: eng(v), c: pal.text, a: 'middle' })
    for (const v of ticks(y0, y1, (y1 - y0) / step)) out.push({ t: 'line', p: [X(x0), Y(v), X(x1), Y(v)], c: v ? pal.grid : pal.axis }, { t: 'text', x: X(x0) - 4, y: Y(v) + 4, s: eng(v), c: pal.text, a: 'end' })
    out.push({ t: 'text', x: X(x1) - 2, y: Y(0) + 13, s: 'Re', c: pal.text, a: 'end' }, { t: 'text', x: X(0) + 4, y: Y(y1) + 10, s: 'Im', c: pal.text })
    if (x0 < -1 && x1 > -1 && y0 < 0 && y1 > 0) out.push({ t: 'text', x: X(-1), y: Y(0) + 4, s: '+', c: pal.text, a: 'middle' }, { t: 'text', x: X(-1), y: Y(0) - 6, s: '−1', c: pal.text, a: 'middle' })
    const r = [X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1)]
    ;(clip = { t: 'clip', rect: r }), (inside = (x, y) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3])
  } else {
    const rz = rmax / zoom.f, st = rz > 0 ? ticks(0, rz, 4)[1] : 1, R = kind === 'smith' ? 1 : Math.ceil(rz / st - 1e-9) * st // outer ring: the next round value
    k = (Math.min(w, h) / 2 - m) / R
    if (!(k > 0 && Number.isFinite(k))) return none
    ;(cx = w / 2), (cy = h / 2)
    ;(clip = { t: 'clip', circle: [cx, cy, k * R] }), (inside = (x, y) => Math.hypot(x - cx, y - cy) <= k * R * (1 + 1e-9))
    const P = (re: number, im: number) => [cx + k * re, cy - k * im]
    const circle = (r: number, c: string) => out.push({ t: 'line', p: Array.from({ length: 121 }, (_, i) => P(r * Math.cos((i * Math.PI) / 60), r * Math.sin((i * Math.PI) / 60))).flat(), c })
    if (kind === 'polar') {
      const rs = ticks(0, R, 4).filter((v) => v > 0)
      rs.forEach((r) => circle(r, r === R ? pal.axis : pal.grid))
      rs.forEach((r) => out.push({ t: 'text', x: cx + k * r * Math.cos(Math.PI / 12) + 3, y: cy - k * r * Math.sin(Math.PI / 12), s: eng(r), c: pal.text }))
      for (let a = 0; a < 360; a += 30) {
        const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180)
        out.push({ t: 'line', p: [cx, cy, ...P(R * c, R * s)], c: pal.grid }, { t: 'text', x: cx + (k * R + 14) * c, y: cy - (k * R + 14) * s + 4, s: `${a > 180 ? a - 360 : a}°`, c: pal.text, a: 'middle' })
      }
    } else {
      for (const g of GRID) out.push({ t: 'line', p: g.pts.flatMap(([a, b]) => P(a, b)), c: g.kind === 'r' && g.v === 0 ? pal.axis : pal.grid })
      out.push({ t: 'line', p: [...P(-1, 0), ...P(1, 0)], c: pal.grid })
      for (const g of GRID) {
        if (g.kind === 'r' && g.v) out.push({ t: 'text', x: P((g.v - 1) / (g.v + 1), 0)[0] + 2, y: cy + 11, s: String(g.v), c: pal.text })
        if (g.kind === 'x') { const [a, b] = gamma(0, g.v, 1); out.push({ t: 'text', x: cx + (k + 12) * a, y: cy - (k + 12) * b + 4, s: `${g.v > 0 ? '+' : '−'}j${Math.abs(g.v)}`, c: pal.text, a: 'middle' }) }
      }
      out.push({ t: 'text', x: 6, y: 14, s: `Z0 = ${eng(z0, 'Ω')}`, c: pal.text })
      if (rmax > 1) out.push({ t: 'text', x: 6, y: 28, s: '|Γ| > 1 in places: cut at the edge', c: pal.text })
    }
  }
  const S = (p: [number, number]): [number, number] => [cx + k * p[0], cy - k * p[1]]
  const pts = traces.map((tr) => Float64Array.from(Array.from(tr.re, (_, i) => S(plane(tr, i, kind, z0))).flat()))
  const hit = pts.map((p) => p.map((v, i) => (i % 2 ? v : inside(v, p[i + 1]) ? v : NaN)))
  out.push(clip)
  traces.forEach((tr, i) => out.push({ t: 'line', p: Array.from(pts[i]), c: tr.color, w: 1.5 }))
  // cursor A/B: a dot where each trace is at that frequency, labelled unless there are many traces (sweeps)
  curs.forEach((f, ci) => {
    if (f == null) return
    traces.forEach((tr, ti) => {
      const a = at(tr.x, f)
      if (!a) return
      const [p, q] = [plane(tr, a[0], kind, z0), plane(tr, a[0] + 1, kind, z0)], [x, y] = S([p[0] + a[1] * (q[0] - p[0]), p[1] + a[1] * (q[1] - p[1])])
      out.push({ t: 'dot', x, y, r: 3.5, c: tr.color })
      if (!ti || traces.length <= 8) out.push({ t: 'text', x: x + 6, y: y - 6, s: 'AB'[ci], c: pal.text === LIGHT.text ? '#555' : '#e2e4e8' })
    })
  })
  out.push({ t: 'unclip' })
  // screen -> data, for zooming about the mouse (Nyquist)
  return { shapes: out, pts, hit, toData: (x: number, y: number): [number, number] => [(x - cx) / k, (cy - y) / k], mid }
}

const ok = (...v: number[]) => v.every(Number.isFinite)
// shapes with a non-finite position or a radius <= 0 are skipped (canvas arc() throws on a negative radius)
export function paint(g: CanvasRenderingContext2D, shapes: Shape[]) {
  g.lineJoin = 'round'
  g.font = '11px ui-sans-serif, system-ui, sans-serif'
  let clipped = false
  for (const s of shapes) {
    if (s.t === 'clip') {
      const [x, y, a, b] = s.rect ?? s.circle!
      if (!(ok(x, y, a) && a > 0 && (s.circle || (ok(b) && b > 0)))) continue
      g.save(), g.beginPath(), (clipped = true)
      if (s.rect) g.rect(x, y, a, b)
      else g.arc(x, y, a, 0, 2 * Math.PI)
      g.clip()
      continue
    }
    if (s.t === 'unclip') { if (clipped) g.restore(), (clipped = false); continue }
    g.strokeStyle = g.fillStyle = s.c
    if (s.t === 'text') { if (ok(s.x, s.y)) (g.textAlign = s.a === 'middle' ? 'center' : (s.a ?? 'start')), g.fillText(s.s, s.x, s.y) }
    else if (s.t === 'dot') { if (ok(s.x, s.y) && s.r > 0) g.beginPath(), g.arc(s.x, s.y, s.r, 0, 2 * Math.PI), g.fill() }
    else {
      g.lineWidth = s.w ?? 1
      g.setLineDash(s.dash ? [4, 3] : [])
      g.beginPath()
      let pen = false
      for (let i = 0; i < s.p.length; i += 2) {
        const [x, y] = [s.p[i], s.p[i + 1]]
        if (!Number.isFinite(x) || !Number.isFinite(y)) pen = false
        else if (pen) g.lineTo(x, y)
        else g.moveTo(x, y), (pen = true)
      }
      g.stroke()
    }
  }
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
export function svgOf(shapes: Shape[]): string[] {
  return shapes.map((s) => {
    if (s.t === 'clip') return !(s.rect ?? s.circle)!.every(Number.isFinite) ? '<g>' : `<defs><clipPath id="cv">${s.rect ? `<rect x="${s.rect[0]}" y="${s.rect[1]}" width="${s.rect[2]}" height="${s.rect[3]}"/>` : `<circle cx="${s.circle![0]}" cy="${s.circle![1]}" r="${s.circle![2]}"/>`}</clipPath></defs><g clip-path="url(#cv)">`
    if (s.t === 'unclip') return '</g>'
    if (s.t === 'text') return `<text x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" fill="${s.c}" text-anchor="${s.a ?? 'start'}">${esc(s.s)}</text>`
    if (s.t === 'dot') return `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.r}" fill="${s.c}"/>`
    const runs: string[][] = [[]]
    for (let i = 0; i < s.p.length; i += 2)
      if (Number.isFinite(s.p[i]) && Number.isFinite(s.p[i + 1])) runs[runs.length - 1].push(`${s.p[i].toFixed(1)},${s.p[i + 1].toFixed(1)}`)
      else if (runs[runs.length - 1].length) runs.push([])
    return runs.filter((r) => r.length > 1).map((r) => `<polyline fill="none" stroke="${s.c}" stroke-width="${s.w ?? 1}" points="${r.join(' ')}"/>`).join('')
  })
}
// the chart plus a legend below it, for export
export function withLegend(traces: CTrace[], w: number, h: number, charW: number, pal: Pal) {
  const rows = legendRows(traces.map((t) => ({ label: t.label, color: t.color })), w, charW)
  return { H: h + rows.length * LEG + 6, legend: rows.flatMap((row, r) => row.flatMap(({ x, it }): Shape[] => [{ t: 'line', p: [x, h + 15 + r * LEG, x + 14, h + 15 + r * LEG], c: it.color, w: 2 }, { t: 'text', x: x + 18, y: h + 19 + r * LEG, s: it.label, c: pal.text }])) }
}

