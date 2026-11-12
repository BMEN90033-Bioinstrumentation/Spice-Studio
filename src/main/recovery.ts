// Crash recovery store: copies of unsaved sheets/netlists in userData/recovery/<id>.json, one per open session.
// The user's own files are never touched. Records this process wrote belong to live sessions: they are hidden from
// list() and deleted by clearOwned() on a clean close; whatever survives a crash or kill is offered on the next launch.
// Pure node:fs (no Electron) so node --test loads it; main/prefs.ts wires it to IPC. Sync writes: a write that has
// returned is on disk before the next IPC message (e.g. app:closeNow) is handled, and tmp + rename never leaves half a file.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Recovery {
  id: string
  time: number // when it was written (ms)
  name: string // project or file name, for the list
  project?: string // project sessions: the .nsproj (absolute path)
  sheets: Record<string, string> // unsaved sheets as JSON: project sheet file -> text; loose mode: one entry
  path?: string | null // loose mode: the sheet's own file (null = untitled)
  net?: { path: string | null; text: string } // unsaved netlist editor text and its file
}
export type RecoveryDraft = Omit<Recovery, 'time'>

const ID = /^[\w-]{1,64}$/
const str = (x: unknown) => typeof x === 'string'
const nullStr = (x: unknown) => x === null || str(x)
export const isRecovery = (r: any): r is Recovery =>
  !!r && ID.test(r.id) && typeof r.time === 'number' && str(r.name) && (r.project === undefined || str(r.project)) &&
  !!r.sheets && typeof r.sheets === 'object' && Object.values(r.sheets).every(str) && (r.path === undefined || nullStr(r.path)) &&
  (r.net === undefined || (!!r.net && nullStr(r.net.path) && str(r.net.text)))

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
      const f = file(r.id)
      mkdirSync(dir(), { recursive: true })
      writeFileSync(f + '.tmp', JSON.stringify(r))
      renameSync(f + '.tmp', f)
      owned.add(r.id)
    },
    remove(id: unknown) {
      rmSync(file(id), { force: true })
      owned.delete(id as string)
    },
    // records left by earlier runs, newest first; unreadable ones stay on disk untouched
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
