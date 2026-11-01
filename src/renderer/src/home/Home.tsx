import { useEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react'
import { validName } from '../project/project'
import { TEMPLATES } from '../schematic/templates'
import { BookOpen, File, FileText, Folder, FolderOpen, Plus, type LucideIcon } from 'lucide-react'
import { SymBody } from '../library/Symbol'
import type { Kind } from '../schematic/symbols'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
const CHOICES = [{ id: BLANK, name: 'Blank', description: 'An empty main sheet.' }, ...TEMPLATES]

// Header art: an RC low-pass drawn with the canvas's own symbols, beside its step response (V(in) blue, V(out) amber).
const PARTS: [Kind, number, number, number][] = [['vsrc', 0, 60, 0], ['gnd', 0, 90, 0], ['res', 60, 0, 90], ['cap', 150, 30, 0], ['gnd', 150, 60, 0]]
const STEP = Array.from({ length: 41 }, (_, i) => { const t = i / 40; return `${240 + t * 170},${88 - 76 * (1 - Math.exp(-t * 5))}` }).join(' ')
// the app mark (build/icon.svg's tile and trace)
const Logo = ({ className }: { className?: string }) => (
  <svg viewBox="1 1 46 46" className={className} aria-hidden="true">
    <rect x="1" y="1" width="46" height="46" rx="10.3" fill="#1b2530" stroke="#2f4a5c" strokeWidth="0.6" />
    <path d="M8 30h7l3-12 5 20 5-26 4 18h8" fill="none" stroke="#4fc3f7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function Hero() {
  return (
    <svg viewBox="-46 -22 476 128" className="hidden h-32 w-auto shrink-0 sm:block" aria-hidden="true">
      <g className="fill-none stroke-sym [stroke-linecap:round] [stroke-linejoin:round] [&_*]:[vector-effect:non-scaling-stroke]" strokeWidth={1.5}>
        {PARTS.map(([k, x, y, r], i) => <g key={i} transform={`translate(${x} ${y}) rotate(${r})`}><SymBody kind={k} /></g>)}
      </g>
      <path d="M0 30V0H30M90 0H180" className="fill-none stroke-wire" strokeWidth={1.5} />
      <circle cx={150} cy={0} r={3} className="fill-wire" />
      <g className="fill-muted-foreground font-mono text-[10px]">
        <text x={60} y={-10} textAnchor="middle">R1 1k</text>
        <text x={164} y={34}>C1 1u</text>
        <text x={-20} y={64} textAnchor="end">V1</text>
        <text x={186} y={4}>out</text>
      </g>
      <g strokeWidth={1.5} className="fill-none">
        <path d="M240 10V96H418" className="stroke-border" />
        <path d="M240 88H246V12H410" className="stroke-hl" />
        <polyline points={STEP} className="stroke-warn" />
      </g>
    </svg>
  )
}

function Action({ icon: I, title, desc, keys, className, ...b }: { icon: LucideIcon; title: string; desc: string; keys?: string } & ComponentProps<typeof Button>) {
  return (
    <Button variant="outline" className={cn('h-auto items-start justify-start gap-3 p-3 text-left whitespace-normal', className)} {...b}>
      <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground"><I /></span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-center gap-2 font-medium">{title}{keys && <Kbd className="ml-auto">{keyLabel(keys)}</Kbd>}</span>
        <span className="text-xs font-normal text-muted-foreground">{desc}</span>
      </span>
    </Button>
  )
}
const TIPS: [string[], string][] = [[['R', 'C', 'L', 'V'], 'place a part'], [['W'], 'draw a wire'], [['Alt'], 'click to probe a net'], [['Mod+Enter'], 'run'], [['Mod+/'], 'all shortcuts']]

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
  const nameRef = useRef<HTMLInputElement>(null)

  const reload = () => window.api.recent.list().then(setRecents)
  const checkEngine = () => window.api.engine().then(setEngine) // looked up afresh each call: picks up an ngspice installed since launch
  useEffect(() => {
    reload()
    checkEngine()
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

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="home-bar gap-2">
        <Logo className="size-5" />
        <span className="text-sm font-medium">Spice Studio</span>
      </div>
      <div className="flex-1 overflow-y-auto px-10 pt-4 pb-12 *:mx-auto *:max-w-[760px]">
        <div className="mb-7 flex items-center gap-6 overflow-hidden rounded-xl border bg-card bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:12px_12px] px-6 py-5">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">Draw a circuit, simulate it, read the result.</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Schematic capture, analyses and plots for ngspice.</p>
            {engine && (
              <Tip label={engine.path ?? 'ngspice not found'}>
                <Badge variant="outline" className={cn('mt-4 gap-1.5 bg-background font-mono font-normal text-muted-foreground', !engine.path && 'border-warn/40 text-warn')}>
                  <span className={cn('size-1.5 rounded-full', engine.path ? 'bg-ok' : 'bg-warn')} />
                  {engine.version}{engine.bundled ? ' (bundled)' : ''}
                </Badge>
              </Tip>
            )}
          </div>
          <Hero />
        </div>

        {error && <Alert variant="destructive" className="mb-5"><AlertDescription>{error}</AlertDescription></Alert>}
        {engine && !engine.path && (
          <Alert role="status" className="mb-5 flex items-center gap-3 border-warn/30 bg-warn/10">
            <p className="flex-1">
              <b className="font-semibold text-warn">ngspice wasn't found.</b> You can draw and save circuits, but they can't be simulated until it is.{' '}
              {import.meta.env.DEV
                ? <>Build it with <code className="font-mono text-xs">npm run ngspice:build</code>, or install ngspice (<code className="font-mono text-xs">brew install ngspice</code>).</>
                : <>Reinstall Spice Studio to restore the bundled engine, or install ngspice yourself.</>}
            </p>
            <Button variant="outline" size="sm" onClick={checkEngine}>Check again</Button>
          </Alert>
        )}

        <div className="grid gap-7">
          <div>
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">Start</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2">
              <Action icon={Plus} title="New project" desc="Start blank or from a template" keys="Mod+N" className={cn(form && 'dark:border-ring')} onClick={() => setForm(!form)} aria-expanded={form} />
              <Action icon={Folder} title="Open project…" desc="A .nsproj project folder" keys="Mod+O" onClick={() => onOpen()} />
              <Action icon={File} title="Open file…" desc="A single .nsch schematic or .cir netlist" keys="Mod+Shift+O" onClick={onOpenFile} />
              <Action icon={BookOpen} title="Component library" desc="Diodes, transistors and op-amps with their models" onClick={onLibrary} />
            </div>

            {form && (
              <form className="mt-2.5 flex flex-col gap-3 rounded-xl border bg-card p-4" onSubmit={create}>
                <div className="grid gap-1.5">
                  <Label htmlFor="np-name" className="text-xs font-normal text-muted-foreground">Name</Label>
                  <Input id="np-name" ref={nameRef} className="h-8" value={name} onChange={(e) => setName(e.target.value)} placeholder="My amplifier" spellCheck={false}
                    aria-invalid={!!name && !validName(name)} aria-describedby={name && !validName(name) ? 'np-name-err' : undefined} />
                  {name && !validName(name) && <div id="np-name-err" className="text-xs text-destructive">No / \ : * ? " &lt; &gt; | and it can't start with "."</div>}
                </div>
                <div className="grid gap-1.5">
                  <span id="np-loc" className="text-xs text-muted-foreground">Location</span>
                  <InputGroup className="h-8" aria-labelledby="np-loc">
                    {/* rtl + ltr bdi: ellipsised from the left, so the folder name stays visible */}
                    <Tip label={parent}>
                      <code className="min-w-0 flex-1 truncate px-3 text-left font-mono text-xs [direction:rtl]"><bdi dir="ltr">{tilde(parent)}{name.trim() && validName(name) ? '/' + name.trim() : ''}</bdi></code>
                    </Tip>
                    <InputGroupAddon align="inline-end"><InputGroupButton onClick={pick}>Change…</InputGroupButton></InputGroupAddon>
                  </InputGroup>
                </div>
                <div className="grid gap-1.5">
                  <span id="np-tpl" className="text-xs text-muted-foreground">Template</span>
                  <RadioGroup aria-labelledby="np-tpl" value={tpl} onValueChange={setTpl} className="grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
                    {CHOICES.map((t) => (
                      <Label key={t.id} htmlFor={'tpl-' + t.id}
                        className="cursor-pointer items-start rounded-md border px-2.5 py-2 font-normal leading-snug hover:bg-accent/50 has-data-[state=checked]:border-ring has-data-[state=checked]:bg-accent">
                        <RadioGroupItem id={'tpl-' + t.id} value={t.id} className="mt-px" />
                        <span className="grid gap-0.5"><span className="font-medium">{t.name}</span><span className="text-xs text-muted-foreground">{t.description}</span></span>
                      </Label>
                    ))}
                  </RadioGroup>
                </div>
                <div className="mt-1 flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setForm(false)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={!ok || busy}>{busy ? 'Creating…' : 'Create project'}</Button>
                </div>
              </form>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">Recent</h2>
            <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
              {recents?.length === 0 && <div className="p-4 text-muted-foreground">No recent projects yet. Your projects show up here.</div>}
              {recents?.map((r) => (
                <div key={r.file} className="flex items-center gap-2 pr-3 hover:bg-accent/50">
                  <Tip label={r.exists ? r.file : 'Missing: ' + r.file}>
                    <Button variant="ghost" className="h-auto min-w-0 flex-1 items-center justify-start gap-3 rounded-none px-3 py-2.5 font-normal hover:bg-transparent disabled:opacity-100 dark:hover:bg-transparent"
                      disabled={!r.exists} onClick={() => onOpen(r.file)}>
                      <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">{/\.nsproj$/.test(r.file) ? <FolderOpen /> : <FileText />}</span>
                      <span className="grid min-w-0 gap-0.5 text-left">
                        <b className={cn('font-medium', !r.exists && 'text-muted-foreground')}>{r.name}</b>
                        {/* path ellipsised from the left so the folder name stays visible */}
                        <small className="min-w-0 truncate text-xs text-muted-foreground [direction:rtl]"><bdi dir="ltr">{tilde(r.file.replace(/\/[^/]*$/, ''))}</bdi></small>
                      </span>
                    </Button>
                  </Tip>
                  <span className="text-xs whitespace-nowrap text-muted-foreground">{r.exists ? ago(r.opened) : 'missing'}</span>
                  {!r.exists && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => window.api.recent.remove(r.file).then(reload)} aria-label={`Remove ${r.name} from recents`}>Remove</Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {TIPS.map(([keys, what]) => (
              <span key={what} className="flex items-center gap-1.5">
                <span className="flex gap-0.5">{keys.map((k) => <Kbd key={k}>{k === 'Alt' && /Mac/.test(navigator.platform) ? '⌥' : keyLabel(k)}</Kbd>)}</span>{what}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
