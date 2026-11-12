import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blockShape, connections, emptySheet, exampleSheet, junctions, key, newPart, nextName, onSegment, parseSheet, pins, remap, route, stretch,
  sheetPorts, unconnectedPins, xform, type Sheet
} from '../src/renderer/src/schematic/model.ts'

const at = { x: 100, y: 50 }
const q = { x: 0, y: -30 }

test('xform rotates clockwise, mirrors before rotating, never emits -0', () => {
  assert.deepEqual(xform({ ...at, rot: 0, mirror: false }, q), { x: 100, y: 20 })
  assert.deepEqual(xform({ ...at, rot: 1, mirror: false }, q), { x: 130, y: 50 })
  assert.deepEqual(xform({ ...at, rot: 2, mirror: false }, q), { x: 100, y: 80 })
  assert.deepEqual(xform({ ...at, rot: 3, mirror: false }, q), { x: 70, y: 50 })
  assert.deepEqual(xform({ ...at, rot: 4, mirror: false }, q), xform({ ...at, rot: 0, mirror: false }, q))
  assert.deepEqual(xform({ ...at, rot: 0, mirror: true }, { x: 20, y: -30 }), { x: 80, y: 20 })
  assert.deepEqual(xform({ ...at, rot: 1, mirror: true }, { x: 20, y: -30 }), { x: 130, y: 30 })
  for (let rot = 0; rot < 4; rot++) {
    const p = xform({ x: 0, y: 0, rot, mirror: rot % 2 === 1 }, { x: 0, y: 30 })
    assert.ok(!Object.is(p.x, -0) && !Object.is(p.y, -0), `-0 at rot=${rot}`)
    assert.ok(!key(p).includes('-0'), key(p))
  }
})

test('onSegment: interior only, on the line', () => {
  const w = { id: 'w', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }
  assert.equal(onSegment(w, { x: 20, y: 0 }), true)
  assert.equal(onSegment(w, { x: 0, y: 0 }), false)
  assert.equal(onSegment(w, { x: 40, y: 0 }), false)
  assert.equal(onSegment(w, { x: 20, y: 10 }), false)
  assert.equal(onSegment(w, { x: 60, y: 0 }), false)
})

test('exampleSheet: fully connected, no junction dots (gnd/label do not count)', () => {
  const s = exampleSheet()
  assert.deepEqual(junctions(s), [])
  assert.deepEqual(unconnectedPins(s), [])
  assert.deepEqual(connections(s).get('120,-60'), { all: 3, real: 2 }) // two wires + the "out" label
})

test('T-junction gives exactly one dot', () => {
  const s: Sheet = { ...emptySheet(), wires: [...route({ x: 0, y: 0 }, { x: 100, y: 0 }), ...route({ x: 50, y: 0 }, { x: 50, y: 50 })] }
  assert.deepEqual(junctions(s), [{ x: 50, y: 0 }])
})

test('part dropped on a wire interior is not connected', () => {
  const s: Sheet = { ...emptySheet(), wires: route({ x: 0, y: -100 }, { x: 0, y: 100 }) }
  s.parts.push(newPart(s, 'res', 0, 0))
  assert.deepEqual(unconnectedPins(s), [{ x: 0, y: -30 }, { x: 0, y: 30 }])
  assert.deepEqual(junctions(s), [])
})

test('moving a part off a pin-to-pin connection adds a wire back', () => {
  const s = emptySheet()
  s.parts.push(newPart(s, 'res', 0, 0), newPart(s, 'res', 0, 60)) // touch at (0,30)
  const id = s.parts[0].id, d = { x: 40, y: 20 }
  const r = remap(s, new Set([id]), (p) => ({ ...p, x: p.x + d.x, y: p.y + d.y }))
  assert.deepEqual(unconnectedPins(r), [{ x: 40, y: -10 }, { x: 0, y: 90 }])
  for (const w of r.wires) assert.ok(w.a.x === w.b.x || w.a.y === w.b.y)
  assert.equal(remap(s, new Set(s.parts.map((p) => p.id)), (p) => ({ ...p, x: p.x + 40 })).wires.length, 0) // moved together
})

test('dragging a wire off a pin adds a wire back', () => {
  const s: Sheet = { ...emptySheet(), wires: route({ x: 0, y: 30 }, { x: 0, y: 100 }) }
  s.parts.push(newPart(s, 'res', 0, 0)) // bottom pin at (0,30)
  const d = { x: 20, y: 0 }, mv = (q: { x: number; y: number }) => ({ x: q.x + d.x, y: q.y + d.y })
  const r = remap(s, new Set([s.wires[0].id]), (p) => p, mv)
  assert.deepEqual(unconnectedPins(r), [{ x: 0, y: -30 }])
  assert.equal(r.wires.length, 2)
})

test('nextName picks max + 1 per prefix, case-insensitive', () => {
  const s = emptySheet()
  assert.equal(nextName(s, 'R'), 'R1')
  s.parts.push(newPart(s, 'res', 0, 0), newPart(s, 'res', 0, 0))
  s.parts[1].name = 'r7'
  s.parts.push(newPart(s, 'cap', 0, 0))
  assert.equal(nextName(s, 'R'), 'R8')
  assert.equal(nextName(s, 'C'), 'C2')
  assert.equal(newPart(s, 'gnd', 0, 0).name, '')
})

test('route is orthogonal and drops zero-length segments', () => {
  const a = { x: 0, y: 0 }, b = { x: 30, y: 40 }
  const h = route(a, b), v = route(a, b, true)
  assert.deepEqual(h.map((w) => [w.a, w.b]), [[a, { x: 30, y: 0 }], [{ x: 30, y: 0 }, b]])
  assert.deepEqual(v.map((w) => [w.a, w.b]), [[a, { x: 0, y: 40 }], [{ x: 0, y: 40 }, b]])
  for (const w of [...h, ...v]) assert.ok(w.a.x === w.b.x || w.a.y === w.b.y)
  assert.equal(route(a, { x: 50, y: 0 }).length, 1)
  assert.equal(route(a, { x: 0, y: 50 }, true).length, 1)
  assert.equal(route(a, a).length, 0)
})

test('stretch keeps dragged wires orthogonal, fixed end keeps its direction', () => {
  const w = { id: 'w', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }
  assert.deepEqual(stretch(w, w.a, { x: 60, y: 0 }), [{ id: 'w', a: w.a, b: { x: 60, y: 0 } }])
  const r = stretch(w, w.a, { x: 50, y: 20 }) // b dragged down: leave a horizontally, then drop
  assert.deepEqual(r.map((s) => [s.a, s.b]), [[w.a, { x: 50, y: 0 }], [{ x: 50, y: 0 }, { x: 50, y: 20 }]])
  assert.equal(r[0].id, 'w')
  const l = stretch(w, { x: 10, y: 20 }, w.b) // a dragged: leave b horizontally
  assert.deepEqual(l.map((s) => [s.a, s.b]), [[w.b, { x: 10, y: 0 }], [{ x: 10, y: 0 }, { x: 10, y: 20 }]])
  const v = { id: 'v', a: { x: 0, y: 0 }, b: { x: 0, y: 50 } }
  assert.deepEqual(stretch(v, v.a, { x: 20, y: 50 }).map((s) => s.b), [{ x: 0, y: 50 }, { x: 20, y: 50 }])
})

test('parseSheet round-trips and rejects garbage', () => {
  const s = exampleSheet()
  assert.deepEqual(parseSheet(JSON.stringify(s, null, 1)), s)
  assert.throws(() => parseSheet('not json'))
  assert.throws(() => parseSheet('null'), /\.nsch/)
  assert.throws(() => parseSheet('{"version":2,"parts":[],"wires":[]}'), /\.nsch/)
  assert.throws(() => parseSheet('{"version":1,"parts":{},"wires":[]}'), /\.nsch/)
  assert.throws(() => parseSheet('{"version":1,"parts":[{"kind":"flux"}],"wires":[]}'), /Unknown part kind/)
})

test('blockShape: first half left, rest right, all on grid, size multiples of 20', () => {
  assert.deepEqual(blockShape(['in', 'out']), { pins: [{ name: 'in', x: -60, y: 0 }, { name: 'out', x: 60, y: 0 }], size: { w: 80, h: 40 } })
  const b = blockShape(['a', 'b', 'c', 'd', 'a_very_long_name'])
  assert.deepEqual(b.pins.map((q) => [q.name, Math.sign(q.x)]), [['a', -1], ['b', -1], ['c', -1], ['d', 1], ['a_very_long_name', 1]])
  assert.ok(b.size.w > 80 && b.size.w % 20 === 0 && b.size.h % 20 === 0, JSON.stringify(b.size))
  for (const q of b.pins) assert.ok(q.x % 10 === 0 && q.y % 10 === 0 && Math.abs(q.y) < b.size.h / 2, JSON.stringify(q))
  assert.deepEqual(blockShape([]), { pins: [], size: { w: 80, h: 40 } })
})

test('sheetPorts: left-to-right then top-to-bottom, duplicates once', () => {
  const s = emptySheet()
  for (const [x, y, v] of [[100, 0, 'out'], [0, 50, 'b'], [0, -50, 'a'], [100, 50, 'OUT']] as const) s.parts.push(newPart(s, 'port', x, y, 0, false, { value: v }))
  s.parts.push(newPart(s, 'label', -100, 0))
  assert.deepEqual(sheetPorts(s), ['a', 'b', 'out'])
})

test('newPart extra fields; ports get unique default names; per-instance pins override the symbol', () => {
  const s = emptySheet()
  s.parts.push(newPart(s, 'port', 0, 0))
  s.parts.push(newPart(s, 'port', 0, 0))
  assert.deepEqual(s.parts.map((p) => [p.name, p.value]), [['', 'p1'], ['', 'p2']])
  const b = newPart(s, 'block', 100, 0, 1, false, { sheet: 'f.nsch', value: 'f', ...blockShape(['in', 'out']) })
  assert.deepEqual([b.name, b.sheet, b.value, b.kind], ['X1', 'f.nsch', 'f', 'block'])
  assert.deepEqual(pins(b), [{ x: 100, y: -60 }, { x: 100, y: 60 }])
  const q = newPart(s, 'npn', 0, 0, 0, false, { lib: 'std:2N3904', value: '2N3904' })
  assert.deepEqual([q.name, q.value, q.lib, pins(q).length], ['Q1', '2N3904', 'std:2N3904', 3])
})

test('parseSheet keeps and validates block/library fields', () => {
  const s = emptySheet()
  s.parts.push(newPart(s, 'block', 0, 0, 0, false, { sheet: 'f.nsch', ...blockShape(['in']) }), newPart(s, 'npn', 0, 0, 0, false, { lib: 'std:2N3904' }))
  assert.deepEqual(parseSheet(JSON.stringify(s)), s)
  const bad = (f: object) => JSON.stringify({ ...s, parts: [{ ...s.parts[0], ...f }] })
  assert.throws(() => parseSheet(bad({ pins: [{ x: 0, y: 0 }] })), /Malformed pins/)
  assert.throws(() => parseSheet(bad({ pins: 'in' })), /Malformed pins/)
  assert.throws(() => parseSheet(bad({ size: { w: 'big', h: 1 } })), /Malformed size/)
  assert.throws(() => parseSheet(bad({ sheet: 3 })), /Malformed sheet/)
  assert.throws(() => parseSheet(bad({ lib: null })), /Malformed lib/)
})

test('annotations: drawings round-trip through parseSheet, old files load without them, netlist ignores them', async () => {
  const { netlist } = await import('../src/renderer/src/schematic/netlist.ts')
  const s = exampleSheet()
  const before = netlist(s).text
  s.draw = [
    { id: 'n', t: 'note', x: 0, y: 200, text: '.tran 1 2\nR9 a b 1k', size: 14 },
    { id: 'l', t: 'line', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } },
    { id: 'a', t: 'arrow', a: { x: 0, y: 0 }, b: { x: 50, y: 20 } },
    { id: 'r', t: 'rect', a: { x: -40, y: -80 }, b: { x: 160, y: 60 } },
    { id: 'e', t: 'ellipse', a: { x: 0, y: 0 }, b: { x: 20, y: 20 } },
    { id: 't', t: 'title', x: 0, y: 300, title: 'RC', author: 'me', date: '2026-01-01', rev: 'B' }
  ]
  assert.deepEqual(parseSheet(JSON.stringify(s)), s)
  assert.equal(netlist(s).text, before) // a note that looks like SPICE is still only a note
  const old = parseSheet(JSON.stringify({ version: 1, parts: [], wires: [] }))
  assert.deepEqual([old.texts, old.draw, old.buses], [[], undefined, undefined])
  const bad = (d: object) => JSON.stringify({ ...s, draw: [d] })
  assert.throws(() => parseSheet(bad({ id: 'x', t: 'note', x: 0, y: 0 })), /Malformed drawing/)
  assert.throws(() => parseSheet(bad({ id: 'x', t: 'blob', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } })), /Malformed drawing/)
  assert.throws(() => parseSheet(bad({ id: 'x', t: 'title', x: 0, y: 0, title: 'a' })), /Malformed drawing/)
  assert.throws(() => parseSheet(JSON.stringify({ ...s, buses: [{ id: 'b', a: { x: 0 } }] })), /Malformed buses/)
})
