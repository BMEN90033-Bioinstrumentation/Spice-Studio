// Bill of materials for the design under the top sheet. Pure TS. Blocks are expanded per instance (a part inside a
// block used twice counts twice; its refs get the block path, XINA.R1), parts are grouped by kind + value + library
// part. Simulation-only elements (sources, controlled sources, ideal op-amp, K, T) aren't components, so they're
// counted in `skipped` instead. `exclude`: sheets whose own parts are left out (blocks on them still count);
// `used`: every sheet the design reaches, in visit order.
import { SYMBOLS, isFlag, type Kind } from '../schematic/symbols.ts'
import type { Sheet } from '../schematic/model.ts'
import { si, type LibEntry } from '../library/library.ts'
import { cell, toXlsx } from '../plot/export.ts'
import type { PartInfo } from './project.ts'

export type BomRow = { key: string; qty: number; value: string; type: string; part: string; refs: string[]; sheets: string[]; info: PartInfo }
// a BOM line's identity, also the key of its purchasing details in the project file: 'res|10k|', 'opamp5|oa_rro|std:OA_RRO'
export const bomKey = (kind: Kind, value: string, lib = '') => [kind, value.trim().toLowerCase(), lib].join('|')
const SIM_ONLY = new Set<Kind>(['vsrc', 'isrc', 'vcvs', 'vccs', 'ccvs', 'cccs', 'bv', 'bi', 'kcouple', 'tline', 'opamp'])
const nat = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

export function bom(sheets: Record<string, Sheet>, top: string, lib?: (id: string) => LibEntry | undefined, exclude: ReadonlySet<string> = new Set(), info: Record<string, PartInfo> = {}): { rows: BomRow[]; skipped: number; used: string[] } {
  const groups = new Map<string, BomRow>(), used: string[] = []
  let skipped = 0
  const walk = (file: string, path: string, seen: string[]) => {
    const s = sheets[file]
    if (!s || seen.includes(file)) return // missing sheet / hierarchy cycle: the netlister reports those
    if (!used.includes(file)) used.push(file)
    for (const p of s.parts) {
      if (p.kind === 'block') { if (p.sheet) walk(p.sheet, `${path}${p.name}.`, [...seen, file]); continue }
      if (isFlag(p.kind) || exclude.has(file)) continue
      if (SIM_ONLY.has(p.kind)) { skipped++; continue }
      const e = p.lib ? lib?.(p.lib) : undefined, value = p.value.trim()
      const k = bomKey(p.kind, value, p.lib)
      let r = groups.get(k)
      if (!r) {
        // op-amp symbol carries comparators too: say what the library part is
        const type = p.kind === 'opamp5' && e ? e.category.replace(/s$/, '') : SYMBOLS[p.kind].title
        groups.set(k, (r = { key: k, qty: 0, value, type, part: e?.name ?? '', refs: [], sheets: [], info: info[k] ?? {} }))
      }
      r.qty++
      r.refs.push(path + p.name)
      const st = file.replace(/\.nsch$/i, '')
      if (!r.sheets.includes(st)) r.sheets.push(st)
    }
  }
  walk(top, '', [])
  const num = (v: string) => { const x = si(v); return Number.isFinite(x) ? x : Infinity }
  const rows = [...groups.values()]
  for (const r of rows) r.refs.sort(nat)
  // by type, then value (numerically: 1k < 10k < 1Meg), then name
  rows.sort((a, b) => a.type.localeCompare(b.type) || num(a.value) - num(b.value) || nat(a.value, b.value))
  return { rows, skipped, used }
}

const HEAD = ['Qty', 'Value', 'Type', 'Library part', 'Manufacturer', 'Part number', 'Supplier', 'Supplier part number', 'References', 'Sheets']
const table = (rows: BomRow[]) => rows.map((r) => [r.qty, r.value, r.type, r.part, r.info.mfr ?? '', r.info.mpn ?? '', r.info.supplier ?? '', r.info.spn ?? '', r.refs.join(', '), r.sheets.join(', ')])
export const bomCsv = (rows: BomRow[]) => [HEAD, ...table(rows)].map((r) => r.map((v) => cell(String(v))).join(',')).join('\n') + '\n'
export const bomXlsx = (rows: BomRow[]) => toXlsx([HEAD, ...table(rows)], 'BOM')
