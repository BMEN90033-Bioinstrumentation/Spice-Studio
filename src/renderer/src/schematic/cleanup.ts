// "Clean up": tidies a sheet in three steps.
//  1. spread: parts, cards and notes that overlap are pushed apart. Everything keeps its order left-to-right and
//     top-to-bottom and wires only get longer or shorter, so no wire gains a bend and no net changes.
//  2. tidyWires: doubled-up and split wires are merged, and a wire that wanders (a detour between two points in line,
//     or three or more corners) is replaced by a straight run or a single corner when that path is free.
//  3. cleanLabels: name/value labels move to a free spot beside their part, off parts, wires, cards and other labels.
// Pure: the caller supplies the boxes (they live with the drawing code).
import { isFlag } from './symbols.ts'
import { GRID, key, pins, same, uid, wiresThrough, xform, type Directive, type Drawing, type Part, type Pt, type Sheet, type Wire } from './model.ts'

export type Box = { x0: number; y0: number; x1: number; y1: number }
// The groups a set of boxes falls into: boxes within `gap` of each other, chained. Align / Distribute move each group as one.
// ponytail: O(n²) over the selection
export function clusters<T extends { b: Box }>(items: T[], gap = 0): T[][] {
  let out: T[][] = []
  const near = (a: Box, b: Box) => a.x0 <= b.x1 + gap && b.x0 <= a.x1 + gap && a.y0 <= b.y1 + gap && b.y0 <= a.y1 + gap
  for (const i of items) {
    const hit = out.filter((g) => g.some((j) => near(i.b, j.b)))
    out = [...out.filter((g) => !hit.includes(g)), [...hit.flat(), i]]
  }
  return out
}
export interface Geo {
  pbox: (p: Part) => Box // the whole part, pins included
  body?: (p: Part) => Box // the drawn body without the leads out to the pins; labels sit beside it (default: pbox)
  tbox?: (t: Directive) => Box // directive card
  dbox?: (d: Drawing) => Box // note, title block or shape
}
type Anchor = 'start' | 'middle' | 'end'

// where Texts draws the two labels (text baseline + anchor) for a part box: beside a tall part, above/below a wide one
export function labelAt(b: Box) {
  const tall = b.y1 - b.y0 >= b.x1 - b.x0, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
  return { n: tall ? [b.x1 + 3, cy - 2] : [cx, b.y0 - 4], v: tall ? [b.x1 + 3, cy + 10] : [cx, b.y1 + 11], anchor: tall ? ('start' as const) : ('middle' as const) }
}
// where Texts draws a flag's one text (net label, port, power rail, bus tap), given its box; null for other parts
export function flagAt(p: Part, b: Box): { x: number; y: number; anchor: Anchor } | null {
  if (p.kind === 'bustap') { // member name just past the wire end, away from the bus
    const t = xform(p, { x: 13, y: 13 }), dx = t.x - p.x, dy = t.y - p.y
    return { x: t.x, y: t.y + (dy > 0 ? 6 : 0), anchor: dx > 0 ? 'start' : 'end' }
  }
  if (p.kind !== 'label' && p.kind !== 'port' && p.kind !== 'power') return null
  // text sits just past the symbol along its pointing direction: +x for labels/ports, up (-y) for the power bar
  const d = xform({ x: 0, y: 0, rot: p.rot, mirror: p.mirror }, p.kind === 'power' ? { x: 0, y: -1 } : { x: 1, y: 0 })
  return { x: d.x > 0 ? b.x1 + 1 : d.x < 0 ? b.x0 - 1 : p.x, y: (d.y > 0 ? b.y1 + 1 : d.y < 0 ? b.y0 - 1 : p.y) + (d.y > 0 ? 8 : d.y < 0 ? 0 : 3.5), anchor: d.x > 0 ? 'start' : d.x < 0 ? 'end' : 'middle' }
}

// ponytail: text size estimated from the 9px monospace label font (no DOM here); close enough to keep labels apart
const CW = 5.5, UP = 8, DOWN = 2, H = UP + DOWN
const shown = (p: Part) => (p.sheet ? p.sheet.replace(/^.*\//, '').replace(/\.nsch$/i, '').length : Math.min(16, p.value.length))
const textBox = (x: number, y: number, chars: number, anchor: Anchor): Box => {
  const w = Math.max(1, chars) * CW, x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2
  return { x0, y0: y - UP, x1: x0 + w, y1: y + DOWN }
}
const flagBox = (p: Part, b: Box): Box | null => { const f = flagAt(p, b); return f && textBox(f.x, f.y, p.value.length, f.anchor) }
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const shift = (b: Box, d: Pt): Box => ({ x0: b.x0 + d.x, y0: b.y0 + d.y, x1: b.x1 + d.x, y1: b.y1 + d.y })
const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d })
const span = (a: Pt, b: Pt): Box => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) })
const within = (w: { a: Pt; b: Pt }, q: Pt) => (w.b.x - w.a.x) * (q.y - w.a.y) === (w.b.y - w.a.y) * (q.x - w.a.x) && hitsIn(span(w.a, w.b), q) // on the segment, ends included
const hitsIn = (b: Box, q: Pt) => b.x0 <= q.x && q.x <= b.x1 && b.y0 <= q.y && q.y <= b.y1
const isShape = (d: Drawing): d is Extract<Drawing, { a: Pt }> => 'a' in d

function unionFind() {
  const up = new Map<string, string>()
  const find = (k: string): string => { let r = k; while (up.has(r)) r = up.get(r)!; while (up.has(k)) { const n = up.get(k)!; up.set(k, r); k = n } return r }
  return { find, tie: (a: string, b: string) => { a = find(a); b = find(b); if (a !== b) up.set(a, b) } }
}

// Which pins share a net, as a string that only changes when the connectivity does (positions don't matter).
// Same rules as model.ts connections(): coinciding ends and pins connect, and so does a wire end landing on a wire.
export function netSignature(s: Sheet): string {
  const { find, tie } = unionFind(), ws = [...s.wires, ...(s.buses ?? [])], through = wiresThrough(ws)
  for (const w of ws) tie(key(w.a), key(w.b))
  for (const w of ws) for (const e of [w.a, w.b]) for (const o of through(e)) tie(key(e), key(o.a))
  const nets = new Map<string, string[]>()
  for (const p of s.parts) pins(p).forEach((q, i) => { const r = find(key(q)); (nets.get(r) ?? nets.set(r, []).get(r)!).push(`${p.id}.${i}`) })
  return [...nets.values()].map((v) => v.join(' ')).sort().join('|')
}

// ---- 1. spread ----
const PAD = 3 // what the part boxes are padded by (Symbol.tsx): taken off again to compare what is actually drawn
const CLEAR = 3 // room left between two things that were overlapping, before rounding up to the grid
const KINK = 2 * GRID // a wire piece this short between two longer runs is a kink to pull straight
// One axis at a time. Points that must move together along the axis (a part and its pins, the two ends of a wire that
// runs across the axis, everything touching them) form a group; a group only ever moves by a whole number of grid
// steps. Three kinds of request are then solved together as longest paths (the 1-D compaction used in chip layout):
//  - everything already in order stays in order (so nothing new can overlap or touch);
//  - overlapping things in different groups ask for room;
//  - a kink (a short wire along the axis joining two runs across it, or leaving a pin sideways) asks to close up, which
//    lines the two runs up into one straight wire.
// A request that can't be met without breaking the first rule is dropped.
// ponytail: all pairs are compared, O(n²); sweep along the axis if sheets reach thousands of parts
function spreadAxis(s: Sheet, g: Geo, X: boolean, last: boolean): Sheet {
  const { find, tie } = unionFind()
  // n: the group its low edge moves with, m: its high edge (the same group, except for a wire running along the axis)
  type Item = { n: string; m: string; lo: number; hi: number; p0: number; p1: number; t: 'box' | 'wire' | 'soft' | 'span'; part?: Part; wire?: Wire }
  type Con = { a: string; b: string; w: number; i?: Item; j?: Item; wire?: Wire } // shift(b) - shift(a) >= w
  const items: Item[] = [], keep: Con[] = []
  const u = (q: Pt) => (X ? q.x : q.y), v = (q: Pt) => (X ? q.y : q.x)
  const item = (n: string, b: Box, t: Item['t'], x?: { part?: Part; wire?: Wire; m?: string }) => items.push({ n, m: n, t, ...x, ...(X ? { lo: b.x0, hi: b.x1, p0: b.y0, p1: b.y1 } : { lo: b.y0, hi: b.y1, p0: b.x0, p1: b.x1 }) })
  const slack = (gap: number) => -Math.floor(Math.max(0, gap - GRID) / GRID) * GRID // how far a gap may close: never below a grid step
  const pinsAt = new Map<string, Part[]>(), endsAt = new Map<string, Wire[]>()
  const push = <T>(m: Map<string, T[]>, k: string, x: T) => (m.get(k) ?? m.set(k, []).get(k)!).push(x)
  for (const p of s.parts) {
    const n = '#' + p.id, b = g.pbox(p), f = flagBox(p, b)
    for (const q of pins(p)) tie(key(q), n), push(pinsAt, key(q), p)
    item(n, grow(b, -PAD), 'box', { part: p })
    if (f) item(n, f, 'box', { part: p })
  }
  const segs = [...s.wires, ...(s.buses ?? [])], through = wiresThrough(segs)
  const across = (w: Wire) => u(w.a) === u(w.b) || v(w.a) !== v(w.b) // rigid along this axis (diagonals too)
  const along: Wire[] = []
  for (const w of segs) {
    for (const e of [w.a, w.b]) push(endsAt, key(e), w)
    if (across(w)) { tie(key(w.a), key(w.b)); item(key(w.a), grow(span(w.a, w.b), 0.5), 'wire', { wire: w }); continue }
    const [a, b] = u(w.a) < u(w.b) ? [w.a, w.b] : [w.b, w.a]
    keep.push({ a: key(a), b: key(b), w: slack(u(b) - u(a)), wire: w }) // a wire along the axis stretches, but keeps its direction
    for (const e of [a, b]) item(key(e), grow(span(e, e), 0.5), 'wire', { wire: w }) // its ends keep their place among the neighbours
    item(key(a), grow(span(a, b), 0.5), 'span', { wire: w, m: key(b) }) // its length must stay off parts
    along.push(w)
  }
  for (const w of segs) for (const e of [w.a, w.b]) for (const o of through(e)) if (across(o)) tie(key(e), key(o.a)) // T-junction stays on its wire
  for (const t of s.texts) if (g.tbox) item('t' + t.id, g.tbox(t), 'box')
  for (const d of s.draw ?? []) {
    if (!g.dbox) continue
    if (!isShape(d)) { item('d' + d.id, g.dbox(d), 'box'); continue }
    // a shape stretches with what it frames: each end is a line across the shape that is pushed along with its
    // neighbours but never counts as overlapping them
    const b = g.dbox(d), na = 'd' + d.id + 'a', nb = 'd' + d.id + 'b'
    for (const [n, q] of [[na, d.a], [nb, d.b]] as const) item(n, X ? { ...b, x0: q.x, x1: q.x } : { ...b, y0: q.y, y1: q.y }, 'soft')
    if (u(d.a) === u(d.b)) tie(na, nb)
    else keep.push(u(d.a) < u(d.b) ? { a: na, b: nb, w: slack(u(d.b) - u(d.a)) } : { a: nb, b: na, w: slack(u(d.a) - u(d.b)) })
  }
  // per overlap: the push that keeps the two in their order, then the other way round
  const want: { f: Item; l: Item; ways: [string, string, number][] }[] = []
  const room = (d: number) => Math.ceil((d + CLEAR) / GRID) * GRID
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j], over = Math.min(a.p1, b.p1) - Math.max(a.p0, b.p0)
    const lone = a.t === 'span' || b.t === 'span' // a wire along the axis only matters where it runs over a box
    if (over <= 0 || (lone ? a.t !== 'box' && b.t !== 'box' : find(a.n) === find(b.n))) continue
    const [f, l] = a.lo + a.hi <= b.lo + b.hi ? [a, b] : [b, a], gap = l.lo - f.hi
    if (gap >= 0) { if (!lone) keep.push({ a: f.n, b: l.n, w: slack(gap), i: f, j: l }); continue }
    const depth = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)
    if (depth < 1 || over < 1 || a.t === 'soft' || b.t === 'soft' || (a.t === 'wire' && b.t === 'wire')) continue // touching is not overlapping
    // a part sitting on a wire with a pin on it was put there on purpose (to be wired in): leave the pair alone
    const [w, p] = a.wire ? [a.wire, b.part] : [b.wire, a.part]
    if (w && p && pins(p).some((q) => within(w, q))) continue
    // separate along whichever axis needs the smaller move; the second pass takes whatever is still overlapping
    // the first clears l's low edge past f's high edge; the second the other way round
    const ways: [string, string, number][] = [[f.m, l.n, room(f.hi - l.lo)], [l.m, f.n, room(l.hi - f.lo)]]
    if (last || lone || depth <= over) want.push({ f, l, ways: lone ? ways.sort((p, q) => p[2] - q[2]) : ways })
  }
  // kinks: a short wire along the axis whose ends are plain corners, or one corner and a pin it leaves sideways
  const inked = (p: Part) => grow(g.body!(p), -PAD)
  const end = (w: Wire, q: Pt): 'corner' | 'pin' | null => {
    const ws = endsAt.get(key(q))!, ps = pinsAt.get(key(q)) ?? []
    if (through(q).length) return null
    if (ws.length === 2 && !ps.length) { const o = ws.find((x) => x !== w)!; return u(o.a) === u(o.b) ? 'corner' : null }
    if (ws.length !== 1 || ps.length !== 1 || !g.body) return null
    const b = inked(ps[0])
    return (X ? q.y < b.y0 || q.y > b.y1 : q.x < b.x0 || q.x > b.x1) ? 'pin' : null // the pin's lead runs across the axis
  }
  // a kink at a pin only closes if the run beyond the corner heads away from the part, not back across it
  const away = (pin: Pt, corner: Pt, w: Wire) => {
    const o = endsAt.get(key(corner))!.find((x) => x !== w)!, far = same(o.a, corner) ? o.b : o.a, b = inked(pinsAt.get(key(pin))![0]), c = X ? (b.y0 + b.y1) / 2 : (b.x0 + b.x1) / 2
    return Math.sign(v(far) - v(corner)) === Math.sign(v(pin) - c)
  }
  const kinks = along.filter((w) => {
    if (Math.abs(u(w.a) - u(w.b)) > KINK) return false
    const ea = end(w, w.a), eb = end(w, w.b)
    return ea && eb && (ea === 'corner' || eb === 'corner') && (ea !== 'pin' || away(w.a, w.b, w)) && (eb !== 'pin' || away(w.b, w.a, w))
  })
  if (!want.length && !kinks.length) return s

  const groups = new Set(items.map((i) => find(i.n))).size
  const settle = (cs: Con[], d: Map<string, number>) => {
    for (let n = 0; n <= groups; n++) {
      let moved = false
      for (const c of cs) { const k = (d.get(c.a) ?? 0) + c.w; if (k > (d.get(c.b) ?? 0)) d.set(c.b, k), (moved = true) }
      if (!moved) return true
    }
    return false // never settles: the requests contradict each other
  }
  let cs = keep.map((c) => ({ ...c, a: find(c.a), b: find(c.b) })), d = new Map<string, number>()
  const attempt = (base: Con[], extra: Con[]) => { const t = new Map(d); if (!settle([...base, ...extra], t)) return false; cs = [...base, ...extra]; d = t; return true }
  // the rules that hold a wire's two ends in order: its own, and those between the things meeting at either end
  const on = (i: Item, q: Pt) => i.lo <= u(q) && u(q) <= i.hi && i.p0 <= v(q) && v(q) <= i.p1
  const holds = (c: Con, w: Wire) => c.wire === w || (!!c.i && !!c.j && ((on(c.i, w.a) && on(c.j, w.b)) || (on(c.i, w.b) && on(c.j, w.a))))
  for (const { f, l, ways } of want.sort((p, q) => p.ways[0][2] - q.ways[0][2])) {
    const con = ([a, b, w]: [string, string, number]): Con => ({ a: find(a), b: find(b), w })
    // two overlapping parts joined by a wire that runs backwards between them: let that wire turn round
    const ties = along.filter((w) => { const ka = find(key(w.a)), kb = find(key(w.b)); return (ka === find(f.n) && kb === find(l.n)) || (ka === find(l.n) && kb === find(f.n)) })
    attempt(cs, [con(ways[0])]) || (ties.length && attempt(cs.filter((c) => !ties.some((w) => holds(c, w))), [con(ways[0])])) || attempt(cs, [con(ways[1])])
  }
  for (const w of kinks) {
    const [a, b] = u(w.a) < u(w.b) ? [w.a, w.b] : [w.b, w.a], ka = find(key(a)), kb = find(key(b)), len = u(b) - u(a)
    if (ka !== kb) attempt(cs.filter((c) => !holds(c, w)), [{ a: kb, b: ka, w: len }, { a: ka, b: kb, w: -len }])
  }
  // only differences matter: count the moves from where most parts stay put
  const of = (n: string) => d.get(find(n)) ?? 0, tally = new Map<number, number>()
  for (const p of s.parts) tally.set(of('#' + p.id), (tally.get(of('#' + p.id)) ?? 0) + 1)
  const home = [...tally].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 0
  const mv = <T extends Pt>(q: T, n: string): T => { const k = of(n) - home; return k ? (X ? { ...q, x: q.x + k } : { ...q, y: q.y + k }) : q }
  const seg = (w: Wire) => { const a = mv(w.a, key(w.a)), b = mv(w.b, key(w.b)); return a === w.a && b === w.b ? w : { ...w, a, b } }
  const r: Sheet = {
    ...s, parts: s.parts.map((p) => mv(p, '#' + p.id)), wires: s.wires.map(seg), texts: s.texts.map((t) => mv(t, 't' + t.id)),
    ...(s.buses && { buses: s.buses.map(seg) }),
    ...(s.draw && { draw: s.draw.map((x) => (isShape(x) ? { ...x, a: mv(x.a, 'd' + x.id + 'a'), b: mv(x.b, 'd' + x.id + 'b') } : mv(x, 'd' + x.id))) })
  }
  return r.parts.every((p, i) => p === s.parts[i]) && r.wires.every((w, i) => w === s.wires[i]) && r.texts.every((t, i) => t === s.texts[i]) ? s : r
}
export const spread = (s: Sheet, g: Geo): Sheet => spreadAxis(spreadAxis(s, g, true, false), g, false, true)

// ---- 2. wires ----
const horiz = (w: Wire) => w.a.y === w.b.y, vert = (w: Wire) => w.a.x === w.b.x
// Zero-length wires go; wires lying along the same line that touch or overlap become one, still split wherever a pin
// or another wire's end sits (a pin only connects at a wire end, so those splits carry the connection).
function mergeWires(ws: Wire[], pinAt: Set<string>): Wire[] {
  const ends = (f: (w: Wire) => boolean) => new Set(ws.filter(f).flatMap((w) => [key(w.a), key(w.b)]))
  const endH = ends((w) => !vert(w)), endV = ends((w) => !horiz(w)) // ends of wires not running vertically / horizontally
  const out: Wire[] = ws.filter((w) => !horiz(w) && !vert(w))
  for (const H of [true, false]) {
    const lines = new Map<number, Wire[]>()
    for (const w of ws) if ((H ? horiz(w) : vert(w)) && !same(w.a, w.b)) { const k = H ? w.a.y : w.a.x; (lines.get(k) ?? lines.set(k, []).get(k)!).push(w) }
    const u = (q: Pt) => (H ? q.x : q.y), pt = (k: number, v: number): Pt => (H ? { x: v, y: k } : { x: k, y: v }), cross = H ? endV : endH
    for (const [k, line] of lines) {
      const sorted = line.map((w) => ({ w, lo: Math.min(u(w.a), u(w.b)), hi: Math.max(u(w.a), u(w.b)) })).sort((a, b) => a.lo - b.lo)
      for (let i = 0; i < sorted.length; ) {
        let j = i + 1, hi = sorted[i].hi
        while (j < sorted.length && sorted[j].lo <= hi) hi = Math.max(hi, sorted[j++].hi)
        const run = sorted.slice(i, j), lo = run[0].lo
        const cuts = [...new Set(run.flatMap((r) => [r.lo, r.hi]))].filter((v) => v > lo && v < hi && (pinAt.has(key(pt(k, v))) || cross.has(key(pt(k, v))))).sort((a, b) => a - b)
        const stops = [lo, ...cuts, hi]
        for (let n = 0; n + 1 < stops.length; n++) out.push({ id: run[n]?.w.id ?? uid(), a: pt(k, stops[n]), b: pt(k, stops[n + 1]) })
        i = j
      }
    }
  }
  const sig = (l: Wire[]) => l.map((w) => [key(w.a), key(w.b)].sort().join('>')).sort().join(' ')
  return sig(out) === sig(ws) ? ws : out
}

// A wire that wanders between two fixed points (pins, junctions, loose ends) is replaced by the direct route when that
// route is free: straight if the two line up, else one corner. A two-corner step between points that don't line up is
// left alone (it is how a wire normally gets from one row to another).
function straighten(ws: Wire[], allPins: Pt[], blocks: Box[]): Wire[] {
  const pinAt = new Set(allPins.map(key)), at = new Map<string, Wire[]>(), through = wiresThrough(ws)
  for (const w of ws) for (const e of [w.a, w.b]) (at.get(key(e)) ?? at.set(key(e), []).get(key(e))!).push(w)
  const tapped = new Set(ws.flatMap((w) => [w.a, w.b]).flatMap(through)) // wires with another wire's end on them: a junction part-way along
  const ortho = (w: Wire) => horiz(w) !== vert(w)
  // a plain corner: exactly two wires end here, at right angles, and nothing else touches the point
  const corner = (q: Pt) => { const l = at.get(key(q))!; return l.length === 2 && l.every(ortho) && horiz(l[0]) !== horiz(l[1]) && !pinAt.has(key(q)) && !through(q).length }
  const seen = new Set<Wire>(), gone = new Set<Wire>(), added: Wire[] = []
  for (const w0 of ws) {
    if (seen.has(w0) || !ortho(w0)) continue
    const chain = [w0], walk = (from: Pt, w: Wire, push: (x: Wire) => void): Pt => {
      for (;;) {
        const q = same(w.a, from) ? w.b : w.a
        if (!corner(q)) return q
        const n = at.get(key(q))!.find((x) => x !== w)!
        if (n === w0) return q // closed loop
        push(n); from = q; w = n
      }
    }
    const B = walk(w0.a, w0, (x) => chain.push(x)), A = walk(w0.b, w0, (x) => chain.unshift(x))
    chain.forEach((w) => seen.add(w))
    const k = chain.length - 1
    if (k < 2 || same(A, B) || new Set(chain).size !== chain.length || chain.some((w) => tapped.has(w))) continue
    const first = chain[0], hFirst = { x: B.x, y: A.y }, vFirst = { x: A.x, y: B.y }
    // one corner: leave A the way the wire did if that route is free
    const routes: Pt[][] = A.x === B.x || A.y === B.y ? [[A, B]] : k >= 3 ? (horiz(first) ? [[A, hFirst, B], [A, vFirst, B]] : [[A, vFirst, B], [A, hFirst, B]]) : []
    const mine = new Set(chain), others = ws.filter((w) => !mine.has(w) && !gone.has(w)).concat(added)
    const free = (r: Pt[]) => r.slice(1).every((q, i) => {
      const sg = { a: r[i], b: q }, inner = (e: Pt) => within(sg, e) && !same(e, A) && !same(e, B)
      if (allPins.some(inner) || blocks.some((b) => hits(grow(span(sg.a, sg.b), 0.5), b))) return false
      return !others.some((o) => inner(o.a) || inner(o.b) || (!same(q, B) && within(o, q)) || (within(o, sg.a) && within(o, sg.b)) || (within(sg, o.a) && within(sg, o.b)))
    })
    const r = routes.find(free)
    if (!r) continue
    chain.forEach((w) => gone.add(w))
    r.slice(1).forEach((q, i) => added.push({ id: i ? uid() : first.id, a: r[i], b: q }))
  }
  return gone.size ? ws.filter((w) => !gone.has(w)).concat(added) : ws
}

export function tidyWires(s: Sheet, g: Geo): Sheet {
  const allPins = s.parts.flatMap(pins), pinAt = new Set(allPins.map(key))
  // a new route keeps off part bodies (the padded box less the padding, so a pin on the edge is fine), flag texts and cards
  const blocks = [...s.parts.flatMap((p) => { const b = g.pbox(p), f = flagBox(p, b); return f ? [grow(b, -PAD - 1), f] : [grow(b, -PAD - 1)] }), ...s.texts.flatMap((t) => (g.tbox ? [g.tbox(t)] : []))]
  const merged = mergeWires(s.wires, pinAt), straight = straighten(merged, allPins, blocks)
  const wires = straight === merged ? merged : mergeWires(straight, pinAt)
  return wires === s.wires ? s : { ...s, wires }
}

// ---- 3. labels ----
// only: limit to these part ids (the selection)
export function cleanLabels(s: Sheet, g: Geo, only?: Set<string>): Sheet {
  const boxes = new Map(s.parts.map((p) => [p.id, g.pbox(p)]))
  // what a label must stay off, with how bad sitting on it is: part bodies and their leads, flag texts, wires, cards
  const fixed: [Box, number][] = []
  for (const p of s.parts) {
    const b = boxes.get(p.id)!, body = g.body?.(p) ?? b, f = flagBox(p, b)
    fixed.push([body, 4])
    for (const q of pins(p)) if (!hitsIn(body, q)) fixed.push([grow(span(q, { x: Math.min(body.x1, Math.max(body.x0, q.x)), y: Math.min(body.y1, Math.max(body.y0, q.y)) }), 2), 4])
    if (f) fixed.push([f, 4])
  }
  for (const w of [...s.wires, ...(s.buses ?? [])]) fixed.push([grow(span(w.a, w.b), 1), 3])
  for (const t of s.texts) if (g.tbox) fixed.push([g.tbox(t), 2])
  for (const d of s.draw ?? []) if (g.dbox && !isShape(d)) fixed.push([g.dbox(d), 2]) // a shape frames things: labels may sit inside it
  const labelled = (p: Part) => !isFlag(p.kind) && (!only || only.has(p.id))
  const def = (p: Part) => { const b = boxes.get(p.id)!, l = labelAt(b); return { b, n: textBox(l.n[0], l.n[1], p.name.length, l.anchor), v: textBox(l.v[0], l.v[1], shown(p), l.anchor) } }
  const O: Pt = { x: 0, y: 0 }
  // labels that stay where they are (parts outside `only`) are obstacles from the start
  const placed: Box[] = s.parts.filter((p) => !isFlag(p.kind) && !labelled(p)).flatMap((p) => { const d = def(p); return [shift(d.n, p.lo ?? O), shift(d.v, p.vo ?? O)] })
  const cost = (nb: Box, vb: Box) => {
    let k = hits(nb, vb) ? 4 : 0
    for (const box of [nb, vb]) { for (const [f, w] of fixed) if (hits(box, f)) k += w; for (const f of placed) if (hits(box, f)) k += 4 }
    return k
  }
  const NEAR = 14 // a label further than this from its part is brought back even when it sits on nothing
  const far = (l: Box, b: Box) => Math.max(l.x0 - b.x1, b.x0 - l.x1, l.y0 - b.y1, b.y0 - l.y1) > NEAR
  const next = new Map<string, Part>(), todo: Part[] = []
  // first the labels that are fine as they are: they stay, and the rest work around them
  for (const p of s.parts) {
    if (!labelled(p)) continue
    const d = def(p), nb = shift(d.n, p.lo ?? O), vb = shift(d.v, p.vo ?? O)
    if (cost(nb, vb) || far(nb, d.b) || far(vb, d.b)) todo.push(p)
    else placed.push(nb, vb)
  }
  for (const p of todo) {
    const d = def(p), B = g.body?.(p) ?? d.b, cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2, wn = d.n.x1 - d.n.x0, wv = d.v.x1 - d.v.x0, G = 2
    const tall = B.y1 - B.y0 >= B.x1 - B.x0
    // candidate spots, as top-left corners of the name and the value box: the default first, then both labels hugging
    // each side of the body (slid along it in half-grid steps), then one above and one below
    const cands: [Pt, Pt, number][] = [[O, O, 0]]
    const add = (nx: number, ny: number, vx: number, vy: number, pref: number) => cands.push([{ x: Math.round(nx - d.n.x0), y: Math.round(ny - d.n.y0) }, { x: Math.round(vx - d.v.x0), y: Math.round(vy - d.v.y0) }, pref])
    const slides = (max: number) => { const r = [0]; for (let k = 5; k <= max; k += 5) r.push(k, -k); return r }
    for (const dy of slides((B.y1 - B.y0) / 2 + H)) {
      const top = cy - H - 0.5 + dy, pen = Math.abs(dy) / 5
      add(B.x1 + G, top, B.x1 + G, top + H + 1, (tall ? 1 : 7) + pen) // right
      add(B.x0 - G - wn, top, B.x0 - G - wv, top + H + 1, (tall ? 4 : 7) + pen) // left
    }
    for (const dx of slides((B.x1 - B.x0) / 2 + Math.max(wn, wv) / 2)) {
      const nx = cx - wn / 2 + dx, vx = cx - wv / 2 + dx, pen = Math.abs(dx) / 5
      add(nx, B.y0 - G - H, vx, B.y1 + G, (tall ? 9 : 1) + pen) // name above, value below
      add(nx, B.y0 - G - 2 * H - 1, vx, B.y0 - G - H, (tall ? 7 : 4) + pen) // both above
      add(nx, B.y1 + G, vx, B.y1 + G + H + 1, (tall ? 7 : 4) + pen) // both below
    }
    let best = cands[0], bc = Infinity
    for (const c of cands) {
      const k = cost(shift(d.n, c[0]), shift(d.v, c[1])) * 100 + c[2]
      if (k < bc) (best = c), (bc = k)
    }
    placed.push(shift(d.n, best[0]), shift(d.v, best[1]))
    const eq = (q: Pt, old?: Pt) => q.x === (old?.x ?? 0) && q.y === (old?.y ?? 0)
    if (eq(best[0], p.lo) && eq(best[1], p.vo)) continue
    const { lo: _n, vo: _v, ...rest } = p
    next.set(p.id, { ...rest, ...((best[0].x || best[0].y) && { lo: best[0] }), ...((best[1].x || best[1].y) && { vo: best[1] }) })
  }
  return next.size ? { ...s, parts: s.parts.map((p) => next.get(p.id) ?? p) } : s
}

// The whole Clean up. With a selection (`only`) just those parts' labels are tidied and nothing else moves.
export function cleanUp(s: Sheet, g: Geo, only?: Set<string>): Sheet {
  if (only) return cleanLabels(s, g, only)
  let t = tidyWires(spread(s, g), g)
  if (t !== s && netSignature(t) !== netSignature(s)) t = s // never trade a tidy sheet for a changed circuit
  return cleanLabels(t, g)
}
