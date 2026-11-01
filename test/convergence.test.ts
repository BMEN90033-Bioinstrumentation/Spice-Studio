import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diagnose } from '../src/renderer/src/sim/convergence.ts'

// Circuits that provoke each failure in ngspice-47, with the log lines it printed (`ngspice -b -r o.raw c.cir`)
const FLOATING = ['* floating subcircuit', 'V1 a 0 1', 'R1 a 0 1k', 'R2 b c 1k', '.op']
const FLOATING_LOG = `Warning: singular matrix:  check node b
Note: Starting dynamic gmin stepping
Warning: singular matrix:  check node b
Warning: Dynamic gmin stepping failed
Note: Starting true gmin stepping
Warning: True gmin stepping failed
Note: Starting source stepping
Warning: source stepping failed
Note: Transient op started
Note: Transient op finished successfully`

const KICK = ['* inductive kick, ideal diode + switch', 'Vdd vdd 0 10', 'Vg g 0 PULSE(0 5 1m 1n 1n 1m 2m)', 'L1 vdd a 10m', 'S1 a 0 g 0 smod',
  'D1 a vdd dmod', '.model dmod D(IS=1e-15 CJO=0 RS=0)', '.model smod sw(vt=2.5 vh=0 ron=1m roff=1e12)', '.tran 1u 5m']
const KICK_LOG = `doAnalyses: TRAN:  Timestep too small; time = 0.002, timestep = 1.25e-18: trouble with dmod-instance d1
run simulation(s) aborted`

const STEEP = ['* offset exponential B-source', 'V1 a 0 1', 'R1 a b 1', 'B1 b 0 I = 1e-12*exp((v(b)+1)/0.001)', '.op']
const STEEP_LOG = FLOATING_LOG.split('\n').filter((l) => !l.includes('singular')).join('\n')

// nonphysical (1 kV across two N=0.1 diodes): nothing rescues it, but the log is the full OP failure
const DEAD_LOG = `Warning: Dynamic gmin stepping failed
Warning: True gmin stepping failed
Warning: source stepping failed
Note: Transient op started
Error: Transient op failed, timestep too small
Error: The operating point could not be simulated successfully.
    Any of the following steps may fail.!
doAnalyses: OP:  Timestep too small; trouble with dmod-instance d1
run simulation(s) aborted
DC solution failed -`
const DEAD_TRAN_LOG = `Error: Transient op failed, timestep too small
Error: The operating point could not be simulated successfully.
    Any of the following steps may fail.!
Error: Finding the operating point for transient simulation failed
doAnalyses: TRAN:  Timestep too small; initial timepoint: trouble with dmod-instance d1`

// V1 a 0 1 / V2 a 0 2: sources in parallel
const LOOP_LOG = `Warning: singular matrix:  check node v1#branch
Warning: source stepping failed
Error: Transient op failed, timestep too small
Error: The operating point could not be simulated successfully.
doAnalyses: OP:  Timestep too small; cause unrecorded.`

test('diagnose recognises each captured ngspice-47 failure', () => {
  const sing = diagnose(FLOATING_LOG)
  assert.match(sing[0].problem, /Singular matrix at node b/)
  assert.deepEqual(sing[0].fixes.map((f) => f.options), ['rshunt=1e12'])
  assert.match(sing[1].problem, /needed ngspice's fallbacks/) // gmin/source stepping warnings, rescued by transient op

  const ts = diagnose(KICK_LOG)
  assert.equal(ts.length, 1)
  assert.match(ts[0].problem, /timestep too small at t = 0\.002 s \(trouble with D1\)/)
  assert.deepEqual(ts[0].fixes.map((f) => f.options), ['cshunt=1e-12', 'method=gear', 'reltol=3e-3 itl4=100'])

  for (const log of [DEAD_LOG, DEAD_TRAN_LOG, 'Warning: iteration limit reached']) {
    const d = diagnose(log)
    assert.equal(d.length, 1, log)
    assert.match(d[0].problem, /No convergence in the DC operating point/)
    assert.ok(d[0].fixes.length >= 1 && d[0].fixes.length <= 3)
  }
  assert.match(diagnose(DEAD_LOG)[0].problem, /trouble with D1/)
  assert.match(diagnose(DEAD_TRAN_LOG)[0].problem, /trouble with D1/)

  const loop = diagnose(LOOP_LOG)
  assert.match(loop[0].problem, /at V1: voltage sources or inductors form a loop/)
  assert.deepEqual(loop[0].fixes, [])
  assert.match(loop[1].problem, /No convergence/)

  assert.deepEqual(diagnose('No. of Data Rows : 531\nNote: Simulation executed from .control section'), [])
  for (const d of [...sing, ...ts, ...diagnose(DEAD_LOG)]) for (const f of d.fixes) assert.match(f.options, /^(\w+=\S+ ?)+$/)
})

// each suggested fix rescues the circuit that provoked it (skipped if ngspice missing)
test('suggested .options rescue the provoking circuits', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'convtest-'))
  const run = (deck: string[], opts = '') => {
    writeFileSync(join(dir, 'c.cir'), [...deck, ...(opts ? ['.options ' + opts] : []), '.end', ''].join('\n'))
    const r = spawnSync('ngspice', ['-b', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { encoding: 'utf8' })
    return r.error ? null : { ok: r.status === 0, log: r.stdout + r.stderr }
  }
  const base = run(FLOATING)
  if (!base) return void t.skip('ngspice not on PATH')
  assert.match(base.log, /singular matrix:\s+check node b/)
  assert.equal(diagnose(run(FLOATING, 'rshunt=1e12')!.log).length, 0)

  const kick = run(KICK)!
  assert.ok(!kick.ok && /Timestep too small; time = /.test(kick.log))
  const fix = diagnose(kick.log)[0].fixes[0].options
  const rescued = run(KICK, fix)!
  assert.ok(rescued.ok && diagnose(rescued.log).length === 0, fix)

  assert.match(run(STEEP)!.log, /source stepping failed/)
  for (const f of diagnose(STEEP_LOG)[0].fixes.slice(0, 2)) assert.equal(diagnose(run(STEEP, f.options)!.log).length, 0, f.options)
})
