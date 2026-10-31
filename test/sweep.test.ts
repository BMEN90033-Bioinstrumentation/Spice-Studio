import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eng, expandSweep, parseSteps } from '../src/renderer/src/sim/sweep.ts'

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
