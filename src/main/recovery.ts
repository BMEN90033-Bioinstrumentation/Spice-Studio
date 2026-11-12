// Crash recovery store: copies of unsaved sheets/netlists in userData/recovery/<id>.json, one per open session.
// The user's own files are never touched. Records this process wrote belong to live sessions: they are hidden from
// list() and deleted by clearOwned() on a clean close; whatever survives a crash or kill is offered on the next launch.
// Each record also keeps a hash of every file it would replace, as that file was on disk when the copy was written
// (`base`): changedSince() tells a restore which saved files are newer than the copy, so it never overlays them silently.
// Pure node:fs (no Electron) so node --test loads it; main/prefs.ts wires it to IPC. Sync writes: a write that has
// returned is on disk before the next IPC message (e.g. app:closeNow) is handled, and tmp + rename never leaves half a file.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { inside } from './paths.ts'

export interface Recovery {
  id: string
  time: number // when it was written (ms)
  name: string // project or file name, for the list
  project?: string // project sessions: the .nsproj (absolute path)
  sheets: Record<string, string> // unsaved sheets as JSON: project sheet file -> text; loose mode: one entry
  path?: string | null // loose mode: the sheet's own file (null = untitled)
  net?: { path: string | null; text: string } // unsaved netlist editor text and its file
  base?: Record<string, string | null> // sheet key or 'net' -> sha256 of its file when the copy was written (null: no file)
}
export type RecoveryDraft = Omit<Recovery, 'time' | 'base'>

const ID = /^[\w-]{1,64}$/
const SHEET = /^(?![.\s])[^\\/:*?"<>|\x00-\x1f]{1,80}\.nsch$/i // one file at the project root (project.ts)
const str = (x: unknown) => typeof x === 'string'
const nullStr = (x: unknown) => x === null || str(x)
export const isRecovery = (r: any): r is Recovery =>
  !!r && ID.test(r.id) && typeof r.time === 'number' && str(r.name) && (r.project === undefined || str(r.project)) &&
  !!r.sheets && typeof r.sheets === 'object' && Object.entries(r.sheets).every(([k, v]) => SHEET.test(k) && str(v)) &&
  (r.path === undefined || nullStr(r.path)) && (r.net === undefined || (!!r.net && nullStr(r.net.path) && str(r.net.text))) &&
  (r.base === undefined || (!!r.base && typeof r.base === 'object' && Object.values(r.base).every(nullStr)))

// the file a record's key would replace: a project sheet, the loose sheet's file, or the netlist's file ('net')
export function fileOf(r: Omit<Recovery, 'time'>, key: string): string | null {
  if (key === 'net') return r.net?.path ?? null
  if (r.project) return inside(dirname(r.project), key)
  return r.path ?? null
}
const hash = (f: string | null) => (f && existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null)
export const baseOf = (r: Omit<Recovery, 'time'>) =>
  Object.fromEntries([...Object.keys(r.sheets), ...(r.net ? ['net'] : [])].flatMap((k) => (fileOf(r, k) ? [[k, hash(fileOf(r, k))]] : [])))
// before a restore: is the project still there, and which keys' files changed (or went) since the copy was written
export const changedSince = (r: Recovery) => ({
  missing: !!r.project && !existsSync(r.project),
  changed: Object.entries(r.base ?? {}).flatMap(([k, h]): [string, 'changed' | 'gone'][] => {
    const now = hash(fileOf(r, k))
    return now === h ? [] : [[k, now ? 'changed' : 'gone']]
  })
})

export function writeAtomic(f: string, text: string) {
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f + '.tmp', text)
  renameSync(f + '.tmp', f)
}

export function recoveryStore(dir: () => string) {
  const owned = new Set<string>()
  const file = (id: unknown) => {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('Bad recovery id')
    return join(dir(), id + '.json')
  }
  return {
    write(d: RecoveryDraft) {
      const r = { ...d, time: Date.now() }
      if (!isRecovery(r)) throw new Error('Bad recovery record')
      writeAtomic(file(r.id), JSON.stringify({ ...r, base: baseOf(r) }))
      owned.add(r.id)
    },
    remove(id: unknown) {
      rmSync(file(id), { force: true })
      owned.delete(id as string)
    },
    // records left by earlier runs, newest first; unreadable or malformed ones stay on disk untouched
    list(): Recovery[] {
      if (!existsSync(dir())) return []
      const out: Recovery[] = []
      for (const n of readdirSync(dir())) {
        const id = n.slice(0, -5)
        if (!n.endsWith('.json') || !ID.test(id) || owned.has(id)) continue
        try {
          const r = JSON.parse(readFileSync(join(dir(), n), 'utf8'))
          if (isRecovery(r) && r.id === id) out.push(r)
        } catch {}
      }
      return out.sort((a, b) => b.time - a.time)
    },
    clearOwned() {
      for (const id of owned) rmSync(file(id), { force: true })
      owned.clear()
    }
  }
}
