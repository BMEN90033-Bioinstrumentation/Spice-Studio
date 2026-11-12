// LTspice .asc / KiCad .kicad_sch import: hand-written fixtures in test/fixtures, checked through the netlist the
// imported sheet produces (connectivity, values, library parts), plus one simulation.
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importAsc, importKicad, importSchematic, sexpr } from '../src/renderer/src/schematic/importer.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'
import { parseSheet, type Sheet } from '../src/renderer/src/schematic/model.ts'
import { BUNDLED, resolver } from '../src/renderer/src/library/library.ts'
import { parseRaw } from '../src/main/rawfile.ts'

const fx = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f), 'latin1')
const lib = { lib: resolver(BUNDLED) }
const placeholder = (s: Sheet) => s.parts.filter((p) => p.kind === 'block' && !p.sheet && !p.lib)
// element and directive lines only (no library text, models or comments)
const body = (s: Sheet) => {
  const t = netlist(s, 'x', lib).text.split('\n')
  return t.slice(1, t.findIndex((l) => /^\.(subckt|model|end)\b/i.test(l)))
}

test('LTspice: RC into a transistor; rotations, pin-to-pin joins, flags, directives, notes, a placeholder', () => {
  const r = importAsc(fx('rc-follower.asc'))
  const ph = placeholder(r.sheet)
  assert.deepEqual(ph.map((p) => [p.name, p.value]), [['Y1', '?xtal']])
  assert.match(netlist(r.sheet, 'x', lib).errors.join('\n'), /Y1: placeholder for the imported part "xtal"/)
  assert.ok(r.report.some((l) => /Y1: LTspice symbol "Misc\\\\xtal" has no equivalent/.test(l)), r.report.join('\n'))
  r.sheet.parts = r.sheet.parts.filter((p) => !ph.includes(p))
  const n = netlist(r.sheet, 'x', lib)
  assert.deepEqual([n.errors, n.warnings], [[], []])
  assert.deepEqual(body(r.sheet), [
    'V1 N001 0 SIN(0 10m 1k) AC 1', // SINE( -> SIN(, Value2 appended
    'R1 out N001 1k', // R90: pin A on the out node
    'C1 out 0 100n',
    'Q1 vcc out 0 2N3904', // the bundled 2N3904 (its .model comes along)
    'V2 vcc 0 5',
    '.tran 0 5m',
    '.ac dec 10 1 100k'
  ])
  assert.equal(r.sheet.parts.find((p) => p.name === 'Q1')!.lib, 'std:2N3904')
  assert.deepEqual(r.sheet.draw!.map((d) => d.t), ['rect', 'note'])
  assert.deepEqual(parseSheet(JSON.stringify(r.sheet)), r.sheet) // a valid .nsch
})

test('LTspice: vendor op-amp -> generic macromodel by pin layout, ideal op-amp, mirrored part, .lib opamp.sub dropped', () => {
  const r = importSchematic('x.asc', fx('opamps.asc'))
  assert.deepEqual(body(r.sheet), ['XU1 0 in vcc vee N001 OA_GENERIC', 'EU2 out 0 0 N001 1e6', 'R1 in 0 10k', '.op'])
  assert.ok(r.report.some((l) => /U1: LT1001 placed as the generic op-amp model OA_GENERIC/.test(l)))
})

test('KiCad: s-expressions, rotation, mirror, power symbols, junction at a crossing, Sim.* source, placeholder, report', () => {
  const r = importKicad(fx('rc-follower.kicad_sch'))
  const ph = placeholder(r.sheet)
  assert.deepEqual(ph.map((p) => [p.name, p.value, p.pins!.length]), [['TP1', '?TestPoint', 1]])
  assert.ok(r.report.includes('1 bus not converted'), r.report.join('\n'))
  r.sheet.parts = r.sheet.parts.filter((p) => !ph.includes(p))
  const n = netlist(r.sheet, 'x', lib)
  assert.deepEqual([n.errors, n.warnings], [[], []])
  assert.deepEqual(body(r.sheet), [
    'V1 N001 0 DC 0 AC 1 SIN(0 1 1k 0 0 0)',
    'R1 N001 out 1k', // rotated 90°: pin 1 on the left
    'C1 out 0 100n',
    'Q1 VCC out 0 BC547B', // pins mapped by name (C B E), the bundled BC547B
    'V2 VCC 0 5',
    'D1 out 0 1N4148', // mirrored: anode on the left, at the second "out" label
    'R3 0 mid 1k', // joined to "mid" only through the junction where two wires cross
    '.tran 10u 5m',
    '.op'
  ])
  assert.ok(r.sheet.draw!.some((d) => d.t === 'note' && d.text === 'Hand-written "KiCad" fixture'))
})

test('sexpr: nesting, quoted strings with escapes, atoms; unbalanced input throws', () => {
  assert.deepEqual(sexpr('(a "b \\"c\\"\\nd" (e 1.5) f)'), ['a', 'b "c"\nd', ['e', '1.5'], 'f'])
  assert.throws(() => sexpr('(a (b)'), /Unbalanced/)
  assert.throws(() => importKicad('(not_kicad)'), /Not a KiCad/)
  assert.throws(() => importSchematic('x.sch', ''), /\.asc/)
})

test('the imported LTspice sheet simulates in ngspice: operating point (skipped if ngspice missing)', (t: TestContext) => {
  const r = importAsc(fx('rc-follower.asc'))
  r.sheet.parts = r.sheet.parts.filter((p) => !placeholder(r.sheet).includes(p))
  const dir = mkdtempSync(join(tmpdir(), 'imptest-'))
  writeFileSync(join(dir, 'c.cir'), netlist(r.sheet, 'x', lib).text.replace(/^\.tran.*$|^\.ac.*$/gm, '').replace(/^\.end$/m, '.op\n.end'))
  const p = spawnSync('ngspice', ['-b', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { encoding: 'utf8' })
  if (p.error) return void t.skip('ngspice not on PATH')
  assert.equal(p.status, 0, p.stderr)
  const [op] = parseRaw(readFileSync(join(dir, 'o.raw')))
  const v = (n: string) => op.vars.find((x) => x.name.toLowerCase() === `v(${n})`)!.re[0]
  assert.ok(Math.abs(v('vcc') - 5) < 1e-6)
  assert.ok(Math.abs(v('out')) < 1e-3) // base at 0 V DC through R1 from V1 (DC 0)
})

test('LTspice directives ngspice rejects are fixed up and reported', () => {
  const r = importAsc('Version 4\nSHEET 1 880 680\nTEXT 0 0 Left 2 !.tran 25m startup\\n.backanno\\n.op\n')
  assert.deepEqual(r.sheet.texts.map((t) => t.text), ['.tran 0.000025 25m\n.op'])
  assert.ok(r.report.some((l) => /startup/.test(l)))
})

test('imported .control blocks are commented out (untrusted file), outside .include/.lib paths reported', () => {
  const r = importAsc(fx('control.asc'))
  const text = netlist(r.sheet, 'x', lib).text
  assert.doesNotMatch(text, /^\s*\.control/im) // an active .control would run its shell/system lines at Run
  assert.doesNotMatch(text, /^\s*(shell|system|run)\b/im)
  assert.match(text, /^\* \.CONTROL\n\* run\n\* shell touch \/tmp\/pwned\n\* \.endc$/m)
  assert.match(text, /^\* \.control\n\* system rm -rf ~$/m) // unterminated
  assert.match(text, /^\.op$/m)
  assert.equal(r.report.filter((l) => /\.control block was disabled/.test(l)).length, 2)
  assert.ok(r.report.some((l) => l.startsWith('".include /etc/models.lib" reads a file outside')))
  assert.ok(r.report.some((l) => l.startsWith('".lib ../shared/opamps.lib" reads a file outside')))
  assert.ok(r.report.some((l) => l.startsWith('".inc local.lib" kept')))
  // KiCad text directives go through the same check
  const k = importKicad('(kicad_sch (version 20231120) (lib_symbols) (text ".tran 1u 1m\\n.control\\nshell echo hi\\n.endc" (at 10 10 0)))')
  assert.deepEqual(k.sheet.texts.map((t) => t.text), ['.tran 1u 1m\n* .control\n* shell echo hi\n* .endc'])
  assert.ok(k.report.some((l) => /\.control block was disabled/.test(l)))
})
