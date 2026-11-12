import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanLabels, cleanUp, clusters, labelAt, netSignature, spread, tidyWires, type Box } from '../src/renderer/src/schematic/cleanup.ts'
import type { Part, Sheet } from '../src/renderer/src/schematic/model.ts'

const part = (id: string, x: number, y: number, name = id, value = '1k'): Part => ({ id, kind: 'res', x, y, rot: 0, mirror: false, name, value })
const pbox = (p: Part): Box => ({ x0: p.x - 10, y0: p.y - 30, x1: p.x + 10, y1: p.y + 30 }) // a tall 20x60 body
const G = { pbox }
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
// the label boxes as cleanup estimates them, at their final (offset) position
const labels = (p: Part) => {
  const l = labelAt(pbox(p)), box = (x: number, y: number, n: number, o = { x: 0, y: 0 }): Box => ({ x0: x + o.x, y0: y - 8 + o.y, x1: x + n * 5.5 + o.x, y1: y + 2 + o.y })
  return [box(l.n[0], l.n[1], p.name.length, p.lo), box(l.v[0], l.v[1], p.value.length, p.vo)]
}
const sheet = (parts: Part[], wires: Sheet['wires'] = []): Sheet => ({ version: 1, parts, wires, texts: [] })

test('cleanLabels: labels already clear of everything are left alone', () => {
  const s = sheet([part('R1', 0, 0), part('R2', 200, 0)])
  assert.deepEqual(cleanLabels(s, G), s)
})

test('cleanLabels: a label on a neighbouring part moves off it, parts and wires stay put', () => {
  // R2 sits right where R1 draws its labels (to the right of a tall part)
  const s = sheet([part('R1', 0, 0), part('R2', 25, 0)], [{ id: 'w', a: { x: 0, y: 30 }, b: { x: 25, y: 30 } }])
  assert.ok(labels(s.parts[0]).some((l) => hits(l, pbox(s.parts[1]))), 'the fixture starts with an overlap')
  const r = cleanLabels(s, G)
  assert.deepEqual(r.parts.map((p) => [p.x, p.y]), s.parts.map((p) => [p.x, p.y]))
  assert.deepEqual(r.wires, s.wires)
  const all = r.parts.flatMap((p) => labels(p).map((l) => ({ p, l })))
  for (const { p, l } of all) for (const q of r.parts) assert.ok(!hits(l, pbox(q)), `${p.name} label on ${q.name}`)
  for (const a of all) for (const b of all) if (a !== b) assert.ok(!hits(a.l, b.l), 'two labels overlap')
})

test('cleanLabels: only the selected parts are touched, and their labels avoid the others', () => {
  const s = sheet([part('R1', 0, 0), part('R2', 25, 0)])
  const r = cleanLabels(s, G, new Set(['R2']))
  assert.equal(r.parts[0], s.parts[0])
  assert.ok(!labels(r.parts[1]).some((l) => labels(r.parts[0]).some((m) => hits(l, m))))
})

test('cleanLabels: flags have no movable label; a label that was dragged onto a part is put back', () => {
  const gnd: Part = { ...part('G', 100, 0, '', '0'), kind: 'gnd' }
  const r = cleanLabels(sheet([gnd, { ...part('R1', 0, 0), lo: { x: -10, y: 0 } }]), G)
  assert.equal(r.parts[0], gnd)
  assert.equal(r.parts[1].lo, undefined)
})

// ---- spread ----
const wire = (id: string, ax: number, ay: number, bx: number, by: number) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } })
const ink = (p: Part): Box => { const b = pbox(p); return { x0: b.x0 + 3, y0: b.y0 + 3, x1: b.x1 - 3, y1: b.y1 - 3 } }
const straight = (s: Sheet) => s.wires.every((w) => w.a.x === w.b.x || w.a.y === w.b.y)

test('spread: two parts dropped on each other are pushed apart on the grid; wires stretch, nets and bends stay', () => {
  // R1 and R2 overlap; each has a wire off its top pin to a shared rail, and R3 sits to the right of R2 in its way
  const s = sheet([part('R1', 0, 0), part('R2', 10, 0), part('R3', 40, 0)],
    [wire('a', 0, -30, 0, -60), wire('b', 10, -30, 10, -60), wire('c', 0, -60, 10, -60), wire('d', 10, -60, 40, -60), wire('e', 40, -60, 40, -30)])
  const r = spread(s, G)
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!hits(ink(r.parts[i]), ink(r.parts[j])), `${r.parts[i].name} on ${r.parts[j].name}`)
  assert.ok(r.parts.every((p) => p.x % 10 === 0 && p.y % 10 === 0), 'off grid')
  assert.ok(r.parts[0].x < r.parts[1].x && r.parts[1].x < r.parts[2].x, 'left-to-right order kept')
  assert.ok(straight(r), 'a wire went diagonal')
  assert.equal(r.wires.length, s.wires.length)
  assert.equal(netSignature(r), netSignature(s))
})

test('spread: a sheet with nothing overlapping is returned as it is', () => {
  const s = sheet([part('R1', 0, 0), part('R2', 40, 0)], [wire('a', 0, -30, 40, -30)])
  assert.equal(spread(s, G), s)
})

test('spread: a wire through a part moves off it, a wire ending on its pin does not', () => {
  const s = sheet([part('R1', 0, 0)], [wire('thru', -40, 10, 40, 10), wire('pin', 0, 30, 60, 30)])
  const r = spread(s, G), [thru, pin] = r.wires, b = ink(r.parts[0])
  assert.ok(thru.a.y === thru.b.y && (thru.a.y <= b.y0 || thru.a.y >= b.y1), 'still through the part')
  assert.deepEqual([pin.a, pin.b], [{ x: r.parts[0].x, y: r.parts[0].y + 30 }, { x: r.parts[0].x + 60, y: r.parts[0].y + 30 }])
})

// ---- wires ----
test('tidyWires: collinear pieces merge, but stay split at a pin and at a T-junction', () => {
  // row y=-30: three pieces 0..20..40..80, R1's top pin at x=40 (wire end on a pin), a branch down from x=20
  const s = sheet([part('R1', 40, 0)], [wire('a', 0, -30, 20, -30), wire('b', 20, -30, 40, -30), wire('c', 40, -30, 80, -30), wire('t', 20, -30, 20, -80), wire('dup', 0, -30, 20, -30), wire('z', 5, 5, 5, 5)])
  const r = tidyWires(s, G), row = r.wires.filter((w) => w.a.y === -30 && w.b.y === -30).map((w) => [Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)]).sort((p, q) => p[0] - q[0])
  assert.deepEqual(row, [[0, 20], [20, 40], [40, 80]])
  assert.equal(r.wires.length, 4)
  assert.equal(netSignature(r), netSignature(s))
  const plain = sheet([], [wire('a', 0, 0, 20, 0), wire('b', 20, 0, 50, 0)])
  assert.deepEqual(tidyWires(plain, G).wires.map((w) => [w.a.x, w.b.x]), [[0, 50]])
})

test('tidyWires: a wandering wire becomes one corner, a plain two-corner step is left alone', () => {
  // staircase from R1's top pin (0,-30) up and over to R2's top pin (100,-10): six corners
  const stairs = [wire('a', 0, -30, 0, -50), wire('b', 0, -50, 30, -50), wire('c', 30, -50, 30, -70), wire('d', 30, -70, 60, -70), wire('e', 60, -70, 60, -90), wire('f', 60, -90, 100, -90), wire('g', 100, -90, 100, -10)]
  const s = sheet([part('R1', 0, 0), part('R2', 100, 20)], stairs), r = tidyWires(s, G)
  assert.equal(r.wires.length, 2)
  assert.ok(straight(r))
  assert.equal(netSignature(r), netSignature(s))
  const step = sheet([part('R1', 0, 0), part('R2', 100, 100)], [wire('a', 0, -30, 0, -50), wire('b', 0, -50, 100, -50), wire('c', 100, -50, 100, 70)])
  assert.equal(tidyWires(step, G), step)
})

test('tidyWires: a detour is not straightened through a part or onto another net', () => {
  // R1 top pin to R3 top pin, routed up and over R2 which stands between them on the direct line
  const over = [wire('a', 0, -30, 0, -80), wire('b', 0, -80, 80, -80), wire('c', 80, -80, 80, -30)]
  const blocked = sheet([part('R1', 0, 0), { ...part('R2', 40, -30), rot: 1 }, part('R3', 80, 0)], over)
  const wide = (p: Part): Box => (p.rot ? { x0: p.x - 33, y0: p.y - 13, x1: p.x + 33, y1: p.y + 13 } : pbox(p))
  assert.equal(tidyWires(blocked, { pbox: wide }), blocked)
  // the same detour with another net's wire end on the direct line
  const other = sheet([part('R1', 0, 0), part('R3', 80, 0)], [...over, wire('x', 40, -30, 40, -60)])
  assert.equal(netSignature(tidyWires(other, G)), netSignature(other))
  assert.equal(tidyWires(other, G).wires.length, 4)
  // and with nothing in the way it is straightened
  assert.equal(tidyWires(sheet([part('R1', 0, 0), part('R3', 80, 0)], over), G).wires.length, 1)
})

// ---- the whole thing ----
test('cleanUp: overlapping parts end up apart with clear labels and the same circuit; a selection only moves labels', () => {
  const s = sheet([part('R1', 0, 0), part('R2', 10, 0), { ...part('L', 0, -60, '', 'out'), kind: 'label' }], [wire('a', 0, -30, 0, -60), wire('b', 10, -30, 10, -60), wire('c', 0, -60, 10, -60)])
  const r = cleanUp(s, G)
  assert.ok(!hits(ink(r.parts[0]), ink(r.parts[1])))
  assert.equal(netSignature(r), netSignature(s))
  const all = r.parts.slice(0, 2).flatMap((p) => labels(p))
  for (const l of all) for (const q of r.parts.slice(0, 2)) assert.ok(!hits(l, ink(q)), 'label on a part')
  for (const a of all) for (const b of all) if (a !== b) assert.ok(!hits(a, b), 'two labels overlap')
  const sel = cleanUp(s, G, new Set(['R1']))
  assert.deepEqual(sel.parts.map((p) => [p.x, p.y]), s.parts.map((p) => [p.x, p.y]))
  assert.equal(sel.wires, s.wires)
})

test('clusters: boxes within the gap chain into one group, the rest stay apart', () => {
  const b = (id: string, x0: number, x1: number) => ({ id, b: { x0, y0: 0, x1, y1: 10 } })
  const g = clusters([b('a', 0, 10), b('far', 100, 110), b('c', 40, 50), b('b', 20, 30)], 10) // b joins a and c
  assert.deepEqual(g.map((c) => c.map((i) => i.id).sort()), [['far'], ['a', 'b', 'c']])
  assert.equal(clusters([b('a', 0, 10), b('b', 20, 30)]).length, 2) // no gap allowed: apart
})
