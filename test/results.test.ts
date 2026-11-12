import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRaw, type RawPlot } from '../src/main/rawfile.ts'
import { measDeck, measSection, parseFour, parseMeas } from '../src/renderer/src/sim/meas.ts'
import { plotRuns, pzRows, sensRows, startSel, tableKind, tfRows } from '../src/renderer/src/sim/results.ts'

// run a deck as the app does (-b -r, .options savecurrents); null if ngspice is missing
function sim(lines: string[]): { plots: RawPlot[]; log: string } | null {
  const d = mkdtempSync(join(tmpdir(), 'res-')), f = join(d, 'c.cir'), raw = join(d, 'o.raw')
  writeFileSync(f, ['* t', ...lines, '.options savecurrents', '.end', ''].join('\n'))
  const p = spawnSync('ngspice', ['-b', '-r', raw, f], { encoding: 'utf8' })
  if (p.error) return null
  assert.equal(p.status, 0, p.stdout + p.stderr)
  return { plots: parseRaw(readFileSync(raw)), log: p.stdout }
}
const near = (a: number, b: number, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} vs ${b}`)

test('.tf: gain, input and output resistance, with units from the output and input kinds (skipped if ngspice missing)', (t) => {
  const r = sim(['V1 in 0 DC 1', 'R1 in out 1k', 'R2 out 0 2k', 'Vm out2 0 0', 'R3 out out2 1k', '.tf v(out) V1'])
  if (!r) return void t.skip('ngspice not on PATH')
  const [p] = r.plots
  assert.equal(tableKind(p), 'tf')
  const rows = tfRows(p) // savecurrents' i(@r1[i]) vectors are left out
  assert.deepEqual(rows.map((x) => [x.name, x.unit]), [['Gain V(out) / V1', ''], ['Input resistance at V1', 'Ω'], ['Output resistance at V(out)', 'Ω']])
  near(rows[0].value, 0.4), near(rows[1].value, 1000 + 2000 / 3), near(rows[2].value, 400) // 1k ‖ 2k ‖ 1k
  const c = sim(['V1 in 0 DC 1', 'R1 in out 1k', 'Vm out 0 0', '.tf i(Vm) V1'])!
  assert.deepEqual(tfRows(c.plots[0]).map((x) => [x.name, x.unit]), [['Gain I(VM) / V1', 'S'], ['Input resistance at V1', 'Ω'], ['Output resistance in I(VM)', 'Ω']])
})

test('.sens: zero and savecurrents vectors dropped, DC as a table largest first, AC as a plot (skipped if ngspice missing)', (t) => {
  const r = sim(['V1 in 0 DC 1 AC 1', 'R1 in out 1k', 'R2 out 0 2k', 'C1 out 0 1u', '.sens v(out)'])
  if (!r) return void t.skip('ngspice not on PATH')
  const [{ plot }] = plotRuns('', r.plots[0], '')
  assert.equal(tableKind(plot), 'sens')
  const rows = sensRows(plot)
  assert.equal(rows[0].name, 'v1'), near(rows[0].value, 2 / 3) // dV(out)/dV1
  near(rows.find((x) => x.name === 'r1')!.value, -2 / 9000) // dV(out)/dR1 = -V1·R2/(R1+R2)²
  assert.ok(rows.every((x) => x.value !== 0 && !x.name.startsWith('i(@')))
  assert.ok(rows.every((x, i) => !i || Math.abs(x.value) <= Math.abs(rows[i - 1].value)))
  const ac = sim(['V1 in 0 DC 1 AC 1', 'R1 in out 1k', 'R2 out 0 2k', 'C1 out 0 1u', '.sens v(out) ac dec 2 10 1k'])!
  const [{ plot: ap }] = plotRuns('', ac.plots[0], '')
  assert.equal(tableKind(ap), null)
  assert.equal(ap.vars[0].name, 'frequency')
  assert.ok(ap.vars.length < ac.plots[0].vars.length / 4 && ap.vars.some((v) => v.name === 'v(c1)'))
})

test('.pz: poles and zeros in rad/s with f and Q (skipped if ngspice missing)', (t) => {
  // series RLC, output across C: poles at w0 = 1/sqrt(LC) = 31.62k rad/s, Q = sqrt(L/C)/R = 3.162
  const r = sim(['V1 in 0 DC 0 AC 1', 'R1 in a 10', 'L1 a out 1m', 'C1 out 0 1u', '.pz in 0 out 0 vol pz'])
  if (!r) return void t.skip('ngspice not on PATH')
  const [p] = r.plots
  assert.equal(tableKind(p), 'pz')
  const roots = pzRows(p)
  assert.deepEqual(roots.map((x) => x.kind), ['pole', 'pole']) // no finite zeros
  for (const x of roots) near(x.f, 1e4 / (2 * Math.PI) * Math.sqrt(10)), near(x.q!, Math.sqrt(10)), near(Math.abs(x.im), Math.sqrt(1e9 - 25e6))
  const hp = sim(['V1 in 0 DC 0 AC 1', 'C1 in out 1u', 'R1 out 0 1k', '.pz in 0 out 0 vol pz'])!
  assert.deepEqual(pzRows(hp.plots[0]).map((x) => [x.kind, Math.round(x.re), x.q]), [['pole', -1000, null], ['zero', 0, null]])
})

test('nested .dc: one run per outer value, labelled (skipped if ngspice missing)', (t) => {
  const dc = '.dc V1 0 1 0.25 V2 0 2 1'
  const r = sim(['V1 d 0 0', 'V2 g 0 0', 'R1 d s 100', 'R2 g s 1k', 'R3 s 0 100', dc])
  if (!r) return void t.skip('ngspice not on PATH')
  const runs = plotRuns('', r.plots[0], `* x\n${dc}\n`)
  assert.deepEqual(runs.map((x) => x.label), ['V2=0', 'V2=1', 'V2=2'])
  for (const [k, { plot }] of runs.entries()) {
    assert.equal(plot.points, 5)
    assert.deepEqual([...plot.vars[0].re], [0, 0.25, 0.5, 0.75, 1])
    assert.deepEqual([...plot.vars.find((v) => v.name === 'v(g)')!.re], [k, k, k, k, k])
  }
  // a .step run's label comes first; a plain .dc passes through
  assert.deepEqual(plotRuns('R=1k', r.plots[0], dc).map((x) => x.label), ['R=1k, V2=0', 'R=1k, V2=1', 'R=1k, V2=2'])
  assert.equal(plotRuns('', r.plots[0], '.dc V1 0 1 0.25')[0].plot, r.plots[0])
  assert.deepEqual(plotRuns('', r.plots[0], '.dc V1 0 1 0.25 V2 0 {vmax} 1').map((x) => x.label), ['V2=0', 'V2=1', 'V2=2'])
  assert.deepEqual(plotRuns('', r.plots[0], '.dc V1 0 1 0.25 V2 {a} 2 1').map((x) => x.label), ['V2 #1', 'V2 #2', 'V2 #3'])
})

test('.sp: the S-parameters are the default selection (skipped if ngspice missing)', (t) => {
  const r = sim(['V1 in 0 dc 0 ac 1 portnum 1 z0 50', 'L1 in out 100n', 'C1 out 0 40p', 'V2 out 0 dc 0 ac 0 portnum 2 z0 50', '.sp lin 11 10meg 110meg'])
  if (!r) return void t.skip('ngspice not on PATH')
  assert.deepEqual(startSel(r.plots[0]), ['s_1_1', 's_1_2', 's_2_1', 's_2_2'])
  assert.equal(startSel({ ...r.plots[0], plotname: 'AC Analysis' }), null)
})

test('.four through the measDeck pass: harmonics and THD per vector, alongside .meas (skipped if ngspice missing)', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'four-')), f = join(d, 'c.cir')
  const deck = '* four\nV1 in 0 SIN(0 2 1k)\nR1 in out 1k\nD1 out 0 dd\n.model dd D\n.ac dec 10 10 10k\n.tran 1u 5m\n.four 1k v(out) v(in) ; clipped\n.meas tran vmax MAX v(out)\n.end\n'
  const md = measDeck(deck)!
  assert.match(md, /^\.control\ntran 1u 5m\necho Fourier analysis \(\.four\):\nsetplot tran1\nfourier 1k v\(out\) v\(in\)\nquit$/m)
  assert.match(md, /^\*\.ac dec 10 10 10k$/m) // nothing measures it
  writeFileSync(f, md)
  const p = spawnSync('ngspice', ['-b', '-n', f], { encoding: 'utf8' })
  if (p.error) return void t.skip('ngspice not on PATH')
  const sec = measSection(p.stdout)
  const four = parseFour(sec)
  assert.deepEqual(four.map((x) => [x.vector, x.rows.length]), [['v(out)', 10], ['v(in)', 10]])
  assert.ok(four[0].thd > 10 && four[0].thd < 50, String(four[0].thd)) // a diode-clipped sine
  assert.ok(four[1].thd < 1e-3)
  assert.deepEqual(four[0].rows.slice(0, 3).map((x) => [x.n, x.freq, x.nmag > 0]), [[0, 0, false], [1, 1000, true], [2, 2000, true]])
  near(four[1].rows[1].mag, 2, 1e-3)
  assert.deepEqual(parseMeas(sec).map((x) => x.name), ['vmax'])
})

test('parseFour: run labels, NaN THD, stray lines end a block', () => {
  const log = `--- run R=1k ---
Fourier analysis for v(a):
  No. Harmonics: 2, THD: nan %, Gridsize: 200, Interpolation Degree: 1, No. Periods: 1

Harmonic Frequency   Magnitude   Phase       Norm. Mag   Norm. Phase
-------- ---------   ---------   -----       ---------   -----------
 0       0           0.1         0           0           0
 1       50          1           -90         1           0
--- run R=2k ---
Fourier analysis for i(v1):
  No. Harmonics: 1, THD: 1.5 %, Gridsize: 200, Interpolation Degree: 1, No. Periods: 1
 0       0           0.2         0           0           0
Total analysis time (seconds) = 0.01
 1       2 3 4 5 6
`
  const f = parseFour(log)
  assert.deepEqual(f.map((x) => [x.run, x.vector, x.rows.length]), [['R=1k', 'v(a)', 2], ['R=2k', 'i(v1)', 1]])
  assert.ok(isNaN(f[0].thd))
  assert.equal(f[1].thd, 1.5)
  assert.deepEqual(f[0].rows[1], { n: 1, freq: 50, mag: 1, phase: -90, nmag: 1, nphase: 0 })
  assert.deepEqual(parseFour('no fourier here\n 1 2 3 4 5 6\n'), [])
})

test('measDeck: .four alone gets a pass, its own .control is left alone', () => {
  assert.equal(measDeck('* t\n.tran 1u 1m\n.four 1k v(a)\n.end\n'),
    '* t\n.tran 1u 1m\n.four 1k v(a)\n.control\ntran 1u 1m\necho Fourier analysis (.four):\nsetplot tran1\nfourier 1k v(a)\nquit\n.endc\n.end\n')
  assert.equal(measDeck('* t\n.four 1k v(a)\n.control\nrun\n.endc\n'), null)
  assert.equal(measSection('x\nFourier analysis for v(a):\n  THD: 1 %\nngspice-47 done\n'), 'Fourier analysis for v(a):\n  THD: 1 %')
})

// the measDeck pass of `lines` through ngspice -b (no rawfile): its measurement section; null if ngspice is missing
function measPass(lines: string[]): string | null {
  const d = mkdtempSync(join(tmpdir(), 'mp-')), f = join(d, 'c.cir')
  writeFileSync(f, measDeck(['* t', ...lines, '.options savecurrents', '.end', ''].join('\n'))!)
  const p = spawnSync('ngspice', ['-b', '-n', f], { encoding: 'utf8' })
  return p.error ? null : measSection(p.stdout + p.stderr) // the app logs both streams
}
const RC = ['V1 in 0 DC 1 AC 1 PULSE(0 1 0 1u 1u 20m 40m) DISTOF1 0.1', 'R1 in out 1k', 'C1 out 0 1u']

test('.meas of each type is read on its own plot, whatever else the deck runs (skipped if ngspice missing)', (t) => {
  // a .tf/.sens/.pz/.disto after the .tran used to leave "Measurements for Transient Analysis" empty
  for (const other of ['.tf v(out) V1', '.sens v(out)', '.pz in 0 out 0 vol pz', '.disto dec 5 1 1k', '.op']) {
    const sec = measPass([...RC, '.tran 10u 40m', '.meas tran vmax MAX v(out)', other])
    if (sec == null) return void t.skip('ngspice not on PATH')
    const [m] = parseMeas(sec)
    assert.equal(m?.name, 'vmax', other + '\n' + sec)
    near(m.value!, 1 - Math.exp(-20), 1e-2) // the cap charges for 20 ms = 20 tau
  }
  // tran, ac and dc measurements together (ngspice's own `run` reports one type only)
  const sec = measPass([...RC, '.ac dec 10 1 100k ; bode', '.tran 10u 40m', '.dc V1 0 2 0.5', '.tf v(out) V1', '.meas tran vmax MAX v(out)', '.meas ac fc WHEN vdb(out)=-3 FALL=1', '.meas dc vdc FIND v(out) AT=1.5'])!
  const m = Object.fromEntries(parseMeas(sec).map((x) => [x.name, x.value]))
  near(m.vmax!, 1, 1e-2), near(m.fc!, 1 / (2 * Math.PI * 1e-3), 1e-2), near(m.vdc!, 1.5)
  // a {param} analysis can't be a .control command: `run`, with the unmeasured analyses commented out
  const md = measDeck(['* t', '.param ts=40m', '.tran 10u {ts}', '.ac dec 10 1 1k', '.meas tran vmax MAX v(out)', '.end', ''].join('\n'))!
  assert.match(md, /^\*\.ac dec 10 1 1k$/m), assert.match(md, /^\.control\nrun\nquit$/m)
})

test('.four failures reach the log (skipped if ngspice missing)', (t) => {
  const short = measPass([...RC, '.tran 1u 0.5m', '.four 1k v(out)'])
  if (short == null) return void t.skip('ngspice not on PATH')
  assert.match(short, /^Fourier analysis \(\.four\):[\s\S]*\nError: \(1 \* wavelength\) longer than time span/)
  assert.match(measPass([...RC, '.ac dec 10 1 1k', '.four 1k v(out)'])!, /Error: no such plot named tran1/)
  assert.deepEqual(parseFour(short), [])
  // stderr may come through first; a failure with no section at all still shows
  assert.equal(measSection('Error: bad fundamental freq f0\nCircuit: x\nFourier analysis (.four):\nngspice-47 done\n'), 'Fourier analysis (.four):\nError: bad fundamental freq f0')
  assert.equal(measSection('Note: x\nError: no such plot named tran1\n'), 'Error: no such plot named tran1')
})

test('one-point AC .sens is a magnitude/phase table, not a DC one (skipped if ngspice missing)', (t) => {
  const r = sim([...RC, '.sens v(out) ac lin 1 100 100'])
  if (!r) return void t.skip('ngspice not on PATH')
  const [{ plot }] = plotRuns('', r.plots[0], '')
  assert.equal(tableKind(plot), 'sens')
  const rows = sensRows(plot)
  assert.ok(!rows.some((x) => x.name === 'frequency') && rows.every((x) => x.phase != null && x.value > 0), JSON.stringify(rows))
  near(rows.find((x) => x.name === 'v1_acmag')!.value, 1 / Math.hypot(1, 2 * Math.PI * 100e-3)) // |H(100 Hz)| of the RC
  const dc = sim([...RC, '.sens v(out)'])!
  assert.ok(sensRows(plotRuns('', dc.plots[0], '')[0].plot).every((x) => x.phase == null))
})

test('nested .dc: trailing comments, and two lines each labelled from their own (skipped if ngspice missing)', (t) => {
  const net = ['V1 d 0 0', 'V2 g 0 0', 'I1 0 g 0', 'R1 d s 100', 'R2 g s 1k', 'R3 s 0 100', '.dc V1 0 1 0.5 V2 0 2 1 ; family', '.dc V2 0 1 1 I1 0 2m 1m']
  const r = sim(net)
  if (!r) return void t.skip('ngspice not on PATH')
  const labels = r.plots.map((p) => plotRuns('', p, net.join('\n')).map((x) => x.label))
  // ngspice writes the two plots in reverse deck order
  assert.deepEqual(labels, [['I1=0', 'I1=1m', 'I1=2m'], ['V2=0', 'V2=1', 'V2=2']])
})

test('the .meas pass with + continuation lines and quoted expressions (skipped if ngspice missing)', (t) => {
  const vmax = (lines: string[]) => {
    const sec = measPass([...RC, ...lines, '.meas tran vmax MAX v(out)'])
    return sec == null ? null : (parseMeas(sec).find((x) => x.name === 'vmax')?.value ?? NaN)
  }
  const want = 1 - Math.exp(-20)
  const cont = vmax(['.tran 10u', '+ 40m']) // a measured line continued: the command needs the whole line
  if (cont === null) return void t.skip('ngspice not on PATH')
  near(cont, want, 1e-2)
  near(vmax(['.tran 10u 40m', '.ac dec 10', '+ 1 1k'])!, want, 1e-2) // an unmeasured one: commented out whole
  near(vmax(['.param ts=40m', ".tran 10u 'ts'"])!, want, 1e-2) // quoted expression: `run` fallback
  near(vmax(['.param ts=40m', '.tran 10u {ts}', '.tf v(out) V1'])!, want, 1e-2)
  const sec = measPass([...RC, '.tran 10u 40m', '.four 25', '+ v(out)'])!
  assert.deepEqual(parseFour(sec).map((f) => [f.vector, f.rows.length]), [['v(out)', 10]])
})

test('nested .dc: lines the numbers cannot tell apart go by ngspice\'s reverse order; + continuation (skipped if ngspice missing)', (t) => {
  const net = ['V1 d 0 0', 'V2 g 0 0', 'I1 0 g 0', 'R1 d s 100', 'R2 g s 1k', 'R3 s 0 100', '.dc V1 0 0.5 0.25', '.dc V1 0 1 0.25 V2 0 2 1', '.dc V1 0 1 0.25', '+ I1 0 2m 1m']
  const r = sim(net)
  if (!r) return void t.skip('ngspice not on PATH')
  const labels = r.plots.map((p, i) => plotRuns('', p, net.join('\n'), i + 1).map((x) => x.label))
  assert.deepEqual(labels, [['I1=0', 'I1=1m', 'I1=2m'], ['V2=0', 'V2=1', 'V2=2'], ['']])
})

test('the .meas pass reads + lines past comments and blank lines, as ngspice does (skipped if ngspice missing)', (t) => {
  // each variant must measure the same circuit as its one-line reference
  const vmax = (lines: string[]) => {
    const sec = measPass([...lines, '.meas tran vmax MAX v(out)'])
    return sec == null ? null : (parseMeas(sec).find((x) => x.name === 'vmax')?.value ?? NaN)
  }
  const diode = (model: string[]) => vmax(['V1 in 0 SIN(0 2 1k)', 'R1 in out 1k', 'D1 out 0 dd', ...model, '.tran 10u 5m'])
  const ref = diode(['.model dd D(is=1e-14 n=2 rs=500)'])
  if (ref === null) return void t.skip('ngspice not on PATH')
  near(ref, 1.51507, 1e-4)
  near(diode(['.model dd D(is=1e-14 ; saturation current', '+ n=2 ; emission', '+ rs=500)'])!, ref, 1e-6)
  near(diode(['.model dd D(is=1e-14', '* emission and series R', '+ n=2 rs=500)'])!, ref, 1e-6)
  const rc = (r: string[], tran: string[]) => vmax(['V1 in 0 PULSE(0 1 0 1u 1u 5m 10m)', ...r, 'C1 out 0 1u', ...tran])
  const rcRef = rc(['R1 in out 1k'], ['.tran 10u 40m'])!
  near(rcRef, 0.993311, 1e-5)
  near(rc(['R1 in out', '* note', '+ 1k'], ['.tran 10u 40m'])!, rcRef, 1e-6)
  near(rc(['R1 in out ; the resistor', '+ 1k'], ['.tran 10u 40m'])!, rcRef, 1e-6)
  near(rc(['R1 in out 1k'], ['.tran 10u', '* note', '+ 40m'])!, rcRef, 1e-6)
  near(rc(['R1 in out 1k'], ['.tran 10u', '', '+ 40m'])!, rcRef, 1e-6)
  near(rc(['R1 in out 1k'], ['.tran 10u $ step', '+ 40m'])!, rcRef, 1e-6)
})

test('measDeck leaves the deck as it was, apart from commenting out unmeasured analyses and adding .control', () => {
  const lines = ['* deck', 'V1 in 0 SIN(0 1 1k) ; src', 'R1 in out', '* note', '+ 1k', 'C1 out 0 1u', '', '.ac dec 10', '* between', '', '+ 1 1k',
    '.tf v(out) V1 $ gain', '.tran 10u', '+ 5m ; stop', '.op', '.meas tran vmax MAX v(out)', '.four 1k', '+ v(out)', '.end', '']
  const md = measDeck(lines.join('\n'))!.split('\n'), off = new Set([7, 10, 11, 14]) // .ac and its + line, .tf, .op
  const i = md.indexOf('.control'), ctl = md.slice(i, md.indexOf('.endc') + 1)
  assert.deepEqual([...md.slice(0, i), ...md.slice(i + ctl.length)], lines.map((l, k) => (off.has(k) ? '*' + l : l)))
  assert.deepEqual(ctl, ['.control', 'tran 10u 5m', 'echo Fourier analysis (.four):', 'setplot tran1', 'fourier 1k v(out)', 'quit', '.endc'])
})

test('erc: .sp port sources (portnum) are not ideal voltage sources', async () => {
  const { erc } = await import('../src/renderer/src/sim/erc.ts')
  const deck = '* sp\nV1 in 0 dc 0 ac 1 portnum 1 z0 50\nL1 in out 100n\nC1 out 0 40p\nV2 out 0 dc 0 ac 0 PORTNUM 2 z0 50\n.end\n'
  assert.deepEqual(erc(deck).errors, [])
  assert.equal(erc(deck.replace(/portnum/gi, 'x')).errors.length, 1) // plain sources: V1, L1, V2 short each other
})
