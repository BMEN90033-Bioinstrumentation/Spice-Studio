import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evalTran, parseSource, previewSpan, sourceText } from '../src/renderer/src/sim/source.ts'

const CANON = [
  '0', '5', '{vcc}', 'DC 0 AC 1 0 PULSE(0 1 0 1u 1u 5m 10m)', 'AC 1', 'DC 1 AC 1 90', 'PULSE(0 5 1m 1n 1n 1m 2m 3)',
  'SIN(0 1 1k)', 'SIN(0.5 1 1k 1m 100 90)', 'EXP(0 1 1u 10u 50u 20u)', 'PWL(0 0 1m 1 2m 0)', 'PWL(0 0 1m 1 2m 0) r=0 td=0.5m',
  'SFFM(0 1 10k 2 1k)', 'AM(1 0.5 1k 10k 0)', 'DC 2 SIN(0 {amp} 50)'
]

test('canonical source values round-trip', () => {
  for (const s of CANON) {
    const p = parseSource(s)
    assert.ok(p, s)
    assert.equal(sourceText(p), s)
    assert.deepEqual(parseSource(sourceText(p)), p, s)
  }
  assert.deepEqual(parseSource('DC 0 AC 1 0 PULSE(0 1 0 1u 1u 5m 10m)'), {
    dc: '0', acMag: '1', acPhase: '0', tran: { kind: 'pulse', args: ['0', '1', '0', '1u', '1u', '5m', '10m'] }
  })
})

test('sloppy but complete values are canonicalised', () => {
  assert.equal(sourceText(parseSource(' dc 5 ')!), '5')
  assert.equal(sourceText(parseSource('pulse (0, 1, 0, 1u)  ac 1')!), 'AC 1 PULSE(0 1 0 1u)')
  assert.equal(sourceText(parseSource('Sin(0 1 1k) DC 1')!), 'DC 1 SIN(0 1 1k)')
  assert.equal(sourceText(parseSource('PWL(0 0 1 1) TD=2')!), 'PWL(0 0 1 1) td=2')
})

test('values it cannot fully parse come back null (dialog keeps the raw text)', () => {
  for (const s of ['DC', 'AC', 'DC 1 DC 2', 'PULSE 0 1 0 1u', 'PULSE(0)', 'PULSE(0 1 0 1 1 1 1 1 1)', 'SIN(0 1) SIN(0 1)',
    'PWL(0 0 1)', 'PWL file="x.txt"', 'PWL(0 0 1 1) r = 0', 'TRNOISE(0 1n 0 0)', 'DISTOF1 1', 'DC 1 AC 1 DISTOF1 0.1',
    'PULSE(0 {a b} 1)', 'PULSE(0 {max(1,2)})', 'SIN(0 1 1k', 'R=1k', '1 2', 'PULSE(0 1) r=1', 'value={x}'])
    assert.equal(parseSource(s), null, s)
})

test('evalTran spot values', () => {
  const v = (s: string, t: number) => evalTran(parseSource(s)!, t, { step: 1e-6, stop: 1e-2 })
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`)
  const p = 'PULSE(0 1 1m 1m 1m 2m 10m)'
  near(v(p, 0), 0), near(v(p, 1.5e-3), 0.5), near(v(p, 3e-3), 1), near(v(p, 4.5e-3), 0.5), near(v(p, 6e-3), 0), near(v(p, 13e-3), 1)
  near(v('PULSE(0 1 0 0 0 1m 2m 2)', 4.5e-3), 0) // NP = 2 pulses, then V1
  near(v('SIN(1 2 1k)', 0.25e-3), 3), near(v('SIN(0 1 1k 1m)', 0.5e-3), 0), near(v('SIN(0 1 1k 0 0 90)', 0), 1)
  near(v('EXP(0 1 0 1m 5m 1m)', 1e-3), 1 - Math.exp(-1))
  near(v('PWL(0 0 1m 1 2m 0)', 0.5e-3), 0.5), near(v('PWL(0 0 1m 1 2m 0)', 5e-3), 0)
  near(v('PWL(0 0 1m 1 2m 0) r=0 td=0.5m', 2.555e-3), 0.055)
  near(v('5', 1), 5)
  assert.ok(isNaN(v('PULSE(0 {vhi} 0)', 1)))
  assert.ok(isNaN(v('AM(1 0.5 1k 10k 0)', 1)))
  assert.equal(previewSpan(parseSource('PULSE(0 1 0 1u 1u 5m 10m)')!), 20e-3)
  assert.equal(previewSpan(parseSource('SIN(0 1 1k)')!), 2e-3)
})

// evalTran must match what ngspice actually drives: compare against wrdata at ngspice's own time points
test('evalTran matches ngspice-47 transient output (skipped if ngspice missing)', (t) => {
  const srcs = ['PULSE(0 1 0.2m 0.1m 0.2m 1m 2m)', 'PULSE(0 1 0 0 0 0.5m 1m 2)', 'SIN(0.5 1 1k 0.3m 200 30)', 'EXP(0 1 0.5m 0.2m 2m 0.5m)',
    'PWL(0 0 1m 1 2m -1 2.5m 0) r=1m td=0.3m', 'PWL(0 1 1m 2 1.5m 0)', 'SFFM(0 1 10k 2 1k)', 'DC 3 AC 1']
  const dir = mkdtempSync(join(tmpdir(), 'srctest-'))
  const deck = ['* src', ...srcs.flatMap((s, i) => [`V${i} n${i} 0 ${s}`, `R${i} n${i} 0 1k`]),
    '.control', 'tran 10u 5m', `wrdata ${join(dir, 'o.txt')} ${srcs.map((_, i) => `v(n${i})`).join(' ')}`, '.endc', '.end', ''].join('\n')
  writeFileSync(join(dir, 'c.cir'), deck)
  const r = spawnSync('ngspice', ['-b', join(dir, 'c.cir')], { encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  const rows = readFileSync(join(dir, 'o.txt'), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number))
  assert.ok(rows.length > 100)
  srcs.forEach((s, i) => {
    const src = parseSource(s)!
    for (const row of rows) {
      const tt = row[2 * i], want = row[2 * i + 1], got = evalTran(src, tt, { step: 10e-6, stop: 5e-3 })
      assert.ok(Math.abs(got - want) < 1e-6, `${s} at t=${tt}: ${got} vs ngspice ${want}`)
    }
  })
})
