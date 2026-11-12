// Custom symbols for library parts (the symbol editor): graphics + pins on the grid, each pin mapped to a subckt pin
// (subcircuits) or to one of the symbol kind's SPICE pins (models: D, Q, M, J). Saved on the library entry; a placed
// part carries a copy (Part.pins + Part.sym), so it draws and netlists without the library. Pure TS.
import { blockShape, okDrawing, snap, uid, type Drawing, type Part, type Pt } from '../schematic/model.ts'
import { SYMBOLS, type Kind } from '../schematic/symbols.ts'

export type SymPin = { name: string; x: number; y: number; map: number }
export interface CustomSymbol { shapes: Drawing[]; pins: SymPin[] }
type Spice = { type: 'model' } | { type: 'subckt'; pins: string[]; pinMap: number[] }
type Entryish = { kind: Kind; spice?: Spice; symbol?: CustomSymbol }

// what pins can map to: subckt pin names, or the kind's SPICE pin names for a model
export function targets(e: Entryish): string[] {
  if (e.spice?.type === 'subckt') return e.spice.pins
  return SYMBOLS[e.kind].pins.map((_, i) => SYMBOLS[e.kind].pinNames?.[i] ?? `pin ${i + 1}`)
}
// the order the netlister reads a part's pins in: the entry's pin map for subckts (so parts placed before the symbol
// was drawn keep netlisting), the kind's pin order for models
const order = (e: Entryish) => (e.spice?.type === 'subckt' ? e.spice.pinMap : SYMBOLS[e.kind].pins.map((_, i) => i))

// fields for a part placed from e: pins in netlist order + the graphics; undefined without a usable custom symbol
export function symbolFields(e: Entryish): Pick<Part, 'pins' | 'sym'> | undefined {
  const s = e.symbol
  if (!s || symbolErrors(s, e).length) return undefined
  return { pins: order(e).map((j) => { const p = s.pins.find((q) => q.map === j)!; return { name: p.name, x: p.x, y: p.y } }), sym: s.shapes }
}

// problems that would stop the symbol from netlisting; [] = fine
export function symbolErrors(s: CustomSymbol, e: Entryish): string[] {
  const t = targets(e), want = order(e), errs: string[] = []
  for (const j of want) {
    const n = s.pins.filter((p) => p.map === j).length
    if (n !== 1) errs.push(n ? `${t[j]} is connected to ${n} pins` : `No pin connects to ${t[j]}`)
  }
  if (s.pins.some((p) => !want.includes(p.map))) errs.push('A pin is not connected to anything')
  const at = new Set(s.pins.map((p) => `${p.x},${p.y}`))
  if (at.size < s.pins.length) errs.push('Two pins are on the same point')
  if (s.pins.some((p) => p.x % 10 || p.y % 10)) errs.push('Pins must be on the grid')
  return errs
}

// a starting point: the generic block box, pins named and mapped like the entry's current symbol order
export function defaultSymbol(e: Entryish): CustomSymbol {
  const t = targets(e), o = order(e), { pins, size } = blockShape(o.map((j) => t[j]))
  const w = size.w / 2, h = size.h / 2
  const shapes: Drawing[] = [{ id: uid(), t: 'rect', a: { x: -w, y: -h }, b: { x: w, y: h } },
    ...pins.map((p): Drawing => ({ id: uid(), t: 'line', a: { x: p.x, y: p.y }, b: { x: Math.sign(p.x) * w, y: p.y } }))]
  return { shapes, pins: pins.map((p, i) => ({ name: p.name, x: p.x, y: p.y, map: o[i] })) }
}

// the part's standard symbol as editable shapes and pins: what the drawing view starts from. Blocks: the box.
// Open strokes become lines, closed outlines polygons (solid where the symbol fills them).
// ponytail: an arc becomes its chord; no kind a library part can be has one.
export function standardSymbol(e: Entryish): CustomSymbol {
  const d = SYMBOLS[e.kind], o = order(e)
  if (e.kind === 'block' || d.pins.length !== o.length) return defaultSymbol(e)
  const shapes: Drawing[] = d.circle ? [{ id: uid(), t: 'ellipse', a: { x: -d.circle, y: -d.circle }, b: { x: d.circle, y: d.circle } }] : []
  for (const [path, fill] of [[d.path, false], [d.fill ?? '', true]] as const) {
    const t = path.match(/[A-Za-z]|-?[\d.]+/g) ?? []
    let cmd = '', x = 0, y = 0, i = 0, sub: Pt[] = []
    const n = () => +t[i++]
    const end = (closed: boolean) => {
      if (closed && sub.length >= 3) shapes.push({ id: uid(), t: 'poly', pts: sub, ...(fill && { fill }) })
      else for (let k = 1; k < sub.length; k++) shapes.push({ id: uid(), t: 'line', a: sub[k - 1], b: sub[k] })
      sub = []
    }
    const to = (nx: number, ny: number) => ((x = nx), (y = ny), void sub.push({ x, y }))
    while (i < t.length) {
      if (/[A-Za-z]/.test(t[i])) { cmd = t[i++]; if (cmd === 'Z') end(true); else if (cmd === 'M') end(false); continue }
      if (cmd === 'H') to(n(), y)
      else if (cmd === 'V') to(x, n())
      else if (cmd === 'A') (i += 5), to(n(), n())
      else to(n(), n()), cmd === 'M' && (cmd = 'L')
    }
    end(false)
  }
  return { shapes, pins: d.pins.map((p, i) => ({ name: d.pinNames?.[i] ?? `pin ${i + 1}`, x: p.x, y: p.y, map: o[i] })) }
}

// ---- editing a selection (the drawing pad): which shapes and pins, by position
export type Picked = { shapes: number[]; pins: number[] }
const ptsOf = (d: Drawing): Pt[] => ('a' in d ? [d.a, d.b] : d.t === 'poly' ? d.pts : [{ x: d.x, y: d.y }])
const mapShape = (d: Drawing, f: (p: Pt) => Pt): Drawing => ('a' in d ? { ...d, a: f(d.a), b: f(d.b) } : d.t === 'poly' ? { ...d, pts: d.pts.map(f) } : { ...d, ...f({ x: d.x, y: d.y }) })
// f applied to every point of the picked shapes and pins
export const mapPicked = (s: CustomSymbol, k: Picked, f: (p: Pt) => Pt): CustomSymbol => ({
  shapes: s.shapes.map((d, i) => (k.shapes.includes(i) ? mapShape(d, f) : d)),
  pins: s.pins.map((p, i) => (k.pins.includes(i) ? { ...p, ...f({ x: p.x, y: p.y }) } : p))
})
// the picked things turned a quarter clockwise, or mirrored left-right, as one about their centre (on the grid, so
// pins stay on it); nothing picked = the whole symbol. A text keeps reading upright: only its position moves.
export function turnPicked(s: CustomSymbol, k: Picked, how: 'rotate' | 'mirror'): CustomSymbol {
  const all: Picked = k.shapes.length + k.pins.length ? k : { shapes: s.shapes.map((_, i) => i), pins: s.pins.map((_, i) => i) }
  const ps = [...all.shapes.flatMap((i) => ptsOf(s.shapes[i])), ...all.pins.map((i) => s.pins[i])]
  if (!ps.length) return s
  const mid = (v: number[]) => snap((Math.min(...v) + Math.max(...v)) / 2), c = { x: mid(ps.map((p) => p.x)), y: mid(ps.map((p) => p.y)) }
  return mapPicked(s, all, how === 'rotate' ? (p) => ({ x: c.x - (p.y - c.y) + 0, y: c.y + (p.x - c.x) + 0 }) : (p) => ({ x: 2 * c.x - p.x + 0, y: p.y }))
}

// shape check for a symbol read from disk or IPC (main re-checks with this before saving to My library)
export function validSymbol(x: unknown): x is CustomSymbol {
  const s = x as CustomSymbol, n = (v: unknown) => typeof v === 'number' && isFinite(v)
  return !!s && typeof s === 'object' && Array.isArray(s.shapes) && Array.isArray(s.pins) && s.shapes.length <= 500 && s.pins.length <= 256 &&
    s.shapes.every((d) => okDrawing(d) && d.t !== 'title' && (d.t !== 'note' || d.text.length <= 200)) &&
    s.pins.every((p) => p && typeof p.name === 'string' && p.name.length <= 64 && n(p.x) && n(p.y) && Number.isInteger(p.map))
}
