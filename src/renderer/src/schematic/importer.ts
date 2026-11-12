// File › Import Schematic…: LTspice .asc and KiCad .kicad_sch onto this app's parts. Pure TS (node --test loads it).
// Both readers produce a Foreign drawing in our units (scaled so the source grid lands on ours: LTspice 16 → 10,
// KiCad 1.27 mm → 10); build() then places our symbols with their pins on the source pins (best of 8 orientations,
// short stub wires where our symbol's pin spacing differs), so the connectivity is the source's. Anything unmapped
// becomes a placeholder block with the source pins (the netlister refuses it) and a line in the report.
import { onSegment, snap, uid, xform, type Drawing, type Part, type Pt, type Sheet, type Wire, emptySheet, route, same } from './model.ts'
import { SYMBOLS, type Kind } from './symbols.ts'
import { BUNDLED, si } from '../library/library.ts'

export interface Imported { sheet: Sheet; report: string[]; summary: string }
type FPart = { kind: Kind; name: string; value: string; lib?: string; pins: Pt[] /* world, our pin order */; rot: number; mirror: boolean }
type Hole = { name: string; value: string; at: Pt; pins: { name: string; at: Pt }[] } // at: centre when there are no pins
interface Foreign {
  wires: [Pt, Pt][]
  flags: { kind: 'gnd' | 'label' | 'port' | 'power'; at: Pt; name: string; rot?: number }[] // rot: labels/ports face away from their wires when absent
  parts: FPart[]
  holes: Hole[]
  texts: { at: Pt; text: string }[] // SPICE directives
  draw: Drawing[] // notes and graphics
  junctions: Pt[]
  report: string[]
}
const foreign = (): Foreign => ({ wires: [], flags: [], parts: [], holes: [], texts: [], draw: [], junctions: [], report: [] })
const P = (x: number, y: number): Pt => ({ x: snap(x) + 0, y: snap(y) + 0 })
// P for connection points, counting distinct source points that land on the same grid point (off-grid sources)
function snapper() {
  const seen = new Map<string, Pt>()
  let merged = 0
  return {
    pt(x: number, y: number) {
      const q = P(x, y), k = `${q.x},${q.y}`, o = seen.get(k)
      if (!o) seen.set(k, { x, y })
      else if (Math.abs(o.x - x) + Math.abs(o.y - y) > 0.05) merged++
      return q
    },
    get merged() { return merged },
    report: (f: Foreign, grid: string) => void (merged && f.report.push(`${merged} connection point${merged > 1 ? 's were' : ' was'} off the ${grid} grid and snapped onto a neighbour: check the nets around them`))
  }
}

// a bundled library part of that name and a compatible symbol: placed as that part (its model comes along)
const MODEL_KINDS: Partial<Record<Kind, Kind[]>> = { diode: ['diode', 'zener', 'led'], zener: ['zener', 'diode'], led: ['led', 'diode'], npn: ['npn'], pnp: ['pnp'], nmos: ['nmos'], pmos: ['pmos'], njf: ['njf'], pjf: ['pjf'], opamp5: ['opamp5'] }
function libPart(kind: Kind, value: string): { kind: Kind; lib?: string } {
  const e = MODEL_KINDS[kind] && BUNDLED.find((b) => b.spice && b.name.toLowerCase() === value.toLowerCase() && MODEL_KINDS[kind]!.includes(b.kind))
  return e ? { kind: e.kind, lib: e.id } : { kind }
}

// ---------------------------------------------------------------------------------------------- placing our symbols

// The source's connectivity on our grid. Nodes: wire ends, flags, junctions, source pins; wire ends join, and a node
// on a wire's middle joins that wire (both formats connect it; build() splits the wire there). Placed pins and stubs
// are added as parts go down, so later parts avoid them too.
class Nets {
  up = new Map<string, string>()
  segs: { a: Pt; b: Pt; k: string }[] = []
  find = (k: string): string => { const p = this.up.get(k) ?? k; if (p === k) return k; const r = this.find(p); this.up.set(k, r); return r }
  union(a: string, b: string) { const x = this.find(a), y = this.find(b); if (x !== y) this.up.set(x, y) }
  constructor(f: Foreign) {
    const K = (q: Pt) => `${q.x},${q.y}`
    for (const [a, b] of f.wires) if (!same(a, b)) this.add(a, K(a)), this.add(b, K(a)), this.segs.push({ a, b, k: K(a) })
    const nodes = [...f.wires.flat(), ...f.flags.map((g) => g.at), ...f.junctions, ...f.parts.flatMap((p) => p.pins), ...f.holes.flatMap((h) => h.pins.map((q) => q.at))]
    for (const q of nodes) {
      if (!this.up.has(K(q))) this.up.set(K(q), K(q))
      for (const w of this.segs) if (onSegment({ id: '', ...w }, q)) this.union(K(q), w.k)
    }
  }
  at(q: Pt): string | null {
    const k = `${q.x},${q.y}`
    if (this.up.has(k)) return this.find(k)
    const w = this.segs.find((w) => onSegment({ id: '', ...w }, q))
    return w ? this.find(w.k) : null
  }
  // nets of the nodes strictly inside segment a-b
  inside(a: Pt, b: Pt): string[] {
    const w = { id: '', a, b }
    return [...this.up.keys()].filter((k) => { const [x, y] = k.split(',').map(Number); return onSegment(w, { x, y }) }).map(this.find)
  }
  add(q: Pt, net: string) { const k = `${q.x},${q.y}`; if (!this.up.has(k)) this.up.set(k, k); this.union(k, net) }
  addSeg(a: Pt, b: Pt, net: string) { this.add(a, net), this.add(b, net), this.segs.push({ a, b, k: net }) }
}

type Plan = { a: Pt; how: 'exact' | 'stub' | 'label' | 'bad'; segs?: Wire[] }
// Our symbol's orientation and position that touch no other net, put the most pins exactly on their source pins, then
// need the fewest label pairs and the shortest stubs (L-shaped wires to the source pin), then keep the source's
// orientation. A pin whose stub would touch another net is joined to its source pin by a pair of net labels instead.
function fit(f: FPart, nets: Nets): { part: Pick<Part, 'x' | 'y' | 'rot' | 'mirror'>; plan: Plan[] } {
  const local = SYMBOLS[f.kind].pins, tgt = f.pins.map((q) => nets.at(q)!)
  let best: { score: number[]; at: Pick<Part, 'x' | 'y' | 'rot' | 'mirror'>; plan: Plan[] } | null = null
  for (let rot = 0; rot < 4; rot++)
    for (const mirror of [false, true]) {
      const t = local.map((q) => xform({ x: 0, y: 0, rot, mirror }, q))
      for (let j = 0; j < t.length; j++) {
        const c = { x: f.pins[j].x - t[j].x, y: f.pins[j].y - t[j].y }
        let len = 0
        const plan = t.map((q, i): Plan => {
          const a = { x: q.x + c.x, y: q.y + c.y }, to = f.pins[i], n = tgt[i]
          if (same(a, to)) return { a, how: 'exact' }
          const na = nets.at(a)
          if (na && na !== n) return { a, how: 'bad' }
          const segs = route(a, to, a.x === to.x)
          const ok = segs.every((w) => [w.a, w.b].every((p) => { const x = nets.at(p); return !x || x === n }) && nets.inside(w.a, w.b).every((x) => x === n))
          if (!ok) return { a, how: 'label' }
          len += Math.abs(a.x - to.x) + Math.abs(a.y - to.y)
          return { a, how: 'stub', segs }
        })
        const cnt = (h: Plan['how']) => plan.filter((x) => x.how === h).length
        const score = [-cnt('bad'), cnt('exact'), -cnt('label'), -len, +(rot === f.rot % 4 && mirror === f.mirror)], k = best ? score.findIndex((v, i) => v !== best!.score[i]) : 0
        if (!best || (k >= 0 && score[k] > best.score[k])) best = { score, at: { ...c, rot, mirror }, plan }
      }
    }
  best!.plan.forEach((x, i) => (x.segs ? x.segs.forEach((w) => nets.addSeg(w.a, w.b, tgt[i])) : nets.add(x.a, tgt[i])))
  return { part: best!.at, plan: best!.plan }
}

// Imported files are untrusted. A .control … .endc block runs ngspice commands at Run (shell, system, file writes):
// comment it out, line by line, so it is kept but inert (an unterminated .control too). .include / .lib stay as
// written; those reaching outside the project (absolute path, ..) are named in the report.
export function defang(texts: { text: string }[], report: string[]): void {
  for (const t of texts) {
    let on = false, n = 0
    t.text = t.text.split('\n').map((l) => {
      if (/^\s*\.control\b/i.test(l)) (on = true), n++
      const out = on ? '* ' + l : l
      if (on && /^\s*\.endc\b/i.test(l)) on = false
      return out
    }).join('\n')
    for (let i = 0; i < n; i++) report.push('A .control block was disabled (turned into comment lines): it runs ngspice commands, which can include shell commands, when you press Run. Check it, then remove the "* " prefixes if you trust it')
    for (const m of t.text.matchAll(/^\s*\.(lib|inc\w*)\s+(.+?)\s*$/gim)) {
      const path = m[2].replace(/^["']|["']$/g, '')
      report.push(/^([\\/~]|[a-z]:[\\/])/i.test(path) || /(^|[\\/])\.\.([\\/]|$)/.test(path)
        ? `".${m[1]} ${m[2]}" reads a file outside the project folder: check it before running`
        : `".${m[1]} ${m[2]}" kept: ngspice must find that file`)
    }
  }
}

function build(f: Foreign, what: string): Imported {
  defang(f.texts, f.report)
  const s: Sheet = { ...emptySheet(), draw: [] }
  const named = new Map<string, number>()
  const nm = (n: string, kind: Kind, keep = false) => {
    const pre = SYMBOLS[kind].prefix || 'X'
    let r = n.trim() || pre + '?'
    if (!keep && !r.toUpperCase().startsWith(pre)) r = pre + r // U1 (an op-amp) -> XU1: SPICE wants the element letter
    if (/\s/.test(r) || named.has(r.toLowerCase())) { let i = 1; while (named.has((pre + i).toLowerCase())) i++; r = pre + i }
    named.set(r.toLowerCase(), 1)
    return r
  }
  const stubs: Wire[] = [], nets = new Nets(f)
  for (const p of f.parts) {
    const { part, plan } = fit(p, nets), name = nm(p.name, p.kind)
    s.parts.push({ id: uid(), kind: p.kind, ...part, name, value: p.value || SYMBOLS[p.kind].value, ...(p.lib && { lib: p.lib }) })
    plan.forEach((x, i) => {
      if (x.segs) stubs.push(...x.segs)
      if (x.how === 'label') for (const at of [x.a, p.pins[i]]) f.flags.push({ kind: 'label', at, name: `${name}_${i + 1}` })
    })
    if (plan.some((x) => x.how === 'bad')) f.report.push(`${name}: no position for this symbol keeps its pins off other nets: check its connections`)
  }
  for (const h of f.holes) {
    // placeholder: a generic block whose pins sit exactly on the source pins
    const xs = [h.at.x, ...h.pins.map((q) => q.at.x)].slice(h.pins.length ? 1 : 0), ys = [h.at.y, ...h.pins.map((q) => q.at.y)].slice(h.pins.length ? 1 : 0)
    const x = snap((Math.min(...xs) + Math.max(...xs)) / 2), y = snap((Math.min(...ys) + Math.max(...ys)) / 2)
    const w = Math.max(40, Math.max(...xs) - Math.min(...xs) - 20), hh = Math.max(40, Math.max(...ys) - Math.min(...ys) - 20)
    s.parts.push({ id: uid(), kind: 'block', x, y, rot: 0, mirror: false, name: nm(h.name, 'block', true), value: '?' + h.value, pins: h.pins.map((q) => ({ name: q.name, x: q.at.x - x, y: q.at.y - y })), size: { w, h: hh } })
  }
  // a label points right, left, up or down: the first way no wire leaves its point
  const used = (q: Pt, dx: number, dy: number) => [...f.wires, ...stubs.map((w): [Pt, Pt] => [w.a, w.b])].some(([a, b]) =>
    [[a, b], [b, a]].some(([u, v]) => same(u, q) && Math.sign(v.x - u.x) === dx && Math.sign(v.y - u.y) === dy) || (onSegment({ id: '', a, b }, q) && (dx ? a.y === b.y : a.x === b.x)))
  const face = (q: Pt) => ([[1, 0, 0], [-1, 0, 2], [0, -1, 3], [0, 1, 1]].find(([dx, dy]) => !used(q, dx, dy)) ?? [0, 0, 0])[2]
  for (const g of f.flags)
    s.parts.push({ id: uid(), kind: g.kind, x: g.at.x, y: g.at.y, rot: g.rot ?? (g.kind === 'label' || g.kind === 'port' ? face(g.at) : 0), mirror: false, name: '', value: g.kind === 'gnd' ? '' : g.name })
  // wires: a pin, flag, junction or wire end sitting on another wire's middle joins it there (both formats connect
  // those; this app's rule joins only wire ends), so split the wire at those points
  const cut = [...s.parts.flatMap((p) => (p.pins ?? SYMBOLS[p.kind].pins).map((q) => xform(p, q))), ...f.junctions, ...f.wires.flat(), ...stubs.flatMap((w) => [w.a, w.b])]
  let wires: Wire[] = f.wires.filter(([a, b]) => !same(a, b)).map(([a, b]) => ({ id: uid(), a, b }))
  for (const q of cut) wires = wires.flatMap((w) => (onSegment(w, q) ? [{ id: uid(), a: w.a, b: q }, { id: uid(), a: q, b: w.b }] : [w]))
  s.wires = [...wires, ...stubs]
  s.texts = f.texts.map((t) => ({ id: uid(), x: t.at.x, y: t.at.y, text: t.text }))
  s.draw = f.draw
  if (!s.draw.length) delete s.draw
  const n = f.parts.length
  const summary = `${what}: ${n} part${n === 1 ? '' : 's'}, ${f.flags.length} flag${f.flags.length === 1 ? '' : 's'}, ${s.wires.length} wire${s.wires.length === 1 ? '' : 's'}` +
    (f.holes.length ? `, ${f.holes.length} placeholder${f.holes.length === 1 ? '' : 's'}` : '')
  return { sheet: s, report: f.report, summary }
}

// ---------------------------------------------------------------------------------------------- LTspice .asc

// symbol -> our kind and its pins in the .asy (LTspice units), listed in OUR pin order
type AscSym = { kind: Kind; pins: [number, number][] }
const two = (a: [number, number], b: [number, number]): [number, number][] => [a, b]
const ASC: Record<string, AscSym> = {
  res: { kind: 'res', pins: two([16, 16], [16, 96]) }, res2: { kind: 'res', pins: two([16, 0], [16, 64]) },
  cap: { kind: 'cap', pins: two([16, 0], [16, 64]) }, polcap: { kind: 'cap', pins: two([16, 0], [16, 64]) },
  ind: { kind: 'ind', pins: two([16, 16], [16, 96]) }, ind2: { kind: 'ind', pins: two([16, 16], [16, 96]) },
  voltage: { kind: 'vsrc', pins: two([0, 16], [0, 96]) }, current: { kind: 'isrc', pins: two([0, 0], [0, 80]) },
  diode: { kind: 'diode', pins: two([16, 0], [16, 64]) }, schottky: { kind: 'diode', pins: two([16, 0], [16, 64]) },
  zener: { kind: 'zener', pins: two([16, 0], [16, 64]) }, led: { kind: 'led', pins: two([16, 0], [16, 64]) },
  npn: { kind: 'npn', pins: [[64, 0], [0, 48], [64, 96]] }, npn2: { kind: 'npn', pins: [[64, 0], [0, 48], [64, 96]] }, npn3: { kind: 'npn', pins: [[64, 0], [0, 48], [64, 96]] },
  pnp: { kind: 'pnp', pins: [[64, 0], [0, 48], [64, 96]] }, pnp2: { kind: 'pnp', pins: [[64, 0], [0, 48], [64, 96]] },
  nmos: { kind: 'nmos', pins: [[48, 0], [0, 80], [48, 96]] }, pmos: { kind: 'pmos', pins: [[48, 0], [0, 80], [48, 96]] },
  njf: { kind: 'njf', pins: [[48, 0], [0, 64], [48, 96]] }, pjf: { kind: 'pjf', pins: [[48, 0], [0, 64], [48, 96]] },
  e: { kind: 'vcvs', pins: [[0, 16], [0, 96], [-48, 32], [-48, 80]] }, e2: { kind: 'vcvs', pins: [[0, 16], [0, 96], [-48, 80], [-48, 32]] },
  g: { kind: 'vccs', pins: [[0, 96], [0, 16], [-48, 32], [-48, 80]] }, g2: { kind: 'vccs', pins: [[0, 96], [0, 16], [-48, 80], [-48, 32]] },
  f: { kind: 'cccs', pins: two([0, 0], [0, 80]) }, h: { kind: 'ccvs', pins: two([0, 16], [0, 96]) },
  bv: { kind: 'bv', pins: two([0, 16], [0, 96]) }, bi: { kind: 'bi', pins: two([0, 0], [0, 80]) }, bi2: { kind: 'bi', pins: two([0, 80], [0, 0]) },
  sw: { kind: 'sw', pins: [[0, 16], [0, 96], [-48, 80], [-48, 32]] }, csw: { kind: 'csw', pins: two([0, 0], [0, 80]) },
  tline: { kind: 'tline', pins: [[-48, -16], [-48, 16], [48, -16], [48, 16]] },
  opamp: { kind: 'opamp', pins: [[32, 64], [-32, 80], [-32, 48]] } // ideal: out, in+, in-
}
// 5-pin op-amps (in+ in- V+ V- out): opamp2 and most vendor symbols, or the compact UniversalOpamp2 / LTC layout
const OA5: [number, number][][] = [[[-32, 80], [-32, 48], [0, 32], [0, 96], [32, 64]], [[-32, 16], [-32, -16], [0, -32], [0, 32], [32, 0]]]

// LTspice orientation: R0..R270 (clockwise, like ours), M0..M270 (mirror in x, then rotate)
function ascXf(o: string) { const m = /^([RM])(\d+)$/.exec(o) ?? ['', 'R', '0']; return { rot: (+m[2] / 90) % 4, mirror: m[1] === 'M' } }
const ascVal = (v: string) => v.replace(/µ/g, 'u').replace(/\bSINE\s*\(/gi, 'SIN(').trim()

// grid: source units per grid step of ours. 16 normally; finer (a bigger drawing) when points are off LTspice's grid
export function importAsc(text: string, grid = 16): Imported {
  const f = foreign(), sn = snapper(), L = (x: number, y: number) => sn.pt((x * 10) / grid, (y * 10) / grid)
  const lines = text.split(/\r?\n/)
  const flags = new Map<string, { at: Pt; name: string }>(), io = new Set<string>()
  type Sym = { name: string; x: number; y: number; o: string; attr: Record<string, string> }
  const syms: Sym[] = []
  const skipped = new Map<string, number>()
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1)
  let lt = false // an ideal LTspice op-amp was mapped: its .lib opamp.sub is not needed
  for (const raw of lines) {
    const l = raw.trim(), [kw, ...a] = l.split(/\s+/)
    if (kw === 'WIRE') f.wires.push([L(+a[0], +a[1]), L(+a[2], +a[3])])
    else if (kw === 'FLAG') flags.set(`${a[0]},${a[1]}`, { at: L(+a[0], +a[1]), name: a.slice(2).join(' ') })
    else if (kw === 'IOPIN') io.add(`${a[0]},${a[1]}`)
    else if (kw === 'SYMBOL') syms.push({ name: a[0], x: +a[1], y: +a[2], o: a[3] ?? 'R0', attr: {} })
    else if (kw === 'SYMATTR' && syms.length) syms.at(-1)!.attr[a[0]] = a.slice(1).join(' ')
    else if (kw === 'TEXT') {
      const m = /^TEXT\s+(-?\d+)\s+(-?\d+)\s+\S+\s+\S+\s+([!;])(.*)$/.exec(l)
      if (!m) continue
      const body = m[4].replace(/\\n/g, '\n'), at = L(+m[1], +m[2])
      if (m[3] === '!') f.texts.push({ at, text: body })
      else f.draw.push({ id: uid(), t: 'note', ...at, text: body })
    } else if (kw === 'LINE' || kw === 'RECTANGLE' || kw === 'CIRCLE') {
      const [x1, y1, x2, y2] = a.slice(1, 5).map(Number), D = (x: number, y: number) => P((x * 10) / grid, (y * 10) / grid)
      f.draw.push({ id: uid(), t: kw === 'LINE' ? 'line' : kw === 'RECTANGLE' ? 'rect' : 'ellipse', a: D(x1, y1), b: D(x2, y2) })
    } else if (kw === 'ARC') skip('arc (drawing)')
    else if (kw === 'BUSTAP' || kw === 'DATAFLAG') skip(kw.toLowerCase())
  }
  for (const [k, g] of flags) {
    if (g.name === '0') f.flags.push({ kind: 'gnd', at: g.at, name: '0' })
    else f.flags.push({ kind: io.has(k) ? 'port' : 'label', at: g.at, name: g.name.replace(/\s+/g, '_') })
  }
  // where wires end and flags sit: picks between the two vendor op-amp pin layouts
  const ends = new Set([...f.wires.flat(), ...f.flags.map((g) => g.at)].map((q) => `${q.x},${q.y}`))
  for (const s of syms) {
    const seg = s.name.split(/[\\/]+/), base = seg.pop()!.toLowerCase(), dir = seg.join('/').toLowerCase() // LTspice writes Opamps\\LT1001
    const { rot, mirror } = ascXf(s.o), inst = s.attr.InstName ?? '', v = ascVal([s.attr.Value, s.attr.Value2].filter(Boolean).join(' '))
    const world = (q: [number, number]) => { const w = xform({ x: s.x, y: s.y, rot, mirror }, { x: q[0], y: q[1] }); return L(w.x, w.y) }
    let sym = ASC[base]
    let value = v, kind = sym?.kind, lib: string | undefined
    if (!sym && (dir === 'opamps' || base === 'opamp2' || base === 'universalopamp2')) {
      // vendor op-amp: the layout whose pins land on the most wire ends; placed as the generic op-amp macromodel
      const lay = OA5.map((p) => p.map(world)).sort((a, b) => b.filter((q) => ends.has(`${q.x},${q.y}`)).length - a.filter((q) => ends.has(`${q.x},${q.y}`)).length)[0]
      f.parts.push({ kind: 'opamp5', name: inst, value: 'OA_GENERIC', lib: 'std:OA_GENERIC', pins: lay, rot, mirror })
      f.report.push(`${inst || base}: ${s.attr.Value || s.name.split(/[\\/]+/).pop()} placed as the generic op-amp model OA_GENERIC (pins mapped); import the vendor model in Manage Libraries to use it`)
      continue
    }
    if (!sym) {
      // its pin positions live in the .asy, not in the .asc: an unconnected placeholder at the symbol
      const n = s.attr.InstName || base
      f.holes.push({ name: n, value: base, at: L(s.x, s.y), pins: [] })
      f.report.push(`${n}: LTspice symbol "${s.name}" has no equivalent here: placeholder block without pins, replace it and wire it by hand`)
      continue
    }
    if (base === 'opamp') lt = true, (value = SYMBOLS.opamp.value)
    else if (sym.kind === 'vsrc' || sym.kind === 'isrc') {
      if (s.attr.SpiceLine) f.report.push(`${inst}: source options "${s.attr.SpiceLine}" (LTspice only) not converted`)
    } else if (MODEL_KINDS[sym.kind]) ({ kind, lib } = libPart(sym.kind, v))
    if (MODEL_KINDS[sym.kind] && !lib && value && !/^(d|npn|pnp|nmos|pmos|njf|pjf)$/i.test(value))
      f.report.push(`${inst}: model "${value}" is not in the library; add its .model or .include, or pick a library part`)
    f.parts.push({ kind: kind!, name: inst, value, lib, pins: sym.pins.map(world), rot, mirror })
  }
  if (lt) f.texts = f.texts.map((t) => ({ ...t, text: t.text.split('\n').filter((x) => !/^\s*\.lib\s+opamp\.sub\s*$/i.test(x)).join('\n') })).filter((t) => t.text.trim())
  // LTspice-only directive syntax ngspice rejects
  f.texts = f.texts.map((t) => ({ ...t, text: t.text.split('\n').flatMap((x) => {
    if (/^\s*\.backanno\b/i.test(x)) return []
    if (/^\s*\.tran\b.*\bstartup\b/i.test(x)) f.report.push(`"${x.trim()}": LTspice's "startup" option removed (ngspice has no equivalent)`), (x = x.replace(/\s+startup\b/i, ''))
    const one = /^(\s*\.tran\s+)(\S+)\s*$/i.exec(x) // LTspice's ".tran <stop>": ngspice wants a step too
    if (one && si(one[2]) > 0) return [`${one[1]}${+(si(one[2]) / 1000).toPrecision(3)} ${one[2]}`]
    return [x]
  }).join('\n') })).filter((t) => t.text.trim())
  for (const [w, n] of skipped) f.report.push(`${n} ${w}${n > 1 ? 's' : ''} not converted`)
  if (sn.merged && grid > 2) return importAsc(text, grid / 2)
  sn.report(f, `${grid}-unit`)
  if (grid !== 16) f.report.push(`Drawn ${16 / grid}× larger than usual: some points are off LTspice's 16-unit grid`)
  return build(f, 'LTspice schematic')
}

// ---------------------------------------------------------------------------------------------- KiCad .kicad_sch

export type SX = string | SX[]
// s-expressions: lists, "strings" (with \ escapes) and bare atoms
export function sexpr(text: string): SX {
  const st: SX[][] = [[]]
  const re = /\s*(?:(\()|(\))|"((?:[^"\\]|\\.)*)"|([^\s()"]+))/gy
  let m: RegExpExecArray | null
  while (re.lastIndex < text.length && (m = re.exec(text))) {
    if (m[1]) st.push([])
    else if (m[2]) { const l = st.pop()!; if (!st.length) throw new Error('Unbalanced )'); st.at(-1)!.push(l) }
    else if (m[3] != null) st.at(-1)!.push(m[3].replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c)))
    else if (m[4]) st.at(-1)!.push(m[4])
  }
  if (st.length !== 1) throw new Error('Unbalanced (')
  return st[0][0] ?? []
}
const kids = (l: SX, k: string) => (Array.isArray(l) ? l.filter((x): x is SX[] => Array.isArray(x) && x[0] === k) : [])
const kid = (l: SX, k: string) => kids(l, k)[0]
const prop = (l: SX, k: string) => kids(l, 'property').find((p) => p[1] === k)?.[2] as string | undefined


type KPin = { name: string; num: string; at: Pt /* symbol units, y up */ }
// symbol-local pin (y up, mm) -> world mm: flip y, rotate counter-clockwise by the instance angle, then mirror
function kWorld(at: SX[], mir: string | undefined, q: Pt): Pt {
  let x = q.x, y = -q.y
  const a = ((+(at[3] ?? 0) % 360) + 360) % 360
  for (let i = 0; i < a / 90; i++) [x, y] = [y, -x]
  if (mir === 'x') y = -y
  if (mir === 'y') x = -x
  return { x: +at[1] + x, y: +at[2] + y }
}

// our pin order as source pins: by pin name for polarised parts, else by number
const BY_NAME: Partial<Record<Kind, string[][]>> = {
  diode: [['a', '+'], ['k', '-']], zener: [['a'], ['k']], led: [['a'], ['k']],
  npn: [['c'], ['b'], ['e']], pnp: [['c'], ['b'], ['e']], nmos: [['d'], ['g'], ['s']], pmos: [['d'], ['g'], ['s']], njf: [['d'], ['g'], ['s']], pjf: [['d'], ['g'], ['s']],
  vsrc: [['+', '1'], ['-', '2']], isrc: [['+', '1'], ['-', '2']],
  opamp5: [['+', 'in+', '+in', 'non-inverting'], ['-', 'in-', '-in', 'inverting'], ['v+', 'vcc', 'vdd', 'v+_'], ['v-', 'vee', 'vss', 'v-_'], ['out', '~', 'output', 'vout']],
  opamp: [['out', '~', 'output', 'vout'], ['+', 'in+', '+in'], ['-', 'in-', '-in']]
}
function kKind(id: string, sym: SX[], pins: KPin[]): Kind | null {
  const n = id.split(':').pop()!.toLowerCase(), lib = id.split(':')[0].toLowerCase()
  const desc = `${prop(sym, 'Description') ?? ''} ${prop(sym, 'ki_keywords') ?? ''} ${prop(sym, 'ki_description') ?? ''}`.toLowerCase()
  const names = pins.map((p) => p.name.toLowerCase())
  if (/^(r|r_small|r_us|r_small_us)$/.test(n)) return 'res'
  if (/^(c|c_small|c_polarized\w*|cp|cp_small|c_polarized_us)$/.test(n)) return 'cap'
  if (/^(l|l_small)$/.test(n)) return 'ind'
  if (/^led/.test(n)) return 'led'
  if (/^d_zener/.test(n)) return 'zener'
  if (/^(d|d_small|d_schottky\w*|d_filled)$/.test(n)) return 'diode'
  if (lib === 'simulation_spice' && /^v/.test(n)) return 'vsrc'
  if (lib === 'simulation_spice' && /^i/.test(n)) return 'isrc'
  if (lib === 'simulation_spice' && n === 'opamp') return 'opamp5'
  const has = (...k: string[]) => k.every((x) => names.includes(x))
  if (has('b', 'c', 'e') && pins.length === 3) return /pnp/.test(n + desc) ? 'pnp' : /npn/.test(n + desc) ? 'npn' : null
  if (has('g', 'd', 's') && pins.length === 3) {
    const p = /pmos|p-channel|p-mos|pchannel/.test(n + desc), nn = /nmos|n-channel|n-mos|nchannel/.test(n + desc)
    if (/jfet|njf|pjf/.test(n + desc)) return p || /pjf/.test(n) ? 'pjf' : 'njf'
    return p ? 'pmos' : nn ? 'nmos' : null
  }
  if (lib === 'amplifier_operational' || /op.?amp|operational amplifier/.test(desc)) return pins.length >= 5 ? 'opamp5' : pins.length === 3 ? 'opamp' : null
  return null
}

// Sim.Type / Sim.Params (KiCad 7+) -> a SPICE source value; the Value field otherwise
function kSource(inst: SX[]): string {
  const legacy = prop(inst, 'Spice_Model') // KiCad 6
  if (legacy) return legacy.replace(/^dc\s*\(([^)]*)\)/i, 'DC $1')
  const type = (prop(inst, 'Sim.Type') ?? '').toUpperCase(), kv: Record<string, string> = {}
  for (const [, k, v] of (prop(inst, 'Sim.Params') ?? '').matchAll(/(\w+)\s*=\s*"?([^\s"]+)"?/g)) kv[k.toLowerCase()] = v
  const g = (...k: string[]) => k.map((x) => kv[x] ?? '0').join(' '), ac = kv.ac ? ` AC ${kv.ac}` : ''
  if (type === 'SIN') return `DC ${kv.dc ?? 0}${ac} SIN(${g('dc', 'ampl', 'f', 'td', 'theta', 'phase')})`
  if (type === 'PULSE') return `PULSE(${g('y1', 'y2', 'td', 'tr', 'tf', 'tw', 'per')})${ac}`
  if (type === 'DC' || kv.dc) return `DC ${kv.dc ?? 0}${ac}`
  return (prop(inst, 'Value') ?? '').replace(/µ/g, 'u')
}

// grid: mm per grid step of ours. KiCad's 1.27 mm (50 mil) normally; finer (a bigger drawing) when pins are off it
export function importKicad(text: string, grid = 1.27): Imported {
  type N = string | number | SX
  const KI = 10 / grid, root = sexpr(text), f = foreign(), sn = snapper(), kp = (x: N, y: N) => sn.pt(+x * KI, +y * KI), kpt = (x: N, y: N) => P(+x * KI, +y * KI)
  if (root[0] !== 'kicad_sch') throw new Error('Not a KiCad schematic (.kicad_sch)')
  const libs = new Map<string, SX[]>(kid(root, 'lib_symbols')?.slice(1).filter(Array.isArray).map((s) => [s[1] as string, s as SX[]]) ?? [])
  const skipped = new Map<string, number>()
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1)
  for (const w of kids(root, 'wire')) {
    const xy = kids(kid(w, 'pts'), 'xy')
    for (let i = 1; i < xy.length; i++) f.wires.push([kp(xy[i - 1][1], xy[i - 1][2]), kp(xy[i][1], xy[i][2])])
  }
  for (const j of kids(root, 'junction')) f.junctions.push(kp(kid(j, 'at')[1], kid(j, 'at')[2]))
  for (const [k, kind] of [['label', 'label'], ['global_label', 'label'], ['hierarchical_label', 'port']] as const)
    for (const l of kids(root, k)) f.flags.push({ kind, at: kp(kid(l, 'at')[1], kid(l, 'at')[2]), name: String(l[1]).replace(/\s+/g, '_') })
  for (const t of kids(root, 'text')) {
    const s = String(t[1]), at = kpt(kid(t, 'at')[1], kid(t, 'at')[2])
    if (/^\s*\./.test(s)) f.texts.push({ at, text: s })
    else f.draw.push({ id: uid(), t: 'note', ...at, text: s })
  }
  for (const t of kids(root, 'text_box')) f.draw.push({ id: uid(), t: 'note', ...kpt(kid(t, 'at')[1], kid(t, 'at')[2]), text: String(t[1]) })
  for (const g of kids(root, 'polyline')) {
    const xy = kids(kid(g, 'pts'), 'xy')
    for (let i = 1; i < xy.length; i++) f.draw.push({ id: uid(), t: 'line', a: kpt(xy[i - 1][1], xy[i - 1][2]), b: kpt(xy[i][1], xy[i][2]) })
  }
  for (const g of kids(root, 'rectangle')) f.draw.push({ id: uid(), t: 'rect', a: kpt(kid(g, 'start')[1], kid(g, 'start')[2]), b: kpt(kid(g, 'end')[1], kid(g, 'end')[2]) })
  for (const g of kids(root, 'circle')) {
    const c = kid(g, 'center'), r = +kid(g, 'radius')[1]
    f.draw.push({ id: uid(), t: 'ellipse', a: kpt(+c[1] - r, +c[2] - r), b: kpt(+c[1] + r, +c[2] + r) })
  }
  for (const k of ['bus', 'bus_entry', 'sheet', 'arc', 'image', 'netclass_flag']) for (const _ of kids(root, k)) skip(k.replace('_', ' '))

  for (const inst of kids(root, 'symbol')) {
    const id = String(kid(inst, 'lib_id')?.[1] ?? ''), sym = libs.get(String(kid(inst, 'lib_name')?.[1] ?? id)), at = kid(inst, 'at'), mir = kid(inst, 'mirror')?.[1] as string | undefined
    const unit = +(kid(inst, 'unit')?.[1] ?? 1), ref = prop(inst, 'Reference') ?? '', value = prop(inst, 'Spice_Model') ?? prop(inst, 'Value') ?? ''
    if (!sym || !at) { f.report.push(`${ref || id}: symbol "${id}" missing from the file's library cache: skipped`); continue }
    // pins of this unit (sub-symbols NAME_<unit>_<style>; unit 0 = common to all units)
    const pins: KPin[] = kids(sym, 'symbol').filter((u) => { const m = /_(\d+)_(\d+)$/.exec(String(u[1])); return !m || +m[1] === 0 || +m[1] === unit })
      .flatMap((u) => kids(u, 'pin')).map((p) => ({ name: String(kid(p, 'name')?.[1] ?? ''), num: String(kid(p, 'number')?.[1] ?? ''), at: { x: +kid(p, 'at')[1], y: +kid(p, 'at')[2] } }))
    const world = (q: KPin) => { const w = kWorld(at, mir, q.at); return kp(w.x, w.y) }
    if (kid(sym, 'power') || id.toLowerCase().startsWith('power:')) {
      if (!pins.length) continue
      const gnd = /^(gnd\w*|earth|0)$/i.test(value) || /^power:(gnd\w*|earth)$/i.test(id)
      // our ground hangs down and the power bar stands up at rot 0, like KiCad's at 0°; mirror x turns them over
      const rot = (((4 - Math.round(+(at[3] ?? 0) / 90)) % 4) + 4 + (mir === 'x' ? 2 : 0)) % 4
      f.flags.push({ kind: gnd ? 'gnd' : 'power', at: world(pins[0]), name: value.replace(/\s+/g, '_'), rot })
      continue
    }
    const kind = kKind(id, sym, pins)
    const order = kind && (BY_NAME[kind]
      ? BY_NAME[kind]!.map((alts) => pins.find((p) => alts.includes(p.name.toLowerCase())) ?? pins.find((p) => alts.includes(p.num)))
      : [...pins].sort((a, b) => +a.num - +b.num))
    if (kind && order && order.length === SYMBOLS[kind].pins.length && order.every(Boolean) && new Set(order).size === order.length) {
      const a = +(at[3] ?? 0), rot = (((4 - Math.round(a / 90)) % 4) + 4) % 4 // KiCad turns counter-clockwise
      let v = kind === 'vsrc' || kind === 'isrc' ? kSource(inst) : value, lib: string | undefined, k: Kind = kind
      if (kind === 'opamp') v = SYMBOLS.opamp.value
      else if (kind === 'opamp5') ({ kind: k, lib } = libPart(kind, value)), lib || (v = 'OA_GENERIC', lib = 'std:OA_GENERIC', f.report.push(`${ref}: ${value} placed as the generic op-amp model OA_GENERIC (pins mapped by name)`))
      else if (MODEL_KINDS[kind]) {
        ({ kind: k, lib } = libPart(kind, value))
        if (!lib) f.report.push(`${ref}: model "${value}" is not in the library; add its .model or .include, or pick a library part`)
      }
      if (kind === 'opamp' && /operational/i.test(id)) f.report.push(`${ref}: ${value} unit ${unit} placed as an ideal op-amp (its supply pins are on another unit)`)
      if ((kind === 'vsrc' || kind === 'isrc') && !/\d/.test(v)) f.report.push(`${ref}: source value "${v}" needs checking`)
      f.parts.push({ kind: k, name: ref, value: v, lib, pins: (order as KPin[]).map(world), rot, mirror: mir === 'y' || mir === 'x' })
      continue
    }
    if (/operational/i.test(id) && pins.length === 2 && pins.every((p) => /^v[+-]|^v[cdse]{2}/i.test(p.name))) { f.report.push(`${ref}: op-amp supply unit not converted (the op-amp units are ideal)`); continue }
    f.holes.push({ name: ref, value: id.split(':').pop()!, at: kpt(at[1], at[2]), pins: pins.map((p) => ({ name: p.name && p.name !== '~' ? p.name : p.num, at: world(p) })) })
    f.report.push(`${ref}: "${id}" (${value}) has no equivalent here: placeholder block, replace it before simulating`)
  }
  for (const [w, n] of skipped) f.report.push(`${n} ${w}${n > 1 ? (w.endsWith('s') ? 'es' : 's') : ''} not converted`)
  const finer = [0.635, 0.254, 0.127, 0.0254].find((g) => g < grid - 1e-9)
  if (sn.merged && finer) return importKicad(text, finer)
  sn.report(f, `${grid} mm`)
  if (grid !== 1.27) f.report.push(`Drawn ${+(1.27 / grid).toFixed(1)}× larger than usual: some pins are off KiCad's 1.27 mm grid`)
  return build(f, 'KiCad schematic')
}

export function importSchematic(file: string, text: string): Imported {
  if (/\.asc$/i.test(file)) return importAsc(text)
  if (/\.kicad_sch$/i.test(file)) return importKicad(text)
  throw new Error('Import reads LTspice .asc and KiCad .kicad_sch files')
}
