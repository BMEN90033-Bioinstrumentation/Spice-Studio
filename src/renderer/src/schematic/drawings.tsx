// Sheet annotations (model.ts Drawing): geometry and SVG. Never netlisted. The same shapes draw custom library symbols.
import { callout, calloutHub, type Drawing, type Pt } from './model'
import type { Box } from '../library/Symbol'
import { mdChars, parseMd, type MdLine } from './md'

export type Shape = Exclude<Drawing, { t: 'note' } | { t: 'title' }>
export const NOTE = 10 // default note font size
export const NOTE_SIZES: [string, number][] = [['Small', 7], ['Normal', 10], ['Large', 14], ['Huge', 20]]
export const TB = { w: 260, h: 60 } // title block
const r1 = (v: number) => Math.round(v * 10) / 10

const norm = (a: Pt, b: Pt): Box => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) })
const noteLines = (d: { text: string }) => d.text.split('\n')
const MD_PAD = 6, MD_LH = 1.4 // comment block: card padding, line height in em
export const MD_BAN = 13 // and the height of its banner (icon + "Comment block") along the top
const mdBox = (d: { x: number; y: number }, s: number, ls: MdLine[]): Box =>
  ({ x0: d.x, y0: d.y, x1: d.x + Math.max(64, ...ls.map((l) => mdChars(l) * l.k * s * 0.6)) + 2 * MD_PAD, y1: d.y + MD_BAN + ls.reduce((h, l) => h + l.k * s * MD_LH, 0) + 2 * MD_PAD }) // 64: room for the banner

// ponytail: monospace estimate (char = 0.6em), like the directive cards
export function dbox(d: Drawing): Box {
  if (d.t === 'note') {
    const s = d.size ?? NOTE, l = noteLines(d)
    if (d.md) return mdBox(d, s, parseMd(d.text))
    return { x0: d.x, y0: d.y, x1: d.x + Math.max(1, ...l.map((x) => x.length)) * s * 0.6, y1: d.y + l.length * s * 1.25 }
  }
  if (d.t === 'title') return { x0: d.x, y0: d.y, x1: d.x + TB.w, y1: d.y + TB.h }
  if (d.t === 'poly') return { x0: Math.min(...d.pts.map((p) => p.x)), y0: Math.min(...d.pts.map((p) => p.y)), x1: Math.max(...d.pts.map((p) => p.x)), y1: Math.max(...d.pts.map((p) => p.y)) }
  return norm(d.a, d.b)
}
export const moveD = (d: Drawing, v: Pt): Drawing => ('a' in d ? { ...d, a: { x: d.a.x + v.x, y: d.a.y + v.y }, b: { x: d.b.x + v.x, y: d.b.y + v.y } }
  : d.t === 'poly' ? { ...d, pts: d.pts.map((p) => ({ x: p.x + v.x, y: p.y + v.y })) } : { ...d, x: d.x + v.x, y: d.y + v.y })

// stroked + filled SVG path data of a shape (absolute M/L/A/Z only, so Symbol.tsx's pathBox can read it)
export function shapePath(d: Shape): { path: string; fill: string } {
  const solid = (path: string) => ({ path, fill: d.fill ? path : '' })
  if (d.t === 'poly') return solid('M' + d.pts.map((p) => `${p.x} ${p.y}`).join('L') + 'Z')
  const { a, b } = d
  if (d.t === 'rect') return solid(`M${a.x} ${a.y}L${b.x} ${a.y}L${b.x} ${b.y}L${a.x} ${b.y}Z`)
  if (d.t === 'ellipse') {
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
    return solid(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`)
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
    if (d.md) {
      const ls = parseMd(d.text)
      let y = d.y + MD_BAN + MD_PAD
      const x0 = b.x0, y0 = b.y0, x1 = b.x1, yb = b.y0 + MD_BAN
      return (
        <g data-id={id} className={`drw md ${cls}`}>
          <rect className="bg" x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={3} />
          {/* banner: says what the card is. A speech-bubble icon and "Comment block" on a tinted strip with the card's top corners */}
          <path className="ban" d={`M${x0} ${yb}V${y0 + 3}A3 3 0 0 1 ${x0 + 3} ${y0}H${x1 - 3}A3 3 0 0 1 ${x1} ${y0 + 3}V${yb}Z`} />
          <path className="ico" d={`M${x0 + 5} ${y0 + 3.5}H${x0 + 13}V${y0 + 8.5}H${x0 + 8}L${x0 + 5.5} ${y0 + 10.5}V${y0 + 8.5}H${x0 + 5}Z`} />
          <text className="bant" x={x0 + 17} y={y0 + 9.2} fontSize={6.5}>Comment block</text>
          {ls.map((l, i) => {
            const fs = l.k * s, y0 = y
            y += fs * MD_LH
            if (l.rule) return <path key={i} d={`M${b.x0 + MD_PAD} ${y0 + fs * 0.7}H${b.x1 - MD_PAD}`} />
            return (
              <text key={i} x={d.x + MD_PAD} y={y0 + fs} fontSize={fs}>
                {l.spans.map((p, j) => <tspan key={j} className={p.c ? 'c' : undefined} fontWeight={p.b ? 700 : undefined} fontStyle={p.i ? 'italic' : undefined} textDecoration={p.u ? 'underline' : undefined}>{p.s}</tspan>)}
              </text>
            )
          })}
        </g>
      )
    }
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

// A comment block's call-outs: one dot on the card's edge, on the side its targets are, and an arrow from the dot to
// each target box (stopping short of it). Nothing when the targets sit on the card. Drawn over the card, so the dot shows whole.
export function Callouts({ card, targets, cls = '' }: { card: Box; targets: Box[]; cls?: string }) {
  const h = calloutHub(card, targets)
  if (!h) return null
  const at = { x0: h.x, y0: h.y, x1: h.x, y1: h.y }
  return (
    <g className={`drw callout ${cls}`}>
      {targets.map((q, i) => { const l = callout(at, q); if (!l) return null; const { path, fill } = shapePath({ id: '', t: 'arrow', ...l }); return <g key={i}><path d={path} /><path className="f" d={fill} /></g> })}
      <circle cx={h.x} cy={h.y} r={3} />
    </g>
  )
}
