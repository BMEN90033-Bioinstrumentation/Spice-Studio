import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptySheet, newPart, uid, type Sheet } from '../src/renderer/src/schematic/model.ts'
import type { Kind } from '../src/renderer/src/schematic/symbols.ts'
import { annotate, rewriteRefs } from '../src/renderer/src/schematic/annotate.ts'

function sheet(parts: [Kind, number, number, string, string?][], dirs: string[] = []): Sheet {
  const s = emptySheet()
  for (const [kind, x, y, name, value] of parts) s.parts.push(newPart(s, kind, x, y, 0, false, { name, ...(value != null && { value }) }))
  for (const text of dirs) s.texts.push({ id: uid(), x: 0, y: 0, text })
  return s
}
const names = (s: Sheet) => s.parts.map((p) => p.name)

test('annotate: per prefix in reading order, references in directives and values follow (swaps included)', () => {
  const s = sheet([
    ['res', 100, 0, 'R5'], ['res', 0, 0, 'R2'], ['res', 0, 100, 'R1'], ['vsrc', -50, 50, 'V3'], ['cccs', 200, 50, 'F9', 'V3 2'],
    ['ind', 300, 0, 'L7'], ['ind', 300, 50, 'L2'], ['kcouple', 400, 0, 'K4', 'L7 L2 0.9'], ['label', 0, 200, '', 'R1'], ['res', 500, -10, 'Rload']
  ], ['.dc V3 0 5 0.1\n.save i(R5) @R1[i] v(R1) v(out,R2)\n.meas tran x find i(R2) at=1m\n* R5 is the load', 'B1 a 0 V=I(V3)*1k'])
  const { sheets: [a], renamed } = annotate([s])
  assert.deepEqual(names(a), ['R2', 'R1', 'R3', 'V1', 'F1', 'L1', 'L2', 'K1', '', 'Rload'])
  assert.equal(renamed, 7) // L2 keeps its name
  assert.equal(a.texts[0].text, '.dc V1 0 5 0.1\n.save i(R2) @R3[i] v(R1) v(out,R2)\n.meas tran x find i(R1) at=1m\n* R5 is the load') // comments untouched
  assert.equal(a.texts[1].text, 'B1 a 0 V=I(V1)*1k') // B1 is defined by the card: its number stays reserved, its reference follows
  assert.deepEqual(a.parts.map((p) => p.value).slice(4, 9), ['V1 2', '1m', '1m', 'L1 L2 0.9', 'R1']) // net label value untouched
  assert.equal(annotate([a]).renamed, 0) // idempotent
})

test('annotate: whole project numbers on from sheet to sheet; names used by directive elements are skipped', () => {
  const top = sheet([['res', 0, 0, 'R7'], ['res', 0, 50, 'R3']], ['R2 a b 1k'])
  const sub = sheet([['res', 0, 0, 'R1'], ['cap', 0, 0, 'C5']], ['.save i(R1)'])
  const { sheets: [t, u] } = annotate([top, sub])
  assert.deepEqual([names(t), names(u)], [['R1', 'R3'], ['R4', 'C1']])
  assert.equal(u.texts[0].text, '.save i(R4)')
  // one sheet alone starts again at 1
  assert.deepEqual(names(annotate([sub]).sheets[0]), ['R1', 'C1'])
})

test('rewriteRefs: only where SPICE reads an element name; transformer and X-prefixed names', () => {
  const m = new Map([['r1', 'R2'], ['x1', 'X3'], ['v1', 'V5'], ['l1', 'L4']])
  assert.equal(rewriteRefs('R1 R10 xR1 i(r1) v(r1) X1.R1 i(X1) 1R1', m), 'R1 R10 xR1 i(R2) v(r1) X1.R1 i(X3) 1R1') // an element line's nodes stay
  assert.equal(rewriteRefs('C9 R1 0 1n\n.model R1 D\n.dc V1 0 1 0.1 R1 1 2 1\n.tf v(out) V1\n.noise v(out) V1 dec 10 1 1k\nK2 L1 L9 0.5\nF2 R1 0 V1 2\n.save @r1[i] @x1.q1[ic]', m),
    'C9 R1 0 1n\n.model R1 D\n.dc V5 0 1 0.1 R2 1 2 1\n.tf v(out) V5\n.noise v(out) V5 dec 10 1 1k\nK2 L4 L9 0.5\nF2 R1 0 V5 2\n.save @R2[i] @X3.q1[ic]')
  const s = sheet([['xfmr', 0, 0, 'XF2'], ['xfmr', 0, 50, 'XF1'], ['npn', 100, 0, 'Q2']], ['.save i(LXF2_P) i(LXF1_S) i(XQ2)'])
  assert.equal(annotate([s]).sheets[0].texts[0].text, '.save i(LXF1_P) i(LXF2_S) i(XQ1)')
})

test('annotate: duplicate names each get their own number; a real XR1 is not taken for R1\'s X form; nets and models named like parts stay', () => {
  const s = sheet([['res', 0, 0, 'R1'], ['res', 0, 50, 'R1'], ['res', 0, 100, 'R1'], ['res', 0, 150, 'XR1'], ['label', 0, 200, '', 'R2']], ['C9 R2 0 1n\n.model R2 D'])
  const { sheets: [a] } = annotate([s])
  assert.deepEqual(names(a), ['R1', 'R2', 'R3', 'XR1', ''])
  assert.equal(a.texts[0].text, 'C9 R2 0 1n\n.model R2 D')
  assert.equal(a.parts[4].value, 'R2') // a net label named like a part
})
