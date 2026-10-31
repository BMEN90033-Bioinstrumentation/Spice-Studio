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
  assert.deepEqual(BUNDLED.map((e) => e.id), ['R', 'C', 'L', 'V', 'I', '1N4148', '1N4007', '1N5819', 'BZX84C5V1', 'LED_RED', 'LED_GREEN',
    '2N3904', '2N3906', '2N2222', '2N7000', 'BS250', 'OPAMP', 'OA_GENERIC', 'OA_FAST'].map((n) => 'std:' + n))
  for (const e of BUNDLED) {
    assert.equal(e.source, 'bundled')
    assert.ok(e.description.length > 5, e.id)
    if (e.spice) assert.equal(e.spice.name, e.value, e.id)
    if (e.spice?.type === 'model') assert.deepEqual(parseLibFile(e.spice.text).models.map((m) => m.name), [e.name])
  }
  assert.deepEqual(['R', 'C', 'L', 'V', 'I', 'OPAMP'].map((n) => [lib(n).kind, lib(n).value, lib(n).spice]),
    [['res', '1k', undefined], ['cap', '1u', undefined], ['ind', '1m', undefined], ['vsrc', 'DC 1', undefined], ['isrc', 'DC 1m', undefined], ['opamp', '1e6', undefined]])
  assert.deepEqual(['1N4148', 'BZX84C5V1', 'LED_RED', '2N3906', 'BS250', 'OA_FAST'].map((n) => lib(n).kind), ['diode', 'zener', 'led', 'pnp', 'pmos', 'opamp5'])
  assert.equal(lib('1N4148').params!.TT, '4n')
})

test('bundled diodes: forward voltages and zener breakdown (skipped if ngspice missing)', (t) => {
  const ds: [string, string, number, number, number][] = [ // id, current, polarity, Vlo, Vhi
    ['1N4148', '10m', 1, 0.6, 0.75], ['1N4007', '1', 1, 0.9, 1.1], ['1N5819', '1', 1, 0.35, 0.45],
    ['BZX84C5V1', '5m', -1, 4.95, 5.25], ['LED_RED', '20m', 1, 1.8, 2.1], ['LED_GREEN', '20m', 1, 2.0, 2.2]
  ]
  const deck = ['* diodes', ...ds.flatMap(([id, i, pol], k) => [`I${k} 0 a${k} DC ${i}`, pol > 0 ? `D${k} a${k} 0 ${id}` : `D${k} 0 a${k} ${id}`]),
    ...ds.map(([id]) => text(id)), '.op', '.end'].join('\n')
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
