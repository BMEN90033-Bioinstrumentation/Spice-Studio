import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blockPartFields, copyOnUse, entriesFromImport, libKey, parseLibFile, resolver, suggest, type ImportedLib, type SourceLibs } from '../src/renderer/src/library/library.ts'
import { emptySheet, newPart, pins, type Sheet } from '../src/renderer/src/schematic/model.ts'
import { newProject } from '../src/renderer/src/project/project.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'
import { parseRaw } from '../src/main/rawfile.ts'

const LIB = '.subckt BUF in out\nE1 out 0 in 0 1\n.ends BUF\n.model XD D(IS=1n)\n'
const mapping = (file: string, text = LIB): ImportedLib => ({ file, entries: suggest(parseLibFile(text)) })

test('entriesFromImport: user/pack ids, absolute include, group; project path unchanged', () => {
  const u = entriesFromImport(mapping('a.lib'), LIB, { source: 'user', prefix: 'user:', dir: '/u/My Lib/files', group: 'My library' })
  assert.deepEqual(u.map((e) => [e.id, e.source, e.group]), [['user:a.lib#XD', 'user', 'My library'], ['user:a.lib#BUF', 'user', 'My library']])
  assert.equal((u[1].spice as { include?: string }).include, '/u/My Lib/files/a.lib')
  const k = entriesFromImport(mapping('s.lib'), LIB, { source: 'pack', prefix: 'pack:sample/', dir: '/r/sample', group: 'Sample', compat: 'ltspice' })
  assert.deepEqual([k[0].id, k[0].compat, libKey(k[0].id)], ['pack:sample/s.lib#XD', 'ltspice', 'pack:sample/s.lib'])
  const p = entriesFromImport(mapping('libs/a.lib'), LIB)
  assert.deepEqual([p[1].id, p[1].source, (p[1].spice as { include?: string }).include], ['proj:libs/a.lib#BUF', 'project', 'libs/a.lib'])
  assert.equal(libKey('std:2N3904'), '')
})

test('copyOnUse: copies once, never clobbers, dedupes by name + content, rewrites ids', async () => {
  const fs: Record<string, string> = { 'libs/a.lib': '* someone else\n', 'libs/b.lib': LIB }
  const io = { list: async () => Object.keys(fs), read: async (r: string) => fs[r], write: async (r: string, t: string) => void (fs[r] = t) }
  const part = (s: Sheet, lib: string) => s.parts.push(newPart(s, 'diode', 0, 0, 0, false, { lib, value: 'XD' }))
  const main = emptySheet(), sub = emptySheet(), plain = emptySheet()
  part(main, 'user:a.lib#XD'), part(sub, 'pack:p/b.lib#BUF'), part(sub, 'user:gone.lib#X'), part(plain, 'std:1N4148')
  const project = { ...newProject('t'), libs: [{ file: 'libs/b.lib', entries: [{ name: 'buf', kind: 'block' as const, category: 'Subcircuits' as const, pinMap: [0, 1] }] }] }
  const srcs: SourceLibs[] = [{ prefix: 'user:', libs: [mapping('a.lib')], texts: { 'a.lib': LIB } }, { prefix: 'pack:p/', libs: [mapping('b.lib')], texts: { 'b.lib': LIB } }]
  const r = (await copyOnUse({ 'main.nsch': main, 'sub.nsch': sub, 'plain.nsch': plain }, project, srcs, io))!
  assert.equal(fs['libs/a.lib'], '* someone else\n') // not overwritten
  assert.equal(fs['libs/a-2.lib'], LIB)
  assert.deepEqual(Object.keys(fs).sort(), ['libs/a-2.lib', 'libs/a.lib', 'libs/b.lib']) // b.lib reused
  assert.deepEqual(Object.keys(r.sheets).sort(), ['main.nsch', 'sub.nsch'])
  assert.equal(r.sheets['main.nsch'].parts[0].lib, 'proj:libs/a-2.lib#XD')
  assert.deepEqual(r.sheets['sub.nsch'].parts.map((p) => p.lib), ['proj:libs/b.lib#BUF', 'user:gone.lib#X'])
  assert.deepEqual(r.project.libs.map((l) => [l.file, l.entries.map((e) => e.name)]), [['libs/a-2.lib', ['XD', 'BUF']], ['libs/b.lib', ['buf', 'XD']]])
  assert.deepEqual(Object.keys(r.texts).sort(), ['libs/a-2.lib', 'libs/b.lib'])
  assert.equal(main.parts[0].lib, 'user:a.lib#XD') // inputs untouched
  // second pass over the rewritten sheets: nothing left to copy
  assert.equal(await copyOnUse({ ...r.sheets }, r.project, srcs, io), null)
  // only: parts filtered out are neither copied nor rewritten
  const two = emptySheet()
  part(two, 'user:a.lib#XD'), part(two, 'user:a.lib#XD')
  const keep = two.parts[1].id, o = (await copyOnUse({ 'two.nsch': two }, r.project, srcs, io, (p) => p.id !== keep))!
  assert.deepEqual(o.sheets['two.nsch'].parts.map((p) => p.lib), ['proj:libs/a-2.lib#XD', 'user:a.lib#XD'])
  assert.equal(await copyOnUse({ 'two.nsch': two }, r.project, srcs, io, () => false), null)
})

test('sample pack: well-formed, its parts simulate through an absolute include with spaces (skipped if ngspice missing)', (t) => {
  const pdir = join(import.meta.dirname, '../library-packs/sample'), pack = JSON.parse(readFileSync(join(pdir, 'pack.json'), 'utf8'))
  assert.equal(pack.license, 'CC0-1.0')
  const dir = join(mkdtempSync(join(tmpdir(), 'libsrc-')), 'pack dir')
  mkdirSync(dir)
  const es = pack.libs.flatMap((l: ImportedLib) => {
    const text = readFileSync(join(pdir, l.file), 'utf8')
    assert.deepEqual(parseLibFile(text).errors, [])
    writeFileSync(join(dir, l.file), text)
    const e = entriesFromImport(l, text, { source: 'pack', prefix: 'pack:sample/', dir, group: pack.name })
    assert.equal(e.length, l.entries.length, `${l.file}: every mapped entry exists`)
    return e
  })
  const find = resolver(es), s = emptySheet()
  // each part across a 1 V source + 1k load: diode/subckt pin 1 on 'a', the rest to ground
  const vs = newPart(s, 'vsrc', 0, 0, 0, false, { value: 'DC 1' })
  s.parts.push(vs)
  const flag = (q: { x: number; y: number }, n: string) => s.parts.push(n === '0' ? newPart(s, 'gnd', q.x, q.y) : { ...newPart(s, 'label', q.x, q.y), value: n })
  flag(pins(vs)[0], 'v'), flag(pins(vs)[1], '0')
  es.forEach((e: (typeof es)[number], i: number) => {
    const p = newPart(s, e.kind, 200 * (i + 1), 0, 0, false, { lib: e.id, value: e.value, ...(e.kind === 'block' && blockPartFields(e)) })
    s.parts.push(p)
    const r = { ...newPart(s, 'res', 200 * (i + 1), 300), value: '1k' }
    s.parts.push(r)
    flag(pins(r)[0], 'v'), flag(pins(r)[1], 'a' + i)
    pins(p).forEach((q, k) => flag(q, k === 0 ? 'a' + i : '0'))
  })
  s.texts.push({ id: 'op', x: 0, y: 0, text: '.op' })
  const n = netlist(s, 'pack', { lib: find })
  assert.deepEqual(n.errors, [])
  assert.match(n.text, /^\.include ".*pack dir\/sample\.lib"$/m)
  const r = spawnSync('ngspice', ['-b', '-r', 'o.raw', 'c.cir'], { cwd: (writeFileSync(join(dir, '..', 'c.cir'), n.text), join(dir, '..')), encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const op = parseRaw(readFileSync(join(dir, '..', 'o.raw')))[0]
  for (const [i] of es.entries()) {
    const v = op.vars.find((x) => x.name === `v(a${i})`)!.re[0]
    t.diagnostic(`${es[i].name}: v(a${i}) = ${v.toFixed(3)} V`)
    assert.ok(v > 0.05 && v < 0.95, `${es[i].name} conducts: v(a${i}) = ${v}`)
  }
})
