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
export interface Sheet {
  version: 1
  parts: Part[]
  wires: Wire[]
  texts: Directive[]
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
  // ponytail: O(wires²) T-junction scan; spatial index if sheets get to thousands of wires
  for (const w of s.wires)
    for (const e of [w.a, w.b]) if (s.wires.some((o) => o !== w && onSegment(o, e))) add(e, 2)
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

export function newPart(s: Sheet, kind: Kind, x: number, y: number, rot = 0, mirror = false, extra?: Partial<Part>): Part {
  const d = SYMBOLS[kind]
  // new labels/ports get a unique name (n1, n2… / p1, p2…): a shared default would silently join their nets
  const uniq = (pre: string) => nextName({ ...s, parts: s.parts.filter((p) => p.kind === kind).map((p) => ({ ...p, name: p.value })) }, pre)
  const value = kind === 'label' ? uniq('n') : kind === 'port' ? uniq('p') : d.value
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

// Validate a parsed .nsch file; throws on garbage so loading never corrupts state.
export function parseSheet(text: string): Sheet {
  const s = JSON.parse(text)
  if (s?.version !== 1 || !Array.isArray(s.parts) || !Array.isArray(s.wires)) throw new Error('Not a Spice Studio schematic (.nsch v1)')
  const num = (v: unknown) => typeof v === 'number' && isFinite(v)
  const pt = (p: any) => num(p?.x) && num(p?.y)
  for (const p of s.parts) {
    if (!(p?.kind in SYMBOLS)) throw new Error(`Unknown part kind "${p?.kind}"`)
    if (!pt(p) || !num(p.rot) || typeof p.mirror !== 'boolean' || typeof p.name !== 'string' || typeof p.value !== 'string' || typeof p.id !== 'string')
      throw new Error(`Malformed part ${JSON.stringify(p).slice(0, 80)}`)
    const opt = (k: string, ok: (v: any) => boolean) => {
      if (p[k] !== undefined && !ok(p[k])) throw new Error(`Malformed ${k} on part ${p.name || p.id}`)
    }
    opt('sheet', (v) => typeof v === 'string')
    opt('lib', (v) => typeof v === 'string')
    opt('size', (v) => num(v?.w) && num(v?.h))
    opt('pins', (v) => Array.isArray(v) && v.every((q: any) => pt(q) && typeof q.name === 'string'))
  }
  for (const w of s.wires) if (!pt(w?.a) || !pt(w?.b) || typeof w.id !== 'string') throw new Error(`Malformed wire ${JSON.stringify(w).slice(0, 80)}`)
  s.texts ??= [] // Phase 2 files predate directives
  if (!Array.isArray(s.texts)) throw new Error('Malformed texts')
  for (const t of s.texts) if (!pt(t) || typeof t.text !== 'string' || typeof t.id !== 'string') throw new Error(`Malformed directive ${JSON.stringify(t).slice(0, 80)}`)
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
