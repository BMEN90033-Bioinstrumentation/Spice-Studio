import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atCorner, eng, expandSweep, MAX_WC, parseSteps, tolerances } from '../src/renderer/src/sim/sweep.ts'
import { measDeck, parseMeas } from '../src/renderer/src/sim/meas.ts'

const values = (line: string) => {
  const r = parseSteps(line)
  assert.deepEqual(r.errors, [], line)
  return r.steps[0].values
}

test('parseSteps: linear, list, dec, oct without float drift', () => {
  assert.deepEqual(values('.step param R 1k 5k 1k'), [1000, 2000, 3000, 4000, 5000])
  assert.deepEqual(values('.STEP PARAM x 0 1 0.1'), [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
  assert.deepEqual(values('.step param x 0 0.3 0.1'), [0, 0.1, 0.2, 0.3])
  assert.deepEqual(values('.step param x 0 1 0.3'), [0, 0.3, 0.6, 0.9]) // stop not on grid: not included
  assert.deepEqual(values('.step param x 5 1 -2'), [5, 3, 1])
  assert.deepEqual(values('.step lin param x 1 2 0.5'), [1, 1.5, 2])
  assert.deepEqual(values('.step param C list 1n 10n 4.7u'), [1e-9, 1e-8, 4.7e-6])
  assert.deepEqual(values('.step dec param f 1 1k 1'), [1, 10, 100, 1000])
  assert.deepEqual(values('.step oct param f 1 8 2'), [1, Math.SQRT2, 2, 2.82842712475, 4, 5.65685424949, 8].map((v) => Number(v.toPrecision(12))))
  assert.deepEqual(parseSteps('R1 a b 1k\n.tran 1u 1m').steps, [])
})

test('parseSteps errors', () => {
  const err = (s: string) => parseSteps(s).errors.join('\n')
  assert.match(err('.step V1 0 5 1'), /only "\.step param/)
  assert.match(err('.step param R 1k 2k 0'), /increment/)
  assert.match(err('.step param R 1k 2k -1'), /increment/)
  assert.match(err('.step param R 1k 2k'), /start stop increment/)
  assert.match(err('.step param R list 1k abc'), /list needs numbers/)
  assert.match(err('.step dec param R 0 1k 10'), /dec needs/)
  assert.match(err('.step param R 1 1000 1'), /1000 values \(max 50\)/)
  assert.match(err('.step param R 1 2 1\n.step param r list 1'), /already stepped/)
  assert.match(err('.step param a list 1\n.step param b list 1\n.step param c list 1\n.step param d list 1'), /At most 3/)
})

test('eng labels', () => {
  assert.deepEqual([1000, 4.7e-6, 1e6, 0.1, 0, -2200, 1e-9, 0.3 * 3, 25e12].map(eng), ['1k', '4.7u', '1meg', '100m', '0', '-2.2k', '1n', '900m', '25t'])
})

const DECK = `* sweep
.param R=1k Rb={R*2}, C = 1u
V1 in 0 DC 1
R1 in out {R}
R2 out 0 {Rb}
.op
.end
`

test('expandSweep: replaces params in place (multi-assignment lines), inserts missing ones, labels', () => {
  const { runs, errors } = expandSweep(DECK.replace('.op', '.step param R list 1k 2k\n.step param G 1 2 1\n.op'))
  assert.deepEqual(errors, [])
  assert.deepEqual(runs.map((r) => r.label), ['R=1k, G=1', 'R=1k, G=2', 'R=2k, G=1', 'R=2k, G=2'])
  assert.equal(runs[3].netlist, `* sweep
.param R=2000 Rb={R*2}, C = 1u
V1 in 0 DC 1
R1 in out {R}
R2 out 0 {Rb}
.op
.param G=2
.end
`)
  assert.deepEqual(expandSweep(DECK), { runs: [{ label: '', netlist: DECK }], errors: [] })
  // case-insensitive, whole name: stepping "c" must not touch "Rb"/"R" but must hit "C = 1u"
  assert.match(expandSweep(DECK + '.step param c list 5n').runs[0].netlist, /^\.param R=1k Rb=\{R\*2\}, C = 5e-9$/m)
  assert.match(expandSweep('.step param x 1 100 1').errors.join(), /max 50/)
  assert.match(expandSweep('.step param a 1 10 1\n.step param b 1 10 1').errors.join(), /100 runs \(max 50\)/)
})

test('expandSweep runs through ngspice: each run sees its own value (skipped if ngspice missing)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'swtest-'))
  const { runs } = expandSweep(DECK.replace('.op', '.step param R 1k 3k 1k\n.op'))
  const cur: number[] = []
  for (const r of runs) {
    writeFileSync(join(dir, 'c.cir'), r.netlist)
    const p = spawnSync('ngspice', ['-b', join(dir, 'c.cir')], { encoding: 'utf8' })
    if (p.error) return void t.skip('ngspice not on PATH')
    assert.equal(p.status, 0, p.stderr)
    cur.push(-Number(/v1#branch\s+(\S+)/.exec(p.stdout)![1]))
  }
  // I = 1 / (R + 2R)
  cur.forEach((i, k) => assert.ok(Math.abs(i - 1 / (3 * 1000 * (k + 1))) < 1e-9, `${runs[k].label}: ${i}`))
})

// I(V1) through a resistor with tc1=0.01: 1 V / (1k * (1 + 0.01 * (T - 27)))
const TDECK = '* temp\nV1 1 0 1\nR1 1 0 1k tc1=0.01\n.temp 50\n.op\n.end\n'
const ngspiceI = (t: { skip: (s: string) => void }, deck: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'swtest-'))
  writeFileSync(join(dir, 'c.cir'), deck)
  const p = spawnSync('ngspice', ['-b', '-n', join(dir, 'c.cir')], { encoding: 'utf8' })
  if (p.error) return t.skip('ngspice not on PATH'), null
  assert.equal(p.status, 0, p.stdout + p.stderr)
  return -Number(/v1#branch\s+(\S+)/.exec(p.stdout)![1])
}

test('.step temp: list/lin/dec forms, T= labels, replaces .temp, runs at that temperature in ngspice', (t) => {
  assert.deepEqual(values('.step temp list -40 25 85'), [-40, 25, 85])
  assert.deepEqual(values('.step temp 0 50 25'), [0, 25, 50])
  assert.deepEqual(values('.step dec temp 1 100 1'), [1, 10, 100])
  assert.match(parseSteps('.step temp 1 2').errors.join(), /start stop increment/)
  const { runs, errors } = expandSweep(TDECK.replace('.op', '.step temp list 27 77\n.step param x list 1\n.op'))
  assert.deepEqual(errors, [])
  assert.deepEqual(runs.map((r) => r.label), ['T=27, x=1', 'T=77, x=1'])
  assert.equal(runs[1].netlist, '* temp\nV1 1 0 1\nR1 1 0 1k tc1=0.01\n.op\n.temp 77\n.param x=1\n.end\n')
  for (const [k, T] of [27, 77].entries()) {
    const i = ngspiceI(t, runs[k].netlist)
    if (i === null) return
    assert.ok(Math.abs(i - 1 / (1000 * (1 + 0.01 * (T - 27)))) < 1e-9, `T=${T}: ${i}`)
  }
})

const MCDECK = '* mc\nV1 1 0 1\nR1 1 0 {agauss(1k, 100, 1)}\n.mc 3\n.op\n.end\n'
test('.mc N: N seeded runs, labels, errors', () => {
  const { runs, errors } = expandSweep(MCDECK)
  assert.deepEqual(errors, [])
  assert.deepEqual(runs.map((r) => r.label), ['run 1', 'run 2', 'run 3'])
  assert.equal(runs[1].netlist, '* mc\n.options seed=2\nV1 1 0 1\nR1 1 0 {agauss(1k, 100, 1)}\n.op\n.end\n')
  assert.equal(expandSweep(MCDECK.replace('.mc 3', '.mc 500')).runs.length, 500)
  const err = (d: string) => expandSweep(d).errors.join()
  assert.match(err(MCDECK.replace('.mc 3', '.mc 501')), /1 to 500/)
  assert.match(err(MCDECK.replace('.mc 3', '.mc')), /expected "\.mc N"/)
  assert.match(err(MCDECK.replace('.mc 3', '.mc 2.5')), /expected/)
  assert.match(err(MCDECK + '.mc 2\n'), /Only one/)
  assert.match(err(MCDECK.replace('.op', '.step param x list 1 2\n.op')), /cannot be combined with \.step/)
})

test('.mc through ngspice: draws differ between runs and repeat exactly (skipped if ngspice missing)', (t) => {
  const { runs } = expandSweep(MCDECK)
  const a: number[] = []
  for (const r of runs) {
    const i = ngspiceI(t, r.netlist)
    if (i === null) return
    a.push(i)
  }
  assert.equal(new Set(a).size, 3, `distinct draws: ${a}`)
  a.forEach((i) => assert.ok(i > 1 / 1500 && i < 1 / 500, `plausible agauss(1k, 100, 1) draw: ${1 / i}`))
  assert.equal(ngspiceI(t, runs[1].netlist), a[1]) // same seed, same draw
})

// I(V1) = 1/(R + R2) with R = 1k ±10 % (gauss, relative), R2 = 1k ±100 Ω (aunif, absolute)
const WCDECK = '* wc\nV1 1 0 1\n.param R={gauss(1k, 0.1, 3)}\nR1 1 2 {R}\nR2 2 0 {aunif(1k, 100)}\n.wc\n.op\n.end\n'
test('.wc: tolerances found and named, nominal + 2^n corners as ngspice expressions, errors', () => {
  const tols = tolerances(['.param R={gauss(1k, 0.1, 3)} C = {2*unif(1u,0.05)}', 'R1 a b {agauss(1k,50,3)}', '* R9 a b {gauss(1,1,1)}', '.model QN NPN(BF={limit(100, 20)} IS=1f)'])
  assert.deepEqual(tols.map((t) => [t.name, t.nom, t.dev, t.rel]), [['R', '1k', '0.1', true], ['C', '1u', '0.05', true], ['R1', '1k', '50', false], ['QN.BF', '100', '20', false]])
  const L = ['.param A={agauss(1k,50,3)} B={gauss(1,f(2),3)} ; C={gauss(9,9,9)}']
  assert.deepEqual(atCorner(L, tolerances(L), [-1, 1]), ['.param A={((1k)-(50))} B={((1)*(1+(f(2))))} ; C={gauss(9,9,9)}'])
  const { runs, errors, note } = expandSweep(WCDECK)
  assert.deepEqual(errors, [])
  assert.deepEqual(runs.map((r) => r.label), ['nominal', 'R− R2−', 'R+ R2−', 'R− R2+', 'R+ R2+'])
  assert.equal(runs[2].netlist, '* wc\nV1 1 0 1\n.param R={((1k)*(1+(0.1)))}\nR1 1 2 {R}\nR2 2 0 {((1k)-(100))}\n.op\n.end\n')
  assert.match(note!, /2 toleranced values \(R, R2\).*all 4 corners/)
  const err = (d: string) => expandSweep(d).errors.join()
  assert.match(err('* x\nR1 1 0 1k\n.wc\n.op\n'), /no toleranced values/)
  assert.match(err(WCDECK + '.wc\n'), /Only one/)
  assert.match(err(WCDECK.replace('.op', '.step param x list 1 2\n.op')), /cannot be combined with \.step/)
  assert.match(err(WCDECK.replace('.op', '.mc 5\n.op')), /cannot be combined/)
})

test('.wc corners through ngspice: extremes of I(V1) at the R−R2− and R+R2+ corners (skipped if ngspice missing)', (t) => {
  const i: number[] = []
  for (const r of expandSweep(WCDECK).runs) {
    const v = ngspiceI(t, r.netlist)
    if (v === null) return
    i.push(v)
  }
  const near = (a: number, b: number) => assert.ok(Math.abs(a / b - 1) < 1e-5, `${a} vs ${b}`) // ngspice prints 6 digits
  near(i[0], 1 / 2000), near(i[1], 1 / (900 + 900)), near(i[4], 1 / (1100 + 1100)), near(i[2], 1 / (1100 + 900))
})

test('.wc above MAX_WC: sensitivity fallback picks each measurement\'s max/min corner from the earlier runs', () => {
  // 9 resistors in series, R5 in reverse sense via a negative nominal-free expression: I = 1/ΣR falls as any R rises
  const rs = Array.from({ length: 9 }, (_, k) => `R${k + 1} n${k} n${k + 1} {gauss(1k, 0.1, 3)}`)
  const deck = ['* big', 'V1 n0 0 1', ...rs, 'R0 n9 0 1', '.wc', '.op', '.meas op i1 find i(v1)', '.end'].join('\n')
  const sw = expandSweep(deck)
  assert.deepEqual(sw.errors, [])
  assert.equal(MAX_WC, 8)
  assert.equal(sw.runs.length, 1 + 9 + 2)
  assert.match(sw.note!, /9 toleranced values .* 512 corners .* i1/)
  // fake .meas logs: i(v1) is negative (current into +), so it rises as R rises
  const meas = (v: number) => `Measurements for Operating Point Analysis\n\ni1                  =  ${v}\n`
  sw.observe!(meas(-1 / 9001))
  for (let j = 0; j < 9; j++) sw.observe!(meas(-1 / (9001 + 100)))
  assert.equal(sw.runs[10].label, 'max i1: R1+ R2+ R3+ R4+ R5+ R6+ R7+ R8+ R9+')
  assert.equal(sw.runs[11].label, 'min i1: R1− R2− R3− R4− R5− R6− R7− R8− R9−')
  assert.match(sw.runs[10].netlist, /^R1 n0 n1 \{\(\(1k\)\*\(1\+\(0\.1\)\)\)\}$/m)
  assert.match(expandSweep(deck.replace('.meas op i1 find i(v1)\n', '')).errors.join(), /512 corners .* Add a \.meas line/)
})

test('tolerances: comments, continuation lines, B-source functions, sgauss/sunif', () => {
  const t = tolerances([
    'R1 a b {gauss(1k,0.05,3)} ; was {gauss(2k,0.1,3)}', // after ; : a comment
    'R2 a b {unif(1k,0.1)} $ old {unif(1,1)}',
    '.param A=1',
    '+ B={aunif(5,1)}', // continues the .param line: named B
    'C1 a b',
    '+ {agauss(1n,0.1n,3)}', // continues C1
    'B1 out 0 V=limit(v(in), 0, 5)', // the B-source's own limit(), not a tolerance
    'B2 out 0 V={limit(1,0.1)}*v(in)', // braced, two arguments: a tolerance
    "R3 a b 'gauss(2k,0.1,3)'", // single quotes work like braces in ngspice
    '.param T={1k*(1+0.05*sgauss(0))} U={sunif(0)}'
  ])
  assert.deepEqual(t.map((x) => [x.name, x.nom, x.dev, x.rel]), [['R1', '1k', '0.05', true], ['R2', '1k', '0.1', true], ['B', '5', '1', false], ['C1', '1n', '0.1n', false], ['B2', '1', '0.1', false], ['R3', '2k', '0.1', true], ['T', '0', '3', false], ['U', '0', '1', false]])
  assert.deepEqual(atCorner(['.param T={1k*(1+0.05*sgauss(0))}'], tolerances(['.param T={1k*(1+0.05*sgauss(0))}']), [1]), ['.param T={1k*(1+0.05*((0)+(3)))}'])
  assert.equal(expandSweep('* x\nR1 1 0 {gauss(1k,0.05,3)} ; {gauss(1,1,1)}\n.wc\n.op\n.end\n').runs.length, 3) // nominal + 2 corners, not 4
  assert.equal(expandSweep("* x\nR1 1 0 'gauss(1k,0.05,3)'\n.wc\n.op\n.end\n").runs[2].netlist, "* x\nR1 1 0 '((1k)*(1+(0.05)))'\n.op\n.end\n")
})

test('.wc fallback: unknown measurement names are an error; a measurement without values skips its corners', () => {
  const rs = Array.from({ length: 9 }, (_, k) => `R${k + 1} n${k} n${k + 1} {gauss(1k, 0.1, 3)}`)
  const deck = (wc: string) => ['* big', 'V1 n0 0 1', ...rs, 'R0 n9 0 1', wc, '.op', '.meas op vo find v(n9)', '.end'].join('\n')
  assert.match(expandSweep(deck('.wc vo nosuch')).errors.join(), /\.wc nosuch: no \.meas line named nosuch \(the deck measures vo\)/)
  const sw = expandSweep(deck('.wc vo'))
  for (let k = 0; k < 10; k++) sw.observe!('no measurements printed\n') // e.g. a .meas op, which this app's batch run never prints
  assert.match(sw.runs[10].label, /^max vo: skipped, vo has no value/)
  assert.deepEqual([sw.runs[10].skip, sw.runs[11].skip, sw.runs[0].skip], [true, true, undefined])
})

test('.wc fallback through ngspice: picked corners give the extreme measurements (skipped if ngspice missing)', (t) => {
  // divider: R1..R5 on top lower vo, R6..R9 below raise it
  const rs = Array.from({ length: 9 }, (_, k) => `R${k + 1} n${k} n${k + 1} {gauss(1k, 0.1, 3)}`).map((l, k) => (k === 4 ? l.replace('n5 {', 'mid {') : k === 5 ? l.replace('R6 n5', 'R6 mid') : l))
  const deck = ['* divider', 'V1 n0 0 DC 1', ...rs, 'R0 n9 0 1m', '.wc', '.tran 1u 10u', '.meas tran vo find v(mid) at=5u', '.end', ''].join('\n')
  const sw = expandSweep(deck), vo: number[] = []
  assert.deepEqual(sw.errors, [])
  const dir = mkdtempSync(join(tmpdir(), 'swtest-'))
  for (const r of sw.runs) {
    writeFileSync(join(dir, 'c.cir'), measDeck(r.netlist)!)
    const p = spawnSync('ngspice', ['-b', '-n', join(dir, 'c.cir')], { encoding: 'utf8' })
    if (p.error) return void t.skip('ngspice not on PATH')
    sw.observe!(p.stdout)
    vo.push(parseMeas(p.stdout).find((m) => m.name === 'vo')!.value!)
  }
  assert.equal(sw.runs[10].label, 'max vo: R1− R2− R3− R4− R5− R6+ R7+ R8+ R9+')
  assert.equal(sw.runs[11].label, 'min vo: R1+ R2+ R3+ R4+ R5+ R6− R7− R8− R9−')
  assert.equal(Math.max(...vo), vo[10]), assert.equal(Math.min(...vo), vo[11])
  assert.ok(Math.abs(vo[10] - (4 * 1100) / (5 * 900 + 4 * 1100)) < 1e-5, String(vo[10])) // R0 (1 mΩ) neglected
})

test('a single-quoted tolerance corner runs in ngspice (skipped if ngspice missing)', (t) => {
  const r = expandSweep("* q\nV1 1 0 1\nR1 1 0 'gauss(1k,0.1,3)'\n.wc\n.op\n.end\n").runs
  const i = ngspiceI(t, r[2].netlist) // R1+
  if (i === null) return
  assert.ok(Math.abs(i * 1100 - 1) < 1e-5, String(i))
})
