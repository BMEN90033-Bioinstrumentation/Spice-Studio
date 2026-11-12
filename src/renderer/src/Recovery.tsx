// Autosave and crash recovery, renderer side. The open session keeps a copy of its unsaved sheets / netlist in
// userData (main/recovery.ts) while it has any: every Settings › Autosave interval, when the window loses focus and
// when you pause for a moment. Saving (nothing unsaved) or leaving the session removes it, and so does a clean quit.
// A copy left by a crash or kill is offered back on the Home page and when its project or file is opened again.
// Restoring marks the sheets unsaved: the user's own files change only when they save.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Recovery, RecoveryDraft } from '../../main/recovery'
import type { Session } from './main'
import { usePrefs } from './Preferences'
import { emptySheet, parseSheet } from './schematic/model'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export type { Recovery }
const IDLE_MS = 2000 // "a pause": this long without a key or click
const base = (p: string) => p.split(/[\\/]/).pop()!

// rid: a restored session keeps its record's id (the copy is overwritten in place, never briefly missing)
export function useAutosave(rid: string | undefined, snapshot: () => Omit<RecoveryDraft, 'id'> | null) {
  const id = useRef(rid ?? crypto.randomUUID())
  const snap = useRef(snapshot)
  snap.current = snapshot
  const last = useRef('') // JSON of the copy on disk, '' = none
  const { autosave, autosaveSecs } = usePrefs()
  useEffect(() => {
    const flush = () => {
      const s = autosave ? snap.current() : null, j = s ? JSON.stringify(s) : ''
      if (j === last.current) return
      last.current = j
      const done = s ? window.api.recovery.write({ id: id.current, ...s }) : window.api.recovery.remove(id.current)
      done.catch(() => (last.current = '\0')) // retried on the next flush
    }
    flush()
    let idle: ReturnType<typeof setTimeout> | undefined
    const poke = () => (clearTimeout(idle), (idle = setTimeout(flush, IDLE_MS)))
    const every = setInterval(flush, autosaveSecs * 1000)
    window.addEventListener('blur', flush)
    for (const ev of ['keyup', 'pointerup']) window.addEventListener(ev, poke, true)
    return () => {
      clearInterval(every), clearTimeout(idle)
      window.removeEventListener('blur', flush)
      for (const ev of ['keyup', 'pointerup']) window.removeEventListener(ev, poke, true)
    }
  }, [autosave, autosaveSecs])
  // the session is closing: its work was saved or the user chose Discard (main.tsx's unsaved-changes guard)
  useEffect(() => () => void window.api.recovery.remove(id.current), [])
}

// a session with the record's unsaved work put back and marked unsaved
export function withRecovery(s: Session, r: Recovery): Session {
  const dirty = [...Object.keys(r.sheets), ...(r.net ? ['net'] : [])]
  const parsed = Object.fromEntries(Object.entries(r.sheets).map(([f, t]) => [f, parseSheet(t)]))
  if (s.kind === 'project') return { ...s, sheets: { ...s.sheets, ...parsed }, net: r.net, rid: r.id, dirty }
  // loose: the sheet's file only comes back with its content (never Save an empty sheet over it)
  const sheet = Object.values(parsed)[0]
  return { kind: 'loose', path: sheet ? (r.path ?? null) : null, sheet: sheet ?? emptySheet(), net: r.net, rid: r.id, dirty }
}
export const restoreSession = async (r: Recovery, load: (o: { dir: string; file: string; text: string }) => Promise<Session>) =>
  withRecovery(r.project ? await load(await window.api.project.openPath(r.project)) : { kind: 'loose', path: null, sheet: emptySheet() }, r)

const what = (r: Recovery) => [
  ...Object.keys(r.sheets).map((f) => (r.project ? f.replace(/\.nsch$/i, '') : r.path ? base(r.path) : 'untitled schematic')),
  ...(r.net ? [r.net.path ? base(r.net.path) : 'netlist'] : [])
].join(', ')
const when = (r: Recovery) => new Date(r.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// Home page: what earlier runs left behind
export function RecoveryList({ onRestore }: { onRestore: (r: Recovery) => void }) {
  const [list, setList] = useState<Recovery[]>([])
  const reload = () => window.api.recovery.list().then(setList)
  useEffect(() => void reload(), [])
  if (!list.length) return null
  return (
    <Alert role="status" className="mb-5 border-warn/30 bg-warn/10">
      <AlertTitle>Unsaved work from an earlier session</AlertTitle>
      <AlertDescription className="text-foreground">
        <p className="text-muted-foreground">Spice Studio closed before this was saved. Restore it to keep working on it, then save, or discard it.</p>
        <ul className="mt-1 grid w-full gap-1.5">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="grid min-w-0 flex-1">
                <b className="truncate font-medium">{r.name}</b>
                <small className="truncate text-xs text-muted-foreground">Unsaved: {what(r)} · {when(r)}</small>
              </span>
              <Button size="sm" onClick={() => onRestore(r)}>Restore</Button>
              <Button size="sm" variant="ghost" onClick={() => window.api.recovery.remove(r.id).then(reload)}>Discard</Button>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

// Opening a project / file that has a recovery copy: ask first (Restore / Discard / Later keeps the copy)
type Ask = { r: Recovery; done: (c: 'restore' | 'discard' | 'later') => void }
let asking: Ask | null = null
const subs = new Set<() => void>()
const setAsking = (a: Ask | null) => ((asking = a), subs.forEach((f) => f()))
export async function offerRecovery(s: Session | null): Promise<Session | null> {
  if (!s || s.rid) return s
  const mine = (r: Recovery) => (s.kind === 'project' ? r.project === `${s.dir}/${s.file}` : !!r.path && r.path === s.path)
  const r = (await window.api.recovery.list().catch(() => [])).find(mine)
  if (!r) return s
  const c = await new Promise<'restore' | 'discard' | 'later'>((done) => setAsking({ r, done }))
  setAsking(null)
  if (c === 'discard') await window.api.recovery.remove(r.id)
  return c === 'restore' ? withRecovery(s, r) : s
}
export function RecoveryPrompt() {
  const a = useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => asking)
  if (!a) return null
  return (
    <Dialog open onOpenChange={(o) => !o && a.done('later')}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Restore unsaved changes?</DialogTitle>
          <DialogDescription>
            Spice Studio closed before these changes to {a.r.name} were saved ({when(a.r)}): {what(a.r)}.
            Restoring opens them as unsaved changes; your saved files stay as they are until you save.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => a.done('later')}>Later</Button>
          <Button variant="outline" onClick={() => a.done('discard')}>Discard</Button>
          <Button autoFocus onClick={() => a.done('restore')}>Restore</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
