// Preferences: the live store (main/prefs.ts owns the file and pushes every change to every window) and the
// Settings page: fills the main window, with a tab down the side per section. App menu › Settings… / File › Preferences…, Mod+,,
// or Settings on the Home page.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { Compat } from './contracts'
import { setKeys, useCommands } from './commands'
import { keyLabel } from './layout/Panel'
import { clash, comboOf, FIXED, keysFor, SHORTCUTS } from './shortcuts'
import { About, type Info } from './Help'
import { Activity, ArrowLeft, CircuitBoard, Cpu, ExternalLink, EyeOff, FolderPlus, Grid3x3, Grip, History, Info as InfoIcon, Keyboard, Monitor, Moon, Move, Palette, PanelRight, RotateCcw, Sun, ZoomIn, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COMPATS } from './project/project'
import { SCH_DEFAULT, SCH_THEMES, schThemeCss, type SchColors } from './schematic/themes'
import { AUTOSAVE_MAX, AUTOSAVE_MIN, EDITOR_FONTS, PLOT_WIDTHS, UI_SCALES, type Prefs, type Theme } from './prefs'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

let cur: Prefs = window.api.prefs.initial
let saveErr = '' // the last change couldn't be written to disk (main says why)
const subs = new Set<() => void>(), sub = (f: () => void) => (subs.add(f), () => void subs.delete(f))
const FONT = { s: '8px', m: '9px', l: '11px' }, STROKE = { thin: '1', normal: '1.5', bold: '2.2' }
// what the stylesheets and the shortcut handlers read: grid (style.css), schematic text and line weight (schematic.css),
// netlist editor text size (Editor.tsx), the changed shortcuts (commands.ts)
const schStyle = document.head.appendChild(document.createElement('style')) // the schematic colour theme; unlayered, so it wins
const apply = () => {
  const r = document.documentElement
  schStyle.textContent = schThemeCss(cur.schTheme)
  r.classList.toggle('no-grid', !cur.grid)
  r.style.setProperty('--sch-font', FONT[cur.labelSize]), r.style.setProperty('--sch-stroke', STROKE[cur.lineWeight])
  cur.editorFont ? r.style.setProperty('--editor-font', cur.editorFont + 'px') : r.style.removeProperty('--editor-font')
  setKeys(cur.keys)
}
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

const TABS = [['appearance', 'Appearance', Palette], ['schematic', 'Schematic', CircuitBoard], ['sim', 'Simulation and plots', Activity], ['autosave', 'Autosave', History],
  ['new', 'New projects and files', FolderPlus], ['engine', 'Simulation engine', Cpu], ['keys', 'Keyboard shortcuts', Keyboard], ['about', 'About', InfoIcon]] as const satisfies readonly (readonly [string, string, LucideIcon])[]
type Tab = (typeof TABS)[number][0]
const TabCtx = createContext<Tab | null>(null) // the section on show (Section renders only its own)
let show: ((tab?: Tab) => void) | undefined
export const openSettings = (tab?: Tab) => show?.(tab) // Home's Settings button; Help › Keyboard Shortcuts

export function Preferences() {
  const [open, setOpen] = useState(false), [tab, setTab] = useState<Tab>('appearance')
  const [info, setInfo] = useState<Info | null>(null)
  const box = useRef<HTMLDivElement>(null)
  show = (t) => (t && setTab(t), setOpen(true))
  useCommands([{ id: 'app.preferences', keys: 'Mod+,', run: () => setOpen((o) => !o) }])
  useEffect(() => {
    if (!open) return
    box.current?.focus() // keys typed here stay here (the canvas has single-key shortcuts)
    Promise.all([window.api.menu.info(), window.api.engine()]).then(([a, engine]) => setInfo({ ...a, engine }))
    // a key pressed while focus is outside the page (the focused control went away): it must not reach the canvas
    const stray = (e: KeyboardEvent) => {
      if (box.current?.contains(e.target as Node)) return
      e.stopPropagation()
      e.key === 'Escape' ? setOpen(false) : box.current?.focus()
    }
    window.addEventListener('keydown', stray, true)
    return () => window.removeEventListener('keydown', stray, true)
  }, [open])
  if (!open) return null
  const title = TABS.find(([id]) => id === tab)![1]
  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Settings" className="fixed inset-0 z-50 flex bg-background text-sm outline-none"
      onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && !(e.target as Element).closest('input,textarea,[role=combobox],[role=listbox],[data-capture]') && setOpen(false))}>
      <nav className="flex w-60 shrink-0 flex-col gap-0.5 border-r bg-card/40 px-3 pb-3" aria-label="Settings sections">
        {/* top-left: Back, to the right of the macOS window buttons; the rest of the strip drags the window */}
        <div className={cn('-mx-3 flex h-11 shrink-0 items-center px-2 [-webkit-app-region:drag]', MAC && 'pl-[78px]')}>
          <Button variant="ghost" size="sm" className="[-webkit-app-region:no-drag]" onClick={() => setOpen(false)}><ArrowLeft />Back</Button>
        </div>
        <h1 className="mb-2 px-2 text-base font-semibold">Settings</h1>
        {TABS.map(([id, name, Icon]) => (
          <Button key={id} variant="ghost" size="sm" aria-current={id === tab ? 'page' : undefined} onClick={() => setTab(id)}
            className={cn('h-9 justify-start gap-2.5 px-2 font-normal text-muted-foreground', id === tab && 'bg-accent font-medium text-foreground')}><Icon />{name}</Button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">{/* not <main>: style.css lays every <main> out as the editor's two-column grid */}
        <div className="h-11 [-webkit-app-region:drag]" />
        <div className="max-w-[760px] px-10 pb-12">
          <h2 className="mb-5 text-lg font-semibold">{title}</h2>
          {tab === 'keys' ? <KeysEditor /> : tab === 'about' ? <About info={info} /> : <TabCtx value={tab}><PreferencesPanel /></TabCtx>}
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
// Schematic colours: a sample circuit drawn in a theme's colours, every one of them in use (Default: the app's own, from the stylesheets)
const SCH_PREVIEWS: { id: string; name: string; c: SchColors }[] = [{ id: SCH_DEFAULT, name: 'Default', c: { background: 'var(--bg)', grid: 'var(--line-strong)', component_outline: 'var(--sym)',
  component_body: 'color-mix(in srgb, var(--sym) 14%, transparent)', reference: 'var(--text)', value: 'var(--dim)', wire: 'var(--wire)', junction: 'var(--wire)',
  bus: 'light-dark(#2f6fb0, #5b9bd5)', note: 'light-dark(#4a5d73, #8fa3ba)', no_connect: 'var(--err)', erc_error: 'var(--err)' } }, ...SCH_THEMES] // bus, note: as schematic.css
// laid out so that no text, wire or part touches another, and text sits between the grid rows (dots every 20)
const SchPreview = ({ c, className }: { c: SchColors; className?: string }) => (
  <svg viewBox="0 0 240 146" className={className} style={{ background: c.background }} fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fontSize="7" fontFamily="var(--mono)" aria-hidden="true">
    {Array.from({ length: 12 }, (_, i) => 10 + 20 * i).flatMap((x) => [10, 30, 50, 70, 90, 110, 130].map((y) => <circle key={x + ',' + y} cx={x} cy={y} r=".7" fill={c.grid} />))}
    {/* wires: source to the RC filter, into the buffer and its feedback, out to the port; ground rail; the bus taps */}
    <path d="M30 70V30H50M80 30H130M100 30V56M100 62V110M30 90V110H100M65 110V116M166 40H204M190 40V76H120V50H130M204 88V116M220 88V116" stroke={c.wire} />
    <path d="M130 116H232" stroke={c.bus} strokeWidth="3.2" />
    <g stroke={c.component_outline}>
      <circle cx="30" cy="80" r="10" fill={c.component_body} />
      <path d="M130 20V60L166 40ZM204 35H218L223 40L218 45H204Z" fill={c.component_body} />
      <path d="M30 74V78M28 76H32M28 85H32M50 30l3-6 6 12 6-12 6 12 6-12 3 6M90 56H110M90 62H110M58 116H72M61 119H69M64 122H66M140 25.6V16M133 30H137M135 28V32M133 50H137" />
    </g>
    {[[100, 30], [65, 110], [190, 40]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2" fill={c.junction} />)}
    <path d="M137 9l6 6M143 9l-6 6" stroke={c.no_connect} />
    <rect x="196" y="64" width="32" height="24" stroke={c.erc_error} strokeDasharray="3 2.5" />
    <text x="212" y="82" textAnchor="middle" fill={c.erc_error}>X1 ?</text>
    <g fill={c.reference}>
      <text x="45" y="78">V1</text><text x="65" y="20" textAnchor="middle">R1</text><text x="86" y="58" textAnchor="end">C1</text><text x="174" y="26">U1</text>
      <text x="213" y="26" textAnchor="middle">out</text><text x="132" y="126">D[0..3]</text>
    </g>
    <g fill={c.value}><text x="45" y="86">5V</text><text x="65" y="46" textAnchor="middle">10k</text><text x="86" y="66" textAnchor="end">10n</text><text x="174" y="58">741</text></g>
    <text x="12" y="139" fill={c.note}>Note: RC low-pass, buffered</text>
  </svg>
)
// a theme at a glance: its colours round a ring (each once), its background in the middle
const SchSwatch = ({ c: { background, ...rest } }: { c: SchColors }) => {
  const ring = [...new Set(Object.values(rest))]
  return <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-foreground/25"
    style={{ background: `radial-gradient(${background} 0 34%, transparent 38%), conic-gradient(${[...ring, ring[0]].join(',')})` }} />
}
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

const Pick = ({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: (readonly [string, string])[] | [string, string][]; label: string }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger size="sm" className="w-32" aria-label={label}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(([v, t]) => <SelectItem key={v} value={v}>{t}</SelectItem>)}</SelectContent>
  </Select>
)

// Keyboard shortcuts: click a shortcut, press the new keys. Esc cancels, Backspace removes the shortcut.
function KeysEditor() {
  const p = usePrefs()
  const [cap, setCap] = useState<string | null>(null) // the id being changed
  const [msg, setMsg] = useState<{ id: string; text: string } | null>(null)
  const set = (id: string, keys: string | null) => { // null = back to the default
    const next = { ...p.keys }
    keys === null ? delete next[id] : (next[id] = keys)
    setPrefs({ keys: next })
  }
  function onKey(e: React.KeyboardEvent, id: string) {
    e.preventDefault(), e.stopPropagation()
    if (e.key === 'Escape') return setCap(null)
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return set(id, ''), setCap(null), setMsg(null)
    const keys = comboOf(e, MAC)
    if (!keys) return // a modifier on its own: keep waiting
    const why = clash(p.keys, id, keys)
    if (why) return setMsg({ id, text: `${keyLabel(keys)}: ${why}` })
    set(id, keys), setCap(null), setMsg(null)
  }
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))]
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <p className="flex-1 text-xs text-muted-foreground">Click a shortcut, then press the new keys. Esc cancels; Backspace leaves the command without a shortcut.</p>
        <Button variant="outline" size="sm" disabled={!Object.keys(p.keys).length} onClick={() => (setPrefs({ keys: {} }), setMsg(null))}><RotateCcw />Reset all</Button>
      </div>
      {groups.map((g) => (
        <section key={g}>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">{g}</h3>
          {SHORTCUTS.filter((s) => s.group === g).map((s) => {
            const keys = keysFor(p.keys, s.id), changed = s.id in p.keys, on = cap === s.id
            return (
              <div key={s.id} className="grid grid-cols-[1fr_auto_28px] items-center gap-2 border-b py-1">
                <span>{s.title}{msg?.id === s.id && <span role="alert" className="ml-3 text-xs text-destructive">{msg.text}</span>}</span>
                <Button data-capture variant={on ? 'default' : 'outline'} size="sm" className={cn('h-7 min-w-24 font-mono text-xs', !keys && !on && 'text-muted-foreground')}
                  aria-label={`Shortcut for ${s.title}: ${keys || 'none'}. Click to change`} onClick={() => (setCap(on ? null : s.id), setMsg(null))} onKeyDown={on ? (e) => onKey(e, s.id) : undefined} onBlur={() => on && setCap(null)}>
                  {on ? 'Press keys…' : keys ? keyLabel(keys) : 'None'}
                </Button>
                {changed ? <Button variant="ghost" size="icon-xs" aria-label={`Reset ${s.title} to ${keyLabel(s.keys)}`} title={`Reset to ${keyLabel(s.keys)}`} onClick={() => (set(s.id, null), setMsg(null))}><RotateCcw /></Button> : <span />}
              </div>
            )
          })}
        </section>
      ))}
      <section>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Fixed</h3>
        {FIXED.map(([what, k]) => <div key={what} className="flex items-center gap-3 border-b py-1.5 text-muted-foreground"><span className="flex-1">{what}</span><span className="font-mono text-xs">{keyLabel(k)}</span></div>)}
      </section>
    </div>
  )
}

// the settings themselves: one Section per tab
function PreferencesPanel() {
  const p = usePrefs()
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof window.api.engine>> | null>(null)
  const [defDir, setDefDir] = useState('')
  const [hl, setHl] = useState<string | null>(null) // Schematic colours: the highlighted item in the open list
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
            <ToggleGroupItem value="light" className="px-3"><Sun />Light</ToggleGroupItem>
            <ToggleGroupItem value="dark" className="px-3"><Moon />Dark</ToggleGroupItem>
            <ToggleGroupItem value="system" className="px-3"><Monitor />System</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Row label="Schematic colours">
          <Select value={p.schTheme} onValueChange={(schTheme) => setPrefs({ schTheme })} onOpenChange={() => setHl(null)}>
            <SelectTrigger size="sm" className="w-56" aria-label="Schematic colours"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SCH_PREVIEWS.map((t) => ( // the item under the pointer / arrow keys has focus: its preview is the one on show
                <Tooltip key={t.id} open={hl === t.id}>
                  <TooltipTrigger asChild><SelectItem value={t.id} onFocus={() => setHl(t.id)}><SchSwatch c={t.c} />{t.name}</SelectItem></TooltipTrigger>
                  {/* no frame: the card and its arrow take the theme's own background (the tooltip paints both with --foreground) */}
                  <TooltipContent side="right" sideOffset={14} className="p-0 shadow-xl" style={{ '--foreground': t.c.background } as CSSProperties}><SchPreview c={t.c} className="w-96 rounded-md" /></TooltipContent>
                </Tooltip>
              ))}
            </SelectContent>
          </Select>
          <Hint>the canvas only. KiCad colour themes by cosmopotamian</Hint>
        </Row>
        <Row label="Interface scale">
          <Pick value={String(p.uiScale)} onChange={(v) => setPrefs({ uiScale: +v })} label="Interface scale" options={UI_SCALES.map((v) => [String(v), `${Math.round(v * 100)} %`])} />
          <Hint>makes everything in every window larger or smaller</Hint>
        </Row>
        <Row label="Netlist text size">
          <Pick value={String(p.editorFont)} onChange={(v) => setPrefs({ editorFont: +v })} label="Netlist text size" options={EDITOR_FONTS.map((v) => [String(v), v ? `${v} px` : 'Default'])} />
          <Hint>the text in the netlist editor</Hint>
        </Row>
      </Section>

      <Section id="schematic">
        <Check id="pref-grid" checked={p.grid} onChange={(grid) => setPrefs({ grid })}>Show the grid</Check>
        <Row label="Grid style">
          <ToggleGroup type="single" variant="outline" size="sm" value={p.gridStyle} onValueChange={(v) => v && setPrefs({ gridStyle: v as Prefs['gridStyle'] })} aria-label="Grid style">
            <ToggleGroupItem value="dots" className="px-3"><Grip />Dots</ToggleGroupItem>
            <ToggleGroupItem value="lines" className="px-3"><Grid3x3 />Lines</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Row label="Label text size">
          <ToggleGroup type="single" variant="outline" size="sm" value={p.labelSize} onValueChange={(v) => v && setPrefs({ labelSize: v as Prefs['labelSize'] })} aria-label="Label text size">
            <ToggleGroupItem value="s" className="px-3">Small</ToggleGroupItem>
            <ToggleGroupItem value="m" className="px-3">Normal</ToggleGroupItem>
            <ToggleGroupItem value="l" className="px-3">Large</ToggleGroupItem>
          </ToggleGroup>
          <Hint>part names and values</Hint>
        </Row>
        <Row label="Line weight">
          <ToggleGroup type="single" variant="outline" size="sm" value={p.lineWeight} onValueChange={(v) => v && setPrefs({ lineWeight: v as Prefs['lineWeight'] })} aria-label="Line weight">
            <ToggleGroupItem value="thin" className="px-3">Thin</ToggleGroupItem>
            <ToggleGroupItem value="normal" className="px-3">Normal</ToggleGroupItem>
            <ToggleGroupItem value="bold" className="px-3">Bold</ToggleGroupItem>
          </ToggleGroup>
          <Hint>symbols and wires</Hint>
        </Row>
        <Row label="Scroll wheel">
          <ToggleGroup type="single" variant="outline" size="sm" value={p.wheel} onValueChange={(v) => v && setPrefs({ wheel: v as Prefs['wheel'] })} aria-label="Scroll wheel">
            <ToggleGroupItem value="pan" className="px-3"><Move />Pans</ToggleGroupItem>
            <ToggleGroupItem value="zoom" className="px-3"><ZoomIn />Zooms</ToggleGroupItem>
          </ToggleGroup>
          <Hint>{p.wheel === 'zoom' ? 'Shift+wheel, Space-drag or the middle button pans' : 'pinch or Ctrl+wheel zooms'}</Hint>
        </Row>
        <Check id="pref-op" checked={p.showOp} onChange={(showOp) => setPrefs({ showOp })}>
          Show operating-point values on the schematic after a run
          <Hint>The OP button on the canvas toolbar still turns them on and off.</Hint>
        </Check>
      </Section>

      <Section id="sim">
        <Check id="pref-live" checked={p.live} onChange={(live) => setPrefs({ live })}>
          Draw waveforms while the simulation runs
          <Hint>Off: the plot appears when the run ends. Progress still shows in the status bar.</Hint>
        </Check>
        <Check id="pref-show-results" checked={p.showResults} onChange={(showResults) => setPrefs({ showResults })}>
          Show the results when a run finishes
          <Hint>Opens the results panel if it is hidden. Off: a dot on its button says there are new results.</Hint>
        </Check>
        <Row label="When a project opens">
          <ToggleGroup type="single" variant="outline" size="sm" value={p.resultsOnOpen} onValueChange={(v) => v && setPrefs({ resultsOnOpen: v as Prefs['resultsOnOpen'] })} aria-label="Results when a project opens">
            <ToggleGroupItem value="hidden" className="px-3"><EyeOff />Hidden</ToggleGroupItem>
            <ToggleGroupItem value="docked" className="px-3"><PanelRight />Docked</ToggleGroupItem>
            <ToggleGroupItem value="window" className="px-3"><ExternalLink />Own window</ToggleGroupItem>
          </ToggleGroup>
          <Hint>where the results panel starts</Hint>
        </Row>
        <Row label="Trace thickness">
          <Pick value={String(p.plotWidth)} onChange={(v) => setPrefs({ plotWidth: +v })} label="Trace thickness" options={PLOT_WIDTHS.map((v) => [String(v), `${v} px`])} />
        </Row>
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
