// Project file (.nsproj) model + pure sheet-set helpers. No React, no Electron: node --test loads it.
import type { Compat, ProjectSim } from '../contracts.ts'
import type { ImportedLib } from '../library/library.ts'
import { reshapeBlocks, sheetPorts, type Sheet } from '../schematic/model.ts'
import { SYMBOLS } from '../schematic/symbols.ts'

export interface Project { version: 1; name: string; top: string; libs: ImportedLib[]; sim?: ProjectSim }
export const COMPATS: Compat[] = ['ps', 'lt', 'ltps', 'kicad']

// same rule as main's safeName (main re-checks: it's the trust boundary)
export const validName = (n: string) => /^(?![.\s])[^\\/:*?"<>|\x00-\x1f]{1,80}$/.test(n.trim())
// a sheet file at the project root: 'filter.nsch'
const SHEET = /^(?![.\s])[^\\/:*?"<>|\x00-\x1f]{1,80}\.nsch$/i

export const newProject = (name: string): Project => ({ version: 1, name, top: 'main.nsch', libs: [] })

export function parseProject(text: string): Project {
  let p: any
  try {
    p = JSON.parse(text)
  } catch {
    throw new Error('Not a Spice Studio project: the file is not valid JSON')
  }
  if (p?.version !== 1) throw new Error('Not a Spice Studio project (.nsproj v1)')
  if (typeof p.name !== 'string' || !p.name.trim()) throw new Error('Project has no name')
  if (typeof p.top !== 'string' || !SHEET.test(p.top)) throw new Error(`Top sheet must be a .nsch file in the project folder, got ${JSON.stringify(p.top)}`)
  p.libs ??= []
  if (!Array.isArray(p.libs)) throw new Error('Project "libs" must be a list')
  for (const l of p.libs) {
    if (typeof l?.file !== 'string' || !/^libs\/[^\\/]+$/.test(l.file)) throw new Error(`Library file must be in libs/, got ${JSON.stringify(l?.file)}`)
    if (!Array.isArray(l.entries)) throw new Error(`${l.file}: missing entries`)
    for (const e of l.entries)
      if (typeof e?.name !== 'string' || !(e.kind in SYMBOLS) || typeof e.category !== 'string' || !Array.isArray(e.pinMap) || !e.pinMap.every(Number.isInteger))
        throw new Error(`${l.file}: malformed entry ${JSON.stringify(e).slice(0, 80)}`)
  }
  if (p.sim !== undefined) {
    const { compat, timeoutS } = p.sim ?? {}
    if (typeof p.sim !== 'object' || Array.isArray(p.sim) || !p.sim) throw new Error('Project "sim" must be an object')
    if (compat !== undefined && !COMPATS.includes(compat)) throw new Error(`Unknown compat mode ${JSON.stringify(compat)} (use ${COMPATS.join(', ')})`)
    if (timeoutS !== undefined && !(typeof timeoutS === 'number' && timeoutS >= 0 && isFinite(timeoutS))) throw new Error('Project "sim.timeoutS" must be a number of seconds')
  }
  return { version: 1, name: p.name, top: p.top, libs: p.libs, ...(p.sim && { sim: { ...(p.sim.compat && { compat: p.sim.compat }), ...(p.sim.timeoutS && { timeoutS: p.sim.timeoutS }) } }) }
}

// 'filter' / 'filter.nsch' -> 'filter.nsch', or null when not a valid sheet name
export function sheetFile(name: string): string | null {
  const f = name.trim().replace(/\.nsch$/i, '') + '.nsch'
  return SHEET.test(f) ? f : null
}

// Block parts that instance `file` get `sub`'s ports when the set of port names changed (the netlister maps
// block pins to ports by name, case-insensitively, so a reorder alone needs nothing). null when nothing changed.
export function refreshBlocks(s: Sheet, file: string, sub: Sheet): Sheet | null {
  const ports = sheetPorts(sub), names = (a: string[]) => a.map((n) => n.toLowerCase()).sort().join('\0')
  const want = names(ports)
  const ids = new Set(s.parts.filter((p) => p.sheet === file && names((p.pins ?? []).map((q) => q.name)) !== want).map((p) => p.id))
  return ids.size ? reshapeBlocks(s, ids, ports) : null
}

// Re-point block parts after a sheet rename. null when nothing referenced it.
export function renameRefs(s: Sheet, from: string, to: string): Sheet | null {
  if (!s.parts.some((p) => p.sheet === from)) return null
  return { ...s, parts: s.parts.map((p) => (p.sheet === from ? { ...p, sheet: to } : p)) }
}
