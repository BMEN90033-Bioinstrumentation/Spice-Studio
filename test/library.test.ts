import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUNDLED, blockPartFields, entriesFromImport, parseLibFile, resolver, suggest, type LibEntry } from '../src/renderer/src/library/library.ts'
import { emptySheet, newPart, pins, uid, type Pt, type Sheet } from '../src/renderer/src/schematic/model.ts'
import type { Kind } from '../src/renderer/src/schematic/symbols.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'
import { parseRaw, type RawPlot } from '../src/main/rawfile.ts'

const lib = (id: string) => BUNDLED.find((e) => e.id === 'std:' + id)!
const text = (id: string) => (lib(id).spice as { text: string }).text

// run ngspice -b -r in a temp dir (extra files written alongside); undefined (test skipped) if ngspice is missing
function sim(t: TestContext, deck: string, files: Record<string, string> = {}): RawPlot[] | undefined {
  const dir = mkdtempSync(join(tmpdir(), 'libtest-'))
  for (const [f, s] of Object.entries({ ...files, 'c.cir': deck })) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    writeFileSync(join(dir, f), s)
  }
  const r = spawnSync('ngspice', ['-b', '-r', 'o.raw', 'c.cir'], { cwd: dir, encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stderr, /error/i)
  return parseRaw(readFileSync(join(dir, 'o.raw')))
}
const vec = (p: RawPlot, n: string) => p.vars.find((x) => x.name.toLowerCase() === n.toLowerCase())?.re ?? assert.fail(`no ${n} in ${p.vars.map((v) => v.name)}`)
const near = (v: number, lo: number, hi: number, what: string) => assert.ok(v >= lo && v <= hi, `${what} = ${v.toPrecision(4)}, want ${lo}…${hi}`)

test('BUNDLED: exactly the contract ids, well-formed', () => {
  assert.deepEqual(BUNDLED.map((e) => e.id), ['R', 'C', 'L', 'POT', 'XTAL', 'XFMR', 'K', 'T', 'V', 'I', 'VCC', 'E', 'G', 'H', 'F', 'BV', 'BI', 'S', 'W', '1N4148', '1N4007', '1N5819', 'BZX84C5V1', 'LED_RED', 'LED_GREEN',
    '1N914', 'BAT54', 'BAT85', '1N5408', '1N5822', 'UF4007', 'BZX55C3V3', 'BZX55C5V6', 'BZX55C12', '1N4728A', '1N4734A', '1N4742A',
    'LED_BLUE', 'LED_WHITE', 'LED_YELLOW',
    '2N3904', '2N3906', '2N2222', 'BC547B', 'BC557B', 'BC337', 'BC327', '2N5551', '2N5401', 'TIP31C', 'TIP32C', 'BD139', 'BD140',
    'MPSA42', 'MPSA92', '2N4401', '2N4403', 'J201', '2N5457', 'BF245A', 'J176',
    '2N7000', 'BS250', 'IRF540N', 'IRF9540N', 'IRLZ44N', 'BSS138', 'BSS84', 'AO3400',
    'OPAMP', 'OA_GENERIC', 'OA_FAST', 'OA_LOWPOWER', 'OA_RRO', 'CMP_OC', 'TL431', '7805',
    'AND2', 'NAND2', 'OR2', 'NOR2', 'XOR2', 'INV', 'BUF', 'DFF'].map((n) => 'std:' + n))
  for (const e of BUNDLED) {
    assert.equal(e.source, 'bundled')
    assert.ok(e.description.length > 5, e.id)
    if (e.spice) assert.ok(e.spice.name === e.value || /^\w+=/.test(e.value), e.id) // subckt name, or its parameter list (POT, XTAL)
    if (e.spice?.type === 'model') assert.deepEqual(parseLibFile(e.spice.text).models.map((m) => m.name), [e.name])
  }
  assert.deepEqual(['R', 'C', 'L', 'V', 'I', 'OPAMP'].map((n) => [lib(n).kind, lib(n).value, lib(n).spice]),
    [['res', '1k', undefined], ['cap', '1u', undefined], ['ind', '1m', undefined], ['vsrc', 'DC 1', undefined], ['isrc', 'DC 1m', undefined], ['opamp', '1e6', undefined]])
  assert.deepEqual(['1N4148', 'BZX84C5V1', 'LED_RED', '2N3906', 'BS250', 'OA_FAST'].map((n) => lib(n).kind), ['diode', 'zener', 'led', 'pnp', 'pmos', 'opamp5'])
  assert.equal(lib('1N4148').params!.TT, '4n')
  assert.deepEqual(['J201', 'J176', 'IRF9540N', 'CMP_OC', 'TL431', '7805'].map((n) => [lib(n).kind, lib(n).category]),
    [['njf', 'JFETs'], ['pjf', 'JFETs'], ['pmos', 'MOSFETs'], ['opamp5', 'Comparators'], ['block', 'References'], ['block', 'Regulators']])
  for (const e of BUNDLED) if (e.spice?.type === 'subckt') {
    const p = parseLibFile(e.spice.text!)
    assert.deepEqual([p.errors, p.subckts.map((s) => [s.name, s.pins])], [[], [[e.name, e.spice.pins]]], e.id)
  }
  assert.deepEqual(blockPartFields(lib('7805')).pins!.map((p) => p.name), ['in', 'gnd', 'out'])
  assert.deepEqual(blockPartFields(lib('TL431')).pins!.map((p) => p.name), ['cathode', 'anode', 'ref'])
})

test('bundled diodes: forward voltages and zener breakdown (skipped if ngspice missing)', (t) => {
  const ds: [string, string, number, number, number][] = [ // id, current, polarity, Vlo, Vhi
    ['1N4148', '10m', 1, 0.6, 0.75], ['1N4007', '1', 1, 0.9, 1.1], ['1N5819', '1', 1, 0.35, 0.45],
    ['BZX84C5V1', '5m', -1, 4.95, 5.25], ['LED_RED', '20m', 1, 1.8, 2.1], ['LED_GREEN', '20m', 1, 2.0, 2.2],
    // phase 8: datasheet typ/max figures (Schottky limits are the datasheet maxima)
    ['1N914', '10m', 1, 0.65, 0.8], ['1N914', '1m', 1, 0.55, 0.68],
    ['BAT54', '0.1m', 1, 0.18, 0.24], ['BAT54', '1m', 1, 0.24, 0.32], ['BAT54', '10m', 1, 0.3, 0.4], ['BAT54', '30m', 1, 0.36, 0.5], ['BAT54', '100m', 1, 0.45, 0.8],
    ['BAT85', '0.1m', 1, 0.18, 0.24], ['BAT85', '1m', 1, 0.24, 0.32], ['BAT85', '10m', 1, 0.3, 0.4], ['BAT85', '30m', 1, 0.36, 0.5], ['BAT85', '100m', 1, 0.45, 0.8],
    ['1N5408', '3', 1, 0.85, 1.0], ['1N5822', '3', 1, 0.42, 0.525], ['1N5822', '9.4', 1, 0.6, 0.95], ['UF4007', '1', 1, 1.2, 1.7],
    ['BZX55C3V3', '5m', -1, 3.1, 3.5], ['BZX55C5V6', '5m', -1, 5.2, 6.0], ['BZX55C12', '5m', -1, 11.4, 12.7],
    ['1N4728A', '76m', -1, 3.135, 3.465], ['1N4734A', '45m', -1, 5.32, 5.88], ['1N4742A', '21m', -1, 11.4, 12.6],
    ['BZX55C5V6', '100m', 1, 0.7, 1.5], ['1N4742A', '200m', 1, 0.7, 1.2], // zener forward drop
    ['LED_BLUE', '20m', 1, 3.0, 3.4], ['LED_WHITE', '20m', 1, 3.0, 3.5], ['LED_YELLOW', '20m', 1, 1.9, 2.2]
  ]
  const deck = ['* diodes', ...ds.flatMap(([id, i, pol], k) => [`I${k} 0 a${k} DC ${i}`, pol > 0 ? `D${k} a${k} 0 ${id}` : `D${k} 0 a${k} ${id}`]),
    ...new Set(ds.map(([id]) => text(id))), '.op', '.end'].join('\n')
  const p = sim(t, deck)?.[0]
  if (!p) return
  ds.forEach(([id, i, , lo, hi], k) => {
    const v = vec(p, `v(a${k})`)[0]
    t.diagnostic(`${id}: ${v.toFixed(3)} V @ ${i}A`)
    near(v, lo, hi, id)
  })
})

test('bundled BJTs: hFE @ ~10 mA and Early voltage (skipped if ngspice missing)', (t) => {
  for (const [id, s] of [['2N3904', 1], ['2N2222', 1], ['2N3906', -1]] as const) {
    // base current set for Ic ≈ 10 mA; Vce swept 2 V -> 10 V
    const p = sim(t, [`* ${id}`, `Vc c 0 DC ${5 * s}`, `Ib ${s > 0 ? '0 b' : 'b 0'} DC 50u`, `Q1 c b 0 ${id}`, text(id), `.dc Vc ${2 * s} ${10 * s} ${8 * s}`, '.end'].join('\n'))?.[0]
    if (!p) return
    const [i1, i2] = [...vec(p, 'i(vc)')].map((i) => Math.abs(i)), va = (i1 * 8) / (i2 - i1) - 2
    t.diagnostic(`${id}: Ic ${(i1 * 1e3).toFixed(2)} mA, hFE ${(i1 / 50e-6).toFixed(0)} @ Vce 2 V; VA ≈ ${va.toFixed(0)} V`)
    near(i1, 5e-3, 15e-3, `${id} Ic`)
    near(i1 / 50e-6, 100, 300, `${id} hFE`)
    near(va, 50, 130, `${id} Early voltage`)
  }
})

test('bundled MOSFETs: threshold @ 1 mA and Rds(on) @ |Vgs| 10 V (skipped if ngspice missing)', (t) => {
  for (const [id, s, rlo, rhi] of [['2N7000', 1, 2, 5], ['BS250', -1, 10, 14]] as const) {
    const p = sim(t, [`* ${id}`, 'Vg g 0 DC 0', `Vd1 d1 0 DC ${0.1 * s}`, `Vd2 d2 0 DC ${5 * s}`, `M1 d1 g 0 0 ${id}`, `M2 d2 g 0 0 ${id}`,
      text(id), `.dc Vg 0 ${10 * s} ${0.01 * s}`, '.end'].join('\n'))?.[0]
    if (!p) return
    const vg = vec(p, 'v(g)'), i1 = vec(p, 'i(vd1)'), i2 = vec(p, 'i(vd2)'), n = vg.length - 1
    const vth = vg[i2.findIndex((i) => Math.abs(i) >= 1e-3)], rds = 0.1 / Math.abs(i1[n])
    t.diagnostic(`${id}: Vth ${vth.toFixed(2)} V @ 1 mA, Rds(on) ${rds.toFixed(2)} Ω`)
    near(vth * s, 1.8, 2.6, `${id} Vth`)
    near(rds, rlo, rhi, `${id} Rds(on)`)
  }
})

test('bundled op-amp macromodels: A0, GBW, closed-loop gain, rail clipping (skipped if ngspice missing)', (t) => {
  for (const [id, gbw] of [['OA_GENERIC', 1e6], ['OA_FAST', 10e6]] as const) {
    const plots = sim(t, [`* ${id}`, 'Vp vp 0 DC 12', 'Vn vn 0 DC -12', 'Vi in 0 DC 0 AC 1 SIN(0 2 1k)',
      `X1 in 0 vp vn ol ${id}`, // open loop
      `X2 in fb vp vn ni ${id}`, 'Rf ni fb 9k', 'Rg fb 0 1k', // non-inverting x10
      `X3 0 fi vp vn inv ${id}`, 'Ri in fi 1k', 'Rfi inv fi 2k', 'RL inv 0 2k', // inverting x-2, loaded
      text(id), '.op', `.ac dec 50 1 ${gbw * 100}`, '.tran 2u 2m', '.end'].join('\n'))
    if (!plots) return
    const [op, ac, tr] = ['Operating Point', 'AC Analysis', 'Transient Analysis'].map((n) => plots.find((p) => p.plotname === n)!)
    for (const n of ['ol', 'ni', 'inv']) near(vec(op, `v(${n})`)[0], -1e-3, 1e-3, `${id} .op v(${n})`)
    const f = ac.vars[0].re, v = ac.vars.find((x) => x.name === 'v(ol)')!, mag = f.map((_, i) => Math.hypot(v.re[i], v.im![i]))
    const k = mag.findIndex((m) => m < 1), fu = f[k - 1] * (f[k] / f[k - 1]) ** (Math.log(mag[k - 1]) / Math.log(mag[k - 1] / mag[k]))
    const ni = ac.vars.find((x) => x.name === 'v(ni)')!, k1 = f.findIndex((x) => x >= 1e3)
    const vni = vec(tr, 'v(ni)'), vinv = vec(tr, 'v(inv)')
    const [hi, lo] = [Math.max(...vni), Math.min(...vni)]
    t.diagnostic(`${id}: A0 ${(20 * Math.log10(mag[0])).toFixed(1)} dB, GBW ${(fu / 1e6).toFixed(3)} MHz, x10 @1k ${Math.hypot(ni.re[k1], ni.im![k1]).toFixed(3)}, clip +${hi.toFixed(2)}/${lo.toFixed(2)} V`)
    near(20 * Math.log10(mag[0]), 98, 101, `${id} A0 dB`)
    near(fu, gbw * 0.9, gbw * 1.1, `${id} GBW`)
    near(Math.hypot(ni.re[k1], ni.im![k1]), 9.9, 10.01, `${id} closed-loop gain`)
    near(hi, 10.5, 11, `${id} +swing`), near(lo, -11, -10.5, `${id} -swing`)
    near(Math.max(...vinv), 3.9, 4.01, `${id} inverting x-2 peak`) // 2 V in -> 4 V out, unclipped
    near(Math.min(...vinv), -4.01, -3.9, `${id} inverting x-2 trough`)
  }
})

test('bundled zeners: dynamic impedance at Izt within the datasheet maximum (skipped if ngspice missing)', (t) => {
  const zs: [string, number, number][] = [['BZX55C3V3', 5e-3, 85], ['BZX55C5V6', 5e-3, 25], ['BZX55C12', 5e-3, 20], ['1N4728A', 76e-3, 10], ['1N4734A', 45e-3, 5], ['1N4742A', 21e-3, 9]]
  const deck = ['* zzt', ...zs.flatMap(([id, i], k) => [`Ia${k} a${k} 0 DC ${i * 0.9}`, `Da${k} a${k} 0 ${id}`, `Ib${k} b${k} 0 DC ${i * 1.1}`, `Db${k} b${k} 0 ${id}`]),
    ...zs.map(([id]) => text(id)), '.op', '.end'].join('\n')
  const p = sim(t, deck)?.[0]
  if (!p) return
  zs.forEach(([id, i, max], k) => {
    const z = (vec(p, `v(a${k})`)[0] - vec(p, `v(b${k})`)[0]) / (0.2 * i)
    t.diagnostic(`${id}: Zzt ${z.toFixed(1)} Ω (max ${max})`)
    near(z, 0.5, max, `${id} Zzt`)
  })
})

test('bundled UF4007: reverse recovery 0.5 A / 1 A / 0.25 A (skipped if ngspice missing)', (t) => {
  const p = sim(t, ['* trr', 'V1 a 0 PULSE(25 -50 100n 1n 1n 1u 2u)', 'R1 a k 50', 'D1 k 0 UF4007', text('UF4007'), '.tran 0.2n 400n', '.end'].join('\n'))?.[0]
  if (!p) return
  const tm = vec(p, 'time'), va = vec(p, 'v(a)'), vk = vec(p, 'v(k)'), i = tm.map((_, j) => (va[j] - vk[j]) / 50)
  const t0 = tm[i.findIndex((x, j) => tm[j] > 100e-9 && x < 0)], j1 = i.findIndex((x, j) => tm[j] > t0 && x < -0.9)
  const t1 = tm[i.findIndex((x, j) => j > j1 && x > -0.25)], trr = t1 - t0
  t.diagnostic(`UF4007: trr ${(trr * 1e9).toFixed(1)} ns`)
  near(trr, 25e-9, 75e-9, 'UF4007 trr')
})

test('bundled BJTs (phase 8): hFE at datasheet points (skipped if ngspice missing)', (t) => {
  // id, polarity, [Ic, Vce, hFE lo, hi][]; datasheet min/max (or bin) limits, upper bound loose where none is given
  const qs: [string, number, [number, number, number, number][]][] = [
    ['BC547B', 1, [[2e-3, 5, 200, 450]]], ['BC557B', -1, [[2e-3, 5, 220, 475]]],
    ['BC337', 1, [[0.1, 1, 160, 400], [0.3, 1, 60, 400]]], ['BC327', -1, [[0.1, 1, 160, 400], [0.3, 1, 60, 400]]],
    ['2N5551', 1, [[1e-3, 5, 80, 250], [10e-3, 5, 80, 250], [50e-3, 5, 30, 250]]], ['2N5401', -1, [[1e-3, 5, 50, 240], [10e-3, 5, 60, 240], [50e-3, 5, 50, 240]]],
    ['TIP31C', 1, [[1, 4, 25, 100], [3, 4, 10, 50]]], ['TIP32C', -1, [[1, 4, 25, 100], [3, 4, 10, 50]]],
    ['BD139', 1, [[5e-3, 2, 25, 250], [0.15, 2, 40, 250], [0.5, 2, 25, 250]]], ['BD140', -1, [[5e-3, 2, 25, 250], [0.15, 2, 40, 250], [0.5, 2, 25, 250]]],
    ['MPSA42', 1, [[1e-3, 10, 25, 250], [10e-3, 10, 40, 250], [30e-3, 10, 40, 250]]], ['MPSA92', -1, [[1e-3, 10, 25, 250], [10e-3, 10, 40, 250], [30e-3, 10, 25, 250]]],
    ['2N4401', 1, [[1e-3, 1, 40, 300], [10e-3, 1, 80, 300], [0.15, 1, 100, 300], [0.5, 2, 40, 300]]],
    ['2N4403', -1, [[1e-3, 1, 60, 300], [10e-3, 1, 100, 300], [0.15, 2, 100, 300], [0.5, 2, 20, 300]]]
  ]
  // per point: Ic forced into the collector, an error amp drives the base until Vce is on target; hFE = Ic / Ib
  const pts = qs.flatMap(([id, s, ps]) => ps.map(([ic, vce, lo, hi]) => ({ id, s, ic, vce, lo, hi })))
  const deck = ['* hFE', ...pts.flatMap(({ id, s, ic, vce }, k) => [`Vr${k} r${k} 0 DC ${s * vce}`, `I${k} ${s > 0 ? `0 c${k}` : `c${k} 0`} DC ${ic}`,
    `E${k} bd${k} 0 c${k} r${k} 1000`, `Vb${k} bd${k} bb${k} DC 0`, `Rb${k} bb${k} b${k} 10`, `Q${k} c${k} b${k} 0 ${id}`]),
    ...qs.map(([id]) => text(id)), '.op', '.end'].join('\n')
  const p = sim(t, deck)?.[0]
  if (!p) return
  pts.forEach(({ id, ic, vce, lo, hi }, k) => {
    const h = ic / Math.abs(vec(p, `i(vb${k})`)[0]), vbe = Math.abs(vec(p, `v(b${k})`)[0])
    t.diagnostic(`${id}: hFE ${h.toFixed(0)} @ ${ic * 1e3} mA ${vce} V (want ${lo}…${hi}), Vbe ${vbe.toFixed(2)} V`)
    near(Math.abs(vec(p, `v(c${k})`)[0]), vce * 0.99, vce * 1.01, `${id} Vce`)
    near(h, lo, hi, `${id} hFE @ ${ic} A`)
    if (/^TIP/.test(id) && ic === 3) near(vbe, 0.8, 1.8, `${id} Vbe(on) @ 3 A`)
  })
})

test('bundled JFETs: Idss @ |Vds| 15 V, Vgs(off) @ 10 nA, BF245A Vgs @ 200 µA, J176 Rds(on) (skipped if ngspice missing)', (t) => {
  const js: [string, number, number, number, number, number][] = [ // id, polarity, Idss lo/hi, |Vgs(off)| lo/hi
    ['J201', 1, 0.2e-3, 1e-3, 0.3, 1.5], ['2N5457', 1, 1e-3, 5e-3, 0.5, 6], ['BF245A', 1, 2e-3, 6.5e-3, 0.25, 8], ['J176', -1, 2e-3, 25e-3, 1, 4]
  ]
  const deck = ['* jfets', 'Vsw sw 0 DC 0', ...js.flatMap(([id, s], k) => [`Va${k} da${k} 0 DC ${15 * s}`, `Ja${k} da${k} 0 0 ${id}`,
    `Vb${k} db${k} 0 DC ${15 * s}`, `Eg${k} g${k} 0 sw 0 ${-s}`, `Jb${k} db${k} g${k} 0 ${id}`, `Vc${k} dc${k} 0 DC ${0.1 * s}`, `Jc${k} dc${k} 0 0 ${id}`]),
    ...js.map(([id]) => text(id)), '.dc Vsw 0 5 1m', '.end'].join('\n')
  const p = sim(t, deck)?.[0]
  if (!p) return
  const sw = vec(p, 'v(sw)'), at = (ib: Float64Array | number[], x: number) => sw[[...ib].findIndex((i) => Math.abs(i) < x)]
  js.forEach(([id, , ilo, ihi, vlo, vhi], k) => {
    const idss = Math.abs(vec(p, `i(va${k})`)[0]), ib = vec(p, `i(vb${k})`), off = at(ib, 10e-9), rds = 0.1 / Math.abs(vec(p, `i(vc${k})`)[0])
    t.diagnostic(`${id}: Idss ${(idss * 1e3).toFixed(2)} mA, |Vgs(off)| ${off.toFixed(2)} V, Rds(on) ${rds.toFixed(0)} Ω`)
    near(idss, ilo, ihi, `${id} Idss`)
    near(off, vlo, vhi, `${id} Vgs(off)`)
    if (id === 'BF245A') near(at(ib, 200e-6), 0.4, 2.2, 'BF245A |Vgs| @ 200 µA')
    if (id === 'J176') near(rds, 50, 250, 'J176 Rds(on)')
  })
})

test('bundled power/SOT-23 MOSFETs: Vth (Vgs = Vds) and Rds(on) at datasheet Vgs/Id (skipped if ngspice missing)', (t) => {
  const ms: [string, number, number, number, number, [number, number, number, number][]][] = [ // id, pol, Ith, Vth lo/hi, [Vgs, Id, Rds lo, hi]
    ['IRF540N', 1, 250e-6, 2, 4, [[10, 16, 0.025, 0.044]]],
    ['IRF9540N', -1, 250e-6, 2, 4, [[10, 11, 0.07, 0.117]]],
    ['IRLZ44N', 1, 250e-6, 1, 2, [[10, 25, 0.012, 0.022], [5, 25, 0.015, 0.025], [4, 21, 0.018, 0.035]]],
    ['BSS138', 1, 1e-3, 0.8, 1.5, [[10, 0.22, 0.5, 3.5], [4.5, 0.22, 0.6, 6]]],
    ['BSS84', -1, 1e-3, 0.8, 2, [[5, 0.1, 1, 10]]],
    ['AO3400', 1, 250e-6, 0.65, 1.45, [[10, 5.7, 0.012, 0.0265], [4.5, 5, 0.015, 0.032], [2.5, 4, 0.02, 0.048]]]
  ]
  const src = (s: number, n: string, i: number) => `${s > 0 ? `0 ${n}` : `${n} 0`} DC ${i}`
  const deck = ['* mosfets', ...ms.flatMap(([id, s, ith, , , rs], k) => [`It${k} ${src(s, `t${k}`, ith)}`, `Mt${k} t${k} t${k} 0 0 ${id}`,
    ...rs.flatMap(([vgs, i], j) => [`Vg${k}_${j} g${k}_${j} 0 DC ${s * vgs}`, `Id${k}_${j} ${src(s, `d${k}_${j}`, i)}`, `M${k}_${j} d${k}_${j} g${k}_${j} 0 0 ${id}`])]),
    ...ms.map(([id]) => text(id)), '.op', '.end'].join('\n')
  const p = sim(t, deck)?.[0]
  if (!p) return
  ms.forEach(([id, , , lo, hi, rs], k) => {
    const vth = Math.abs(vec(p, `v(t${k})`)[0])
    near(vth, lo, hi, `${id} Vth`)
    const r = rs.map(([vgs, i, rlo, rhi], j) => {
      const rds = Math.abs(vec(p, `v(d${k}_${j})`)[0]) / i
      near(rds, rlo, rhi, `${id} Rds(on) @ ${vgs} V`)
      return `${(rds * 1e3).toFixed(1)} mΩ @ ${vgs} V`
    })
    t.diagnostic(`${id}: Vth ${vth.toFixed(2)} V, Rds(on) ${r.join(', ')}`)
  })
})

test('bundled OA_LOWPOWER / OA_RRO: GBW, slew rate, output swing (skipped if ngspice missing)', (t) => {
  for (const [id, vs, sr, step, hmin, hmax] of [['OA_LOWPOWER', 15, 0.5e6, 5, 1, 1.6], ['OA_RRO', 2.5, 0.6e6, 2, 0.005, 0.05]] as const) {
    const plots = sim(t, [`* ${id}`, `Vp vp 0 DC ${vs}`, `Vn vn 0 DC ${-vs}`, 'Va a 0 DC 0 AC 1', `X1 a 0 vp vn ol ${id}`,
      `Vs s 0 PULSE(${-step} ${step} 10u 1n 1n 50u 100u)`, `X2 s f vp vn f ${id}`, 'RLf f 0 10k', // follower step
      `Vc c 0 SIN(0 ${vs / 4} 1k)`, `X3 c fb vp vn x ${id}`, 'Rf x fb 9k', 'Rg fb 0 1k', 'RLx x 0 10k', // x10, clips
      text(id), '.ac dec 50 1 100Meg', '.tran 0.05u 1m', '.end'].join('\n'))
    if (!plots) return
    const [ac, tr] = ['AC Analysis', 'Transient Analysis'].map((n) => plots.find((p) => p.plotname === n)!)
    const f = ac.vars[0].re, v = ac.vars.find((x) => x.name === 'v(ol)')!, mag = f.map((_, i) => Math.hypot(v.re[i], v.im![i]))
    const k = mag.findIndex((m) => m < 1), fu = f[k - 1] * (f[k] / f[k - 1]) ** (Math.log(mag[k - 1]) / Math.log(mag[k - 1] / mag[k]))
    const tm = vec(tr, 'time'), vf = vec(tr, 'v(f)'), vx = vec(tr, 'v(x)')
    const cross = (y: number) => tm[vf.findIndex((x, j) => tm[j] > 10e-6 && x > y)]
    const slew = (1.2 * step) / (cross(0.6 * step) - cross(-0.6 * step))
    const [hi, lo] = [Math.max(...vx), Math.min(...vx)]
    t.diagnostic(`${id}: A0 ${(20 * Math.log10(mag[0])).toFixed(1)} dB, GBW ${(fu / 1e6).toFixed(3)} MHz, slew ${(slew / 1e6).toFixed(3)} V/µs, swing +${hi.toFixed(3)}/${lo.toFixed(3)} V on ±${vs} V`)
    near(20 * Math.log10(mag[0]), 98, 101, `${id} A0 dB`)
    near(fu, 0.9e6, 1.1e6, `${id} GBW`)
    near(slew, sr * 0.9, sr * 1.1, `${id} slew`)
    near(hi, vs - hmax, vs - hmin, `${id} +swing`), near(lo, -vs + hmin, -vs + hmax, `${id} -swing`) // 10k load
  }
})

test('bundled CMP_OC comparator: output levels, sink limit, propagation delay (skipped if ngspice missing)', (t) => {
  const p = sim(t, ['* comparator', 'Vp vp 0 DC 5', 'Vm m 0 DC 2.5', 'Vi i 0 PULSE(2.4 2.6 1u 10n 10n 4u 8u)',
    'X1 i m vp 0 o CMP_OC', 'Rpu vp o 1.2k', // ~4 mA sink when low
    'Vh h 0 DC 2.503', 'X2 h m vp 0 oh CMP_OC', 'Rh vp oh 10k', 'Vl l 0 DC 2.497', 'X3 l m vp 0 ol CMP_OC', 'Rl vp ol 10k', // ±3 mV
    'Vs os 0 DC 2', 'X4 0 m vp 0 os CMP_OC', // sink limit into 2 V
    text('CMP_OC'), '.tran 5n 8u', '.end'].join('\n'))?.[0]
  if (!p) return
  const tm = vec(p, 'time'), o = vec(p, 'v(o)'), at = (x: number) => o[tm.findIndex((y) => y >= x)], n = tm.length - 1
  const rise = tm[o.findIndex((v, j) => tm[j] > 1e-6 && v > 2.5)] - 1.005e-6, fall = tm[o.findIndex((v, j) => tm[j] > 5e-6 && v < 2.5)] - 5.005e-6
  const isink = Math.abs(vec(p, 'i(vs)')[n])
  t.diagnostic(`CMP_OC: Vol ${at(0.9e-6).toFixed(3)} V @ ~3.9 mA, Voh ${at(4.9e-6).toFixed(3)} V, delay ↑${(rise * 1e9).toFixed(0)} ns ↓${(fall * 1e9).toFixed(0)} ns, Isink ${(isink * 1e3).toFixed(1)} mA`)
  near(at(0.9e-6), 0, 0.4, 'Vol @ 4 mA')
  near(at(4.9e-6), 4.95, 5, 'Voh (pull-up)')
  near(rise, 0.1e-6, 1e-6, 'rising delay'), near(fall, 0.1e-6, 1e-6, 'falling delay')
  near(vec(p, 'v(oh)')[n], 4.95, 5, 'in+ 3 mV above in-: high'), near(vec(p, 'v(ol)')[n], 0, 0.4, 'in+ 3 mV below: low')
  near(isink, 10e-3, 30e-3, 'sink current limit')
})

test('bundled TL431: Vref, Zka, programmed 5 V (skipped if ngspice missing)', (t) => {
  const p = sim(t, ['* tl431', 'I1 0 k1 DC 1m', 'X1 k1 0 k1 TL431', 'I2 0 k2 DC 10m', 'X2 k2 0 k2 TL431', 'I3 0 k3 DC 100m', 'X3 k3 0 k3 TL431',
    'I4 0 k4 DC 10m', 'X4 k4 0 r4 TL431', 'R1 k4 r4 10k', 'R2 r4 0 10k', text('TL431'), '.op', '.end'].join('\n'))?.[0]
  if (!p) return
  const v = (n: string) => vec(p, `v(${n})`)[0], zka = (v('k3') - v('k1')) / 99e-3
  t.diagnostic(`TL431: Vref ${v('k2').toFixed(4)} V @ 10 mA, Zka ${zka.toFixed(3)} Ω, R1 = R2 = 10k -> ${v('k4').toFixed(3)} V`)
  near(v('k2'), 2.47, 2.52, 'Vref @ 10 mA')
  near(zka, 0, 0.5, 'Zka 1–100 mA')
  near(v('k4'), 4.95, 5.06, 'Vka with 1:1 divider')
})

test('bundled 7805: Vout, line/load regulation, dropout, current limit, Iq (skipped if ngspice missing)', (t) => {
  const p = sim(t, ['* 7805', 'Vin in 0 DC 10', 'X1 in 0 o1 7805', 'Il1 o1 0 DC 5m', 'X2 in 0 o2 7805', 'Il2 o2 0 DC 1',
    'X3 in 0 o3 7805', 'Vsc o3 0 DC 0', text('7805'), '.dc Vin 0 25 0.01', '.end'].join('\n'))?.[0]
  if (!p) return
  const vin = vec(p, 'v(in)'), at = (n: string, x: number) => vec(p, n)[vin.findIndex((y) => y >= x - 1e-3)]
  const v10 = at('v(o2)', 10), load = at('v(o1)', 10) - v10, line = at('v(o1)', 24.9) - at('v(o1)', 7.5)
  const j = vin.findIndex((_, k) => vec(p, 'v(o2)')[k] >= v10 - 0.1), dropout = vin[j] - vec(p, 'v(o2)')[j]
  const isc = Math.abs(at('i(vsc)', 10)), iq = (Math.abs(at('i(vin)', 10)) - 5e-3 - 1 - isc) / 3
  t.diagnostic(`7805: Vout ${at('v(o1)', 10).toFixed(3)} V @ 5 mA, load reg ${(load * 1e3).toFixed(1)} mV (5 mA–1 A), line reg ${(line * 1e3).toFixed(1)} mV (7.5–24.9 V), dropout ${dropout.toFixed(2)} V @ 1 A, Isc ${isc.toFixed(2)} A, Iq ${(iq * 1e3).toFixed(2)} mA`)
  near(at('v(o1)', 10), 4.9, 5.1, 'Vout')
  near(load, 0, 0.05, 'load regulation'), near(Math.abs(line), 0, 0.05, 'line regulation')
  near(dropout, 1.7, 2.5, 'dropout @ 1 A')
  near(isc, 1.8, 2.8, 'short-circuit current')
  near(iq, 3e-3, 8e-3, 'quiescent current')
})

// --- parser fixtures (hand-written, vendor-style) ---

const OPAMP_LIB = [
  '* ACME AMP1234 - Low noise dual operational amplifier',
  '* Macromodel, rev B. Connections:',
  '*                non-inverting input',
  '*                | inverting input',
  '*                | | positive supply',
  '*                | | | negative supply',
  '*                | | | | output',
  '*                | | | | |',
  '.SUBCKT AMP1234  IN+ IN- VCC VEE OUT PARAMS: GAIN=1e5 RO=50',
  'R1 IN+ IN- 1MEG ; differential input',
  'G1 0 2 IN+ IN- {1m}',
  '+ ; continuation of nothing much',
  'R2 2 0 {GAIN/1m}  $ gain node',
  'C1 2 0 159P',
  '.include acme_common.inc',
  '.subckt inner a b',
  'Rx a b 1k',
  '.model DX D(IS=1f)',
  '.ends inner',
  'X1 2 0 inner',
  'E1 3 0 2 0 1',
  'R3 3 OUT {RO}',
  '.ENDS AMP1234',
  '',
  '*$',
  '.subckt AMP_NUM 1 2 3 4 5',
  'E1 5 0 1 2 1e5',
  '.ends',
].join('\r\n')

const DIODE_LIB = `* ACME diode models
.MODEL ACME4148 D ( IS = 3.1n RS=0.5
* temperature and capacitance
+ N=1.85 CJO=2.1p, M=0.3 ; junction grading
+ BV=100 IBV=0.1u )  $ breakdown
.model acmeZ5V6 d(Is=1e-12 Bv=5.6 Ibv=5m)
.model ZB12 D BV=12 IBV=1m
.model LED_BLUE_X D(IS=1e-25 N=2)
.model QGEN npn(BF=100)
.Model QP1 PNP
.model MV1 VDMOS(Rd=10m Vto=3 pchan)
.model MV2 VDMOS (Vto=3)
.model SW1 SW(Ron=1)
.subckt BJTSUB C B E
Q1 C B E QGEN
.ends
.subckt FETSUB gate drain source params: k=1
.ends FETSUB
.subckt REGU in out gnd adj
.ends
`

test('parseLibFile: vendor-style op-amp file (CRLF, header, params:, nested, include, inline comments)', () => {
  const p = parseLibFile(OPAMP_LIB)
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.models, []) // DX is local to the subckt
  assert.deepEqual(p.subckts.map((s) => [s.name, s.pins]), [['AMP1234', ['IN+', 'IN-', 'VCC', 'VEE', 'OUT']], ['AMP_NUM', ['1', '2', '3', '4', '5']]])
  const s = p.subckts[0].text.split('\n')
  assert.equal(s[0], '.SUBCKT AMP1234  IN+ IN- VCC VEE OUT PARAMS: GAIN=1e5 RO=50')
  assert.equal(s.at(-1), '.ENDS AMP1234')
  assert.ok(s.includes('.include acme_common.inc') && s.includes('.ends inner') && !p.subckts[0].text.includes('\r'))
  assert.equal(p.subckts[1].text, '.subckt AMP_NUM 1 2 3 4 5\nE1 5 0 1 2 1e5\n.ends')
})

test('parseLibFile: .model forms, continuations, comments, case', () => {
  const p = parseLibFile(DIODE_LIB)
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.models.map((m) => [m.name, m.type]), [['ACME4148', 'D'], ['acmeZ5V6', 'D'], ['ZB12', 'D'], ['LED_BLUE_X', 'D'],
    ['QGEN', 'NPN'], ['QP1', 'PNP'], ['MV1', 'VDMOS'], ['MV2', 'VDMOS'], ['SW1', 'SW']])
  assert.deepEqual(p.models[0].params, { IS: '3.1n', RS: '0.5', N: '1.85', CJO: '2.1p', M: '0.3', BV: '100', IBV: '0.1u' })
  assert.equal(p.models[0].text.split('\n').length, 4) // verbatim, incl. the interleaved comment line
  assert.deepEqual(p.models[1].params, { IS: '1e-12', BV: '5.6', IBV: '5m' })
  assert.deepEqual(p.models[2].params, { BV: '12', IBV: '1m' })
  assert.deepEqual(p.models[5].params, {})
  assert.deepEqual(p.subckts.map((s) => [s.name, s.pins]), [['BJTSUB', ['C', 'B', 'E']], ['FETSUB', ['gate', 'drain', 'source']], ['REGU', ['in', 'out', 'gnd', 'adj']]])
  // pin list also stops at bare k=v tokens
  assert.deepEqual(parseLibFile('.subckt X a b r=1\n.ends').subckts[0].pins, ['a', 'b'])
})

test('parseLibFile: errors for unbalanced subckts and malformed models', () => {
  assert.deepEqual(parseLibFile('.ends\n.model\n.subckt A 1 2\nR1 1 2 1k').errors,
    ['Line 1: .ends without .subckt', 'Line 2: malformed .model', '.subckt A has no .ends'])
  assert.deepEqual(parseLibFile('').subckts, [])
})

test('suggest: kinds, categories, pin maps', () => {
  const by = (t: string) => Object.fromEntries(suggest(parseLibFile(t)).map((e) => [e.name, [e.kind, e.category, e.pinMap.join('')]]))
  assert.deepEqual(by(DIODE_LIB), {
    ACME4148: ['diode', 'Diodes', ''], acmeZ5V6: ['diode', 'Diodes', ''], ZB12: ['diode', 'Diodes', ''], LED_BLUE_X: ['led', 'Diodes', ''],
    QGEN: ['npn', 'BJTs', ''], QP1: ['pnp', 'BJTs', ''], MV1: ['pmos', 'MOSFETs', ''], MV2: ['nmos', 'MOSFETs', ''],
    BJTSUB: ['npn', 'BJTs', '012'], FETSUB: ['nmos', 'MOSFETs', '102'], REGU: ['block', 'Subcircuits', '0123']
  }) // SW1 has no symbol: not suggested
  assert.deepEqual(by('.model BZX55C5V6 D(BV=5.6)\n.model MMSZ5231 D(BV=5.1)\n.model BZBIG D(BV=47)\n.model 1N4733A D(BV=5.1)'),
    { BZX55C5V6: ['zener', 'Diodes', ''], MMSZ5231: ['zener', 'Diodes', ''], BZBIG: ['diode', 'Diodes', ''], '1N4733A': ['zener', 'Diodes', ''] })
  const oa = (pins: string) => by(`.subckt U ${pins}\n.ends`).U[2]
  assert.equal(by(OPAMP_LIB).AMP1234.join(), 'opamp5,Op-amps,01234')
  assert.equal(oa('OUT VCC VEE INN INP'), '43120')
  assert.equal(oa('+IN -IN V+ V- OUTPUT'), '01234')
  assert.equal(oa('vout non_inv inv vdd vss'), '12340')
  assert.equal(oa('3 2 7 4 6'), '01234') // numbered pins: conventional order
  assert.equal(oa('a b out vcc vee'), '01234') // partial match: conventional order
  assert.equal(by('.subckt T e b c\n.ends').T.join(), 'npn,BJTs,210')
  assert.equal(by('.subckt T x y z\n.ends').T.join(), 'block,Subcircuits,012')
  assert.deepEqual(by('.model J1 NJF(VTO=-1 BETA=1m)\n.MODEL J2 pjf (VTO=-2)'), { J1: ['njf', 'JFETs', ''], J2: ['pjf', 'JFETs', ''] })
})

test('entriesFromImport + resolver + blockPartFields', () => {
  const file = 'libs/acme.lib', all = OPAMP_LIB + '\r\n' + DIODE_LIB
  const imp = { file, entries: suggest(parseLibFile(all)).filter((e) => ['AMP1234', 'ACME4148', 'REGU'].includes(e.name)).concat({ name: 'GONE', kind: 'diode', category: 'Diodes', pinMap: [] }) }
  const es = entriesFromImport(imp, all)
  assert.deepEqual(es.map((e) => e.id), ['proj:libs/acme.lib#ACME4148', 'proj:libs/acme.lib#AMP1234', 'proj:libs/acme.lib#REGU'])
  const [d, oa, reg] = es
  assert.deepEqual([d.kind, d.value, d.source, d.spice!.type, d.params!.BV], ['diode', 'ACME4148', 'project', 'model', '100'])
  assert.match((d.spice as { text: string }).text, /^\.MODEL ACME4148 D \(.*\n\*.*\n\+.*\n\+ BV=100/)
  assert.deepEqual(oa.spice, { type: 'subckt', name: 'AMP1234', pins: ['IN+', 'IN-', 'VCC', 'VEE', 'OUT'], pinMap: [0, 1, 2, 3, 4], include: file })
  const find = resolver([...BUNDLED, ...es])
  assert.equal(find('proj:libs/acme.lib#REGU'), reg)
  assert.equal(find('std:2N3904')?.name, '2N3904')
  assert.equal(find('std:nope'), undefined)
  const bf = blockPartFields(reg)
  assert.deepEqual(bf.pins!.map((p) => p.name), ['in', 'out', 'gnd', 'adj'])
  assert.ok(bf.size!.w > 0 && bf.size!.h > 0)
})

test('entriesFromImport: map lookup keeps find() semantics (case-insensitive, first definition wins)', () => {
  const all = OPAMP_LIB + '\r\n' + DIODE_LIB + '.model acme4148 D(IS=9)\n.subckt regu x\n.ends\n'
  const p = parseLibFile(all), same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const entries = [...suggest(p), { name: 'Acme4148', kind: 'diode' as const, category: 'Diodes' as const, pinMap: [] }]
  const es = entriesFromImport({ file: 'a.lib', entries }, all)
  assert.equal(es.length, entries.length)
  es.forEach((e, i) => {
    const want = p.models.find((m) => same(m.name, entries[i].name)) ?? p.subckts.find((s) => same(s.name, entries[i].name))!
    assert.equal(e.spice!.name, want.name, e.id)
    assert.equal('text' in e.spice! ? e.spice.text : e.spice!.pins.join(), 'type' in want ? want.text : want.pins.join(), e.id)
  })
  assert.equal(es.at(-1)!.params!.IS, '3.1n') // ACME4148, not the later acme4148
})

// --- end to end: schematic with library parts -> netlist(ctx) -> ngspice ---

function flag(s: Sheet, q: Pt, n: string) {
  const f = newPart(s, n === '0' ? 'gnd' : 'label', q.x, q.y)
  if (n !== '0') f.value = n
  s.parts.push(f)
}
function put(s: Sheet, kind: Kind, x: number, nodes: string[], value?: string, e?: LibEntry, extra = {}) {
  const p = newPart(s, kind, x, 0, 0, false, { ...(e ? { lib: e.id, value: e.value } : {}), ...extra })
  if (value != null) p.value = value
  s.parts.push(p)
  pins(p).forEach((q, i) => nodes[i] && flag(s, q, nodes[i]))
  return p
}

test('netlist(ctx.lib): bundled + imported parts simulate (skipped if ngspice missing)', (t) => {
  const file = 'libs/acme.lib'
  const libText = `* ACME parts\n.subckt BUF in out vcc vee\nE1 out 0 in 0 1\n.ends BUF\n.model ACMED D(IS=1n N=2)\n`
  const es = entriesFromImport({ file, entries: suggest(parseLibFile(libText)) }, libText)
  const find = resolver([...BUNDLED, ...es]), e = (id: string) => find(id)!
  const s = emptySheet()
  put(s, 'vsrc', 0, ['vp', '0'], 'DC 12')
  put(s, 'vsrc', 100, ['vn', '0'], 'DC -12')
  put(s, 'vsrc', 200, ['in', '0'], 'DC 0.5')
  put(s, 'opamp5', 300, ['in', 'fb', 'vp', 'vn', 'out'], undefined, e('std:OA_GENERIC'))
  put(s, 'res', 400, ['out', 'fb'], '1k')
  put(s, 'res', 500, ['fb', '0'], '1k')
  put(s, 'npn', 600, ['vp', 'out', 'e'], undefined, e('std:2N3904'))
  put(s, 'res', 700, ['e', '0'], '1k')
  put(s, 'block', 800, ['out', 'buf', 'vp', 'vn'], undefined, e(`proj:${file}#BUF`), blockPartFields(e(`proj:${file}#BUF`)))
  put(s, 'diode', 900, ['buf', 'd'], undefined, e(`proj:${file}#ACMED`))
  put(s, 'res', 1000, ['d', '0'], '10k')
  s.texts.push({ id: uid(), x: 0, y: 0, text: '.op' })
  const r = netlist(s, 'lib', { lib: find })
  assert.deepEqual([r.errors, r.warnings], [[], []])
  assert.equal(r.text.match(/\.subckt OA_GENERIC/g)?.length, 1)
  assert.match(r.text, /^X\w+ out buf vp vn BUF$/m)
  assert.match(r.text, /^\.include libs\/acme\.lib$/m)
  assert.match(r.text, /^\.model 2N3904 NPN/m)
  const p = sim(t, r.text, { [file]: libText })?.[0]
  if (!p) return
  const v = (n: string) => vec(p, `v(${n})`)[0]
  near(v('out'), 0.999, 1.001, 'non-inverting x2 output')
  near(v('e'), 0.2, 0.45, 'emitter follower')
  near(v('buf'), 0.999, 1.001, 'imported buffer')
  near(v('d'), 0.35, 0.55, 'imported diode: 1 V - Vf across 10k')
})
