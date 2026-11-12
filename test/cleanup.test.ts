import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanLabels, labelAt, type Box } from '../src/renderer/src/schematic/cleanup.ts'
import type { Part, Sheet } from '../src/renderer/src/schematic/model.ts'

const part = (id: string, x: number, y: number, name = id, value = '1k'): Part => ({ id, kind: 'res', x, y, rot: 0, mirror: false, name, value })
const pbox = (p: Part): Box => ({ x0: p.x - 10, y0: p.y - 30, x1: p.x + 10, y1: p.y + 30 }) // a tall 20x60 body
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
// the label boxes as cleanup estimates them, at their final (offset) position
const labels = (p: Part) => {
  const l = labelAt(pbox(p)), box = (x: number, y: number, n: number, o = { x: 0, y: 0 }): Box => ({ x0: x + o.x, y0: y - 8 + o.y, x1: x + n * 5.5 + o.x, y1: y + 2 + o.y })
  return [box(l.n[0], l.n[1], p.name.length, p.lo), box(l.v[0], l.v[1], p.value.length, p.vo)]
}
const sheet = (parts: Part[], wires: Sheet['wires'] = []): Sheet => ({ version: 1, parts, wires, texts: [] })

test('cleanLabels: labels already clear of everything are left alone', () => {
  const s = sheet([part('R1', 0, 0), part('R2', 200, 0)])
  assert.deepEqual(cleanLabels(s, pbox), s)
})

test('cleanLabels: a label on a neighbouring part moves off it, parts and wires stay put', () => {
  // R2 sits right where R1 draws its labels (to the right of a tall part)
  const s = sheet([part('R1', 0, 0), part('R2', 25, 0)], [{ id: 'w', a: { x: 0, y: 30 }, b: { x: 25, y: 30 } }])
  assert.ok(labels(s.parts[0]).some((l) => hits(l, pbox(s.parts[1]))), 'the fixture starts with an overlap')
  const r = cleanLabels(s, pbox)
  assert.deepEqual(r.parts.map((p) => [p.x, p.y]), s.parts.map((p) => [p.x, p.y]))
  assert.deepEqual(r.wires, s.wires)
  const all = r.parts.flatMap((p) => labels(p).map((l) => ({ p, l })))
  for (const { p, l } of all) for (const q of r.parts) assert.ok(!hits(l, pbox(q)), `${p.name} label on ${q.name}`)
  for (const a of all) for (const b of all) if (a !== b) assert.ok(!hits(a.l, b.l), 'two labels overlap')
})

test('cleanLabels: only the selected parts are touched, and their labels avoid the others', () => {
  const s = sheet([part('R1', 0, 0), part('R2', 25, 0)])
  const r = cleanLabels(s, pbox, new Set(['R2']))
  assert.equal(r.parts[0], s.parts[0])
  assert.ok(!labels(r.parts[1]).some((l) => labels(r.parts[0]).some((m) => hits(l, m))))
})

test('cleanLabels: flags have no movable label; a label that was dragged onto a part is put back', () => {
  const gnd: Part = { ...part('G', 100, 0, '', '0'), kind: 'gnd' }
  const r = cleanLabels(sheet([gnd, { ...part('R1', 0, 0), lo: { x: -10, y: 0 } }]), pbox)
  assert.equal(r.parts[0], gnd)
  assert.equal(r.parts[1].lo, undefined)
})
