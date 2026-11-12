// Autosave and crash recovery, renderer side (pure parts in restore.ts). The open session keeps a copy of its unsaved
// sheets / netlist in userData (main/recovery.ts) while it has any: every Settings › Autosave interval, when the window
// loses focus and when you pause for a moment. Saving (nothing unsaved) or leaving the session removes it at once, and
// so does a clean quit. A copy left by a crash or kill is offered back on the Home page and when its project or file is
// opened again. Restoring marks the sheets unsaved, and a saved file that changed since the copy was made is never
// replaced without asking: the user's own files change only when they save.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Recovery, RecoveryDraft } from '../../main/recovery'
import type { Session } from './main'
import { usePrefs } from './Preferences'
import { autosaveStep, keysOf, matches, withRecovery } from './restore'
import { emptySheet } from './schematic/model'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export type { Recovery }
type Opened = { dir: string; file: string; text: string }
const IDLE_MS = 2000 // "a pause": this long without a key or click
const base = (p: string) => p.split(/[\\/]/).pop()!

// rid: a restored session takes over its copy's id (overwritten in place, never briefly missing; removed like its own)
export function useAutosave(rid: string | undefined, snapshot: () => Omit<RecoveryDraft, 'id'> | null) {
  const id = useRef(rid ?? crypto.randomUUID())
  const snap = useRef(snapshot)
  snap.current = snapshot
  const st = useRef({ onDisk: !!rid, last: '' })
  const { autosave, autosaveSecs } = usePrefs()
  const step = (write: boolean) => {
    const s = snap.current(), j = s ? JSON.stringify(s) : ''
    const op = autosaveStep(j, st.current, write)
    if (op === 'write') (st.current = { onDisk: true, last: j }), window.api.recovery.write({ id: id.current, ...s! }).catch(() => (st.current.last = '\0'))
    if (op === 'remove') (st.current = { onDisk: false, last: '' }), window.api.recovery.remove(id.current).catch(() => (st.current.onDisk = true))
  }
  // a restored copy is taken over at once, autosave or not, so a clean quit or a save removes it
  useEffect(() => void (rid && step(true)), [])
  // after any render with nothing unsaved (a save, a discard), the copy goes at once
  useEffect(() => void (st.current.onDisk && !snap.current() && step(false)))
  useEffect(() => {
    if (!autosave) return
    const flush = () => step(true)
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

const label = (r: Recovery, k: string) =>
  k === 'net' ? (r.net?.path ? base(r.net.path) : 'the netlist') : r.project ? k.replace(/\.nsch$/i, '') : r.path ? base(r.path) : 'the untitled schematic'
const what = (r: Recovery) => keysOf(r).map((k) => label(r, k)).join(', ')
const when = (r: Recovery) => new Date(r.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// One prompt at a time: a newer one makes the older give way with its cancel choice, so no open is left waiting.
type Ask = { title: string; body: ReactNode; buttons: [string, string, 'ghost' | 'outline' | 'default'][]; cancel: string; done: (c: string) => void }
let asking: Ask | null = null
const subs = new Set<() => void>()
const setAsking = (a: Ask | null) => ((asking = a), subs.forEach((f) => f()))
const ask = (a: Omit<Ask, 'done'>) =>
  new Promise<string>((resolve) => {
    asking?.done(asking.cancel)
    const me: Ask = { ...a, done: (c) => (asking === me && setAsking(null), resolve(c)) }
    setAsking(me)
  })

// which of the copy's keys to restore: all, those whose saved file hasn't changed since the copy, [] (none) or
// null (not now: the copy stays). opening: asked as a project / file opens, so Later and Discard are offered too.
async function pick(r: Recovery, opening: boolean): Promise<string[] | 'discard' | null> {
  const { changed } = await window.api.recovery.check(r)
  if (!changed.length) {
    if (!opening) return keysOf(r)
    const c = await ask({
      title: 'Restore unsaved changes?',
      body: <>Spice Studio closed before these changes to {r.name} were saved ({when(r)}): {what(r)}. Restoring opens them as unsaved changes; your saved files stay as they are until you save.</>,
      buttons: [['later', 'Later', 'ghost'], ['discard', 'Discard', 'outline'], ['restore', 'Restore', 'default']],
      cancel: 'later'
    })
    return c === 'restore' ? keysOf(r) : c === 'discard' ? 'discard' : null
  }
  const c = await ask({
    title: 'Your saved files changed after this copy',
    body: (
      <>
        This copy of {r.name} is from {when(r)}. Since then:
        <ul className="mt-1.5 list-disc pl-5">
          {changed.map(([k, how]) => <li key={k}>{label(r, k)}: {how === 'gone' ? 'the file is no longer there (deleted or renamed)' : 'the saved file is newer, or was changed outside Spice Studio'}</li>)}
        </ul>
        <span className="mt-1.5 block">Keep saved files restores only the rest of the copy. Use recovered copy brings back the copy's version of these too, as unsaved changes: saving would replace the newer files.</span>
      </>
    ),
    buttons: [['cancel', opening ? 'Later' : 'Cancel', 'ghost'], ['copy', 'Use recovered copy', 'outline'], ['keep', 'Keep saved files', 'default']],
    cancel: 'cancel'
  })
  const gone = new Set(changed.map(([k]) => k))
  return c === 'copy' ? keysOf(r) : c === 'keep' ? keysOf(r).filter((k) => !gone.has(k)) : null
}

// opening a project / file that has a copy: ask first
export async function offerRecovery(s: Session | null): Promise<Session | null> {
  if (!s || s.rid) return s
  const r = (await window.api.recovery.list().catch(() => [])).find((r) => matches(r, s))
  if (!r) return s
  const keys = await pick(r, true)
  if (keys === 'discard' || keys?.length === 0) return await window.api.recovery.remove(r.id), s // nothing of it is wanted
  return keys ? withRecovery(s, r, keys) : s
}

// Home › Restore. A project that moved can be located; one that is gone can have its sheets saved as files.
export async function restoreSession(r: Recovery, load: (o: Opened) => Promise<Session>): Promise<Session | null> {
  let opened: Opened | null = null
  if (r.project && (await window.api.recovery.check(r)).missing) {
    const c = await ask({
      title: `Can't find ${r.name}`,
      body: <>The project is no longer at <code className="font-mono text-xs break-all">{r.project}</code>: it was moved, renamed or deleted. Locate it to restore the changes there, or save the recovered sheets as separate files.</>,
      buttons: [['cancel', 'Cancel', 'ghost'], ['save', 'Save as files…', 'outline'], ['locate', 'Locate project…', 'default']],
      cancel: 'cancel'
    })
    if (c === 'save') return await saveCopies(r), null
    if (c !== 'locate' || !(opened = await window.api.project.open())) return null
    r = { ...r, project: opened.file }
  }
  const keys = await pick(r, false)
  if (!keys || keys === 'discard') return null
  if (!keys.length) await window.api.recovery.remove(r.id) // kept every saved file: the copy has nothing left
  if (!r.project) return keys.length ? withRecovery({ kind: 'loose', path: null, sheet: emptySheet() }, r, keys) : null
  const s = await load(opened ?? (await window.api.project.openPath(r.project)))
  return keys.length ? withRecovery(s, r, keys) : s
}
// one save dialog per sheet / netlist; stops at the first Cancel. The copy stays (Discard it on Home when done).
async function saveCopies(r: Recovery) {
  for (const [k, t] of Object.entries(r.sheets)) if (!(await window.api.exportSave(k, t, [{ name: 'Spice Studio schematic', extensions: ['nsch'] }]))) return
  if (r.net) await window.api.exportSave(r.net.path ? base(r.net.path) : 'netlist.cir', r.net.text, [{ name: 'SPICE netlist', extensions: ['cir', 'sp', 'net', 'txt'] }])
}

// Home page: what earlier runs left behind
export function RecoveryList({ onRestore }: { onRestore: (r: Recovery) => unknown }) {
  const [list, setList] = useState<Recovery[]>([])
  const reload = () => window.api.recovery.list().then(setList)
  useEffect(() => void reload(), [])
  if (!list.length) return null
  return (
    <Alert role="status" className="mb-6 border-warn/30 bg-warn/10">
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
              <Button size="sm" onClick={() => Promise.resolve(onRestore(r)).finally(reload)}>Restore</Button>
              <Button size="sm" variant="ghost" onClick={() => window.api.recovery.remove(r.id).then(reload)}>Discard</Button>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

export function RecoveryPrompt() {
  const a = useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => asking)
  if (!a) return null
  return (
    <Dialog open onOpenChange={(o) => !o && a.done(a.cancel)}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{a.title}</DialogTitle>
          <DialogDescription asChild><div>{a.body}</div></DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {a.buttons.map(([v, t, variant], i) => <Button key={v} variant={variant} autoFocus={i === a.buttons.length - 1} onClick={() => a.done(v)}>{t}</Button>)}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
