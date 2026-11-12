// Schematic data model + geometry. Pure functions, no React — shared by the
// editor canvas, file I/O and (Phase 3) the netlister.
import { SYMBOLS, isFlag, type Kind } from './symbols.ts' // .ts so node --test can load it

export const GRID = 10
export type Pt = { x: number; y: number }

export interface Part {
  id: string
  kind: Kind
  x: number
  y: number
  rot: number // quarter turns clockwise, 0..3
  mirror: boolean // mirrored in local X before rotation
  name: string // "R1"; '' for gnd/label
  value: string // "1k", model name, or net name for labels/ports
  sheet?: string // block: sheet file relative to the project dir, e.g. 'filter.nsch'
  pins?: { name: string; x: number; y: number }[] // per-instance pins (blocks), local coords; overrides the symbol's
  size?: { w: number; h: number } // block body, centred on origin
  lib?: string // library entry id, e.g. 'std:2N3904'
  lo?: Pt // name label dragged away from its default spot: offset in sheet units
  vo?: Pt // the same for the value label
  sym?: Drawing[] // custom library symbol (symbol editor): its graphics in local coords; its pins are in `pins`
}
export interface Wire {
  id: string
  a: Pt
  b: Pt
}
// SPICE directive block placed on the sheet (".tran 1u 1m", ".include models.lib", ...),
// emitted verbatim by the netlister. Multi-line allowed.
export interface Directive {
  id: string
  x: number
  y: number
  text: string
}
// Annotations, never netlisted: shapes from a to b, free text notes (size = font size, default 10), and the
// sheet's title block (one per sheet; "sheet n of m" is filled in when drawn).
export type Drawing =
  | { id: string; t: 'line' | 'arrow' | 'rect' | 'ellipse'; a: Pt; b: Pt; fill?: boolean } // fill: rect / ellipse drawn solid
  | { id: string; t: 'poly'; pts: Pt[]; fill?: boolean } // closed outline (a triangle…): custom symbols only, the sheet has no tool for it
  | { id: string; t: 'note'; x: number; y: number; text: string; size?: number }
  | { id: string; t: 'title'; x: number; y: number; title: string; author: string; date: string; rev: string }
export interface Sheet {
  version: 1
  parts: Part[]
  wires: Wire[]
  texts: Directive[]
  draw?: Drawing[] // absent in older files
  buses?: Wire[] // bus segments: connect only to each other (and bus taps / bus labels), never to wires or pins
}

export const emptySheet = (): Sheet => ({ version: 1, parts: [], wires: [], texts: [] })
export const snap = (v: number) => Math.round(v / GRID) * GRID
export const key = (p: Pt) => `${p.x},${p.y}`
export const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y
let seq = 0
export const uid = () => Date.now().toString(36) + (seq++).toString(36)

// local symbol coords -> world. Matches SVG `translate(x y) rotate(rot*90) scale(mirror?-1:1 1)`.
export function xform(p: Pick<Part, 'x' | 'y' | 'rot' | 'mirror'>, q: Pt): Pt {
  let { x, y } = q
  if (p.mirror) x = -x
  for (let i = 0; i < (((p.rot % 4) + 4) % 4); i++) [x, y] = [-y, x]
  return { x: p.x + x + 0, y: p.y + y + 0 } // +0 normalises -0
}

export const pins = (p: Part): Pt[] => (p.pins ?? SYMBOLS[p.kind].pins).map((q) => xform(p, q))

// Generic block box for a sheet's ports: first half on the left, rest on the right, 20 apart, 20-long stubs.
export function blockShape(ports: string[]): { pins: { name: string; x: number; y: number }[]; size: { w: number; h: number } } {
  const left = ports.slice(0, Math.ceil(ports.length / 2)), right = ports.slice(left.length)
  const len = (a: string[]) => Math.max(0, ...a.map((n) => n.length))
  // ponytail: 6px/char text estimate, same as the directive cards
  const w = Math.max(80, Math.ceil(((len(left) + len(right)) * 6 + 30) / 20) * 20)
  const h = (Math.max(1, left.length, right.length) + 1) * 20
  const side = (a: string[], x: number) => a.map((name, i) => ({ name, x, y: -h / 2 + 20 * (i + 1) }))
  return { pins: [...side(left, -w / 2 - 20), ...side(right, w / 2 + 20)], size: { w, h } }
}

// Re-fit block parts `ids` to `ports`. Wire ends on a surviving pin (matched by name, any case) follow it; wires on
// removed pins stay put (dangling), so a port added mid-list never shifts wires onto the wrong pins.
export function reshapeBlocks(s: Sheet, ids: Set<string>, ports: string[]): Sheet {
  const m = new Map<string, Pt>(), shape = blockShape(ports)
  const parts = s.parts.map((p) => {
    if (!ids.has(p.id)) return p
    const n = { ...p, ...shape }, at = new Map(shape.pins.map((q) => [q.name.toLowerCase(), xform(n, q)]))
    for (const q of p.pins ?? []) { const t = at.get(q.name.toLowerCase()); if (t) m.set(key(xform(p, q)), t) }
    return n
  })
  return { ...s, parts, wires: s.wires.map((w) => ({ ...w, a: m.get(key(w.a)) ?? w.a, b: m.get(key(w.b)) ?? w.b })) }
}

// Port names of a sheet (= its subckt pins), left-to-right then top-to-bottom; duplicates (case-insensitive) once.
export function sheetPorts(s: Sheet): string[] {
  const seen = new Set<string>()
  return s.parts
    .filter((p) => p.kind === 'port')
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((p) => p.value)
    .filter((n) => !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()))
}

// p strictly inside segment w (endpoints excluded); works for diagonal wires.
export function onSegment(w: Wire, p: Pt): boolean {
  const { a, b } = w
  if (same(p, a) || same(p, b)) return false
  if ((b.x - a.x) * (p.y - a.y) !== (b.y - a.y) * (p.x - a.x)) return false
  return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)
}

// The wires whose interior contains a point, from an index of the wires by row and column (diagonals scanned)
export function wiresThrough(ws: Wire[]): (p: Pt) => Wire[] {
  const rows = new Map<number, Wire[]>(), cols = new Map<number, Wire[]>(), diag: Wire[] = []
  for (const w of ws) {
    const m = w.a.y === w.b.y ? rows : w.a.x === w.b.x ? cols : null, k = w.a.y === w.b.y ? w.a.y : w.a.x
    if (m) (m.get(k) ?? m.set(k, []).get(k)!).push(w)
    else diag.push(w)
  }
  return (p) => [...(rows.get(p.y) ?? []), ...(cols.get(p.x) ?? []), ...diag].filter((w) => onSegment(w, p))
}

// Connectivity rules (the netlister must follow the same ones):
//  - wire endpoints and pins connect when they coincide;
//  - a wire endpoint landing mid-way along another wire connects (T-junction);
//  - a pin does NOT connect to a wire interior, so a part dropped on a wire isn't shorted.
// For each point: `all` = everything meeting there, `real` = excluding gnd/label pins.
// Junction dot: real >= 3. Unconnected pin: all === 1.
export function connections(s: Sheet): Map<string, { all: number; real: number }> {
  const m = new Map<string, { all: number; real: number }>()
  const add = (p: Pt, n: number, flag = false) => {
    const c = m.get(key(p)) ?? { all: 0, real: 0 }
    c.all += n
    if (!flag) c.real += n
    m.set(key(p), c)
  }
  for (const w of s.wires) add(w.a, 1), add(w.b, 1)
  for (const p of s.parts) for (const q of pins(p)) add(q, 1, isFlag(p.kind))
  const through = wiresThrough(s.wires)
  for (const w of s.wires)
    for (const e of [w.a, w.b]) if (through(e).some((o) => o !== w)) add(e, 2)
  return m
}

export function junctions(s: Sheet): Pt[] {
  return [...connections(s)].filter(([, c]) => c.real >= 3).map(([k]) => {
    const [x, y] = k.split(',').map(Number)
    return { x, y }
  })
}

export function unconnectedPins(s: Sheet): Pt[] {
  const c = connections(s)
  return s.parts.filter((p) => !isFlag(p.kind)).flatMap(pins).filter((q) => c.get(key(q))!.all === 1)
}

// Next free name for a prefix: R1, R2 -> "R3".
export function nextName(s: Sheet, prefix: string): string {
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i')
  const max = Math.max(0, ...s.parts.map((p) => +(re.exec(p.name)?.[1] ?? 0)))
  return prefix + (max + 1)
}

// Bus label name "D[0..7]" (or D[7..0]) -> its member nets D0..D7; null for an ordinary name
export function busMembers(v: string): string[] | null {
  const m = /^([A-Za-z_][\w]*)\[(\d+)\.\.(\d+)\]$/.exec(v.trim())
  if (!m) return null
  const a = +m[2], b = +m[3], st = a <= b ? 1 : -1
  return Math.abs(b - a) > 1023 ? null : Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => m[1] + (a + i * st))
}

export function newPart(s: Sheet, kind: Kind, x: number, y: number, rot = 0, mirror = false, extra?: Partial<Part>): Part {
  const d = SYMBOLS[kind]
  // new labels/ports get a unique name (n1, n2… / p1, p2…): a shared default would silently join their nets
  const uniq = (pre: string) => nextName({ ...s, parts: s.parts.filter((p) => p.kind === kind).map((p) => ({ ...p, name: p.value })) }, pre)
  // a new bus tap takes the member after the last tap's (D3 -> D4), so a row of taps fans a bus out in order
  const tap = () => { const v = s.parts.findLast((p) => p.kind === 'bustap')?.value ?? '', m = /^(.*?)(\d+)$/.exec(v); return m ? m[1] + (+m[2] + 1) : d.value }
  const value = kind === 'label' ? uniq('n') : kind === 'port' ? uniq('p') : kind === 'bustap' ? tap() : d.value
  return { id: uid(), kind, x, y, rot, mirror, name: d.prefix ? nextName(s, d.prefix) : '', value, ...extra }
}

// Orthogonal two-segment route from a to b (horizontal first unless vFirst); drops zero-length segments.
export function route(a: Pt, b: Pt, vFirst = false): Wire[] {
  const c = vFirst ? { x: a.x, y: b.y } : { x: b.x, y: a.y }
  return [
    { id: uid(), a, b: c },
    { id: uid(), a: c, b }
  ].filter((w) => !same(w.a, w.b))
}

// Wire w with its ends moved to a, b. A move that would leave it diagonal becomes an L instead, the end that stayed put
// leaving in the wire's original direction (KiCad-style drag). The first segment keeps w's id.
export function stretch(w: Wire, a: Pt, b: Pt): Wire[] {
  if (a.x === b.x || a.y === b.y) return [{ ...w, a, b }]
  const vert = w.a.x === w.b.x && w.a.y !== w.b.y
  const r = same(b, w.b) && !same(a, w.a) ? route(b, a, vert) : route(a, b, vert)
  r[0] = { ...r[0], id: w.id }
  return r
}

// Apply f to selected parts and g to selected wires' endpoints. Any wire endpoint (selected or not) that sat on a
// moved pin or moved wire endpoint follows it, so connections rubber-band through moves, rotates and mirrors. A moved
// pin that touched a pin of a part staying put gets a new wire back to it, so pin-to-pin connections survive too.
export function remap(s: Sheet, sel: Set<string>, f: (p: Part) => Part, g: (q: Pt) => Pt = (q) => q): Sheet {
  const m = new Map<string, Pt>()
  const still = new Set(s.parts.filter((p) => !sel.has(p.id)).flatMap((p) => pins(p).map(key)))
  for (const w of s.wires) if (sel.has(w.id)) for (const q of [w.a, w.b]) m.set(key(q), g(q))
  const parts = s.parts.map((p) => {
    if (!sel.has(p.id)) return p
    const n = f(p), b = pins(n)
    pins(p).forEach((q, i) => m.set(key(q), b[i]))
    return n
  })
  // m now holds every moved point (a part pin wins over a wire end); tie each one that left a still pin back to it
  const added = [...m].flatMap(([k, n]) => {
    const [x, y] = k.split(',').map(Number)
    return still.has(k) ? route({ x, y }, n) : []
  })
  const wires = s.wires.flatMap((w) => {
    const h = (q: Pt) => m.get(key(q)) ?? (sel.has(w.id) ? g(q) : q)
    return stretch(w, h(w.a), h(w.b))
  })
  return { ...s, parts, wires: [...wires, ...added] }
}

export const NOTE_MIN = 4, NOTE_MAX = 72 // note font sizes kept on load
// a shape or bus segment turned a quarter clockwise (rot) or mirrored left-right about its own grid-snapped centre;
// notes and the title block stay as they are (their text reads upright)
export function turnSeg<T extends { a: Pt; b: Pt }>(w: T, rot: boolean): T {
  const c = { x: snap((w.a.x + w.b.x) / 2), y: snap((w.a.y + w.b.y) / 2) }
  const f = (q: Pt): Pt => (rot ? { x: c.x - (q.y - c.y) + 0, y: c.y + (q.x - c.x) + 0 } : { x: 2 * c.x - q.x + 0, y: q.y })
  return { ...w, a: f(w.a), b: f(w.b) }
}
const num = (v: unknown) => typeof v === 'number' && isFinite(v)
const pt = (p: any) => num(p?.x) && num(p?.y)
const str = (v: unknown) => typeof v === 'string'
export const okDrawing = (d: any): d is Drawing => str(d?.id) && (d.t === 'note' ? pt(d) && str(d.text) && (d.size === undefined || num(d.size))
  : d.t === 'title' ? pt(d) && ['title', 'author', 'date', 'rev'].every((k) => str(d[k]))
  : (d.fill === undefined || typeof d.fill === 'boolean') && (d.t === 'poly' ? Array.isArray(d.pts) && d.pts.length >= 3 && d.pts.length <= 64 && d.pts.every(pt)
  : ['line', 'arrow', 'rect', 'ellipse'].includes(d.t) && pt(d.a) && pt(d.b)))

// Validate a parsed .nsch file; throws on garbage so loading never corrupts state.
export function parseSheet(text: string): Sheet {
  const s = JSON.parse(text)
  if (s?.version !== 1 || !Array.isArray(s.parts) || !Array.isArray(s.wires)) throw new Error('Not a Spice Studio schematic (.nsch v1)')
  for (const p of s.parts) {
    if (!(p?.kind in SYMBOLS)) throw new Error(`Unknown part kind "${p?.kind}"`)
    if (!pt(p) || !num(p.rot) || typeof p.mirror !== 'boolean' || typeof p.name !== 'string' || typeof p.value !== 'string' || typeof p.id !== 'string')
      throw new Error(`Malformed part ${JSON.stringify(p).slice(0, 80)}`)
    const opt = (k: string, ok: (v: any) => boolean) => {
      if (p[k] !== undefined && !ok(p[k])) throw new Error(`Malformed ${k} on part ${p.name || p.id}`)
    }
    opt('sheet', (v) => typeof v === 'string')
    opt('lib', (v) => typeof v === 'string')
    opt('lo', pt)
    opt('vo', pt)
    opt('size', (v) => num(v?.w) && num(v?.h))
    opt('pins', (v) => Array.isArray(v) && v.every((q: any) => pt(q) && typeof q.name === 'string'))
    opt('sym', (v) => Array.isArray(v) && v.every(okDrawing))
  }
  for (const w of s.wires) if (!pt(w?.a) || !pt(w?.b) || typeof w.id !== 'string') throw new Error(`Malformed wire ${JSON.stringify(w).slice(0, 80)}`)
  s.texts ??= [] // Phase 2 files predate directives
  if (!Array.isArray(s.texts)) throw new Error('Malformed texts')
  for (const t of s.texts) if (!pt(t) || typeof t.text !== 'string' || typeof t.id !== 'string') throw new Error(`Malformed directive ${JSON.stringify(t).slice(0, 80)}`)
  if (s.draw !== undefined) {
    if (!Array.isArray(s.draw)) throw new Error('Malformed draw')
    for (const d of s.draw) if (!okDrawing(d)) throw new Error(`Malformed drawing ${JSON.stringify(d).slice(0, 80)}`)
    // one title block per sheet; note sizes within reason
    s.draw = s.draw.filter((d: Drawing, i: number) => d.t !== 'title' || s.draw.findIndex((x: Drawing) => x.t === 'title') === i)
    for (const d of s.draw) if (d.t === 'note' && d.size !== undefined) d.size = Math.min(NOTE_MAX, Math.max(NOTE_MIN, d.size))
  }
  if (s.buses !== undefined && !(Array.isArray(s.buses) && s.buses.every((w: any) => pt(w?.a) && pt(w?.b) && typeof w.id === 'string'))) throw new Error('Malformed buses')
  return s
}

// Demo circuit: RC low-pass, same as the netlist example.
export function exampleSheet(): Sheet {
  const s = emptySheet()
  const add = (kind: Kind, x: number, y: number, rot = 0, value?: string) => {
    const p = newPart(s, kind, x, y, rot)
    if (value != null) p.value = value
    s.parts.push(p)
  }
  add('vsrc', 0, 0, 0, 'DC 0 AC 1 PULSE(0 1 0 1u 1u 5m 10m)')
  add('res', 60, -60, 3, '1k')
  add('cap', 120, 0, 0, '1u')
  add('gnd', 0, 30)
  add('gnd', 120, 30)
  add('label', 120, -60, 0, 'out')
  s.wires.push(...route({ x: 0, y: -30 }, { x: 30, y: -60 }, true), ...route({ x: 90, y: -60 }, { x: 120, y: -30 }))
  s.texts.push({ id: uid(), x: -20, y: 70, text: '.tran 10u 20m\n.ac dec 50 1 100k' })
  return s
}
