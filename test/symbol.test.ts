// Custom library symbols (symbol editor): pin mapping, placement fields, netlisting, validation, persistence.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptySheet, newPart, parseSheet, pins, uid, type Sheet } from '../src/renderer/src/schematic/model.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'
import { entriesFromImport, resolver, type ImportedLib } from '../src/renderer/src/library/library.ts'
import { defaultSymbol, symbolErrors, symbolFields, targets, validSymbol, type CustomSymbol } from '../src/renderer/src/library/customSymbol.ts'

const LIB = `.subckt AMP out inp inn vcc vee
E1 out 0 inp inn 1e5
.ends AMP
.model QX NPN(BF=100)`
// AMP imported as a 5-pin op-amp symbol (in+ in- V+ V- out -> subckt pins 1 2 3 4 0), QX as an NPN model
const lib = (amp?: CustomSymbol, qx?: CustomSymbol): ImportedLib => ({
  file: 'v.lib', entries: [
    { name: 'AMP', kind: 'opamp5', category: 'Op-amps', pinMap: [1, 2, 3, 4, 0], ...(amp && { symbol: amp }) },
    { name: 'QX', kind: 'npn', category: 'BJTs', pinMap: [], ...(qx && { symbol: qx }) }
  ]
})
const entries = (l: ImportedLib) => entriesFromImport(l, LIB, { source: 'user', prefix: 'user:', dir: '/x', group: 'My library' })
// a sheet with the part placed at the origin and a label on each pin
function placed(e: ReturnType<typeof entries>[number], labels: string[]): Sheet {
  const s = emptySheet()
  const p = newPart(s, e.kind, 0, 0, 1, false, { value: e.value, lib: e.id, ...symbolFields(e) })
  s.parts.push(p)
  pins(p).forEach((q, i) => s.parts.push(newPart(s, 'label', q.x, q.y, 0, false, { value: labels[i] })))
  s.parts.push(newPart(s, 'gnd', 500, 500), newPart(s, 'label', 500, 500, 0, false, { value: 'unused' }))
  s.texts.push({ id: uid(), x: 0, y: 0, text: '.op' })
  return s
}

test('defaultSymbol: a box whose pins follow the entry pin order and connect to the right subckt pins', () => {
  const [amp] = entries(lib())
  assert.deepEqual(targets(amp), ['out', 'inp', 'inn', 'vcc', 'vee'])
  const d = defaultSymbol(amp)
  assert.deepEqual(d.pins.map((p) => [p.name, p.map]), [['inp', 1], ['inn', 2], ['vcc', 3], ['vee', 4], ['out', 0]])
  assert.deepEqual(symbolErrors(d, amp), [])
  assert.ok(d.shapes.some((s) => s.t === 'rect'))
  assert.ok(validSymbol(d))
})

test('a custom subckt symbol netlists through the entry pin map, whatever order its pins were drawn in', () => {
  // drawn out of order: out first, then the supplies, then the inputs
  const sym: CustomSymbol = {
    shapes: [{ id: 'a', t: 'line', a: { x: -20, y: -30 }, b: { x: 30, y: 0 } }, { id: 'b', t: 'note', x: -10, y: -5, text: 'AMP', size: 7 }],
    pins: [{ name: 'OUT', x: 40, y: 0, map: 0 }, { name: 'V+', x: 0, y: -40, map: 3 }, { name: 'V-', x: 0, y: 40, map: 4 }, { name: '+', x: -40, y: 10, map: 1 }, { name: '-', x: -40, y: -10, map: 2 }]
  }
  const [amp] = entries(lib(sym))
  assert.deepEqual(amp.symbol, sym)
  const f = symbolFields(amp)!
  assert.deepEqual(f.pins!.map((p) => p.name), ['+', '-', 'V+', 'V-', 'OUT']) // the generic opamp5's order (pinMap order)
  const s = placed(amp, ['a', 'b', 'p', 'n', 'o']) // + - V+ V- OUT
  const r = netlist(s, 'x', { lib: resolver(entries(lib(sym))) })
  assert.deepEqual(r.errors, [])
  assert.match(r.text, /^X1 o a b p n AMP$/m) // subckt order: out inp inn vcc vee
  assert.deepEqual(parseSheet(JSON.stringify(s)), s) // a part with a custom symbol round-trips through .nsch
})

test('a custom model symbol (NPN) netlists C B E in SPICE order', () => {
  const sym: CustomSymbol = { shapes: [], pins: [{ name: 'E', x: 0, y: 30, map: 2 }, { name: 'B', x: -30, y: 0, map: 1 }, { name: 'C', x: 0, y: -30, map: 0 }] }
  const [, qx] = entries(lib(undefined, sym))
  assert.deepEqual(targets(qx), ['C', 'B', 'E'])
  const r = netlist(placed(qx, ['c', 'b', 'e']), 'x', { lib: resolver(entries(lib(undefined, sym))) })
  assert.deepEqual(r.errors, [])
  assert.match(r.text, /^Q1 c b e QX$/m)
})

test('symbolErrors and validSymbol catch what would not netlist or load', () => {
  const [amp] = entries(lib())
  const d = defaultSymbol(amp)
  const without = { ...d, pins: d.pins.slice(1) }
  assert.deepEqual(symbolErrors(without, amp), ['No pin connects to inp'])
  assert.deepEqual(symbolErrors({ ...d, pins: [...d.pins, { ...d.pins[0], y: 300 }] }, amp), ['inp is connected to 2 pins'])
  assert.deepEqual(symbolErrors({ ...d, pins: d.pins.map((p, i) => (i ? p : { ...p, map: -1 })) }, amp), ['No pin connects to inp', 'A pin is not connected to anything'])
  assert.ok(symbolErrors({ ...d, pins: d.pins.map((p, i) => (i ? p : { ...p, x: 5 })) }, amp).includes('Pins must be on the grid'))
  assert.equal(symbolFields({ ...amp, symbol: without }), undefined) // unusable: placed with the generic symbol
  for (const bad of [null, {}, { shapes: [{ t: 'line' }], pins: [] }, { shapes: [], pins: [{ name: 'a', x: 0, y: 0, map: 0.5 }] }, { shapes: [{ id: 't', t: 'title', x: 0, y: 0, title: '', author: '', date: '', rev: '' }], pins: [] }])
    assert.equal(validSymbol(bad), false, JSON.stringify(bad))
  // an invalid symbol in a library file is ignored, not loaded
  const l = lib()
  ;(l.entries[0] as any).symbol = { shapes: 'x', pins: [] }
  assert.equal(entries(l)[0].symbol, undefined)
})
