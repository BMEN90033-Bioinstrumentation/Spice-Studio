import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inside, safeName } from '../src/main/paths.ts'
import { newProject, parseProject, refreshBlocks, renameRefs, sheetFile, validName } from '../src/renderer/src/project/project.ts'
import { blockShape, emptySheet, newPart, pins, sheetPorts, type Sheet } from '../src/renderer/src/schematic/model.ts'

test('newProject round-trips through parseProject', () => {
  const p = newProject('Amp')
  assert.deepEqual(p, { version: 1, name: 'Amp', top: 'main.nsch', libs: [] })
  assert.deepEqual(parseProject(JSON.stringify(p)), p)
  const lib = { file: 'libs/tl072.lib', entries: [{ name: 'TL072', kind: 'opamp5', category: 'Op-amps', pinMap: [2, 1, 3, 4, 0] }] }
  assert.deepEqual(parseProject(JSON.stringify({ ...p, libs: [lib] })).libs, [lib])
  assert.deepEqual(parseProject(JSON.stringify({ version: 1, name: 'x', top: 'a.nsch' })).libs, []) // libs optional
})

test('parseProject rejects garbage with friendly errors', () => {
  const p = newProject('Amp'), bad = (x: unknown, re: RegExp) => assert.throws(() => parseProject(typeof x === 'string' ? x : JSON.stringify(x)), re)
  bad('{nope', /not valid JSON/)
  bad({ ...p, version: 2 }, /v1/)
  bad({ ...p, name: ' ' }, /no name/)
  bad({ ...p, top: '../evil.nsch' }, /Top sheet/)
  bad({ ...p, top: 'sub/main.nsch' }, /Top sheet/)
  bad({ ...p, top: 'main.cir' }, /Top sheet/)
  bad({ ...p, libs: {} }, /must be a list/)
  bad({ ...p, libs: [{ file: '../x.lib', entries: [] }] }, /libs\//)
  bad({ ...p, libs: [{ file: 'libs/a/b.lib', entries: [] }] }, /libs\//)
  bad({ ...p, libs: [{ file: 'libs/x.lib' }] }, /missing entries/)
  bad({ ...p, libs: [{ file: 'libs/x.lib', entries: [{ name: 'Q', kind: 'nope', category: 'BJTs', pinMap: [] }] }] }, /malformed/)
})

test('names: sheet files and project names stay one path segment', () => {
  assert.equal(sheetFile('filter'), 'filter.nsch')
  assert.equal(sheetFile(' filter.nsch '), 'filter.nsch')
  for (const n of ['', '..', '.hidden', 'a/b', 'a\\b', 'a:b']) assert.equal(sheetFile(n), null, n)
  assert.ok(validName('My amp 2'))
  for (const n of ['', '.', '..', 'a/b', '../x', 'x\0']) assert.ok(!validName(n), n), assert.throws(() => safeName(n))
  assert.equal(safeName('  Amp  '), 'Amp')
})

test('inside() confines paths to the project folder', () => {
  const d = '/u/me/proj'
  assert.equal(inside(d, 'main.nsch'), '/u/me/proj/main.nsch')
  assert.equal(inside(d, 'libs/x.lib'), '/u/me/proj/libs/x.lib')
  assert.equal(inside(d, './libs/../main.nsch'), '/u/me/proj/main.nsch') // normalises but stays inside
  assert.equal(inside(d + '/', 'a'), '/u/me/proj/a')
  for (const rel of ['../x', 'libs/../../x', '/etc/passwd', '..', '.', '', 'C:\\x', 'a\0b', '../proj2/x'])
    assert.throws(() => inside(d, rel), Error, rel)
  assert.throws(() => inside('/u/me/proj', '../projX/a')) // sibling with a common prefix
  assert.throws(() => inside('relative/dir', 'a'))
  assert.throws(() => inside(d, 42 as unknown as string))
})

test('refreshBlocks / renameRefs update block instances only when needed', () => {
  const sub = emptySheet()
  sub.parts.push(newPart(sub, 'port', 0, 0, 0, false, { value: 'in' }), newPart(sub, 'port', 100, 0, 0, false, { value: 'out' }))
  const main: Sheet = emptySheet()
  main.parts.push(newPart(main, 'block', 0, 0, 0, false, { sheet: 'f.nsch', ...blockShape(['in']) }), newPart(main, 'res', 50, 0))
  const r = refreshBlocks(main, 'f.nsch', sub)!
  assert.deepEqual(r.parts[0].pins, blockShape(sheetPorts(sub)).pins)
  assert.equal(r.parts[1], main.parts[1])
  assert.equal(refreshBlocks(r, 'f.nsch', sub), null) // already current
  assert.equal(refreshBlocks(main, 'other.nsch', sub), null)
  const moved = { ...r, parts: [{ ...r.parts[0], pins: [...r.parts[0].pins!].reverse().map((q) => ({ ...q, name: q.name.toUpperCase() })) }] }
  assert.equal(refreshBlocks(moved, 'f.nsch', sub), null) // same names (any order/case): pins match by name
  const n = renameRefs(r, 'f.nsch', 'g.nsch')!
  assert.equal(n.parts[0].sheet, 'g.nsch')
  assert.equal(renameRefs(n, 'f.nsch', 'h.nsch'), null)
})

test('refreshBlocks: wires follow their pin by name when a port is added mid-list', () => {
  const port = (s: Sheet, v: string, x: number, y: number) => newPart(s, 'port', x, y, 0, false, { value: v })
  const sub = emptySheet()
  sub.parts.push(port(sub, 'a', 0, 0), port(sub, 'c', 0, 40))
  const main: Sheet = emptySheet()
  const blk = newPart(main, 'block', 0, 0, 90, false, { sheet: 'f.nsch', ...blockShape(sheetPorts(sub)) }) // rotated
  main.parts.push(blk)
  const [pa, pc] = pins(blk)
  main.wires.push({ id: 'wa', a: pa, b: { x: -200, y: -200 } }, { id: 'wc', a: { x: 200, y: 200 }, b: pc })
  sub.parts.push(port(sub, 'b', 0, 20)) // ports now a, b, c: 'c' moves to the other side
  const r = refreshBlocks(main, 'f.nsch', sub)!
  const at = Object.fromEntries(r.parts[0].pins!.map((q, i) => [q.name, pins(r.parts[0])[i]]))
  assert.deepEqual(r.wires[0].a, at.a)
  assert.deepEqual(r.wires[1].b, at.c)
  assert.deepEqual(r.wires[0].b, { x: -200, y: -200 }) // far ends untouched
})

test('parseProject: optional sim settings (compat, timeoutS)', () => {
  const p = newProject('Amp')
  assert.deepEqual(parseProject(JSON.stringify({ ...p, sim: { compat: 'lt', timeoutS: 30 } })).sim, { compat: 'lt', timeoutS: 30 })
  assert.deepEqual(parseProject(JSON.stringify({ ...p, sim: {} })).sim, {})
  assert.deepEqual(parseProject(JSON.stringify({ ...p, sim: { timeoutS: 0 } })).sim, {}) // 0 = no limit
  assert.equal(parseProject(JSON.stringify(p)).sim, undefined)
  for (const [sim, re] of [[{ compat: 'hspice' }, /Unknown compat/], [{ timeoutS: -1 }, /timeoutS/], [{ timeoutS: '5' }, /timeoutS/], [null, /must be an object/], [[1], /must be an object/]] as const)
    assert.throws(() => parseProject(JSON.stringify({ ...p, sim })), re)
})
