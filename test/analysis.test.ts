import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ANALYSES, analysisText, defaultAnalysis, emptyOptions, isSpiceNumber, mergeOptions, nodeValsText, optionsText, parseAnalysis, parseNodeVals, parseOptions, plotPanes, analysisPos,
  setupKind, spiceValue, validate, validateNodeVals, validateOptions, type Analysis
} from '../src/renderer/src/sim/analysis.ts'
import { parseRaw } from '../src/main/rawfile.ts'

const SAMPLES: Analysis[] = [
  { kind: 'op' },
  { kind: 'tran', step: '10u', stop: '20m', start: '', maxStep: '', uic: false },
  { kind: 'tran', step: '1n', stop: '1u', start: '100n', maxStep: '', uic: true },
  { kind: 'tran', step: '1n', stop: '1u', start: '', maxStep: '5p', uic: false },
  { kind: 'tran', step: '1n', stop: '1u', start: '2n', maxStep: '5p', uic: true },
  { kind: 'ac', sweep: 'dec', points: '50', fstart: '1', fstop: '100k' },
  { kind: 'ac', sweep: 'lin', points: '101', fstart: '0', fstop: '1meg' },
  { kind: 'dc', source: 'V1', start: '-1', stop: '5', step: '0.1', source2: '', start2: '', stop2: '', step2: '' },
  { kind: 'dc', source: 'V1', start: '0', stop: '5', step: '0.5', source2: 'I1', start2: '0', stop2: '2m', step2: '1m' },
  { kind: 'noise', output: 'out', ref: '', source: 'V1', sweep: 'dec', points: '10', fstart: '1', fstop: '1meg' },
  { kind: 'noise', output: 'N001', ref: 'N002', source: 'I1', sweep: 'oct', points: '4', fstart: '10', fstop: '10k' },
  { kind: 'tf', current: false, output: 'out', ref: '', source: 'V1' },
  { kind: 'tf', current: false, output: 'out', ref: 'N002', source: 'I1' },
  { kind: 'tf', current: true, output: 'V1', ref: '', source: 'I1' },
  { kind: 'sens', current: false, output: 'out', ref: '', ac: false, sweep: 'dec', points: '10', fstart: '1', fstop: '1meg' },
  { kind: 'sens', current: true, output: 'V1', ref: '', ac: true, sweep: 'lin', points: '5', fstart: '10', fstop: '1k' },
  { kind: 'pz', in1: 'N001', in2: '0', out1: 'out', out2: '0', tf: 'vol', find: 'pz' },
  { kind: 'pz', in1: 'N002', in2: '0', out1: 'out', out2: 'N002', tf: 'cur', find: 'pol' },
  { kind: 'disto', sweep: 'dec', points: '5', fstart: '100', fstop: '100k', f2: '' },
  { kind: 'disto', sweep: 'oct', points: '2', fstart: '1k', fstop: '64k', f2: '0.9' },
  { kind: 'sp', sweep: 'dec', points: '5', fstart: '1meg', fstop: '1g', noise: false },
  { kind: 'sp', sweep: 'lin', points: '11', fstart: '10meg', fstop: '110meg', noise: true },
  { kind: 'four', freq: '1k', outputs: ['v(out)', 'v(N001,N002)'] }
]

test('analysisText / parseAnalysis round-trip', () => {
  for (const a of SAMPLES) assert.deepEqual(parseAnalysis(analysisText(a)), a, analysisText(a))
  for (const { kind } of ANALYSES) assert.deepEqual(parseAnalysis(analysisText(defaultAnalysis(kind))), defaultAnalysis(kind))
})

test('analysisText formats', () => {
  assert.equal(analysisText(SAMPLES[1]), '.tran 10u 20m')
  assert.equal(analysisText(SAMPLES[3]), '.tran 1n 1u 0 5p') // tmax needs a tstart placeholder
  assert.equal(analysisText(SAMPLES[2]), '.tran 1n 1u 100n uic')
  assert.equal(analysisText(SAMPLES[9]), '.noise v(out) V1 dec 10 1 1meg')
  assert.equal(analysisText(SAMPLES[10]), '.noise v(N001,N002) I1 oct 4 10 10k')
  assert.equal(analysisText(SAMPLES[8]), '.dc V1 0 5 0.5 I1 0 2m 1m')
  const by = (k: string, i = 0) => analysisText(SAMPLES.filter((a) => a.kind === k)[i])
  assert.deepEqual([by('tf'), by('tf', 1), by('tf', 2)], ['.tf v(out) V1', '.tf v(out,N002) I1', '.tf i(V1) I1'])
  assert.deepEqual([by('sens'), by('sens', 1)], ['.sens v(out)', '.sens i(V1) ac lin 5 10 1k'])
  assert.deepEqual([by('pz'), by('pz', 1)], ['.pz N001 0 out 0 vol pz', '.pz N002 0 out N002 cur pol'])
  assert.deepEqual([by('disto'), by('disto', 1)], ['.disto dec 5 100 100k', '.disto oct 2 1k 64k 0.9'])
  assert.deepEqual([by('sp'), by('sp', 1)], ['.sp dec 5 1meg 1g', '.sp lin 11 10meg 110meg 1'])
  assert.equal(by('four'), '.four 1k v(out) v(N001,N002)')
})

test('parseAnalysis accepts sloppy input, rejects the rest', () => {
  assert.deepEqual(parseAnalysis('  .TRAN 1u 1m UIC  '), { kind: 'tran', step: '1u', stop: '1m', start: '', maxStep: '', uic: true })
  assert.deepEqual(parseAnalysis('.tran 1u 1m 0'), { kind: 'tran', step: '1u', stop: '1m', start: '0', maxStep: '', uic: false })
  assert.deepEqual(parseAnalysis('.AC DEC 10 1 1k'), { kind: 'ac', sweep: 'dec', points: '10', fstart: '1', fstop: '1k' })
  assert.deepEqual(parseAnalysis('.noise v( out , in ) V1 dec 10 1 1k'), { kind: 'noise', output: 'out', ref: 'in', source: 'V1', sweep: 'dec', points: '10', fstart: '1', fstop: '1k' })
  assert.deepEqual(parseAnalysis('.SENS V( out ) AC DEC 10 1 1k'), { kind: 'sens', current: false, output: 'out', ref: '', ac: true, sweep: 'dec', points: '10', fstart: '1', fstop: '1k' })
  assert.deepEqual(parseAnalysis('.PZ 1 0 3 0 VOL ZER'), { kind: 'pz', in1: '1', in2: '0', out1: '3', out2: '0', tf: 'vol', find: 'zer' })
  assert.deepEqual(parseAnalysis('.fourier 50 v(a)'), { kind: 'four', freq: '50', outputs: ['v(a)'] })
  assert.equal((parseAnalysis('.sp dec 10 1 1g 0') as { noise: boolean }).noise, false)
  for (const bad of ['', '.op 1', '.tran 1u', '.tran 1 2 3 4 5', '.ac log 10 1 1k', '.dc V1 0 5 1 V2 0 1', '.noise out V1 dec 10 1 1k',
    '.tf v(out)', '.tf out V1', '.sens v(out) ac dec 10 1', '.sens v(out) dc', '.pz in 0 out 0 vol', '.pz in 0 out 0 vol both', '.disto log 10 1 1k',
    '.sp dec 10 1 1g 2', '.four 1k', '.tran 1u 1m\n.op', 'R1 a b 1k'])
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
  assert.deepEqual(validate({ ...(defaultAnalysis('dc') as any), source2: 'V1' }), ['The second source must not be the swept source', 'Second start is required (e.g. 0)', 'Second stop is required (e.g. 5)', 'Second increment is required (e.g. 1)'])
  assert.deepEqual(validate({ ...(defaultAnalysis('dc') as any), source2: 'V2', start2: '0', stop2: '1', step2: '0' }), ['Second increment must not be 0'])
  assert.match(validate({ ...(defaultAnalysis('tf') as any), current: true, output: '' }).join(), /voltage source to measure/)
  assert.match(validate({ ...(defaultAnalysis('tf') as any), ref: 'out' }).join(), /reference node must differ/)
  assert.deepEqual(validate({ ...(defaultAnalysis('sens') as any), points: 'x' }), []) // DC: the sweep fields are not used
  assert.match(validate({ ...(defaultAnalysis('sens') as any), ac: true, points: 'x' }).join(), /Points must be a number/)
  assert.match(validate({ ...(defaultAnalysis('pz') as any), out2: 'out' }).join(), /two output nodes must differ/)
  assert.deepEqual(validate({ ...(defaultAnalysis('disto') as any), f2: '1.5' }), ['F2/F1 ratio must be between 0 and 1 (e.g. 0.9)'])
  assert.deepEqual(validate({ ...(defaultAnalysis('four') as any), freq: '0', outputs: [] }), ['Fundamental frequency must be above 0', 'Pick at least one output (e.g. v(out))'])
})

test('every sample analysis is accepted by ngspice (skipped if ngspice missing)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'antest-'))
  for (const a of SAMPLES) {
    // DISTOF for .disto; .four rides on a .tran; two 50 ohm ports for .sp only (a port source makes .sens abort, ngspice-47)
    const deck = ['* an', 'V1 N001 0 DC 1 AC 1 DISTOF1 0.1 DISTOF2 0.1', 'I1 0 N002 DC 1m AC 1', 'R1 N001 out 1k', 'C1 out 0 1u', 'R2 N002 0 1k',
      ...(a.kind === 'sp' ? ['V3 N003 0 dc 0 ac 1 portnum 1 z0 50', 'R3 N003 N004 100', 'V4 N004 0 dc 0 ac 0 portnum 2 z0 50'] : []), ...(a.kind === 'four' ? ['.tran 10u 2m'] : []), analysisText(a), '.end', ''].join('\n')
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

test('.ic / .nodeset: net rows round-trip, other tokens kept, validation', () => {
  const nv = parseNodeVals('.IC V( out ) = 2.5 v(n1)=0 v(a,b)=1')!
  assert.deepEqual(nv, { rows: [{ net: 'out', value: '2.5' }, { net: 'n1', value: '0' }], extra: 'v(a,b)=1' })
  assert.equal(nodeValsText('ic', nv), '.ic v(out)=2.5 v(n1)=0 v(a,b)=1')
  assert.deepEqual(parseNodeVals(nodeValsText('nodeset', nv)), nv)
  for (const bad of ['.icx v(a)=1', '.op', '.ic v(a)=1\n.op', 'v(a)=1']) assert.equal(parseNodeVals(bad), null, bad)
  assert.deepEqual(['.opt reltol=1', ' .IC v(a)=1', '.nodeset v(a)=1', '.include x', '.icx'].map(setupKind), ['options', 'ic', 'nodeset', null, null])
  assert.deepEqual(validateNodeVals(nv), [])
  assert.deepEqual(validateNodeVals({ rows: [], extra: '' }), ['Add at least one net'])
  assert.deepEqual(validateNodeVals({ rows: [{ net: '', value: '1' }, { net: 'a', value: 'x' }, { net: 'A', value: '1' }], extra: '' }),
    ['Pick a net for every row', 'v(a) needs a value like 0 or 2.5', 'v(A) is set twice'])
})

test('form-written .ic / .nodeset lines steer ngspice (skipped if ngspice missing)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ictest-'))
  const ic = nodeValsText('ic', { rows: [{ net: 'out', value: '2' }], extra: '' }), ns = nodeValsText('nodeset', { rows: [{ net: 'mid', value: '1' }], extra: '' })
  writeFileSync(join(dir, 'c.cir'), ['* ic', 'V1 in 0 0', 'R1 in out 1k', 'C1 out 0 1u', 'R2 in mid 1k', 'R3 mid 0 1k', ic, ns, '.tran 10u 1m', '.end', ''].join('\n'))
  const r = spawnSync('ngspice', ['-b', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stdout + r.stderr, /error|warning/i)
  const [tran] = parseRaw(readFileSync(join(dir, 'o.raw')))
  assert.ok(Math.abs(tran.vars.find((v) => v.name === 'v(out)')!.re[0] - 2) < 1e-6) // held at 2 V through the operating point
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
  const net2 = '* x\n.sp dec 10 1meg 1g\n.pz in 0 out 0 vol pz\n.tf v(out) V1\n.sens v(out)\n.disto dec 10 1 1k\n'
  const names = ['Sensitivity Analysis', 'DISTORTION - 2nd harmonic', 'Transfer Function', 'Pole-Zero Analysis', 'SP Analysis']
  assert.deepEqual(names.sort((a, b) => analysisPos(net2, a) - analysisPos(net2, b)), ['SP Analysis', 'Pole-Zero Analysis', 'Transfer Function', 'Sensitivity Analysis', 'DISTORTION - 2nd harmonic'])
})
