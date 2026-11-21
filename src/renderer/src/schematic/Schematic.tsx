import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKE, type MouseEvent as RME, type PointerEvent as RPE, type ComponentProps, type ReactNode, type Ref } from 'react'
import { GRID, blockShape, callout, junctions, reshapeBlocks, newPart, nextName, onSegment, parseSheet, pins, route, remap, same, snap, turnSeg, uid, sheetPorts, unconnectedPins, xform, type Directive, type Drawing, type Part, type Pt, type Sheet, type Wire } from './model'
import { PALETTE, SYMBOLS, isFlag, type Kind } from './symbols'
import { cleanUp as cleanSheet, clusters, flagAt, labelAt } from './cleanup'
import { MdEdit } from './MdEdit'
import { Callouts, DrawingEl, MD_BAN, dbox, moveD, NOTE, NOTE_SIZES, TB } from './drawings'
import { annotate, rewriteRefs, rewriteValue } from './annotate'
import { importSchematic } from './importer'
import { netlist, type NetCtx } from './netlist'
import { blockPartFields, libKey, type LibEntry } from '../library/library'
import { bodyBox, localBox, PinNames, SymBody, SymbolPreview, SymTexts, type Box } from '../library/Symbol'
import { symbolFields } from '../library/customSymbol'
import { LibraryPanel, sheetName, type LibPick, type SheetItem } from '../library/LibraryPanel'
import { analysisText, mergeOptions, parseAnalysis, setupKind, type Analysis, type SetupKind } from '../sim/analysis'
import { AnalysisDialog, type Tab } from '../sim/AnalysisDialog'
import { SourceDialog } from '../sim/SourceDialog'
import { keysOf, matches, useCommands } from '../commands'
import { keyLabel, Rail, RAILW } from '../layout/Panel'
import { prefs, usePrefs } from '../Preferences'
import { createPortal } from 'react-dom'
import { ChevronDown, Circle, Cpu, Crosshair, FlipHorizontal2, GripVertical, ListOrdered, Maximize, Plus, Settings2, X, MessageSquareText, Minus, MousePointer2, MoveUpRight, PanelBottom, PenLine, Redo2, RotateCw, Spline, Square, Trash2, Type, Undo2, Activity, Gauge, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tip'
import { ProbePlot, type ProbeMode, type ProbeSrc } from './ProbePlot'
import { seriesColor } from '../Plot'
import { cn } from '@/lib/utils'

export interface SchematicHandle {
  get(): Sheet; load(s: Sheet): void; replace(s: Sheet): void; select(ids: string[]): void
  addOptions(line: string): void // merge ".options a=1 b=2" into the sheet's .options card (or add one); undoable
  svg(): string // standalone, print-friendly SVG of the sheet
}
// net2: Alt+drag from one net to another = differential voltage v(net) - v(net2)
export type ProbeTarget = { net: string } | { net: string; net2: string } | { partId: string }
export type { ProbeSeries, ProbeSrc } from './ProbePlot'
// a probe plot (ProbePlot.tsx): its points on the sheet (what each probes, and where), and its card's place and size
// in sheet units, so it pans and zooms with the sheet like a part
type Probe = { id: string; pts: { id: string; t: ProbeTarget; at: Pt }[]; mode: ProbeMode; x: number; y: number; w: number; h: number }
const sameT = (a: ProbeTarget, b: ProbeTarget) => JSON.stringify(a) === JSON.stringify(b)
export interface Overlay {
  nets: Record<string, string[]> // from the last NetlistResult
  wireNets: Record<string, string>
  op?: Record<string, number> // net -> volts
  blame?: { parts: string[]; nets: string[] }
}

type ShapeTool = 'line' | 'arrow' | 'rect' | 'ellipse'
type Tool = 'select' | 'wire' | 'bus' | 'text' | 'note' | 'comment' | 'probe' | ShapeTool | { place: Kind; extra?: Partial<Part>; title: string; id?: string }
const SHAPES: { t: ShapeTool; title: string; icon: ReactNode }[] = [
  { t: 'line', title: 'Line', icon: <Minus /> }, { t: 'arrow', title: 'Arrow', icon: <MoveUpRight /> },
  { t: 'rect', title: 'Rectangle', icon: <Square /> }, { t: 'ellipse', title: 'Ellipse', icon: <Circle /> }
]
const isShape = (t: Tool): t is ShapeTool => typeof t === 'string' && SHAPES.some((s) => s.t === t)
const shapeName = (t: ShapeTool) => SHAPES.find((s) => s.t === t)!.title.toLowerCase()
type View = { x: number; y: number; k: number }
type Orient = Pick<Part, 'x' | 'y' | 'rot' | 'mirror'>
type Drag =
  | { t: 'pan'; cx: number; cy: number; v: View }
  | { t: 'move'; from: Pt; base: Sheet; sel: Set<string>; d: Pt; click?: string }
  | { t: 'box'; a: Pt; base: Set<string> }
  | { t: 'lbl'; id: string; k: 'lo' | 'vo'; from: Pt; base: Sheet; lo: Pt; moved: boolean } // dragging a part's name or value label
  | { t: 'diff'; net: string; a: Pt; cx: number; cy: number; click: ProbeTarget | null }

const KEYS = Object.fromEntries(Object.entries(SYMBOLS).flatMap(([k, d]) => (d.key ? [[d.key, k]] : []))) as Record<string, Kind>
const BAR_KINDS: Kind[] = [...PALETTE, 'bustap'] // the parts the toolbar can hold
const QUICK_LABEL: Partial<Record<Kind, string>> = { gnd: 'Ground', power: 'Power', label: 'Label', port: 'Port' } // short toolbar labels
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

const placed = (p: Part, b: Box) => norm(xform(p, { x: b.x0, y: b.y0 }), xform(p, { x: b.x1, y: b.y1 }))
const pbox = (p: Part) => placed(p, localBox(p.kind, p))

// Directive card box. ponytail: monospace estimate (char = 0.6em), not measured text
const LH = 12, CW = 6, PAD = 4
const lines = (t: Directive) => t.text.split('\n')
const tbox = (t: Directive): Box => {
  const l = lines(t)
  return { x0: t.x, y0: t.y, x1: t.x + Math.max(3, ...l.map((s) => s.length)) * CW + 2 * PAD, y1: t.y + l.length * LH + 2 * PAD - 2 }
}
const subset = (s: Sheet, ids: Set<string>, keep = true): Sheet => {
  const f = (i: { id: string }) => ids.has(i.id) === keep
  return { version: 1, parts: s.parts.filter(f), wires: s.wires.filter(f), texts: s.texts.filter(f), draw: (s.draw ?? []).filter(f), buses: (s.buses ?? []).filter(f) }
}
// What a comment's call-out arrow stops at: the part's body and its name / value labels, so the head never lands on a label.
// ponytail: label widths estimated (monospace, char = 0.6em of 9 px, like the export crop), whatever Settings › Label text size says
function aimBox(p: Part): Box {
  const b = placed(p, bodyBox(p.kind, p))
  if (isFlag(p.kind) || p.sheet) return pbox(p)
  const { n, v, anchor } = labelAt(pbox(p))
  const lb = ([x, y]: number[], t: string, o?: Pt) => { const w = Math.min(t.length, 16) * 5.4, l = x - (anchor === 'middle' ? w / 2 : 0) + (o?.x ?? 0), top = y - 8 + (o?.y ?? 0); return { x0: l, y0: top, x1: l + w, y1: top + 10 } }
  return [lb(n, p.name, p.lo), lb(v, p.value, p.vo)].reduce((r, q) => ({ x0: Math.min(r.x0, q.x0), y0: Math.min(r.y0, q.y0), x1: Math.max(r.x1, q.x1), y1: Math.max(r.y1, q.y1) }), b)
}
const corners = (b: Box) => [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }]
const count = (s: Sheet) => s.parts.length + s.wires.length + s.texts.length + (s.draw?.length ?? 0) + (s.buses?.length ?? 0)

function bounds(s: Sheet): Box | null {
  const pts = [...s.parts.flatMap((p) => corners(pbox(p))), ...s.wires.flatMap((w) => [w.a, w.b]), ...s.texts.flatMap((t) => corners(tbox(t))),
    ...(s.draw ?? []).flatMap((d) => corners(dbox(d))), ...(s.buses ?? []).flatMap((w) => [w.a, w.b])]
  if (!pts.length) return null
  return pts.reduce((b, q) => ({ x0: Math.min(b.x0, q.x), y0: Math.min(b.y0, q.y), x1: Math.max(b.x1, q.x), y1: Math.max(b.y1, q.y) }), norm(pts[0], pts[0]))
}

// Name/value text, drawn unrotated beside the part.
// ponytail: placement heuristic from the bbox aspect; no collision avoidance
const off = (o?: Pt) => (o ? `translate(${o.x} ${o.y})` : undefined)
function Texts({ p, sel }: { p: Part; sel?: Set<string> }) {
  const lc = (k: string) => (sel?.has(`${p.id}:${k}`) ? 'lbl on' : 'lbl')
  if (p.kind === 'gnd') return null
  const f = flagAt(p, pbox(p)) // cleanup.ts: a flag's one text (net label, port, power rail, bus tap), shared with Clean up
  if (f) return <text className="n" x={f.x} y={f.y} textAnchor={f.anchor}>{p.value}</text>
  const { n, v, anchor } = labelAt(pbox(p)) // cleanup.ts: shared with Clean up
  const val = p.sheet ? sheetName(p.sheet) : p.value
  return (
    <>
      {/* each label can be dragged on its own: data-l names the offset field it moves (Part.lo / Part.vo) */}
      <g className={lc('lo')} data-l="lo" transform={off(p.lo)}><text className="n" x={n[0]} y={n[1]} textAnchor={anchor}>{p.name}</text></g>
      {/* long values (PULSE(...)) are truncated on canvas; full text in the inspector + tooltip */}
      <g className={lc('vo')} data-l="vo" transform={off(p.vo)}>
        <text x={v[0]} y={v[1]} textAnchor={anchor}>
          <title>{p.sheet ?? p.value}</title>
          {val.length > 16 ? val.slice(0, 15) + '…' : val}
        </text>
      </g>
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

// a new comment block: a note with md set, its text markdown (md.ts)
const COMMENT = { text: '## Comment\nMarkdown: **bold**, *italic*, `code`\n- lists', md: true }

// export palette: black on white, sizes in world units (the export has no zoom)
const PRINT_CSS = [
  '.sym path,.sym circle{fill:none;stroke:#000;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}',
  '.sym .shade,.sym circle{fill:rgba(0,0,0,.07)}.sym .shade{stroke:none}.sym .f{fill:#000}.part{color:#000}',
  'text{font-family:ui-monospace,Menlo,Consolas,monospace}',
  '.part text{fill:#333;font-size:9px}.part text.n{fill:#000}.part text.pn{fill:#555}',
  '.wire line{stroke:#000;stroke-width:1.2;stroke-linecap:round}.jn{fill:#000}',
  '.dir rect{fill:#f7f7f7;stroke:#999;stroke-width:0.6}.dir text{fill:#000;font-size:10px;white-space:pre}',
  '.drw path{fill:none;stroke:#333;stroke-width:1;stroke-linecap:round;stroke-linejoin:round}.drw .f{fill:#333}.drw .hit,.drw .hitf{display:none}',
  '.drw text{fill:#222;white-space:pre}.drw.title text{font-size:9px}.drw.title .tt{font-size:13px;font-weight:600}.drw.title .lb{fill:#777;font-size:7px}',
  '.drw.md .bg{fill:#fafafa;stroke:#999;stroke-width:0.6}.drw.md .c{fill:#555}.drw.md path.ban{fill:#e6e6e6;stroke:none}.drw.md .bant{fill:#555}.drw.callout circle{fill:#333}',
  '.bus line{stroke:#000;stroke-width:3.5;stroke-linecap:round}.bjn{fill:#000}'
].join('')

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  return !!(t?.isContentEditable || t?.closest?.('input,textarea,select,.cm-editor'))
}
const blurOnEnter = (e: RKE<HTMLInputElement>) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()

// floating toolbar / inspector chrome (positions stay in schematic.css: they shift with the parts panel)
const Sep = () => <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-8" />
// toolbar button: icon over its label
const TBTN = "h-12 min-w-12 flex-col gap-1 px-2 text-[11px] leading-none font-normal text-muted-foreground [&_svg:not([class*='size-'])]:size-5"
// The toolbar's default tools, in order ('|' = separator). Settings keep a changed list (prefs.toolbar); the Edit button
// at its end reorders it and adds any other tool or part.
const DEFAULT_BAR = ['parts', '|', 'select', 'wire', 'text', 'probe', 'draw', '|', 'gnd', 'power', 'label', 'port', '|', 'rotate', 'mirror', 'delete', 'undo', 'redo', 'fit', 'cleanup', '|', 'analysis', 'op']
type BarTool = { label: string; tip: string; icon: ReactNode; run: () => void; on?: boolean; disabled?: boolean; aria?: string; hidden?: boolean }
const moved = <T,>(a: T[], from: number, to: number) => { const b = [...a]; b.splice(to, 0, ...b.splice(from, 1)); return b }
// Property popups remember, per kind and across sessions, where they were dragged to and the size their text box was
// dragged to. ponytail: no reset control; clear localStorage 'ngs.pops' (add a Settings button if anyone asks)
type PopKind = 'part' | 'dir' | 'note' | 'title'
type Kept = { left?: number; top?: number; w?: string; h?: string }
const POPS = 'ngs.pops'
const kept: Partial<Record<PopKind, Kept>> = (() => { try { return JSON.parse(localStorage.getItem(POPS) ?? '{}') ?? {} } catch { return {} } })()
const keep = (k: PopKind, v: Kept) => { kept[k] = { ...kept[k], ...v }; try { localStorage.setItem(POPS, JSON.stringify(kept)) } catch {} }
// a text box's own size, once its corner grip has been dragged (the browser writes it to the inline style)
const keptSize = (k: PopKind) => ({ style: { width: kept[k]?.w, height: kept[k]?.h },
  onPointerUp: (e: RPE<HTMLTextAreaElement>) => { const { width: w, height: h } = e.currentTarget.style; (w || h) && keep(k, { w, h }) } })
const INSP = 'sch-insp grid cursor-move gap-2 overflow-y-auto rounded-lg border bg-card p-2.5 text-card-foreground shadow-lg'
const FLD = 'grid gap-1 text-[11px] font-normal text-muted-foreground'
const D = 'text-[11px] leading-snug text-muted-foreground [&_code]:font-mono [&_code]:text-foreground'
const MONO = 'font-mono text-xs md:text-xs text-foreground'
const InspBtn = (p: ComponentProps<typeof Button>) => <Button size="sm" variant="outline" className="h-7 justify-self-start text-xs" {...p} />

export function Schematic({ active, initial, onDirty, ref, overlay, onProbe, probeSrc, library = [], browse, sheets = [], netCtx, onOpenSheet, libOpen: libProp, onLibOpen, name = 'schematic', sheetNo }: {
  active: boolean; initial: Sheet; onDirty: () => void; ref?: Ref<SchematicHandle>; overlay?: Overlay | null; onProbe?: (t: ProbeTarget, on: boolean) => void // a probe point was put on / taken off this sheet
  probeSrc?: ProbeSrc // what the probe plots show: the results tab in view
  library?: LibEntry[]; browse?: LibEntry[] /* Parts panel list, default library */; sheets?: SheetItem[]; netCtx?: NetCtx; onOpenSheet?: (file: string) => void
  libOpen?: boolean; onLibOpen?: (open: boolean) => void // parts panel, controlled by the workspace layout when given
  name?: string // export file stem
  sheetNo?: string // title block "sheet n of m"
}) {
  const [sheet, setSheet] = useState(initial)
  const [sel, setSel] = useState<Set<string>>(() => new Set())
  const [probes, setProbes] = useState<Probe[]>([])
  const [addTo, setAddTo] = useState<string | null>(null) // the probe plot that probe clicks add points to (its + button)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  // the property popup: opened by a double-click on a part, directive, note or title block, placed at that point
  const [pop, setPop] = useState<{ id: string; kind: PopKind; left: number; top: number } | null>(null)
  // where this kind of popup was last dragged to; otherwise beside the element (right of it, or left when there's no room). Kept inside the canvas
  function openPop(id: string) {
    const el = root.current?.querySelector(`[data-id="${id}"]`)
    if (!el || !root.current) return
    const r = root.current.getBoundingClientRect(), b = el.getBoundingClientRect(), W = 230 // .sch-insp width
    const right = b.right - r.left + 10, left = right + W + 8 <= r.width ? right : b.left - r.left - W - 10
    setSel(new Set([id]))
    const d = cur.current.draw?.find((x) => x.id === id), kind: PopKind = cur.current.texts.some((t) => t.id === id) ? 'dir' : d ? (d.t === 'title' ? 'title' : 'note') : 'part', k = kept[kind]
    setPop({ id, kind, left: Math.max(8, Math.min(k?.left ?? left, r.width - W - 8)), top: Math.max(8, Math.min(k?.top ?? b.top - r.top, r.height - (k?.top == null ? 220 : 60))) })
  }
  // the popup's (or the comment block's own) text box takes the keyboard: a just-placed item's starter text is selected, so
  // typing replaces it; otherwise the caret goes to the end
  const fresh = useRef(false)
  useEffect(() => {
    const t = pop && ta.current
    if (t) t.focus(), fresh.current ? t.select() : t.setSelectionRange(t.value.length, t.value.length)
    fresh.current = false
  }, [pop?.id])
  // a popup wider than the 230 px openPop assumed (a directive's is as wide as its text, and grows as you type): back
  // inside the canvas. Every render: one measurement, and it only moves a popup that sticks out
  useLayoutEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('.sch-insp'), w = root.current?.clientWidth
    if (pop && el && w && pop.left > 8 && pop.left + el.offsetWidth > w - 8) setPop({ ...pop, left: Math.max(8, w - el.offsetWidth - 8) })
  })
  // the popup moves by dragging anywhere on it that isn't a control; kept inside the canvas
  function dragPop(e: RPE<HTMLDivElement>) {
    if (!pop || e.button !== 0 || (e.target as Element).closest('input,textarea,button,select,a,[role=combobox]')) return
    const el = e.currentTarget, box = root.current!, { id, kind } = pop, dx = e.clientX - pop.left, dy = e.clientY - pop.top
    let at: Kept | undefined
    const mv = (m: PointerEvent) => setPop({ id, kind, ...(at = { left: Math.max(8, Math.min(m.clientX - dx, box.clientWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(m.clientY - dy, box.clientHeight - 60)) }) } as NonNullable<typeof pop>)
    const end = () => (at && keep(kind, at), el.removeEventListener('pointermove', mv), el.removeEventListener('pointerup', end), el.removeEventListener('pointercancel', end))
    el.setPointerCapture(e.pointerId)
    el.addEventListener('pointermove', mv), el.addEventListener('pointerup', end), el.addEventListener('pointercancel', end)
  }
  // right-click menu: at the pointer; on an item outside the selection it selects that item first
  const [menu, setMenu] = useState<{ left: number; top: number; id?: string } | null>(null)
  function context(e: RME) {
    e.preventDefault()
    drag.current = null, setBox(null) // a Ctrl+click (macOS) also pressed the left button
    if (tool !== 'select') return use('select') // right-click leaves the current tool, like Esc
    const id = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-id]')?.getAttribute('data-id') ?? undefined
    if (id && !sel.has(id)) setSel(new Set([id]))
    const r = root.current!.getBoundingClientRect()
    setMenu({ left: e.clientX - r.left, top: e.clientY - r.top, id })
  }
  // Align / distribute the selection by its boxes. A selection that falls into separate groups (clusters: things
  // touching or a grid step apart, so a part with its wires, labels and cards) moves each group as one, lined up on the
  // other groups; one group alone has its parts and directive cards lined up one by one. Every move is a whole number
  // of grid steps, so pins stay on the grid; wires follow as they do in a drag (remap).
  // Clean up (cleanup.ts): the whole sheet is spread out, its wires tidied and its labels placed; with parts selected,
  // only their labels move.
  function cleanUp() {
    const s = cur.current, ids = new Set(s.parts.filter((p) => sel.has(p.id)).map((p) => p.id))
    const next = cleanSheet(s, { pbox, body: (p) => placed(p, bodyBox(p.kind, p)), tbox, dbox }, ids.size ? ids : undefined)
    if (next !== s) commit(next)
  }
  type Edge = 'left' | 'right' | 'top' | 'bottom' | 'cx' | 'cy' | 'dx' | 'dy'
  function align(m: Edge) {
    const s0 = cur.current, on = (i: { id: string }) => sel.has(i.id), seg = (w: Wire) => ({ id: w.id, b: norm(w.a, w.b) })
    const solo = [...s0.parts.filter(on).map((p) => ({ id: p.id, b: pbox(p) })), ...s0.texts.filter(on).map((t) => ({ id: t.id, b: tbox(t) }))]
    const dist = m === 'dx' || m === 'dy'
    const groups = clusters([...solo, ...s0.wires.filter(on).map(seg), ...(s0.buses ?? []).filter(on).map(seg), ...(s0.draw ?? []).filter(on).map((d) => ({ id: d.id, b: dbox(d) }))], GRID)
    const items = (groups.length >= (dist ? 3 : 2) ? groups : solo.map((i) => [i])).map((g) => ({
      ids: new Set(g.map((i) => i.id)),
      b: { x0: Math.min(...g.map((i) => i.b.x0)), y0: Math.min(...g.map((i) => i.b.y0)), x1: Math.max(...g.map((i) => i.b.x1)), y1: Math.max(...g.map((i) => i.b.y1)) }
    }))
    if (items.length < 2) return
    const x = m === 'left' || m === 'right' || m === 'cx' || m === 'dx', mid = (b: Box) => (x ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2)
    const lo = Math.min(...items.map((i) => (x ? i.b.x0 : i.b.y0))), hi = Math.max(...items.map((i) => (x ? i.b.x1 : i.b.y1)))
    const sorted = [...items].sort((a, b) => mid(a.b) - mid(b.b)), first = mid(sorted[0].b), step = (mid(sorted.at(-1)!.b) - first) / (sorted.length - 1)
    let s = s0
    for (const i of items) {
      const want = m === 'left' || m === 'top' ? lo - (x ? i.b.x0 : i.b.y0) : m === 'right' || m === 'bottom' ? hi - (x ? i.b.x1 : i.b.y1)
        : m === 'cx' || m === 'cy' ? (lo + hi) / 2 - mid(i.b) : first + sorted.indexOf(i) * step - mid(i.b)
      const d = x ? { x: snap(want), y: 0 } : { x: 0, y: snap(want) }, mine = (q: { id: string }) => i.ids.has(q.id)
      if (!d.x && !d.y) continue
      const r = remap(s, i.ids, (q) => ({ ...q, ...add(q, d) }), (q) => add(q, d))
      s = {
        ...r, texts: r.texts.map((t) => (mine(t) ? { ...t, ...add(t, d) } : t)),
        ...(r.draw && { draw: r.draw.map((q) => (mine(q) ? moveD(q, d) : q)) }),
        ...(r.buses && { buses: r.buses.map((w) => (mine(w) ? { ...w, a: add(w.a, d), b: add(w.b, d) } : w)) })
      }
    }
    if (s !== s0) commit({ ...s, wires: s.wires.filter((w) => !same(w.a, w.b)) })
  }
  useEffect(() => setPop(null), [view]) // ponytail: it doesn't follow a pan or zoom, it closes
  useEffect(() => { pop && !sel.has(pop.id) && setPop(null) }, [sel]) // closes when its element is no longer the selection
  const [tool, setTool] = useState<Tool>('select')
  const [ghost, setGhost] = useState({ rot: 0, mirror: false })
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [start, setStart] = useState<Pt | null>(null)
  const [pinFor, setPinFor] = useState<string | null>(null) // the comment block whose call-out arrows are being picked: a click on a part adds or removes one
  const [vFirst, setVFirst] = useState(false)
  const [box, setBox] = useState<Box | null>(null)
  const [space, setSpace] = useState(false)
  const [hov, setHov] = useState<ProbeTarget | null>(null)
  const [drawOpen, setDrawOpen] = useState(false), drawTimer = useRef(0), [dragI, setDragI] = useState<number | null>(null) // toolbar: the Draw menu's hover, the tool dragged while editing it
  const [editBar, setEditBar] = useState(false), [overI, setOverI] = useState<number | null>(null) // the toolbar is being edited (its Edit panel is open): its buttons drag to reorder; the one under the drag
  const { showOp: opPref, gridStyle, toolbar: savedBar } = usePrefs() // Settings › Schematic; the OP toggle overrides showOp per canvas (usePrefs also re-renders on a changed shortcut)
  const kl = (id: string) => { const k = keysOf(id); return k ? ` (${keyLabel(k)})` : '' } // live shortcut hint for a tooltip
  const [showOp, setShowOp] = useState(opPref)
  useEffect(() => setShowOp(opPref), [opPref])
  const [dlg, setDlg] = useState<Tab | 'analysis' | 'edit' | null>(null) // analysis dialog open, on this tab ('edit': rewrite the selected card)
  const [srcDlg, setSrcDlg] = useState(false)
  const [band, setBand] = useState<{ a: Pt; b: Pt } | null>(null) // differential probe rubber band
  const [report, setReport] = useState<{ title: string; summary: string; lines: string[] } | null>(null) // File › Import Schematic…
  const modal = !!dlg || srcDlg || !!report
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
  // The toolbar never wraps: when the canvas is narrower than it, it is scaled down to fit (to half size at most).
  // offsetWidth is its full-size width whatever the scale; `left` is its inset (36 / 248 px beside the parts panel), 8 px on the right.
  useEffect(() => {
    const fit = () => {
      const b = bar.current, r = root.current
      if (!b || !r) return
      const k = Math.max(0.5, Math.min(1, (r.clientWidth - parseFloat(getComputedStyle(b).left) - 8) / b.offsetWidth))
      b.style.transform = k < 1 ? `scale(${k})` : ''
    }
    const ro = new ResizeObserver(fit)
    ro.observe(bar.current!), ro.observe(root.current!)
    fit() // the parts panel opened or closed: the inset changed, the sizes didn't
    return () => ro.disconnect()
  }, [libOpen])
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

  // ---- probe plots ----
  const editProbe = (id: string, f: (p: Probe) => Probe | null) => setProbes((ps) => ps.flatMap((p) => (p.id === id ? (f(p) ?? []) : [p])))
  useEffect(() => { if (tool !== 'probe') setAddTo(null) }, [tool]) // Esc / another tool ends "add points"
  // a probe click: another point for the plot that is collecting them; else the same thing again takes its plot
  // away; else a new plot beside the point, clear of the others
  function probed(t: ProbeTarget, at: Pt) {
    const into = probes.find((p) => p.id === addTo), dup = !into && probes.find((p) => p.pts.length === 1 && sameT(p.pts[0].t, t))
    if (into) editProbe(into.id, (p) => ({ ...p, pts: [...p.pts, { id: uid(), t, at }] }))
    else if (dup) setProbes((ps) => ps.filter((p) => p !== dup))
    else {
      // sheet units throughout: s = screen px as sheet units, [x0, y0]…[x1, y1] = the part of the sheet in view
      const r = svg.current!.getBoundingClientRect(), w = 270, h = 160, s = 1 / view.k, x0 = -view.x * s, y0 = -view.y * s, x1 = x0 + r.width * s, y1 = y0 + r.height * s
      const fit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
      const b = { x: fit(at.x + 24 * s, x0 + 8 * s, x1 - w - 8 * s), y: fit(at.y - 24 * s - h, y0 + 64 * s, y1 - h - 8 * s) }
      if (at.x > b.x - 8 * s && at.x < b.x + w + 8 * s && at.y > b.y - 8 * s && at.y < b.y + h + 8 * s) b.y = fit(at.y + 24 * s, y0 + 64 * s, y1 - h - 8 * s) // it would cover its own point: below it
      for (let i = 0, hit; i < 8 && (hit = probes.find((o) => b.x < o.x + o.w && o.x < b.x + w && b.y < o.y + o.h && o.y < b.y + h)); i++) (b.x = hit.x + 28 * s), (b.y = hit.y + 28 * s) // cascade off the ones in the way
      setProbes((ps) => [...ps, { id: uid(), pts: [{ id: uid(), t, at }], mode: 'all', ...b, w, h }])
    }
    onProbe?.(t, !dup)
  }
  // drag a probe point to another wire or part: it probes what it is dropped on (dropped on nothing, it goes back)
  function dragDot(e: RPE<SVGCircleElement>, p: Probe, i: number) {
    if (e.button !== 0 || space) return
    e.stopPropagation()
    const g = e.currentTarget, old = p.pts[i], put = (pt: Probe['pts'][0]) => editProbe(p.id, (q) => ({ ...q, pts: q.pts.map((o) => (o.id === old.id ? pt : o)) }))
    g.setPointerCapture(e.pointerId)
    g.onpointermove = (m) => put({ ...old, at: world(m) })
    g.onpointerup = g.onpointercancel = (m) => {
      g.onpointermove = g.onpointerup = g.onpointercancel = null
      g.style.pointerEvents = 'none' // hit-test what is under the dot
      const el = document.elementFromPoint(m.clientX, m.clientY), on = !!el && svg.current!.contains(el), w = world(m), net = on ? netAt(w, el) : null
      g.style.pointerEvents = ''
      const t = (on && probeAt(el!)) || (net && net !== '0' ? { net } : null)
      if (!t || m.type === 'pointercancel') return put(old)
      put({ id: old.id, t, at: w })
      if (!sameT(t, old.t)) onProbe?.(old.t, false), onProbe?.(t, true)
    }
  }
  const moveCard = (e: RPE<HTMLDivElement>, p: Probe) => {
    if (e.button !== 0) return
    const g = e.currentTarget, k = view.k, sx = e.clientX / k - p.x, sy = e.clientY / k - p.y
    g.setPointerCapture(e.pointerId)
    g.onpointermove = (m) => editProbe(p.id, (q) => ({ ...q, x: m.clientX / k - sx, y: m.clientY / k - sy }))
    g.onpointerup = g.onpointercancel = () => (g.onpointermove = null)
  }
  const dropProbe = (p: Probe, pts = p.pts) => (pts.forEach((q) => onProbe?.(q.t, false)), editProbe(p.id, (q) => (pts.length === q.pts.length ? null : { ...q, pts: q.pts.filter((o) => !pts.includes(o)) })))
  // each point's trace, from the results on show; sheet: an edit can rename the net under a point
  const probeData = useMemo(() => {
    const all = probes.flatMap((p) => p.pts), got = probeSrc?.of(all.map((q) => q.t)) ?? []
    return new Map(all.map((q, i) => [q.id, got[i] ?? { key: null, label: 'net' in q.t ? `V(${q.t.net})` : '…', unit: '' }]))
  }, [probes, probeSrc, sheet])

  function use(t: Tool) {
    setTool(t)
    setPinFor(null)
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
    Object.assign(extra, symbolFields(e)) // the custom symbol drawn in the symbol editor, if any
    use({ place: e.kind, title: e.name, id: e.id, extra })
  }
  const picked = () => subset(cur.current, sel)
  const all = (s: Sheet) => [...s.parts, ...s.wires, ...s.texts, ...(s.draw ?? []), ...(s.buses ?? [])].map((i) => i.id)
  function orient(rot: boolean) {
    const f = <T extends { rot: number; mirror: boolean }>(p: T): T => (rot ? { ...p, rot: (p.rot + 1) % 4 } : { ...p, mirror: !p.mirror })
    if (typeof tool === 'object') return setGhost(f)
    const s = cur.current, k = picked()
    if (count(k) > 1) {
      // several things: the selection turns (or flips left-right) as one about its grid-snapped centre, so everything in
      // it stays joined up; wires leaving the selection stretch after it (remap). Cards and notes stay upright and move.
      // ponytail: the centre is re-snapped each time, so an odd-sized selection can creep a grid step over four turns
      const bs = [...k.parts.map(pbox), ...[...k.wires, ...k.buses!].map((w) => norm(w.a, w.b)), ...k.texts.map(tbox), ...k.draw!.map(dbox)]
      const c = { x: snap((Math.min(...bs.map((b) => b.x0)) + Math.max(...bs.map((b) => b.x1))) / 2), y: snap((Math.min(...bs.map((b) => b.y0)) + Math.max(...bs.map((b) => b.y1))) / 2) }
      const g = (q: Pt): Pt => (rot ? { x: c.x - (q.y - c.y) + 0, y: c.y + (q.x - c.x) + 0 } : { x: 2 * c.x - q.x + 0, y: q.y })
      const box = <T extends Pt>(t: T, b: Box): T => { const m = g({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }); return { ...t, x: snap(t.x + m.x - (b.x0 + b.x1) / 2), y: snap(t.y + m.y - (b.y0 + b.y1) / 2) } }
      const seg = <T extends { a: Pt; b: Pt }>(w: T): T => ({ ...w, a: g(w.a), b: g(w.b) })
      // a flip seen from the sheet: the part is mirrored and its turn reversed
      const r = remap(s, sel, (p) => ({ ...p, ...g(p), ...(rot ? { rot: (p.rot + 1) % 4 } : { mirror: !p.mirror, rot: (4 - (p.rot % 4)) % 4 }) }), g)
      return commit({
        ...r, wires: r.wires.filter((w) => !same(w.a, w.b)), texts: r.texts.map((t) => (sel.has(t.id) ? box(t, tbox(t)) : t)),
        ...(r.draw && { draw: r.draw.map((d) => (!sel.has(d.id) ? d : 'a' in d ? seg(d) : d.t === 'poly' ? { ...d, pts: d.pts.map(g) } : box(d, dbox(d)))) }),
        ...(r.buses && { buses: r.buses.map((w) => (sel.has(w.id) ? seg(w) : w)) })
      })
    }
    if (!k.parts.length && !k.draw!.some((d) => 'a' in d) && !k.buses!.length) return
    const r = k.parts.length ? remap(s, sel, f) : s
    commit({
      ...r, ...(r.draw && { draw: r.draw.map((d) => (sel.has(d.id) && 'a' in d ? turnSeg(d, rot) : d)) }),
      ...(r.buses && { buses: r.buses.map((w) => (sel.has(w.id) ? turnSeg(w, rot) : w)) })
    })
  }
  function del() {
    if (!sel.size) return
    commit({ ...cur.current, ...subset(cur.current, sel, false) })
    setSel(new Set())
  }
  // Pastes c offset by +20 with fresh ids/names, selects it, and returns what was pasted (so repeated ⌘V cascades).
  function paste(c: Sheet | null): Sheet | null {
    if (!c || !count(c)) return c
    const s = cur.current
    const next: Sheet = { ...s, parts: [...s.parts], wires: [...s.wires], texts: [...s.texts], draw: [...(s.draw ?? [])], buses: [...(s.buses ?? [])] }
    const out: Sheet = { version: 1, parts: [], wires: [], texts: [], draw: [], buses: [] }
    for (const d of c.draw ?? []) {
      if (d.t === 'title' && next.draw!.some((x) => x.t === 'title')) continue // one title block per sheet
      const n = { ...moveD(d, { x: 20, y: 20 }), id: uid() }
      next.draw!.push(n), out.draw!.push(n)
    }
    for (const w of c.buses ?? []) {
      const n = { id: uid(), a: add(w.a, { x: 20, y: 20 }), b: add(w.b, { x: 20, y: 20 }) }
      next.buses!.push(n), out.buses!.push(n)
    }
    const off = (q: Pt) => add(q, { x: 20, y: 20 }), ids = new Map<string, string>()
    for (const p of c.parts) {
      const pre = SYMBOLS[p.kind].prefix
      const n = { ...p, ...off(p), id: uid(), name: pre ? nextName(next, pre) : p.name }
      next.parts.push(n), out.parts.push(n), ids.set(p.id, n.id)
    }
    // a pasted comment block points at the copies of its parts pasted with it (and still at the originals of the rest)
    for (const d of out.draw!) if (d.t === 'note' && d.pins) d.pins = d.pins.map((x) => ids.get(x) ?? x)
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
    if (editBar) return setEditBar(false)
    if (pinFor) return setPinFor(null)
    if (pop) return setPop(null)
    if (start) setStart(null)
    else if (tool !== 'select') use('select')
    else setSel(new Set())
  }

  // the canvas' changeable shortcuts (shortcuts.ts ids; Settings › Keyboard shortcuts)
  const HOT: [string, () => void][] = [
    ['edit.rotate', () => orient(true)], ['edit.mirror', () => orient(false)], ['edit.duplicate', () => void paste(picked())],
    ['place.wire', () => use('wire')], ['place.bus', () => use('bus')], ['place.directive', () => use('text')], ['place.note', () => use('note')], ['place.comment', () => use('comment')],
    ['sim.probe', () => use('probe')], ['sim.setup', () => setDlg('analysis')], ['view.fit', () => fit()], ['view.partsToggle', () => toggleLib()],
    ['place.fromLibrary', () => (toggleLib(true), setTimeout(() => search.current?.focus()))],
    ...Object.values(KEYS).map((kind): [string, () => void] => ['place.' + kind, () => use({ place: kind, title: SYMBOLS[kind].title })])
  ]
  const hot = (e: KeyboardEvent) => { const h = HOT.find(([id]) => { const keys = keysOf(id); return keys && matches(keys, e) }); h?.[1](); return !!h }
  function onKey(e: KeyboardEvent) {
    if (!active || modal || typing(e)) return
    const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey
    // A properties popup (or a comment block's editor) is open but the keyboard isn't in a field: a click on the popup or
    // the toolbar took it. Plain keys are then never tool hotkeys or Delete: a character goes back into the text box.
    if (pop && !mod && k !== 'escape') {
      if (e.key.length === 1) (ta.current ?? root.current?.querySelector<HTMLElement>('.mded .ed'))?.focus()
      return
    }
    let done = true
    if (k === ' ') setSpace(true)
    else if (mod && k === 'z') e.shiftKey ? redo() : undo()
    else if (mod && k === 'y') redo()
    else if (mod && k === 'c') clip.current = picked()
    else if (mod && k === 'x') cut()
    else if (mod && k === 'v') clip.current = paste(clip.current)
    else if (mod && k === 'a') setSel(new Set(all(cur.current)))
    else if (k === 'escape' && !mod && !e.altKey) esc()
    else if (mod || e.altKey) done = hot(e) // a changed shortcut may use a modifier
    else if (k === 'enter' && sel.size === 1) openPop([...sel][0])
    else if (k === 'delete' || k === 'backspace') del()
    else if (k === '/' && (tool === 'wire' || tool === 'bus')) setVFirst((v) => !v)
    else if (k === '+' || k === '=') zoomBy(1.25)
    else if (k === '-') zoomBy(0.8)
    else done = hot(e)
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
    if (e.ctrlKey || (prefs().wheel === 'zoom' && !e.shiftKey)) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(Math.max(-50, Math.min(50, -e.deltaY)) * (e.ctrlKey ? 0.01 : 0.002))) // Settings › Schematic: the wheel zooms (Shift+wheel still pans)
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
  const some = (s: Sheet | null) => !!s && count(s) > 0
  const titleOf = (s: Sheet) => s.draw?.find((d) => d.t === 'title')
  // title block on/off; it goes under the drawing's bottom-right corner
  function toggleTitle() {
    const s = cur.current, t = titleOf(s)
    if (t) return void (commit({ ...s, draw: s.draw!.filter((d) => d !== t) }), setSel(new Set()))
    const b = bounds(s) ?? { x0: 0, y0: 0, x1: TB.w, y1: 0 }
    const d: Drawing = { id: uid(), t: 'title', x: snap(b.x1 - TB.w), y: snap(b.y1 + 30), title: name, author: '', date: new Date().toISOString().slice(0, 10), rev: 'A' }
    commit({ ...s, draw: [...(s.draw ?? []), d] })
    show([d.id])
  }
  const orientable = () => { const k = picked(); return typeof tool === 'object' || k.parts.length > 0 || k.draw!.some((d) => 'a' in d) || k.buses!.length > 0 }
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
    { id: 'place.bus', run: () => use('bus') },
    { id: 'place.bustap', run: () => use({ place: 'bustap', title: SYMBOLS.bustap.title }) },
    { id: 'place.directive', run: () => use('text') },
    { id: 'place.note', run: () => use('note') },
    { id: 'place.comment', run: () => use('comment') },
    ...SHAPES.map(({ t }) => ({ id: 'place.' + t, run: () => use(t) })),
    { id: 'place.titleBlock', run: toggleTitle, checked: () => !!titleOf(cur.current) },
    { id: 'file.import', run: () => void importFile() },
    { id: 'tools.annotateSheet', run: () => { const r = annotate([cur.current]); if (r.renamed) commit(r.sheets[0]) }, enabled: () => cur.current.parts.length > 0 },
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

  // bus: the same, into sheet.buses; it ends on another bus
  function wireClick(p: Pt, bus = false) {
    if (!start) return setStart(p)
    if (same(p, start)) return
    const s = cur.current, on = (w: { a: Pt; b: Pt }) => same(w.a, p) || same(w.b, p) || onSegment({ id: '', ...w }, p)
    const hit = bus ? (s.buses ?? []).some(on) : s.parts.some((q) => pins(q).some((r) => same(r, p))) || s.wires.some(on)
    commit(bus ? { ...s, buses: [...(s.buses ?? []), ...route(start, p, vFirst)] } : { ...s, wires: [...s.wires, ...route(start, p, vFirst)] })
    setStart(hit ? null : p)
  }

  function down(e: RPE<SVGSVGElement>) {
    if (e.button === 1 || (e.button === 0 && space)) {
      e.preventDefault()
      drag.current = { t: 'pan', cx: e.clientX, cy: e.clientY, v: view }
      return e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (e.button !== 0) return
    if (editBar) setEditBar(false)
    const w = world(e), p = snapPt(w), s = cur.current
    if (pinFor) {
      // a click on a part points the comment at it, or stops pointing at it; a click anywhere else ends the picking
      const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id')
      if (!s.parts.some((q) => q.id === id)) return setPinFor(null)
      return commit({ ...s, draw: s.draw?.map((d) => (d.id === pinFor && d.t === 'note' ? { ...d, pins: d.pins?.includes(id!) ? d.pins.filter((x) => x !== id) : [...(d.pins ?? []), id!] } : d)) })
    }
    if (tool === 'probe' || (tool === 'select' && e.altKey)) {
      // a net (wire, flag or pin) may start a differential drag; a click without dragging probes as before
      const t = probeAt(e.target as Element), net = netAt(w, e.target as Element)
      if (net == null) return void (t && probed(t, w))
      drag.current = { t: 'diff', net, a: w, cx: e.clientX, cy: e.clientY, click: t }
      return e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (tool === 'wire' || tool === 'bus') return wireClick(p, tool === 'bus')
    if (isShape(tool)) {
      if (!start) return setStart(p)
      if (same(p, start)) return
      commit({ ...s, draw: [...(s.draw ?? []), { id: uid(), t: tool, a: start, b: p }] })
      return setStart(tool === 'line' ? p : null) // lines chain into a polyline until Esc / double-click
    }
    if (tool === 'note' || tool === 'comment') {
      const d: Drawing = { id: uid(), t: 'note', x: p.x, y: p.y, ...(tool === 'note' ? { text: 'Note' } : COMMENT) }
      commit({ ...s, draw: [...(s.draw ?? []), d] })
      setSel(new Set([d.id]))
      use('select')
      setTimeout(() => ((fresh.current = true), openPop(d.id))) // after mousedown's default focus change, once the note is drawn
      return
    }
    if (tool === 'text') {
      const t = { id: uid(), x: p.x, y: p.y, text: '.op' }
      commit({ ...s, texts: [...s.texts, t] })
      setSel(new Set([t.id]))
      use('select')
      setTimeout(() => ((fresh.current = true), openPop(t.id))) // after mousedown's default focus change, once the card is drawn
      return
    }
    if (typeof tool === 'object') return commit({ ...s, parts: [...s.parts, newPart(s, tool.place, p.x, p.y, ghost.rot, ghost.mirror, tool.extra)] })
    e.currentTarget.setPointerCapture(e.pointerId)
    const pid = (e.target as Element).closest('[data-id]')?.getAttribute('data-id')
    if (!pid) {
      if (!e.shiftKey) setSel(new Set())
      drag.current = { t: 'box', a: w, base: e.shiftKey ? sel : new Set() }
      return
    }
    const lk = e.shiftKey ? null : ((e.target as Element).closest('.lbl')?.getAttribute('data-l') as 'lo' | 'vo' | null | undefined)
    const lp = lk ? s.parts.find((q) => q.id === pid) : undefined
    const lid = lk && lp ? `${lp.id}:${lk}` : null // a label's selection id (box select picks labels up too)
    if (lk && lp && !sel.has(lid!)) return void (drag.current = { t: 'lbl', id: lp.id, k: lk, from: w, base: s, lo: lp[lk] ?? { x: 0, y: 0 }, moved: false })
    const id = lid ?? pid
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
    else if (d.t === 'lbl') {
      const h = GRID / 2, lo = { x: d.lo.x + Math.round((w.x - d.from.x) / h) * h, y: d.lo.y + Math.round((w.y - d.from.y) / h) * h } // half-grid steps
      if (!d.moved && same(lo, d.lo)) return
      d.moved = true
      live({ ...d.base, parts: d.base.parts.map((q) => (q.id === d.id ? { ...q, [d.k]: lo.x || lo.y ? lo : undefined } : q)) })
    }
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
      const lab = (q: Part, k: 'lo' | 'vo') => { const o = add(q[k] ?? { x: 0, y: 0 }, dd); return o.x || o.y ? o : undefined }
      live({
        ...r, parts: r.parts.map((q) => (d.sel.has(q.id) || !(d.sel.has(q.id + ':lo') || d.sel.has(q.id + ':vo')) ? q
          : { ...q, ...(d.sel.has(q.id + ':lo') && { lo: lab(q, 'lo') }), ...(d.sel.has(q.id + ':vo') && { vo: lab(q, 'vo') }) })),
        texts: r.texts.map((t) => (d.sel.has(t.id) ? { ...t, ...add(t, dd) } : t)),
        ...(r.draw && { draw: r.draw.map((x) => (d.sel.has(x.id) ? moveD(x, dd) : x)) }),
        ...(r.buses && { buses: r.buses.map((w) => (d.sel.has(w.id) ? { ...w, a: add(w.a, dd), b: add(w.b, dd) } : w)) })
      })
    }
  }
  function up(e: RPE<SVGSVGElement>) {
    const d = drag.current
    drag.current = null
    if (d?.t === 'diff') {
      setBand(null)
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 4) return void (d.click && probed(d.click, d.a))
      const n2 = netAt(world(e), document.elementFromPoint(e.clientX, e.clientY))
      if (n2 == null || n2 === d.net) return
      // ground as either end is just the other net's voltage
      probed(d.net === '0' ? { net: n2 } : n2 === '0' ? { net: d.net } : { net: d.net, net2: n2 }, world(e))
    } else if (d?.t === 'box') {
      setBox(null)
      const b = norm(d.a, world(e))
      if (b.x1 - b.x0 + b.y1 - b.y0 < 4 / view.k) return
      // everything the box touches, not only what it encloses. ponytail: by bounding box, so a diagonal wire or line is
      // caught by a box crossing its bounds without touching the stroke; segment test if that gets in the way
      const hit = (o: Box) => o.x0 <= b.x1 && b.x0 <= o.x1 && o.y0 <= b.y1 && b.y0 <= o.y1
      const s = cur.current
      const hits = [
        ...s.parts.filter((p) => hit(pbox(p))),
        ...s.wires.filter((w) => hit(norm(w.a, w.b))),
        ...s.texts.filter((t) => hit(tbox(t))),
        ...(s.draw ?? []).filter((x) => hit(dbox(x))),
        ...(s.buses ?? []).filter((w) => hit(norm(w.a, w.b)))
      ]
      const labels = [...(svg.current?.querySelectorAll('.part .lbl') ?? [])].flatMap((g) => {
        const r = g.getBoundingClientRect(), id = g.closest('[data-id]')?.getAttribute('data-id')
        return id && r.width && hit(norm(world({ clientX: r.left, clientY: r.top }), world({ clientX: r.right, clientY: r.bottom }))) ? [`${id}:${g.getAttribute('data-l')}`] : []
      })
      setSel(new Set([...d.base, ...hits.map((i) => i.id), ...labels]))
    } else if (d?.t === 'lbl') {
      if (d.moved) commit(cur.current, undefined, d.base)
      else setSel(new Set([d.id]))
    } else if (d?.t === 'move') {
      if (d.d.x || d.d.y) commit({ ...cur.current, wires: cur.current.wires.filter((w) => !same(w.a, w.b)) }, undefined, d.base)
      else if (d.click) setSel(new Set([d.click]))
    }
  }

  function dbl(e: RME) {
    if (tool === 'wire' || tool === 'bus' || isShape(tool)) return setStart(null)
    // pointer capture from pointerdown retargets dblclick to the <svg>: hit-test the point instead
    const id = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-id]')?.getAttribute('data-id')
    const p = cur.current.parts.find((q) => q.id === id)
    if (p?.sheet && onOpenSheet) return onOpenSheet(p.sheet)
    if (id) openPop(id)
  }
  // File › Import Schematic…: the converted sheet goes to the right of the drawing, selected; clashing names get the next free one
  async function importFile() {
    const f = await window.api.importFile()
    if (!f) return
    const file = f.path.split(/[\\/]/).pop()!
    let r: ReturnType<typeof importSchematic>
    try {
      r = importSchematic(f.path, f.text)
    } catch (e) {
      return setReport({ title: `Can't import ${file}`, summary: String((e as Error)?.message ?? e), lines: [] })
    }
    const s = cur.current, b = bounds(s), ib = bounds(r.sheet), d0 = b && ib ? { x: snap(b.x1 + 80 - ib.x0), y: snap(b.y0 - ib.y0) } : { x: 0, y: 0 }
    const d = Number.isFinite(d0.x) && Number.isFinite(d0.y) ? d0 : { x: 0, y: 0 }
    const next: Sheet = { ...s, parts: [...s.parts] }, ren = new Map<string, string>()
    for (const p of r.sheet.parts) {
      const clash = p.name && next.parts.some((q) => q.name.toLowerCase() === p.name.toLowerCase()), name = clash ? nextName(next, p.name.replace(/\d+$/, '')) : p.name
      if (clash) ren.set(p.name.toLowerCase(), name)
      next.parts.push({ ...p, ...add(p, d), name })
    }
    const m = r.sheet
    if (ren.size) next.parts = next.parts.map((p, i) => (i < s.parts.length || isFlag(p.kind) ? p : { ...p, value: rewriteValue(p, ren) }))
    next.wires = [...s.wires, ...m.wires.map((w) => ({ ...w, a: add(w.a, d), b: add(w.b, d) }))]
    next.texts = [...s.texts, ...m.texts.map((t) => ({ ...t, ...add(t, d), text: rewriteRefs(t.text, ren) }))]
    if (m.draw?.length) next.draw = [...(s.draw ?? []), ...m.draw.map((x) => moveD(x, d))]
    try {
      parseSheet(JSON.stringify(next)) // the sheet must save and load again; otherwise nothing is changed
    } catch (e) {
      return setReport({ title: `Can't import ${file}`, summary: `The converted drawing is not valid (${(e as Error).message}); your sheet was not changed.`, lines: r.report })
    }
    commit(next)
    show(all(m))
    setReport({ title: `Imported ${file}`, summary: r.summary, lines: r.report })
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
    g.querySelectorAll('.ghost, .preview, .boxsel, .op, .pdots, .nc, .hit, .hitf, .band, .mded, title').forEach((e) => e.remove())
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

  const dots = useMemo(() => ({ j: junctions(sheet), nc: unconnectedPins(sheet), b: sheet.buses?.length ? junctions({ ...sheet, parts: [], wires: sheet.buses }) : [] }), [sheet])
  const placing = typeof tool === 'object' ? tool : null
  const one = sel.size === 1 ? sheet.parts.find((p) => sel.has(p.id) && p.kind !== 'gnd') : undefined
  const entry = one?.lib ? library.find((e) => e.id === one.lib) : undefined
  // the library's custom symbol, when this part doesn't use it (yet) or uses an older version
  const symNow = entry && symbolFields(entry), symFresh = symNow && JSON.stringify(symNow) !== JSON.stringify({ pins: one!.pins, sym: one!.sym }) ? symNow : undefined
  const blockSheet = one?.sheet ? sheets.find((x) => x.file === one.sheet) : undefined
  const ports = blockSheet && sheetPorts(blockSheet.sheet)
  const stale = ports && ports.join('\0') !== (one!.pins ?? []).map((q) => q.name).join('\0') ? ports : undefined
  const dir = sel.size === 1 ? sheet.texts.find((t) => sel.has(t.id)) : undefined
  const alignable = sheet.parts.filter((p) => sel.has(p.id)).length + sheet.texts.filter((t) => sel.has(t.id)).length // what Align / Distribute move
  const popAt = pop ? { left: pop.left, top: pop.top, maxHeight: `calc(100% - ${pop.top + 8}px)` } : undefined
  const drw = sel.size === 1 ? sheet.draw?.find((d) => sel.has(d.id) && (d.t === 'note' || d.t === 'title')) : undefined
  const editDraw = (d: Drawing, f: string, v: string | number) =>
    commit({ ...cur.current, draw: cur.current.draw!.map((x) => (x.id === d.id ? ({ ...x, [f]: v } as Drawing) : x)) }, `edit:${d.id}:${f}`)
  const dirA = dir ? parseAnalysis(dir.text.trim()) : null
  const hovNet = hov && 'net' in hov ? hov.net : null, hovPart = hov && 'partId' in hov ? hov.partId : null
  const blamed = new Set(overlay?.blame?.parts)
  // the parts the selected comment blocks (or the one whose arrows are being picked) point at: highlighted
  const pointed = new Set(sheet.draw?.flatMap((d) => (d.t === 'note' && d.md && d.pins && (sel.has(d.id) || pinFor === d.id) ? d.pins : [])))
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
  // ---- toolbar: every tool it can hold, by id; a part kind (PALETTE, bus tap) is a tool too
  const tl = (t: Tool & string, label: string, tip: string, icon: ReactNode, aria?: string): BarTool => ({ label, tip, icon, aria, run: () => use(t), on: tool === t })
  const act = (label: string, tip: string, icon: ReactNode, run: () => void, x: Partial<BarTool> = {}): BarTool => ({ label, tip, icon, run, ...x })
  const barTools: Record<string, BarTool> = {
    parts: act('Parts', `Parts library${kl('view.partsToggle')} · search${kl('place.fromLibrary')}`, <Cpu />, () => toggleLib(), { on: libOpen }),
    select: tl('select', 'Select', 'Select (Esc)', <MousePointer2 />),
    wire: tl('wire', 'Wire', 'Wire' + kl('place.wire'), <Spline />),
    text: tl('text', 'Directive', 'SPICE directive' + kl('place.directive'), <span className="grid h-5 place-items-center font-mono text-xs">.op</span>, 'SPICE directive'),
    probe: tl('probe', 'Probe', `Probe${kl('sim.probe')} · or Alt+click`, <Crosshair />),
    draw: act('Draw', 'Draw menu: text, shapes, title block, buses', <PenLine />, () => {}, { on: tool === 'note' || tool === 'comment' || isShape(tool) }),
    note: tl('note', 'Note', 'Text note' + kl('place.note'), <Type />),
    comment: tl('comment', 'Comment', 'Comment block' + kl('place.comment'), <MessageSquareText />),
    ...Object.fromEntries(SHAPES.map((s) => [s.t, tl(s.t, s.t === 'rect' ? 'Rect' : s.title, s.title, s.icon)])),
    bus: tl('bus', 'Bus', 'Bus' + kl('place.bus'), <Spline className="stroke-[3]" />),
    title: act('Title', 'Title block', <PanelBottom />, toggleTitle, { on: !!titleOf(sheet) }),
    rotate: act('Rotate', 'Rotate' + kl('edit.rotate'), <RotateCw />, () => orient(true)),
    mirror: act('Mirror', 'Mirror' + kl('edit.mirror'), <FlipHorizontal2 />, () => orient(false)),
    delete: act('Delete', 'Delete (Del)', <Trash2 />, del, { disabled: !sel.size }),
    undo: act('Undo', 'Undo (⌘Z)', <Undo2 />, undo, { disabled: !hist.current.undo.length }),
    redo: act('Redo', 'Redo (⇧⌘Z)', <Redo2 />, redo, { disabled: !hist.current.redo.length }),
    fit: act('Fit', 'Fit' + kl('view.fit'), <Maximize />, () => fit(), { aria: 'Fit to window' }),
    cleanup: act('Clean up', 'Clean up: space out overlapping parts, straighten wires and put labels beside their parts (with parts selected: just their labels)', <Sparkles />, cleanUp),
    annotate: act('Annotate', 'Annotate: renumber the parts on this sheet', <ListOrdered />, () => { const r = annotate([cur.current]); if (r.renamed) commit(r.sheets[0]) }, { disabled: !sheet.parts.length }),
    analysis: act('Analysis', 'Simulation setup' + kl('sim.setup'), <Activity />, () => setDlg('analysis')),
    op: act('OP', 'Show DC operating point voltages', <Gauge />, () => setShowOp((v) => !v), { on: showOp, aria: 'Operating point values', hidden: !overlay?.op })
  }
  const barTool = (id: string): BarTool | undefined => {
    if (barTools[id]) return barTools[id]
    if (!BAR_KINDS.includes(id as Kind)) return undefined
    const k = id as Kind, title = SYMBOLS[k].title
    return { label: QUICK_LABEL[k] ?? title.split(/[ (:,]/)[0], tip: title + kl('place.' + k), aria: title, icon: <SymbolPreview kind={k} size="small" />, run: () => use({ place: k, title }), on: placing?.place === k && !placing.id }
  }
  const BAR_ALL = [...Object.keys(barTools), ...BAR_KINDS]
  const barIds = savedBar.length ? savedBar : DEFAULT_BAR
  const setBar = (ids: string[]) => void window.api.prefs.set({ toolbar: ids.join() === DEFAULT_BAR.join() ? [] : ids })
  // drag-to-reorder, shared by the toolbar's buttons (while it is being edited) and the rows of its Edit panel: dropping on a tool puts the dragged one in its place
  const dnd = (i: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => (setDragI(i), (e.dataTransfer.effectAllowed = 'move')),
    onDragEnd: () => (setDragI(null), setOverI(null)),
    onDragOver: (e: React.DragEvent) => (e.preventDefault(), overI !== i && setOverI(i)),
    onDrop: (e: React.DragEvent) => (e.preventDefault(), dragI != null && dragI !== i && setBar(moved(barIds, dragI, i)), setDragI(null), setOverI(null))
  })
  const dndMark = (i: number) => (dragI === i ? 'opacity-40' : overI === i && dragI != null ? 'shadow-[-2px_0_0_0_var(--primary)]' : '')
  const hoverDraw = (open: boolean) => { clearTimeout(drawTimer.current); drawTimer.current = window.setTimeout(() => setDrawOpen(open), open ? 80 : 300) }
  const g = view.k * GRID < 6 ? GRID * 5 : GRID
  const hint = pinFor
    ? 'Click a part to point the comment at it (+) · click a highlighted part to remove its arrow (−) · Esc or a click elsewhere finishes'
    : placing
    ? `Placing ${placing.title} · click to place · Ctrl+R rotate · Ctrl+E mirror · Esc done`
    : tool === 'text'
      ? 'Click to place a SPICE directive · Esc returns to select'
      : tool === 'note' || tool === 'comment'
      ? `Click to place a ${tool === 'note' ? 'text note' : 'comment block'} (not part of the netlist) · Esc returns to select`
      : isShape(tool)
      ? start
        ? `Click to finish the ${shapeName(tool)}${tool === 'line' ? ' and start the next segment · double-click or Esc ends' : ' · Esc cancels'}`
        : `Click where the ${shapeName(tool)} starts · Esc returns to select`
      : tool === 'bus'
      ? start
        ? 'Click to add a corner · click a bus to join it · / flips the corner · double-click or Esc ends'
        : 'Click to start a bus · name it with a net label such as D[0..7] · bus taps break out its members'
      : tool === 'wire'
      ? start
        ? 'Click to add a corner · click a pin or wire to finish · / flips the corner · double-click or Esc ends'
        : 'Click to start a wire · Esc returns to select'
      : tool === 'probe'
      ? addTo ? 'Click wires or parts to add them to the plot · Esc when done'
        : 'Click a wire to plot its voltage · click a part to plot its current · drag between two nets plots the difference · Esc returns to select'
      : '' // select: nothing to explain (the shortcuts are in Help)

  return (
    <div ref={root} className={`sch${tool === 'probe' ? ' probe' : tool !== 'select' ? ' draw' : ''}${space ? ' pan' : ''}${libOpen ? ' lib' : ''}${pinFor ? ' pin' : ''}`}>
      <svg ref={svg} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onPointerLeave={() => !drag.current && (setCursor(null), setHov(null))} onDoubleClick={dbl} onContextMenu={context}>
        <defs>
          <pattern id={gridId} width={g} height={g} patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {gridStyle === 'lines' ? <path className="dot gl" d={`M${g} 0H0V${g}`} strokeWidth={1 / view.k} /> : <circle className="dot" r={1 / view.k} />}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${gridId})`} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {sheet.draw?.map((d) => !(d.t === 'note' && d.md) && <DrawingEl key={d.id} d={d} cls={sel.has(d.id) ? 'on' : ''} sheetNo={sheetNo} />)}
          {sheet.parts.map((p) => (
            <g key={p.id} data-id={p.id} className={`part${p.kind === 'block' && !p.sheet && !p.lib ? ' ph' : ''}${sel.has(p.id) ? ' on' : ''}${hovPart === p.id || pointed.has(p.id) || (hovNet && isFlag(p.kind) && pn[p.id]?.[0] === hovNet) ? ' hl' : ''}${blamed.has(p.id) ? ' blame' : ''}`}>
              <g className="sym" transform={tf(p)}>
                <Hit b={localBox(p.kind, p)} />
                <SymBody kind={p.kind} part={p} />
              </g>
              {p.kind === 'block' && !p.sym && <PinNames part={p} at={p} />}
              {p.sym && <SymTexts part={p} at={p} />}
              <Texts p={p} sel={sel} />
            </g>
          ))}
          {sheet.wires.map((w) => (
            <g key={w.id} data-id={w.id} className={`wire${sel.has(w.id) ? ' on' : ''}${hovNet && wn[w.id] === hovNet ? ' hl' : ''}${overlay?.blame?.nets.includes(wn[w.id]) ? ' blame' : ''}`}>
              <line className="hit" x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />
              <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />
            </g>
          ))}
          {sheet.buses?.map((w) => (
            <g key={w.id} data-id={w.id} className={`bus${sel.has(w.id) ? ' on' : ''}`}>
              <line className="hit" x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />
              <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />
            </g>
          ))}
          {dots.b.map((q) => <circle key={`b${q.x},${q.y}`} className="bjn" cx={q.x} cy={q.y} r={4.5} />)}
          {sheet.texts.map((t) => <Card key={t.id} t={t} cls={sel.has(t.id) ? 'on' : ''} />)}
          {/* comment blocks float over the circuit; the other annotations sit under it */}
          {sheet.draw?.map((d) => d.t === 'note' && d.md && <DrawingEl key={d.id} d={d} cls={sel.has(d.id) || pinFor === d.id ? 'on' : ''} />)}
          {sheet.draw?.map((d) => d.t === 'note' && d.md && !!d.pins?.length && ( // a deleted part's arrow just isn't drawn
            <Callouts key={'c' + d.id} card={dbox(d)} targets={d.pins.flatMap((id) => { const q = sheet.parts.find((x) => x.id === id); return q ? [aimBox(q)] : [] })} cls={sel.has(d.id) || pinFor === d.id ? 'on' : ''} />
          ))}
          {/* a comment block is edited in place: MdEdit over the card, formatted as it is typed, in sheet units so it zooms with it */}
          {drw?.t === 'note' && drw.md && pop?.id === drw.id && (() => { const b = dbox(drw); return (
            <foreignObject className="mded" x={b.x0} y={b.y0 + MD_BAN} width={4000} height={4000}>
              <MdEdit text={drw.text} size={drw.size ?? NOTE} minW={b.x1 - b.x0} minH={b.y1 - b.y0 - MD_BAN} fresh={fresh} onChange={(t) => editDraw(drw, 'text', t)}
                onDone={() => setPop(null)} onUndo={(re) => (re ? redo() : undo())} onBlur={() => (hist.current.merge = undefined)} />
            </foreignObject>
          ) })()}
          {dots.j.map((q) => <circle key={`j${q.x},${q.y}`} className="jn" cx={q.x} cy={q.y} r={3} />)}
          {dots.nc.map((q, i) => <rect key={i} className="nc" x={q.x - 2} y={q.y - 2} width={4} height={4} />)}
          {placing && cursor && (
            <g className="ghost">
              <g className="sym" transform={tf({ ...ghost, ...cursor })}><SymBody kind={placing.place} part={placing.extra} /></g>
              {placing.place === 'block' && placing.extra && !placing.extra.sym && <PinNames part={placing.extra} at={{ ...ghost, ...cursor }} />}
              {placing.extra?.sym && <SymTexts part={placing.extra} at={{ ...ghost, ...cursor }} />}
            </g>
          )}
          {tool === 'text' && cursor && <Card t={{ id: '', ...cursor, text: '.op' }} cls="ghost" />}
          {(tool === 'note' || tool === 'comment') && cursor && <DrawingEl d={{ id: '', t: 'note', ...cursor, ...(tool === 'note' ? { text: 'Note' } : COMMENT) }} cls="ghost" />}
          {isShape(tool) && cursor && (start ? <DrawingEl d={{ id: '', t: tool, a: start, b: cursor }} cls="ghost" />
            : <g className="preview"><circle cx={cursor.x} cy={cursor.y} r={2.5} /></g>)}
          {(tool === 'wire' || tool === 'bus') && cursor && (
            <g className={`preview${tool === 'bus' ? ' bus' : ''}`}>
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
        {/* probe points, in screen px: a dot on the sheet (drag it to probe something else) tied to its plot's card by a line */}
        <g className="pdots">
          {probes.flatMap((p) => p.pts.map((q, i) => {
            const sx = q.at.x * view.k + view.x, sy = q.at.y * view.k + view.y, cx = p.x * view.k + view.x, cy = p.y * view.k + view.y
            return (
              <g key={q.id} style={{ color: seriesColor(i) }}>
                <line x1={sx} y1={sy} x2={Math.max(cx, Math.min(cx + p.w * view.k, sx))} y2={Math.max(cy, Math.min(cy + p.h * view.k, sy))} />
                <circle cx={sx} cy={sy} r={5} onPointerDown={(e) => dragDot(e, p, i)}><title>{probeData.get(q.id)?.label}: drag to probe another wire or part</title></circle>
              </g>
            )
          }))}
        </g>
      </svg>
      <div className="pov">
        {probes.map((p) => (
          <ProbePlot key={p.id} x={p.x * view.k + view.x} y={p.y * view.k + view.y} k={view.k} w={p.w} h={p.h} mode={p.mode} adding={addTo === p.id} series={p.pts.map((q) => probeData.get(q.id)!)} scale={probeSrc?.scale ?? null} ran={!!probeSrc?.ran}
            onMode={(mode) => editProbe(p.id, (q) => ({ ...q, mode }))} onSize={(w, h) => editProbe(p.id, (q) => ({ ...q, w, h }))} onMove={(e) => moveCard(e, p)}
            onAdd={() => (addTo === p.id ? setAddTo(null) : (use('probe'), setAddTo(p.id)))} onRemove={(i) => dropProbe(p, [p.pts[i]])} onClose={() => dropProbe(p)} />
        ))}
      </div>

      {libOpen ? <LibraryPanel entries={browse ?? library} sheets={sheets} onPick={pick} active={placing?.id} search={search} />
        : <Rail side="left" label="Parts" icon={Cpu} title={`Show parts${kl('view.parts')}`} onOpen={() => toggleLib(true)} />}
      <div className="sch-bar items-center gap-0.5 rounded-lg border bg-card/95 p-1.5 shadow-sm" ref={bar}>
        {barIds.map((id, i) => {
          const t = id === '|' ? undefined : barTool(id)
          if (editBar) { // being edited: every tool is a plain button that drags to its new place (and does nothing when clicked)
            if (id === '|') return <div key={i} {...dnd(i)} aria-label="Separator" className={cn('flex h-12 cursor-grab items-center px-1.5', dndMark(i))}><Separator orientation="vertical" className="data-[orientation=vertical]:h-8" /></div>
            return t && <Button key={id} variant="ghost" size="sm" {...dnd(i)} aria-label={t.aria ?? t.label} className={cn(TBTN, 'cursor-grab [&_.symp]:size-5!', dndMark(i))}>{t.icon}<span>{t.label}</span></Button>
          }
          if (id === '|') return <Sep key={i} />
          if (!t || t.hidden) return null
          if (id === 'draw') return (
            // a menu of tools: the chevron says so, and it opens on hover as well as on a click
            <DropdownMenu key={id} open={drawOpen} onOpenChange={setDrawOpen} modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Draw" className={cn(TBTN, t.on && 'bg-accent text-foreground')} onPointerEnter={() => hoverDraw(true)} onPointerLeave={() => hoverDraw(false)}
                  onPointerDown={(e) => drawOpen && e.preventDefault() /* already open from the hover: a click keeps it open */}>
                  {t.icon}<span className="flex items-center gap-0.5">Draw<ChevronDown className="size-3" /></span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48" onCloseAutoFocus={(e) => e.preventDefault()} onPointerEnter={() => hoverDraw(true)} onPointerLeave={() => hoverDraw(false)}
                onInteractOutside={(e) => (e.detail.originalEvent.target as Element).closest?.('[aria-label=Draw]') && e.preventDefault()}>
                <DropdownMenuItem onSelect={() => use('note')}><Type />Text note<DropdownMenuShortcut>{keyLabel(keysOf('place.note'))}</DropdownMenuShortcut></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => use('comment')}><MessageSquareText />Comment block<DropdownMenuShortcut>{keyLabel(keysOf('place.comment'))}</DropdownMenuShortcut></DropdownMenuItem>
                {SHAPES.map((s) => <DropdownMenuItem key={s.t} onSelect={() => use(s.t)}>{s.icon}{s.title}</DropdownMenuItem>)}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => use('bus')}><Spline className="stroke-[3]" />Bus<DropdownMenuShortcut>{keyLabel(keysOf('place.bus'))}</DropdownMenuShortcut></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => use({ place: 'bustap', title: SYMBOLS.bustap.title })}><SymbolPreview kind="bustap" size="small" />Bus tap</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={!!titleOf(sheet)} onSelect={toggleTitle}><PanelBottom className="text-muted-foreground" />Title block</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
          return (
            <Tip key={id} label={t.tip}>
              <Button variant="ghost" size="sm" aria-label={t.aria ?? t.label} aria-pressed={t.on} disabled={t.disabled} className={cn(TBTN, '[&_.symp]:size-5!', t.on && 'bg-accent text-foreground')} onClick={t.run}>
                {t.icon}<span>{t.label}</span>
              </Button>
            </Tip>
          )
        })}
        <Sep />
        <Tip label="Edit the toolbar: drag to reorder, remove and add tools">
          <Button variant="ghost" size="sm" aria-label="Edit toolbar" aria-pressed={editBar} className={cn(TBTN, editBar && 'bg-accent text-foreground')} onClick={() => setEditBar((v) => !v)}><Settings2 /><span>{editBar ? 'Done' : 'Edit'}</span></Button>
        </Tip>
        {/* the Edit panel: a plain box under the toolbar's end, open until Done / Esc / a click on the canvas (a menu would close on the first drag) */}
        {editBar && (
          <div className="absolute top-full right-0 z-10 mt-1 w-72 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md" role="dialog" aria-label="Edit toolbar">
            <div className="mb-1 flex items-center justify-between font-semibold">Toolbar
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={!savedBar.length} onClick={() => setBar(DEFAULT_BAR)}>Reset</Button>
            </div>
            <div className={cn(D, 'mb-1.5')}>Drag a button on the toolbar, or a row here, to where it should go.</div>
            <div className="max-h-[38vh] overflow-auto" role="list" aria-label="Tools on the toolbar">
              {barIds.map((id, i) => {
                const t = id === '|' ? undefined : barTool(id)
                if (id !== '|' && !t) return null
                return (
                  <div key={id + i} role="listitem" {...dnd(i)} className={cn('flex h-7 items-center gap-1.5 rounded-sm pr-0.5 hover:bg-accent/60 [&_svg]:size-4 [&_.symp]:size-4!', dragI === i ? 'opacity-40' : overI === i && dragI != null && 'shadow-[0_-2px_0_0_var(--primary)]')}>
                    <GripVertical className="cursor-grab text-muted-foreground" />
                    {t ? <>{t.icon}<span className="flex-1 truncate">{t.tip.replace(/ \(.*$| ·.*$|:.*$/, '')}</span></> : <span className="flex-1 text-muted-foreground">Separator</span>}
                    <Button variant="ghost" size="icon" className="size-6" aria-label="Remove" onClick={() => setBar(barIds.filter((_, k) => k !== i))}><X /></Button>
                  </div>
                )
              })}
            </div>
            <Separator className="my-1.5" />
            <div className="mb-1 font-semibold">Add to the toolbar</div>
            <div className="max-h-[28vh] overflow-auto">
              <Button variant="ghost" size="sm" className="h-7 w-full justify-start gap-1.5 px-1 text-xs font-normal" onClick={() => setBar([...barIds, '|'])}><Plus className="text-muted-foreground" /><span className="text-muted-foreground">Separator</span></Button>
              {BAR_ALL.filter((id) => !barIds.includes(id)).map((id) => { const t = barTool(id)!; return (
                <Button key={id} variant="ghost" size="sm" className="h-7 w-full justify-start gap-1.5 px-1 text-xs font-normal [&_.symp]:size-4!" onClick={() => setBar([...barIds, id])}>
                  <Plus className="text-muted-foreground" />{t.icon}<span className="truncate">{t.tip.replace(/ \(.*$| ·.*$|:.*$/, '')}</span>
                </Button>
              ) })}
            </div>
          </div>
        )}
      </div>

      {one && pop?.id === one.id && (
        <div className={INSP} style={popAt} onPointerDown={dragPop} key={one.id}>
          <div className="text-xs font-semibold">{entry?.name ?? (one.sheet ? 'Sheet block' : SYMBOLS[one.kind].title)}</div>
          {entry && <div className={D}>{entry.description}</div>}
          {entry?.group && <div className={D}>From {entry.group} · {libKey(entry.id).replace(/^(proj|user):|^pack:[^/]*\//, '')}</div>}
          {one.lib && !entry && <div className={cn(D, 'text-warn')}>Unknown library part {one.lib}</div>}
          {(one.lo || one.vo) && <InspBtn onClick={() => commit({ ...cur.current, parts: cur.current.parts.map((q) => (q.id === one.id ? { ...q, lo: undefined, vo: undefined } : q)) })}>Reset label positions</InspBtn>}
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
              {symFresh && (
                <Tip label="Draw this part with the library's custom symbol (wires on its old pins stay where they are)">
                  <InspBtn onClick={() => commit({ ...cur.current, parts: cur.current.parts.map((q) => (q.id === one.id ? { ...q, ...symFresh } : q)) })}>{one.sym ? 'Update symbol' : 'Use custom symbol'}</InspBtn>
                </Tip>
              )}
            </>
          )}
        </div>
      )}

      {dir && pop?.id === dir.id && (
        <div className={cn(INSP, 'w-max max-w-[calc(100%-16px)] min-w-[230px]')} style={popAt} onPointerDown={dragPop} key={dir.id}>{/* as wide as its longest line, up to the canvas */}
          <Label className={FLD}>SPICE directive
            {/* grows with the text (field-sizing); its corner grip resizes it, and the popup with it */}
            <Textarea ref={ta} {...keptSize('dir')} value={dir.text} spellCheck={false} onChange={(e) => editText(dir.id, e.target.value)}
              className={cn('max-h-[70vh] min-h-[60px] resize overflow-auto px-2 py-1.5 leading-snug whitespace-pre [overflow-wrap:normal]', MONO)}
              onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()} onBlur={() => (hist.current.merge = undefined)} />
          </Label>
          {dirA && <InspBtn onClick={() => setDlg('edit')}>Edit as analysis…</InspBtn>}
          {optLine(dir.text) != null && <InspBtn onClick={() => setDlg('options')}>Edit options…</InspBtn>}
          {optLine(dir.text, 'ic') != null && <InspBtn onClick={() => setDlg('ic')}>Edit initial conditions…</InspBtn>}
          {optLine(dir.text, 'nodeset') != null && <InspBtn onClick={() => setDlg('nodeset')}>Edit nodeset…</InspBtn>}
        </div>
      )}

      {drw?.t === 'note' && pop?.id === drw.id && (
        <div className={INSP} style={popAt} onPointerDown={dragPop} key={drw.id}>
          {drw.md ? <><div className="text-xs font-semibold">Comment block</div><div className={D}>Type markdown on the block itself · Esc when done. Not netlisted.</div></> : (
          <Label className={FLD}>Text note (not netlisted)
            <Textarea ref={ta} {...keptSize('note')} rows={4} value={drw.text} spellCheck={false} onChange={(e) => editDraw(drw, 'text', e.target.value)}
              className={cn('max-h-[50vh] min-h-[60px] resize-y px-2 py-1.5 leading-snug', MONO)}
              onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()} onBlur={() => (hist.current.merge = undefined)} />
          </Label>
          )}
          {!drw.md && ( // a comment block sizes its text with markdown headings instead
          <Label className={FLD}>Size
            <Select value={String(drw.size ?? NOTE)} onValueChange={(v) => editDraw(drw, 'size', +v)}>
              <SelectTrigger size="sm" className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{NOTE_SIZES.map(([l, v]) => <SelectItem key={v} value={String(v)}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </Label>
          )}
          {drw.md && (() => {
            // the parts this comment points at, one row each (a part since deleted is listed so its arrow can be cleared)
            const setPins = (pins: string[]) => commit({ ...cur.current, draw: cur.current.draw!.map((x) => (x.id === drw.id && x.t === 'note' ? { ...x, pins: pins.length ? pins : undefined } : x)) })
            const pins = drw.pins ?? []
            return (
              <>
                {pins.length > 0 && (
                  <div className={FLD}>Points at
                    <div role="list" aria-label="Parts this comment points at" className="max-h-40 overflow-auto rounded-sm border">
                      {pins.map((id) => {
                        const q = sheet.parts.find((x) => x.id === id)
                        return (
                          <div key={id} role="listitem" className="flex h-7 items-center gap-1.5 pr-0.5 pl-2 text-xs hover:bg-accent/60" onPointerEnter={() => q && setHov({ partId: id })} onPointerLeave={() => setHov(null)}>
                            <span className={cn('flex-1 truncate', MONO, !q && 'text-muted-foreground')}>{q ? q.name || q.value || SYMBOLS[q.kind].title : 'deleted part'}</span>
                            {q && <span className="truncate text-muted-foreground">{SYMBOLS[q.kind].title}</span>}
                            <Button variant="ghost" size="icon" className="size-6 [&_svg]:size-4" aria-label={`Remove the arrow to ${q?.name || 'this part'}`} onClick={() => setPins(pins.filter((x) => x !== id))}><X /></Button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Tip label="Draw arrows from this comment to parts: click each part, Esc when done"><InspBtn onClick={() => (setPop(null), setPinFor(drw.id))}>{pins.length ? 'Point at more…' : 'Point at parts…'}</InspBtn></Tip>
                  {pins.length > 1 && <InspBtn onClick={() => setPins([])}>Remove all</InspBtn>}
                </div>
              </>
            )
          })()}
        </div>
      )}
      {drw?.t === 'title' && pop?.id === drw.id && (
        <div className={INSP} style={popAt} onPointerDown={dragPop} key={drw.id}>
          <div className="text-xs font-semibold">Title block</div>
          {(['title', 'author', 'date', 'rev'] as const).map((f) => (
            <Label key={f} className={FLD}>{f === 'rev' ? 'Revision' : f[0].toUpperCase() + f.slice(1)}
              <Input className="h-7 px-2 text-xs md:text-xs" value={drw[f]} spellCheck={false} onChange={(e) => editDraw(drw, f, e.target.value)} onKeyDown={blurOnEnter} onBlur={() => (hist.current.merge = undefined)} />
            </Label>
          ))}
          <div className={D}>Sheet {sheetNo ?? '1 of 1'} is filled in from the project.</div>
        </div>
      )}

      {/* right-click menu: a zero-size trigger at the pointer anchors the dropdown */}
      <DropdownMenu open={!!menu} onOpenChange={(o) => !o && setMenu(null)}>
        <DropdownMenuTrigger asChild><span className="pointer-events-none absolute size-0" style={{ left: menu?.left ?? 0, top: menu?.top ?? 0 }} /></DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
          {menu?.id && <DropdownMenuItem disabled={sel.size !== 1} onSelect={() => { const id = menu.id!; setTimeout(() => openPop(id)) }}>Properties…<DropdownMenuShortcut>↵</DropdownMenuShortcut></DropdownMenuItem>}
          {menu?.id && <DropdownMenuSeparator />}
          <DropdownMenuItem disabled={!sel.size} onSelect={cut}>Cut<DropdownMenuShortcut>{keyLabel('Mod+X')}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem disabled={!sel.size} onSelect={() => (clip.current = picked())}>Copy<DropdownMenuShortcut>{keyLabel('Mod+C')}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem disabled={!clip.current} onSelect={() => (clip.current = paste(clip.current))}>Paste<DropdownMenuShortcut>{keyLabel('Mod+V')}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem disabled={!sel.size} onSelect={() => paste(picked())}>Duplicate<DropdownMenuShortcut>{keyLabel(keysOf('edit.duplicate'))}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem disabled={!sel.size} onSelect={del}>Delete<DropdownMenuShortcut>Del</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!sel.size} onSelect={() => orient(true)}>Rotate<DropdownMenuShortcut>{keyLabel(keysOf('edit.rotate'))}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem disabled={!sel.size} onSelect={() => orient(false)}>Mirror<DropdownMenuShortcut>{keyLabel(keysOf('edit.mirror'))}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={alignable < 2}>Align</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => align('left')}>Left edges</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => align('cx')}>Centres (in a column)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => align('right')}>Right edges</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => align('top')}>Top edges</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => align('cy')}>Centres (in a row)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => align('bottom')}>Bottom edges</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={alignable < 3}>Distribute</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => align('dx')}>Horizontally</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => align('dy')}>Vertically</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={cleanUp}>{sel.size ? 'Clean Up Labels' : 'Clean Up'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSel(new Set(all(cur.current)))}>Select All<DropdownMenuShortcut>{keyLabel('Mod+A')}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => fit()}>Fit to Window<DropdownMenuShortcut>{keyLabel(keysOf('view.fit'))}</DropdownMenuShortcut></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="sch-hint text-xs text-muted-foreground">{hint}</div>
      {/* portalled: panels beside the canvas would otherwise stack above the modal */}
      {dlg && createPortal(
        <AnalysisDialog initial={(dlg === 'edit' && dirA) || undefined} sources={sources} nets={[...new Set(Object.values(nl.nets).flat())].filter((n) => n !== '0').sort()}
          onApply={applyAnalysis} options={lineOf('options')} ic={lineOf('ic')} nodeset={lineOf('nodeset')} tran={sheet.texts.some((t) => /^\s*\.tran\b/im.test(t.text))} tab={dlg === 'analysis' || dlg === 'edit' ? undefined : dlg}
          onOptions={(line) => (setDlg(null), putOptions(line, false))} onClose={() => setDlg(null)} />, document.body
      )}
      {report && createPortal(
        <Dialog open onOpenChange={(o) => !o && setReport(null)}>
          <DialogContent className="sm:max-w-[560px]" onKeyDown={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle className="text-sm">{report.title}</DialogTitle>
              <DialogDescription className="text-xs">{report.summary}</DialogDescription>
            </DialogHeader>
            {report.lines.length ? (
              <>
                <p className="text-xs text-muted-foreground">Not converted, or converted with a change:</p>
                <ul className="grid max-h-[50vh] list-disc gap-1 overflow-y-auto pl-4 text-xs">{report.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                <p className="text-xs text-muted-foreground">Placeholders are drawn with a red dashed outline and stop the netlist until you replace them.</p>
              </>
            ) : <p className="text-xs text-muted-foreground">Everything was converted.</p>}
            <DialogFooter><Button size="sm" autoFocus onClick={() => setReport(null)}>OK</Button></DialogFooter>
          </DialogContent>
        </Dialog>, document.body
      )}
      {srcDlg && one && isSrc(one) && createPortal(
        <SourceDialog name={one.name} unit={one.kind === 'isrc' ? 'A' : 'V'} value={one.value} onClose={() => setSrcDlg(false)}
          onApply={(v) => (setSrcDlg(false), commit({ ...cur.current, parts: cur.current.parts.map((q) => (q.id === one.id ? { ...q, value: v } : q)) }))} />, document.body
      )}
    </div>
  )
}
