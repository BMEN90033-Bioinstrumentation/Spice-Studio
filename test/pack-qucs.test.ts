import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blockPartFields, entriesFromImport, parseLibFile, resolver, type ImportedLib, type LibEntry } from '../src/renderer/src/library/library.ts'
import { emptySheet, newPart, pins, type Pt } from '../src/renderer/src/schematic/model.ts'
import { SYMBOLS } from '../src/renderer/src/schematic/symbols.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'
import { ROLES, bench, num, type Test } from '../scripts/packs/qucs.ts'

const dir = join(import.meta.dirname, '../library-packs/qucs')
const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'))
const texts: Record<string, string> = Object.fromEntries(pack.libs.map((l: ImportedLib) => [l.file, readFileSync(join(dir, l.file), 'utf8')]))
const entries: LibEntry[] = pack.libs.flatMap((l: ImportedLib) => entriesFromImport(l, texts[l.file], { source: 'pack', prefix: 'pack:qucs/', dir, group: pack.name }))
const MODEL: Record<string, string[]> = { diode: ['D'], zener: ['D'], led: ['D'], npn: ['NPN'], pnp: ['PNP'], njf: ['NJF'], pjf: ['PJF'], nmos: ['NMOS'], pmos: ['PMOS'] }

test('qucs pack: pack.json, licence files and provenance', () => {
  assert.equal(pack.id, 'qucs')
  assert.equal(pack.license, 'GPL-2.0-or-later')
  const pin = /tree\/([0-9a-f]{40})\/library$/.exec(pack.source)?.[1]
  assert.ok(pin, pack.source)
  // the shown notice explains origin + modification (GPL §2a) and points at the full licence text shipped alongside
  assert.match(readFileSync(join(dir, pack.notice), 'utf8'), /COPYING/)
  assert.match(readFileSync(join(dir, 'COPYING'), 'utf8'), /GNU GENERAL PUBLIC LICENSE\s+Version 2/)
  assert.match(readFileSync(join(dir, 'NOTICE.md'), 'utf8'), new RegExp(pin))
  assert.ok(existsSync(join(dir, 'BUILD.md')))
  assert.ok(pack.provenance.length > 10)
  for (const p of pack.provenance) {
    assert.match(p.sha256, /^[0-9a-f]{64}$/)
    assert.ok(p.url.includes(pin) && p.url.endsWith(p.file), p.url)
    assert.ok(!/VDMOS/.test(p.file), 'VDMOS libraries are excluded')
  }
})

test('qucs pack: every lib parses, every entry resolves with sane kind/category/pins', () => {
  const cats = new Set(['Diodes', 'BJTs', 'JFETs', 'MOSFETs', 'Op-amps', 'Comparators', 'Regulators', 'References', 'Optocouplers', 'Timers'])
  for (const l of pack.libs as ImportedLib[]) {
    const t = texts[l.file]
    assert.ok(statSync(join(dir, l.file)).size < 1 << 20, `${l.file} under 1 MiB`)
    assert.match(t, /^[\t\n\r\x20-\x7e]*$/, `${l.file} is plain ASCII`)
    assert.ok(!/copyright|all rights reserved/i.test(t), `${l.file} carries no vendor notice`)
    assert.deepEqual(parseLibFile(t).errors, [], l.file)
    assert.equal(entriesFromImport(l, t).length, l.entries.length, `${l.file}: every entry exists`)
  }
  const names = entries.map((e) => e.name.toLowerCase())
  assert.equal(new Set(names).size, names.length, 'names are unique pack-wide')
  assert.ok(entries.length > 2000, `${entries.length} parts`)
  for (const e of entries) {
    assert.ok(cats.has(e.category) && SYMBOLS[e.kind], `${e.name}: ${e.kind}/${e.category}`)
    const sp = e.spice!
    if (sp.type === 'model') assert.ok(MODEL[e.kind]?.includes(/^\.model\s+\S+\s+(\w+)/i.exec(sp.text)?.[1].toUpperCase() ?? ''), `${e.name}: model type fits ${e.kind}`)
    else {
      assert.deepEqual([...sp.pinMap].sort((a, b) => a - b), sp.pins.map((_, i) => i), `${e.name}: pinMap covers the subckt pins`)
      if (e.kind !== 'block') assert.equal(sp.pinMap.length, SYMBOLS[e.kind].pins.length, `${e.name}: ${e.kind} symbol pins`)
    }
  }
})

test('qucs pack: Qucs value conversion', () => {
  assert.equal(num('10 fF'), '10e-15')
  assert.equal(num('1.5 MOhm'), '1.5e6') // Qucs M = mega
  assert.equal(num('1 mA'), '1e-3')
  assert.equal(num('2 um'), '2e-6')
  assert.equal(num('26.85'), '26.85')
  assert.equal(num('6.042e-016'), '6.042e-016')
  assert.equal(num('1e-3k'), '1')
  assert.equal(num('-1.0 V'), '-1.0')
  assert.equal(num('Vth*2'), null)
})

// the build's category check, re-derived from the entry (the build also knows ratings from descriptions)
function testFor(e: LibEntry): Test {
  const pinsOf = e.spice?.type === 'subckt' ? e.spice.pins : []
  switch (e.kind) {
    case 'diode': return { t: 'diode' }
    case 'led': return { t: 'led' }
    case 'zener': return { t: 'zener' }
    case 'npn': case 'pnp': return { t: 'bjt', darl: /^BD6[78]/.test(e.name) }
    case 'njf': case 'pjf': return { t: 'jfet' }
    case 'nmos': case 'pmos': return { t: 'mos' }
    case 'opamp5': return { t: 'follower' }
  }
  if (e.category === 'Regulators') return { t: 'reg', v: (/^LM(79|320)/.test(e.name) ? -1 : 1) * +/(\d\d)$/.exec(e.name)![1] }
  if (e.category === 'References') return { t: /TL431/.test(e.name) ? 'tl431' : 'lm334' }
  if (e.category === 'Timers') return { t: '555' }
  return { t: pinsOf.includes('c') ? 'opto' : pinsOf.includes('mt2') ? 'triac' : 'ssr' }
}

test('qucs pack: sampled parts simulate through the netlister (skipped if ngspice missing)', (t) => {
  if (spawnSync('ngspice', ['-v']).error) return void t.skip('ngspice not on PATH')
  // up to 3 evenly spaced parts of each kind/category group (38 parts)
  const groups = new Map<string, LibEntry[]>()
  for (const e of entries) groups.set(`${e.category}/${e.kind}`, [...(groups.get(`${e.category}/${e.kind}`) ?? []), e])
  const sample = [...groups.values()].flatMap((g) => [...new Set([0, 1, 2].map((i) => Math.floor((i * g.length) / 3)))].map((i) => g[i]))
  assert.ok(sample.length <= 40)
  const find = resolver(entries), tmp = mkdtempSync(join(tmpdir(), 'pack-qucs-'))
  for (const e of sample) {
    const placed: Record<string, string>[] = []
    const b = bench({ name: e.name, kind: e.kind, pins: e.spice?.type === 'subckt' ? e.spice.pins : [], test: testFor(e) }, (_, at) => (placed.push(at), ''))
    const s = emptySheet() // the sources sit in a text block; a lone ground symbol makes node 0 known to the netlister
    s.parts.push(newPart(s, 'gnd', -400, 0))
    const flag = (q: Pt, n: string) => s.parts.push(n === '0' ? newPart(s, 'gnd', q.x, q.y) : { ...newPart(s, 'label', q.x, q.y), value: n })
    placed.forEach((at, k) => {
      const p = newPart(s, e.kind, 400 * (k + 1), 0, 0, false, { lib: e.id, value: e.value, ...(e.kind === 'block' && blockPartFields(e)) })
      s.parts.push(p)
      pins(p).forEach((q, i) => flag(q, at[p.pins ? p.pins[i].name : ROLES[e.kind]![i]]))
    })
    s.texts.push({ id: 'tb', x: 0, y: 0, text: [...b.circuit.filter(Boolean), ...b.control].join('\n') })
    const n = netlist(s, e.name, { lib: find })
    assert.deepEqual(n.errors, [], e.name)
    writeFileSync(join(tmp, 'c.cir'), n.text)
    const r = spawnSync('ngspice', ['-b', '-n', 'c.cir'], { cwd: tmp, encoding: 'utf8', timeout: 60_000 })
    const out = r.stdout + r.stderr
    assert.doesNotMatch(out, /unrecognized parameter|^Error/im, `${e.name}:\n${out}`)
    const v: Record<string, number> = {}
    for (const m of out.matchAll(/^(\S+)\s+=\s+(\S+)/gm)) v[m[1].toLowerCase()] = +m[2]
    const why = b.check(v)
    t.diagnostic(`${e.category} ${e.kind} ${e.name}: ${why ?? 'ok'}`)
    assert.equal(why, null, `${e.name} (${e.id})`)
  }
})
