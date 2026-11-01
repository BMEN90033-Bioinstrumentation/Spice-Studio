import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkPack, copyOnUse, libEntries, packEntries, resolver, type ImportedLib, type PackLibs } from '../src/renderer/src/library/library.ts'
import { emptySheet, newPart } from '../src/renderer/src/schematic/model.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'

const LIB = `.model PK_D D(is=1e-14 n=1.8)
.subckt PK_BUF in out
R1 in out 1k
.ends
`
const good = () => ({
  id: 'my-pack', name: 'My pack', description: 'x', license: 'CC0-1.0', source: 'me',
  libs: [{ file: 'a.lib', entries: [{ name: 'PK_D', kind: 'diode', category: 'Diodes', pinMap: [] }, { name: 'PK_BUF', kind: 'block', category: 'Subcircuits', pinMap: [0, 1] }] }]
})
const files = (m: Record<string, string>) => (f: string) => m[f]
const check = (p: unknown, m: Record<string, string> = { 'a.lib': LIB }, taken: string[] = []) => checkPack(p, files(m), taken)
const has = (errs: string[], re: RegExp) => assert.ok(errs.some((e) => re.test(e)), `no ${re} in:\n${errs.join('\n')}`)

test('a well-formed pack passes', () => assert.deepEqual(check(good()), []))

test('every shipped pack passes the same validation', () => {
  const root = join(import.meta.dirname, '..', 'library-packs')
  for (const id of readdirSync(root)) {
    const dir = join(root, id), raw = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'))
    const read = (f: string) => { try { return readFileSync(join(dir, f), 'utf8') } catch { return undefined } }
    assert.deepEqual(checkPack(raw, read, []).slice(0, 5), [], id)
  }
})

test('pack.json problems come back as friendly messages', () => {
  assert.deepEqual(check([]), ['pack.json must be a JSON object'])
  has(check({ ...good(), id: '../x' }), /"id" must be/)
  has(check(good(), undefined, ['qucs', 'MY-PACK']), /id "my-pack" is already installed/)
  has(check({ ...good(), name: '' }), /"name" is missing/)
  has(check({ ...good(), license: 3 }), /"license" must be a string/)
  has(check({ ...good(), notice: 'NOTICE.txt' }), /notice file NOTICE.txt is missing/)
  has(check({ ...good(), libs: [] }), /at least one library file/)
  has(check({ ...good(), libs: [{ file: '../a.lib', entries: [] }] }), /file name in the pack folder/)
  has(check(good(), {}), /a.lib is missing from the folder/)
  const entry = (e: object) => check({ ...good(), libs: [{ file: 'a.lib', entries: [{ name: 'PK_D', kind: 'diode', category: 'Diodes', pinMap: [], ...e }] }] })
  has(entry({ name: 'NOPE' }), /NOPE: no \.model or \.subckt/)
  has(entry({ kind: 'gnd' }), /unknown symbol kind "gnd"/)
  has(entry({ category: 'Toasters' }), /unknown category "Toasters"/)
  has(entry({ name: 'PK_BUF', kind: 'npn', category: 'BJTs', pinMap: [0, 1] }), /map the symbol's 3 pins/)
  has(entry({ name: 'PK_BUF', kind: 'block', category: 'Subcircuits', pinMap: [0, 0] }), /different subckt pins/)
})

test('a disabled pack is hidden from browsing but its parts still resolve and netlist', () => {
  const pack = (id: string, enabled: boolean): PackLibs => ({ id, name: `${id} parts`, dir: '/packs/' + id, enabled, libs: good().libs as PackLibs['libs'], texts: { 'a.lib': LIB } })
  const { all, shown } = packEntries([pack('on', true), pack('off', false)])
  assert.ok(shown.every((e) => e.id.startsWith('pack:on/')) && shown.length === 2)
  assert.equal(all.length, 4)
  assert.equal(shown[0].group, 'on') // the panel's provenance tag
  const s = emptySheet()
  s.parts.push(newPart(s, 'gnd', 0, 0), newPart(s, 'diode', 100, 0, 0, false, { lib: 'pack:off/a.lib#PK_D', value: 'PK_D' }))
  s.texts.push({ id: 't', x: 0, y: 100, text: '.op' })
  const r = netlist(s, 't', { lib: resolver(all) })
  assert.deepEqual(r.errors, [])
  assert.match(r.text, /\.model PK_D D/)
})

test('a hidden My-library / project library leaves the lists but still resolves; copy-on-use keeps it hidden', async () => {
  const lib = (file: string, enabled?: false): ImportedLib => ({ file, entries: good().libs[0].entries as ImportedLib['entries'], ...(enabled === false && { enabled }) })
  const texts = { 'a.lib': LIB, 'b.lib': LIB }
  const user = libEntries([lib('a.lib'), lib('b.lib', false)], texts, { source: 'user', prefix: 'user:', dir: '/u', group: 'My library' })
  assert.equal(user.all.length, 4)
  assert.deepEqual(user.shown.map((e) => e.id), ['user:a.lib#PK_D', 'user:a.lib#PK_BUF'])
  const proj = libEntries([lib('libs/a.lib', false)], { 'libs/a.lib': LIB })
  assert.deepEqual([proj.all.length, proj.shown.length], [2, 0])
  const s = emptySheet()
  s.parts.push(newPart(s, 'gnd', 0, 0), newPart(s, 'diode', 100, 0, 0, false, { lib: 'proj:libs/a.lib#PK_D', value: 'PK_D' }))
  s.texts.push({ id: 't', x: 0, y: 100, text: '.op' })
  const r = netlist(s, 't', { lib: resolver([...user.all, ...proj.all]) })
  assert.deepEqual(r.errors, [])
  assert.match(r.text, /\.model PK_D D/)
  // a part from the hidden user file, copied into a project that already hides that same file
  const u = emptySheet()
  u.parts.push(newPart(u, 'diode', 0, 0, 0, false, { lib: 'user:a.lib#PK_D', value: 'PK_D' }))
  const files: Record<string, string> = { 'libs/a.lib': LIB }
  const io = { list: async () => Object.keys(files), read: async (f: string) => files[f], write: async (f: string, t: string) => void (files[f] = t) }
  const out = await copyOnUse({ 'main.nsch': u }, { version: 1, name: 'p', top: 'main.nsch', libs: [lib('libs/a.lib', false)] }, [{ prefix: 'user:', libs: [lib('a.lib')], texts }], io)
  assert.equal(out?.project.libs[0].enabled, false)
})
