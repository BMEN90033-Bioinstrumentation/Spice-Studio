import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stats } from '../src/renderer/src/plot/stats.ts'
import { fold, gamma, smithGrid, ticks, unwrap } from '../src/renderer/src/plot/views.ts'
import { knobs, range, toPos, toValue, tunedNote, withKnobs } from '../src/renderer/src/sim/tune.ts'

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
  const { t, segs } = fold(x, y, 0.25, 0.1, 6)
  ;[0, 0.05, 0.1, 0.15, 0.2, 0.25].forEach((v, i) => near(t[i], v, 1e-15))
  assert.equal(segs.length, 3) // [0.1, 0.35], [0.35, 0.6], [0.6, 0.85]; [0.85, 1.1] runs past the data
  segs.forEach((s, k) => s.forEach((v, i) => near(v, 0.1 + k * 0.25 + t[i], 1e-12)))
  assert.equal(fold(x, y, 0.25, -0.2, 6).segs.length, 3) // offset before the data: periods start at 0.05, 0.3, 0.55 (0.8 runs past)
  assert.equal(fold(x, y, 0, 0).segs.length, 0)
  assert.equal(fold(x, y, 0.01, 0, 4, 10).segs.length, 10) // capped
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
