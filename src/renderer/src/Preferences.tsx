// Preferences: the live store (main/prefs.ts owns the file and pushes every change to every window) and the
// Settings page: fills the main window, with a tab down the side per section. App menu › Settings… / File › Preferences…, Mod+,,
// or Settings on the Home page.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Compat } from './contracts'
import { useCommands } from './commands'
import { About, Shortcuts, type Info } from './Help'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COMPATS } from './project/project'
import { AUTOSAVE_MAX, AUTOSAVE_MIN, type Prefs, type Theme } from './prefs'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

let cur: Prefs = window.api.prefs.initial
let saveErr = '' // the last change couldn't be written to disk (main says why)
const subs = new Set<() => void>(), sub = (f: () => void) => (subs.add(f), () => void subs.delete(f))
const apply = () => document.documentElement.classList.toggle('no-grid', !cur.grid) // style.css
apply()
window.api.prefs.onChange((p) => ((cur = p), apply(), subs.forEach((f) => f())))
export const prefs = () => cur
export const usePrefs = () => useSyncExternalStore(sub, prefs)
const saved = (q: Promise<Prefs>) =>
  void q.then(() => '', (e) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')).then((m) => ((saveErr = m), subs.forEach((f) => f())))
const setPrefs = (p: Partial<Prefs>) => saved(window.api.prefs.set(p))
// run settings for a new project / loose file
export const newSim = () => (Object.keys(cur.sim).length ? { sim: { ...cur.sim } } : {})

// light or dark in effect (Settings › Theme, or the OS for System): for what CSS can't theme (canvas, CodeMirror)
const DARK = '(prefers-color-scheme: dark)'
export const isDark = () => matchMedia(DARK).matches
export const useDark = () => useSyncExternalStore((f) => {
  const m = matchMedia(DARK)
  m.addEventListener('change', f)
  return () => m.removeEventListener('change', f)
}, isDark)

const MAC = /Mac/.test(navigator.platform)
const COMPAT_NAME: Record<Compat, string> = { ps: 'PSpice', lt: 'LTspice', ltps: 'LTspice + PSpice', kicad: 'KiCad' } // as main.tsx's Run settings
const AUTO = 'auto'

const TABS = [['appearance', 'Appearance'], ['schematic', 'Schematic'], ['autosave', 'Autosave'], ['new', 'New projects and files'], ['engine', 'Simulation engine'],
  ['keys', 'Keyboard shortcuts'], ['about', 'About']] as const
type Tab = (typeof TABS)[number][0]
const TabCtx = createContext<Tab | null>(null) // the section on show (Section renders only its own)
let show: (() => void) | undefined
export const openSettings = () => show?.() // Home's Settings button

export function Preferences() {
  const [open, setOpen] = useState(false), [tab, setTab] = useState<Tab>('appearance')
  const [info, setInfo] = useState<Info | null>(null)
  const box = useRef<HTMLDivElement>(null)
  show = () => setOpen(true)
  useCommands([{ id: 'app.preferences', keys: 'Mod+,', run: () => setOpen((o) => !o) }])
  useEffect(() => {
    if (!open) return
    box.current?.focus() // keys typed here stay here (the canvas has single-key shortcuts)
    Promise.all([window.api.menu.info(), window.api.engine()]).then(([a, engine]) => setInfo({ ...a, engine }))
  }, [open])
  if (!open) return null
  const title = TABS.find(([id]) => id === tab)![1]
  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Settings" className="fixed inset-0 z-50 flex bg-background text-sm outline-none"
      onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && !(e.target as Element).closest('input,textarea,[role=combobox],[role=listbox]') && setOpen(false))}>
      <nav className="flex w-60 shrink-0 flex-col gap-0.5 border-r bg-card/40 px-3 pb-3" aria-label="Settings sections">
        {/* top-left: Back, to the right of the macOS window buttons; the rest of the strip drags the window */}
        <div className={cn('-mx-3 flex h-11 shrink-0 items-center px-2 [-webkit-app-region:drag]', MAC && 'pl-[78px]')}>
          <Button variant="ghost" size="sm" className="[-webkit-app-region:no-drag]" onClick={() => setOpen(false)}><ArrowLeft />Back</Button>
        </div>
        <h1 className="mb-2 px-2 text-base font-semibold">Settings</h1>
        {TABS.map(([id, name]) => (
          <Button key={id} variant="ghost" size="sm" aria-current={id === tab ? 'page' : undefined} onClick={() => setTab(id)}
            className={cn('h-9 justify-start px-2 font-normal text-muted-foreground', id === tab && 'bg-accent font-medium text-foreground')}>{name}</Button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">{/* not <main>: style.css lays every <main> out as the editor's two-column grid */}
        <div className="h-11 [-webkit-app-region:drag]" />
        <div className="max-w-[760px] px-10 pb-12">
          <h2 className="mb-5 text-lg font-semibold">{title}</h2>
          {tab === 'keys' ? <Shortcuts /> : tab === 'about' ? <About info={info} /> : <TabCtx value={tab}><PreferencesPanel /></TabCtx>}
        </div>
      </div>
    </div>
  )
}

const Section = ({ id, children }: { id: Tab; children: ReactNode }) => (useContext(TabCtx) === id ? <section className="grid gap-4">{children}</section> : null)
const Row = ({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) => (
  <div className="grid grid-cols-[160px_1fr] items-center gap-3">
    <Label htmlFor={htmlFor} className="font-normal">{label}</Label>
    <div className="flex min-w-0 items-center gap-2">{children}</div>
  </div>
)
const Check = ({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) => (
  <Label htmlFor={id} className="items-start font-normal leading-snug">
    <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
    <span className="grid gap-1">{children}</span>
  </Label>
)
const Hint = ({ children }: { children: ReactNode }) => <span className="text-xs text-muted-foreground">{children}</span>
// a path, ellipsised from the left so the file/folder name stays visible
const PathText = ({ path, empty }: { path: string; empty: string }) => (
  <code className="min-w-0 flex-1 truncate text-left font-mono text-xs [direction:rtl]" title={path || undefined}>
    <bdi dir="ltr">{path || <span className="font-sans text-muted-foreground">{empty}</span>}</bdi>
  </code>
)
// number box committed on Enter / blur (each keystroke would be clamped mid-typing)
function Num({ id, value, unit, min, max, placeholder, onCommit }: { id: string; value?: number; unit: string; min: number; max?: number; placeholder?: string; onCommit: (v: number | undefined) => void }) {
  const [t, setT] = useState(value == null ? '' : String(value))
  useEffect(() => setT(value == null ? '' : String(value)), [value])
  const commit = () => onCommit(t.trim() === '' ? undefined : Number(t))
  return (
    <InputGroup className="h-8 w-28">
      <InputGroupInput id={id} type="number" min={min} max={max} step={1} placeholder={placeholder} value={t}
        onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      <InputGroupAddon align="inline-end">{unit}</InputGroupAddon>
    </InputGroup>
  )
}

// the settings themselves: one Section per tab
function PreferencesPanel() {
  const p = usePrefs()
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof window.api.engine>> | null>(null)
  const [defDir, setDefDir] = useState('')
  useEffect(() => void window.api.project.defaultParent().then(setDefDir), [])
  useEffect(() => void window.api.engine().then(setEngine), [p.ngspicePath])
  const pickDir = async () => {
    const d = await window.api.project.pickParent(p.projectDir || defDir)
    if (d) setPrefs({ projectDir: d })
  }
  const pickEngine = () => saved(window.api.prefs.pickEngine()) // main runs the picker and stores the path itself
  const err = useSyncExternalStore(sub, () => saveErr)

  return (
    <div>
      {err && <p role="alert" className="mb-3 text-xs text-destructive">{err}</p>}
      <Section id="appearance">
        <Row label="Theme">
          <ToggleGroup type="single" variant="outline" size="sm" value={p.theme} onValueChange={(v) => v && setPrefs({ theme: v as Theme })} aria-label="Theme">
            <ToggleGroupItem value="light" className="px-3">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark" className="px-3">Dark</ToggleGroupItem>
            <ToggleGroupItem value="system" className="px-3">System</ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Section>

      <Section id="schematic">
        <Check id="pref-grid" checked={p.grid} onChange={(grid) => setPrefs({ grid })}>Show the grid</Check>
        <Check id="pref-op" checked={p.showOp} onChange={(showOp) => setPrefs({ showOp })}>
          Show operating-point values on the schematic after a run
          <Hint>The OP button on the canvas toolbar still turns them on and off.</Hint>
        </Check>
      </Section>

      <Section id="autosave">
        <Check id="pref-autosave" checked={p.autosave} onChange={(autosave) => setPrefs({ autosave })}>
          Keep recovery copies of unsaved work
          <Hint>Copies go in Spice Studio's own folder, never over your files. If the app quits unexpectedly, the Home page offers them back next time, and so does opening the project.</Hint>
        </Check>
        <Row label="Save a copy every" htmlFor="pref-every">
          <Num id="pref-every" value={p.autosaveSecs} unit="s" min={AUTOSAVE_MIN} max={AUTOSAVE_MAX} onCommit={(v) => setPrefs({ autosaveSecs: v ?? p.autosaveSecs })} />
          <Hint>also when you pause or switch windows</Hint>
        </Row>
      </Section>

      <Section id="new">
        <Row label="Project folder">
          <PathText path={p.projectDir || defDir} empty="Documents/Spice Studio" />
          <Button variant="outline" size="sm" onClick={pickDir}>Change…</Button>
          {p.projectDir && <Button variant="ghost" size="sm" onClick={() => setPrefs({ projectDir: '' })}>Reset</Button>}
        </Row>
        <Row label="Compatibility">
          <Select value={p.sim.compat ?? AUTO} onValueChange={(v) => setPrefs({ sim: { ...p.sim, compat: v === AUTO ? undefined : (v as Compat) } })}>
            <SelectTrigger size="sm" className="w-64" aria-label="Compatibility"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Auto (from the parts' libraries)</SelectItem>
              {COMPATS.map((c) => <SelectItem key={c} value={c}>{COMPAT_NAME[c]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Timeout" htmlFor="pref-timeout">
          <Num id="pref-timeout" value={p.sim.timeoutS} unit="s" min={0} placeholder="none" onCommit={(timeoutS) => setPrefs({ sim: { ...p.sim, timeoutS } })} />
        </Row>
        <Hint>The run settings a new project or a loose file starts with. Change them for one project with Run settings in the editor.</Hint>
      </Section>

      <Section id="engine">
        <Row label="ngspice">
          <PathText path={p.ngspicePath} empty="Bundled with Spice Studio" />
          <Button variant="outline" size="sm" onClick={pickEngine}>Choose…</Button>
          {p.ngspicePath && <Button variant="ghost" size="sm" onClick={() => setPrefs({ ngspicePath: '' })}>Use bundled</Button>}
        </Row>
        {engine && (
          <Row label="In use">
            <span className="grid min-w-0 gap-0.5">
              <span className={/^ngspice-/.test(engine.version) ? 'font-mono text-xs' : 'text-xs text-warn'}>{engine.version}{engine.bundled ? ' (bundled)' : ''}</span>
              {engine.path && engine.path !== p.ngspicePath && <PathText path={engine.path} empty="" />}
            </span>
          </Row>
        )}
      </Section>
    </div>
  )
}
