// Phase 9 kinds: dependent/behavioural sources, switches, T line, transformer, K, power flag, pot, crystal.
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connections, emptySheet, junctions, newPart, pins, uid, unconnectedPins, type Part, type Pt, type Sheet } from '../src/renderer/src/schematic/model.ts'
import { SYMBOLS, isFlag, type Kind } from '../src/renderer/src/schematic/symbols.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'
import { BUNDLED, resolver } from '../src/renderer/src/library/library.ts'
import { parseRaw, type RawPlot } from '../src/main/rawfile.ts'

const ctx = { lib: resolver(BUNDLED) }
function flag(s: Sheet, q: Pt, n: string, kind: Kind = 'label') {
  const f = newPart(s, n === '0' ? 'gnd' : kind, q.x, q.y)
  if (n !== '0') f.value = n
  s.parts.push(f)
}
function put(s: Sheet, kind: Kind, x: number, nodes: string[] = [], value?: string, extra?: Partial<Part>) {
  const p = newPart(s, kind, x, 0, 0, false, extra)
  if (value != null) p.value = value
  s.parts.push(p)
  pins(p).forEach((q, i) => nodes[i] && flag(s, q, nodes[i]))
  return p
}
const dir = (s: Sheet, text: string) => (s.texts.push({ id: uid(), x: 0, y: 0, text }), s)
const nl = (s: Sheet, text = '.op') => netlist(dir(s, text), 'c', ctx)

function sim(t: TestContext, text: string): RawPlot[] | undefined {
  const d = mkdtempSync(join(tmpdir(), 'comptest-'))
  writeFileSync(join(d, 'c.cir'), text)
  const r = spawnSync('ngspice', ['-b', '-n', '-r', join(d, 'o.raw'), join(d, 'c.cir')], { encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stderr, /error|warning/i, text)
  return parseRaw(readFileSync(join(d, 'o.raw')))
}
const plot = (ps: RawPlot[], name: string) => ps.find((p) => p.plotname === name) ?? assert.fail(`no ${name} plot`)
const vec = (p: RawPlot, n: string) => p.vars.find((x) => x.name === n) ?? assert.fail(`no ${n} in ${p.vars.map((v) => v.name)}`)
const re = (p: RawPlot, n: string) => vec(p, n).re
const near = (v: number, want: number, tol: number, what: string) => assert.ok(Math.abs(v - want) <= tol, `${what} = ${v}, want ${want} ± ${tol}`)
// first time v crosses level going up, linearly interpolated
const rise = (t: Float64Array, v: Float64Array, level: number) => {
  const i = v.findIndex((x) => x >= level)
  return t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1])
}

test('symbols: pins on grid, pin names match, new kinds in PALETTE, power is a flag', () => {
  for (const [k, d] of Object.entries(SYMBOLS)) {
    for (const q of d.pins) assert.ok(q.x % 10 === 0 && q.y % 10 === 0, `${k} pin ${q.x},${q.y}`)
    if (d.pinNames) assert.equal(d.pinNames.length, d.pins.length, k)
  }
  for (const k of ['vcvs', 'vccs', 'ccvs', 'cccs', 'bv', 'bi', 'sw', 'csw', 'tline', 'xfmr', 'kcouple', 'power', 'pot', 'xtal'] as Kind[])
    assert.ok(SYMBOLS[k] && newPart(emptySheet(), k, 0, 0), k)
  assert.ok(isFlag('power') && !isFlag('kcouple'))
  assert.deepEqual(['xfmr', 'pot', 'xtal', 'kcouple'].map((k) => newPart(emptySheet(), k as Kind, 0, 0).name), ['XF1', 'RV1', 'Y1', 'K1'])
})

test('golden netlist line for every new kind', () => {
  const s = emptySheet()
  put(s, 'vsrc', 0, ['in', '0'])
  put(s, 'vsrc', 100, ['in', 's'], 'DC 0')
  put(s, 'res', 200, ['s', '0'])
  put(s, 'vcvs', 300, ['eo', '0', 'in', '0'], '10')
  put(s, 'vccs', 400, ['0', 'go', 'in', '0'], '1m')
  put(s, 'ccvs', 500, ['ho', '0'], 'V2 1k')
  put(s, 'cccs', 600, ['0', 'fo'], 'V2 10')
  put(s, 'bv', 700, ['bo', '0'], 'V(in)*2')
  put(s, 'bi', 800, ['0', 'bi'], 'i = V(in)*1m')
  put(s, 'sw', 900, ['so', '0', 'in', '0'])
  put(s, 'csw', 1000, ['wo', '0'], 'V2 CSW')
  put(s, 'tline', 1100, ['in', '0', 'to', '0'])
  put(s, 'xfmr', 1200, ['in', '0', 'xs', '0'])
  put(s, 'ind', 1300, ['a', '0'])
  put(s, 'ind', 1400, ['b', '0'])
  put(s, 'kcouple', 1500)
  put(s, 'pot', 1600, ['in', 'w', '0'], 'R=10k pos=0.3', { lib: 'std:POT' })
  put(s, 'xtal', 1700, ['in', '0'], undefined, { lib: 'std:XTAL' })
  put(s, 'power', 1800, ['VCC'])
  const r = nl(s)
  assert.deepEqual([r.errors, r.warnings], [[], []])
  const lines = r.text.split('\n')
  assert.deepEqual(lines.slice(1, 22), [
    'V1 in 0 DC 1',
    'V2 in s DC 0',
    'R1 s 0 1k',
    'E1 eo 0 in 0 10',
    'G1 0 go in 0 1m',
    'H1 ho 0 V2 1k',
    'F1 0 fo V2 10',
    'B1 bo 0 V=V(in)*2',
    'B2 0 bi i = V(in)*1m',
    'S1 so 0 in 0 SW',
    'W1 wo 0 V2 CSW',
    'T1 in 0 to 0 Z0=50 TD=1n',
    'LXF1_P in 0 1m',
    'LXF1_S xs 0 100u',
    'KXF1 LXF1_P LXF1_S 0.999',
    'L1 a 0 1m',
    'L2 b 0 1m',
    'K1 L1 L2 0.99',
    'XRV1 in w 0 POT params: R=10k pos=0.3',
    'XY1 in 0 XTAL params: F=10meg',
    '.op' // the power flag is no element
  ])
  assert.match(r.text, /^\.subckt POT a w b params: R=10k pos=0\.5$/m)
  assert.match(r.text, /^\.subckt XTAL 1 2 params: F=10meg Cm=25f R=10 C0=5p$/m)
  assert.ok(r.text.endsWith('.model SW SW(ron=1 roff=1meg vt=0.5 vh=0)\n.model CSW CSW(ron=1 roff=1meg it=1m)\n.end\n'), r.text)
  assert.deepEqual(r.nets[s.parts.find((p) => p.kind === 'kcouple')!.id], [])
})

test('value checks: transformer params, controlling sources, K, subckt params, pot without library', () => {
  const one = (kind: Kind, value: string, nodes: string[], extra?: Partial<Part>) => {
    const s = emptySheet()
    put(s, 'vsrc', 0, ['in', '0'])
    put(s, kind, 100, nodes, value, extra)
    return nl(s)
  }
  const x = (v: string) => one('xfmr', v, ['in', '0', 'b', '0']).errors.join()
  assert.match(x('Lp=1m Ls=100u'), /XF1: value "Lp=1m Ls=100u" is missing k/)
  assert.match(x('Lp=1m Ls=-1 k=0.9'), /Ls=-1 must be a positive inductance/)
  assert.match(x('Lp=1m Ls=1m k=1.5'), /k=1\.5 must be a coupling factor in \(0, 1\]/)
  assert.match(x('Lp=1m Ls=1m 0.9'), /"0\.9" isn't one of them/)
  assert.match(x('1m'), /must be Lp=<H> Ls=<H> k=<0…1>/)
  assert.equal(x('ls=2m LP={lp} K=1'), '')
  assert.match(one('xfmr', 'ls=2m LP=1m K=1', ['in', '0', 'b', '0']).text, /^LXF1_P in 0 1m\nLXF1_S b 0 2m\nKXF1 LXF1_P LXF1_S 1$/m)

  assert.deepEqual(one('ccvs', 'V9 10', ['b', '0']).warnings, ['H1: controlling voltage source "V9" is not on this sheet'])
  assert.deepEqual(one('cccs', 'v1 10', ['b', '0']).warnings, []) // case-insensitive
  assert.match(one('ccvs', 'V1', ['b', '0']).errors.join(), /H1: value "V1" must be "<V source> <gain>"/)
  assert.match(one('csw', 'CSW', ['b', '0']).errors.join(), /W1: value "CSW" must be "<V source> <model>"/)
  assert.deepEqual(one('csw', 'Vx CSW', ['b', '0']).warnings, ['W1: controlling voltage source "Vx" is not on this sheet'])
  const d = emptySheet()
  put(d, 'ccvs', 0, ['b', '0'], 'Vx 10')
  assert.deepEqual(nl(d, '.op\nVx b2 0 DC 0').warnings, []) // defined in a directive
  assert.deepEqual(one('kcouple', 'L1 L2 0.9', []).warnings, ['K1: inductor "L1" is not on this sheet', 'K1: inductor "L2" is not on this sheet'])
  assert.match(one('kcouple', 'L1 0.9', []).errors.join(), /K1: value "L1 0\.9" must be "<inductor> <inductor> <k>"/)
  const k = emptySheet()
  put(k, 'xfmr', 0, ['a', '0', 'b', '0']).name = 'T1'
  put(k, 'ind', 100, ['c', '0'])
  put(k, 'kcouple', 200, [], 'LT1_S L1 0.5')
  assert.deepEqual(nl(k).warnings, []) // a transformer's inductors can be coupled further

  assert.match(one('pot', 'R=10k', ['in', 'w', '0']).errors.join(), /RV1: place the potentiometer from the library/)
  assert.match(one('pot', 'R=10k oops', ['in', 'w', '0'], { lib: 'std:POT' }).errors.join(), /XRV1: value "R=10k oops" must be POT parameters as name=value pairs/)
  assert.match(one('pot', 'POT params: pos=0.1', ['in', 'w', '0'], { lib: 'std:POT' }).text, /^XRV1 in w 0 POT params: pos=0\.1$/m)
  assert.match(one('xtal', 'XTAL', ['in', '0'], { lib: 'std:XTAL' }).text, /^XY1 in 0 XTAL$/m)
  // other library subckts: the value is the subckt name, no params
  assert.match(one('opamp5', 'OA_GENERIC', ['in', '0', 'in', '0', 'o'], { lib: 'std:OA_GENERIC' }).text, /^X1 in 0 in 0 o OA_GENERIC$/m)
  assert.match(one('bv', 'V=V(in)', ['b', '0']).text, /^B1 b 0 V=V\(in\)$/m)
})

test('a zero-pin part (K) goes through connections, unconnectedPins, junctions and netlist', () => {
  const s = emptySheet()
  put(s, 'kcouple', 0)
  assert.equal(connections(s).size, 0)
  assert.deepEqual([unconnectedPins(s), junctions(s)], [[], []])
  const r = nl(s)
  assert.match(r.errors.join(), /No ground/)
  assert.ok(r.warnings.some((w) => /K1: inductor "L1"/.test(w)))
})

test('power flags join nets by name, act like labels (GND = ground)', () => {
  const s = emptySheet()
  const v1 = put(s, 'vsrc', 0, ['', '0'], 'DC 5')
  flag(s, pins(v1)[0], 'VDD', 'power')
  const r1 = put(s, 'res', 100, ['', '0'])
  flag(s, pins(r1)[0], 'vdd', 'power')
  const r2 = put(s, 'res', 200, ['', ''])
  flag(s, pins(r2)[0], 'VDD', 'power')
  flag(s, pins(r2)[1], 'GND', 'power')
  const r = nl(s)
  assert.deepEqual([r.errors, r.warnings], [[], []])
  assert.deepEqual([r.nets[v1.id], r.nets[r1.id], r.nets[r2.id]], [['VDD', '0'], ['VDD', '0'], ['VDD', '0']])
  assert.deepEqual(unconnectedPins(s), []) // flags don't count as unconnected parts
  s.parts.at(-1)!.value = 'my rail'
  assert.match(nl(s).errors.join(), /Invalid net power flag "my rail"/)
})

test('E amplifier, G transconductor, F/H with a sense source, B multiplier (.op; skipped if ngspice missing)', (t) => {
  const s = emptySheet()
  put(s, 'vsrc', 0, ['in', '0'], 'DC 0.5')
  put(s, 'vcvs', 100, ['eo', '0', 'in', '0'], '10')
  put(s, 'res', 200, ['eo', '0'])
  put(s, 'vccs', 300, ['0', 'go', 'in', '0'], '2m') // current leaves the source at out-
  put(s, 'res', 400, ['go', '0'])
  put(s, 'res', 500, ['in', 's'], '1k') // 0.5 mA through Vs
  put(s, 'vsrc', 600, ['s', '0'], 'DC 0').name = 'Vs'
  put(s, 'cccs', 700, ['0', 'fo'], 'Vs 10')
  put(s, 'res', 800, ['fo', '0'], '100')
  put(s, 'ccvs', 900, ['ho', '0'], 'Vs 2k')
  put(s, 'res', 1000, ['ho', '0'])
  put(s, 'vsrc', 1100, ['a', '0'], 'DC 3')
  put(s, 'bv', 1200, ['bo', '0'], 'V(in)*V(a)')
  put(s, 'res', 1300, ['bo', '0'])
  put(s, 'bi', 1400, ['0', 'bi'], 'I=V(a)*1m')
  put(s, 'res', 1500, ['bi', '0'])
  const r = nl(s)
  assert.deepEqual([r.errors, r.warnings], [[], []])
  const ps = sim(t, r.text)
  if (!ps) return
  const op = ps[0], v = (n: string) => re(op, `v(${n})`)[0]
  near(v('eo'), 5, 1e-9, 'E gain 10')
  near(v('go'), 1, 1e-9, 'G 2 mS · 0.5 V · 1 kΩ')
  near(v('fo'), 0.5, 1e-9, 'F 10 · 0.5 mA · 100 Ω')
  near(v('ho'), 1, 1e-9, 'H 2 kΩ · 0.5 mA')
  near(v('bo'), 1.5, 1e-9, 'B 0.5 V · 3 V')
  near(v('bi'), 3, 1e-9, 'B 3 mA · 1 kΩ')
})

test('switches: S chopper under .tran, W on above its threshold (skipped if ngspice missing)', (t) => {
  const s = emptySheet()
  put(s, 'vsrc', 0, ['vdd', '0'], 'DC 5')
  put(s, 'vsrc', 100, ['c', '0'], 'PULSE(0 1 0 1u 1u 0.5m 1m)')
  put(s, 'res', 200, ['vdd', 'so'])
  put(s, 'sw', 300, ['so', '0', 'c', '0'])
  put(s, 'res', 400, ['vdd', 'wo'])
  put(s, 'csw', 500, ['wo', '0'], 'Vs CSW')
  put(s, 'res', 600, ['vdd', 'm'], '2.5k') // 2 mA through Vs: above it=1m
  put(s, 'vsrc', 700, ['m', '0'], 'DC 0').name = 'Vs'
  const r = nl(s, '.tran 1u 2m')
  assert.deepEqual([r.errors, r.warnings], [[], []])
  const ps = sim(t, r.text)
  if (!ps) return
  const tr = plot(ps, 'Transient Analysis'), time = re(tr, 'time'), so = re(tr, 'v(so)')
  const at = (x: number) => so[time.findIndex((y) => y >= x)]
  near(at(0.25e-3), 5 / 1001, 1e-4, 'S on (1 Ω vs 1 kΩ)')
  near(at(0.75e-3), 5 * 1e6 / (1e6 + 1e3), 1e-3, 'S off (1 MΩ)')
  near(at(1.25e-3), 5 / 1001, 1e-4, 'S on again')
  near(re(tr, 'v(wo)')[0], 5 / 1001, 1e-4, 'W on')
})

test('transformer turns ratio √(Lp/Ls) and K between two placed inductors (.ac; skipped if ngspice missing)', (t) => {
  const s = emptySheet()
  put(s, 'vsrc', 0, ['in', '0'], 'DC 0 AC 1')
  put(s, 'res', 100, ['in', 'p'], '1')
  put(s, 'xfmr', 200, ['p', '0', 'sec', '0'], 'Lp=1m Ls=100u k=0.999')
  put(s, 'res', 300, ['sec', '0'], '1meg')
  put(s, 'res', 400, ['in', 'p2'], '1')
  put(s, 'ind', 500, ['p2', '0'], '1m')
  put(s, 'ind', 600, ['s2', '0'], '4m')
  put(s, 'res', 700, ['s2', '0'], '1meg')
  put(s, 'kcouple', 800, [], 'L1 L2 0.5')
  const r = nl(s, '.ac lin 1 10k 10k')
  assert.deepEqual([r.errors, r.warnings], [[], []])
  const ps = sim(t, r.text)
  if (!ps) return
  const ac = plot(ps, 'AC Analysis')
  const ratio = (a: string, b: string) => { const x = vec(ac, `v(${a})`), y = vec(ac, `v(${b})`); return { m: Math.hypot(x.re[0], x.im![0]) / Math.hypot(y.re[0], y.im![0]), re: x.re[0] * y.re[0] + x.im![0] * y.im![0] } }
  const x = ratio('sec', 'p'), k = ratio('s2', 'p2')
  near(x.m, 0.999 * Math.sqrt(100e-6 / 1e-3), 1e-4, 'Vs/Vp = k·√(Ls/Lp) (n² = Lp/Ls = 10)')
  assert.ok(x.re > 0, 'dotted ends in phase')
  near(k.m, 0.5 * Math.sqrt(4), 1e-4, 'K 0.5 · √(L2/L1)')
})

test('T line delays an edge by TD (.tran; skipped if ngspice missing)', (t) => {
  const s = emptySheet()
  put(s, 'vsrc', 0, ['src', '0'], 'PULSE(0 1 0.5n 10p 10p 10n 20n)')
  put(s, 'res', 100, ['src', 'a'], '50')
  put(s, 'tline', 200, ['a', '0', 'b', '0'], 'Z0=50 TD=1n')
  put(s, 'res', 300, ['b', '0'], '50')
  const r = nl(s, '.tran 5p 4n')
  assert.deepEqual([r.errors, r.warnings], [[], []])
  const ps = sim(t, r.text)
  if (!ps) return
  const tr = plot(ps, 'Transient Analysis'), time = re(tr, 'time')
  near(re(tr, 'v(b)').at(-1)!, 0.5, 1e-3, 'matched: half the source at the far end')
  near(rise(time, re(tr, 'v(b)'), 0.25) - rise(time, re(tr, 'v(a)'), 0.25), 1e-9, 2e-11, 'delay')
})

test('pot divider at pos=0.3 (clamped beyond the ends) and crystal series resonance (skipped if ngspice missing)', (t) => {
  const s = emptySheet()
  put(s, 'vsrc', 0, ['in', '0'], 'DC 1 AC 1')
  put(s, 'pot', 100, ['in', 'w', '0'], 'R=10k pos=0.3', { lib: 'std:POT' })
  put(s, 'pot', 200, ['in', 'w2', '0'], 'pos=2', { lib: 'std:POT' })
  put(s, 'res', 300, ['in', 'xa'], '50')
  put(s, 'xtal', 400, ['xa', 'xb'], undefined, { lib: 'std:XTAL' })
  put(s, 'res', 500, ['xb', '0'], '50')
  const r = nl(s, '.op\n.ac lin 2001 9.99meg 10.01meg')
  assert.deepEqual([r.errors, r.warnings], [[], []])
  const ps = sim(t, r.text)
  if (!ps) return
  const op = plot(ps, 'Operating Point'), ac = plot(ps, 'AC Analysis')
  near(re(op, 'v(w)')[0], 0.3, 1e-9, 'pot wiper')
  near(re(op, 'v(w2)')[0], 0.999, 1e-9, 'pos clamped to 0.999')
  const f = re(ac, 'frequency'), xb = vec(ac, 'v(xb)'), mag = f.map((_, i) => Math.hypot(xb.re[i], xb.im![i]))
  const k = mag.indexOf(Math.max(...mag))
  near(f[k], 10e6, 100, 'series resonance')
  near(mag[k], 50 / 110, 1e-3, 'ESR 10 Ω at resonance')
  assert.ok(mag[0] < mag[k] / 5, `10 kHz off resonance: ${mag[0]}`)
})
