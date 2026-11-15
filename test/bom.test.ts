import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bom, bomCsv, bomKey, bomXlsx } from '../src/renderer/src/project/bom.ts'
import { crc32 } from '../src/renderer/src/plot/export.ts'
import { BUNDLED, resolver } from '../src/renderer/src/library/library.ts'
import { parseProject } from '../src/renderer/src/project/project.ts'

// a URL, not .pathname: on Windows that is '/D:/…', which fs resolves to 'D:\\D:\\…'
const ECG = new URL('../docs/guide/examples/ECG-Frontend/', import.meta.url)
const sheets = Object.fromEntries(readdirSync(ECG).filter((f) => f.endsWith('.nsch')).map((f) => [f, JSON.parse(readFileSync(new URL(f, ECG), 'utf8'))]))

test('bom: ECG example, blocks expanded with paths, sim-only parts skipped', () => {
  const { rows, skipped } = bom(sheets, 'main.nsch', resolver(BUNDLED))
  const row = (type: string, value: string) => rows.find((r) => r.type === type && r.value === value)!
  assert.equal(row('Op-amp', 'OA_RRO').qty, 5) // U1-U3 in-amp, RLD, band-pass
  assert.equal(row('Comparator', 'CMP_OC').qty, 2)
  assert.deepEqual(row('LED', 'LED_RED').refs, ['XLED.D1'])
  assert.deepEqual(row('Resistor', '2.2k').refs, ['XINA.R2', 'XINA.R3'])
  assert.deepEqual(row('Resistor', '10k').refs, ['XDET.R3', 'XINA.R5', 'XINA.R6', 'XINA.R7', 'XINA.R8', 'XLED.R3']) // diff amp ×4, threshold, LED bleed
  assert.ok(row('Resistor', '10k').sheets.length > 1)
  assert.equal(skipped, 5) // V1 V2 (supplies); body sheet: B1 heart, mains V, AC test V
  // numeric value order within a type
  const res = rows.filter((r) => r.type === 'Resistor').map((r) => r.value)
  assert.deepEqual(res.slice(0, 3), ['560', '1k', '2.2k'])
})

test('bom: a block used twice counts its parts twice', () => {
  const sub = { version: 1, parts: [{ id: 'a', kind: 'res', x: 0, y: 0, rot: 0, mirror: false, name: 'R1', value: '1k' }], wires: [], texts: [] }
  const blk = (name: string) => ({ id: name, kind: 'block', x: 0, y: 0, rot: 0, mirror: false, name, value: '', sheet: 'f.nsch', pins: [] })
  const top = { version: 1, parts: [blk('X1'), blk('X2')], wires: [], texts: [] }
  const { rows } = bom({ 'm.nsch': top, 'f.nsch': sub } as any, 'm.nsch')
  assert.deepEqual(rows.map((r) => [r.qty, r.refs]), [[2, ['X1.R1', 'X2.R1']]])
})

test('bom: CSV quoting; xlsx is a valid zip with the rows', (t) => {
  const { rows } = bom(sheets, 'main.nsch', resolver(BUNDLED))
  const csv = bomCsv(rows)
  assert.match(csv, /^Qty,Value,Type,Library part,Manufacturer,Part number,Supplier,Supplier part number,References,Sheets\n/)
  assert.match(csv, /^2,2\.2k,Resistor,,,,,,"XINA\.R2, XINA\.R3",2-inamp$/m)
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  const f = join(mkdtempSync(join(tmpdir(), 'bom-')), 'b.xlsx')
  writeFileSync(f, bomXlsx(rows))
  const py = spawnSync('python3', ['-c', `import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(sorted(z.namelist())); print(z.read('xl/worksheets/sheet1.xml').decode())`, f], { encoding: 'utf8' })
  if (py.error) return void t.skip('python3 not on PATH')
  assert.equal(py.status, 0, py.stderr)
  assert.match(py.stdout, /\['\[Content_Types\]\.xml', '_rels\/\.rels', 'xl\/_rels\/workbook\.xml\.rels', 'xl\/workbook\.xml', 'xl\/worksheets\/sheet1\.xml'\]/)
  assert.match(py.stdout, /<c r="A2"><v>\d+<\/v><\/c>/) // qty as a number
  assert.match(py.stdout, /<c r="I\d+" t="inlineStr"><is><t xml:space="preserve">XINA\.R2, XINA\.R3<\/t>/)
})

test('bom: excluding a sheet drops its own parts but still walks its blocks; used lists reachable sheets', () => {
  const lib = resolver(BUNDLED)
  const all = bom(sheets, 'main.nsch', lib)
  assert.deepEqual(all.used, ['main.nsch', '1-body.nsch', '2-inamp.nsch', '3-rld.nsch', '4-bandpass.nsch', '5-detector.nsch', '6-led.nsch'])
  const nob = bom(sheets, 'main.nsch', lib, new Set(['1-body.nsch']))
  assert.ok(!nob.rows.some((r) => r.sheets.includes('1-body')))
  assert.equal(nob.skipped, 2) // just the top sheet's supplies: the body's sources went with it
  assert.equal(nob.used.length, 7) // still listed, so it can be ticked back on
  // excluding the top sheet keeps everything under its blocks
  assert.equal(bom(sheets, 'main.nsch', lib, new Set(['main.nsch'])).rows.length, all.rows.length)
})

test('bom: purchasing details attach to their line by key and go into the export; project file round-trip', () => {
  const lib = resolver(BUNDLED)
  const info = { [bomKey('res', '10k')]: { mfr: 'Yageo', mpn: 'RC0603FR-0710KL', supplier: 'Digi-Key', spn: '311-10.0KHRCT-ND' }, [bomKey('led', 'LED_RED', 'std:LED_RED')]: { mpn: 'LTST-C190KRKT' } }
  const { rows } = bom(sheets, 'main.nsch', lib, new Set(), info)
  assert.deepEqual(rows.find((r) => r.value === '10k')!.info, info['res|10k|'])
  assert.equal(rows.find((r) => r.type === 'LED')!.info.mpn, 'LTST-C190KRKT')
  assert.deepEqual(rows.find((r) => r.value === '22k')!.info, {})
  assert.match(bomCsv(rows), /^6,10k,Resistor,,Yageo,RC0603FR-0710KL,Digi-Key,311-10\.0KHRCT-ND,"XDET\.R3, /m)
  const p = parseProject(JSON.stringify({ version: 1, name: 'x', top: 'main.nsch', bom: { 'res|10k|': { mpn: ' A1 ', mfr: '', junk: 5 }, 'cap|1u|': { mfr: '  ' } } }))
  assert.deepEqual(p.bom, { 'res|10k|': { mpn: 'A1' } }) // trimmed, empty fields / lines dropped, unknown fields ignored
  assert.throws(() => parseProject(JSON.stringify({ version: 1, name: 'x', top: 'main.nsch', bom: { 'res|10k|': { mpn: 7 } } })), /must be text/)
})
