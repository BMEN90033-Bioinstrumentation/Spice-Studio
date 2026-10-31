import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptySheet, exampleSheet, newPart, pins, route, uid, type Pt, type Sheet } from '../src/renderer/src/schematic/model.ts'
import type { Kind } from '../src/renderer/src/schematic/symbols.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'
import { parseRaw } from '../src/main/rawfile.ts'

// place a flag at a point: '0' -> ground symbol, else a net label
function flag(s: Sheet, q: Pt, n: string) {
  const f = newPart(s, n === '0' ? 'gnd' : 'label', q.x, q.y)
  if (n !== '0') f.value = n
  s.parts.push(f)
}
// place a part and hang a flag on each named pin ('' = leave the pin alone)
function put(s: Sheet, kind: Kind, x: number, nodes: string[] = [], value?: string) {
  const p = newPart(s, kind, x, 0)
  if (value != null) p.value = value
  s.parts.push(p)
  pins(p).forEach((q, i) => nodes[i] && flag(s, q, nodes[i]))
  return p
}
const op = (s: Sheet) => (s.texts.push({ id: uid(), x: 0, y: 0, text: '.op' }), s)

// run ngspice -b -r; returns the plots, or undefined (test skipped) if ngspice is missing
function sim(t: TestContext, text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'nltest-'))
  writeFileSync(join(dir, 'c.cir'), text)
  const r = spawnSync('ngspice', ['-b', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stderr, /error/i)
  return parseRaw(readFileSync(join(dir, 'o.raw')))
}

const GOLDEN = `* schematic
V1 N001 0 DC 0 AC 1 PULSE(0 1 0 1u 1u 5m 10m)
R1 N001 out 1k
C1 out 0 1u
.tran 10u 20m
.ac dec 50 1 100k
.end
`

test('exampleSheet -> golden netlist, clean', () => {
  const s = exampleSheet()
  const r = netlist(s)
  assert.equal(r.text, GOLDEN)
  assert.deepEqual([r.errors, r.warnings], [[], []])
  const [v1, r1, c1, g1, g2, out] = s.parts.map((p) => r.nets[p.id])
  assert.deepEqual([v1, r1, c1, g1, g2, out], [['N001', '0'], ['N001', 'out'], ['out', '0'], ['0'], ['0'], ['out']])
  assert.deepEqual(s.wires.map((w) => r.wireNets[w.id]), ['N001', 'N001', 'out', 'out'])
  assert.match(netlist(s, 'rc').text, /^\* rc\n/)
})

test('exampleSheet simulates: AC |v(out)| matches the RC formula (skipped if ngspice missing)', (t) => {
  const plots = sim(t, netlist(exampleSheet()).text)
  if (!plots) return
  const ac = plots.find((p) => p.plotname === 'AC Analysis')!
  const v = ac.vars.find((x) => x.name === 'v(out)')!
  const f = ac.vars[0].re, i = f.length - 1
  const expected = 1 / Math.hypot(1, 2 * Math.PI * f[i] * 1e3 * 1e-6)
  assert.ok(Math.abs(Math.hypot(v.re[i], v.im![i]) - expected) < 1e-3)
})

test('BJT, MOSFET and diode default models simulate (.op)', (t) => {
  const s = emptySheet()
  put(s, 'vsrc', 0, ['vdd', '0'], 'DC 5')
  put(s, 'res', 100, ['vdd', 'c'], '1k')
  put(s, 'res', 200, ['vdd', 'b'], '100k')
  put(s, 'npn', 300, ['c', 'b', '0'])
  put(s, 'pnp', 400, ['0', 'b2', 'vdd'])
  put(s, 'res', 500, ['b2', '0'], '100k')
  put(s, 'res', 600, ['vdd', 'd'], '10k')
  put(s, 'vsrc', 700, ['g', '0'], 'DC 2')
  put(s, 'nmos', 800, ['d', 'g', '0'])
  put(s, 'pmos', 900, ['dp', '0', 'vdd'])
  put(s, 'res', 1000, ['dp', '0'], '10k')
  put(s, 'diode', 1100, ['vdd', 'x'])
  put(s, 'res', 1200, ['x', '0'])
  const r = netlist(op(s))
  assert.deepEqual([r.errors, r.warnings], [[], []])
  for (const m of ['.model NPN NPN', '.model PNP PNP', '.model NMOS NMOS', '.model PMOS PMOS', '.model D D']) assert.ok(r.text.includes(m + (m.endsWith('MOS') ? ' ' : '\n')), m)
  const plots = sim(t, r.text)
  if (!plots) return
  const v = (n: string) => plots[0].vars.find((x) => x.name === `v(${n})`)!.re[0]
  assert.ok(v('c') > 0.1 && v('c') < 4.9, `npn collector ${v('c')}`)
  assert.ok(v('d') > 0.1 && v('d') < 4.9, `nmos drain ${v('d')}`)
})

test('T-junctions join nets; dangling wire ends do not warn', () => {
  const s = emptySheet()
  const v1 = put(s, 'vsrc', 0, ['', '0'])
  const r1 = put(s, 'res', 100, ['', '0'])
  s.wires.push(...route({ x: -50, y: -60 }, { x: 150, y: -60 }), ...route({ x: 0, y: -60 }, { x: 0, y: -30 }), ...route({ x: 100, y: -60 }, { x: 100, y: -30 }))
  const r = netlist(op(s))
  assert.deepEqual([r.errors, r.warnings], [[], []])
  assert.deepEqual([r.nets[v1.id][0], r.nets[r1.id][0]], ['N001', 'N001'])
  assert.deepEqual(Object.values(r.wireNets), ['N001', 'N001', 'N001'])
})

test('a part dropped on a wire interior is not connected', () => {
  const s: Sheet = { ...emptySheet(), wires: route({ x: 0, y: -100 }, { x: 0, y: 100 }) }
  put(s, 'res', 0)
  flag(s, { x: 0, y: 100 }, '0')
  const r = netlist(op(s))
  assert.deepEqual(r.warnings, ['R1 pin 1 is unconnected', 'R1 pin 2 is unconnected'])
  assert.deepEqual(r.nets[s.parts[0].id], ['N001', 'N002'])
  assert.equal(r.wireNets[s.wires[0].id], '0')
})

test('same-name labels on separate islands join; case-insensitive', () => {
  const s = emptySheet()
  const v1 = put(s, 'vsrc', 0, ['a', '0'])
  const r1 = put(s, 'res', 100, ['A', '0'])
  const r = netlist(op(s))
  assert.deepEqual([r.errors, r.warnings], [[], []])
  assert.equal(r.nets[v1.id][0], 'a')
  assert.equal(r.nets[r1.id][0], 'a')
})

test('a label named gnd or 0 is ground', () => {
  const s = emptySheet()
  const v1 = put(s, 'vsrc', 0, ['x', 'GND'])
  put(s, 'res', 100, ['x', '0'])
  const r = netlist(op(s))
  assert.deepEqual([r.errors, r.warnings], [[], []])
  assert.equal(r.nets[v1.id][1], '0')
  assert.match(r.text, /^V1 x 0 DC 1$/m)
})

test('two label names on one net: warning, first alphabetically wins', () => {
  const s = emptySheet()
  const v1 = put(s, 'vsrc', 0, ['zed', '0'])
  flag(s, pins(v1)[0], 'abc')
  put(s, 'res', 100, ['abc', '0'])
  const r = netlist(op(s))
  assert.deepEqual(r.warnings, ['Net has several labels (abc, zed); using "abc"'])
  assert.equal(r.nets[v1.id][0], 'abc')
})

test('auto names skip label names', () => {
  const s = emptySheet()
  const v1 = put(s, 'vsrc', 0, ['', '0'])
  put(s, 'res', 100, ['n001', '0'])
  put(s, 'res', 200, ['n001', '0'])
  s.wires.push(...route(pins(v1)[0], { x: 0, y: -50 }))
  assert.equal(netlist(op(s)).nets[v1.id][0], 'N002')
})

test('invalid label, missing ground, empty value, empty sheet -> errors', () => {
  for (const bad of ['', 'my net', 'a=b', 'f(x)', '"q"']) {
    const s = emptySheet()
    flag(s, pins(put(s, 'res', 0, ['', '0']))[0], bad)
    const r = netlist(op(s))
    assert.match(r.errors.join(), /Invalid net label/, bad)
    assert.equal(r.text, '')
  }
  const s = emptySheet()
  put(s, 'res', 0, ['a', 'b'])
  assert.match(netlist(op(s)).errors.join(), /No ground: add a ground symbol \(G\)/)
  s.parts[0].value = ' '
  assert.match(netlist(op(s)).errors.join(), /R1 has no value/)
  assert.match(netlist(emptySheet()).errors.join(), /Empty schematic/)
})

test('names: auto-prefix warning, duplicates (case-insensitive) error', () => {
  const s = emptySheet()
  put(s, 'res', 0, ['a', '0']).name = 'load'
  const r = netlist(op(s))
  assert.deepEqual(r.warnings, ['load: SPICE needs names starting with "R", using Rload'])
  assert.match(r.text, /^Rload a 0 1k$/m)
  put(s, 'res', 100, ['a', '0']).name = 'rLOAD'
  assert.deepEqual(netlist(op(s)).errors, ['Duplicate part name rLOAD'])
})

test('default models: once each, suppressed by a user .model', () => {
  const s = emptySheet()
  put(s, 'diode', 0, ['a', '0'])
  put(s, 'diode', 100, ['a', '0'])
  put(s, 'vsrc', 200, ['a', '0'])
  op(s)
  assert.equal(netlist(s).text.match(/\.model D D/g)!.length, 1)
  s.texts.push({ id: uid(), x: 0, y: 0, text: '.MODEL d D(is=1e-12)' })
  assert.doesNotMatch(netlist(s).text, /\.model D D\n/)
  s.parts[0].value = 'D1N4148'
  s.parts[1].value = 'D1N4148'
  assert.doesNotMatch(netlist(s).text, /\.model D D\n/)
})

test('opamp is a VCVS to ground; MOS body tied to source', () => {
  const s = emptySheet()
  put(s, 'opamp', 0, ['out', 'inp', 'inn'])
  put(s, 'nmos', 100, ['d', 'g', 's'])
  put(s, 'res', 200, ['s', '0'])
  const r = netlist(op(s))
  assert.match(r.text, /^E1 out 0 inp inn 1e6$/m)
  assert.match(r.text, /^M1 d g s s NMOS$/m)
})

test('directives: verbatim in sheet order, bare .end dropped, missing analysis warns', () => {
  const s = emptySheet()
  put(s, 'res', 0, ['a', '0'])
  put(s, 'vsrc', 100, ['a', '0'])
  s.texts.push({ id: uid(), x: 0, y: 0, text: '.control\nop\nprint v(a)\n.endc\n .END ' }, { id: uid(), x: 0, y: 0, text: '.param k=2' })
  const r = netlist(s)
  assert.deepEqual(r.warnings, [])
  assert.ok(r.text.endsWith('V1 a 0 DC 1\n.control\nop\nprint v(a)\n.endc\n.param k=2\n.end\n'), r.text)
  s.texts = [{ id: uid(), x: 0, y: 0, text: '.param k=2' }]
  assert.match(netlist(s).warnings.join(), /No analysis directive/)
})
