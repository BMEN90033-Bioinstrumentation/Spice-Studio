// Crash recovery, the pure parts (Recovery.tsx has the hook and the dialogs; test/restore.test.ts): which copy belongs
// to the session being opened, putting a copy's work back into a session, and when the open session writes or removes
// its own copy. No React, no Electron.
import type { Recovery } from '../../main/recovery.ts'
import type { Session } from './main'
import { parseSheet, type Sheet } from './schematic/model.ts'

// what a copy holds: its sheet keys, plus 'net' for netlist text
export const keysOf = (r: Recovery) => [...Object.keys(r.sheets), ...(r.net ? ['net'] : [])]

// the copy for the project / file being opened (a loose .cir session has its file in net.path)
export function matches(r: Recovery, s: Session) {
  if (s.kind === 'project') return r.project === `${s.dir}/${s.file}`
  return (!!r.path && r.path === s.path) || (!!r.net?.path && r.net.path === s.net?.path)
}

// s with the copy's `keys` put back, marked unsaved; other keys keep what s has (the saved files). Throws a plain
// message for a damaged copy.
export function withRecovery(s: Session, r: Recovery, keys = keysOf(r)): Session {
  const parsed: Record<string, Sheet> = {}
  for (const k of keys.filter((k) => k !== 'net' && k in r.sheets)) {
    try {
      parsed[k] = parseSheet(r.sheets[k])
    } catch {
      throw new Error(`The recovery copy of ${s.kind === 'project' ? k : r.name} is damaged and can't be restored. Discard it on the Home page.`)
    }
  }
  const net = keys.includes('net') && r.net ? r.net : s.net
  const dirty = [...Object.keys(parsed), ...(keys.includes('net') && r.net ? ['net'] : [])]
  if (s.kind === 'project') return { ...s, sheets: { ...s.sheets, ...parsed }, net, rid: r.id, dirty }
  // loose: the sheet's file comes back only together with its content (never Save an empty sheet over it)
  const sheet = Object.values(parsed)[0]
  return { ...s, ...(sheet && { sheet, path: r.path ?? null }), net, rid: r.id, dirty }
}

// What the open session does with its copy. json: the unsaved work ('' = nothing unsaved); onDisk: a copy exists under
// its id (written by it, or the one it was restored from); last: what it last wrote; write: writing is allowed
// (autosave on, or taking over a restored copy). Nothing unsaved removes the copy whatever the autosave setting.
export function autosaveStep(json: string, st: { onDisk: boolean; last: string }, write: boolean): 'write' | 'remove' | null {
  if (!json) return st.onDisk ? 'remove' : null
  return write && json !== st.last ? 'write' : null
}
