// File › Import Schematic…: LTspice .asc and KiCad .kicad_sch onto this app's parts. Pure TS (node --test loads it).
// Both readers produce a Foreign drawing in our units (scaled so the source grid lands on ours: LTspice 16 → 10,
// KiCad 1.27 mm → 10). build() places our symbols with their pins on the source pins (best of 8 orientations; short
// stub wires where our symbol's pin spacing differs, or a pair of net labels where a stub would touch another net),
// then checks the result: the net partition the netlister finds must equal the one the source file's own rules give
// (LTspice: anything on a wire joins it; KiCad: wire ends, labels anywhere on a wire, pins only at wire ends, and a
// junction joins everything through its point). Parts whose pins disagree are redone with labels; anything still
// different is named in the report. Unmapped symbols become placeholder blocks (the netlister refuses them).
import { onSegment, parseSheet, snap, uid, wiresThrough, xform, type Drawing, type Part, type Pt, type Sheet, type Wire, emptySheet, route, same } from './model.ts'
import { SYMBOLS, type Kind } from './symbols.ts'
import { BUNDLED, si } from '../library/library.ts'
import { netlist } from './netlist.ts'

export interface Imported { sheet: Sheet; report: string[]; summary: string }
type FPart = { kind: Kind; name: string; value: string; lib?: string; pins: Pt[] /* world, our pin order */; rot: number; mirror: boolean }
type Hole = { name: string; value: string; at: Pt; pins: { name: string; at: Pt }[] } // at: centre when there are no pins
// rot: labels/ports face away from their wires when absent. onWire: joins a wire it sits on the middle of (LTspice
// flags, KiCad labels); KiCad power symbols are pins, joined only at wire ends
type Flag = { kind: 'gnd' | 'label' | 'port' | 'power'; at: Pt; name: string; rot?: number; onWire?: boolean }
interface Foreign {
  mode: 'lt' | 'kicad'
  wires: [Pt, Pt][]
  flags: Flag[]
  parts: FPart[]
  holes: Hole[]
  texts: { at: Pt; text: string }[] // SPICE directives
  draw: Drawing[] // notes and graphics
  junctions: Pt[]
  report: string[]
}
const foreign = (mode: Foreign['mode']): Foreign => ({ mode, wires: [], flags: [], parts: [], holes: [], texts: [], draw: [], junctions: [], report: [] })
export const LIMIT = { wires: 20000, symbols: 5000 } // bigger files are refused with a message rather than freezing the window
class Skip extends Error {} // a malformed element: skipped with a report line
const fin = (...v: number[]) => { if (!v.every(Number.isFinite)) throw new Skip('non-numeric coordinates'); return v }
const P = (x: number, y: number): Pt => (fin(x, y), { x: snap(x) + 0, y: snap(y) + 0 })
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
// control characters (line breaks above all) never reach a name or value
const clean = (s: string) => s.replace(/[\x00-\x1f\x7f\x85\u2028\u2029]+/g, ' ').trim()

// a bundled library part of that name and a compatible symbol: placed as that part (its model comes along)
const MODEL_KINDS: Partial<Record<Kind, Kind[]>> = { diode: ['diode', 'zener', 'led'], zener: ['zener', 'diode'], led: ['led', 'diode'], npn: ['npn'], pnp: ['pnp'], nmos: ['nmos'], pmos: ['pmos'], njf: ['njf'], pjf: ['pjf'], opamp5: ['opamp5'] }
function libPart(kind: Kind, value: string): { kind: Kind; lib?: string } {
  const e = MODEL_KINDS[kind] && BUNDLED.find((b) => b.spice && b.name.toLowerCase() === value.toLowerCase() && MODEL_KINDS[kind]!.includes(b.kind))
  return e ? { kind: e.kind, lib: e.id } : { kind }
}

// ---------------------------------------------------------------------------------------------- connectivity

const K = (q: Pt) => `${q.x},${q.y}`
function unionFind() {
  const up = new Map<string, string>()
  const find = (k: string): string => { const p = up.get(k) ?? k; if (p === k) return k; const r = find(p); up.set(k, r); return r }
  return { find, union: (a: string, b: string) => { const x = find(a), y = find(b); if (x !== y) up.set(x, y) } }
}
type Seg = { a: Pt; b: Pt; net: string }
// segments by row and column (diagonals in a list): which pass through a point, without scanning them all
class Segs {
  h = new Map<number, Seg[]>(); v = new Map<number, Seg[]>(); d: Seg[] = []
  add(s: Seg) {
    const m = s.a.y === s.b.y ? this.h : s.a.x === s.b.x ? this.v : null, k = s.a.y === s.b.y ? s.a.y : s.a.x
    if (m) m.set(k, [...(m.get(k) ?? []), s])
    else this.d.push(s)
  }
  through = (q: Pt) => [...(this.h.get(q.y) ?? []), ...(this.v.get(q.x) ?? []), ...this.d].filter((s) => onSegment({ id: '', ...s }, q))
}
const flagNet = (g: Flag) => '@' + (g.kind === 'gnd' || /^(0|gnd)$/i.test(g.name) ? '0' : g.name.toLowerCase())

// the source file's own nets, by its rules (see the header); find(key of a point) -> net id
function sourceNets(f: Foreign) {
  const u = unionFind(), segs = new Segs(), lt = f.mode === 'lt'
  for (const [a, b] of f.wires) if (!same(a, b)) u.union(K(a), K(b)), segs.add({ a, b, net: K(a) })
  const join = (q: Pt, onWire: boolean) => { if (onWire) for (const s of segs.through(q)) u.union(K(q), s.net) }
  for (const [a, b] of f.wires) join(a, lt), join(b, lt) // KiCad: a wire end on a wire's middle joins only with a junction
  for (const j of f.junctions) join(j, true)
  for (const g of f.flags) join(g.at, lt || !!g.onWire), u.union(K(g.at), flagNet(g))
  for (const p of f.parts) for (const q of p.pins) join(q, lt)
  for (const h of f.holes) for (const q of h.pins) join(q.at, lt)
  return { find: u.find, segs, lt }
}

// What this app connects (model.ts rules), for checking where our pins and stubs may go: a pin joins wire ends and
// pins at its point; a wire end also joins any wire through its point; a wire's middle joins wire ends on it.
class Occ {
  ends = new Map<string, Set<string>>(); pins = new Map<string, Set<string>>(); segs = new Segs()
  rows = new Map<number, Set<number>>(); cols = new Map<number, Set<number>>() // wire ends, for endsInside
  private put(m: Map<string, Set<string>>, q: Pt, net: string) { const k = K(q); m.set(k, new Set([...(m.get(k) ?? []), net])) }
  addPin(q: Pt, net: string) { this.put(this.pins, q, net) }
  addEnd(q: Pt, net: string) {
    this.put(this.ends, q, net)
    this.rows.set(q.y, new Set([...(this.rows.get(q.y) ?? []), q.x])), this.cols.set(q.x, new Set([...(this.cols.get(q.x) ?? []), q.y]))
  }
  addWire(a: Pt, b: Pt, net: string) { this.addEnd(a, net), this.addEnd(b, net), this.segs.add({ a, b, net }) }
  pinNets = (q: Pt) => new Set([...(this.ends.get(K(q)) ?? []), ...(this.pins.get(K(q)) ?? [])])
  endNets = (q: Pt) => new Set([...this.pinNets(q), ...this.segs.through(q).map((s) => s.net)])
  // nets of wire ends strictly inside an axis-aligned segment
  endsInside(a: Pt, b: Pt): string[] {
    const out: string[] = []
    if (a.y === b.y) for (const x of this.rows.get(a.y) ?? []) { if (x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x)) out.push(...this.ends.get(`${x},${a.y}`)!) }
    else for (const y of this.cols.get(a.x) ?? []) if (y > Math.min(a.y, b.y) && y < Math.max(a.y, b.y)) out.push(...this.ends.get(`${a.x},${y}`)!)
    return out
  }
}

type Plan = { a: Pt; how: 'exact' | 'stub' | 'label' | 'bad'; segs?: Wire[] }
// Our symbol's orientation and position that touch no other net, put the most pins exactly on their source pins, then
// need the fewest label pairs and the shortest stubs (L-shaped wires to the source pin), then keep the source's
// orientation. Each candidate is checked pin by pin against everything placed so far, its own other pins and its own
// earlier stubs included. A pin whose stub would touch another net gets a pair of net labels instead (labelsOnly: all).
function fit(f: FPart, occ: Occ, tgt: string[], labelsOnly: boolean): { part: Pick<Part, 'x' | 'y' | 'rot' | 'mirror'>; plan: Plan[] } {
  const local = SYMBOLS[f.kind].pins
  let best: { score: number[]; at: Pick<Part, 'x' | 'y' | 'rot' | 'mirror'>; plan: Plan[] } | null = null
  for (let rot = 0; rot < 4; rot++)
    for (const mirror of [false, true]) {
      const t = local.map((q) => xform({ x: 0, y: 0, rot, mirror }, q))
      for (let j = 0; j < t.length; j++) {
        const c = { x: f.pins[j].x - t[j].x, y: f.pins[j].y - t[j].y }, at = t.map((q) => ({ x: q.x + c.x, y: q.y + c.y }))
        // this candidate's own pins and stubs, on top of occ
        const mine = new Occ()
        at.forEach((a, i) => mine.addPin(a, tgt[i]))
        const others = (s: Set<string>, n: string) => [...s].some((x) => x !== n)
        let len = 0
        const plan = at.map((a, i): Plan => {
          const to = f.pins[i], n = tgt[i]
          if (same(a, to)) return { a, how: 'exact' }
          if (others(new Set([...occ.pinNets(a), ...mine.pinNets(a)]), n)) return { a, how: 'bad' }
          if (labelsOnly) return { a, how: 'label' }
          for (const v of [a.x === to.x, a.x !== to.x]) {
            const segs = route(a, to, v)
            const ok = segs.every((w) => [w.a, w.b].every((q) => !others(new Set([...occ.endNets(q), ...mine.endNets(q)]), n)) &&
              ![...occ.endsInside(w.a, w.b), ...mine.endsInside(w.a, w.b)].some((x) => x !== n))
            if (!ok) continue
            segs.forEach((w) => mine.addWire(w.a, w.b, n))
            len += Math.abs(a.x - to.x) + Math.abs(a.y - to.y)
            return { a, how: 'stub', segs }
          }
          return { a, how: 'label' }
        })
        const cnt = (h: Plan['how']) => plan.filter((x) => x.how === h).length
        const score = [-cnt('bad'), cnt('exact'), -cnt('label'), -len, +(rot === f.rot % 4 && mirror === f.mirror)], k = best ? score.findIndex((v, i) => v !== best!.score[i]) : 0
        if (!best || (k >= 0 && score[k] > best.score[k])) best = { score, at: { ...c, rot, mirror }, plan }
      }
    }
  best!.plan.forEach((x, i) => { occ.addPin(x.a, tgt[i]); x.segs?.forEach((w) => occ.addWire(w.a, w.b, tgt[i])) })
  return { part: best!.at, plan: best!.plan }
}

// Imported files are untrusted: anything that could run a program or read a file when you press Run is turned into
// comment lines ("* " in front), each with a report line.
// - A .control … .endc block runs ngspice commands (shell, system, file writes). Matching is at least as wide as
//   ngspice's: a line that merely starts with .control opens a block (.controlx too), only a line starting with .endc
//   closes it (unterminated: to the end of the card).
// - A file pulled in by .include / .lib (.inc*, .lib*) can hold such a block itself.
// - ngspice runs any line starting with "*#" as a command, outside .control too; "* #" is an ordinary comment.
// - A .model of any type but the ordinary built-in devices (an allowlist): XSPICE code models such as d_process run
//   programs, d_cosim loads a library, filesource / d_source / table models read files, and so may whatever comes next.
//   The model's logical line (its "+" continuations, across comment lines) is judged and commented out whole.
// ngspice drops CR characters, so a CR inside a word could complete a keyword: CR and CRLF are made line breaks
// first. A "+" continuation of a commented line is commented with it.
export const MODEL_TYPES = new Set(['d', 'npn', 'pnp', 'nmos', 'pmos', 'nsoi', 'psoi', 'njf', 'pjf', 'nmf', 'pmf', 'nhfet', 'phfet',
  'r', 'res', 'c', 'cap', 'l', 'ind', 'sw', 'csw', 'vdmos', 'vdmosn', 'vdmosp', 'ltra', 'urc', 'txl', 'cpl'])
export function defang(texts: { text: string }[], report: string[]): void {
  const off = (l: string) => /^\s*\*/.test(l)
  for (const t of texts) {
    let on = false, prev = false
    t.text = t.text.split(/\r\n|\r|\n/).map((l) => {
      let cut = on || (prev && /^\s*\+/.test(l))
      if (!on && /^\s*\.control/i.test(l)) (on = cut = true), report.push('A .control block was disabled (turned into comment lines): it runs ngspice commands, which can include shell commands, when you press Run. After checking it, remove the leading "* " from its lines on the directive card to use it')
      else if (on && /^\s*\.endc/i.test(l)) on = false
      else if (!cut && /^\s*\.(inc|lib)/i.test(l)) {
        const file = l.trim().split(/\s+/).slice(1).join(' ') || '(no file named)'
        cut = true
        report.push(`"${l.trim()}" was disabled: it reads ${file}, and an imported schematic is untrusted (that file could hold a .control block that runs commands). After checking ${file}, remove the leading "* " on the directive card to use it`)
      }
      prev = cut
      const out = cut ? '* ' + l : l
      if (!/^\s*\*#/.test(out)) return out
      report.push(`"${l.trim()}" was disabled: ngspice runs a line starting with *# as a command. It is now an ordinary comment ("* #")`)
      return out.replace(/^(\s*)\*#/, '$1* #')
    }).join('\n')
  }
  // .model allowlist: each model's logical line, its name and type (ako:REF borrows REF's type, so REF must pass too)
  type M = { t: { text: string }; lines: number[]; name: string; type: string; ako?: string; head: string }
  const models: M[] = []
  for (const t of texts) {
    const ls = t.text.split('\n')
    ls.forEach((l, i) => {
      if (off(l) || !/^\s*\.model/i.test(l)) return
      const lines = [i]
      for (let j = i + 1; j < ls.length; j++) {
        if (/^\s*\+/.test(ls[j])) lines.push(j)
        else if (!(off(ls[j]) || !ls[j].trim())) break
      }
      const logical = lines.map((j) => ls[j].replace(/^\s*\+/, ' ')).join(' ').replace(/;.*$/, '')
      const m = /^\s*\.model\S*\s+(\S+)\s*(.*)$/is.exec(logical)
      const rest = m?.[2].trim() ?? '', ako = /^ako:\s*([^\s(]+)\s*([^\s(]*)/i.exec(rest)
      models.push({ t, lines, name: m?.[1] ?? '', type: (ako ? ako[2] : /^([^\s(]*)/.exec(rest)![1]).toLowerCase(), ako: ako?.[1], head: l.trim() })
    })
  }
  const byName = new Map(models.map((m) => [m.name.toLowerCase(), m]))
  const ok = (m: M, seen = new Set<M>()): boolean => {
    if (seen.has(m)) return false
    seen.add(m)
    if (m.ako) { const r = byName.get(m.ako.toLowerCase()); return !!r && ok(r, seen) && (!m.type || MODEL_TYPES.has(m.type)) }
    return MODEL_TYPES.has(m.type)
  }
  const bad = models.filter((m) => !ok(m))
  for (const m of bad) {
    report.push(`".model ${m.name} ${m.ako ? 'ako:' + m.ako + ' ' : ''}${m.type || '(no type)'}" was disabled: models other than the ordinary SPICE devices (XSPICE code models and the like) can run programs or read files when you press Run, and an imported schematic is untrusted. After checking it, remove the leading "* " from its lines on the directive card to use it`)
  }
  for (const t of texts) {
    const mine = bad.filter((m) => m.t === t)
    if (!mine.length) continue
    const cut = new Set(mine.flatMap((m) => m.lines))
    t.text = t.text.split('\n').map((l, i) => (cut.has(i) ? '* ' + l : l)).join('\n')
  }
}

function build(f: Foreign, what: string): Imported {
  defang(f.texts, f.report)
  if (f.wires.length > LIMIT.wires || f.parts.length + f.holes.length > LIMIT.symbols)
    throw new Error(`This schematic is too large to import (${f.wires.length} wires, ${f.parts.length + f.holes.length} symbols; the limit is ${LIMIT.wires} wires and ${LIMIT.symbols} symbols)`)
  for (const p of f.parts) (p.name = clean(p.name)), (p.value = clean(p.value))
  for (const g of f.flags) g.name = clean(g.name).replace(/\s+/g, '_')
  const src = sourceNets(f), netOf = (q: Pt) => src.find(K(q))
  // the source's user-given net names (ground first), for labels that join a pin to its source pin
  const userName = new Map<string, string>()
  for (const g of [...f.flags].sort((a, b) => +(b.kind === 'gnd') - +(a.kind === 'gnd'))) if (!userName.has(netOf(g.at))) userName.set(netOf(g.at), g.kind === 'gnd' ? '0' : g.name)
  const taken = new Set([...f.flags.map((g) => g.name.toLowerCase()), ...f.parts.map((p) => p.name.toLowerCase())])
  if (!src.lt) {
    // KiCad: a net with a GND label and another name is named by KiCad's priority rules, so it may not be its ground;
    // here any GND label makes the net ground (0)
    const byNet = new Map<string, Flag[]>()
    for (const g of f.flags) byNet.set(netOf(g.at), [...(byNet.get(netOf(g.at)) ?? []), g])
    for (const gs of byNet.values()) {
      const names = [...new Set(gs.filter((g) => g.kind !== 'gnd').map((g) => g.name))], gnd = names.filter((n) => /^(0|gnd)$/i.test(n))
      if (gnd.length && names.length > gnd.length && !gs.some((g) => g.kind === 'gnd'))
        f.report.push(`The net labelled ${names.join(', ')} is ground (0) here because of its ${gnd[0]} label; KiCad may name it ${names.find((n) => !gnd.includes(n))} instead and not treat it as ground. Rename the ${gnd[0]} label if that net should not be ground`)
    }
  }

  // source wires, split where the source joins something to their middle (this app joins only at wire ends)
  const nodes: [Pt, boolean][] = [
    ...f.wires.flat().map((q): [Pt, boolean] => [q, src.lt]), ...f.junctions.map((q): [Pt, boolean] => [q, true]),
    ...f.flags.map((g): [Pt, boolean] => [g.at, src.lt || !!g.onWire]), ...f.parts.flatMap((p) => p.pins.map((q): [Pt, boolean] => [q, src.lt])),
    ...f.holes.flatMap((h) => h.pins.map((q): [Pt, boolean] => [q.at, src.lt]))
  ]
  const cuts = new Map<Seg, Pt[]>()
  for (const [q, joins] of nodes) if (joins) for (const s of src.segs.through(q)) cuts.set(s, [...(cuts.get(s) ?? []), q])
  let wires: Wire[] = [...src.segs.h.values(), ...src.segs.v.values(), src.segs.d].flat().flatMap((s) => {
    const d = (q: Pt) => Math.abs(q.x - s.a.x) + Math.abs(q.y - s.a.y), pts = [s.a, ...(cuts.get(s) ?? []).sort((p, q) => d(p) - d(q)), s.b]
    return pts.slice(1).flatMap((b, i) => (same(pts[i], b) ? [] : [{ id: uid(), a: pts[i], b }]))
  })
  // KiCad: a wire end on another wire's middle with nothing else there stays apart in KiCad; here it would join, so it
  // is pulled back one grid step (a 1-step wire is dropped)
  if (!src.lt) {
    const busy = new Set([...f.junctions, ...f.flags.map((g) => g.at), ...f.parts.flatMap((p) => p.pins), ...f.holes.flatMap((h) => h.pins.map((q) => q.at))].map(K))
    const count = new Map<string, number>()
    for (const w of wires) for (const q of [w.a, w.b]) count.set(K(q), (count.get(K(q)) ?? 0) + 1)
    const loose = (q: Pt) => count.get(K(q)) === 1 && !busy.has(K(q)) && src.segs.through(q).length > 0
    wires = wires.flatMap((w) => {
      let { a, b } = w
      const back = (p: Pt, o: Pt) => { const l = Math.hypot(o.x - p.x, o.y - p.y); return { x: snap(p.x + ((o.x - p.x) * 10) / l), y: snap(p.y + ((o.y - p.y) * 10) / l) } }
      if (loose(a)) a = back(a, b)
      if (loose(b)) b = back(b, w.a)
      return same(a, b) || Math.hypot(b.x - a.x, b.y - a.y) > Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) ? [] : [{ ...w, a, b }]
    })
  }

  const named = new Map<string, number>()
  const nm = (n: string, kind: Kind, keep = false) => {
    const pre = SYMBOLS[kind].prefix || 'X'
    let r = n.trim() || pre + '?'
    if (!keep && !r.toUpperCase().startsWith(pre)) r = pre + r // U1 (an op-amp) -> XU1: SPICE wants the element letter
    if (/\s/.test(r) || named.has(r.toLowerCase())) { let i = 1; while (named.has((pre + i).toLowerCase())) i++; r = pre + i }
    named.set(r.toLowerCase(), 1)
    return r
  }
  const names = f.parts.map((p) => nm(p.name, p.kind))
  const tgts = f.parts.map((p) => p.pins.map(netOf))

  // one placement pass; labelsOnly: parts to join with labels only (they disagreed with the source last time)
  function place(labelsOnly: Set<number>) {
    const occ = new Occ()
    for (const w of wires) occ.addWire(w.a, w.b, netOf(w.a))
    for (const g of f.flags) occ.addPin(g.at, netOf(g.at))
    f.parts.forEach((p) => p.pins.forEach((q) => occ.addPin(q, netOf(q))))
    f.holes.forEach((h) => h.pins.forEach((q) => occ.addPin(q.at, netOf(q.at))))
    const s: Sheet = { ...emptySheet(), draw: f.draw }
    const stubs: Wire[] = [], extra: Flag[] = [], bad: number[] = []
    f.parts.forEach((p, k) => {
      const { part, plan } = fit(p, occ, tgts[k], labelsOnly.has(k)), name = names[k]
      s.parts.push({ id: uid(), kind: p.kind, ...part, name, value: p.value || SYMBOLS[p.kind].value, ...(p.lib && { lib: p.lib }) })
      plan.forEach((x, i) => {
        if (x.segs) stubs.push(...x.segs)
        if (x.how !== 'label') return
        let n = userName.get(tgts[k][i]) // reuse the net's own name; invent one only for an unnamed net
        if (!n) { let j = i + 1; while (taken.has(`${name}_${j}`.toLowerCase())) j += 10; n = `${name}_${j}`; taken.add(n.toLowerCase()), userName.set(tgts[k][i], n) }
        for (const at of [x.a, p.pins[i]]) extra.push({ kind: n === '0' ? 'gnd' : 'label', at, name: n })
      })
      if (plan.some((x) => x.how === 'bad')) bad.push(k)
    })
    for (const h of f.holes) {
      // placeholder: a generic block whose pins sit exactly on the source pins
      const xs = [h.at.x, ...h.pins.map((q) => q.at.x)].slice(h.pins.length ? 1 : 0), ys = [h.at.y, ...h.pins.map((q) => q.at.y)].slice(h.pins.length ? 1 : 0)
      const x = snap((Math.min(...xs) + Math.max(...xs)) / 2), y = snap((Math.min(...ys) + Math.max(...ys)) / 2)
      const w = Math.max(40, Math.max(...xs) - Math.min(...xs) - 20), hh = Math.max(40, Math.max(...ys) - Math.min(...ys) - 20)
      s.parts.push({ id: uid(), kind: 'block', x, y, rot: 0, mirror: false, name: nm(h.name, 'block', true), value: '?' + clean(h.value), pins: h.pins.map((q) => ({ name: clean(q.name), x: q.at.x - x, y: q.at.y - y })), size: { w, h: hh } })
    }
    // a label points right, left, up or down: the first way no wire leaves its point
    const all = [...wires, ...stubs], thr = wiresThrough(all), dirs = new Map<string, Set<string>>() // point -> ways wires leave it
    for (const { a, b } of all) for (const [u, v] of [[a, b], [b, a]]) dirs.set(K(u), (dirs.get(K(u)) ?? new Set()).add(`${Math.sign(v.x - u.x)},${Math.sign(v.y - u.y)}`))
    const used = (q: Pt, dx: number, dy: number) => !!dirs.get(K(q))?.has(`${dx},${dy}`) || thr(q).some((w) => (dx ? w.a.y === w.b.y : w.a.x === w.b.x))
    const face = (q: Pt) => ([[1, 0, 0], [-1, 0, 2], [0, -1, 3], [0, 1, 1]].find(([dx, dy]) => !used(q, dx, dy)) ?? [0, 0, 0])[2]
    const flagIds = f.flags.map((g) => {
      const p: Part = { id: uid(), kind: g.kind, x: g.at.x, y: g.at.y, rot: g.rot ?? (g.kind === 'label' || g.kind === 'port' ? face(g.at) : 0), mirror: false, name: '', value: g.kind === 'gnd' ? '' : g.name }
      s.parts.push(p)
      return p.id
    })
    for (const g of extra) s.parts.push({ id: uid(), kind: g.kind, x: g.at.x, y: g.at.y, rot: g.kind === 'gnd' ? 0 : face(g.at), mirror: false, name: '', value: g.kind === 'gnd' ? '' : g.name })
    s.wires = [...wires, ...stubs]
    s.texts = f.texts.map((t) => ({ id: uid(), x: t.at.x, y: t.at.y, text: t.text }))
    if (!s.draw!.length) delete s.draw
    // the check: every source pin / flag with its source net and the net the netlister gives it
    const nl = netlist(s, 'import')
    const terms: { src: string; ours: string; part?: number; label: string }[] = []
    f.parts.forEach((p, k) => p.pins.forEach((q, i) => terms.push({ src: tgts[k][i], ours: nl.nets[s.parts[k].id][i], part: k, label: `${names[k]} pin ${i + 1}` })))
    f.holes.forEach((h, k) => h.pins.forEach((q, i) => terms.push({ src: netOf(q.at), ours: nl.nets[s.parts[f.parts.length + k].id][i], label: `${h.name} pin ${i + 1}` })))
    f.flags.forEach((g, k) => terms.push({ src: netOf(g.at), ours: nl.nets[flagIds[k]][0], label: g.kind === 'gnd' ? 'ground' : g.name }))
    const s2o = new Map<string, Set<string>>(), o2s = new Map<string, Set<string>>()
    for (const t of terms) s2o.set(t.src, new Set([...(s2o.get(t.src) ?? []), t.ours])), o2s.set(t.ours, new Set([...(o2s.get(t.ours) ?? []), t.src]))
    const off = terms.filter((t) => s2o.get(t.src)!.size > 1 || o2s.get(t.ours)!.size > 1)
    return { s, off, bad, terms, s2o, o2s }
  }

  let r = place(new Set())
  if (r.off.length || r.bad.length) r = place(new Set([...r.bad, ...r.off.flatMap((t) => (t.part == null ? [] : [t.part]))]))
  if (r.off.length) {
    // still different: say exactly which source nets were joined or split
    const label = (src: string) => userName.get(src) ? `net ${userName.get(src)}` : `the net of ${r.terms.find((t) => t.src === src)!.label}`
    const said = new Set<string>()
    for (const t of r.off) {
      const srcs = [...r.o2s.get(t.ours)!]
      if (srcs.length > 1 && !said.has('o' + t.ours)) said.add('o' + t.ours), f.report.push(`Connections differ from the original: ${srcs.map(label).join(' and ')} are joined here. Check the wiring there`)
      if (r.s2o.get(t.src)!.size > 1 && !said.has('s' + t.src)) said.add('s' + t.src), f.report.push(`Connections differ from the original: ${label(t.src)} is split into ${r.s2o.get(t.src)!.size} nets here. Check the wiring there`)
    }
  }
  const s = r.s
  try {
    parseSheet(JSON.stringify(s)) // what Save writes must load again
  } catch (e) {
    throw new Error(`The imported drawing is not valid: ${(e as Error).message}`)
  }
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
// LTspice OpAmps symbols with a compensation or shutdown pin where a 5-pin layout puts V+ (or 6+ pins on it)
// ponytail: from LTspice's library as shipped in 2026; a symbol added later is only caught by the wiring check
const OA_NOT5 = new Set(['lt1008', 'lm108a', 'lm308', 'rh101a', 'ltc6246'])
const OA5: [number, number][][] = [[[-32, 80], [-32, 48], [0, 32], [0, 96], [32, 64]], [[-32, 16], [-32, -16], [0, -32], [0, 32], [32, 0]]]

// LTspice orientation: R0..R270 (clockwise, like ours), M0..M270 (mirror in x, then rotate)
function ascXf(o: string) { const m = /^([RM])(\d+)$/.exec(o) ?? ['', 'R', '0']; return { rot: (+m[2] / 90) % 4, mirror: m[1] === 'M' } }
const ascVal = (v: string) => v.replace(/µ/g, 'u').replace(/\bSINE\s*\(/gi, 'SIN(').trim()

// grid: source units per grid step of ours. 16 normally; finer (a bigger drawing) when points are off LTspice's grid
export function importAsc(text: string, grid = 16): Imported {
  const f = foreign('lt'), sn = snapper(), L = (x: number, y: number) => sn.pt((x * 10) / grid, (y * 10) / grid)
  const lines = text.split(/\r?\n/)
  const flags = new Map<string, { at: Pt; name: string }>(), io = new Set<string>()
  type Sym = { name: string; x: number; y: number; o: string; attr: Record<string, string>; line: number }
  const syms: Sym[] = []
  const skipped = new Map<string, number>()
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1)
  let lt = false // an ideal LTspice op-amp was mapped: its .lib opamp.sub is not needed
  lines.forEach((raw, n) => {
    const l = raw.trim(), [kw, ...a] = l.split(/\s+/)
    try {
      if (kw === 'WIRE') f.wires.push([L(+a[0], +a[1]), L(+a[2], +a[3])])
      else if (kw === 'FLAG') { const at = L(+a[0], +a[1]); flags.set(`${a[0]},${a[1]}`, { at, name: a.slice(2).join(' ') }) }
      else if (kw === 'IOPIN') io.add(`${a[0]},${a[1]}`)
      else if (kw === 'SYMBOL') { if (!a[0]) throw new Skip('no symbol name'); fin(+a[1], +a[2]); syms.push({ name: a[0], x: +a[1], y: +a[2], o: a[3] ?? 'R0', attr: {}, line: n + 1 }) }
      else if (kw === 'SYMATTR' && syms.length) syms.at(-1)!.attr[a[0]] = a.slice(1).join(' ')
      else if (kw === 'TEXT') {
        const m = /^TEXT\s+(-?\d+)\s+(-?\d+)\s+\S+\s+\S+\s+([!;])(.*)$/.exec(l)
        if (!m) return
        const body = m[4].replace(/\\n/g, '\n'), at = L(+m[1], +m[2])
        if (m[3] === '!') f.texts.push({ at, text: body })
        else f.draw.push({ id: uid(), t: 'note', ...at, text: body })
      } else if (kw === 'LINE' || kw === 'RECTANGLE' || kw === 'CIRCLE') {
        const [x1, y1, x2, y2] = a.slice(1, 5).map(Number), D = (x: number, y: number) => P((x * 10) / grid, (y * 10) / grid)
        f.draw.push({ id: uid(), t: kw === 'LINE' ? 'line' : kw === 'RECTANGLE' ? 'rect' : 'ellipse', a: D(x1, y1), b: D(x2, y2) })
      } else if (kw === 'ARC') skip('arc (drawing)')
      else if (kw === 'BUSTAP' || kw === 'DATAFLAG') skip(kw.toLowerCase())
    } catch (e) {
      if (!(e instanceof Skip)) throw e
      f.report.push(`Line ${n + 1} (${kw}) skipped: ${e.message}`)
    }
  })
  if (f.wires.length > LIMIT.wires || syms.length > LIMIT.symbols) throw new Error(`This schematic is too large to import (${f.wires.length} wires, ${syms.length} symbols; the limit is ${LIMIT.wires} wires and ${LIMIT.symbols} symbols)`)
  for (const [k, g] of flags) {
    if (g.name === '0') f.flags.push({ kind: 'gnd', at: g.at, name: '0' })
    else {
      // LTspice keeps a net called GND apart from ground (0); here GND is ground, so it is renamed
      const name = /^gnd$/i.test(g.name) ? g.name + '_' : g.name.replace(/\s+/g, '_')
      if (name !== g.name.replace(/\s+/g, '_') && !f.report.some((x) => x.startsWith('Net ' + g.name))) f.report.push(`Net ${g.name} renamed ${name}: in LTspice it is not ground (0), but here a net called ${g.name} would be`)
      f.flags.push({ kind: io.has(k) ? 'port' : 'label', at: g.at, name })
    }
  }
  // connection points of the source (wire ends and middles, flags, known symbols' pins): a vendor op-amp is only
  // mapped when every pin of one of the two layouts lands on one
  const segs = new Segs()
  for (const [a, b] of f.wires) if (!same(a, b)) segs.add({ a, b, net: '' })
  const conn = new Set([...f.wires.flat(), ...f.flags.map((g) => g.at)].map(K))
  for (const s of syms) {
    const sym = ASC[s.name.split(/[\\/]+/).pop()!.toLowerCase()], { rot, mirror } = ascXf(s.o)
    for (const q of sym?.pins ?? []) { const w = xform({ x: s.x, y: s.y, rot, mirror }, { x: q[0], y: q[1] }); conn.add(K(L(w.x, w.y))) }
  }
  const connected = (q: Pt) => conn.has(K(q)) || segs.through(q).length > 0
  for (const s of syms) {
    const seg = s.name.split(/[\\/]+/), base = seg.pop()!.toLowerCase(), dir = seg.join('/').toLowerCase() // LTspice writes Opamps\\LT1001
    const { rot, mirror } = ascXf(s.o), inst = clean(s.attr.InstName ?? ''), v = ascVal([s.attr.Value, s.attr.Value2].filter(Boolean).join(' '))
    const world = (q: [number, number]) => { const w = xform({ x: s.x, y: s.y, rot, mirror }, { x: q[0], y: q[1] }); return L(w.x, w.y) }
    let sym = ASC[base]
    let value = v, kind = sym?.kind, lib: string | undefined
    if (!sym && (dir === 'opamps' || base === 'opamp2' || base === 'universalopamp2')) {
      // vendor op-amp: only when all five pins of a known layout are connected in the source; the generic macromodel.
      // An .asc doesn't say which pin is which, so this is a guess by position: the report says to check the supplies,
      // and symbols known to have another pin where a layout expects V+ (compensation, shutdown) are never guessed.
      const lay = OA_NOT5.has(base) ? undefined : OA5.map((p) => p.map(world)).find((p) => p.every(connected))
      const what = s.attr.Value || s.name.split(/[\\/]+/).pop()
      if (lay) {
        f.parts.push({ kind: 'opamp5', name: inst, value: 'OA_GENERIC', lib: 'std:OA_GENERIC', pins: lay, rot, mirror })
        f.report.push(`${inst || base}: ${what} placed as the generic op-amp model OA_GENERIC with its pins matched by position (in+ in- V+ V- out): check that the supply pins landed on the supplies. Import the vendor model in Manage Libraries to use it`)
      } else {
        f.holes.push({ name: inst || base, value: base, at: L(s.x, s.y), pins: [] })
        f.report.push(`${inst || base}: ${what} is not a 5-pin op-amp with all its pins wired: placeholder block without pins, replace it and wire it by hand`)
      }
      continue
    }
    if (!sym) {
      // its pin positions live in the .asy, not in the .asc: an unconnected placeholder at the symbol
      const n = inst || base
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
  opamp5: [['+', 'in+', '+in', 'non-inverting'], ['-', 'in-', '-in', 'inverting'], ['v+', 'vcc', 'vdd', 'v+_'], ['v-', 'vee', 'vss', 'v-_'], ['out', '~', '', 'output', 'vout']],
  opamp: [['out', '~', '', 'output', 'vout'], ['+', 'in+', '+in'], ['-', 'in-', '-in']] // KiCad 9+ leaves the output pin unnamed
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
  type N = string | number | SX | undefined
  const KI = 10 / grid, root = sexpr(text), f = foreign('kicad'), sn = snapper(), kp = (x: N, y: N) => sn.pt(+x! * KI, +y! * KI), kpt = (x: N, y: N) => P(+x! * KI, +y! * KI)
  if (root[0] !== 'kicad_sch') throw new Error('Not a KiCad schematic (.kicad_sch)')
  const libs = new Map<string, SX[]>(kid(root, 'lib_symbols')?.slice(1).filter(Array.isArray).map((s) => [s[1] as string, s as SX[]]) ?? [])
  const skipped = new Map<string, number>()
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1)
  // each element on its own: a malformed one (missing or non-numeric coordinates) is skipped with a report line
  const each = (k: string, fn: (x: SX[]) => void) => kids(root, k).forEach((x) => {
    try {
      fn(x)
    } catch (e) {
      if (!(e instanceof Skip) && !(e instanceof TypeError)) throw e
      f.report.push(`A ${k.replace('_', ' ')} was skipped: ${e instanceof Skip ? e.message : 'malformed'}`)
    }
  })
  const at = (x: SX[]) => kid(x, 'at') ?? (() => { throw new Skip('no position') })()
  each('wire', (w) => {
    const xy = kids(kid(w, 'pts'), 'xy')
    for (let i = 1; i < xy.length; i++) f.wires.push([kp(xy[i - 1][1], xy[i - 1][2]), kp(xy[i][1], xy[i][2])])
  })
  each('junction', (j) => f.junctions.push(kp(at(j)[1], at(j)[2])))
  for (const [k, kind] of [['label', 'label'], ['global_label', 'label'], ['hierarchical_label', 'port']] as const)
    each(k, (l) => f.flags.push({ kind, at: kp(at(l)[1], at(l)[2]), name: String(l[1]).replace(/\s+/g, '_'), onWire: true }))
  each('text', (t) => {
    const s = String(t[1]), p = kpt(at(t)[1], at(t)[2])
    if (/^\s*\./.test(s)) f.texts.push({ at: p, text: s })
    else f.draw.push({ id: uid(), t: 'note', ...p, text: s })
  })
  each('text_box', (t) => f.draw.push({ id: uid(), t: 'note', ...kpt(at(t)[1], at(t)[2]), text: String(t[1]) }))
  each('polyline', (g) => {
    const xy = kids(kid(g, 'pts'), 'xy')
    for (let i = 1; i < xy.length; i++) f.draw.push({ id: uid(), t: 'line', a: kpt(xy[i - 1][1], xy[i - 1][2]), b: kpt(xy[i][1], xy[i][2]) })
  })
  each('rectangle', (g) => f.draw.push({ id: uid(), t: 'rect', a: kpt(kid(g, 'start')[1], kid(g, 'start')[2]), b: kpt(kid(g, 'end')[1], kid(g, 'end')[2]) }))
  each('circle', (g) => {
    const c = kid(g, 'center'), r = +kid(g, 'radius')[1]
    f.draw.push({ id: uid(), t: 'ellipse', a: kpt(+c[1] - r, +c[2] - r), b: kpt(+c[1] + r, +c[2] + r) })
  })
  for (const k of ['bus', 'bus_entry', 'sheet', 'arc', 'image', 'netclass_flag']) for (const _ of kids(root, k)) skip(k.replace('_', ' '))
  if (f.wires.length > LIMIT.wires || kids(root, 'symbol').length > LIMIT.symbols) throw new Error(`This schematic is too large to import (${f.wires.length} wires, ${kids(root, 'symbol').length} symbols; the limit is ${LIMIT.wires} wires and ${LIMIT.symbols} symbols)`)

  each('symbol', (inst) => {
    const id = String(kid(inst, 'lib_id')?.[1] ?? ''), sym = libs.get(String(kid(inst, 'lib_name')?.[1] ?? id)), at = kid(inst, 'at'), mir = kid(inst, 'mirror')?.[1] as string | undefined
    const unit = +(kid(inst, 'unit')?.[1] ?? 1), ref = prop(inst, 'Reference') ?? '', value = prop(inst, 'Spice_Model') ?? prop(inst, 'Value') ?? ''
    if (!sym || !at) return void f.report.push(`${ref || id}: symbol "${id}" missing from the file's library cache: skipped`)
    // pins of this unit (sub-symbols NAME_<unit>_<style>; unit 0 = common to all units)
    const pins: KPin[] = kids(sym, 'symbol').filter((u) => { const m = /_(\d+)_(\d+)$/.exec(String(u[1])); return !m || +m[1] === 0 || +m[1] === unit })
      .flatMap((u) => kids(u, 'pin')).map((p) => ({ name: String(kid(p, 'name')?.[1] ?? ''), num: String(kid(p, 'number')?.[1] ?? ''), at: { x: +kid(p, 'at')![1], y: +kid(p, 'at')![2] } }))
    const world = (q: KPin) => { const w = kWorld(at, mir, q.at); return kp(w.x, w.y) }
    if (kid(sym, 'power') || id.toLowerCase().startsWith('power:')) {
      if (!pins.length) return
      const gnd = /^(gnd\w*|earth|0)$/i.test(value) || /^power:(gnd\w*|earth)$/i.test(id)
      // our ground hangs down and the power bar stands up at rot 0, like KiCad's at 0°; mirror x turns them over
      const rot = (((4 - Math.round(+(at[3] ?? 0) / 90)) % 4) + 4 + (mir === 'x' ? 2 : 0)) % 4
      f.flags.push({ kind: gnd ? 'gnd' : 'power', at: world(pins[0]), name: value.replace(/\s+/g, '_'), rot })
      return
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
      return
    }
    if (/operational/i.test(id) && pins.length === 2 && pins.every((p) => /^v[+-]|^v[cdse]{2}/i.test(p.name))) return void f.report.push(`${ref}: op-amp supply unit not converted (the op-amp units are ideal)`)
    f.holes.push({ name: ref, value: id.split(':').pop()!, at: kpt(at[1], at[2]), pins: pins.map((p) => ({ name: p.name && p.name !== '~' ? p.name : p.num, at: world(p) })) })
    f.report.push(`${ref}: "${id}" (${value}) has no equivalent here: placeholder block, replace it before simulating`)
  })
  for (const [w, n] of skipped) f.report.push(`${n} ${w}${n > 1 ? (w.endsWith('s') ? 'es' : 's') : ''} not converted`)
  const finer = [0.635, 0.254, 0.127, 0.0254].find((g) => g < grid - 1e-9)
  if (sn.merged && finer) return importKicad(text, finer)
  sn.report(f, `${grid} mm`)
  if (grid !== 1.27) f.report.push(`Drawn ${+(1.27 / grid).toFixed(1)}× larger than usual: some pins are off KiCad's 1.27 mm grid`)
  return build(f, 'KiCad schematic')
}

export function importSchematic(file: string, text: string): Imported {
  if (!/\.(asc|kicad_sch)$/i.test(file)) throw new Error('Import reads LTspice .asc and KiCad .kicad_sch files')
  try {
    return /\.asc$/i.test(file) ? importAsc(text) : importKicad(text)
  } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) throw new Error(`This file could not be read as ${/\.asc$/i.test(file) ? 'an LTspice schematic' : 'a KiCad schematic'}: it looks damaged or uses something the importer doesn't know`)
    throw e
  }
}
