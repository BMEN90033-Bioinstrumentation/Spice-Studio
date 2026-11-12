import { useEffect, useId, useRef, useState, type ComponentProps, type CSSProperties, type FormEvent } from 'react'
import { validName } from '../project/project'
import { TEMPLATES } from '../schematic/templates'
import { BookOpen, File, PencilRuler, FileText, Folder, FolderOpen, FolderSearch, LayoutGrid, Plus, Trash2, Settings, type LucideIcon } from 'lucide-react'
import { SymBody, localBox } from '../library/Symbol'
import { GRID, junctions, snap, xform, type Sheet } from '../schematic/model'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Tip } from '@/components/ui/tip'
import { cn } from '@/lib/utils'
import { keyLabel } from '../layout/Panel'
import { openSettings, usePrefs } from '../Preferences'
import { RecoveryList, type Recovery } from '../Recovery'

type Recent = { name: string; file: string; opened: number; exists: boolean; trash: { path: string; folder: boolean } }
const WIN = navigator.platform.startsWith('Win'), MAC = navigator.platform.startsWith('Mac')
const BIN = WIN ? 'Recycle Bin' : 'Trash', FILES = MAC ? 'Finder' : WIN ? 'File Explorer' : 'the file manager'

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536e3], ['month', 2592e3], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
function ago(t: number) {
  const s = (t - Date.now()) / 1000
  for (const [u, n] of UNITS) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u)
  return 'just now'
}
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

export const BLANK = 'blank'
const EXAMPLES = TEMPLATES.map((t) => ({ ...t, sheet: t.sheets['main.nsch'] }))

// the app mark (build/icon.svg's tile and roll-off curve)
const Logo = ({ className }: { className?: string }) => (
  <svg viewBox="1 1 46 46" className={className} aria-hidden="true">
    <rect x="1" y="1" width="46" height="46" rx="10.3" fill="#0b7fe6" />
    <path d="M10 16h12q5 0 8 6l8 14" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// A template's main sheet as the canvas draws it (schematic.css's .sch styles: grid, shaded bodies, junction dots, the
// user's colour theme), at one scale for every example. No names, values or directives: unreadable this small.
function Thumb({ sheet }: { sheet: Sheet }) {
  const grid = useId()
  const pts = [
    ...sheet.wires.flatMap((w) => [w.a, w.b]),
    ...sheet.parts.flatMap((p) => { const b = localBox(p.kind, p); return [xform(p, { x: b.x0, y: b.y0 }), xform(p, { x: b.x1, y: b.y1 })] })
  ]
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const vw = Math.max(x1 - x0 + 60, (y1 - y0 + 60) * 1.6, 300), vh = vw / 1.6 // the tile's 8:5, 30 units of margin, never zoomed in past 300 wide
  const vx = snap((x0 + x1 - vw) / 2), vy = snap((y0 + y1 - vh) / 2)
  return (
    <span className="sch block size-full" style={{ '--sch-stroke': 1.1 } as CSSProperties}>
      <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} aria-hidden="true">
        <defs><pattern id={grid} width={GRID} height={GRID} patternUnits="userSpaceOnUse"><circle className="dot" r={vw / 400} /></pattern></defs>
        <rect x={vx} y={vy} width={vw} height={vh} fill={`url(#${grid})`} />
        {sheet.parts.map((p) => (
          <g key={p.id} className="part"><g className="sym" transform={`translate(${p.x} ${p.y}) rotate(${p.rot * 90}) scale(${p.mirror ? -1 : 1} 1)`}><SymBody kind={p.kind} part={p} /></g></g>
        ))}
        {sheet.wires.map((w) => <g key={w.id} className="wire"><line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} /></g>)}
        {junctions(sheet).map((q) => <circle key={`${q.x},${q.y}`} className="jn" cx={q.x} cy={q.y} r={3} />)}
      </svg>
    </span>
  )
}

// sidebar command: one line, shortcut on the right, the longer explanation in a tooltip
function Action({ icon: I, title, tip, keys, className, ...b }: { icon: LucideIcon; title: string; tip: string; keys?: string } & ComponentProps<typeof Button>) {
  return (
    <Tip label={tip} side="right">
      <Button variant="ghost" className={cn('h-8 w-full justify-start gap-2.5 px-2 font-normal', className)} {...b}>
        <I className="opacity-70" />{title}
        {keys && <span className="ml-auto text-xs opacity-60">{keyLabel(keys)}</span>}
      </Button>
    </Tip>
  )
}
const H2 = 'mb-3 text-[13px] font-semibold'

export function Home({ onCreate, onOpen, onOpenFile, onLibrary, onBuilder, error, form, setForm, onRestore }: {
  onCreate: (parent: string, name: string, template: string) => Promise<void>
  onOpen: (file?: string) => Promise<void>
  onOpenFile: () => Promise<void>
  onLibrary: () => void
  onBuilder: () => void
  error: string
  form: boolean // the new-project form (owned by App: File › New Project opens it)
  setForm: (open: boolean) => void
  onRestore: (r: Recovery) => unknown // a crash-recovery copy (Recovery.tsx)
}) {
  const [recents, setRecents] = useState<Recent[] | null>(null)
  const [del, setDel] = useState<Recent | null>(null) // the recent being removed (dialog below)
  const [delError, setDelError] = useState('')
  const remove = (trash: boolean) => del && window.api.recent.delete(del.file, trash).then(() => setDel(null), (e) => setDelError(String(e?.message ?? e))).then(reload)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [tpl, setTpl] = useState(BLANK)
  const [examples, setExamples] = useState(false) // the Examples tab; otherwise new project (blank) + recents
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof window.api.engine>> | null>(null)
  const [app, setApp] = useState<Awaited<ReturnType<typeof window.api.menu.info>> | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const reload = () => window.api.recent.list().then(setRecents)
  const checkEngine = () => window.api.engine().then(setEngine) // looked up afresh each call: picks up an ngspice installed since launch
  const runs = !!engine?.path && /^ngspice-/.test(engine.version) // found and answered --version (a Settings override can point anywhere)
  const { ngspicePath, projectDir } = usePrefs()
  useEffect(() => {
    reload()
    window.api.menu.info().then(setApp)
  }, [])
  useEffect(() => void checkEngine(), [ngspicePath]) // Settings › Simulation engine
  useEffect(() => void (projectDir ? setParent(projectDir) : window.api.project.defaultParent().then(setParent)), [projectDir]) // Settings › Project folder
  useEffect(() => { if (form) nameRef.current?.focus() }, [form])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setForm(false) // ⌘N/⌘O: commands in main.tsx
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ok = validName(name) && !!parent
  async function create(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    await onCreate(parent, name.trim(), template).finally(() => setBusy(false))
  }
  const pick = async () => {
    const p = await window.api.project.pickParent(parent)
    if (p) setParent(p)
  }

  const template = examples ? tpl : BLANK
  const desc = EXAMPLES.find((t) => t.id === template)?.description ?? 'An empty main sheet.'
  return (
    <div className="relative flex h-full bg-background">
      <div className="home-drag" />
      <aside className="home-side flex w-60 shrink-0 flex-col border-r bg-card px-3 pb-3">
        <div className="mb-6 flex items-center gap-3 px-2">
          <Logo className="size-9 shrink-0" />
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight">Spice Studio</div>
            {app && <div className="text-xs text-muted-foreground">Version {app.version}</div>}
          </div>
        </div>
        <nav className="grid gap-0.5" aria-label="Start">
          <Action icon={Plus} title="New project" tip="An empty project" keys="Mod+N" className={cn(form && !examples && 'bg-accent')} onClick={() => (setForm(examples || !form), setExamples(false))} aria-expanded={form && !examples} />
          <Action icon={Folder} title="Open project…" tip="A .nsproj project folder" keys="Mod+O" onClick={() => onOpen()} />
          <Action icon={File} title="Open file…" tip="A single .nsch schematic or .cir netlist" keys="Mod+Shift+O" onClick={onOpenFile} />
          <Action icon={LayoutGrid} title="Examples" tip="Ready-made circuits to start a project from" className={cn('mt-3', examples && 'bg-accent')} aria-pressed={examples}
            onClick={() => (setExamples(!examples), setTpl(BLANK), setForm(false))} />
          <Action icon={BookOpen} title="Component library" tip="Diodes, transistors and op-amps with their models" onClick={onLibrary} />
          <Action icon={PencilRuler} title="Component builder" tip="Make your own part: how it behaves (by form or SPICE code), its pins and its symbol" onClick={onBuilder} />
        </nav>
        <Action icon={Settings} title="Settings" tip="Theme, autosave, defaults, keyboard shortcuts, the simulation engine and version details" className="mt-auto mb-3"
          onClick={() => openSettings()} />
        {engine && (
          <Tip label={engine.path ?? 'ngspice not found'} side="right">
            <div className="flex items-center gap-2 border-t px-2 pt-3 text-xs text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', runs ? 'bg-ok' : 'bg-warn')} />
              <span className={cn('truncate', !runs && 'text-warn')}>{engine.version}</span>
              {engine.bundled && <span className="ml-auto">Bundled</span>}
            </div>
          </Tip>
        )}
      </aside>

      <main className="home-main block min-w-0 flex-1 overflow-y-auto px-10 pb-12">
        <div className="mx-auto max-w-[880px]">
          {error && <Alert variant="destructive" className="mb-6"><AlertDescription>{error}</AlertDescription></Alert>}
          <RecoveryList onRestore={onRestore} />
          {engine && !engine.path && (
            <Alert role="status" className="mb-6 flex items-center gap-3 border-warn/30 bg-warn/10">
              <p className="flex-1">
                <b className="font-semibold text-warn">ngspice wasn't found.</b> You can draw and save circuits, but they can't be simulated until it is.{' '}
                {import.meta.env.DEV
                  ? <>Build it with <code className="font-mono text-xs">npm run ngspice:build</code>, or install ngspice (<code className="font-mono text-xs">brew install ngspice</code>).</>
                  : <>Reinstall Spice Studio to restore the bundled engine, or install ngspice yourself.</>}
              </p>
              <Button variant="outline" size="sm" onClick={checkEngine}>Check again</Button>
            </Alert>
          )}

          {(
            <>
              <section className="mb-10">
                <h2 className={H2}>{examples ? 'Examples' : 'Start'}</h2>
                {!examples && <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                  {([
                    [Plus, 'New project', 'An empty project', () => setForm(true)],
                    [Folder, 'Open project…', 'A .nsproj project folder', () => onOpen()],
                    [File, 'Open file…', 'A schematic or netlist', onOpenFile],
                    [LayoutGrid, 'Examples', 'Ready-made circuits', () => setExamples(true)]
                  ] as [LucideIcon, string, string, () => unknown][]).map(([I, title, sub, go]) => (
                    <button key={title} type="button" onClick={go}
                      className={cn('flex items-center gap-3 rounded-md border bg-black/15 px-3.5 py-3 text-left outline-none transition-colors hover:border-input hover:bg-black/25 focus-visible:ring-2 focus-visible:ring-ring',
                        form && I === Plus && 'border-foreground/70 hover:border-foreground/70')}>
                      <I className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate font-medium">{title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                      </span>
                    </button>
                  ))}
                </div>}
                {examples && <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                  {EXAMPLES.map((t) => {
                    const on = form && tpl === t.id
                    return (
                      <button key={t.id} type="button" aria-pressed={on} onClick={() => (setTpl(t.id), setForm(true))}
                        className="group grid gap-2 rounded-md text-left outline-none">
                        <span className={cn('block aspect-[8/5] overflow-hidden rounded-md border transition-colors group-hover:border-input group-focus-visible:ring-2 group-focus-visible:ring-ring',
                          on && 'border-foreground/70 group-hover:border-foreground/70')}>
                          <Thumb sheet={t.sheet} />
                        </span>
                        <span className={cn('truncate text-xs', on ? 'font-medium text-foreground' : 'text-muted-foreground group-hover:text-foreground')}>{t.name}</span>
                      </button>
                    )
                  })}
                </div>}

                {form && (
                  <form className="mt-5 grid gap-4 border-t pt-5" onSubmit={create}>
                    <p className="text-muted-foreground">{desc}</p>
                    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 max-[820px]:grid-cols-1">
                      <div className="grid content-start gap-1.5">
                        <Label htmlFor="np-name" className="text-xs font-normal text-muted-foreground">Name</Label>
                        <Input id="np-name" ref={nameRef} className="h-8" value={name} onChange={(e) => setName(e.target.value)} placeholder="My amplifier" spellCheck={false}
                          aria-invalid={!!name && !validName(name)} aria-describedby={name && !validName(name) ? 'np-name-err' : undefined} />
                        {name && !validName(name) && <div id="np-name-err" className="text-xs text-destructive">No / \ : * ? " &lt; &gt; | and it can't start with "."</div>}
                      </div>
                      <div className="grid content-start gap-1.5">
                        <span id="np-loc" className="text-xs text-muted-foreground">Location</span>
                        <InputGroup className="h-8" aria-labelledby="np-loc">
                          {/* rtl + ltr bdi: ellipsised from the left, so the folder name stays visible */}
                          <Tip label={parent}>
                            <code className="min-w-0 flex-1 truncate px-3 text-left font-mono text-xs [direction:rtl]"><bdi dir="ltr">{tilde(parent)}{name.trim() && validName(name) ? '/' + name.trim() : ''}</bdi></code>
                          </Tip>
                          <InputGroupAddon align="inline-end"><InputGroupButton onClick={pick}>Change…</InputGroupButton></InputGroupAddon>
                        </InputGroup>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setForm(false)}>Cancel</Button>
                      <Button type="submit" size="sm" disabled={!ok || busy}>{busy ? 'Creating…' : 'Create project'}</Button>
                    </div>
                  </form>
                )}
              </section>

              {!examples && <section>
                <h2 className={H2}>Recent</h2>
                {recents?.length === 0 && (
                  <p className="border-t pt-4 text-muted-foreground">Nothing here yet. Start a new project, try an example, or open a project you already have.</p>
                )}
                {!!recents?.length && (
                  <div className="grid grid-cols-[minmax(120px,1fr)_minmax(0,2fr)_auto] gap-x-6">
                    <div className="col-span-full grid grid-cols-subgrid border-b pb-1.5 text-xs text-muted-foreground">
                      <span>Name</span><span>Location</span><span className="text-right">Opened</span>
                    </div>
                    {recents.map((r) => (
                      <div key={r.file} className="relative col-span-full -mx-2 grid grid-cols-subgrid items-center rounded-md px-2 hover:bg-accent/60 has-focus-visible:bg-accent/60">
                        <Tip label={r.exists ? r.file : 'Missing: ' + r.file}>
                          {/* the name is the button; its ::after stretches the hit area over the whole row */}
                          <button type="button" disabled={!r.exists} onClick={() => onOpen(r.file)}
                            className={cn('flex h-9 min-w-0 items-center gap-2.5 text-left font-medium outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring', !r.exists && 'text-muted-foreground line-through')}>
                            {/\.nsproj$/.test(r.file) ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                            <span className="truncate">{r.name}</span>
                          </button>
                        </Tip>
                        {/* path ellipsised from the left so the folder name stays visible */}
                        <span className="min-w-0 truncate text-left text-xs text-muted-foreground [direction:rtl]"><bdi dir="ltr">{tilde(r.file.replace(/\/[^/]*$/, ''))}</bdi></span>
                        <span className="flex items-center justify-end gap-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                          {r.exists ? ago(r.opened) : 'Missing'}
                          {!r.exists
                            ? <Button variant="ghost" size="sm" className="relative h-6 px-2 text-xs" onClick={() => window.api.recent.remove(r.file).then(reload)} aria-label={`Remove ${r.name} from recents`}>Remove</Button>
                            : (
                              <span className="relative -mr-1 flex">
                                <Tip label={`Show in ${FILES}`}>
                                  <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" onClick={() => window.api.recent.reveal(r.file)} aria-label={`Show ${r.name} in ${FILES}`}><FolderSearch className="size-3.5" /></Button>
                                </Tip>
                                <Tip label="Remove from this list, or delete the project…">
                                  <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-destructive" onClick={() => (setDelError(''), setDel(r))} aria-label={`Remove or delete ${r.name}`}><Trash2 className="size-3.5" /></Button>
                                </Tip>
                              </span>
                            )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>}
            </>
          )}
        </div>
      </main>

      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent showCloseButton={false} className="grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden bg-card p-0 sm:max-w-[440px]">
          <DialogHeader className="gap-1.5 px-5 pt-5">
            <DialogTitle className="text-[15px]">Remove from Recent?</DialogTitle>
            <DialogDescription className="text-[13px]">
              Removing only clears it from this list. Moving it to the {BIN} also deletes the {del?.trash.folder ? 'whole project folder' : 'file'} from disk.
            </DialogDescription>
          </DialogHeader>
          <div className="mx-5 mt-4 flex items-center gap-3 rounded-md border bg-background px-3 py-2.5">
            {del?.trash.folder ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] font-medium">{del?.name}</div>
              {/* path ellipsised from the left so the folder name stays visible */}
              <div className="truncate text-left text-xs text-muted-foreground [direction:rtl]"><bdi dir="ltr">{del && tilde(del.trash.path)}</bdi></div>
            </div>
          </div>
          {delError && <p className="mx-5 mt-3 text-xs text-destructive">{delError}</p>}
          <DialogFooter className="mt-5 items-center border-t bg-background/60 px-5 py-3 sm:justify-between">
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => remove(true)}>
              <Trash2 />Move to {BIN}
            </Button>
            <span className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDel(null)}>Cancel</Button>
              <Button size="sm" autoFocus onClick={() => remove(false)}>Remove from list</Button>
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
