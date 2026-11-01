import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { SimResult } from '../../main/index'
import type { OsOpen } from '../../preload/index'
import type { RawPlot } from '../../main/rawfile'
import { Editor } from './Editor'
import { Home } from './home/Home'
import { useCommands } from './commands'
import { Help } from './Help'
import { BUNDLED, copyOnUse, entriesFromImport, resolver, type ImportedLib, type LibEntry } from './library/library'
import { LibraryView } from './library/LibraryView'
import { useImportCommand, useSources, type Sources } from './library/sources'
import { usePanels } from './layout/Panel'
import { ResultsPanel } from './layout/ResultsPanel'
import { defaultSel, pretty, type PlotRun } from './Plot'
import { newProject, parseProject, refreshBlocks, renameRefs, sheetFile, type Project } from './project/project'
import { emptySheet, parseSheet, uid, type Sheet } from './schematic/model'
import { netlist, type NetCtx, type NetlistResult } from './schematic/netlist'
import { Schematic, type Overlay, type ProbeTarget, type SchematicHandle } from './schematic/Schematic'
import { TEMPLATES } from './schematic/templates'
import { blame, currentVectors, findVector, opVoltages, SAVE_CURRENTS, voltageVector, type Blame } from './sim/probe'
import { expandSweep } from './sim/sweep'
import './style.css'

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

type Run = { label: string; result: SimResult }
type Tab = { key: string; name: string; runs: PlotRun[] }
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
    runs: runs.flatMap((r, i) => (maps[i].has(key) ? [{ label: r.label, plot: maps[i].get(key)! }] : []))
  }))
}

type Route = 'home' | 'editor' | 'library'
type Session =
  | { kind: 'project'; dir: string; file: string /* .nsproj, relative */; project: Project; sheets: Record<string, Sheet>; libTexts: Record<string, string>; warn: string }
  | { kind: 'loose'; path: string | null; sheet: Sheet; net?: { path: string; text: string } }

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

function LibraryPage({ title, back, onHome, ...view }: Parameters<typeof LibraryView>[0] & { title: string; back?: () => void; onHome: () => void }) {
  return (
    <div className="app">
      <header>
        <button onClick={onHome} title="Home">⌂ Home</button>
        {back && <button onClick={back}>‹ Back to editor</button>}
        <span className="brand">Component library</span>
        <span className="file">{title}</span>
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
  useImportCommand(() => setRoute('library'))

  useEffect(() => {
    const osOpen = (x: OsOpen) =>
      'error' in x ? setError(x.error) : leaving.guard(() => start(async () => ('project' in x ? loadProject(x.project) : { kind: 'loose', path: x.path, sheet: parseSheet(x.text) })))
    window.api.osOpens().then((x) => x && osOpen(x))
    const offs = [window.api.onOsOpen(osOpen), window.api.onCloseRequest(() => leaving.guard(window.api.closeNow))]
    return () => offs.forEach((f) => f())
  }, [])
  useEffect(() => { if (!session) document.title = route === 'library' ? 'Component library — ngspice Studio' : 'ngspice Studio' }, [session, route])

  const start = async (f: () => Promise<Session | null>) => {
    try {
      const s = await f()
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
      const project = newProject(name), file = name + '.nsproj'
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
    { id: 'file.openRecent', run: (f) => f && leaving.guard(() => open(f)) }, // menu id 'file.openRecent:<file>'
    ...(session ? [] : [{ id: 'tools.library', run: () => setRoute('library') }, ...(route === 'library' ? [{ id: 'view.home', run: () => setRoute('home') }] : [])])
  ])

  if (session) return <Workspace key={gen} session={session} route={route} go={setRoute} onClose={() => (setSession(null), setRoute('home'))} sources={sources} />
  if (route === 'library')
    return <LibraryPage title="All parts" onHome={() => setRoute('home')} entries={[...BUNDLED, ...sources.entries]} project={null}
      user={sources.user.libs} packs={sources.packs} onImport={sources.save} onRemove={sources.remove} />
  return <Home onCreate={create} onOpen={open} onOpenFile={openFile} onLibrary={() => setRoute('library')} error={error} form={form} setForm={setForm} />
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
  const dirty = useRef(new Set<string>())
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
  const net0 = session.kind === 'loose' && session.net
  const netInit = net0 ? net0.text : proj ? `* ${proj.name}: scratch netlist. "View netlist" fills it from the top sheet.\n` : EXAMPLE
  const [initial, setInitial] = useState(netInit)
  const text = useRef(netInit)
  const [path, setPath] = useState<string | null>(net0 ? net0.path : null)
  const [netDirty, setNetDirty] = useState(false)
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [log, setLog] = useState('')
  const [blamed, setBlamed] = useState<{ line: string; blame: Blame }[]>([]) // blame().lines
  const [sels, setSels] = useState<Record<string, string[]>>({}) // plot tab key -> selected vectors
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [tab, setTab] = useState('') // plot tab key: survives re-runs that add/remove analyses
  const [status, setStatus] = useState(session.kind === 'project' && session.warn ? session.warn : 'Ready')
  const [running, setRunning] = useState(false)
  const peeked = useRef<string | null>(null) // last generated netlist put in the editor

  const files = Object.keys(disk.current).sort()
  const live = (f: string) => handles.current[f]?.get() ?? disk.current[f]
  const isSch = view !== 'net'

  const projEntries = useMemo(
    () => (proj?.libs ?? []).flatMap((l) => (libTexts[l.file] != null ? entriesFromImport(l, libTexts[l.file]) : [])),
    [proj, libTexts]
  )
  const library: LibEntry[] = useMemo(() => [...BUNDLED, ...projEntries, ...sources.entries], [projEntries, sources.entries])
  const resolve = useMemo(() => resolver(library), [library])
  const netCtx: NetCtx = useMemo(() => ({ sheets: { ...disk.current }, lib: resolve }), [rev, resolve])
  const sheetList = useMemo(() => (proj ? files.map((file) => ({ file, sheet: disk.current[file] })) : []), [rev, proj])

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
    setProj(p), setOverlay(null), setRuns(null), setStatus(`${f} is now the top sheet`)
  }

  // ---- libraries ----
  async function onImport(lib: ImportedLib) {
    try {
      const t = await api.read(pdir!, lib.file)
      const p = { ...proj!, libs: [...proj!.libs.filter((l) => l.file !== lib.file), lib] }
      await writeProj(p)
      setProj(p), setLibTexts((m) => ({ ...m, [lib.file]: t }))
      setStatus(`Imported ${lib.entries.length} part${lib.entries.length === 1 ? '' : 's'} from ${lib.file}`)
    } catch (e) {
      setStatus(`Import failed: ${msg(e)}`)
    }
  }
  async function onRemove(file: string) {
    try {
      await api.remove(pdir!, file).catch(() => {}) // already gone is fine
      const p = { ...proj!, libs: proj!.libs.filter((l) => l.file !== file) }
      await writeProj(p)
      setProj(p), setLibTexts(({ [file]: _, ...m }) => m)
    } catch (e) {
      setStatus(`Can't remove ${file}: ${msg(e)}`)
    }
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
  const fail = (log: string, msg: string) => (setRuns([]), setLog(log), setBlamed([]), setStatus(msg))

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
    const sweep = expandSweep(net)
    if (sweep.errors.length) return fail(pre + errLog(sweep.errors), `Sweep errors (${sweep.errors.length})`)
    setRunning(true)
    const t0 = performance.now(), n = sweep.runs.length, done: Run[] = []
    let out = '', ok = true
    for (const [i, s] of sweep.runs.entries()) {
      setStatus(n > 1 ? `Running ${i + 1}/${n} (${s.label})…` : 'Running…')
      const r = await window.api.runSim(s.netlist, dir)
      // SAVE_CURRENTS makes .ac/.noise print one "unrecognized variable - @x[i]" per device: our noise, not the user's
      const rl = nl ? r.log.replace(/^.*unrecognized variable - @.*(\n|$)/gim, '') : r.log
      out += (n > 1 ? `--- run ${s.label} ---\n` : '') + rl + (rl.endsWith('\n') ? '' : '\n')
      done.push({ label: s.label, result: r })
      if (!(ok = r.ok)) break // stop at the first failed run, its log is the last section
    }
    const tabs = tabsOf(done)
    setRuns(done)
    setLog(pre + out)
    setSels((prev) =>
      Object.fromEntries(
        tabs.map(({ key, runs: [{ plot }] }) => {
          const has = new Set(plot.vars.map((v) => v.name.toLowerCase()))
          const keep = prev[key]?.filter((v) => has.has(v)) // keep the user's picks when the vectors still exist
          return [key, keep?.length ? keep : defaultSel(plot)]
        })
      )
    )
    if (nl) {
      const b = blame(nl.warnings.map((w) => 'Warning: ' + w).join('\n') + '\n' + out, nl)
      const op = done[0].result.plots.find((p) => p.plotname === 'Operating Point')
      setBlamed(b.lines)
      setOverlay({
        nets: nl.nets,
        wireNets: nl.wireNets,
        ...(op && { op: opVoltages(nl, op) }),
        ...((!ok || /warning/i.test(out)) && { blame: b.all })
      })
    } else setBlamed([])
    const secs = ((performance.now() - t0) / 1000).toFixed(2)
    const where = proj && isSch && view !== top ? ` · simulated the top sheet ${stem(top)}; open it to probe` : ''
    setStatus(`${ok ? 'Done' : 'Failed'}${n > 1 ? ` (${done.length}/${n} runs)` : ''} in ${secs} s${where}`)
    setRunning(false)
  }

  // Alt+click in the schematic: toggle that net's voltage / part's current in the current plot tab
  function probe(t: ProbeTarget) {
    if (view !== top) return setStatus(`Probing works on the top sheet (${stem(top)}): results are for that circuit`)
    if (!cur) return setStatus('Run a simulation first')
    const plot = cur.runs[0].plot
    let want: string, v: string | null
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
    { id: 'view.home', run: () => leave(onClose) },
    { id: 'view.schematic', run: toSheet, checked: () => route === 'editor' && isSch },
    { id: 'view.netlist', run: () => (go('editor'), switchTo('net')), checked: () => route === 'editor' && !isSch },
    { id: 'sim.run', keys: 'Mod+Enter', run, enabled: () => !running && (isSch ? live(top).parts.length > 0 : /\S/.test(text.current)) },
    { id: 'sim.viewNetlist', run: peek, enabled: () => isSch && canPeek },
    { id: 'tools.library', run: () => (isSch && snap(view), bump(), go('library')) }
  ])

  const name = isSch ? (proj ? view : (base(schPath) ?? 'untitled.nsch')) : (base(path) ?? 'untitled.cir')
  const isDirty = isSch ? dirty.current.has(view) : netDirty
  useEffect(() => {
    if (route === 'editor') document.title = `${proj ? proj.name + ' — ' : ''}${isSch && proj ? stem(view) : name}${isDirty ? ' •' : ''} — ngspice Studio`
  })
  const tabs = useMemo(() => tabsOf(runs ?? []), [runs])
  const cur = tabs.find((t) => t.key === tab) ?? tabs[0]
  const plot = cur?.runs[0].plot
  const logLines = log ? log.split('\n') : []
  const trail = crumbs.length > 1 && crumbs.at(-1) === view ? crumbs : null
  const panels = usePanels({ active: route === 'editor', hasSheets: !!proj, isSch, runs, title: proj?.name ?? name })

  const editKeys = (e: { key: string }, commit: () => void) => (e.key === 'Enter' ? commit() : e.key === 'Escape' && setEdit(null))
  const editInput = (commit: () => void) => (
    <input
      autoFocus
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
          <button onClick={() => leave(onClose)} title="Back to the home page">⌂ Home</button>
          {proj ? (
            <span className="brand">{proj.name}</span>
          ) : (
            <div className="seg views">
              <button className={isSch ? 'on' : ''} onClick={() => setView(LOOSE)}>Schematic</button>
              <button className={isSch ? '' : 'on'} onClick={() => setView('net')}>Netlist</button>
            </div>
          )}
          <span className="file">{name}{isDirty ? ' •' : ''}</span>
          <div className="actions">
            <button onClick={() => (isSch && snap(view), bump(), go('library'))} title="Component library">Library</button>
            {isSch && (
              <button onClick={peek} disabled={!canPeek} title={canPeek ? 'Show the generated netlist in the Netlist editor' : 'The Netlist editor has unsaved edits: save them first (⌘S in Netlist view)'}>
                View netlist
              </button>
            )}
            {!proj && <button onClick={openLoose} title="Open a schematic or netlist here">Open</button>}
            <button onClick={save} title={proj && isSch ? 'Save all sheets (⌘S)' : 'Save (⌘S)'}>Save</button>
            <button className="run" onClick={run} disabled={running} title={proj ? `Run the top sheet ${stem(top)} (⌘↵)` : 'Run (⌘↵)'}>
              {running ? 'Running…' : '▶ Run'}
            </button>
          </div>
        </header>

        {guard && (
          <div className="banner" role="alertdialog" aria-label="Unsaved changes">
            <span>
              Unsaved changes{dirty.current.size ? ` in ${[...dirty.current].map(stem).join(', ')}` : ''}
              {netEdited ? `${dirty.current.size ? ' and' : ' in'} the netlist` : ''}.
            </span>
            <button className="primary" onClick={guardSave} autoFocus>Save</button>
            <button onClick={() => (guard(), setGuard(null))}>Discard</button>
            <button onClick={() => setGuard(null)}>Cancel</button>
          </div>
        )}

        <div className="body">
          {proj && !panels.sheets && panels.sheetsRail}
          {proj && panels.sheets && (
            <aside className="side">
              <div className="side-h">
                Sheets
                <span>
                  <button className="icon" onClick={() => setEdit({ op: 'add', value: '' })} title="Add sheet" aria-label="Add sheet">＋</button>
                  {panels.sheetsHide}
                </span>
              </div>
              {files.map((f) =>
                edit?.file === f && edit.op === 'rename' ? (
                  <div key={f} className="sheet editing">{editInput(() => renameSheet(f, edit.value))}{edit.err && <small className="bad">{edit.err}</small>}</div>
                ) : edit?.file === f && edit.op === 'delete' ? (
                  <div key={f} className="sheet confirm">
                    <span>Delete {stem(f)}?</span>
                    <button className="danger" onClick={() => deleteSheet(f)}>Delete</button>
                    <button autoFocus onClick={() => setEdit(null)}>Cancel</button>
                  </div>
                ) : (
                  <div key={f} className={'sheet' + (view === f ? ' on' : '')}>
                    <button className="nm" onClick={() => switchTo(f)} title={f}>
                      {stem(f)}
                      {dirty.current.has(f) && <span className="dot"> •</span>}
                      {f === top && <span className="badge">top</span>}
                    </button>
                    <span className="ops">
                      <button className="icon" title="Rename" aria-label={`Rename ${stem(f)}`} onClick={() => setEdit({ op: 'rename', file: f, value: stem(f) })}>✎</button>
                      {f !== top && <button className="icon" title="Set as top sheet" aria-label={`Set ${stem(f)} as top`} onClick={() => setTop(f)}>⤒</button>}
                      {f !== top && <button className="icon" title="Delete" aria-label={`Delete ${stem(f)}`} onClick={() => setEdit({ op: 'delete', file: f, value: '' })}>×</button>}
                    </span>
                  </div>
                )
              )}
              {edit?.op === 'add' && (
                <div className="sheet editing">
                  {editInput(() => addSheet(edit.value))}
                  {edit.err && <small className="bad">{edit.err}</small>}
                </div>
              )}
              <div className="side-h">Netlist</div>
              <div className={'sheet' + (view === 'net' ? ' on' : '')}>
                <button className="nm" onClick={() => switchTo('net')}>Hand-written netlist{netDirty ? <span className="dot"> •</span> : null}</button>
              </div>
            </aside>
          )}

          <main className={(isSch ? 'sch' : 'net') + (panels.docked ? '' : ' solo')}>
            <section className="left">
              {proj && open.length > 0 && isSch && (
                <nav className="stabs">
                  {open.map((f) => (
                    <span key={f} className={'stab' + (view === f ? ' on' : '')}>
                      <button onClick={() => switchTo(f)}>{stem(f)}{dirty.current.has(f) ? ' •' : ''}</button>
                      <button className="x" onClick={() => closeTab(f)} aria-label={`Close ${stem(f)}`}>×</button>
                    </span>
                  ))}
                </nav>
              )}
              {trail && isSch && (
                <div className="crumbs">
                  <button className="icon" onClick={() => (setCrumbs(trail.slice(0, -1)), switchTo(trail.at(-2)!))} title="Back up to the parent sheet" aria-label="Back">‹</button>
                  {trail.map((f, i) => (
                    <span key={i}>
                      {i > 0 && <span className="sep">›</span>}
                      {i < trail.length - 1 ? <button className="link" onClick={() => (setCrumbs(trail.slice(0, i + 1)), switchTo(f))}>{stem(f)}</button> : <b>{stem(f)}</b>}
                    </span>
                  ))}
                </div>
              )}
              {/* one Schematic per open sheet, all mounted (hidden, not unmounted) so each keeps its undo history */}
              {open.map((f) => (
                <div className="pane" hidden={view !== f} key={(ids.current[f] ??= uid())}>
                  <Schematic
                    ref={(h) => { handles.current[f] = h }}
                    active={route === 'editor' && view === f}
                    initial={disk.current[f]}
                    onDirty={() => dirtied(f)}
                    overlay={f === top ? overlay : null}
                    onProbe={probe}
                    library={library}
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
              <ResultsPanel tabs={tabs} cur={cur} ran={!!runs} onTab={setTab} sels={sels} onSels={setSels} log={logLines} blamed={blamed} onBlame={show} actions={actions} />
            ))}
          </main>
        </div>

        <footer>
          <span>{status}</span>
          {plot && (
            <span>
              {plot.points} points · {plot.vars.length - 1} vectors{cur.runs.length > 1 ? ` · ${cur.runs.length} runs` : ''}
            </span>
          )}
        </footer>
      </div>
      {route === 'library' && (
        <LibraryPage
          title={proj ? proj.name : 'All parts'}
          back={() => go('editor')}
          onHome={() => (go('editor'), leave(onClose))}
          entries={library}
          project={proj && { dir: pdir!, libs: proj.libs }}
          user={sources.user.libs}
          packs={sources.packs}
          onImport={(l, to) => (to === 'user' ? sources.save(l) : onImport(l))}
          onRemove={(f, from) => (from === 'user' ? sources.remove(f) : onRemove(f))}
        />
      )}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<><App /><Help /></>)
