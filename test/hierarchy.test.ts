import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blockShape, emptySheet, newPart, pins, uid, type Part, type Pt, type Sheet } from '../src/renderer/src/schematic/model.ts'
import type { Kind } from '../src/renderer/src/schematic/symbols.ts'
import { netlist, type NetCtx } from '../src/renderer/src/schematic/netlist.ts'
import { TEMPLATES } from '../src/renderer/src/schematic/templates.ts'
import { BUNDLED, resolver, type LibEntry } from '../src/renderer/src/library/library.ts'
import { parseRaw } from '../src/main/rawfile.ts'

// flag at a point: '0' ground, 'P:name' sheet port, else a net label
function flag(s: Sheet, q: Pt, n: string) {
  const port = n.startsWith('P:')
  const f = newPart(s, n === '0' ? 'gnd' : port ? 'port' : 'label', q.x, q.y)
  if (n !== '0') f.value = port ? n.slice(2) : n
  s.parts.push(f)
}
let col = 0
function put(s: Sheet, kind: Kind, nodes: string[] = [], value?: string, extra?: Partial<Part>) {
  const p = newPart(s, kind, (col += 200), 0, 0, false, extra)
  if (value != null) p.value = value
  s.parts.push(p)
  pins(p).forEach((q, i) => nodes[i] && flag(s, q, nodes[i]))
  return p
}
const dir = (s: Sheet, text: string) => (s.texts.push({ id: uid(), x: 0, y: 0, text }), s)
const block = (s: Sheet, sheet: string, ports: string[], nodes: string[]) => put(s, 'block', nodes, sheet.replace('.nsch', ''), { sheet, ...blockShape(ports) })

// in -[R]- out -[C]- gnd, as a sheet with ports in/out
function rc(r = '1k', c = '1u') {
  const f = emptySheet()
  put(f, 'res', ['P:in', 'P:out'], r)
  put(f, 'cap', ['P:out', '0'], c)
  return f
}

function sim(t: TestContext, text: string) {
  const d = mkdtempSync(join(tmpdir(), 'hiertest-'))
  writeFileSync(join(d, 'c.cir'), text)
  const r = spawnSync('ngspice', ['-b', '-r', join(d, 'o.raw'), join(d, 'c.cir')], { encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(r.stderr, /error/i)
  return parseRaw(readFileSync(join(d, 'o.raw')))
}
const opv = (plots: ReturnType<typeof parseRaw>, net: string) => plots.find((p) => /operating point/i.test(p.plotname))!.vars.find((v) => v.name === `v(${net})`)!.re[0]

const GOLDEN = `* hier
V1 in 0 DC 0 AC 1
X1 in out filter
.ac dec 10 1 1k
.subckt filter in out
R1 in out 1k
C1 out 0 1u
.ends filter
.end
`

test('hierarchical golden: block -> X line + .subckt from the sheet ports', () => {
  const m = emptySheet()
  put(m, 'vsrc', ['in', '0'], 'DC 0 AC 1')
  const x = block(m, 'filter.nsch', ['in', 'out'], ['in', 'out'])
  dir(m, '.ac dec 10 1 1k')
  const r = netlist(m, 'hier', { sheets: { 'main.nsch': m, 'filter.nsch': rc() } })
  assert.deepEqual([r.errors, r.warnings], [[], []])
  assert.equal(r.text, GOLDEN)
  assert.deepEqual([r.refs[x.id], r.nets[x.id]], ['X1', ['in', 'out']])
})

test('nested two levels, reused sheets emitted once, block pins mapped by name', () => {
  const amp = emptySheet()
  block(amp, 'filter.nsch', ['out', 'in'], ['P:a', 'mid']) // pins listed out-of-order: mapped by name
  block(amp, 'filter.nsch', ['in', 'out'], ['mid', 'P:b'])
  const m = dir(emptySheet(), '.op')
  put(m, 'vsrc', ['in', '0'])
  block(m, 'amp.nsch', ['a', 'b'], ['in', 'out'])
  block(m, 'amp.nsch', ['a', 'b'], ['out', 'out2'])
  put(m, 'res', ['out2', '0'])
  const r = netlist(m, 'n', { sheets: { 'amp.nsch': amp, 'filter.nsch': rc() } })
  assert.deepEqual([r.errors, r.warnings], [[], []])
  assert.equal(r.text.match(/^\.subckt/gm)!.length, 2)
  assert.match(r.text, /^\.subckt filter in out\n[^]*\.ends filter\n\.subckt amp a b\nX1 mid a filter\nX2 mid b filter\n\.ends amp\n/m)
  assert.match(r.text, /^X1 in out amp\nX2 out out2 amp$/m)
})

test('errors: missing sheet, pin mismatch, cycles (including the top sheet)', () => {
  const m = dir(emptySheet(), '.op')
  put(m, 'vsrc', ['in', '0'])
  block(m, 'gone.nsch', ['in'], ['in'])
  assert.deepEqual(netlist(m, '', { sheets: {} }).errors, ['X1: sheet "gone.nsch" not found'])
  m.parts.at(-2)!.sheet = 'filter.nsch'
  assert.deepEqual(netlist(m, '', { sheets: { 'filter.nsch': rc() } }).errors, ['X1: pins (in) don\'t match the ports of "filter.nsch" (in, out); update the block'])

  const a = emptySheet(), b = emptySheet()
  block(a, 'b.nsch', ['x'], ['P:x'])
  block(b, 'a.nsch', ['x'], ['P:x'])
  m.parts.at(-2)!.sheet = 'a.nsch'
  m.parts.at(-2)!.pins = blockShape(['x']).pins
  const r = netlist(m, '', { sheets: { 'a.nsch': a, 'b.nsch': b } })
  assert.deepEqual(r.errors, ['b.nsch: Hierarchy cycle: a.nsch → b.nsch → a.nsch'])
  assert.equal(r.text, '')
  const self = dir(emptySheet(), '.op')
  put(self, 'vsrc', ['in', '0'])
  block(self, 'main.nsch', [], [])
  assert.deepEqual(netlist(self, '', { sheets: { 'main.nsch': self } }).errors, ['Hierarchy cycle: main.nsch → main.nsch'])
})

test('sub-sheets: analyses dropped with a warning, other directives kept; port rules', () => {
  const f = dir(dir(rc(), '.tran 1u 1m\n.param k=2'), '.control\nrun\n.endc')
  const m = dir(emptySheet(), '.op')
  put(m, 'vsrc', ['in', '0'])
  block(m, 'f.nsch', ['in', 'out'], ['in', ''])
  let r = netlist(m, '', { sheets: { 'f.nsch': f } })
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, ['X1 pin "out" is unconnected', 'f.nsch: Analysis directives ignored: only the top sheet\'s analyses run'])
  assert.match(r.text, /C1 out 0 1u\n\.param k=2\n\.ends f\n/)
  assert.doesNotMatch(r.text, /\.tran|\.control|^run$/m)

  flag(f, pins(f.parts[0])[0], 'P:out') // short in to out
  r = netlist(m, '', { sheets: { 'f.nsch': f } })
  assert.match(r.errors.join('\n'), /f\.nsch: Port "out" is connected to port\/net "in"/)
  // a port on the top sheet is just a net name
  const t = dir(emptySheet(), '.op')
  put(t, 'vsrc', ['P:a', '0'])
  r = netlist(t)
  assert.deepEqual([r.errors, r.warnings], [[], ['Top sheet has ports (a); they act as net labels here']])
  assert.match(r.text, /^V1 a 0 DC 1$/m)
})

test('subckt names: sanitised, unique against each other and library subckts', () => {
  const m = dir(emptySheet(), '.op')
  put(m, 'vsrc', ['in', '0'])
  for (const f of ['sub/my-filter.nsch', 'a.b.nsch', 'a_b.nsch', 'TL072.nsch']) block(m, f, ['in', 'out'], ['in', ''])
  const tl: LibEntry = { id: 'x:TL072', name: 'TL072', category: 'Op-amps', kind: 'opamp5', description: '', value: 'TL072', source: 'project', spice: { type: 'subckt', name: 'TL072', pins: ['1', '2', '3', '4', '5'], pinMap: [0, 1, 2, 3, 4], include: 'libs/tl.lib' } }
  put(m, 'opamp5', ['in', '0', '0', '0', 'in'], 'TL072', { lib: tl.id })
  const sheets = Object.fromEntries(['sub/my-filter.nsch', 'a.b.nsch', 'a_b.nsch', 'TL072.nsch'].map((f) => [f, rc()]))
  const r = netlist(m, '', { sheets, lib: resolver([tl]) })
  assert.deepEqual(r.errors, [])
  assert.deepEqual([...r.text.matchAll(/^\.subckt (\S+)/gm)].map((x) => x[1]), ['my_filter', 'a_b', 'a_b_2', 'TL072_2'])
})

// library parts with hand-written entries (independent of the bundled set)
const E = (id: string, kind: Kind, spice: LibEntry['spice']): LibEntry => ({ id, name: id, category: 'Subcircuits', kind, description: '', value: spice?.name ?? '1k', source: 'project', spice })
const Q = E('t:Q', 'npn', { type: 'model', name: 'QX', text: '.model QX NPN(BF=100)' })
const OA = E('t:OA', 'opamp5', { type: 'subckt', name: 'OAX', pins: ['out', 'vp', 'vn', 'inn', 'inp'], pinMap: [4, 3, 1, 2, 0], text: '.subckt OAX out vp vn inn inp\n.ends OAX' })
const INC = E('t:INC', 'npn', { type: 'subckt', name: 'QSUB', pins: ['c', 'b', 'e'], pinMap: [0, 1, 2], include: 'libs/my parts.lib' })
const INC2 = E('t:INC2', 'npn', { type: 'subckt', name: 'QSUB2', pins: ['c', 'b', 'e'], pinMap: [0, 1, 2], include: 'libs/my parts.lib' })

test('library parts: models once per entry, subckt pinMap order, .include once, unknown id', () => {
  const s = dir(emptySheet(), '.op')
  put(s, 'vsrc', ['c', '0'])
  put(s, 'npn', ['c', 'b', '0'], 'QX', { lib: Q.id })
  put(s, 'npn', ['c', 'b', '0'], 'QX', { lib: Q.id })
  put(s, 'opamp5', ['ip', 'im', 'vp', 'vn', 'o'], 'OAX', { lib: OA.id })
  put(s, 'npn', ['c', 'b', '0'], 'QSUB', { lib: INC.id })
  put(s, 'npn', ['c', 'b', '0'], 'QSUB2', { lib: INC2.id })
  const ctx: NetCtx = { lib: resolver([Q, OA, INC, INC2]) }
  const r = netlist(s, '', ctx)
  assert.deepEqual(r.errors, [])
  assert.equal(r.text.match(/\.model QX/g)!.length, 1)
  assert.match(r.text, /^X1 o vp vn im ip OAX$/m)
  assert.match(r.text, /^XQ3 c b 0 QSUB$/m) // subckt behind a transistor symbol: X-prefixed, no warning
  assert.equal(r.text.match(/^\.include "libs\/my parts\.lib"$/gm)!.length, 1)
  assert.ok(r.text.indexOf('.include') > r.text.indexOf('.op'), 'library text goes after the directives')
  assert.deepEqual(r.warnings.filter((w) => /SPICE needs/.test(w)), [])
  assert.doesNotMatch(r.text, /\.model NPN NPN/) // no default model for library-backed parts
  const u = dir(emptySheet(), '.op')
  put(u, 'diode', ['a', '0'], 'D', { lib: 'std:nope' })
  assert.deepEqual(netlist(u, '', ctx).errors, ['D1: unknown library part "std:nope"'])
})

test('hierarchical netlist simulates in ngspice: cascaded dividers (skipped if ngspice missing)', (t) => {
  const div = emptySheet()
  put(div, 'res', ['P:in', 'P:out'])
  put(div, 'res', ['P:out', '0'])
  const top = dir(emptySheet(), '.op')
  put(top, 'vsrc', ['in', '0'])
  block(top, 'div.nsch', ['in', 'out'], ['in', 'mid'])
  block(top, 'div.nsch', ['in', 'out'], ['mid', 'out'])
  const r = netlist(top, 'div', { sheets: { 'div.nsch': div } })
  assert.deepEqual([r.errors, r.warnings], [[], []])
  const plots = sim(t, r.text)
  if (!plots) return
  assert.ok(Math.abs(opv(plots, 'mid') - 0.4) < 1e-6 && Math.abs(opv(plots, 'out') - 0.2) < 1e-6)
})

test('templates netlist cleanly with the bundled library and simulate (skipped if ngspice missing)', (t) => {
  assert.deepEqual(TEMPLATES.map((x) => x.id), ['rc', 'bjt-ce', 'opamp-inv', 'hier'])
  const lib = resolver(BUNDLED)
  for (const tp of TEMPLATES) {
    const r = netlist(tp.sheets['main.nsch'], tp.name, { sheets: tp.sheets, lib })
    assert.deepEqual([r.errors, r.warnings], [[], []], tp.id)
    // add an operating point to check bias where it's meaningful
    const plots = sim(t, r.text.replace(/\.end\n$/, '.op\n.end\n'))
    if (!plots) return
    if (tp.id === 'bjt-ce') assert.ok(Math.abs(opv(plots, 'out') - 6.85) < 0.5, `Vc ${opv(plots, 'out')}`)
    if (tp.id === 'opamp-inv') {
      const ac = plots.find((p) => p.plotname === 'AC Analysis')!, v = ac.vars.find((x) => x.name === 'v(out)')!
      assert.ok(Math.abs(Math.hypot(v.re[0], v.im![0]) - 10) < 0.01, 'gain -10 at 10 Hz')
    }
    if (tp.id === 'hier') {
      const ac = plots.find((p) => p.plotname === 'AC Analysis')!, v = ac.vars.find((x) => x.name === 'v(out)')!, i = v.re.length - 1
      assert.ok(Math.hypot(v.re[0], v.im![0]) > 0.99 && Math.hypot(v.re[i], v.im![i]) < 1e-3, 'two-pole low-pass')
    }
  }
})

test('power flags on a sub-sheet are global, like ground', (t) => {
  const pwr = (s: Sheet, q: Pt, n: string) => { const f = newPart(s, 'power', q.x, q.y); f.value = n; s.parts.push(f) }
  // sub-sheet: VCC -[1k]- out -[1k]- gnd; out = 5 V only if its VCC is the top sheet's VCC
  const div = emptySheet()
  pwr(div, pins(put(div, 'res', ['', 'P:out'], '1k'))[0], 'VCC')
  put(div, 'res', ['P:out', '0'], '1k')
  const m = dir(emptySheet(), '.op')
  pwr(m, pins(put(m, 'vsrc', ['', '0'], 'DC 10'))[0], 'VCC')
  block(m, 'div.nsch', ['out'], ['out'])
  const r = netlist(m, 'g', { sheets: { 'main.nsch': m, 'div.nsch': div } })
  assert.deepEqual([r.errors, r.warnings], [[], []])
  assert.match(r.text, /^\.global VCC$/m)
  const plots = sim(t, r.text)
  if (plots) assert.ok(Math.abs(opv(plots, 'out') - 5) < 1e-6, String(opv(plots, 'out')))
})

test('no .global for flat sheets', () => {
  const m = dir(emptySheet(), '.op')
  put(m, 'vsrc', ['VCC', '0'], 'DC 1')
  const p = newPart(m, 'power', 0, 0)
  p.value = 'VCC'
  m.parts.push(p)
  assert.doesNotMatch(netlist(m).text, /\.global/)
})
