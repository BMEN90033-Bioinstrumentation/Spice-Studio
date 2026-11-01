import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ANALYSES, analysisText, defaultAnalysis, emptyOptions, isSpiceNumber, mergeOptions, optionsText, parseAnalysis, parseOptions, plotPanes, analysisPos, spiceValue, validate, validateOptions,
  type Analysis
} from '../src/renderer/src/sim/analysis.ts'

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

test('.options: parse into the form, unknown options kept, round-trip', () => {
  const o = parseOptions('.OPTIONS reltol = 1e-3 method=GEAR klu itl1=500 rshunt=1e12 temp=50')!
  assert.deepEqual({ reltol: o.reltol, method: o.method, itl1: o.itl1, temp: o.temp, abstol: o.abstol, extra: o.extra },
    { reltol: '1e-3', method: 'gear', itl1: '500', temp: '50', abstol: '', extra: 'klu rshunt=1e12' })
  assert.equal(optionsText(o), '.options reltol=1e-3 itl1=500 temp=50 method=gear klu rshunt=1e12')
  assert.deepEqual(parseOptions(optionsText(o)), o)
  assert.equal(optionsText(emptyOptions()), '.options')
  assert.deepEqual(parseOptions('.option method=euler'), { ...emptyOptions(), extra: 'method=euler' }) // unknown method: kept as-is
  for (const bad of ['.op', '.optionsx a=1', '.options a=1\n.tran 1 2', 'reltol=1']) assert.equal(parseOptions(bad), null, bad)
})

test('.options: merge key by key, later wins', () => {
  assert.equal(mergeOptions('.options reltol=1e-3 klu', '.options method=gear reltol=1e-2'), '.options reltol=1e-2 klu method=gear')
  assert.equal(mergeOptions('', 'itl1=1000 srcsteps=100'), '.options itl1=1000 srcsteps=100')
  assert.equal(mergeOptions('.opt GMIN = 1e-12', 'gmin=1e-10'), '.options gmin=1e-10')
})

test('.options: validation', () => {
  assert.deepEqual(validateOptions(emptyOptions()), [])
  assert.deepEqual(validateOptions({ ...emptyOptions(), reltol: 'x', itl1: '2.5', gmin: '0', temp: '-40' }),
    ['Relative tolerance must be a number like 1e-3', 'Minimum conductance must be above 0', 'DC iteration limit must be a whole number like 100'])
})

test('a form-written .options line is accepted by ngspice (skipped if ngspice missing)', (t) => {
  const o = { ...emptyOptions(), reltol: '3e-3', abstol: '1e-11', vntol: '1e-5', gmin: '1e-10', itl1: '500', itl4: '100', temp: '50', tnom: '27', method: 'gear' as const, extra: 'rshunt=1e12' }
  const dir = mkdtempSync(join(tmpdir(), 'optest-'))
  writeFileSync(join(dir, 'c.cir'), ['* opt', 'V1 a 0 1', 'R1 a 0 1k', optionsText(o), '.op', '.end', ''].join('\n'))
  const r = spawnSync('ngspice', ['-b', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stdout + r.stderr, /error|warning|unknown/i)
  assert.match(r.stdout, /TEMP = 50/)
})

test('.plot lines become panes for their analysis only', () => {
  const net = '* x\n.tran 1u 1m\n.plot tran v(a) v(a,b) ; Input; raw\n  .PLOT TRAN I(D1)\n.plot ac v(a)\n'
  assert.deepEqual(plotPanes(net, 'Transient Analysis', ['time', 'v(a)', 'v(b)']), [
    { title: 'Input; raw', sel: ['v(a)', '=v(a,b)'] },
    { title: '', sel: ['=I(D1)'] }
  ])
  assert.deepEqual(plotPanes(net, 'AC Analysis', ['frequency', 'v(a)']), [{ title: '', sel: ['v(a)'] }])
  assert.deepEqual(plotPanes(net, 'Operating Point', ['v(a)']), [])
})

test('result tabs follow the directive order', () => {
  const net = '* x\n.options reltol=1e-4\n.tran 1u 1m\n.ac dec 10 1 1k\n.op\n'
  const order = ['AC Analysis', 'Operating Point', 'Transient Analysis', 'Noise Spectral Density Curves']
  assert.deepEqual(order.sort((a, b) => analysisPos(net, a) - analysisPos(net, b)), ['Transient Analysis', 'AC Analysis', 'Operating Point', 'Noise Spectral Density Curves'])
})
