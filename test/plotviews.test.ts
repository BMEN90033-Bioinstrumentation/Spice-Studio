import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stats } from '../src/renderer/src/plot/stats.ts'
import { fold, gamma, smithGrid, ticks, unwrap } from '../src/renderer/src/plot/views.ts'
import { knobs, range, steppedNames, toPos, toValue, tunedNote, withKnobs } from '../src/renderer/src/sim/tune.ts'
import { expandSweep, isWorstCase } from '../src/renderer/src/sim/sweep.ts'

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`)

test('stats: mean, sample σ, min/max runs, yield with failed runs, bins', () => {
  const s = stats([1, 2, null, 3, 4], 1.5, 3.5)
  assert.equal(s.n, 4), assert.equal(s.failed, 1)
  near(s.mean!, 2.5), near(s.sd!, Math.sqrt(5 / 3))
  assert.deepEqual([s.min, s.max, s.imin, s.imax], [1, 4, 0, 4])
  near(s.yield!, 2 / 5) // 2 and 3 pass; the run without a value is out of spec
  assert.equal(s.bins.length, 5)
  assert.equal(s.bins.reduce((a, b) => a + b.count, 0), 4)
  assert.equal(s.bins.at(-1)!.x1, 4)
  assert.equal(stats([1, 2]).yield, null) // no limits
  assert.equal(stats([2, 2, 2]).bins.length, 1)
  assert.deepEqual(stats([null]).bins, [])
  assert.equal(stats(Array.from({ length: 2000 }, (_, i) => i)).bins.length, 30)
})

test('unwrap: wraps removed, gaps kept', () => {
  assert.deepEqual(unwrap([170, -170, -10, 160, null, -170]), [170, 190, 350, 520, null, 550])
  assert.deepEqual(unwrap([0, -90, -180, 90]), [0, -90, -180, -270])
  assert.deepEqual(unwrap([0, 180, 0, -180, 0]), [0, 180, 0, -180, 0]) // exact ±180° steps: no drift
})

test('gamma, ticks, Smith grid', () => {
  assert.deepEqual(gamma(50, 0, 50), [0, 0])
  const [r, i] = gamma(25, -25, 50) // (−25 − 25j)/(75 − 25j) = −0.2 − 0.4j
  near(r, -0.2), near(i, -0.4)
  assert.deepEqual(ticks(0, 1, 5), [0, 0.2, 0.4, 0.6000000000000001, 0.8, 1])
  assert.deepEqual(ticks(-0.43, 0.02, 4), [-0.4, -0.2, 0])
  // every grid point lies on or inside the unit circle; the r = 1 circle passes through the centre
  for (const g of smithGrid()) for (const [a, b] of g.pts) assert.ok(Math.hypot(a, b) <= 1 + 1e-9)
  assert.ok(smithGrid().find((g) => g.kind === 'r' && g.v === 1)!.pts.some(([a, b]) => Math.hypot(a, b) < 0.02))
})

test('fold: whole periods from the offset, resampled; empty for a bad period', () => {
  const x = Float64Array.from({ length: 101 }, (_, k) => k / 100), y = x.map((t) => t) // y = t on [0, 1]
  const { t, segs, total } = fold(x, y, 0.25, 0.1, 6)
  assert.equal(total, 3)
  ;[0, 0.05, 0.1, 0.15, 0.2, 0.25].forEach((v, i) => near(t[i], v, 1e-15))
  assert.equal(segs.length, 3) // [0.1, 0.35], [0.35, 0.6], [0.6, 0.85]; [0.85, 1.1] runs past the data
  segs.forEach((s, k) => s.forEach((v, i) => near(v, 0.1 + k * 0.25 + t[i], 1e-12)))
  assert.equal(fold(x, y, 0.25, -0.2, 6).segs.length, 3) // offset before the data: periods start at 0.05, 0.3, 0.55 (0.8 runs past)
  assert.equal(fold(x, y, 0, 0).segs.length, 0)
  const capped = fold(x, y, 0.01, 0, 4, 10)
  assert.deepEqual([capped.segs.length, capped.total], [10, 100]) // capped: the first 10 of 100
})

const DECK = `* tune
.param R=1k C = {10n}, G=2*R
V1 in 0 AC 1
R1 in out {R}
C1 out 0 1u
L1 out x 1m
R2 x 0 4.7k
.subckt amp a b
R5 a b 1k
.ends
.ac dec 10 1 1meg
.end
`
test('knobs: numeric .params and top-level R/C/L values; withKnobs applies them', () => {
  assert.deepEqual(knobs(DECK).map((k) => `${k.kind}:${k.name}=${k.value}`), ['param:R=1000', 'param:C=1e-8', 'part:C1=0.000001', 'part:L1=0.001', 'part:R2=4700'])
  const out = withKnobs(DECK, [{ kind: 'param', name: 'r', value: 2200 }, { kind: 'part', name: 'c1', value: 4.7e-7 }, { kind: 'part', name: 'R5', value: 1 }])
  assert.match(out, /^\.param R=2200 C = \{10n\}, G=2\*R$/m)
  assert.match(out, /^C1 out 0 4\.7e-7$/m)
  assert.match(out, /^R5 a b 1k$/m) // inside a subckt: untouched
  assert.equal(withKnobs(DECK, []), DECK)
  assert.equal(tunedNote([{ kind: 'param', name: 'R', value: 2200 }, { kind: 'part', name: 'C1', value: 1e-8 }]), 'Tuned: R=2.2k, C1=10n')
})

test('slider mapping: log and linear round trips, clamped, default ranges', () => {
  near(toValue(0.5, 100, 10000, true), 1000)
  near(toPos(1000, 100, 10000, true), 0.5)
  near(toValue(0.25, -1, 1, false), -0.5)
  assert.equal(toPos(5, 0, 1, false), 1)
  assert.equal(toPos(-5, 0, 1, false), 0)
  assert.deepEqual(range(1000), { min: 100, max: 10000, log: true })
  assert.deepEqual(range(-2), { min: -4, max: 4, log: false })
  assert.deepEqual(range(0), { min: -1, max: 1, log: false })
})

test('a tuned deck runs in ngspice with the new value (skipped if ngspice missing)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tunetest-'))
  const deck = withKnobs('* t\n.param R=1k\nV1 1 0 1\nR1 1 2 {R}\nR2 2 0 1k\n.op\n.end\n', [{ kind: 'param', name: 'R', value: 3000 }, { kind: 'part', name: 'R2', value: 1000 }])
  writeFileSync(join(dir, 'c.cir'), deck)
  const p = spawnSync('ngspice', ['-b', '-n', join(dir, 'c.cir')], { encoding: 'utf8' })
  if (p.error) return t.skip('ngspice not on PATH')
  near(-Number(/v1#branch\s+(\S+)/.exec(p.stdout)![1]), 1 / 4000, 1e-9)
})

test('steppedNames: the .step params of a sweep, from its run labels; isWorstCase', () => {
  const labels = expandSweep('* s\n.param R=1k\n.step param R list 1k 2k\n.step temp list 0 50\nV1 1 0 1\nR1 1 0 {R}\n.op\n.end\n').runs.map((r) => r.label)
  assert.deepEqual(steppedNames(labels), ['r', 't'])
  assert.deepEqual(steppedNames(['run 1', 'run 2', 'nominal', 'R1+ C1−', 'max t50: R1+']), [])
  assert.equal(isWorstCase(['nominal', 'R+']), true)
  assert.equal(isWorstCase(['run 1', 'run 2']), false)
  assert.equal(isWorstCase(['nominal, V2=1', 'nominal, V2=2']), true) // nested .dc splits each run
})

test('logic view: digital nets and thresholds from the netlist, buses', async () => {
  const { logicNets, threshold, bits, busOf, busValues, busText, stepAt } = await import('../src/renderer/src/plot/logic.ts')
  const nets = logicNets(`* t
V1 clk 0 PULSE(0 5 0 2n 2n 0.5u 1u)
XU1 q0n clk Q0 q0n DFF params: vdd=3.3 tpd=10n
XU3 q0 q1 x XOR2
XU4 a b other vdd=9
XU5 p y INV params: vdd={vcc}
R1 q1 avg 1k
.subckt DFF d clk q qn params: vdd=5 tpd=10n
XU9 inner y2 BUF
.ends DFF
.end`)
  assert.deepEqual(Object.keys(nets).sort(), ['v(clk)', 'v(p)', 'v(q0)', 'v(q0n)', 'v(q1)', 'v(x)', 'v(y)'])
  assert.equal(nets['v(q0n)'], 1.65), assert.equal(nets['v(x)'], 2.5), assert.ok(Number.isNaN(nets['v(y)']))
  assert.equal(threshold([0, 3, 1], NaN), 1.5), assert.equal(threshold([0, 3], 2.5), 2.5)
  assert.deepEqual([...bits([0, 2.6, 5, 2.5], 2.5)], [0, 1, 1, 0])
  assert.deepEqual(busOf('=bus(Q1, v(q0) clk)'), ['v(q1)', 'v(q0)', 'v(clk)'])
  assert.equal(busOf('=v(a)-v(b)'), null)
  assert.deepEqual([...busValues([[0, 1, 1], [1, 0, 1]])], [1, 2, 3])
  assert.deepEqual([busText(10, 5, 'hex'), busText(10, 5, 'dec'), busText(3, 2, 'hex')], ['0A', '10', '3'])
  assert.deepEqual([stepAt([0, 1, 2], [5, 6, 7], 1.9), stepAt([0, 1, 2], [5, 6, 7], 2), stepAt([0, 1], [5, 6], 3)], [6, 7, null])
})
