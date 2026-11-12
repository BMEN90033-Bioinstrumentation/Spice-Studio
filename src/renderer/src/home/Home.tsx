import { useEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react'
import { validName } from '../project/project'
import { TEMPLATES } from '../schematic/templates'
import { BookOpen, File, FileText, Folder, FolderOpen, Plus, type LucideIcon } from 'lucide-react'
import { SymBody, localBox } from '../library/Symbol'
import { xform, type Sheet } from '../schematic/model'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Tip } from '@/components/ui/tip'
import { cn } from '@/lib/utils'
import { keyLabel } from '../layout/Panel'

type Recent = { name: string; file: string; opened: number; exists: boolean }

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536e3], ['month', 2592e3], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
function ago(t: number) {
  const s = (t - Date.now()) / 1000
  for (const [u, n] of UNITS) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u)
  return 'just now'
}
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

export const BLANK = 'blank'
const CHOICES: { id: string; name: string; description: string; sheet?: Sheet }[] = [
  { id: BLANK, name: 'Blank', description: 'An empty main sheet.' },
  ...TEMPLATES.map((t) => ({ ...t, sheet: t.sheets['main.nsch'] }))
]

// the app mark (build/icon.svg's tile and trace)
const Logo = ({ className }: { className?: string }) => (
  <svg viewBox="1 1 46 46" className={className} aria-hidden="true">
    <rect x="1" y="1" width="46" height="46" rx="10.3" fill="#1b2530" stroke="#2f4a5c" strokeWidth="0.6" />
    <path d="M8 30h7l3-12 5 20 5-26 4 18h8" fill="none" stroke="#4fc3f7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// A template's main sheet, drawn small with the canvas's own symbols and colours (no names, values or directives).
function Thumb({ sheet }: { sheet: Sheet }) {
  const pts = [
    ...sheet.wires.flatMap((w) => [w.a, w.b]),
    ...sheet.parts.flatMap((p) => { const b = localBox(p.kind, p); return [xform(p, { x: b.x0, y: b.y0 }), xform(p, { x: b.x1, y: b.y1 })] })
  ]
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y), x0 = Math.min(...xs), y0 = Math.min(...ys)
  return (
    <svg viewBox={`${x0} ${y0} ${Math.max(...xs) - x0} ${Math.max(...ys) - y0}`} className="size-full fill-none [stroke-linecap:round] [stroke-linejoin:round] [&_*]:[vector-effect:non-scaling-stroke]" strokeWidth={1.25} aria-hidden="true">
      <g className="stroke-wire">{sheet.wires.map((w) => <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />)}</g>
      <g className="stroke-sym [&_.f]:fill-sym [&_.shade]:stroke-none">
        {sheet.parts.map((p) => <g key={p.id} transform={`translate(${p.x} ${p.y}) rotate(${p.rot * 90}) scale(${p.mirror ? -1 : 1} 1)`}><SymBody kind={p.kind} part={p} /></g>)}
      </g>
    </svg>
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
const TIPS: [string[], string][] = [[['R', 'C', 'L', 'V'], 'place a part'], [['W'], 'draw a wire'], [['Alt'], 'click to probe a net'], [['Mod+Enter'], 'run'], [['Mod+/'], 'all shortcuts']]
const H2 = 'mb-3 text-[13px] font-semibold'

export function Home({ onCreate, onOpen, onOpenFile, onLibrary, error, form, setForm }: {
  onCreate: (parent: string, name: string, template: string) => Promise<void>
  onOpen: (file?: string) => Promise<void>
  onOpenFile: () => Promise<void>
  onLibrary: () => void
  error: string
  form: boolean // the new-project form (owned by App: File › New Project opens it)
  setForm: (open: boolean) => void
}) {
  const [recents, setRecents] = useState<Recent[] | null>(null)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [tpl, setTpl] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof window.api.engine>> | null>(null)
  const [version, setVersion] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  const reload = () => window.api.recent.list().then(setRecents)
  const checkEngine = () => window.api.engine().then(setEngine) // looked up afresh each call: picks up an ngspice installed since launch
  useEffect(() => {
    reload()
    checkEngine()
    window.api.menu.info().then((i) => setVersion(i.version))
    window.api.project.defaultParent().then((p) => setParent((cur) => cur || p))
  }, [])
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
    await onCreate(parent, name.trim(), tpl).finally(() => setBusy(false))
  }
  const pick = async () => {
    const p = await window.api.project.pickParent(parent)
    if (p) setParent(p)
  }

  const desc = CHOICES.find((t) => t.id === tpl)?.description
  return (
    <div className="relative flex h-full bg-background">
      <div className="home-drag" />
      <aside className="home-side flex w-60 shrink-0 flex-col border-r bg-card px-3 pb-3">
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <Logo className="size-7" />
          <div className="leading-tight">
            <div className="text-sm font-semibold">Spice Studio</div>
            {version && <div className="text-xs text-muted-foreground">Version {version}</div>}
          </div>
        </div>
        <nav className="grid gap-0.5" aria-label="Start">
          <Action icon={Plus} title="New project" tip="Start blank or from a template" keys="Mod+N" className={cn(form && 'bg-accent')} onClick={() => setForm(!form)} aria-expanded={form} />
          <Action icon={Folder} title="Open project…" tip="A .nsproj project folder" keys="Mod+O" onClick={() => onOpen()} />
          <Action icon={File} title="Open file…" tip="A single .nsch schematic or .cir netlist" keys="Mod+Shift+O" onClick={onOpenFile} />
          <Action icon={BookOpen} title="Component library" tip="Diodes, transistors and op-amps with their models" className="mt-3" onClick={onLibrary} />
        </nav>
        {engine && (
          <Tip label={engine.path ?? 'ngspice not found'} side="right">
            <div className="mt-auto flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', engine.path ? 'bg-ok' : 'bg-warn')} />
              <span className={cn(!engine.path && 'text-warn')}>{engine.version}</span>
              {engine.bundled && <span className="ml-auto">Bundled</span>}
            </div>
          </Tip>
        )}
      </aside>

      <main className="home-main block min-w-0 flex-1 overflow-y-auto px-10 pb-12">
        <div className="mx-auto max-w-[880px]">
          {error && <Alert variant="destructive" className="mb-6"><AlertDescription>{error}</AlertDescription></Alert>}
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

          <section className="mb-10">
            <h2 className={H2}>New project</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3">
              {CHOICES.map((t) => {
                const on = form && tpl === t.id
                return (
                  <button key={t.id} type="button" aria-pressed={on} onClick={() => (setTpl(t.id), setForm(true))}
                    className="group grid gap-2 rounded-md text-left outline-none">
                    <span className={cn('grid aspect-[8/5] place-items-center rounded-md border bg-black/15 p-4 text-muted-foreground transition-colors group-hover:border-input group-hover:bg-black/25 group-focus-visible:ring-2 group-focus-visible:ring-ring',
                      on && 'border-foreground/70 group-hover:border-foreground/70')}>
                      {t.sheet ? <Thumb sheet={t.sheet} /> : <Plus className="size-5" strokeWidth={1.5} />}
                    </span>
                    <span className={cn('truncate text-xs', on ? 'font-medium text-foreground' : 'text-muted-foreground group-hover:text-foreground')}>{t.name}</span>
                  </button>
                )
              })}
            </div>

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

          <section>
            <h2 className={H2}>Recent</h2>
            {recents?.length === 0 && (
              <div className="grid gap-4 border-t pt-4 text-muted-foreground">
                <p>Nothing here yet. Pick a template above, or open a project you already have.</p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                  {TIPS.map(([keys, what]) => (
                    <span key={what} className="flex items-center gap-1.5">
                      <span className="flex gap-0.5">{keys.map((k) => <Kbd key={k}>{k === 'Alt' && /Mac/.test(navigator.platform) ? '⌥' : keyLabel(k)}</Kbd>)}</span>{what}
                    </span>
                  ))}
                </div>
              </div>
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
                      {!r.exists && (
                        <Button variant="ghost" size="sm" className="relative h-6 px-2 text-xs" onClick={() => window.api.recent.remove(r.file).then(reload)} aria-label={`Remove ${r.name} from recents`}>Remove</Button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
