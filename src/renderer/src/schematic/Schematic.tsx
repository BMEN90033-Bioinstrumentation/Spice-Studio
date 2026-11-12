import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKE, type MouseEvent as RME, type PointerEvent as RPE, type ComponentProps, type ReactNode, type Ref } from 'react'
import { GRID, blockShape, junctions, reshapeBlocks, newPart, nextName, onSegment, pins, route, remap, same, snap, uid, sheetPorts, unconnectedPins, xform, type Directive, type Part, type Pt, type Sheet } from './model'
import { SYMBOLS, isFlag, type Kind } from './symbols'
import { netlist, type NetCtx } from './netlist'
import { blockPartFields, libKey, type LibEntry } from '../library/library'
import { localBox, PinNames, SymBody, SymbolPreview, type Box } from '../library/Symbol'
import { LibraryPanel, sheetName, type LibPick, type SheetItem } from '../library/LibraryPanel'
import { analysisText, mergeOptions, parseAnalysis, setupKind, type Analysis, type SetupKind } from '../sim/analysis'
import { AnalysisDialog, type Tab } from '../sim/AnalysisDialog'
import { SourceDialog } from '../sim/SourceDialog'
import { useCommands } from '../commands'
import { keyLabel, Rail, RAILW } from '../layout/Panel'
import { usePrefs } from '../Preferences'
import { createPortal } from 'react-dom'
import { Cpu, Crosshair, FlipHorizontal2, Maximize, MousePointer2, Redo2, RotateCw, Spline, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tip'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export interface SchematicHandle {
  get(): Sheet; load(s: Sheet): void; replace(s: Sheet): void; select(ids: string[]): void
  addOptions(line: string): void // merge ".options a=1 b=2" into the sheet's .options card (or add one); undoable
  svg(): string // standalone, print-friendly SVG of the sheet
}
// net2: Alt+drag from one net to another = differential voltage v(net) - v(net2)
export type ProbeTarget = { net: string } | { net: string; net2: string } | { partId: string }
export interface Overlay {
  nets: Record<string, string[]> // from the last NetlistResult
  wireNets: Record<string, string>
  op?: Record<string, number> // net -> volts
  blame?: { parts: string[]; nets: string[] }
}

type Tool = 'select' | 'wire' | 'text' | 'probe' | { place: Kind; extra?: Partial<Part>; title: string; id?: string }
type View = { x: number; y: number; k: number }
type Orient = Pick<Part, 'x' | 'y' | 'rot' | 'mirror'>
type Drag =
  | { t: 'pan'; cx: number; cy: number; v: View }
  | { t: 'move'; from: Pt; base: Sheet; sel: Set<string>; d: Pt; click?: string }
  | { t: 'box'; a: Pt; base: Set<string> }
  | { t: 'diff'; net: string; a: Pt; cx: number; cy: number; click: ProbeTarget | null }

const KEYS = Object.fromEntries(Object.entries(SYMBOLS).flatMap(([k, d]) => (d.key ? [[d.key, k]] : []))) as Record<string, Kind>
const QUICK: Kind[] = ['gnd', 'power', 'label', 'port']
const LIBW = 240 // library panel width, keep in sync with .libp in library.css
const clampK = (k: number) => Math.min(8, Math.max(0.2, k))
const add = (a: Pt, d: Pt) => ({ x: a.x + d.x, y: a.y + d.y })
const snapPt = (q: Pt) => ({ x: snap(q.x), y: snap(q.y) })
const norm = (a: Pt, b: Pt): Box => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) })
const SI = ['f', 'p', 'n', 'µ', 'm', '', 'k', 'M', 'G']
function eng(v: number) {
  if (!isFinite(v)) return String(v)
  if (Math.abs(v) < 1e-15) return '0V'
  let e = Math.max(-5, Math.min(3, Math.floor(Math.log10(Math.abs(v)) / 3)))
  let m = +(v / 10 ** (3 * e)).toPrecision(3)
  if (Math.abs(m) >= 1000 && e < 3) (m /= 1000), e++
  return m + SI[e + 5] + 'V'
}
const tf = (p: Orient) => `translate(${p.x} ${p.y}) rotate(${p.rot * 90}) scale(${p.mirror ? -1 : 1} 1)`

const pbox = (p: Part) => { const b = localBox(p.kind, p); return norm(xform(p, { x: b.x0, y: b.y0 }), xform(p, { x: b.x1, y: b.y1 })) }

// Directive card box. ponytail: monospace estimate (char = 0.6em), not measured text
const LH = 12, CW = 6, PAD = 4
const lines = (t: Directive) => t.text.split('\n')
const tbox = (t: Directive): Box => {
  const l = lines(t)
  return { x0: t.x, y0: t.y, x1: t.x + Math.max(3, ...l.map((s) => s.length)) * CW + 2 * PAD, y1: t.y + l.length * LH + 2 * PAD - 2 }
}
const subset = (s: Sheet, ids: Set<string>, keep = true): Sheet => {
  const f = (i: { id: string }) => ids.has(i.id) === keep
  return { version: 1, parts: s.parts.filter(f), wires: s.wires.filter(f), texts: s.texts.filter(f) }
}
const corners = (b: Box) => [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }]

function bounds(s: Sheet): Box | null {
  const pts = [...s.parts.flatMap((p) => corners(pbox(p))), ...s.wires.flatMap((w) => [w.a, w.b]), ...s.texts.flatMap((t) => corners(tbox(t)))]
  if (!pts.length) return null
  return pts.reduce((b, q) => ({ x0: Math.min(b.x0, q.x), y0: Math.min(b.y0, q.y), x1: Math.max(b.x1, q.x), y1: Math.max(b.y1, q.y) }), norm(pts[0], pts[0]))
}

// Name/value text, drawn unrotated beside the part.
// ponytail: placement heuristic from the bbox aspect; no collision avoidance
function Texts({ p }: { p: Part }) {
  if (p.kind === 'gnd') return null
  if (p.kind === 'label' || p.kind === 'port' || p.kind === 'power') {
    // text sits past the symbol along its pointing direction: +x for labels/ports, up (-y) for the power bar
    const up = p.kind === 'power', o = xform(p, up ? { x: 0, y: -1 } : { x: 1, y: 0 }), dx = o.x - p.x, dy = o.y - p.y
    const t = xform(p, up ? { x: 0, y: localBox(p.kind).y0 - 1 } : { x: localBox(p.kind).x1 + 1, y: 0 })
    return <text className="n" x={t.x} y={t.y + (dy > 0 ? 8 : dy < 0 ? 0 : 3.5)} textAnchor={dx > 0 ? 'start' : dx < 0 ? 'end' : 'middle'}>{p.value}</text>
  }
  const b = pbox(p), tall = b.y1 - b.y0 >= b.x1 - b.x0, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
  const [n, v] = tall ? [[b.x1 + 3, cy - 2], [b.x1 + 3, cy + 10]] : [[cx, b.y0 - 4], [cx, b.y1 + 11]]
  const anchor = tall ? 'start' : 'middle'
  const val = p.sheet ? sheetName(p.sheet) : p.value
  return (
    <>
      <text className="n" x={n[0]} y={n[1]} textAnchor={anchor}>{p.name}</text>
      {/* long values (PULSE(...)) are truncated on canvas; full text in the inspector + tooltip */}
      <text x={v[0]} y={v[1]} textAnchor={anchor}>
        <title>{p.sheet ?? p.value}</title>
        {val.length > 16 ? val.slice(0, 15) + '…' : val}
      </text>
    </>
  )
}

const Hit = ({ b }: { b: Box }) => <rect className="hit" x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} />

function Card({ t, cls }: { t: Directive; cls: string }) {
  const b = tbox(t)
  return (
    <g data-id={cls === 'ghost' ? undefined : t.id} className={`dir ${cls}`}>
      <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={2} />
      <text>{lines(t).map((l, i) => <tspan key={i} x={t.x + PAD} y={t.y + PAD + i * LH + 9}>{l}</tspan>)}</text>
    </g>
  )
}

// first .options (.ic, .nodeset) line of a directive card, or undefined
const isSrc = (p: Part) => p.kind === 'vsrc' || p.kind === 'isrc'
const optLine = (text: string, k: SetupKind = 'options') => text.split('\n').find((l) => setupKind(l) === k)

// export palette: black on white, sizes in world units (the export has no zoom)
const PRINT_CSS = [
  '.sym path,.sym circle{fill:none;stroke:#000;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}',
  '.sym .shade,.sym circle{fill:rgba(0,0,0,.07)}.sym .shade{stroke:none}.sym .f{fill:#000}.part{color:#000}',
  'text{font-family:ui-monospace,Menlo,Consolas,monospace}',
  '.part text{fill:#333;font-size:9px}.part text.n{fill:#000}.part text.pn{fill:#555}',
  '.wire line{stroke:#000;stroke-width:1.2;stroke-linecap:round}.jn{fill:#000}',
  '.dir rect{fill:#f7f7f7;stroke:#999;stroke-width:0.6}.dir text{fill:#000;font-size:10px;white-space:pre}'
].join('')

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  return !!(t?.isContentEditable || t?.closest?.('input,textarea,select,.cm-editor'))
}
const blurOnEnter = (e: RKE<HTMLInputElement>) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()

// floating toolbar / inspector chrome (positions stay in schematic.css: they shift with the parts panel)
const Sep = () => <Separator orientation="vertical" className="mx-0.5 data-[orientation=vertical]:h-[18px]" />
const BarBtn = ({ label, aria, onClick, disabled, children }: { label: string; aria: string; onClick: () => void; disabled?: boolean; children: ReactNode }) => (
  <Tip label={label}><Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" aria-label={aria} onClick={onClick} disabled={disabled}>{children}</Button></Tip>
)
const INSP = 'sch-insp grid gap-2 rounded-lg border bg-card p-2.5 text-card-foreground shadow-md'
const FLD = 'grid gap-1 text-[11px] font-normal text-muted-foreground'
const D = 'text-[11px] leading-snug text-muted-foreground [&_code]:font-mono [&_code]:text-foreground'
const MONO = 'font-mono text-xs md:text-xs text-foreground'
const InspBtn = (p: ComponentProps<typeof Button>) => <Button size="sm" variant="outline" className="h-7 justify-self-start text-xs" {...p} />

export function Schematic({ active, initial, onDirty, ref, overlay, onProbe, library = [], browse, sheets = [], netCtx, onOpenSheet, libOpen: libProp, onLibOpen, name = 'schematic' }: {
  active: boolean; initial: Sheet; onDirty: () => void; ref?: Ref<SchematicHandle>; overlay?: Overlay | null; onProbe?: (t: ProbeTarget) => void
  library?: LibEntry[]; browse?: LibEntry[] /* Parts panel list, default library */; sheets?: SheetItem[]; netCtx?: NetCtx; onOpenSheet?: (file: string) => void
  libOpen?: boolean; onLibOpen?: (open: boolean) => void // parts panel, controlled by the workspace layout when given
  name?: string // export file stem
}) {
  const [sheet, setSheet] = useState(initial)
  const [sel, setSel] = useState<Set<string>>(() => new Set())
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const [tool, setTool] = useState<Tool>('select')
  const [ghost, setGhost] = useState({ rot: 0, mirror: false })
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [start, setStart] = useState<Pt | null>(null)
  const [vFirst, setVFirst] = useState(false)
  const [box, setBox] = useState<Box | null>(null)
  const [space, setSpace] = useState(false)
  const [hov, setHov] = useState<ProbeTarget | null>(null)
  const opPref = usePrefs().showOp // Settings › Schematic; the OP toggle overrides it per canvas
  const [showOp, setShowOp] = useState(opPref)
  useEffect(() => setShowOp(opPref), [opPref])
  const [dlg, setDlg] = useState<Tab | 'analysis' | 'edit' | null>(null) // analysis dialog open, on this tab ('edit': rewrite the selected card)
  const [srcDlg, setSrcDlg] = useState(false)
  const [band, setBand] = useState<{ a: Pt; b: Pt } | null>(null) // differential probe rubber band
  const modal = !!dlg || srcDlg
  const [libOwn, setLibOwn] = useState(true)
  const libOpen = libProp ?? libOwn
  const search = useRef<HTMLInputElement>(null)
  const gridId = 'g' + useId().replace(/[^\w-]/g, '') // several canvases are mounted at once
  const cur = useRef(sheet) // latest sheet, readable synchronously between renders
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const hist = useRef({ undo: [] as Sheet[], redo: [] as Sheet[], merge: undefined as string | undefined })
  const clip = useRef<Sheet | null>(null) // ponytail: in-app clipboard only; system clipboard if cross-window paste is wanted
  const needFit = useRef(true)
  const ta = useRef<HTMLTextAreaElement>(null)
  const bar = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null)
  // toolbar wraps in narrow panes: keep the inspector below it
  useEffect(() => {
    const ro = new ResizeObserver(() => root.current?.style.setProperty('--bar-h', bar.current!.offsetHeight + 'px'))
    ro.observe(bar.current!)
    return () => ro.disconnect()
  }, [])
  // ponytail: re-netlists on every sheet change (incl. drag frames); fine for hand-drawn sizes, gate on use if it shows up in profiles
  const nl = useMemo(() => netlist(sheet, undefined, netCtx), [sheet, netCtx])
  const wn = overlay?.wireNets ?? nl.wireNets, pn = overlay?.nets ?? nl.nets

  // what a probe click on el would plot: parts -> current, wires/labels -> net voltage; ground -> nothing
  function probeAt(el: Element): ProbeTarget | null {
    const id = el.closest('[data-id]')?.getAttribute('data-id')
    if (!id) return null
    const p = cur.current.parts.find((q) => q.id === id)
    if (p && !isFlag(p.kind)) return { partId: p.id }
    const net = p ? pn[p.id]?.[0] : wn[id]
    return net && net !== '0' ? { net } : null
  }

  // net under world point w / element el, ground included: a pin within a few px, else a wire or net flag
  function netAt(w: Pt, el: Element | null): string | null {
    const r = 6 / view.k
    for (const p of cur.current.parts) {
      const i = isFlag(p.kind) ? -1 : pins(p).findIndex((q) => Math.hypot(q.x - w.x, q.y - w.y) <= r)
      if (i >= 0 && pn[p.id]?.[i]) return pn[p.id][i]
    }
    const id = el?.closest('[data-id]')?.getAttribute('data-id')
    const p = id ? cur.current.parts.find((q) => q.id === id) : undefined
    return (p ? (isFlag(p.kind) ? pn[p.id]?.[0] : undefined) : id ? wn[id] : undefined) ?? null
  }

  const live = (s: Sheet) => { cur.current = s; setSheet(s) }
  function commit(next: Sheet, merge?: string, base = cur.current) {
    const h = hist.current
    if (!merge || merge !== h.merge) {
      h.undo.push(base)
      if (h.undo.length > 200) h.undo.shift()
    }
    h.redo = []
    h.merge = merge
    live(next)
    onDirty()
  }
  function step(from: Sheet[], to: Sheet[]) {
    const s = from.pop()
    if (!s) return
    to.push(cur.current)
    hist.current.merge = undefined
    live(s)
    onDirty()
  }
  const undo = () => step(hist.current.undo, hist.current.redo)
  const redo = () => step(hist.current.redo, hist.current.undo)

  function fit(s = cur.current) {
    const r = svg.current?.getBoundingClientRect()
    needFit.current = !r?.width // hidden (display:none): retry when shown
    if (!r?.width) return
    const b = bounds(s)
    if (!b) return setView({ x: r.width / 2, y: r.height / 2, k: 1.5 })
    frame(r, b, 3)
  }
  // centre b in the viewport at zoom ≤ kMax, zooming out only if b doesn't fit
  function frame(r: DOMRect, b: Box, kMax: number) {
    const k = clampK(Math.min(kMax, (r.width - 80) / (b.x1 - b.x0 || 1), (r.height - 140) / (b.y1 - b.y0 || 1)))
    setView({ k, x: r.width / 2 - ((b.x0 + b.x1) / 2) * k, y: r.height / 2 + 10 - ((b.y0 + b.y1) / 2) * k })
  }
  function show(ids: string[]) {
    const set = new Set(ids), r = svg.current?.getBoundingClientRect(), b = bounds(subset(cur.current, set))
    setSel(set)
    if (!b || !r?.width) return
    const { x, y, k } = view // already on screen (clear of toolbar/hint)? leave the view alone
    if (b.x0 * k + x >= 10 && b.x1 * k + x <= r.width - 10 && b.y0 * k + y >= 80 && b.y1 * k + y <= r.height - 30) return
    frame(r, b, k)
  }
  useLayoutEffect(() => { if (active && needFit.current) fit() }, [active])

  const zoomAt = (mx: number, my: number, f: number) =>
    setView((v) => { const k = clampK(v.k * f); return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k } })
  function zoomBy(f: number) {
    const r = svg.current!.getBoundingClientRect()
    zoomAt(r.width / 2, r.height / 2, f)
  }
  function world(e: { clientX: number; clientY: number }): Pt {
    const r = svg.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }
  }

  function use(t: Tool) {
    setTool(t)
    setStart(null)
    setGhost({ rot: 0, mirror: false })
    setHov(null)
  }
  function toggleLib(open = !libOpen) {
    if (open !== libOpen) (onLibOpen ?? setLibOwn)(open)
  }
  // panel opens/closes beside the canvas (also from outside); shift the view so the drawing stays put on screen
  const libWas = useRef(libOpen)
  useLayoutEffect(() => {
    if (libWas.current !== libOpen) setView((v) => ({ ...v, x: v.x + (libOpen ? RAILW - LIBW : LIBW - RAILW) }))
    libWas.current = libOpen
  }, [libOpen])
  function pick(e: LibPick) {
    if ('file' in e) {
      const ports = sheetPorts(e.sheet)
      return use({ place: 'block', title: sheetName(e.file), id: 'sheet:' + e.file, extra: { sheet: e.file, value: sheetName(e.file), ...blockShape(ports) } })
    }
    // ponytail: spice-less generics (std:R…) stay plain parts, no lib id: they netlist identically and survive a missing resolver
    const extra: Partial<Part> = { value: e.value, ...(e.spice ? { lib: e.id } : {}) }
    if (e.kind === 'block') Object.assign(extra, blockPartFields(e))
    use({ place: e.kind, title: e.name, id: e.id, extra })
  }
  const picked = () => subset(cur.current, sel)
  const all = (s: Sheet) => [...s.parts, ...s.wires, ...s.texts].map((i) => i.id)
  function orient(rot: boolean) {
    const f = <T extends { rot: number; mirror: boolean }>(p: T): T => (rot ? { ...p, rot: (p.rot + 1) % 4 } : { ...p, mirror: !p.mirror })
    if (typeof tool === 'object') setGhost(f)
    else if (picked().parts.length) commit(remap(cur.current, sel, f))
  }
  function del() {
    if (!sel.size) return
    commit({ ...cur.current, ...subset(cur.current, sel, false) })
    setSel(new Set())
  }
  // Pastes c offset by +20 with fresh ids/names, selects it, and returns what was pasted (so repeated ⌘V cascades).
  function paste(c: Sheet | null): Sheet | null {
    if (!c || !(c.parts.length + c.wires.length + c.texts.length)) return c
    const s = cur.current
    const next: Sheet = { ...s, parts: [...s.parts], wires: [...s.wires], texts: [...s.texts] }
    const out: Sheet = { version: 1, parts: [], wires: [], texts: [] }
    const off = (q: Pt) => add(q, { x: 20, y: 20 })
    for (const p of c.parts) {
      const pre = SYMBOLS[p.kind].prefix
      const n = { ...p, ...off(p), id: uid(), name: pre ? nextName(next, pre) : p.name }
      next.parts.push(n), out.parts.push(n)
    }
    for (const w of c.wires) {
      const n = { id: uid(), a: off(w.a), b: off(w.b) }
      next.wires.push(n), out.wires.push(n)
    }
    for (const t of c.texts) {
      const n = { ...t, ...off(t), id: uid() }
      next.texts.push(n), out.texts.push(n)
    }
    commit(next)
    setSel(new Set(all(out)))
    return out
  }
  function esc() {
    if (start) setStart(null)
    else if (tool !== 'select') use('select')
    else setSel(new Set())
  }

  function onKey(e: KeyboardEvent) {
    if (!active || modal || typing(e)) return
    const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey
    let done = true
    if (k === ' ') setSpace(true)
    else if (e.ctrlKey && !e.metaKey && (k === 'r' || k === 'e')) orient(k === 'r') // not ⌘R: that's Electron reload
    else if (mod && k === 'z') e.shiftKey ? redo() : undo()
    else if (mod && k === 'y') redo()
    else if (mod && k === 'c') clip.current = picked()
    else if (mod && k === 'x') cut()
    else if (mod && k === 'v') clip.current = paste(clip.current)
    else if (mod && k === 'd') paste(picked())
    else if (mod && k === 'a') setSel(new Set(all(cur.current)))
    else if (mod || e.altKey) done = false
    else if (k === 'escape') esc()
    else if (k === 'delete' || k === 'backspace') del()
    else if (k === 'w') use('wire')
    else if (k === 's') use('text')
    else if (k === 'p') use('probe')
    else if (k === 'a') setDlg('analysis')
    else if (k === '/' && tool === 'wire') setVFirst((v) => !v)
    else if (k === '/') toggleLib(true), setTimeout(() => search.current?.focus())
    else if (e.key === 'L') toggleLib()
    else if (k === '+' || k === '=') zoomBy(1.25)
    else if (k === '-') zoomBy(0.8)
    else if (k === 'f') fit()
    else if (KEYS[k] && !e.shiftKey) use({ place: KEYS[k], title: SYMBOLS[KEYS[k]].title })
    else done = false
    if (done) e.preventDefault()
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.key !== ' ') return
    setSpace(false)
    if (active && !modal && !typing(e)) e.preventDefault() // stop Space from clicking a focused toolbar button
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const r = svg.current!.getBoundingClientRect()
    if (e.ctrlKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(Math.max(-50, Math.min(50, -e.deltaY)) * 0.01))
    else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
  }
  const on = useRef({ onKey, onKeyUp, onWheel })
  on.current = { onKey, onKeyUp, onWheel }
  useEffect(() => {
    const k = (e: KeyboardEvent) => on.current.onKey(e)
    const u = (e: KeyboardEvent) => on.current.onKeyUp(e)
    const w = (e: WheelEvent) => on.current.onWheel(e)
    const b = () => setSpace(false) // keyup is lost if the window blurs mid-press
    const el = svg.current!
    window.addEventListener('blur', b)
    window.addEventListener('keydown', k)
    window.addEventListener('keyup', u)
    el.addEventListener('wheel', w, { passive: false }) // React's onWheel is passive, can't preventDefault
    return () => {
      window.removeEventListener('keydown', k)
      window.removeEventListener('keyup', u)
      window.removeEventListener('blur', b)
      el.removeEventListener('wheel', w)
    }
  }, [])

  // menu commands (commands.ts) for the active canvas only; the keys stay in onKey above
  const cut = () => ((clip.current = picked()), del())
  const some = (s: Sheet | null) => !!s && s.parts.length + s.wires.length + s.texts.length > 0
  const orientable = () => typeof tool === 'object' || picked().parts.length > 0
  useCommands(active && !modal ? [
    { id: 'edit.undo', run: undo, enabled: () => hist.current.undo.length > 0 },
    { id: 'edit.redo', run: redo, enabled: () => hist.current.redo.length > 0 },
    { id: 'edit.cut', run: cut, enabled: () => sel.size > 0 },
    { id: 'edit.copy', run: () => (clip.current = picked()), enabled: () => sel.size > 0 },
    { id: 'edit.paste', run: () => (clip.current = paste(clip.current)), enabled: () => some(clip.current) },
    { id: 'edit.duplicate', run: () => paste(picked()), enabled: () => sel.size > 0 },
    { id: 'edit.delete', run: del, enabled: () => sel.size > 0 },
    { id: 'edit.selectAll', run: () => setSel(new Set(all(cur.current))), enabled: () => some(cur.current) },
    { id: 'edit.rotate', run: () => orient(true), enabled: orientable },
    { id: 'edit.mirror', run: () => orient(false), enabled: orientable },
    { id: 'view.zoomIn', run: () => zoomBy(1.25) },
    { id: 'view.zoomOut', run: () => zoomBy(0.8) },
    { id: 'view.fit', run: () => fit() },
    { id: 'view.showOp', run: () => setShowOp((v) => !v), enabled: () => !!overlay?.op, checked: () => !!overlay?.op && showOp },
    { id: 'place.wire', run: () => use('wire') },
    { id: 'place.directive', run: () => use('text') },
    { id: 'place.fromLibrary', run: () => (toggleLib(true), setTimeout(() => search.current?.focus())) },
    ...(['res', 'cap', 'ind', 'vsrc', 'isrc', 'diode', 'npn', 'pnp', 'nmos', 'pmos', 'opamp', 'gnd', 'label', 'port',
      'power', 'vcvs', 'vccs', 'ccvs', 'cccs', 'bv', 'bi', 'sw', 'csw', 'tline', 'xfmr', 'kcouple'] as Kind[]).map((k) => ({ id: 'place.' + k, run: () => use({ place: k, title: SYMBOLS[k].title }) })),
    { id: 'sim.setup', run: () => setDlg('analysis') },
    { id: 'sim.options', run: () => setDlg('options') },
    { id: 'sim.ic', run: () => setDlg('ic') },
    { id: 'file.export.schSvg', run: () => void window.api.exportSave(name + '.svg', exportSvg(), [{ name: 'SVG', extensions: ['svg'] }]) },
    { id: 'file.export.schPdf', run: () => void window.api.exportPdf(exportSvg(), name + '.pdf') },
    { id: 'file.export.print', keys: 'Mod+P', run: () => void window.api.exportPdf(exportSvg(), '', 'print') },
    { id: 'sim.probe', run: () => use('probe') }
  ] : [])

  useImperativeHandle(ref, () => ({
    get: () => cur.current,
    load(s) {
      hist.current = { undo: [], redo: [], merge: undefined }
      live(s)
      setSel(new Set())
      setStart(null)
      fit(s)
    },
    replace: (s) => commit(s), // undoable edit from outside (e.g. block pins after a sheet rename); keeps view + history
    select: show,
    addOptions: (line) => putOptions(line, true),
    svg: exportSvg
  }))

  function wireClick(p: Pt) {
    if (!start) return setStart(p)
    if (same(p, start)) return
    const s = cur.current
    const hit = s.parts.some((q) => pins(q).some((r) => same(r, p))) || s.wires.some((w) => same(w.a, p) || same(w.b, p) || onSegment(w, p))
    commit({ ...s, wires: [...s.wires, ...route(start, p, vFirst)] })
    setStart(hit ? null : p)
  }

  function down(e: RPE<SVGSVGElement>) {
    if (e.button === 1 || (e.button === 0 && space)) {
      e.preventDefault()
      drag.current = { t: 'pan', cx: e.clientX, cy: e.clientY, v: view }
      return e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (e.button !== 0) return
    const w = world(e), p = snapPt(w), s = cur.current
    if (tool === 'probe' || (tool === 'select' && e.altKey)) {
      // a net (wire, flag or pin) may start a differential drag; a click without dragging probes as before
      const t = probeAt(e.target as Element), net = netAt(w, e.target as Element)
      if (net == null) return void (t && onProbe?.(t))
      drag.current = { t: 'diff', net, a: w, cx: e.clientX, cy: e.clientY, click: t }
      return e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (tool === 'wire') return wireClick(p)
    if (tool === 'text') {
      const t = { id: uid(), x: p.x, y: p.y, text: '.op' }
      commit({ ...s, texts: [...s.texts, t] })
      setSel(new Set([t.id]))
      use('select')
      setTimeout(() => ta.current?.select()) // after mousedown's default focus change
      return
    }
    if (typeof tool === 'object') return commit({ ...s, parts: [...s.parts, newPart(s, tool.place, p.x, p.y, ghost.rot, ghost.mirror, tool.extra)] })
    e.currentTarget.setPointerCapture(e.pointerId)
    const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id')
    if (!id) {
      if (!e.shiftKey) setSel(new Set())
      drag.current = { t: 'box', a: w, base: e.shiftKey ? sel : new Set() }
      return
    }
    let next = sel
    if (e.shiftKey) {
      next = new Set(sel)
      next.has(id) ? next.delete(id) : next.add(id)
    } else if (!sel.has(id)) next = new Set([id])
    setSel(next)
    // click (no drag) on an already-selected item narrows the selection to it on pointerup
    if (next.has(id)) drag.current = { t: 'move', from: w, base: s, sel: next, d: { x: 0, y: 0 }, click: !e.shiftKey && sel.has(id) ? id : undefined }
  }
  function move(e: RPE<SVGSVGElement>) {
    const w = world(e), p = snapPt(w), d = drag.current
    if (!cursor || !same(cursor, p)) setCursor(p)
    const t = !d && (tool === 'probe' || (tool === 'select' && e.altKey)) ? probeAt(e.target as Element) : null
    setHov((h) => (h && t && ('net' in h ? 'net' in t && h.net === t.net : 'partId' in t && h.partId === t.partId) ? h : t))
    if (!d) return
    if (d.t === 'pan') setView({ ...d.v, x: d.v.x + e.clientX - d.cx, y: d.v.y + e.clientY - d.cy })
    else if (d.t === 'box') setBox(norm(d.a, w))
    else if (d.t === 'diff') {
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 4) return
      setBand({ a: d.a, b: w })
      const n = netAt(w, document.elementFromPoint(e.clientX, e.clientY)) // pointer capture: hit-test the point
      setHov((h) => (n && n !== '0' ? (h && 'net' in h && h.net === n ? h : { net: n }) : null))
    }
    else {
      const dd = { x: snap(w.x - d.from.x), y: snap(w.y - d.from.y) }
      if (same(dd, d.d)) return
      d.d = dd // each frame recomputed from the drag-start snapshot, so no drift
      const r = remap(d.base, d.sel, (q) => ({ ...q, ...add(q, dd) }), (q) => add(q, dd))
      live({ ...r, texts: r.texts.map((t) => (d.sel.has(t.id) ? { ...t, ...add(t, dd) } : t)) })
    }
  }
  function up(e: RPE<SVGSVGElement>) {
    const d = drag.current
    drag.current = null
    if (d?.t === 'diff') {
      setBand(null)
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 4) return void (d.click && onProbe?.(d.click))
      const n2 = netAt(world(e), document.elementFromPoint(e.clientX, e.clientY))
      if (n2 == null || n2 === d.net) return
      // ground as either end is just the other net's voltage
      onProbe?.(d.net === '0' ? { net: n2 } : n2 === '0' ? { net: d.net } : { net: d.net, net2: n2 })
    } else if (d?.t === 'box') {
      setBox(null)
      const b = norm(d.a, world(e))
      if (b.x1 - b.x0 + b.y1 - b.y0 < 4 / view.k) return
      const inside = (q: Pt) => q.x >= b.x0 && q.x <= b.x1 && q.y >= b.y0 && q.y <= b.y1
      const s = cur.current
      const hits = [
        ...s.parts.filter((p) => corners(pbox(p)).every(inside)),
        ...s.wires.filter((w) => inside(w.a) && inside(w.b)),
        ...s.texts.filter((t) => corners(tbox(t)).every(inside))
      ]
      setSel(new Set([...d.base, ...hits.map((i) => i.id)]))
    } else if (d?.t === 'move') {
      if (d.d.x || d.d.y) commit({ ...cur.current, wires: cur.current.wires.filter((w) => !same(w.a, w.b)) }, undefined, d.base)
      else if (d.click) setSel(new Set([d.click]))
    }
  }

  function dbl(e: RME) {
    if (tool === 'wire') return setStart(null)
    // pointer capture from pointerdown retargets dblclick to the <svg>: hit-test the point instead
    const id = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-id]')?.getAttribute('data-id')
    const p = cur.current.parts.find((q) => q.id === id)
    if (p?.sheet && onOpenSheet) return onOpenSheet(p.sheet)
    ta.current?.focus()
  }
  // re-fit a sheet block's pins to the sheet's current ports (wires on surviving pins follow by name)
  const updateBlock = (p: Part, ports: string[]) => commit(reshapeBlocks(cur.current, new Set([p.id]), ports))

  const setText = (s: Sheet, id: string, text: string) => commit({ ...s, texts: s.texts.map((t) => (t.id === id ? { ...t, text } : t)) })
  function addCard(text: string) {
    const s = cur.current, b = bounds(s), t = { id: uid(), x: snap(b?.x0 ?? 0), y: snap((b?.y1 ?? 0) + 20), text }
    commit({ ...s, texts: [...s.texts, t] })
    show([t.id])
  }
  function applyAnalysis(a: Analysis) {
    const text = analysisText(a)
    setDlg(null)
    if (dlg === 'edit' && dir) return setText(cur.current, dir.id, text)
    addCard(text)
  }
  // the sheet's .options line: the first directive line starting .options/.option/.opt (in any card); same for .ic/.nodeset
  const optCard = (s: Sheet, k: SetupKind = 'options') => s.texts.find((t) => optLine(t.text, k) != null)
  const lineOf = (k: SetupKind) => { const c = optCard(sheet, k); return c && optLine(c.text, k) }
  // write `line` into that card (merge = .options key by key into what's there, else replace the line), or add a card
  function putOptions(line: string, merge: boolean) {
    const s = cur.current, k = setupKind(line) ?? 'options', c = optCard(s, k)
    if (!c) return void (k !== 'options' ? addCard(line) : mergeOptions('', line) !== '.options' && addCard(mergeOptions('', line)))
    const old = optLine(c.text, k)!, next = merge && k === 'options' ? mergeOptions(old, line) : line
    if (next !== old) setText(s, c.id, c.text.split('\n').map((l) => (l === old ? next : l)).join('\n'))
  }

  // Standalone print-friendly SVG: the drawing layer cloned, cropped to the content, overlays/selection/grid dropped
  function exportSvg(): string {
    const g = svg.current!.querySelector(':scope > g')!.cloneNode(true) as SVGGElement
    g.removeAttribute('transform')
    g.querySelectorAll('.ghost, .preview, .boxsel, .op, .nc, .hit, .band, title').forEach((e) => e.remove())
    g.querySelectorAll('[data-id]').forEach((e) => e.removeAttribute('data-id'))
    g.querySelectorAll('.on, .hl, .blame').forEach((e) => e.classList.remove('on', 'hl', 'blame'))
    // crop: bounds() plus the part labels, estimated like the cards (monospace, char = 0.6em)
    let { x0, y0, x1, y1 } = bounds(cur.current) ?? { x0: 0, y0: 0, x1: 100, y1: 60 }
    g.querySelectorAll('.part text').forEach((t) => {
      const x = +t.getAttribute('x')!, y = +t.getAttribute('y')!, fs = +(t.getAttribute('font-size') ?? 9), w = (t.textContent ?? '').length * fs * 0.6
      const a = t.getAttribute('text-anchor'), l = a === 'end' ? x - w : a === 'middle' ? x - w / 2 : x
      ;(x0 = Math.min(x0, l)), (x1 = Math.max(x1, l + w)), (y0 = Math.min(y0, y - fs)), (y1 = Math.max(y1, y + fs / 3))
    })
    const M = 20, x = x0 - M, y = y0 - M, w = x1 - x0 + 2 * M, h = y1 - y0 + 2 * M
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">` +
      `<style>${PRINT_CSS}</style><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>${new XMLSerializer().serializeToString(g)}</svg>`
  }

  const dots = useMemo(() => ({ j: junctions(sheet), nc: unconnectedPins(sheet) }), [sheet])
  const placing = typeof tool === 'object' ? tool : null
  const one = sel.size === 1 ? sheet.parts.find((p) => sel.has(p.id) && p.kind !== 'gnd') : undefined
  const entry = one?.lib ? library.find((e) => e.id === one.lib) : undefined
  const blockSheet = one?.sheet ? sheets.find((x) => x.file === one.sheet) : undefined
  const ports = blockSheet && sheetPorts(blockSheet.sheet)
  const stale = ports && ports.join('\0') !== (one!.pins ?? []).map((q) => q.name).join('\0') ? ports : undefined
  const dir = sel.size === 1 ? sheet.texts.find((t) => sel.has(t.id)) : undefined
  const dirA = dir ? parseAnalysis(dir.text.trim()) : null
  const hovNet = hov && 'net' in hov ? hov.net : null, hovPart = hov && 'partId' in hov ? hov.partId : null
  const blamed = new Set(overlay?.blame?.parts)
  const fs = Math.min(24, Math.max(4, 10 / view.k)) // OP tag font: ~10px on screen, clamped in world units
  // one tag per non-ground net: above its label if it has one, else above the middle of its longest wire
  const tags = useMemo(() => {
    const op = overlay?.op
    if (!op) return []
    const at = new Map<string, Pt>(), len = new Map<string, number>() // labels win: length Infinity
    for (const p of sheet.parts) {
      const n = pn[p.id]?.[0]
      if ((p.kind === 'label' || p.kind === 'power') && n && !at.has(n)) at.set(n, xform(p, { x: 14, y: 0 })), len.set(n, Infinity)
    }
    for (const w of sheet.wires) {
      const n = wn[w.id], l = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
      if (!n || (len.get(n) ?? -1) >= l) continue
      len.set(n, l)
      at.set(n, { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 })
    }
    return [...at].filter(([n]) => n !== '0' && op[n] != null).map(([n, q]) => ({ n, q, t: eng(op[n]) }))
  }, [sheet, overlay])
  const sources = sheet.parts.filter((p) => p.kind === 'vsrc' || p.kind === 'isrc').map((p) => p.name)
  const editText = (id: string, text: string) =>
    commit({ ...cur.current, texts: cur.current.texts.map((t) => (t.id === id ? { ...t, text } : t)) }, `edit:${id}:text`)
  const edit = (p: Part, f: 'name' | 'value', v: string) =>
    commit({ ...cur.current, parts: cur.current.parts.map((q) => (q.id === p.id ? { ...q, [f]: v } : q)) }, `edit:${p.id}:${f}`)
  const g = view.k * GRID < 6 ? GRID * 5 : GRID
  const hint = placing
    ? `Placing ${placing.title} · click to place · Ctrl+R rotate · Ctrl+E mirror · Esc done`
    : tool === 'text'
      ? 'Click to place a SPICE directive · Esc returns to select'
      : tool === 'wire'
      ? start
        ? 'Click to add a corner · click a pin or wire to finish · / flips the corner · double-click or Esc ends'
        : 'Click to start a wire · Esc returns to select'
      : tool === 'probe'
      ? 'Click a wire to plot its voltage · click a part to plot its current · drag between two nets plots the difference · Esc returns to select'
      : `Drag to move or box-select · Alt+click probes · Space-drag pans · F fits · ${keyLabel('Mod+/')} for all shortcuts`

  return (
    <div ref={root} className={`sch${tool === 'probe' ? ' probe' : tool !== 'select' ? ' draw' : ''}${space ? ' pan' : ''}${libOpen ? ' lib' : ''}`}>
      <svg ref={svg} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onPointerLeave={() => !drag.current && (setCursor(null), setHov(null))} onDoubleClick={dbl} onContextMenu={(e) => e.preventDefault()}>
        <defs>
          <pattern id={gridId} width={g} height={g} patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <circle className="dot" r={1 / view.k} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${gridId})`} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {sheet.parts.map((p) => (
            <g key={p.id} data-id={p.id} className={`part${sel.has(p.id) ? ' on' : ''}${hovPart === p.id || (hovNet && isFlag(p.kind) && pn[p.id]?.[0] === hovNet) ? ' hl' : ''}${blamed.has(p.id) ? ' blame' : ''}`}>
              <g className="sym" transform={tf(p)}>
                <Hit b={localBox(p.kind, p)} />
                <SymBody kind={p.kind} part={p} />
              </g>
              {p.kind === 'block' && <PinNames part={p} at={p} />}
              <Texts p={p} />
            </g>
          ))}
          {sheet.wires.map((w) => (
            <g key={w.id} data-id={w.id} className={`wire${sel.has(w.id) ? ' on' : ''}${hovNet && wn[w.id] === hovNet ? ' hl' : ''}${overlay?.blame?.nets.includes(wn[w.id]) ? ' blame' : ''}`}>
              <line className="hit" x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />
              <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />
            </g>
          ))}
          {sheet.texts.map((t) => <Card key={t.id} t={t} cls={sel.has(t.id) ? 'on' : ''} />)}
          {dots.j.map((q) => <circle key={`j${q.x},${q.y}`} className="jn" cx={q.x} cy={q.y} r={3} />)}
          {dots.nc.map((q, i) => <rect key={i} className="nc" x={q.x - 2} y={q.y - 2} width={4} height={4} />)}
          {placing && cursor && (
            <g className="ghost">
              <g className="sym" transform={tf({ ...ghost, ...cursor })}><SymBody kind={placing.place} part={placing.extra} /></g>
              {placing.place === 'block' && placing.extra && <PinNames part={placing.extra} at={{ ...ghost, ...cursor }} />}
            </g>
          )}
          {tool === 'text' && cursor && <Card t={{ id: '', ...cursor, text: '.op' }} cls="ghost" />}
          {tool === 'wire' && cursor && (
            <g className="preview">
              {start && route(start, cursor, vFirst).map((w, i) => <line key={i} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />)}
              <circle cx={cursor.x} cy={cursor.y} r={2.5} />
            </g>
          )}
          {showOp && tags.map(({ n, q, t }) => (
            <g key={n} className="op" transform={`translate(${q.x} ${q.y - 6 - fs * 0.8})`}>
              <rect x={-(t.length * 0.3 + 0.5) * fs} y={-0.7 * fs} width={(t.length * 0.6 + 1) * fs} height={1.4 * fs} rx={0.7 * fs} />
              <text fontSize={fs} y={0.35 * fs} textAnchor="middle">{t}</text>
            </g>
          ))}
          {band && <line className="band" x1={band.a.x} y1={band.a.y} x2={band.b.x} y2={band.b.y} />}
          {box && <rect className="boxsel" x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} />}
        </g>
      </svg>

      {libOpen ? <LibraryPanel entries={browse ?? library} sheets={sheets} onPick={pick} active={placing?.id} search={search} />
        : <Rail side="left" label="Parts" icon={Cpu} title={`Show parts (${keyLabel('Mod+2')} or Shift+L)`} onOpen={() => toggleLib(true)} />}
      <div className="sch-bar flex-wrap items-center gap-0.5 rounded-lg border bg-card/95 p-1 shadow-sm" ref={bar}>
        <Tip label="Parts library (Shift+L) · search (/)">
          <Toggle size="sm" className="h-7 px-2 text-xs" pressed={libOpen} onPressedChange={() => toggleLib()}>Parts</Toggle>
        </Tip>
        <Sep />
        {/* items keep their own onClick: re-clicking the current tool still resets it (ends a wire in progress) */}
        <ToggleGroup type="single" size="sm" aria-label="Tool" value={typeof tool === 'string' ? tool : ''}>
          {([['select', 'Select (Esc)', 'Select', <MousePointer2 />], ['wire', 'Wire (W)', 'Wire', <Spline />], ['text', 'SPICE directive (S)', 'SPICE directive', '.op'],
            ['probe', 'Probe (P) · or Alt+click', 'Probe', <Crosshair />]] as const).map(([k, label, aria, body]) => (
            <Tip key={k} label={label}>
              <ToggleGroupItem value={k} aria-label={aria} className={cn('h-7 min-w-7 px-1.5 text-muted-foreground', k === 'text' && 'font-mono text-xs')} onClick={() => use(k)}>{body}</ToggleGroupItem>
            </Tip>
          ))}
        </ToggleGroup>
        <Sep />
        {QUICK.map((k) => {
          const on = placing?.place === k && !placing.id
          return (
            <Tip key={k} label={SYMBOLS[k].title + (SYMBOLS[k].key ? ` (${SYMBOLS[k].key!.toUpperCase()})` : '')}>
              <Button variant="ghost" size="icon-sm" aria-label={SYMBOLS[k].title} aria-pressed={on} className={cn('size-7 [&_.symp]:size-5!', on && 'bg-accent')}
                onClick={() => use({ place: k, title: SYMBOLS[k].title })}>
                <SymbolPreview kind={k} size="small" />
              </Button>
            </Tip>
          )
        })}
        <Sep />
        <BarBtn label="Rotate (Ctrl+R)" aria="Rotate" onClick={() => orient(true)}><RotateCw /></BarBtn>
        <BarBtn label="Mirror (Ctrl+E)" aria="Mirror" onClick={() => orient(false)}><FlipHorizontal2 /></BarBtn>
        <BarBtn label="Delete (Del)" aria="Delete" onClick={del} disabled={!sel.size}><Trash2 /></BarBtn>
        <BarBtn label="Undo (⌘Z)" aria="Undo" onClick={undo} disabled={!hist.current.undo.length}><Undo2 /></BarBtn>
        <BarBtn label="Redo (⇧⌘Z)" aria="Redo" onClick={redo} disabled={!hist.current.redo.length}><Redo2 /></BarBtn>
        <BarBtn label="Fit (F)" aria="Fit to window" onClick={() => fit()}><Maximize /></BarBtn>
        <Sep />
        <Tip label="Simulation setup (A)"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setDlg('analysis')}>Analysis…</Button></Tip>
        {overlay?.op && (
          <Tip label="Show DC operating point voltages">
            <Toggle size="sm" className="h-7 px-2 text-xs" pressed={showOp} onPressedChange={() => setShowOp((v) => !v)}>OP</Toggle>
          </Tip>
        )}
      </div>

      {one && (
        <div className={INSP} key={one.id}>
          <div className="text-xs font-semibold">{entry?.name ?? (one.sheet ? 'Sheet block' : SYMBOLS[one.kind].title)}</div>
          {entry && <div className={D}>{entry.description}</div>}
          {entry?.group && <div className={D}>From {entry.group} · {libKey(entry.id).replace(/^(proj|user):|^pack:[^/]*\//, '')}</div>}
          {one.lib && !entry && <div className={cn(D, 'text-warn')}>Unknown library part {one.lib}</div>}
          {!isFlag(one.kind) && (
            <Label className={FLD}>Name
              <Input className={cn('h-7 px-2', MONO)} value={one.name} spellCheck={false} onChange={(e) => edit(one, 'name', e.target.value)} onKeyDown={blurOnEnter} onBlur={() => (hist.current.merge = undefined)} />
            </Label>
          )}
          {one.sheet ? (
            <>
              <div className={D}>Sheet <code>{one.sheet}</code>{!blockSheet && <span className="text-warn"> · not in project</span>}</div>
              {stale && <div className={cn(D, 'text-warn')}>Ports changed: {stale.join(', ') || 'none'}</div>}
              <div className="flex flex-wrap gap-1.5">
                {onOpenSheet && <InspBtn onClick={() => onOpenSheet(one.sheet!)} disabled={!blockSheet}>Open sheet</InspBtn>}
                {stale && <InspBtn onClick={() => updateBlock(one, stale)}>Update pins</InspBtn>}
              </div>
            </>
          ) : (
            <>
              <Label className={FLD}>{one.kind === 'label' || one.kind === 'power' ? 'Net name' : one.kind === 'port' ? 'Port name' : 'Value'}
                <Input className={cn('h-7 px-2', MONO)} value={one.value} spellCheck={false} onChange={(e) => edit(one, 'value', e.target.value)} onKeyDown={blurOnEnter} onBlur={() => (hist.current.merge = undefined)} />
              </Label>
              {isSrc(one) && <Tip label="Edit DC, AC and the transient waveform"><InspBtn onClick={() => setSrcDlg(true)}>Waveform…</InspBtn></Tip>}
            </>
          )}
        </div>
      )}

      {dir && (
        <div className={INSP} key={dir.id}>
          <Label className={FLD}>SPICE directive
            <Textarea ref={ta} rows={6} value={dir.text} spellCheck={false} onChange={(e) => editText(dir.id, e.target.value)}
              className={cn('max-h-[50vh] min-h-[60px] resize-y overflow-x-auto px-2 py-1.5 leading-snug whitespace-pre [overflow-wrap:normal]', MONO)}
              onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()} onBlur={() => (hist.current.merge = undefined)} />
          </Label>
          {dirA && <InspBtn onClick={() => setDlg('edit')}>Edit as analysis…</InspBtn>}
          {optLine(dir.text) != null && <InspBtn onClick={() => setDlg('options')}>Edit options…</InspBtn>}
          {optLine(dir.text, 'ic') != null && <InspBtn onClick={() => setDlg('ic')}>Edit initial conditions…</InspBtn>}
          {optLine(dir.text, 'nodeset') != null && <InspBtn onClick={() => setDlg('nodeset')}>Edit nodeset…</InspBtn>}
        </div>
      )}

      <div className="sch-hint text-xs text-muted-foreground">{hint}</div>
      {/* portalled: panels beside the canvas would otherwise stack above the modal */}
      {dlg && createPortal(
        <AnalysisDialog initial={(dlg === 'edit' && dirA) || undefined} sources={sources} nets={[...new Set(Object.values(nl.nets).flat())].filter((n) => n !== '0').sort()}
          onApply={applyAnalysis} options={lineOf('options')} ic={lineOf('ic')} nodeset={lineOf('nodeset')} tran={sheet.texts.some((t) => /^\s*\.tran\b/im.test(t.text))} tab={dlg === 'analysis' || dlg === 'edit' ? undefined : dlg}
          onOptions={(line) => (setDlg(null), putOptions(line, false))} onClose={() => setDlg(null)} />, document.body
      )}
      {srcDlg && one && isSrc(one) && createPortal(
        <SourceDialog name={one.name} unit={one.kind === 'isrc' ? 'A' : 'V'} value={one.value} onClose={() => setSrcDlg(false)}
          onApply={(v) => (setSrcDlg(false), commit({ ...cur.current, parts: cur.current.parts.map((q) => (q.id === one.id ? { ...q, value: v } : q)) }))} />, document.body
      )}
    </div>
  )
}
