import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { entriesFromImport, parseLibFile, resolver, type ImportedLib, type LibEntry } from '../src/renderer/src/library/library.ts'
import { emptySheet, newPart, pins } from '../src/renderer/src/schematic/model.ts'
import type { Kind } from '../src/renderer/src/schematic/symbols.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'
import { parseRaw } from '../src/main/rawfile.ts'
import { bench, mapNatsemi, mapZetex, simulate } from '../scripts/packs/vendor.ts'

const PACKS = { 'vendor-zetex': mapZetex, 'vendor-natsemi': mapNatsemi }
const KINDS = new Set(['diode', 'zener', 'led', 'npn', 'pnp', 'nmos', 'pmos', 'opamp5', 'block'])
const dir = (id: string) => join(import.meta.dirname, '../library-packs', id)
const load = (id: string) => JSON.parse(readFileSync(join(dir(id), 'pack.json'), 'utf8'))

for (const id of Object.keys(PACKS) as (keyof typeof PACKS)[]) {
  test(`${id}: pack.json valid, files byte-identical to provenance, every entry resolves`, () => {
    const pack = load(id)
    assert.equal(pack.id, id)
    for (const k of ['name', 'description', 'license', 'source', 'notice']) assert.ok(typeof pack[k] === 'string' && pack[k], k)
    assert.match(readFileSync(join(dir(id), pack.notice), 'utf8'), id === 'vendor-zetex' ? /copied\s+intact/ : /may be copied, and distributed/)
    assert.ok(pack.libs.length > 50)
    const prov = new Map(pack.provenance.map((p: { file: string }) => [p.file, p]))
    for (const l of pack.libs as ImportedLib[]) {
      const buf = readFileSync(join(dir(id), l.file)), p = prov.get(l.file) as { url: string; sha256: string; retrieved: string }
      assert.ok(p && /^https:\/\/web\.archive\.org\//.test(p.url) && /^\d{4}-\d\d-\d\d$/.test(p.retrieved), `${l.file}: provenance`)
      assert.equal(createHash('sha256').update(buf).digest('hex'), p.sha256, `${l.file}: unmodified`)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buf) // ngspice-47 rejects non-UTF-8
      assert.deepEqual(parseLibFile(text).errors, [], l.file)
      const es = entriesFromImport(l, text, { source: 'pack', prefix: `pack:${id}/`, dir: dir(id), group: pack.name })
      assert.equal(es.length, l.entries.length, `${l.file}: every entry exists`)
      for (const e of es) {
        assert.ok(KINDS.has(e.kind), `${e.name}: kind ${e.kind}`)
        if (e.spice?.type === 'subckt') {
          const n = e.spice.pins.length
          assert.deepEqual([...e.spice.pinMap].sort(), [...Array(n).keys()], `${e.name}: pinMap is a permutation`)
          assert.equal(n, { opamp5: 5, npn: 3, pnp: 3, nmos: 3, pmos: 3, diode: 2, zener: 2 }[e.kind as string] ?? n, `${e.name}: pin count`)
        } else assert.deepEqual(l.entries.find((x) => x.name === e.name)!.pinMap, [])
      }
    }
  })
}

test('vendor packs: sampled parts simulate (skipped if ngspice missing)', (t) => {
  if (spawnSync('ngspice', ['-v'], { encoding: 'utf8' }).error) return void t.skip('ngspice not on PATH')
  for (const [id, map] of Object.entries(PACKS)) {
    if (!existsSync(dir(id))) continue
    const all = (load(id).libs as ImportedLib[]).flatMap((l) => l.entries.map((e) => ({ l, e })))
    const step = Math.max(1, Math.floor(all.length / 20)) // ≤ 20 per pack, spread over the categories
    for (let i = 0; i < all.length; i += step) {
      const { l, e } = all[i], file = join(dir(id), l.file), text = readFileSync(file, 'utf8')
      const m = map(text).ok.find((x) => x.entry.name === e.name)
      assert.deepEqual(m?.entry, e, `${e.name}: mapping is reproducible`)
      assert.equal(simulate(bench(m!, text, file)), null, `${id} ${e.name}`)
    }
  }
})

test('vendor packs through the app netlister: comparator (non-identity pinMap), BJT model, MOSFET subckt (skipped if ngspice missing)', (t) => {
  const entry = (id: string, file: string): LibEntry => {
    const l = (load(id).libs as ImportedLib[]).find((x) => x.file === file)!
    return entriesFromImport(l, readFileSync(join(dir(id), file), 'utf8'), { source: 'pack', prefix: `pack:${id}/`, dir: dir(id), group: id })[0]
  }
  // ponytail: no op-amp here; LM741 + LMC7211A in one .op trips ngspice's gmin/source stepping (each alone is fine, see above)
  const es = [entry('vendor-natsemi', 'LMC7211A.MOD'), entry('vendor-zetex', 'ztx851.mod'), entry('vendor-zetex', '2n7002.mod')]
  const s = emptySheet()
  const flag = (q: { x: number; y: number }, n: string) => s.parts.push(n === '0' ? newPart(s, 'gnd', q.x, q.y) : { ...newPart(s, 'label', q.x, q.y), value: n })
  const put = (kind: Kind, nets: string[], extra = {}) => {
    const p = newPart(s, kind, 400 * s.parts.length, 0, 0, false, extra)
    s.parts.push(p), pins(p).forEach((q, k) => flag(q, nets[k]))
  }
  const lib = (e: LibEntry, nets: string[]) => put(e.kind, nets, { lib: e.id, value: e.value })
  put('vsrc', ['v5', '0'], { value: 'DC 5' })
  put('vsrc', ['in', '0'], { value: 'DC 2.6' }), put('vsrc', ['ref', '0'], { value: 'DC 2.5' })
  lib(es[0], ['in', 'ref', 'v5', '0', 'cmp']) // in+ > in-: output high
  put('res', ['v5', 'c'], { value: '100' }), put('res', ['v5', 'b'], { value: '43k' }), lib(es[1], ['c', 'b', '0'])
  put('res', ['v5', 'd'], { value: '100' }), lib(es[2], ['d', 'v5', '0'])
  s.texts.push({ id: 'op', x: 0, y: 0, text: '.op' })
  const n = netlist(s, 'vendor', { lib: resolver(es) })
  assert.deepEqual(n.errors, [])
  const d = mkdtempSync(join(tmpdir(), 'vpack-e2e-'))
  writeFileSync(join(d, 'c.cir'), n.text)
  const r = spawnSync('ngspice', ['-b', '-n', '-r', 'o.raw', 'c.cir'], { cwd: d, encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const op = parseRaw(readFileSync(join(d, 'o.raw')))[0], v = (x: string) => op.vars.find((y) => y.name === `v(${x})`)!.re[0]
  assert.ok(v('cmp') > 4.5, `LMC7211A high: ${v('cmp')}`)
  assert.ok(v('b') > 0.5 && v('b') < 1 && v('c') < 4.9, `ZTX851 bias: Vbe ${v('b')}, Vc ${v('c')}`)
  assert.ok(v('d') < 4.5, `2N7002 on: Vd ${v('d')}`)
})
