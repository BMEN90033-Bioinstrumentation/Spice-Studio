import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { measDeck, measSection, parseMeas } from '../src/renderer/src/sim/meas.ts'

// real ngspice-47 -b stdout of measDeck() decks (DRAM lines trimmed)
const TRAN = `
Note: No compatibility mode selected!


Circuit: * meas tran fixture

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

Initial Transient Solution
--------------------------

Node                                   Voltage
----                                   -------
in                                           0
out                                          0
v1#branch                                    0


No. of Data Rows : 2053

  Measurements for Transient Analysis


Error: measure  bad  trig(TRIG) : out of interval
 .meas tran bad trig v(in) val=5 rise=1 targ v(out) val=0.5 rise=1 failed!


Error: measure  nowhen  find(AT) : out of interval
 .meas tran nowhen find v(out) when v(in)=7 failed!

tdelay              =  6.93148e-04 targ=  6.93648e-04 trig=  5.00000e-07
vfind               =  9.93124e-01
vavg                =  4.99429e-01 from=  0.00000e+00 to=  1.00001e-02
vmax                =  9.93311e-01 at=  1.50010e-02
vmin                =  6.70233e-03 at=  1.00000e-02
vpp                 =  9.93311e-01 from=  0.00000e+00 to=  0.00000e+00
vrms                =   6.33329e-01 from=  0.00000e+00 to=  2.00000e-02
qin                 =   -9.93251e-07 from=  0.00000e+00 to=  5.00000e-03
ratio               =  1.98889e+00
vat                 =  8.64598e-01

ngspice-47 done
`
const AC = `
Note: No compatibility mode selected!


Circuit: * meas ac fixture

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 101

  Measurements for AC Analysis


Error: measure  nope  when(WHEN) : out of interval
 .meas ac nope when vm(out)=1e-9 failed!

fc                  =   1.58778e+02
gmax                =  -1.71449e-04 at=  1.00000e+00
ph1k                =  -1.41297e+00

ngspice-47 done
`

test('parseMeas: tran fixture (trig/targ, find/when, avg/max/min/pp/rms/integ, param, at, failures)', () => {
  const m = parseMeas(TRAN)
  assert.deepEqual(m.map((x) => [x.name, x.value]), [
    ['bad', null], ['nowhen', null], ['tdelay', 6.93148e-4], ['vfind', 9.93124e-1], ['vavg', 4.99429e-1], ['vmax', 9.93311e-1],
    ['vmin', 6.70233e-3], ['vpp', 9.93311e-1], ['vrms', 6.33329e-1], ['qin', -9.93251e-7], ['ratio', 1.98889], ['vat', 8.64598e-1]
  ])
  assert.equal(m[2].text, 'tdelay = 6.93148e-04 targ= 6.93648e-04 trig= 5.00000e-07')
  assert.equal(m[0].text, 'Error: measure  bad  trig(TRIG) : out of interval')
})

test('parseMeas: ac fixture; nothing outside a Measurements block; empty log', () => {
  assert.deepEqual(parseMeas(AC).map((x) => [x.name, x.value]), [['nope', null], ['fc', 158.778], ['gmax', -1.71449e-4], ['ph1k', -1.41297]])
  assert.deepEqual(parseMeas('Node  Voltage\nin = 1\nTotal analysis time (seconds) = 0.01\n'), [])
  assert.deepEqual(parseMeas(''), [])
  // a later block (another run section) is read too
  assert.deepEqual(parseMeas(AC + '--- run x ---\n  Measurements for AC Analysis\nfc = 2e3\n').map((x) => x.name), ['nope', 'fc', 'gmax', 'ph1k'])
})

test('measDeck / measSection', () => {
  assert.equal(measDeck('* t\nR1 a 0 1\n.op\n.end\n'), null)
  assert.equal(measDeck('* t\n.meas tran x MAX v(a)\n.control\nrun\n.endc\n.end\n'), null)
  assert.equal(measDeck('* t\n.meas tran x MAX v(a)\n.end\n'), '* t\n.meas tran x MAX v(a)\n.control\nrun\nquit\n.endc\n.end\n')
  assert.equal(measDeck('* t\n.MEASURE tran x MAX v(a)'), '* t\n.MEASURE tran x MAX v(a)\n.control\nrun\nquit\n.endc\n')
  assert.match(measSection(AC), /^Measurements for AC Analysis[\s\S]*ph1k += +-1\.41297e\+00$/)
  assert.equal(measSection('no measurements'), '')
})

test('measDeck through ngspice: .meas values come out (skipped if ngspice missing)', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'meas-')), f = join(d, 'c.cir')
  writeFileSync(f, measDeck('* rc\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 20 1 100k\n.meas ac fc WHEN vdb(out)=-3 FALL=1\n.end\n')!)
  const p = spawnSync('ngspice', ['-b', '-n', f], { encoding: 'utf8' })
  if (p.error) return void t.skip('ngspice not on PATH')
  assert.equal(p.status, 0, p.stdout)
  const [fc] = parseMeas(measSection(p.stdout))
  assert.equal(fc.name, 'fc')
  assert.ok(Math.abs(fc.value! - 1 / (2 * Math.PI * 1e-3)) < 2, String(fc.value)) // ~159 Hz (log-interpolated)
})
