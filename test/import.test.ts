// LTspice .asc / KiCad .kicad_sch import: hand-written fixtures in test/fixtures, checked through the netlist the
// imported sheet produces (connectivity, values, library parts), plus one simulation.
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defang, importAsc, importKicad, importSchematic, sexpr } from '../src/renderer/src/schematic/importer.ts'
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
  assert.ok(r.report.some((l) => /U1: LT1001 placed as the generic op-amp model OA_GENERIC with its pins matched by position .*check that the supply pins/.test(l)))
  // LT1008 has a compensation pin where the layout puts V+: never guessed, even fully wired
  const c = importAsc(fx('lt1008.asc'))
  assert.deepEqual(c.sheet.parts.filter((p) => p.kind === 'block').map((p) => p.value), ['?lt1008'])
  assert.ok(!c.report.some((l) => /OA_GENERIC/.test(l)))
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

test('imported .control blocks and includes are commented out (untrusted file), each reported', () => {
  const r = importAsc(fx('control.asc'))
  const text = netlist(r.sheet, 'x', lib).text
  assert.doesNotMatch(text, /^\s*\.control/im) // an active .control would run its shell/system lines at Run
  assert.doesNotMatch(text, /^\s*(shell|system|run)\b/im)
  assert.doesNotMatch(text, /^\s*\.(inc|lib)/im) // an included file could hold a .control block itself
  assert.match(text, /^\* \.CONTROL\n\* run\n\* shell touch \/tmp\/pwned\n\* \.endc$/m)
  assert.match(text, /^\* \.control\n\* system rm -rf ~$/m) // unterminated
  assert.match(text, /^\.op$/m)
  assert.equal(r.report.filter((l) => /\.control block was disabled/.test(l)).length, 2)
  for (const f of ['/etc/models.lib', '../shared/opamps.lib', 'local.lib'])
    assert.ok(r.report.some((l) => l.includes(`was disabled: it reads ${f}, and an imported schematic is untrusted`)), f)
  assert.ok(!r.report.some((l) => /\bsafe\b|kept:/.test(l)))
  // KiCad text directives go through the same check
  const k = importKicad('(kicad_sch (version 20231120) (lib_symbols) (text ".tran 1u 1m\\n.control\\nshell echo hi\\n.endc" (at 10 10 0)))')
  assert.deepEqual(k.sheet.texts.map((t) => t.text), ['.tran 1u 1m\n* .control\n* shell echo hi\n* .endc'])
  assert.ok(k.report.some((l) => /\.control block was disabled/.test(l)))
})

test('defang matches at least as widely as ngspice: prefixes, case, leading space, continuations, unterminated blocks', () => {
  const run = (text: string) => { const t = [{ text }], rep: string[] = []; defang(t, rep); return { text: t[0].text, rep } }
  assert.equal(run('.controlx\nshell a\n.endc\n.op').text, '* .controlx\n* shell a\n* .endc\n.op')
  assert.equal(run('  .CoNtRoL;x\nshell a\n  .ENDCx\n.op').text, '*   .CoNtRoL;x\n* shell a\n*   .ENDCx\n.op')
  assert.equal(run('.op\n.control\nshell a\n.op\n.tran 1 2').text, '.op\n* .control\n* shell a\n* .op\n* .tran 1 2') // unterminated: to the end
  assert.equal(run('.include\n+ evil.lib\n.LIBRARY x\n .inc y\n.op').text, '* .include\n* + evil.lib\n* .LIBRARY x\n*  .inc y\n.op')
  assert.equal(run('.include a.lib\n.include b.lib').rep.length, 2)
  assert.equal(run('.op\n+ 1\n.model d d').text, '.op\n+ 1\n.model d d') // continuations of live lines stay live
})

// ---------------------------------------------------------------------------------------------- review fixes

// nets of the named parts, in our pin order
const netsOf = (s: Sheet, ...names: string[]) => { const n = netlist(s, 'x', lib); return names.map((x) => n.nets[s.parts.find((p) => p.name === x)!.id].join(' ')) }
const NG = ['vendor/ngspice/darwin-arm64/bin/ngspice', 'vendor/ngspice/win32-x64/bin/ngspice.exe'].map((p) => join(import.meta.dirname, '..', p)).find(existsSync) ?? 'ngspice'

test('"*#" lines (ngspice runs them as commands) become comments, in LTspice and KiCad text; ngspice runs nothing', (t: TestContext) => {
  const r = importAsc(fx('star-hash.asc'))
  const k = importKicad('(kicad_sch (version 20231120) (lib_symbols) (text ".op\\n*#shell touch marker5\\r*#shell touch marker6\\n\\t*#shell touch marker7" (at 10 10 0)))')
  for (const x of [r, k]) assert.ok(x.report.some((l) => /runs a line starting with \*# as a command/.test(l)), x.report.join('\n'))
  const text = netlist(r.sheet, 'x', lib).text + k.sheet.texts.map((x) => x.text).join('\n')
  assert.doesNotMatch(text, /^\s*\*#/m)
  assert.doesNotMatch(text, /^\s*\.(control|inc|lib)/im)
  assert.equal(r.report.filter((l) => /\*#/.test(l)).length, 4)
  // the bundled ngspice (or the one on PATH) must not run any of them
  const dir = mkdtempSync(join(tmpdir(), 'starhash-'))
  writeFileSync(join(dir, 'c.cir'), netlist(r.sheet, 'x', lib).text.replace(/^\.end$/m, k.sheet.texts[0].text + '\n.end'))
  const p = spawnSync(NG, ['-b', '-n', join(dir, 'c.cir')], { cwd: dir, encoding: 'utf8', timeout: 20000 })
  if (p.error) return void t.skip('ngspice not found')
  for (let i = 1; i <= 7; i++) assert.equal(existsSync(join(dir, 'marker' + i)), false, `marker${i} was created`)
})

test('two stubs of one part never short each other (LTspice g: all four pins kept apart)', () => {
  const r = importAsc(fx('g-short.asc'))
  assert.deepEqual(netsOf(r.sheet, 'G1'), ['0 n2 n3 n4'])
  assert.deepEqual(r.report, [])
})

test('a pin of ours landing where two wires cross does not join them', () => {
  const r = importAsc(fx('cross-short.asc'))
  assert.deepEqual(netsOf(r.sheet, 'R1'), ['0 a'])
  const n = netlist(r.sheet, 'x', lib)
  assert.ok(!n.warnings.some((w) => /several labels/.test(w)), n.warnings.join('\n')) // a and v stay apart
})

test('a label pair reuses the net\'s own name instead of inventing one', () => {
  const r = importAsc(fx('rename.asc'))
  assert.deepEqual(netsOf(r.sheet, 'E1'), ['0 n2 n3 out'])
  assert.ok(!r.sheet.parts.some((p) => /^E1_/.test(p.value)))
  assert.match(netlist(r.sheet, 'x', lib).text, /^\.meas op x find v\(out\)$/m)
})

test('KiCad op-amps in every orientation, and KiCad 9 op-amps whose output pin has no name', () => {
  const r = importKicad(fx('opamp-orient.kicad_sch'))
  assert.deepEqual(netsOf(r.sheet, 'XU1', 'XU2', 'XU3', 'XU4', 'XU5'), [1, 2, 3, 4, 5].map((k) => `p${k} n${k} vp${k} vn${k} o${k}`))
  assert.ok(!r.report.some((l) => /placeholder|differ/.test(l)), r.report.join('\n'))
})

test('KiCad rules: a pin or wire end on a wire\'s middle is not connected, a label there is', () => {
  const r = importKicad(fx('kicad-rules.kicad_sch'))
  const [r1, r2, r3, r4, r5] = netsOf(r.sheet, 'R1', 'R2', 'R3', 'R4', 'R5')
  assert.deepEqual([r3, r4, r5], ['C 0', 'A 0', 'B 0'])
  assert.ok(!/^A /.test(r1) && !/^B /.test(r2), `${r1} / ${r2}`)
  assert.ok(!r.report.some((l) => /differ/.test(l)), r.report.join('\n'))
})

test('an LTspice symbol from the OpAmps folder that is not a wired 5-pin op-amp becomes a placeholder', () => {
  const r = importAsc(fx('opamp-unknown.asc'))
  assert.deepEqual(r.sheet.parts.filter((p) => p.kind === 'block').map((p) => [p.name, p.value]), [['U1', '?lt1167']])
  assert.ok(r.report.some((l) => /LT1167 is not a 5-pin op-amp/.test(l)))
  assert.ok(!r.report.some((l) => /OA_GENERIC/.test(l)))
})

test('bad coordinates and malformed elements are skipped with a report line; the sheet always reloads', () => {
  for (const [imp, text, what] of [
    [importAsc, 'Version 4\nWIRE 0 0 x 0\nFLAG a b out\nSYMBOL res a b R0\nSYMATTR InstName R1\nSYMBOL\nTEXT 0 0 Left 2 !.op', /Line 2 \(WIRE\) skipped: non-numeric[^]*Line 3 \(FLAG\)[^]*Line 4 \(SYMBOL\)[^]*Line 6 \(SYMBOL\) skipped: no symbol name/],
    [importKicad, '(kicad_sch (label "L" (at nan inf 0)) (wire (pts (xy a b) (xy c d))) (wire) (text "hello" (at x y 0)) (junction))', /(?=[^]*label was skipped: non-numeric)(?=[^]*wire was skipped: non-numeric)(?=[^]*text was skipped)(?=[^]*junction was skipped: no position)/]
  ] as const) {
    const r = imp(text)
    assert.match(r.report.join('\n'), what)
    assert.doesNotMatch(JSON.stringify(r.sheet), /null|NaN/)
    assert.deepEqual(parseSheet(JSON.stringify(r.sheet)), r.sheet)
  }
  const k = importKicad('(kicad_sch (lib_symbols (symbol "Device:R" (symbol "R_1_1" (pin passive line (length 1) (name "~") (number "1"))))) (symbol (lib_id "Device:R") (at 0 0 0) (property "Reference" "R1" (at 0 0 0))))')
  assert.match(k.report.join('\n'), /symbol was skipped: malformed/)
  assert.throws(() => importSchematic('x.asc', 'Version 4\n' + 'WIRE 0 0 16 0\n'.repeat(20001)), /too large to import/)
})

test('imported .model lines are kept only for ordinary device types: d_process / d_cosim / filesource disabled, ngspice runs nothing', (t: TestContext) => {
  const r = importAsc(fx('code-models.asc'))
  const k = importKicad('(kicad_sch (version 20231120) (lib_symbols) (text ".tran 1n 30n\\na1 [din] clk null [dout] proc\\n.model proc d_process (process_file=\\"/usr/bin/touch\\" process_params=[\\"marker4\\"])" (at 10 10 0)))')
  const text = netlist(r.sheet, 'x', lib).text
  const live = (s: string) => s.split('\n').filter((l) => /^\s*\.model/i.test(l))
  // only allowlisted types stay active (continuations and comment lines in between handled)
  assert.deepEqual(live(text).map((l) => l.trim().split(/\s+/).slice(0, 2).join(' ')), ['.model D1N4148', '.model QX', '.MODEL M1', '.model S1', '.model Q2', '.model QY'])
  assert.match(text, /^\.model D1N4148 D\(IS=2\.52n RS=\.568 N=1\.752\)\n\.model QX NPN\(BF=100\) ; inline comment\n\.MODEL M1 NMOS level=1\n\+ VTO=0\.7 KP=110u\n\.model S1 SW\(Ron=1 Roff=1Meg Vt=0\.5\)\n\.model Q2 VDMOS\(Vto=3 Kp=20\)\n\.model QY ako:QX NPN\(BF=50\)$/m)
  assert.match(text, /^\* \.MODEL proc2 D_PROCESS\n\* \+ \(process_file="\/usr\/bin\/touch"\n\* a comment between\n\* \+ process_params=\["marker2"\]\)$/m)
  assert.doesNotMatch(text, /^\s*[.+].*(d_process|d_cosim|filesource|process_file)/im)
  assert.deepEqual(live(k.sheet.texts[0].text), [])
  for (const name of ['proc d_process', 'proc2 d_process', 'proc3 d_process', 'cs d_cosim', 'src filesource', 'ak ako:proc npn'])
    assert.ok(r.report.some((l) => l.startsWith(`".model ${name}" was disabled`)), name + '\n' + r.report.join('\n'))
  assert.ok(k.report.some((l) => l.startsWith('".model proc d_process" was disabled')))
  // run it: the bundled ngspice loads its code models from SPICE_LIB_DIR
  const dir = mkdtempSync(join(tmpdir(), 'codemodel-'))
  writeFileSync(join(dir, 'c.cir'), text.replace(/^\.end$/m, k.sheet.texts[0].text + '\n.end'))
  const env = NG.includes('vendor') ? { ...process.env, SPICE_LIB_DIR: join(NG, '../../share/ngspice') } : process.env
  const p = spawnSync(NG, ['-b', '-n', join(dir, 'c.cir')], { cwd: dir, encoding: 'utf8', timeout: 20000, env })
  if (p.error) return void t.skip('ngspice not found')
  for (const m of ['marker', 'marker2', 'marker3', 'marker4']) assert.equal(existsSync(join(dir, m)), false, m + ' was created')
})

test('defang: the model allowlist on its own', () => {
  const run = (text: string) => { const x = [{ text }], rep: string[] = []; defang(x, rep); return { text: x[0].text, rep } }
  assert.equal(run('.model a d_source (input_file="x")').text, '* .model a d_source (input_file="x")')
  assert.equal(run('.modelx a table2d (file="t")').text, '* .modelx a table2d (file="t")') // ngspice matches .model as a prefix
  assert.equal(run('.model a\n\n+ d_process(process_file="x")').text, '* .model a\n\n* + d_process(process_file="x")') // type on a continuation
  assert.equal(run('.model b ako:zz NPN(BF=1)').rep.length, 1) // an AKO of an unknown model
  assert.equal(run('.model a NPN(BF=1)\n.model b ako:a (BF=2)').rep.length, 0)
  // ngspice also reads .cmodel as a model card
  assert.equal(run('.cmodel proc d_process (process_file="/usr/bin/touch")').text, '* .cmodel proc d_process (process_file="/usr/bin/touch")')
  assert.equal(run('.CMODEL proc\n+ D_PROCESS (process_file="x")').text, '* .CMODEL proc\n* + D_PROCESS (process_file="x")')
  assert.equal(run('.subckt s a\n.cmodel src filesource (file="secret.txt")\n.ends').text, '.subckt s a\n* .cmodel src filesource (file="secret.txt")\n.ends')
  assert.equal(run('.cmodel d1 D(IS=1n)').rep.length, 0)
  assert.equal(run('.model r1 R(TC1=0)\n.model c1 C(cap=1p)\n.model t1 txl(r=1)\n.model n1 nsoi(level=10)').rep.length, 0)
})
