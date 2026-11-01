import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptySheet, newPart } from '../src/renderer/src/schematic/model.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'
import type { LibEntry } from '../src/renderer/src/library/library.ts'

const model = (id: string, text: string): LibEntry =>
  ({ id, name: '2N3904', category: 'BJTs', kind: 'npn', description: '', value: '2N3904', source: 'pack', spice: { type: 'model', name: '2N3904', text } })
const a = model('std:2N3904', '.model 2N3904 NPN(bf=200)')
const b = model('pack:qucs/qucs-bjts.lib#2N3904', '.model 2N3904 NPN(bf=150)')
const sheet = (ids: string[]) => {
  const s = emptySheet()
  s.parts.push(newPart(s, 'gnd', 0, 0))
  ids.forEach((lib, i) => s.parts.push(newPart(s, 'npn', 100 * (i + 1), 0, 0, false, { lib, value: '2N3904' })))
  s.texts.push({ id: 't', x: 0, y: 100, text: '.op' })
  return s
}
const lib = (id: string) => [a, b].find((e) => e.id === id)

test('two different library parts with the same model name is an error', () => {
  const r = netlist(sheet([a.id, b.id]), 't', { lib })
  assert.ok(r.errors.some((e) => /defined by two different library parts/.test(e)), r.errors.join('\n'))
})

test('the same library part used twice is fine', () => {
  const r = netlist(sheet([a.id, a.id]), 't', { lib })
  assert.ok(!r.errors.some((e) => /two different library parts/.test(e)), r.errors.join('\n'))
})
