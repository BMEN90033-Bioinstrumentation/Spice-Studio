import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { erc } from '../src/renderer/src/sim/erc.ts'

// common-emitter amp: coupling caps, divider bias, emitter bypass. Must pass clean.
const CE = `* CE amplifier
VCC vcc 0 DC 12
VIN sig 0 DC 0 AC 1 SIN(0 10m 1k)
RS sig a 600
C1 a base 10u
R1 vcc base 47k
R2 base 0 10k
RC vcc col 4.7k
RE emit 0 1k
CE emit 0 100u
C2 col out 10u
RL out 0 10k
Q1 col base emit QN
.model QN NPN(BF=200)
.tran 10u 5m
.end
`

const ngspiceOk = (deck: string) => {
  const d = mkdtempSync(join(tmpdir(), 'erc-')), f = join(d, 'c.cir')
  writeFileSync(f, deck)
  const p = spawnSync('ngspice', ['-b', '-n', '-r', join(d, 'o.raw'), f], { encoding: 'utf8' })
  return p.error ? null : { ok: p.status === 0 && !/singular matrix|shorted/i.test(p.stdout + p.stderr), log: p.stdout + p.stderr }
}

test('erc: cap-coupled amplifier with bias resistors is clean (and runs)', () => {
  assert.deepEqual(erc(CE), { errors: [], warnings: [] })
  const r = ngspiceOk(CE)
  if (r) assert.ok(r.ok, r.log)
})

test('erc: node reached only through series caps warns, names the island and its parts', () => {
  const deck = `* series caps
V1 in 0 AC 1
C1 in mid 1u
C2 mid out 1u
R1 out 0 1k
.ac dec 10 1 1k
.end
`
  const { errors, warnings } = erc(deck)
  assert.deepEqual(errors, [])
  assert.equal(warnings.length, 1)
  assert.deepEqual(warnings[0].nets, ['mid'])
  assert.deepEqual(warnings[0].refs, ['C1', 'C2'])
  assert.match(warnings[0].message, /No DC path to ground from net mid/)
})

test('erc: V1 parallel V2 is a loop error; inductor across a V source too; both fail in ngspice', () => {
  const vv = '* vv\nV1 a 0 1\nV2 a 0 2\nR1 a 0 1k\n.op\n.end\n'
  const e = erc(vv).errors
  assert.equal(e.length, 1)
  assert.deepEqual(e[0].refs, ['V1', 'V2'])
  assert.deepEqual(e[0].nets.sort(), ['0', 'a'])
  const lv = '* lv\nV1 a 0 1\nL1 a 0 1m\nR1 a 0 1k\n.op\n.end\n'
  assert.deepEqual(erc(lv).errors.map((x) => x.refs), [['V1', 'L1']])
  for (const d of [vv, lv]) {
    const r = ngspiceOk(d)
    if (r) assert.ok(!r.ok, 'ngspice should fail too:\n' + d)
  }
})

test('erc: longer loops list every branch; shorted source; E/H outputs count, G/F/C/I do not', () => {
  const loop = erc('* t\nV1 a 0 1\nL1 a b 1m\nE1 b c x 0 2\nH1 c 0 V1 10\nRx x 0 1\n.end\n').errors
  assert.deepEqual(loop.map((x) => x.refs), [['V1', 'L1', 'E1', 'H1']])
  assert.match(erc('* t\nV1 a a 1\nR1 a 0 1\n.end\n').errors[0].message, /V1 is shorted/)
  assert.deepEqual(erc('* t\nV1 a 0 1\nG1 a 0 a 0 1m\nF1 a 0 V1 2\nC1 a 0 1u\nI1 a 0 1m\n.end\n').errors, [])
  // E control pins are high impedance: a net only on them floats
  assert.deepEqual(erc('* t\nE1 o 0 ctl 0 10\nR1 o 0 1k\nC1 ctl 0 1n\n.end\n').warnings.map((w) => w.nets), [['ctl']])
  // K has no nodes, current sources into caps float
  assert.deepEqual(erc('* t\nI1 0 n 1m\nC1 n 0 1n\nL1 a 0 1m\nL2 b 0 1m\nK1 L1 L2 0.9\nR1 a 0 1\nR2 b 0 1\n.end\n').warnings.map((w) => w.nets), [['n']])
})

test('erc: comments, continuations, gnd, .control and .subckt scopes', () => {
  const deck = `title line, not an element: V9 x x 1
* V8 y y 1
V1 in 0 ; inline comment
+ DC 1
R1 in GND 1k $ another
.control
V7 z z 1
.endc
X1 in out amp
.subckt amp i o params: g=2
E1 o 0 i 0 {g}
Rload o 0 1k
Cfloat i n 1n
.ends amp
RL out 0 1k
.end
V6 w w 1
`
  const r = erc(deck)
  assert.deepEqual(r.errors, [])
  // subckt ports count as ground inside the scope: only the internal net n floats
  assert.deepEqual(r.warnings.map((w) => [w.nets, w.refs]), [[['n'], ['Cfloat']]])
  // X pins all join: a part hanging only off a subckt instance is fine
  assert.deepEqual(erc('* t\nX1 a b sub\nC1 b c 1n\nR1 c 0 1\nR2 a 0 1\n.end\n').warnings, [])
  // a loop inside a subckt is still a loop
  assert.equal(erc('* t\n.subckt s p q\nV1 p q 1\nV2 p q 2\n.ends\n.end\n').errors.length, 1)
})

test('erc: transistors, switches and XSPICE stay quiet when biased', () => {
  const deck = `* t
V1 vdd 0 5
M1 d g 0 0 nm
R1 vdd d 1k
R2 vdd g 10k
J1 vdd g2 s jm
R3 s 0 1k
R4 g2 0 1meg
S1 vdd sw c 0 swm
R5 sw 0 1k
V2 c 0 1
A1 [d] [dig] adc
.end
`
  assert.deepEqual(erc(deck), { errors: [], warnings: [] })
  // S control pins conduct nothing
  assert.deepEqual(erc('* t\nV1 a 0 1\nS1 a 0 c 0 sw\nC1 c 0 1n\n.end\n').warnings.map((w) => w.nets), [['c']])
})
