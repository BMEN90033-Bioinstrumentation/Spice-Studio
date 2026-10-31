import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ANALYSES, analysisText, defaultAnalysis, isSpiceNumber, parseAnalysis, spiceValue, validate, type Analysis } from '../src/renderer/src/sim/analysis.ts'

const SAMPLES: Analysis[] = [
  { kind: 'op' },
  { kind: 'tran', step: '10u', stop: '20m', start: '', maxStep: '', uic: false },
  { kind: 'tran', step: '1n', stop: '1u', start: '100n', maxStep: '', uic: true },
  { kind: 'tran', step: '1n', stop: '1u', start: '', maxStep: '5p', uic: false },
  { kind: 'tran', step: '1n', stop: '1u', start: '2n', maxStep: '5p', uic: true },
  { kind: 'ac', sweep: 'dec', points: '50', fstart: '1', fstop: '100k' },
  { kind: 'ac', sweep: 'lin', points: '101', fstart: '0', fstop: '1meg' },
  { kind: 'dc', source: 'V1', start: '-1', stop: '5', step: '0.1' },
  { kind: 'noise', output: 'out', ref: '', source: 'V1', sweep: 'dec', points: '10', fstart: '1', fstop: '1meg' },
  { kind: 'noise', output: 'N001', ref: 'N002', source: 'I1', sweep: 'oct', points: '4', fstart: '10', fstop: '10k' }
]

test('analysisText / parseAnalysis round-trip', () => {
  for (const a of SAMPLES) assert.deepEqual(parseAnalysis(analysisText(a)), a, analysisText(a))
  for (const { kind } of ANALYSES) assert.deepEqual(parseAnalysis(analysisText(defaultAnalysis(kind))), defaultAnalysis(kind))
})

test('analysisText formats', () => {
  assert.equal(analysisText(SAMPLES[1]), '.tran 10u 20m')
  assert.equal(analysisText(SAMPLES[3]), '.tran 1n 1u 0 5p') // tmax needs a tstart placeholder
  assert.equal(analysisText(SAMPLES[2]), '.tran 1n 1u 100n uic')
  assert.equal(analysisText(SAMPLES[8]), '.noise v(out) V1 dec 10 1 1meg')
  assert.equal(analysisText(SAMPLES[9]), '.noise v(N001,N002) I1 oct 4 10 10k')
})

test('parseAnalysis accepts sloppy input, rejects the rest', () => {
  assert.deepEqual(parseAnalysis('  .TRAN 1u 1m UIC  '), { kind: 'tran', step: '1u', stop: '1m', start: '', maxStep: '', uic: true })
  assert.deepEqual(parseAnalysis('.tran 1u 1m 0'), { kind: 'tran', step: '1u', stop: '1m', start: '0', maxStep: '', uic: false })
  assert.deepEqual(parseAnalysis('.AC DEC 10 1 1k'), { kind: 'ac', sweep: 'dec', points: '10', fstart: '1', fstop: '1k' })
  assert.deepEqual(parseAnalysis('.noise v( out , in ) V1 dec 10 1 1k'), { kind: 'noise', output: 'out', ref: 'in', source: 'V1', sweep: 'dec', points: '10', fstart: '1', fstop: '1k' })
  for (const bad of ['', '.op 1', '.tran 1u', '.tran 1 2 3 4 5', '.ac log 10 1 1k', '.dc V1 0 5 1 V2 0 1 1', '.noise out V1 dec 10 1 1k',
    '.tf v(out) V1', '.tran 1u 1m\n.op', 'R1 a b 1k'])
    assert.equal(parseAnalysis(bad), null, bad)
})

test('isSpiceNumber / spiceValue', () => {
  for (const s of ['1', '1k', '1K', '10u', '1.5meg', '1.5MEG', '2e-3', '-2.5E+3', '+.5', '100mil', '1kohm', '10uF', '5V', '3p', '1T', '{R}', '{2*R}'])
    assert.ok(isSpiceNumber(s), s)
  for (const s of ['', 'abc', '1 k', 'k1', '1.2.3', 'e3', '-', '{}'])
    assert.ok(!isSpiceNumber(s), s)
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.abs(b), `${a} vs ${b}`)
  near(spiceValue('1.5meg'), 1.5e6)
  near(spiceValue('10uF'), 1e-5)
  near(spiceValue('1kohm'), 1e3)
  near(spiceValue('2m'), 2e-3) // m = milli, not mega
  near(spiceValue('100mil'), 2.54e-3)
  near(spiceValue('-2e-3k'), -2)
  assert.ok(isNaN(spiceValue('{R}')))
})

test('validate: defaults clean, friendly field messages', () => {
  for (const { kind } of ANALYSES) assert.deepEqual(validate(defaultAnalysis(kind)), [], kind)
  for (const a of SAMPLES) assert.deepEqual(validate(a), [], analysisText(a))
  assert.deepEqual(validate({ ...(defaultAnalysis('tran') as any), stop: 'abc' }), ['Stop time must be a number like 20m'])
  assert.deepEqual(validate({ ...(defaultAnalysis('tran') as any), step: '' }), ['Time step is required (e.g. 10u)'])
  assert.match(validate({ ...(defaultAnalysis('tran') as any), start: '1', stop: '1m' }).join(), /Start time must be before/)
  assert.match(validate({ ...(defaultAnalysis('ac') as any), points: '2.5' }).join(), /Points must be a whole number/)
  assert.match(validate({ ...(defaultAnalysis('ac') as any), fstart: '0' }).join(), /Start frequency must be above 0/)
  assert.match(validate({ ...(defaultAnalysis('ac') as any), fstart: '1meg', fstop: '1' }).join(), /Stop frequency/)
  assert.match(validate({ ...(defaultAnalysis('dc') as any), source: ' ', step: '0' }).join('|'), /Pick a source.*\|Increment must not be 0/)
  assert.match(validate({ ...(defaultAnalysis('noise') as any), output: '' }).join(), /output net/)
})

test('every sample analysis is accepted by ngspice (skipped if ngspice missing)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'antest-'))
  for (const a of SAMPLES) {
    const deck = ['* an', 'V1 N001 0 DC 1 AC 1', 'I1 0 N002 DC 1m AC 1', 'R1 N001 out 1k', 'C1 out 0 1u', 'R2 N002 0 1k', analysisText(a), '.end', ''].join('\n')
    writeFileSync(join(dir, 'c.cir'), deck)
    const r = spawnSync('ngspice', ['-b', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { encoding: 'utf8' })
    if (r.error) return void t.skip('ngspice not on PATH')
    assert.equal(r.status, 0, analysisText(a) + '\n' + r.stderr)
    assert.doesNotMatch(r.stdout + r.stderr, /error|warning/i, analysisText(a))
  }
})
