// Sheet annotations (model.ts Drawing): geometry and SVG. Never netlisted. The same shapes draw custom library symbols.
import type { Drawing, Pt } from './model'
import type { Box } from '../library/Symbol'

export type Shape = Extract<Drawing, { a: Pt }>
export const NOTE = 10 // default note font size
export const NOTE_SIZES: [string, number][] = [['Small', 7], ['Normal', 10], ['Large', 14], ['Huge', 20]]
export const TB = { w: 260, h: 60 } // title block
const r1 = (v: number) => Math.round(v * 10) / 10

const norm = (a: Pt, b: Pt): Box => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) })
const noteLines = (d: { text: string }) => d.text.split('\n')

// ponytail: monospace estimate (char = 0.6em), like the directive cards
export function dbox(d: Drawing): Box {
  if (d.t === 'note') {
    const s = d.size ?? NOTE, l = noteLines(d)
    return { x0: d.x, y0: d.y, x1: d.x + Math.max(1, ...l.map((x) => x.length)) * s * 0.6, y1: d.y + l.length * s * 1.25 }
  }
  if (d.t === 'title') return { x0: d.x, y0: d.y, x1: d.x + TB.w, y1: d.y + TB.h }
  return norm(d.a, d.b)
}
export const moveD = (d: Drawing, v: Pt): Drawing => ('a' in d ? { ...d, a: { x: d.a.x + v.x, y: d.a.y + v.y }, b: { x: d.b.x + v.x, y: d.b.y + v.y } } : { ...d, x: d.x + v.x, y: d.y + v.y })

// stroked + filled SVG path data of a shape (absolute M/L/A/Z only, so Symbol.tsx's pathBox can read it)
export function shapePath(d: Shape): { path: string; fill: string } {
  const { a, b } = d
  if (d.t === 'rect') return { path: `M${a.x} ${a.y}L${b.x} ${a.y}L${b.x} ${b.y}L${a.x} ${b.y}Z`, fill: '' }
  if (d.t === 'ellipse') {
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
    return { path: `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`, fill: '' }
  }
  const line = `M${a.x} ${a.y}L${b.x} ${b.y}`, len = Math.hypot(b.x - a.x, b.y - a.y)
  if (d.t === 'line' || !len) return { path: line, fill: '' }
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, L = Math.min(8, len), W = 3.5
  const p = (s: number) => `${r1(b.x - L * ux - s * W * uy)} ${r1(b.y - L * uy + s * W * ux)}`
  return { path: line, fill: `M${b.x} ${b.y}L${p(1)}L${p(-1)}Z` }
}

// One annotation. cls: 'on' when selected, 'ghost' for the placement preview. sheetNo fills the title block.
export function DrawingEl({ d, cls = '', sheetNo = '1 of 1' }: { d: Drawing; cls?: string; sheetNo?: string }) {
  const id = cls === 'ghost' ? undefined : d.id
  if (d.t === 'note') {
    const s = d.size ?? NOTE, b = dbox(d)
    return (
      <g data-id={id} className={`drw note ${cls}`}>
        <rect className="hitf" x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} />
        <text fontSize={s}>{noteLines(d).map((l, i) => <tspan key={i} x={d.x} y={d.y + (i + 0.85) * s * 1.25}>{l}</tspan>)}</text>
      </g>
    )
  }
  if (d.t === 'title') {
    const { x, y } = d, W = TB.w, H = TB.h, m = x + W / 2
    const cell = (cx: number, cy: number, label: string, v: string) => (
      <text x={cx + 4} y={cy + 12}><tspan className="lb">{label}</tspan> {v}</text>
    )
    return (
      <g data-id={id} className={`drw title ${cls}`}>
        <rect className="hitf" x={x} y={y} width={W} height={H} />
        <path d={`M${x} ${y}H${x + W}V${y + H}H${x}ZM${x} ${y + 24}H${x + W}M${x} ${y + 42}H${x + W}M${m} ${y + 24}V${y + H}`} />
        <text className="tt" x={x + 6} y={y + 17}>{d.title}</text>
        {cell(x, y + 24, 'Author', d.author)}
        {cell(m, y + 24, 'Date', d.date)}
        {cell(x, y + 42, 'Rev', d.rev)}
        {cell(m, y + 42, 'Sheet', sheetNo)}
      </g>
    )
  }
  const { path, fill } = shapePath(d)
  return (
    <g data-id={id} className={`drw ${cls}`}>
      <path className="hit" d={path} />
      <path d={path} />
      {fill && <path className="f" d={fill} />}
    </g>
  )
}
