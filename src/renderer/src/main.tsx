import { Fragment, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { SimResult } from '../../main/index'
import type { OsOpen } from '../../preload/index'
import type { RawPlot } from '../../main/rawfile'
import { type Compat, type Diagnosis, type MeasTable, type ProjectSim, type SimOptions, type Stopped } from './contracts'
import { Editor } from './Editor'
import { Home } from './home/Home'
import { useCommands } from './commands'
import { Help } from './Help'
import { BUNDLED, copyOnUse, libEntries, resolver, type ImportedLib, type LibEntry } from './library/library'
import { LibraryView } from './library/LibraryView'
import { ManageLibraries } from './library/ManageLibraries'
import { useSources, type Sources } from './library/sources'
import { usePanels } from './layout/Panel'
import { newSim, prefs, Preferences } from './Preferences'
import { offerRecovery, RecoveryPrompt, restoreSession, useAutosave } from './Recovery'
import { focusPopout } from './layout/PopOut'
import { paneKey, ResultsPanel } from './layout/ResultsPanel'
import { defaultSel, pretty, type PlotRun } from './Plot'
import { bom, bomCsv, bomXlsx } from './project/bom'
import { BOMWIN, BomWindow } from './project/BomWindow'
import { COMPATS, newProject, type PartInfo, parseProject, refreshBlocks, renameRefs, sheetFile, type Project } from './project/project'
import { emptySheet, parseSheet, uid, type Sheet } from './schematic/model'
import { netlist, type NetCtx, type NetlistResult } from './schematic/netlist'
import { Schematic, type Overlay, type ProbeTarget, type SchematicHandle } from './schematic/Schematic'
import { TEMPLATES } from './schematic/templates'
import { blame, currentVectors, findVector, opVoltages, SAVE_CURRENTS, voltageVector, type Blame } from './sim/probe'
import { diagnose } from './sim/convergence'
import { erc, type Issue } from './sim/erc'
import { analysisPos, plotPanes } from './sim/analysis'
import { parseMeas } from './sim/meas'
import { plotRuns, startSel } from './sim/results'
import { expandSweep } from './sim/sweep'
import { keepSel, liveRun, progress } from './sim/live'
import { ArrowUpToLine, BookOpen, ChevronLeft, FileCode, FolderOpen, House, Pencil, Play, Plus, Save, SlidersHorizontal, Square, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tip } from '@/components/ui/tip'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import './index.css'

if (/Mac/.test(navigator.platform)) document.documentElement.classList.add('mac') // header leaves room for traffic lights

const EXAMPLE = `* RC low-pass filter, fc = 159 Hz
V1 in 0 DC 0 AC 1 PULSE(0 1 0 1u 1u 5m 10m)
R1 in out 1k
C1 out 0 1u
.tran 10u 20m
.ac dec 50 1 100k
.end
`

const base = (p: string | null) => p?.split(/[\\/]/).pop()
const dirOf = (p: string | null) => p?.replace(/[\\/][^\\/]*$/, '') || undefined
const stem = (f: string) => f.replace(/\.nsch$/i, '')
const json = (x: unknown) => JSON.stringify(x, null, 1)
// ipcRenderer.invoke wraps main-process errors in "Error invoking remote method …": show only the message
const msg = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type Run = { label: string; result: SimResult; netlist: string }
type Tab = { key: string; name: string; runs: PlotRun[]; panes?: { title: string; sel: string[] }[] } // panes: .plot lines
// plots keyed by plotname + occurrence, so the same analysis lines up across sweep runs
const keyed = (plots: RawPlot[]) => {
  const n: Record<string, number> = {}
  return new Map(plots.map((p) => [`${p.plotname}#${(n[p.plotname] = (n[p.plotname] ?? 0) + 1)}`, p]))
}
function tabsOf(runs: Run[]): Tab[] {
  const maps = runs.map((r) => keyed(r.result.plots))
  return [...(maps[0] ?? [])].map(([key, p]) => ({
    key,
    name: p.plotname,
    runs: runs.flatMap((r, i) => (maps[i].has(key) ? plotRuns(r.label, maps[i].get(key)!, r.netlist, +key.slice(key.lastIndexOf('#') + 1)) : [])), // nested .dc: a run per outer value
    panes: plotPanes(runs[0].netlist, p.plotname, p.vars.map((v) => v.name))
  })).sort((a, b) => analysisPos(runs[0].netlist, a.name) - analysisPos(runs[0].netlist, b.name))
}

// pack dialect hints (LibEntry.compat, e.g. 'ltspice') of the parts in use -> ngspice compat mode
const DIALECT: Record<string, Compat> = { ltspice: 'lt', lt: 'lt', pspice: 'ps', ps: 'ps', ltps: 'ltps', kicad: 'kicad' }
const COMPAT_NAME: Record<Compat, string> = { ps: 'PSpice', lt: 'LTspice', ltps: 'LTspice + PSpice', kicad: 'KiCad' }
function autoCompat(sheets: Sheet[], lib: (id: string) => LibEntry | undefined): Compat | undefined {
  const c = new Set(sheets.flatMap((s) => s.parts.map((p) => DIALECT[(p.lib && lib(p.lib)?.compat?.toLowerCase()) || ''])).filter(Boolean))
  return c.has('ltps') || (c.has('lt') && c.has('ps')) ? 'ltps' : [...c][0] // ponytail: kicad + another dialect: first wins
}

type Route = 'home' | 'editor' | 'library'
export type Session = (
  | { kind: 'project'; dir: string; file: string /* .nsproj, relative */; project: Project; sheets: Record<string, Sheet>; libTexts: Record<string, string>; warn: string }
  | { kind: 'loose'; path: string | null; sheet: Sheet; raw?: { path: string; plots: RawPlot[] } }
) & { net?: { path: string | null; text: string }; rid?: string; dirty?: string[] } // rid/dirty: restored from a recovery copy (Recovery.tsx); dirty 'net' = the netlist

const LOOSE = 'untitled.nsch' // the single sheet's key in loose-file mode
// Leaving the current session (window close/quit, a file opened from the OS): the mounted Workspace swaps in its
// unsaved-changes guard; with no session there's nothing to lose.
const leaving = { guard: (then: () => void) => then() }

async function loadProject(o: { dir: string; file: string; text: string }): Promise<Session> {
  const project = parseProject(o.text), api = window.api.project
  const sheets: Record<string, Sheet> = {}, libTexts: Record<string, string> = {}, missing: string[] = []
  for (const f of (await api.list(o.dir)).filter((f) => /^[^/]+\.nsch$/i.test(f))) {
    try {
      sheets[f] = parseSheet(await api.read(o.dir, f))
    } catch (e) {
      throw new Error(`Can't open ${f}: ${msg(e)}`)
    }
  }
  if (!sheets[project.top]) throw new Error(`The top sheet ${project.top} is missing from ${o.dir}`)
  for (const l of project.libs) await api.read(o.dir, l.file).then((t) => (libTexts[l.file] = t), () => missing.push(l.file))
  return { kind: 'project', dir: o.dir, file: base(o.file)!, project, sheets, libTexts, warn: missing.length ? `Missing library files: ${missing.join(', ')}` : '' }
}

// chrome class strings: header buttons, banners, sheets sidebar rows
const BANNER = 'flex shrink-0 items-center gap-2 border-b py-2 pr-3 pl-4'
const WARNBAR = cn(BANNER, 'border-warn/25 bg-warn/10')
const SIDE_H = 'flex items-center justify-between pt-2.5 pr-2 pb-1 pl-3.5 text-xs font-medium text-muted-foreground'
const row = (on: boolean) => cn('group mx-1.5 flex items-center rounded-md hover:bg-accent/50 focus-within:bg-accent/50', on && 'bg-accent hover:bg-accent focus-within:bg-accent')
const NM = 'h-7 min-w-0 flex-1 justify-start gap-0 px-2 font-normal hover:bg-transparent dark:hover:bg-transparent'
const Unsaved = () => <span className="text-warn"> •</span>
const HomeBtn = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Tip label={label}><Button variant="ghost" size="icon-sm" aria-label="Home" onClick={onClick}><House /></Button></Tip>
)
// a sidebar row's hover-revealed icon button
const Op = ({ label, aria, onClick, children }: { label: string; aria: string; onClick: () => void; children: ReactNode }) => (
  <Tip label={label}><Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={aria} onClick={onClick}>{children}</Button></Tip>
)
const AUTO = 'auto' // Select item for "no compat mode" (Radix Select can't use '')

function LibraryPage({ title, back, onHome, ...view }: Parameters<typeof LibraryView>[0] & { title: string; back?: () => void; onHome: () => void }) {
  return (
    <div className="app">
      <header>
        <HomeBtn label="Home" onClick={onHome} />
        {back && <Button variant="ghost" size="sm" onClick={back}><ChevronLeft />Back to editor</Button>}
        <span className="ml-1 font-semibold">Component library</span>
        <span className="text-muted-foreground">{title}</span>
      </header>
      <div className="libpage"><LibraryView {...view} /></div>
    </div>
  )
}

function App() {
  const [route, setRoute] = useState<Route>('home')
  const [session, setSession] = useState<Session | null>(null)
  const [gen, setGen] = useState(0) // remounts the workspace per session: fresh undo, tabs, plots
  const [error, setError] = useState('')
  const [form, setForm] = useState(false) // Home's new-project form: File › New Project opens it from anywhere
  const sources = useSources() // My library + packs: app-wide, survive sessions

  useEffect(() => {
    const osOpen = (x: OsOpen) =>
      'error' in x ? setError(x.error) : leaving.guard(() => start(async () => ('project' in x ? loadProject(x.project) : { kind: 'loose', path: x.path, sheet: parseSheet(x.text) })))
    window.api.osOpens().then((x) => x && osOpen(x))
    const offs = [window.api.onOsOpen(osOpen), window.api.onCloseRequest(() => leaving.guard(window.api.closeNow))]
    return () => offs.forEach((f) => f())
  }, [])
  useEffect(() => { if (!session) document.title = route === 'library' ? 'Component library — Spice Studio' : 'Spice Studio' }, [session, route])

  const start = async (f: () => Promise<Session | null>) => {
    try {
      const s = await offerRecovery(await f()) // a crash left unsaved work for it: restore / discard / later
      if (!s) return
      setSession(s), setGen((g) => g + 1), setRoute('editor'), setError(''), setForm(false)
    } catch (e) {
      setError(msg(e))
    }
  }

  const create = (parent: string, name: string, tpl: string) =>
    start(async () => {
      const t = TEMPLATES.find((t) => t.id === tpl)
      const src = t?.sheets ?? { 'main.nsch': emptySheet() }
      const project: Project = { ...newProject(name), ...newSim() }, file = name + '.nsproj'
      if (!src[project.top]) project.top = Object.keys(src)[0]
      const files: Record<string, string> = { [file]: json(project) }
      for (const [f, s] of Object.entries(src)) files[f] = json(s)
      const dir = await window.api.project.create(parent, name, files)
      // round-trip through parseSheet: validates the template and gives the session its own copies
      const sheets = Object.fromEntries(Object.keys(src).map((f) => [f, parseSheet(files[f])]))
      return { kind: 'project', dir, file, project, sheets, libTexts: {}, warn: '' }
    })
  const open = (file?: string) =>
    start(async () => {
      const o = file ? await window.api.project.openPath(file) : await window.api.project.open()
      return o && loadProject(o)
    })
  const openFile = () =>
    start(async () => {
      const f = await window.api.openFile()
      if (!f) return null
      if (/\.nsch$/i.test(f.path)) return { kind: 'loose', path: f.path, sheet: parseSheet(f.text) }
      return { kind: 'loose', path: null, sheet: emptySheet(), net: { path: f.path, text: f.text } }
    })
  // menu + shortcuts (commands.ts); leaving.guard asks about unsaved work first when a session is open
  useCommands([
    { id: 'file.newProject', keys: 'Mod+N', run: () => leaving.guard(() => (setSession(null), setRoute('home'), setForm(true))) },
    { id: 'file.openProject', keys: 'Mod+O', run: () => leaving.guard(() => open()) },
    { id: 'file.openFile', keys: 'Mod+Shift+O', run: () => leaving.guard(openFile) },
    { id: 'file.openRaw', run: () => leaving.guard(() => start(async () => { const r = await window.api.openRaw(); return r && { kind: 'loose', path: null, sheet: emptySheet(), raw: r } })) }, // a Workspace has its own
    { id: 'file.openRecent', run: (f) => f && leaving.guard(() => open(f)) }, // menu id 'file.openRecent:<file>'
    ...(session ? [] : [{ id: 'tools.library', run: () => setRoute('library') }, ...(route === 'library' ? [{ id: 'view.home', run: () => setRoute('home') }] : [])])
  ])

  if (session) return <Workspace key={gen} session={session} route={route} go={setRoute} onClose={() => (setSession(null), setRoute('home'))} sources={sources} />
  // no project: Manage Libraries here (a Workspace renders its own, with the project's libraries)
  return (
    <>
      {route === 'library'
        ? <LibraryPage title="All parts" onHome={() => setRoute('home')} entries={[...BUNDLED, ...sources.browse]} packs={sources.packs} />
        : <Home onCreate={create} onOpen={open} onOpenFile={openFile} onLibrary={() => setRoute('library')} error={error} form={form} setForm={setForm} onRestore={(r) => start(() => restoreSession(r, loadProject))} />}
      <ManageLibraries sources={sources} project={null} />
    </>
  )
}

function Workspace({ session, route, go, onClose, sources }: { session: Session; route: Route; go: (r: Route) => void; onClose: () => void; sources: Sources }) {
  const api = window.api.project
  const pdir = session.kind === 'project' ? session.dir : null
  const pfile = session.kind === 'project' ? session.file : ''
  const [proj, setProj] = useState<Project | null>(session.kind === 'project' ? session.project : null)
  const [libTexts, setLibTexts] = useState<Record<string, string>>(session.kind === 'project' ? session.libTexts : {})
  // Sheets: `disk` is the last snapshot of every sheet (open tabs hold the live copy, see live()); `dirty` = unsaved.
  // Refs, not state, so async save/rename flows always see current values; bump() re-renders.
  const disk = useRef<Record<string, Sheet>>(session.kind === 'project' ? { ...session.sheets } : { [LOOSE]: session.sheet })
  const dirty = useRef(new Set<string>(session.dirty?.filter((f) => f !== 'net')))
  const [rev, bump] = useReducer((x: number) => x + 1, 0)
  const handles = useRef<Record<string, SchematicHandle | null>>({})
  const ids = useRef<Record<string, string>>({}) // file -> stable React key, survives renames
  const top = proj?.top ?? LOOSE
  const [open, setOpen] = useState<string[]>([top])
  const [view, setView] = useState(session.kind === 'loose' && session.net ? 'net' : top) // sheet file or 'net'
  const [crumbs, setCrumbs] = useState<string[]>([]) // block descent trail
  const [edit, setEdit] = useState<{ op: 'add' | 'rename' | 'delete'; file?: string; value: string; err?: string } | null>(null)
  const [guard, setGuard] = useState<(() => void) | null>(null) // pending leave() continuation
  const pendingSel = useRef<string[] | null>(null)

  const [schPath, setSchPath] = useState(session.kind === 'loose' ? session.path : null)
  const net0 = session.net
  const netInit = net0 ? net0.text : proj ? `* ${proj.name}: scratch netlist. "View netlist" fills it from the top sheet.\n` : EXAMPLE
  const [initial, setInitial] = useState(netInit)
  const text = useRef(netInit)
  const [path, setPath] = useState<string | null>(net0 ? net0.path : null)
  const [netDirty, setNetDirty] = useState(!!session.dirty?.includes('net'))
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [log, setLog] = useState('')
  const [blamed, setBlamed] = useState<{ line: string; blame: Blame }[]>([]) // blame().lines
  const [sels, setSels] = useState<Record<string, string[]>>({}) // plot tab key -> selected vectors
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [tab, setTab] = useState('') // plot tab key: survives re-runs that add/remove analyses
  const [status, setStatus] = useState(session.kind === 'project' && session.warn ? session.warn : 'Ready')
  const [running, setRunning] = useState(false)
  const stopReq = useRef(false) // Stop between sweep runs, when no ngspice is alive to kill
  const [meas, setMeas] = useState<MeasTable | null>(null)
  const [diag, setDiag] = useState<Diagnosis[]>([]) // convergence help for the last run
  // compat / timeout: stored in the .nsproj for projects, per session for loose files; simEdit = the open settings bar
  const [looseSim, setLooseSim] = useState<ProjectSim>(() => prefs().sim) // Settings › New projects and files
  const [simEdit, setSimEdit] = useState<ProjectSim | null>(null)
  const peeked = useRef<string | null>(null) // last generated netlist put in the editor
  // crash-recovery copy of whatever is unsaved (Recovery.tsx); refs, so it reads the live sheets and editor text
  useAutosave(session.rid, () => {
    const sheets = Object.fromEntries([...dirty.current].map((f) => [f, json(live(f))]))
    const net = netDirty && text.current !== peeked.current ? { path, text: text.current } : undefined
    if (!Object.keys(sheets).length && !net) return null
    return proj ? { name: proj.name, project: `${pdir}/${pfile}`, sheets, net } : { name: base(schPath) ?? base(path) ?? 'Untitled', path: schPath, sheets, net }
  })

  // sheet list: the top sheet first, then by name with numbers in order ("2-x" before "10-x"), so numbered stages read in sequence
  const files = Object.keys(disk.current).sort((a, b) => +(b === top) - +(a === top) || a.localeCompare(b, undefined, { numeric: true }))
  const live = (f: string) => handles.current[f]?.get() ?? disk.current[f]
  const isSch = view !== 'net'

  const projEntries = useMemo(() => libEntries(proj?.libs ?? [], libTexts), [proj, libTexts])
  const library: LibEntry[] = useMemo(() => [...BUNDLED, ...projEntries.all, ...sources.entries], [projEntries, sources.entries])
  // the parts lists + search: enabled libraries only (Manage Libraries)
  const browse: LibEntry[] = useMemo(() => [...BUNDLED, ...projEntries.shown, ...sources.browse], [projEntries, sources.browse])
  const resolve = useMemo(() => resolver(library), [library])
  const netCtx: NetCtx = useMemo(() => ({ sheets: { ...disk.current }, lib: resolve }), [rev, resolve])
  const sheetList = useMemo(() => (proj ? files.map((file) => ({ file, sheet: disk.current[file] })) : []), [rev, proj])
  // bill of materials window: over the live (unsaved too) sheets, from the top sheet down; exclude = unticked sheets
  const [bomOpen, setBomOpen] = useState(false), [bomTick, setBomTick] = useState(0), bomT = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [bomExclude, setBomExclude] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => setBomExclude(new Set()), [pdir]) // another project: all sheets again
  const bomNow = () => bom(Object.fromEntries(files.map((f) => [f, live(f)])), top, resolve, bomExclude, proj?.bom)
  const bomData = useMemo(() => (proj && bomOpen ? bomNow() : null), [proj, bomOpen, rev, bomTick, resolve, bomExclude, files.join('\0')])
  // purchasing details typed in the BOM window: state now, project file 400 ms after typing stops (flushed on close)
  const bomSave = useRef<{ t?: ReturnType<typeof setTimeout>; p?: Project }>({})
  const flushBom = () => {
    const s = bomSave.current
    clearTimeout(s.t)
    if (s.p) writeProj(s.p).catch((e) => setStatus(`Can't update the project: ${msg(e)}`)), (s.p = undefined)
  }
  function setPartInfo(key: string, field: keyof PartInfo, v: string) {
    if (!proj) return
    const line: PartInfo = { ...proj.bom?.[key], [field]: v || undefined }, all = { ...proj.bom }
    if (Object.values(line).some(Boolean)) all[key] = line
    else delete all[key]
    const { bom: _, ...rest } = proj, p: Project = Object.keys(all).length ? { ...rest, bom: all } : rest
    setProj(p)
    clearTimeout(bomSave.current.t), (bomSave.current = { p, t: setTimeout(flushBom, 400) })
  }
  async function exportBom(kind: 'csv' | 'xlsx') {
    const { rows } = bomNow() // fresh, not the debounced list
    return window.api.exportSave(`${proj?.name ?? 'project'}-BOM.${kind}`, kind === 'csv' ? bomCsv(rows) : bomXlsx(rows), [kind === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'Excel workbook', extensions: ['xlsx'] }])
  }

  // ---- sheet bookkeeping ----
  const put = (f: string, s: Sheet) => {
    handles.current[f]?.replace(s) // undoable commit: keeps the tab's history and view
    disk.current[f] = s
    dirty.current.add(f)
    bump()
  }
  const snap = (f: string) => { if (handles.current[f]) disk.current[f] = handles.current[f]!.get() }
  // blocks instancing `f` in every other sheet follow f's current ports (marks those sheets dirty).
  function syncBlocks(f: string) {
    if (!proj || !disk.current[f]) return
    for (const g of files) if (g !== f) {
      const n = refreshBlocks(live(g), f, live(f))
      if (n) put(g, n)
    }
  }
  function switchTo(next: string) {
    if (view !== 'net' && view !== next && disk.current[view]) snap(view), syncBlocks(view)
    if (next !== 'net') setOpen((o) => (o.includes(next) ? o : [...o, next]))
    setView(next)
    bump()
  }
  function descend(f: string) {
    if (!disk.current[f]) return setStatus(`${f} isn't in this project`)
    setCrumbs((c) => (c.at(-1) === view ? [...c, f] : [view, f]))
    switchTo(f)
  }
  function closeTab(f: string) {
    snap(f), syncBlocks(f) // unsaved edits stay in the snapshot (still dirty), only undo history goes
    const rest = open.filter((x) => x !== f)
    setOpen(rest)
    if (view === f) setView(rest.at(-1) ?? 'net')
    bump()
  }
  function dirtied(f: string) {
    if (!dirty.current.has(f)) dirty.current.add(f), bump()
    clearTimeout(bomT.current), (bomT.current = setTimeout(() => setBomTick((t) => t + 1), 300)) // BOM follows edits, debounced
    // stale annotations are worse than none: drop op/blame on the first edit (same object otherwise, so no re-render)
    setOverlay((o) => (o?.op || o?.blame ? { nets: o.nets, wireNets: o.wireNets } : o))
    if (pdir) clearTimeout(adoptT.current), (adoptT.current = setTimeout(() => adopt(false), 250))
  }
  const writeProj = (p: Project) => api.write(pdir!, pfile, json(p))

  async function addSheet(name: string) {
    const f = sheetFile(name)
    if (!f) return setEdit({ op: 'add', value: name, err: 'Invalid name' })
    if (disk.current[f]) return setEdit({ op: 'add', value: name, err: `${f} already exists` })
    try {
      await api.write(pdir!, f, json(emptySheet()))
    } catch (e) {
      return setEdit({ op: 'add', value: name, err: msg(e) })
    }
    disk.current[f] = emptySheet()
    setEdit(null)
    switchTo(f)
  }
  async function renameSheet(from: string, name: string) {
    const to = sheetFile(name)
    if (to === from) return setEdit(null)
    if (!to) return setEdit({ op: 'rename', file: from, value: name, err: 'Invalid name' })
    if (disk.current[to]) return setEdit({ op: 'rename', file: from, value: name, err: `${to} already exists` })
    try {
      await api.rename(pdir!, from, to)
      if (proj!.top === from) {
        const p = { ...proj!, top: to }
        await writeProj(p)
        setProj(p)
      }
    } catch (e) {
      return setEdit({ op: 'rename', file: from, value: name, err: msg(e) })
    }
    snap(from)
    const mv = <T,>(m: Record<string, T>) => { if (from in m) (m[to] = m[from]), delete m[from] }
    mv(disk.current), mv(handles.current), mv(ids.current)
    if (dirty.current.delete(from)) dirty.current.add(to)
    const sw = (x: string) => (x === from ? to : x)
    setOpen((o) => o.map(sw)), setCrumbs((c) => c.map(sw)), setView(sw)
    for (const g of Object.keys(disk.current)) {
      const n = renameRefs(live(g), from, to)
      if (n) put(g, n)
    }
    setEdit(null)
    bump()
  }
  async function deleteSheet(f: string) {
    try {
      await api.remove(pdir!, f)
    } catch (e) {
      return setStatus(`Can't delete ${f}: ${msg(e)}`)
    }
    delete disk.current[f], delete handles.current[f], delete ids.current[f]
    dirty.current.delete(f)
    const rest = open.filter((x) => x !== f)
    setOpen(rest), setCrumbs((c) => c.filter((x) => x !== f))
    if (view === f) setView(rest.at(-1) ?? 'net')
    setEdit(null)
    bump()
  }
  async function setTop(f: string) {
    const p = { ...proj!, top: f }
    try {
      await writeProj(p)
    } catch (e) {
      return setStatus(`Can't update the project: ${msg(e)}`)
    }
    setProj(p), setOverlay(null), setRuns(null), setMeas(null), setDiag([]), setStatus(`${f} is now the top sheet`)
  }

  // ---- libraries (Manage Libraries: it reports failures) ----
  async function onImport(lib: ImportedLib) {
    const t = await api.read(pdir!, lib.file)
    const p = { ...proj!, libs: [...proj!.libs.filter((l) => l.file !== lib.file), lib] }
    await writeProj(p)
    setProj(p), setLibTexts((m) => ({ ...m, [lib.file]: t }))
    setStatus(`Imported ${lib.entries.length} part${lib.entries.length === 1 ? '' : 's'} from ${lib.file}`)
  }
  async function onRemove(file: string) {
    await api.remove(pdir!, file).catch(() => {}) // already gone is fine
    const p = { ...proj!, libs: proj!.libs.filter((l) => l.file !== file) }
    await writeProj(p)
    setProj(p), setLibTexts(({ [file]: _, ...m }) => m)
  }
  // shown / hidden: stored on the .nsproj entry (enabled: false), applied at once
  async function onToggleLib(file: string, on: boolean) {
    const p = { ...proj!, libs: proj!.libs.map((l) => (l.file !== file ? l : { ...l, enabled: on ? undefined : (false as const) })) }
    setProj(p)
    await writeProj(p).catch((e) => setStatus(`Can't update the project: ${msg(e)}`))
  }
  // copy-on-use: My library / pack parts in project sheets get a libs/ copy and 'proj:' ids (see copyOnUse). After an
  // edit only parts not rewritten before (re-rewriting one after its undo would trap the undo); save rewrites all.
  // ponytail: run doesn't adopt (its resolver would be stale); unrewritten parts netlist via the absolute include.
  const adoptT = useRef<ReturnType<typeof setTimeout>>(undefined)
  const adopting = useRef<Promise<Project | null>>(Promise.resolve(null))
  const libNow = useRef({ proj, libTexts }) // latest, also between an adopt and the next render
  libNow.current = { proj, libTexts }
  const rewritten = useRef(new Set<string>())
  function adopt(all: boolean): Promise<Project | null> {
    return (adopting.current = adopting.current.then(async () => {
      const { proj: p, libTexts: t } = libNow.current
      if (!pdir || !p) return p
      const sheets = Object.fromEntries(Object.keys(disk.current).map((f) => [f, live(f)]))
      const io = { list: () => api.list(pdir), read: (rel: string) => (rel in t ? Promise.resolve(t[rel]) : api.read(pdir, rel)), write: (rel: string, s: string) => api.write(pdir, rel, s) }
      const r = await copyOnUse(sheets, p, sources.srcs, io, (q) => all || !rewritten.current.has(q.id))
      if (!r) return p
      await writeProj(r.project)
      for (const [f, s] of Object.entries(r.sheets)) s.parts.forEach((q) => rewritten.current.add(q.id)), put(f, s)
      libNow.current = { proj: r.project, libTexts: { ...t, ...r.texts } }
      setProj(r.project), setLibTexts(libNow.current.libTexts), setStatus(`Using the project copy: ${Object.keys(r.texts).join(', ')}`)
      return r.project
    }).catch((e) => (setStatus(`Can't copy a library into the project: ${msg(e)}`), libNow.current.proj)))
  }

  // ---- netlisting / run (Phase 4 flow; projects always netlist the top sheet) ----
  const ctx = (): NetCtx => ({ sheets: Object.fromEntries(Object.keys(disk.current).map((f) => [f, live(f)])), lib: resolve })
  const gen = () => (proj ? netlist(live(top), `${proj.name} (${top})`, ctx()) : netlist(live(LOOSE), base(schPath) ?? 'untitled', { lib: resolve }))
  const errLog = (errors: string[]) => errors.map((e) => 'Error: ' + e).join('\n')
  const fail = (log: string, msg: string) => (setRuns([]), setLog(log), setBlamed([]), setMeas(null), setDiag([]), setStatus(msg))
  const sim = proj ? (proj.sim ?? {}) : looseSim
  const sheetsNow = () => Object.keys(disk.current).map(live)
  async function saveSim(s: ProjectSim) {
    const clean: ProjectSim = { ...(s.compat ? { compat: s.compat } : {}), ...(s.timeoutS && s.timeoutS > 0 ? { timeoutS: s.timeoutS } : {}) }
    setSimEdit(null)
    if (!proj) return setLooseSim(clean)
    const { sim: _, ...rest } = proj, p: Project = Object.keys(clean).length ? { ...rest, sim: clean } : rest
    setProj(p)
    await writeProj(p).catch((e) => setStatus(`Can't update the project: ${msg(e)}`))
  }
  const stop = () => ((stopReq.current = true), window.api.stopSim())
  // tabs with no usable selection get the default one (live results and opened raw files; run() does its own pass at the end)
  const fillSels = (rs: Run[]) => setSels((prev) => {
    const add = tabsOf(rs).flatMap(({ key, runs: [{ plot }], panes }) =>
      (panes?.length ? panes.map((p) => p.sel) : [startSel(plot) ?? defaultSel(plot)]).map((d, i) => [paneKey(key, i), d] as const).filter(([k]) => !keepSel(prev[k], plot.vars).length))
    return add.length ? { ...prev, ...Object.fromEntries(add) } : prev
  })
  // File > Open Raw File…: an existing ngspice / LTspice .raw in the plots panel, nothing simulated
  async function openRaw(r?: { path: string; plots: RawPlot[] } | null) {
    r ??= await window.api.openRaw().catch((e) => (setStatus(`Can't open that raw file: ${msg(e)}`), null))
    if (!r) return
    const rs = [{ label: '', result: { ok: true, log: '', plots: r.plots }, netlist: '' }]
    setRuns(rs), fillSels(rs), setLog(`Opened ${r.path}\n`), setBlamed([]), setMeas(null), setDiag([])
    setStatus(`Opened ${base(r.path)}: ${r.plots.map((p) => p.plotname).join(', ') || 'no plots'}`)
  }
  useEffect(() => void (session.kind === 'loose' && session.raw && openRaw(session.raw)), [])

  async function run() {
    if (running) return
    // unopened, saved sheets: pick up edits made outside the app since the project was opened
    if (pdir && isSch)
      for (const f of Object.keys(disk.current))
        if (!handles.current[f] && !dirty.current.has(f)) disk.current[f] = await api.read(pdir, f).then(parseSheet, () => disk.current[f])
    // an unsaved netlist (e.g. from View netlist) resolves .include against the schematic's / project's folder
    let net = text.current, dir = pdir ?? dirOf(path ?? schPath), pre = '', nl: NetlistResult | null = null
    if (isSch) {
      nl = gen()
      setOverlay({ nets: nl.nets, wireNets: nl.wireNets })
      if (nl.errors.length) return fail(errLog(nl.errors), `Netlist errors (${nl.errors.length})`)
      net = nl.text.replace(/^\.end\s*$/im, SAVE_CURRENTS + '\n.end')
      dir = pdir ?? dirOf(schPath)
      pre = [...nl.warnings.map((w) => 'Warning: ' + w), '--- netlist ---', net.trimEnd(), '--- ngspice ---', ''].join('\n')
    } else if (pdir && path) dir = dirOf(path)
    // ERC on the emitted text: errors block the run, warnings go to the log; both blame parts/nets on the top sheet
    const chk = erc(net), partOf = new Map(Object.entries(nl?.refs ?? {}).map(([id, ref]) => [ref.toLowerCase(), id]))
    const issues = (kind: string, xs: Issue[]) =>
      xs.map((x) => ({ line: `${kind}: ${x.message}`, blame: { parts: x.refs.flatMap((r) => partOf.get(r.toLowerCase()) ?? []), nets: x.nets } }))
    const join = (bs: Blame[]) => ({ parts: bs.flatMap((b) => b.parts), nets: bs.flatMap((b) => b.nets) })
    if (chk.errors.length) {
      const es = issues('Error', chk.errors)
      fail(es.map((e) => e.line).join('\n') + '\n' + pre, `Electrical rules check: ${chk.errors.length} error${chk.errors.length > 1 ? 's' : ''}, nothing simulated`)
      if (nl) setBlamed(es), setOverlay({ nets: nl.nets, wireNets: nl.wireNets, blame: join(es.map((e) => e.blame)) })
      return
    }
    const ercWarn = nl ? issues('Warning', chk.warnings) : []
    if (chk.warnings.length) pre = issues('Warning', chk.warnings).map((w) => w.line).join('\n') + '\n' + pre
    const sweep = expandSweep(net)
    if (sweep.errors.length) return fail(pre + errLog(sweep.errors), `Sweep errors (${sweep.errors.length})`)
    const opts: SimOptions = { compat: sim.compat ?? (isSch ? autoCompat(sheetsNow(), resolve) : undefined), timeoutS: sim.timeoutS }
    setRunning(true), setDiag([]), (stopReq.current = false)
    const t0 = performance.now(), n = sweep.runs.length, done: Run[] = []
    let out = '', ok = true, stopped: Stopped | undefined
    try {
      for (const [i, s] of sweep.runs.entries()) {
        if (stopReq.current) { stopped = 'user'; break }
        setStatus(n > 1 ? `Running ${i + 1}/${n} (${s.label})…` : 'Running…')
        // live: the plots fill in while ngspice runs (sim/live.ts), with progress in the status bar
        const lv = liveRun()
        const r = await window.api.runSim(s.netlist, dir, opts, (c) => {
          lv.add(c)
          const plots = lv.plots(), last = plots.at(-1)
          if (!last || last.points < 2) return
          const pc = progress(last, s.netlist)
          setStatus(`${n > 1 ? `Running ${i + 1}/${n} (${s.label})` : 'Running'}…${pc == null ? '' : ` ${Math.floor(pc * 100)}%`}`)
          const rs = [...done, { label: s.label, result: { ok: true, log: '', plots }, netlist: s.netlist }]
          setRuns(rs), fillSels(rs)
        })
        // SAVE_CURRENTS makes .ac/.noise print one "unrecognized variable - @x[i]" per device: our noise, not the user's
        const rl = nl ? r.log.replace(/^.*unrecognized variable - @.*(\n|$)/gim, '') : r.log
        out += (n > 1 ? `--- run ${s.label} ---\n` : '') + rl + (rl.endsWith('\n') ? '' : '\n')
        if ((stopped = r.stopped)) { if (r.plots.length) done.push({ label: s.label, result: r, netlist: s.netlist }); break } // keep what the cut-off run computed too
        done.push({ label: s.label, result: r, netlist: s.netlist })
        if (!(ok = r.ok)) break // stop at the first failed run, its log is the last section
      }
    } finally {
      setRunning(false)
    }
    const mt = done.map((r) => ({ label: r.label, rows: parseMeas(r.result.log) }))
    setMeas(mt.some((r) => r.rows.length) ? mt : null)
    // ngspice logs gmin/source stepping warnings on runs it rescued (noise), but a singular matrix result is never trustworthy
    if (!stopped) setDiag(diagnose(out).filter((d) => !ok || d.problem.startsWith('Singular matrix')))
    const tabs = tabsOf(done)
    setRuns(done)
    setLog(pre + out)
    setSels((prev) =>
      Object.fromEntries(
        tabs.flatMap(({ key, runs: [{ plot }], panes }) => {
          const keep = (k: string) => keepSel(prev[k], plot.vars) // keep the user's picks when the vectors still exist
          const defs = panes?.length ? panes.map((p) => p.sel) : [startSel(plot) ?? defaultSel(plot)]
          return defs.map((d, i) => { const k = paneKey(key, i), kept = keep(k); return [k, kept?.length ? kept : d] })
        })
      )
    )
    if (nl) {
      const b = blame(nl.warnings.map((w) => 'Warning: ' + w).join('\n') + '\n' + out, nl)
      const op = done[0]?.result.plots.find((p) => p.plotname === 'Operating Point')
      setBlamed([...ercWarn, ...b.lines])
      setOverlay({
        nets: nl.nets,
        wireNets: nl.wireNets,
        ...(op && { op: opVoltages(nl, op) }),
        ...((!ok || /warning/i.test(out) || ercWarn.length) && { blame: join([b.all, ...ercWarn.map((w) => w.blame)]) })
      })
    } else setBlamed([])
    const secs = ((performance.now() - t0) / 1000).toFixed(2)
    const where = proj && isSch && view !== top ? ` · simulated the top sheet ${stem(top)}; open it to probe` : ''
    const head = stopped === 'user' ? 'Stopped' : stopped ? `Timed out after ${opts.timeoutS} s` : ok ? 'Done' : 'Failed'
    setStatus(`${head}${n > 1 ? ` (${done.length}/${n} runs)` : ''} in ${secs} s${where}`)
  }

  // convergence banner fix: an .options line on the top sheet (Schematic's addOptions)
  function applyFix(options: string) {
    const h = handles.current[top] as (SchematicHandle & { addOptions?: (line: string) => void }) | null | undefined
    if (!h?.addOptions) return setStatus(`Open the top sheet ${stem(top)} to apply this, or add "${options}" yourself`)
    h.addOptions(options)
    setDiag([])
    setStatus(`Added ${options} to ${stem(top)}: run again`)
  }

  // Alt+click in the schematic: toggle that net's voltage / part's current in the current plot tab
  function probe(t: ProbeTarget) {
    if (view !== top) return setStatus(`Probing works on the top sheet (${stem(top)}): results are for that circuit`)
    if (!cur) return setStatus('Run a simulation first')
    const plot = cur.runs[0].plot
    let want: string, v: string | null
    if ('net2' in t) {
      // differential probe: a maths entry Plot evaluates (contracts.ts isExpr)
      const d = t, term = (n: string) => (n === '0' ? '0' : `v(${n.toLowerCase()})`)
      const e = `=${term(d.net)}-${term(d.net2)}`, sel = sels[cur.key] ?? []
      setSels({ ...sels, [cur.key]: sel.includes(e) ? sel.filter((s) => s !== e) : [...sel, e] })
      return setStatus(`${sel.includes(e) ? 'Removed' : 'Added'} ${e.slice(1)}`)
    }
    if ('net' in t) {
      const n = voltageVector(t.net)
      if (!n) return setStatus('Ground is the 0 V reference')
      ;(want = n), (v = findVector(plot, [n]))
    } else {
      const part = live(top).parts.find((p) => p.id === t.partId), ref = gen().refs[t.partId]
      if (!part || !ref) return
      ;(want = `i(${ref})`), (v = findVector(plot, currentVectors(part, ref)))
    }
    if (!v) return setStatus(`${want} isn't in ${cur.name}`)
    const n = v.toLowerCase(), sel = sels[cur.key] ?? []
    setSels({ ...sels, [cur.key]: sel.includes(n) ? sel.filter((s) => s !== n) : [...sel, n] })
    setStatus(`${sel.includes(n) ? 'Removed' : 'Added'} ${pretty(v)}`)
  }

  // jump from a console line to the parts/wires it blames (always on the top sheet)
  function show(b: Blame) {
    const wn = overlay?.wireNets ?? {}
    pendingSel.current = [...b.parts, ...Object.keys(wn).filter((w) => b.nets.includes(wn[w]))]
    switchTo(top)
  }
  useEffect(() => {
    const h = handles.current[top]
    if (pendingSel.current && h && view === top) h.select(pendingSel.current), (pendingSel.current = null)
  })

  // Replace the netlist editor's text with the generated netlist (or the errors as comments).
  function peek() {
    const n = gen()
    const t = n.errors.length ? `* Netlist errors:\n${errLog(n.errors).replace(/^/gm, '* ')}\n` : n.text
    text.current = peeked.current = t
    setInitial(t)
    setPath(null) // so ⌘S asks where to save instead of overwriting the open .cir
    setNetDirty(true)
    switchTo('net')
  }
  const netEdited = netDirty && text.current !== peeked.current
  const canPeek = !netEdited

  // loose mode only: Phase 4 open-a-file
  async function openLoose() {
    const f = await window.api.openFile()
    if (!f) return
    if (/\.nsch$/i.test(f.path)) {
      try {
        handles.current[LOOSE]!.load(parseSheet(f.text))
      } catch (e) {
        return setStatus(`Can't open ${f.path}: ${(e as Error).message}`)
      }
      setSchPath(f.path)
      dirty.current.delete(LOOSE)
      setView(LOOSE)
      bump()
    } else {
      text.current = f.text
      setInitial(f.text)
      setPath(f.path)
      setNetDirty(false)
      setView('net')
    }
  }

  // ---- saving ----
  async function saveNet(as = false) {
    const p = await window.api.saveFile(text.current, as ? null : path, 'cir')
    if (p) setPath(p), setNetDirty(false)
    return !!p
  }
  async function saveSheets(as = false): Promise<boolean> {
    if (!proj) {
      const p = await window.api.saveFile(json(live(LOOSE)), as ? null : schPath, 'nsch')
      if (p) setSchPath(p), dirty.current.delete(LOOSE), bump()
      return !!p
    }
    try {
      const p = (await adopt(true)) ?? proj
      for (const f of [...dirty.current]) syncBlocks(f) // saved ports -> blocks elsewhere (they get saved too)
      for (const f of [...dirty.current]) {
        const s = live(f)
        await api.write(pdir!, f, json(s))
        disk.current[f] = s
        dirty.current.delete(f)
      }
      await writeProj(p)
      setStatus('Saved')
      return true
    } catch (e) {
      setStatus(`Save failed: ${msg(e)}`)
      return false
    } finally {
      bump()
    }
  }
  const save = () => (isSch ? saveSheets() : saveNet())

  // leaving the session (Home) with unsaved work asks first, inline
  function leave(then: () => void) {
    if (dirty.current.size || netEdited) setGuard(() => then)
    else then()
  }
  // every commit: latest leave(); React runs the old session's cleanup before the new session's effect
  useEffect(() => {
    leaving.guard = (then) => (go('editor'), leave(then)) // the banner lives in the editor view
    return () => void (leaving.guard = (then) => then())
  })
  async function guardSave() {
    const ok = (!dirty.current.size || (await saveSheets())) && (!netEdited || (await saveNet()))
    if (ok) guard?.()
    setGuard(null)
  }

  async function exportNet() {
    const n = gen()
    if (n.errors.length) return setStatus(`Netlist errors (${n.errors.length}): fix them before exporting`)
    const p = await window.api.saveFile(n.text, null, 'cir')
    if (p) setStatus(`Exported ${base(p)}`)
  }

  // menu + shortcuts (commands.ts); the canvas' own commands come from the active Schematic
  const lastSheet = useRef(top)
  if (isSch) lastSheet.current = view
  const toSheet = () => (go('editor'), switchTo(disk.current[lastSheet.current] ? lastSheet.current : top))
  useCommands([
    { id: 'file.save', keys: 'Mod+S', run: save, enabled: () => (isSch ? dirty.current.size > 0 : netDirty) },
    { id: 'file.saveAs', keys: 'Mod+Shift+S', run: () => (isSch ? saveSheets(true) : saveNet(true)), enabled: () => !(proj && isSch) }, // projects save in place
    { id: 'file.closeProject', run: () => leave(onClose), enabled: () => !!proj },
    { id: 'file.exportNetlist', run: exportNet },
    { id: 'file.openRaw', run: () => void openRaw(), enabled: () => !running },
    { id: 'view.home', run: () => leave(onClose) },
    { id: 'view.schematic', run: toSheet, checked: () => route === 'editor' && isSch },
    { id: 'view.netlist', run: () => (go('editor'), switchTo('net')), checked: () => route === 'editor' && !isSch },
    { id: 'sim.run', keys: 'Mod+Enter', run, enabled: () => !running && (isSch ? live(top).parts.length > 0 : /\S/.test(text.current)) },
    { id: 'sim.stop', keys: 'Mod+.', run: stop, enabled: () => running },
    { id: 'sim.viewNetlist', run: peek, enabled: () => isSch && canPeek },
    { id: 'tools.library', run: () => (isSch && snap(view), bump(), go('library')) }
  ])

  const name = isSch ? (proj ? view : (base(schPath) ?? 'untitled.nsch')) : (base(path) ?? 'untitled.cir')
  const isDirty = isSch ? dirty.current.has(view) : netDirty
  useEffect(() => {
    if (route === 'editor') document.title = `${proj ? proj.name + ' — ' : ''}${isSch && proj ? stem(view) : name}${isDirty ? ' •' : ''} — Spice Studio`
  })
  const tabs = useMemo(() => tabsOf(runs ?? []), [runs])
  const cur = tabs.find((t) => t.key === tab) ?? tabs[0]
  const plot = cur?.runs[0].plot
  const logLines = log ? log.split('\n') : []
  const trail = crumbs.length > 1 && crumbs.at(-1) === view ? crumbs : null
  const panels = usePanels({ active: route === 'editor', hasSheets: !!proj, isSch, runs, title: proj?.name ?? name })

  const editKeys = (e: { key: string }, commit: () => void) => (e.key === 'Enter' ? commit() : e.key === 'Escape' && setEdit(null))
  const editInput = (commit: () => void) => (
    <Input
      autoFocus
      className="h-7 px-2 text-[13px] md:text-[13px]"
      aria-invalid={!!edit!.err}
      value={edit!.value}
      spellCheck={false}
      onChange={(e) => setEdit({ ...edit!, value: e.target.value, err: undefined })}
      onKeyDown={(e) => editKeys(e, commit)}
      onBlur={() => setEdit(null)}
      aria-label="Sheet name"
    />
  )

  return (
    <>
      <div className="app" hidden={route !== 'editor'}>
        <header>
          <HomeBtn label="Back to the home page" onClick={() => leave(onClose)} />
          {!proj && <Tip label="Open a schematic or netlist here"><Button variant="ghost" size="sm" onClick={openLoose}><FolderOpen />Open</Button></Tip>}
          <Tip label={proj && isSch ? 'Save all sheets (⌘S)' : 'Save (⌘S)'}><Button variant="ghost" size="sm" onClick={save}><Save />Save</Button></Tip>
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-[18px]" />
          {proj ? (
            <span className="ml-1 font-semibold">{proj.name}</span>
          ) : (
            <ToggleGroup type="single" variant="outline" size="sm" aria-label="View" value={isSch ? 'sch' : 'net'} onValueChange={(v) => v && setView(v === 'sch' ? LOOSE : 'net')}>
              <ToggleGroupItem value="sch">Schematic</ToggleGroupItem>
              <ToggleGroupItem value="net">Netlist</ToggleGroupItem>
            </ToggleGroup>
          )}
          <span className="text-muted-foreground">{name}{isDirty ? ' •' : ''}</span>
          <div className="ml-auto flex items-center gap-0.5 [-webkit-app-region:no-drag]">
            <Tip label="Component library"><Button variant="ghost" size="sm" onClick={() => (isSch && snap(view), bump(), go('library'))}><BookOpen />Library</Button></Tip>
            {isSch && (
              <Tip label={canPeek ? 'Show the generated netlist in the Netlist editor' : 'The Netlist editor has unsaved edits: save them first (⌘S in Netlist view)'}>
                <span className="inline-flex">{/* a disabled button gets no pointer events: the span carries the tooltip */}
                  <Button variant="ghost" size="sm" onClick={peek} disabled={!canPeek}><FileCode />View netlist</Button>
                </span>
              </Tip>
            )}
            <Separator orientation="vertical" className="mx-1.5 data-[orientation=vertical]:h-[18px]" />
            <Tip label="Run settings: compatibility mode for vendor models, timeout">
              <Button variant="ghost" size="sm" aria-expanded={!!simEdit} onClick={() => setSimEdit(simEdit ? null : sim)}><SlidersHorizontal />Run settings</Button>
            </Tip>
            <Tip label={running ? 'Stop the simulation (⌘.)' : proj ? `Run the top sheet ${stem(top)} (⌘↵)` : 'Run (⌘↵)'}>
              <Button size="sm" variant={running ? 'destructive' : 'default'} className={cn('ml-1.5 min-w-[68px] gap-1.5 font-semibold', !running && 'bg-ok text-ok-fg hover:bg-ok/85')} onClick={running ? stop : run}>
                {running ? <><Square className="size-3! fill-current" />Stop</> : <><Play className="size-3! fill-current" />Run</>}
              </Button>
            </Tip>
          </div>
        </header>

        {guard && (
          <div className={WARNBAR} role="alertdialog" aria-label="Unsaved changes">
            <span className="mr-auto">
              Unsaved changes{dirty.current.size ? ` in ${[...dirty.current].map(stem).join(', ')}` : ''}
              {netEdited ? `${dirty.current.size ? ' and' : ' in'} the netlist` : ''}.
            </span>
            <Button size="sm" onClick={guardSave} autoFocus>Save</Button>
            <Button size="sm" variant="outline" onClick={() => (guard(), setGuard(null))}>Discard</Button>
            <Button size="sm" variant="ghost" onClick={() => setGuard(null)}>Cancel</Button>
          </div>
        )}

        {simEdit && (
          <div className={cn(BANNER, 'gap-3 bg-muted/50')} role="dialog" aria-label="Run settings">
            <span className="mr-auto">Run settings{proj ? ' (saved in the project)' : ''}</span>
            <Label className="font-normal">
              Compatibility
              <Select value={simEdit.compat ?? AUTO} onValueChange={(v) => setSimEdit({ ...simEdit, compat: v === AUTO ? undefined : (v as Compat) })}>
                <SelectTrigger size="sm" className="h-7"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>Auto (from the parts' libraries)</SelectItem>
                  {COMPATS.map((c) => <SelectItem key={c} value={c}>{COMPAT_NAME[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Label>
            <Label className="font-normal">
              Timeout
              <InputGroup className="h-7 w-24">
                <InputGroupInput type="number" min={0} step={1} placeholder="none" value={simEdit.timeoutS ?? ''}
                  onChange={(e) => setSimEdit({ ...simEdit, timeoutS: e.target.value ? Number(e.target.value) : undefined })} />
                <InputGroupAddon align="inline-end">s</InputGroupAddon>
              </InputGroup>
            </Label>
            <Button size="sm" onClick={() => saveSim(simEdit)}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setSimEdit(null)}>Cancel</Button>
          </div>
        )}
        {diag.map((d, i) => (
          <div key={i} className={WARNBAR} role="status" aria-label="Convergence help">
            <span className="mr-auto">{d.problem}</span>
            {d.fixes.map((f) =>
              isSch ? (
                <Tip key={f.options} label={`Adds ${f.options} to ${stem(top)}`}>
                  <Button size="sm" variant="outline" onClick={() => applyFix(f.options)}>{f.label}</Button>
                </Tip>
              ) : (
                <Tip key={f.options} label="Copy this line">
                  <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(f.options).then(() => setStatus(`Copied ${f.options}: paste it into the netlist`))}>
                    {f.label}: <code className="font-mono text-xs">{f.options}</code>
                  </Button>
                </Tip>
              )
            )}
            <Button size="sm" variant="ghost" onClick={() => setDiag((x) => x.filter((y) => y !== d))}>Dismiss</Button>
          </div>
        ))}

        <div className="body">
          {proj && !panels.sheets && panels.sheetsRail}
          {proj && panels.sheets && (
            <aside className="panel-in w-[200px] shrink-0 overflow-y-auto border-r bg-card pt-1.5 pb-3">
              <div className={SIDE_H}>
                Sheets
                <span className="flex">
                  <Op label="Add sheet" aria="Add sheet" onClick={() => setEdit({ op: 'add', value: '' })}><Plus /></Op>
                  {panels.sheetsHide}
                </span>
              </div>
              {files.map((f) =>
                edit?.file === f && edit.op === 'rename' ? (
                  <div key={f} className="mx-1.5 flex flex-col gap-0.5 p-0.5">{editInput(() => renameSheet(f, edit.value))}{edit.err && <small className="px-1 text-xs text-destructive">{edit.err}</small>}</div>
                ) : edit?.file === f && edit.op === 'delete' ? (
                  <div key={f} className="mx-1.5 flex flex-wrap items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5">
                    <span className="w-full">Delete {stem(f)}?</span>
                    <Button size="sm" variant="destructive" className="h-7" onClick={() => deleteSheet(f)}>Delete</Button>
                    <Button size="sm" variant="outline" className="h-7" autoFocus onClick={() => setEdit(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div key={f} className={row(view === f)}>
                    <Tip label={f} side="right">
                      <Button variant="ghost" size="sm" className={NM} onClick={() => switchTo(f)}>
                        <span className="truncate">{stem(f)}</span>
                        {dirty.current.has(f) && <Unsaved />}
                        {f === top && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px] uppercase">top</Badge>}
                      </Button>
                    </Tip>
                    <span className="hidden pr-0.5 group-focus-within:flex group-hover:flex">
                      <Op label="Rename" aria={`Rename ${stem(f)}`} onClick={() => setEdit({ op: 'rename', file: f, value: stem(f) })}><Pencil /></Op>
                      {f !== top && <Op label="Set as top sheet" aria={`Set ${stem(f)} as top`} onClick={() => setTop(f)}><ArrowUpToLine /></Op>}
                      {f !== top && <Op label="Delete" aria={`Delete ${stem(f)}`} onClick={() => setEdit({ op: 'delete', file: f, value: '' })}><Trash2 /></Op>}
                    </span>
                  </div>
                )
              )}
              {edit?.op === 'add' && (
                <div className="mx-1.5 flex flex-col gap-0.5 p-0.5">
                  {editInput(() => addSheet(edit.value))}
                  {edit.err && <small className="px-1 text-xs text-destructive">{edit.err}</small>}
                </div>
              )}
              <div className={SIDE_H}>Netlist</div>
              <div className={row(view === 'net')}>
                <Button variant="ghost" size="sm" className={NM} onClick={() => switchTo('net')}><span className="truncate">Hand-written netlist</span>{netDirty && <Unsaved />}</Button>
              </div>
              <div className={SIDE_H}>BOM</div>
              <div className={row(false)}>
                <Tip label="Bill of materials for the whole design, with CSV / Excel export" side="right">
                  <Button variant="ghost" size="sm" className={NM} onClick={() => (bomOpen ? focusPopout(BOMWIN) : setBomOpen(true))}>Bill of materials…</Button>
                </Tip>
              </div>
            </aside>
          )}

          <main className={(isSch ? 'sch' : 'net') + (panels.docked ? '' : ' solo')}>
            <section className="left">
              {proj && open.length > 0 && isSch && (
                <nav className="flex shrink-0 gap-0.5 overflow-x-auto border-b bg-card px-1.5 pt-1">
                  {open.map((f) => (
                    <span key={f} className={cn('flex items-center rounded-t-md border border-b-0 border-transparent text-muted-foreground hover:text-foreground', view === f && '-mb-px border-border bg-background text-foreground')}>
                      <Button variant="ghost" size="xs" aria-pressed={view === f} className="h-7 rounded-none pr-1 pl-3 text-[13px] font-normal text-inherit hover:bg-transparent hover:text-inherit dark:hover:bg-transparent" onClick={() => switchTo(f)}>
                        {stem(f)}{dirty.current.has(f) ? ' •' : ''}
                      </Button>
                      <Button variant="ghost" size="icon-xs" className="mr-1 size-5 opacity-50 hover:opacity-100" onClick={() => closeTab(f)} aria-label={`Close ${stem(f)}`}><X /></Button>
                    </span>
                  ))}
                </nav>
              )}
              {trail && isSch && (
                <div className="flex shrink-0 items-center gap-1 px-2 py-1">
                  <Tip label="Back up to the parent sheet">
                    <Button variant="ghost" size="icon-xs" className="text-muted-foreground" onClick={() => (setCrumbs(trail.slice(0, -1)), switchTo(trail.at(-2)!))} aria-label="Back"><ChevronLeft /></Button>
                  </Tip>
                  <Breadcrumb>
                    <BreadcrumbList className="gap-1 text-xs sm:gap-1">
                      {trail.map((f, i) => (
                        <Fragment key={i}>
                          {i > 0 && <BreadcrumbSeparator />}
                          <BreadcrumbItem>
                            {i < trail.length - 1 ? (
                              <BreadcrumbLink asChild>
                                <Button variant="link" size={null} className="p-0 text-xs font-normal text-muted-foreground" onClick={() => (setCrumbs(trail.slice(0, i + 1)), switchTo(f))}>{stem(f)}</Button>
                              </BreadcrumbLink>
                            ) : <BreadcrumbPage className="font-semibold">{stem(f)}</BreadcrumbPage>}
                          </BreadcrumbItem>
                        </Fragment>
                      ))}
                    </BreadcrumbList>
                  </Breadcrumb>
                </div>
              )}
              {/* one Schematic per open sheet, all mounted (hidden, not unmounted) so each keeps its undo history */}
              {open.map((f) => (
                <div className="pane" hidden={view !== f} key={(ids.current[f] ??= uid())}>
                  <Schematic
                    ref={(h) => { handles.current[f] = h }}
                    name={stem(f)}
                    active={route === 'editor' && view === f}
                    initial={disk.current[f]}
                    onDirty={() => dirtied(f)}
                    overlay={f === top ? overlay : null}
                    onProbe={probe}
                    library={library}
                    browse={browse}
                    sheets={sheetList.filter((s) => s.file !== f)}
                    netCtx={netCtx}
                    onOpenSheet={proj ? descend : undefined}
                    libOpen={panels.parts}
                    onLibOpen={panels.setParts}
                  />
                </div>
              ))}
              <div className="pane" hidden={isSch}>
                <Editor initial={initial} onChange={(s) => ((text.current = s), setNetDirty(true))} />
              </div>
            </section>
            {panels.results((actions) => (
              <ResultsPanel tabs={tabs} cur={cur} ran={!!runs} onTab={setTab} sels={sels} onSels={setSels} log={logLines} blamed={blamed} onBlame={show} actions={actions} meas={meas ?? undefined} />
            ))}
          </main>
        </div>

        <footer className="flex h-6 shrink-0 items-center justify-between border-t bg-card px-3 text-xs text-muted-foreground">
          <span>{status}</span>
          {plot && (
            <span>
              {plot.points} point{plot.points === 1 ? '' : 's'} · {plot.vars.length - (plot.points >= 2 ? 1 : 0)} vectors{cur.runs.length > 1 ? ` · ${cur.runs.length} runs` : ''}
            </span>
          )}
        </footer>
      </div>
      {route === 'library' && (
        <LibraryPage
          title={proj ? proj.name : 'All parts'}
          back={() => go('editor')}
          onHome={() => (go('editor'), leave(onClose))}
          entries={browse}
          packs={sources.packs}
        />
      )}
      {bomOpen && bomData && (
        <BomWindow
          title={`Bill of Materials — ${proj?.name ?? ''}`}
          sheets={files.filter((f) => bomData.used.includes(f))}
          exclude={bomExclude}
          onExclude={setBomExclude}
          rows={bomData.rows}
          skipped={bomData.skipped}
          onExport={exportBom}
          onInfo={setPartInfo}
          onClose={() => (flushBom(), setBomOpen(false))}
        />
      )}
      <ManageLibraries sources={sources} project={proj && { dir: pdir!, libs: proj.libs, texts: libTexts, onImport, onRemove, onToggle: onToggleLib }} />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<TooltipProvider><App /><Help /><Preferences /><RecoveryPrompt /></TooltipProvider>)
