import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptySheet, newPart, pins, uid, type Pt, type Sheet } from '../src/renderer/src/schematic/model.ts'
import type { Kind } from '../src/renderer/src/schematic/symbols.ts'
import { netlist, type NetlistResult } from '../src/renderer/src/schematic/netlist.ts'
import { parseRaw, type RawPlot } from '../src/main/rawfile.ts'
import { SAVE_CURRENTS, blame, currentVectors, findVector, opVoltages, voltageVector } from '../src/renderer/src/sim/probe.ts'

function flag(s: Sheet, q: Pt, n: string) {
  const f = newPart(s, n === '0' ? 'gnd' : 'label', q.x, q.y)
  if (n !== '0') f.value = n
  s.parts.push(f)
}
function put(s: Sheet, kind: Kind, x: number, nodes: string[], value?: string) {
  const p = newPart(s, kind, x, 0)
  if (value != null) p.value = value
  s.parts.push(p)
  pins(p).forEach((q, i) => nodes[i] && flag(s, q, nodes[i]))
  return p
}
// run ngspice -b -r; undefined if ngspice is missing (test skipped)
function run(t: TestContext, text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'prtest-'))
  writeFileSync(join(dir, 'c.cir'), text)
  const r = spawnSync('ngspice', ['-b', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  let plots: RawPlot[] = []
  try { plots = parseRaw(readFileSync(join(dir, 'o.raw'))) } catch {}
  return { status: r.status, log: r.stdout + r.stderr, stderr: r.stderr, plots }
}
const nl = (s: Sheet, directives: string) => (s.texts.push({ id: uid(), x: 0, y: 0, text: directives }), netlist(s, 'probe test'))

function bigSheet() {
  const s = emptySheet()
  const p = {
    v1: put(s, 'vsrc', 0, ['vdd', '0'], 'DC 5 AC 1'),
    r1: put(s, 'res', 100, ['vdd', 'Col'], '1k'),
    r2: put(s, 'res', 200, ['vdd', 'b'], '100k'),
    q1: put(s, 'npn', 300, ['Col', 'b', '0']),
    c1: put(s, 'cap', 400, ['Col', '0'], '1n'),
    l1: put(s, 'ind', 500, ['vdd', 'l'], '1m'),
    r3: put(s, 'res', 600, ['l', '0'], '1k'),
    i1: put(s, 'isrc', 700, ['0', 'dio'], 'DC 1m'),
    d1: put(s, 'diode', 800, ['dio', '0']),
    m1: put(s, 'nmos', 900, ['d', 'g', '0']),
    r4: put(s, 'res', 1000, ['vdd', 'd'], '10k'),
    v2: put(s, 'vsrc', 1100, ['g', '0'], 'DC 2'),
    e1: put(s, 'opamp', 1200, ['eo', 'b', 'Col']),
    r5: put(s, 'res', 1300, ['eo', '0'], '1k')
  }
  return { s, p }
}

test('voltageVector', () => {
  assert.equal(voltageVector('Out'), 'v(out)')
  assert.equal(voltageVector('0'), null)
})

test('savecurrents vectors in .op/.tran/.dc, branch-only in .ac/.noise; opVoltages (skipped if ngspice missing)', (t) => {
  const { s, p } = bigSheet()
  const r = nl(s, `${SAVE_CURRENTS}\n.op\n.tran 1u 10u\n.ac dec 2 1 1k\n.dc V1 4 5 0.5\n.noise v(Col) V1 dec 2 1 1k`)
  assert.deepEqual(r.errors, [])
  const out = run(t, r.text)
  if (!out) return
  assert.equal(out.status, 0, out.log)
  assert.doesNotMatch(out.stderr, /error/i)
  const plot = (name: string) => out.plots.find((x) => x.plotname === name)!
  const op = plot('Operating Point'), tran = plot('Transient Analysis'), dc = plot('DC transfer characteristic')
  const ac = plot('AC Analysis'), noise = plot('Noise Spectral Density Curves')
  const vec = (pl: RawPlot, id: keyof typeof p) => findVector(pl, currentVectors(p[id], r.refs[p[id].id]))
  const val = (pl: RawPlot, id: keyof typeof p) => pl.vars.find((v) => v.name === vec(pl, id))!.re[0]

  for (const pl of [op, tran, dc]) for (const id of Object.keys(p) as (keyof typeof p)[]) assert.ok(vec(pl, id), `${pl.plotname} ${id}`)
  assert.equal(vec(op, 'r1'), 'i(@r1[i])')
  assert.equal(vec(op, 'q1'), 'i(@q1[ic])')
  assert.equal(vec(op, 'm1'), 'i(@m1[id])')
  assert.equal(vec(op, 'd1'), 'i(@d1[id])')
  assert.equal(vec(op, 'i1'), 'i(@i1[current])')
  assert.equal(vec(op, 'v1'), 'i(v1)')
  assert.equal(vec(op, 'l1'), 'i(l1)')
  assert.equal(vec(op, 'e1'), 'i(e1)')
  for (const id of ['r1', 'c1', 'q1', 'd1', 'm1', 'i1'] as const) assert.equal(vec(ac, id), null, `ac ${id}: @ vectors are junk`)
  for (const id of ['v1', 'l1', 'e1'] as const) assert.ok(vec(ac, id), `ac ${id}`)
  assert.equal(vec(noise, 'r1'), null)

  const v = opVoltages(r, op)
  assert.equal(v['0'], 0)
  assert.equal(v.vdd, 5)
  assert.equal(v.g, 2)
  assert.ok(Math.abs(val(op, 'r1') - (5 - v.Col) / 1e3) < 1e-9) // @r[i] flows pin1 -> pin2
  assert.ok(Math.abs(val(op, 'l1') - 5e-3) < 1e-9)
  assert.ok(Math.abs(val(op, 'd1') - 1e-3) < 1e-6)
  assert.ok(val(op, 'q1') > 0 && val(op, 'm1') > 0)
  assert.ok(Math.abs(val(op, 'm1') - (5 - v.d) / 1e4) < 1e-9)
  assert.deepEqual(Object.keys(v).sort(), ['0', 'Col', 'b', 'd', 'dio', 'eo', 'g', 'l', 'vdd'])
})

// small netlist result for synthetic blame tests
const fake = (refs: Record<string, string>, nets: string[]): NetlistResult =>
  ({ text: '', errors: [], warnings: [], refs, nets: { x: nets }, wireNets: {} })

test('blame: real ngspice failures (skipped if ngspice missing)', (t) => {
  // unknown model; title deliberately mentions "error" and R1
  {
    const s = emptySheet()
    put(s, 'vsrc', 0, ['a', '0'])
    const r1 = put(s, 'res', 100, ['a', 'b'])
    const q1 = put(s, 'npn', 200, ['b', 'a', '0'], 'FOO')
    s.texts.push({ id: uid(), x: 0, y: 0, text: '.op' })
    const r = netlist(s, 'error in R1 circuit')
    const out = run(t, r.text)
    if (!out) return
    assert.notEqual(out.status, 0)
    const b = blame(out.log, r)
    assert.deepEqual(b.all, { parts: [q1.id], nets: [] })
    assert.ok(!b.all.parts.includes(r1.id))
    assert.ok(b.lines.some((l) => /can't find model 'foo'/.test(l.line) && /q1 b a 0 foo/.test(l.line)), JSON.stringify(b.lines))
  }
  // floating node (cap-only DC path): "singular matrix:  check node out" -> net "Out"
  {
    const s = emptySheet()
    put(s, 'vsrc', 0, ['a', '0'])
    put(s, 'res', 100, ['a', 'b'])
    put(s, 'cap', 200, ['b', 'Out'])
    put(s, 'res', 300, ['Out', 'c'])
    put(s, 'cap', 400, ['c', '0'], '1n')
    const r = nl(s, '.op')
    const out = run(t, r.text)!
    assert.match(out.log, /singular matrix:\s+check node out/)
    const b = blame(out.log, r)
    assert.deepEqual(b.all, { parts: [], nets: ['Out'] })
    assert.equal(b.lines.length, 1) // repeated warning deduped
  }
  // voltage-source loop: "check node v1#branch" -> V1
  {
    const s = emptySheet()
    const v1 = put(s, 'vsrc', 0, ['a', '0'])
    put(s, 'vsrc', 100, ['a', '0'], 'DC 2')
    put(s, 'res', 200, ['a', '0'])
    const r = nl(s, '.op')
    const out = run(t, r.text)!
    assert.match(out.log, /check node v1#branch/)
    assert.match(out.log, /Timestep too small/)
    assert.deepEqual(blame(out.log, r).all, { parts: [v1.id], nets: [] })
  }
  // bad value: "Error on line N or its substitute:" + echoed element on the next line
  {
    const s = emptySheet()
    put(s, 'vsrc', 0, ['a', '0'])
    const c1 = put(s, 'cap', 100, ['a', '0'], 'abc')
    const r = nl(s, '.op')
    const out = run(t, r.text)!
    assert.match(out.log, /unknown parameter \(abc\)/)
    const b = blame(out.log, r)
    assert.deepEqual(b.all, { parts: [c1.id], nets: [] })
    assert.ok(b.lines.some((l) => /^Error on line \d+ or its substitute: c1 a 0 abc$/.test(l.line)), JSON.stringify(b.lines))
  }
  // noise source without AC value
  {
    const s = emptySheet()
    const i1 = put(s, 'isrc', 0, ['0', 'a'])
    put(s, 'res', 100, ['a', '0'])
    const r = nl(s, '.noise v(a) I1 dec 2 1 1k')
    const out = run(t, r.text)!
    assert.match(out.log, /Noise input source i1 has no AC value/)
    assert.deepEqual(blame(out.log, r).all, { parts: [i1.id], nets: [] })
  }
  // savecurrents' AC warnings ("unrecognized variable - @r1[i]") must not blame anything
  {
    const s = emptySheet()
    put(s, 'vsrc', 0, ['a', '0'], 'AC 1')
    put(s, 'res', 100, ['a', '0'])
    const r = nl(s, SAVE_CURRENTS + '\n.ac dec 2 1 1k')
    const out = run(t, r.text)!
    assert.match(out.log, /unrecognized variable - @r1\[i\]/)
    assert.deepEqual(blame(out.log, r), { all: { parts: [], nets: [] }, lines: [] })
  }
})

test('blame: message formats from ngspice-47 source strings', () => {
  const r = fake({ p1: 'R1', p2: 'V1', p3: 'B1', p4: 'D1', p5: 'L1' }, ['N001', 'Out', 'a', 'in', '0'])
  const b = (log: string) => blame(log, r).all
  assert.deepEqual(b('Warning: singular matrix:  check nodes n001 and out'), { parts: [], nets: ['N001', 'Out'] })
  assert.deepEqual(b('doAnalyses: TRAN:  Timestep too small; time = 1e-06, timestep = 1e-21: trouble with node "n001"'), { parts: [], nets: ['N001'] })
  assert.deepEqual(b('doAnalyses: TRAN:  Timestep too small; initial timepoint: trouble with B-instance b1'), { parts: ['p3'], nets: [] })
  assert.deepEqual(b('Fatal error: instance v1 is a shorted VSRC'), { parts: ['p2'], nets: [] })
  assert.deepEqual(b('Warning: Value of resistor r1 is too small, set to 1.000000e-12'), { parts: ['p1'], nets: [] })
  assert.deepEqual(b('Warning: singular matrix:  check node l1#branch'), { parts: ['p5'], nets: [] })
  // no false positives: English "a", non-error lines, title echo, netlist listing tables
  assert.deepEqual(b('could not find a valid modelname'), { parts: [], nets: [] })
  assert.deepEqual(b('Circuit: * r1 error test\nNode  Voltage\nout  1.0\nr1 out 0 1k'), { parts: [], nets: [] })
  assert.deepEqual(b('Warning: r10 is fine; d1x too'), { parts: [], nets: [] }) // whole word only
  // the follow-up line is blamed only when it is not itself an error line, and an echoed element blames just itself
  const x = blame('Error on line 3 or its substitute:\n  d1 out a dmod\nNote: no such thing r1', r)
  assert.deepEqual(x, { all: { parts: ['p4'], nets: [] }, lines: [{ line: 'Error on line 3 or its substitute: d1 out a dmod', blame: { parts: ['p4'], nets: [] } }] })
})

test('phase 9 kinds: current vectors in .op/.tran, branch/T-line ones also in .ac (skipped if ngspice missing)', (t) => {
  const s = emptySheet()
  const p = {
    v1: put(s, 'vsrc', 0, ['in', '0'], 'DC 1 AC 1'),
    vs: put(s, 'vsrc', 100, ['in', 's'], 'DC 0'),
    rs: put(s, 'res', 200, ['s', '0'], '500'), // 2 mA through V2
    e1: put(s, 'vcvs', 300, ['eo', '0', 'in', '0'], '2'),
    re: put(s, 'res', 400, ['eo', '0'], '1k'),
    g1: put(s, 'vccs', 500, ['0', 'go', 'in', '0'], '1m'),
    rg: put(s, 'res', 600, ['go', '0'], '1k'),
    h1: put(s, 'ccvs', 700, ['ho', '0'], 'V2 1k'),
    rh: put(s, 'res', 800, ['ho', '0'], '1k'),
    f1: put(s, 'cccs', 900, ['0', 'fo'], 'V2 3'),
    rf: put(s, 'res', 1000, ['fo', '0'], '1k'),
    b1: put(s, 'bv', 1100, ['bo', '0'], 'V=V(in)*4'),
    rb: put(s, 'res', 1200, ['bo', '0'], '1k'),
    b2: put(s, 'bi', 1300, ['0', 'bi'], 'I=5m'),
    rbi: put(s, 'res', 1400, ['bi', '0'], '1k'),
    s1: put(s, 'sw', 1500, ['in', 'so', 'in', '0']),
    rso: put(s, 'res', 1600, ['so', '0'], '999'),
    w1: put(s, 'csw', 1700, ['in', 'wo'], 'V2 CSW'),
    rwo: put(s, 'res', 1800, ['wo', '0'], '999'),
    t1: put(s, 'tline', 1900, ['in', '0', 'to', '0']),
    rt: put(s, 'res', 2000, ['to', '0'], '100'),
    rx: put(s, 'res', 2100, ['in', 'xp'], '1'),
    x1: put(s, 'xfmr', 2200, ['xp', '0', 'xs', '0']),
    rxs: put(s, 'res', 2300, ['xs', '0'], '1k')
  }
  const r = nl(s, `${SAVE_CURRENTS}\n.op\n.ac lin 1 1k 1k\n.tran 1u 2u`)
  assert.deepEqual([r.errors, r.warnings], [[], []])
  const out = run(t, r.text)
  if (!out) return
  assert.equal(out.status, 0, out.log)
  const [op, ac, tr] = ['Operating Point', 'AC Analysis', 'Transient Analysis'].map((n) => out.plots.find((x) => x.plotname === n)!)
  const ids = ['e1', 'g1', 'h1', 'f1', 'b1', 'b2', 's1', 'w1', 't1', 'x1'] as const
  const vec = (pl: RawPlot, id: (typeof ids)[number]) => findVector(pl, currentVectors(p[id], r.refs[p[id].id]))
  for (const pl of [op, tr]) assert.deepEqual(ids.map((id) => vec(pl, id)), ['i(e1)', 'i(@g1[i])', 'i(h1)', 'i(@f1[i])', 'i(b1)', 'i(@b2[i])', 'i(@s1[i])', 'i(@w1[i])', 'v(t1#i1)', 'i(lxf1_p)'])
  assert.deepEqual(ids.map((id) => vec(ac, id)), ['i(e1)', null, 'i(h1)', null, 'i(b1)', null, null, null, 'v(t1#i1)', 'i(lxf1_p)'])
  const near = (pl: RawPlot, id: (typeof ids)[number], want: number) => {
    const v = pl.vars.find((x) => x.name === vec(pl, id))!.re[0]
    assert.ok(Math.abs(Math.abs(v) - want) < 1e-6, `${pl.plotname} ${id} ${v} want ±${want}`)
  }
  for (const pl of [op, tr]) {
    near(pl, 'e1', 2e-3), near(pl, 'g1', 1e-3), near(pl, 'h1', 2e-3), near(pl, 'f1', 6e-3), near(pl, 'b1', 4e-3), near(pl, 'b2', 5e-3)
    near(pl, 't1', 1e-2) // DC: 1 V into 100 Ω through the line
    near(pl, 'x1', 1) // DC: the primary is a short behind 1 Ω
  }
  near(tr, 's1', 1e-3), near(tr, 'w1', 1e-3) // on: 1 V across 1 Ω + 999 Ω
  near(op, 's1', 1e-9), near(op, 'w1', 1e-9) // ngspice-47 .op quirk: switch @[i] uses Roff (see SAVE_CURRENTS note)
})
