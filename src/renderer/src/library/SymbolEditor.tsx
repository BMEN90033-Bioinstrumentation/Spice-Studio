// Symbol editor (Manage Libraries › Symbols… on one of your libraries, and the component builder's drawing view): draw a part's symbol on the grid (lines,
// rectangles, ellipses, triangles, text; solid or outlined) and place its pins, each connected to a subckt pin (or the model's C/B/E…). Saved on the
// library entry (customSymbol.ts); parts placed afterwards use it.
import { createPortal } from 'react-dom'
import { useMemo, useRef, useState, type MutableRefObject, type PointerEvent as RPE, type ReactNode } from 'react'
import { snap, uid, type Drawing, type Pt } from '../schematic/model'
import { dbox, moveD, NOTE_SIZES, shapePath, type Shape } from '../schematic/drawings'
import { keysOf, matches, useCommands } from '../commands'
import { keyLabel } from '../layout/Panel'
import { parseLibFile, type ImportedLib } from './library'
import { defaultSymbol, mapPicked, standardSymbol, symbolErrors, targets, turnPicked, type CustomSymbol, type Picked } from './customSymbol'
import { Circle, FlipHorizontal2, Minus, MousePointer2, RotateCw, Square, Trash2, Triangle, Type } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tip } from '@/components/ui/tip'
import { cn } from '@/lib/utils'

type Tool = 'select' | 'line' | 'rect' | 'ellipse' | 'triangle' | 'text' | 'pin'
const TOOLS: [Tool, string, React.ReactNode][] = [
  ['select', 'Select and move: click, Shift+click or drag a box; right-click for more', <MousePointer2 />], ['line', 'Line: click start, click end; keeps going until Esc', <Minus />],
  ['rect', 'Rectangle: click two corners', <Square />], ['ellipse', 'Ellipse: click two corners', <Circle />],
  ['triangle', 'Triangle: click the flat side\'s corner, then the opposite corner; it points the way you drag. Rotate turns it', <Triangle className="rotate-90" />],
  ['text', 'Text: click anywhere to place (not held to the grid); double-click a text to change it', <Type />],
  ['pin', 'Pin: click a grid point; it connects to the next free pin', <span className="font-mono text-[11px]">pin</span>]
]
const VB = { x: -120, y: -90, w: 240, h: 180 } // world units shown; grid 10
const FLD = 'grid gap-1 text-[11px] font-normal text-muted-foreground'
const NONE: ReadonlySet<string> = new Set()
const half = (v: number) => Math.round(v * 2) / 2 // free positions (text) keep to half units
const fillable = (d: Drawing): d is Extract<Drawing, { fill?: boolean }> => d.t === 'rect' || d.t === 'ellipse' || d.t === 'poly'

type Ent = Parameters<typeof targets>[0] & { name: string }

// The drawing surface for one part: tools, canvas, and the pin list. sym null = the part uses its standard symbol.
// Works like the schematic: click / Shift+click / drag a box to select, drag to move, right-click for the menu, and
// the Edit commands (undo, redo, cut, copy, paste, duplicate, delete, select all, rotate, mirror) with their shortcuts.
// esc: set to a function the host calls on Escape; true = the pad used it (left a tool), so the host should not close.
export function SymbolPad({ e, sym, put, lead, side, esc }: {
  e: Ent; sym: CustomSymbol | null; put: (s: CustomSymbol | null) => void
  lead?: ReactNode // first in the toolbar (the dialog's part picker)
  side?: HTMLElement | null // the builder: the canvas fills the pad, and the pin list is shown in this element instead of beside it
  esc?: MutableRefObject<() => boolean>
}) {
  const [tool, setTool] = useState<Tool>('select')
  const [start, setStart] = useState<Pt | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [sel, setSel] = useState(NONE) // 's3' = shape 3, 'p1' = pin 1
  const [band, setBand] = useState<{ a: Pt; b: Pt } | null>(null) // box select
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null) // right-click menu
  const [textAt, setTextAt] = useState<{ i: number; left: number; top: number } | null>(null) // the text being changed (double-click)
  const drag = useRef<{ from: Pt; base: CustomSymbol; k: Picked; free: boolean; v: Pt } | null>(null)
  const last = useRef({ k: '', t: 0 }) // previous click, to tell a double-click (a captured pointer gets no dblclick on the shape)
  const hist = useRef<{ undo: (CustomSymbol | null)[]; redo: (CustomSymbol | null)[] }>({ undo: [], redo: [] })
  const clip = useRef<Drawing[]>([])
  const svg = useRef<SVGSVGElement>(null), wrap = useRef<HTMLDivElement>(null)
  const names = targets(e)
  const errs = sym ? symbolErrors(sym, e) : []
  const fill = side !== undefined
  const pick = (s: ReadonlySet<string>): Picked => {
    const of = (c: string, n: number) => [...s].filter((x) => x[0] === c).map((x) => +x.slice(1)).filter((i) => i < n)
    return { shapes: of('s', sym?.shapes.length ?? 0), pins: of('p', sym?.pins.length ?? 0) }
  }
  const k = pick(sel), some = k.shapes.length + k.pins.length > 0
  const canFill = sym ? k.shapes.filter((i) => fillable(sym.shapes[i])) : []
  const filled = !!sym && canFill.length > 0 && canFill.every((i) => (sym.shapes[i] as { fill?: boolean }).fill)

  const raw = (ev: { clientX: number; clientY: number }): Pt => {
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse())
    return { x: half(p.x), y: half(p.y) }
  }
  const at = (ev: { clientX: number; clientY: number }) => { const r = wrap.current!.getBoundingClientRect(); return { left: ev.clientX - r.left, top: ev.clientY - r.top, w: r.width } }
  // every change goes through here, so it can be undone
  const commit = (s: CustomSymbol | null) => (hist.current.undo.push(sym), (hist.current.redo = []), put(s))
  const step = (from: 'undo' | 'redo', to: 'undo' | 'redo') => { const h = hist.current; if (h[from].length) h[to].push(sym), put(h[from].pop()!), setSel(NONE), setTextAt(null) }
  const undo = () => step('undo', 'redo'), redo = () => step('redo', 'undo')
  function use(t: Tool) { setTool(t), setStart(null), setSel(NONE), setTextAt(null) }
  const leave = () => (textAt ? (setTextAt(null), true) : start || tool !== 'select' ? (use('select'), true) : false)
  if (esc) esc.current = leave
  function del() {
    if (!sym || !some) return
    commit({ shapes: sym.shapes.filter((_, i) => !k.shapes.includes(i)), pins: sym.pins.filter((_, i) => !k.pins.includes(i)) })
    setSel(NONE), setTextAt(null)
  }
  const turn = (how: 'rotate' | 'mirror') => sym && commit(turnPicked(sym, k, how)) // nothing selected: the whole symbol
  const setFill = () => sym && commit({ ...sym, shapes: sym.shapes.map((d, i) => (canFill.includes(i) ? { ...d, fill: !filled } : d)) })
  const copy = () => sym && (clip.current = k.shapes.map((i) => sym.shapes[i])) // ponytail: shapes and text only; a copied pin would have nothing to connect to
  function paste(src: Drawing[]) {
    if (!sym || !src.length) return
    const add = src.map((d) => ({ ...moveD(d, { x: 10, y: 10 }), id: uid() }))
    commit({ ...sym, shapes: [...sym.shapes, ...add] })
    setSel(new Set(add.map((_, j) => 's' + (sym.shapes.length + j)))), (clip.current = add) // the next paste steps on again
  }
  const all = () => sym && setSel(new Set([...sym.shapes.map((_, i) => 's' + i), ...sym.pins.map((_, i) => 'p' + i)]))
  const notesOnly = (p: Picked) => !!sym && !p.pins.length && p.shapes.every((i) => sym.shapes[i].t === 'note')
  const nudge = (x: number, y: number) => { const n = notesOnly(k) ? 1 : 10; if (sym && some) commit(mapPicked(sym, k, (p) => ({ x: p.x + x * n, y: p.y + y * n }))) }
  function openText(i: number, ev: { clientX: number; clientY: number }) {
    const p = at(ev)
    hist.current.undo.push(sym), (hist.current.redo = []) // typing in the popup is one undo step
    setSel(new Set(['s' + i])), setTextAt({ i, left: Math.max(4, Math.min(p.left, p.w - 236)), top: p.top + 10 })
  }

  // the Edit menu drives the pad like it drives the schematic (their keys: onKeyDown below, which also works inside a dialog)
  useCommands(sym ? [
    { id: 'edit.undo', run: undo, enabled: () => hist.current.undo.length > 0 }, { id: 'edit.redo', run: redo, enabled: () => hist.current.redo.length > 0 },
    { id: 'edit.cut', run: () => (copy(), del()), enabled: () => some }, { id: 'edit.copy', run: copy, enabled: () => k.shapes.length > 0 },
    { id: 'edit.paste', run: () => paste(clip.current), enabled: () => clip.current.length > 0 }, { id: 'edit.duplicate', run: () => paste(k.shapes.map((i) => sym.shapes[i])), enabled: () => k.shapes.length > 0 },
    { id: 'edit.delete', run: del, enabled: () => some }, { id: 'edit.selectAll', run: all },
    { id: 'edit.rotate', run: () => turn('rotate') }, { id: 'edit.mirror', run: () => turn('mirror') }
  ] : [])

  function down(ev: RPE<SVGSVGElement>) {
    if (!sym || ev.button !== 0) return
    ev.currentTarget.focus() // the keys reach the pad
    setTextAt(null)
    const p0 = raw(ev), p = { x: snap(p0.x), y: snap(p0.y) }
    if (tool === 'select') {
      const hit = (ev.target as Element).closest('[data-k]')?.getAttribute('data-k')
      ev.currentTarget.setPointerCapture(ev.pointerId)
      if (!hit) return ev.shiftKey || setSel(NONE), setBand({ a: p0, b: p0 })
      const twice = last.current.k === hit && ev.timeStamp - last.current.t < 400
      last.current = { k: hit, t: ev.timeStamp }
      if (twice && hit[0] === 's' && sym.shapes[+hit.slice(1)]?.t === 'note') return openText(+hit.slice(1), ev)
      if (ev.shiftKey) { const n = new Set(sel); n.has(hit) ? n.delete(hit) : n.add(hit); return setSel(n) }
      const next = sel.has(hit) ? sel : new Set([hit]), kk = pick(next)
      setSel(next)
      drag.current = { from: p0, base: sym, k: kk, free: notesOnly(kk), v: { x: 0, y: 0 } } // text alone moves freely; anything else keeps to the grid
      return
    }
    if (tool === 'text') {
      commit({ ...sym, shapes: [...sym.shapes, { id: uid(), t: 'note', x: p0.x, y: p0.y, text: 'Text', size: 7 }] })
      const q = at(ev)
      return setSel(new Set(['s' + sym.shapes.length])), setTool('select'), setTextAt({ i: sym.shapes.length, left: Math.max(4, Math.min(q.left, q.w - 236)), top: q.top + 14 })
    }
    if (tool === 'pin') {
      const used = new Set(sym.pins.map((q) => q.map)), free = names.findIndex((_, j) => !used.has(j))
      if (sym.pins.some((q) => q.x === p.x && q.y === p.y)) return
      return commit({ ...sym, pins: [...sym.pins, { name: free < 0 ? `P${sym.pins.length + 1}` : names[free], x: p.x, y: p.y, map: free }] })
    }
    if (!start) return setStart(p)
    if (p.x === start.x && p.y === start.y) return
    if (tool === 'triangle') return commit({ ...sym, shapes: [...sym.shapes, { id: uid(), t: 'poly', pts: tri(start, p) }] }), setStart(null)
    commit({ ...sym, shapes: [...sym.shapes, { id: uid(), t: tool, a: start, b: p }] })
    setStart(tool === 'line' ? p : null)
  }
  function move(ev: RPE<SVGSVGElement>) {
    const p0 = raw(ev), d = drag.current
    setCursor({ x: snap(p0.x), y: snap(p0.y) })
    if (band) return setBand({ a: band.a, b: p0 })
    if (!d) return
    const f = d.free ? half : snap, v = { x: f(p0.x - d.from.x), y: f(p0.y - d.from.y) }
    if (v.x === d.v.x && v.y === d.v.y) return
    if (!d.v.x && !d.v.y) hist.current.undo.push(d.base), (hist.current.redo = []) // the whole drag is one undo step
    d.v = v
    put(mapPicked(d.base, d.k, (q) => ({ x: q.x + v.x, y: q.y + v.y })))
  }
  function up(ev: RPE<SVGSVGElement>) {
    drag.current = null
    if (!band || !sym) return
    const x0 = Math.min(band.a.x, band.b.x), x1 = Math.max(band.a.x, band.b.x), y0 = Math.min(band.a.y, band.b.y), y1 = Math.max(band.a.y, band.b.y)
    setBand(null)
    if (x1 - x0 < 2 && y1 - y0 < 2) return
    // like the schematic: everything the box touches
    const hits = [...sym.shapes.flatMap((s, i) => { const b = dbox(s); return b.x0 <= x1 && b.x1 >= x0 && b.y0 <= y1 && b.y1 >= y0 ? ['s' + i] : [] }),
      ...sym.pins.flatMap((q, i) => (q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1 ? ['p' + i] : []))]
    setSel(new Set([...(ev.shiftKey ? sel : []), ...hits]))
  }
  function context(ev: React.MouseEvent<SVGSVGElement>) {
    ev.preventDefault()
    if (!sym) return
    const hit = (ev.target as Element).closest('[data-k]')?.getAttribute('data-k')
    if (!hit) setSel(NONE)
    else if (!sel.has(hit)) setSel(new Set([hit]))
    setStart(null), setTextAt(null), setMenu(at(ev))
  }
  function keys(ev: React.KeyboardEvent) {
    if ((ev.target as Element).closest('input,textarea,select,[role=combobox],[role=menu]')) return // fields and menus own their keys
    const on = (keys: string) => matches(keys, ev.nativeEvent)
    if (ev.key === 'Escape') leave()
    else if (ev.key === 'Delete' || ev.key === 'Backspace') del()
    else if (on(keysOf('edit.rotate', 'Ctrl+R'))) turn('rotate')
    else if (on(keysOf('edit.mirror', 'Ctrl+E'))) turn('mirror')
    else if (on(keysOf('edit.duplicate', 'Mod+D'))) sym && paste(k.shapes.map((i) => sym.shapes[i]))
    else if (on('Mod+Z')) undo()
    else if (on('Mod+Shift+Z') || on('Mod+Y')) redo()
    else if (on('Mod+C')) copy()
    else if (on('Mod+X')) copy(), del()
    else if (on('Mod+V')) paste(clip.current)
    else if (on('Mod+A')) all()
    else if (ev.key.startsWith('Arrow') && some) nudge(+(ev.key === 'ArrowRight') - +(ev.key === 'ArrowLeft'), +(ev.key === 'ArrowDown') - +(ev.key === 'ArrowUp'))
    else return
    ev.preventDefault()
  }

  const note = textAt && sym?.shapes[textAt.i]?.t === 'note' ? (sym.shapes[textAt.i] as Extract<Drawing, { t: 'note' }>) : undefined
  const editNote = (f: 'text' | 'size', v: string | number) => sym && textAt && put({ ...sym, shapes: sym.shapes.map((s, i) => (i === textAt.i ? ({ ...s, [f]: v } as Drawing) : s)) })
  const editPin = (i: number, f: 'name' | 'map', v: string | number) => sym && commit({ ...sym, pins: sym.pins.map((q, j) => (j === i ? { ...q, [f]: v } : q)) })
  const ghost: Shape | null = !start || !cursor || tool === 'select' || tool === 'text' || tool === 'pin' ? null
    : tool === 'triangle' ? { id: '', t: 'poly', pts: tri(start, cursor) } : { id: '', t: tool, a: start, b: cursor }
  const stroke = (on: boolean) => cn('fill-none stroke-[1.5] [vector-effect:non-scaling-stroke]', on ? 'stroke-[var(--sel)]' : 'stroke-foreground')
  const short = (id: string) => keyLabel(keysOf(id))

  // the pin list: beside the canvas, or in `side`
  const panel = (
    <div className={fill ? 'grid gap-2 text-xs' : 'flex min-h-0 min-w-[200px] flex-1 flex-col gap-2 overflow-y-auto text-xs'}>
      {sym && (
        <>
          <div className="font-medium text-muted-foreground">Pins</div>
          {!sym.pins.length && <p className="text-muted-foreground">Choose the pin tool and click where each pin goes.</p>}
          {sym.pins.map((q, i) => (
            <div key={i} className={cn('grid grid-cols-[1fr_1fr_auto] items-center gap-1.5 rounded-md p-0.5', sel.has('p' + i) && 'bg-accent')}>
              <Input aria-label={`Pin ${i + 1} name`} className="h-7 font-mono text-xs md:text-xs" value={q.name} onChange={(ev) => editPin(i, 'name', ev.target.value)} onFocus={() => setSel(new Set(['p' + i]))} />
              <Select value={String(q.map)} onValueChange={(v) => editPin(i, 'map', +v)}>
                <SelectTrigger size="sm" aria-label={`Pin ${i + 1} connects to`} className="h-7 w-full font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="-1">—</SelectItem>
                  {names.map((n, j) => <SelectItem key={j} value={String(j)} className="font-mono text-xs">{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon-xs" aria-label={`Delete pin ${q.name}`} onClick={() => commit({ ...sym, pins: sym.pins.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <p className="text-muted-foreground">Each pin has the name shown on the symbol and the {e.spice?.type === 'subckt' ? 'subcircuit' : 'model'} pin it connects to.</p>
          {errs.map((x) => <p key={x} className="text-destructive">{x}</p>)}
        </>
      )}
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={keys}>
      <div className="flex min-h-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        {lead}
        {sym && (
          <>
            <ToggleGroup type="single" size="sm" value={tool} aria-label="Drawing tool">
              {TOOLS.map(([t, label, icon]) => (
                <Tip key={t} label={label}><ToggleGroupItem value={t} aria-label={label} className="h-7 min-w-7 px-1.5" onClick={() => use(t)}>{icon}</ToggleGroupItem></Tip>
              ))}
            </ToggleGroup>
            <Tip label={`Rotate the selection, or the whole symbol (${short('edit.rotate')})`}><Button variant="ghost" size="icon-sm" className="size-7" aria-label="Rotate" onClick={() => turn('rotate')}><RotateCw /></Button></Tip>
            <Tip label={`Mirror the selection, or the whole symbol (${short('edit.mirror')})`}><Button variant="ghost" size="icon-sm" className="size-7" aria-label="Mirror" onClick={() => turn('mirror')}><FlipHorizontal2 /></Button></Tip>
            <Tip label="Delete the selection (Delete)"><Button variant="ghost" size="icon-sm" className="size-7" aria-label="Delete" disabled={!some} onClick={del}><Trash2 /></Button></Tip>
            <span className="ml-auto flex gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => (commit(defaultSymbol(e)), setSel(NONE))}>Start from a box</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => (commit(null), setSel(NONE))}>Use the standard symbol</Button>
            </span>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-4 py-3">
        <div ref={wrap} className={cn('relative overflow-hidden rounded-md border bg-background', fill ? 'min-w-0 flex-1' : 'w-[440px] shrink-0 self-start')}>
          <svg ref={svg} tabIndex={0} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} className={cn('block w-full touch-none outline-none select-none', fill ? 'h-full' : 'aspect-[4/3]', tool !== 'select' && 'cursor-crosshair')}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setCursor(null)}
            onDoubleClick={() => setStart(null)} onContextMenu={context} aria-label="Symbol drawing">
            <defs><pattern id="syme-grid" width={10} height={10} patternUnits="userSpaceOnUse" x={VB.x} y={VB.y}><circle r={0.5} className="fill-muted-foreground/40" /></pattern></defs>
            <rect x={-1500} y={-1500} width={3000} height={3000} fill="url(#syme-grid)" />
            <path d="M-4 0H4M0 -4V4" className="stroke-muted-foreground/50 stroke-[0.5]" />
            {sym?.shapes.map((d, i) => {
              const on = sel.has('s' + i)
              if (d.t === 'note') return <text key={i} data-k={'s' + i} x={d.x} y={d.y + (d.size ?? 7) * 0.85} fontSize={d.size ?? 7} className={cn('cursor-move font-mono', on ? 'fill-[var(--sel)]' : 'fill-foreground')}>{d.text}</text>
              if (d.t === 'title') return null
              const { path, fill: solid } = shapePath(d)
              return (
                <g key={i} data-k={'s' + i} className="cursor-move">
                  <path d={path} className="fill-none stroke-transparent stroke-[8]" />
                  {solid && <path d={solid} className={on ? 'fill-[var(--sel)]' : 'fill-foreground'} />}
                  <path d={path} className={stroke(on)} />
                </g>
              )
            })}
            {sym?.pins.map((q, i) => {
              const on = sel.has('p' + i), l = q.x < 0
              return (
                <g key={'p' + i} data-k={'p' + i} className="cursor-move">
                  <circle cx={q.x} cy={q.y} r={2.2} className={on ? 'fill-[var(--sel)]' : 'fill-[var(--wire)]'} />
                  <text x={q.x + (l ? -3 : 3)} y={q.y - 3} fontSize={6} textAnchor={l ? 'end' : 'start'} className="fill-muted-foreground font-mono">{q.name}</text>
                </g>
              )
            })}
            {ghost && <path d={shapePath(ghost).path} className="fill-none stroke-[var(--hl)] stroke-[1.5] opacity-70 [vector-effect:non-scaling-stroke]" />}
            {band && <rect x={Math.min(band.a.x, band.b.x)} y={Math.min(band.a.y, band.b.y)} width={Math.abs(band.b.x - band.a.x)} height={Math.abs(band.b.y - band.a.y)} className="fill-[var(--sel)] stroke-[var(--sel)] stroke-[1] [fill-opacity:0.08] [vector-effect:non-scaling-stroke]" />}
            {cursor && tool !== 'select' && <circle cx={cursor.x} cy={cursor.y} r={1.5} className="fill-[var(--hl)]" />}
          </svg>
          {!sym && (
            <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 bg-background/70 p-6 text-center text-xs">
              <Button size="sm" onClick={() => put(standardSymbol(e))}>Draw {e.name}'s symbol</Button>
              <span className="max-w-[260px] text-muted-foreground">Starts from its standard symbol, ready to change. Without a drawing, {e.name} uses its standard symbol on the canvas, in the parts list and in exports.</span>
            </div>
          )}
          {/* a text's properties, where it was double-clicked */}
          {note && textAt && (
            <div className="absolute z-10 grid w-56 gap-1.5 rounded-md border bg-popover p-2 shadow-md" style={{ left: textAt.left, top: textAt.top }} role="dialog" aria-label="Text"
              onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') ev.stopPropagation(), ev.preventDefault(), setTextAt(null), svg.current?.focus() }}>
              <Label className={FLD}>Text<Input autoFocus onFocus={(ev) => ev.target.select()} className="h-7 font-mono text-xs md:text-xs" value={note.text} maxLength={200} onChange={(ev) => editNote('text', ev.target.value)} /></Label>
              <Label className={FLD}>Size
                <Select value={String(note.size ?? 7)} onValueChange={(v) => editNote('size', +v)}>
                  <SelectTrigger size="sm" className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{[['Tiny', 5] as const, ['Small', 7] as const, ...NOTE_SIZES.slice(1)].map(([l, v]) => <SelectItem key={v} value={String(v)}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </Label>
            </div>
          )}
          {/* right-click menu: a zero-size trigger at the pointer anchors the dropdown (as on the schematic) */}
          <DropdownMenu open={!!menu} onOpenChange={(o) => !o && setMenu(null)}>
            <DropdownMenuTrigger asChild><span className="pointer-events-none absolute size-0" style={{ left: menu?.left ?? 0, top: menu?.top ?? 0 }} /></DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="w-52" onCloseAutoFocus={(ev) => (ev.preventDefault(), svg.current?.focus())}>
              {canFill.length > 0 && <DropdownMenuItem onSelect={setFill}>{filled ? 'Remove fill' : 'Fill'}</DropdownMenuItem>}
              {k.shapes.length === 1 && !k.pins.length && sym?.shapes[k.shapes[0]].t === 'note' && <DropdownMenuItem onSelect={() => { const m = menu!, i = k.shapes[0]; setTimeout(() => (hist.current.undo.push(sym), setTextAt({ i, left: m.left, top: m.top }))) }}>Change text…</DropdownMenuItem>}
              {(canFill.length > 0 || (k.shapes.length === 1 && sym?.shapes[k.shapes[0]].t === 'note')) && <DropdownMenuSeparator />}
              <DropdownMenuItem disabled={!some} onSelect={() => (copy(), del())}>Cut<DropdownMenuShortcut>{keyLabel('Mod+X')}</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled={!k.shapes.length} onSelect={copy}>Copy<DropdownMenuShortcut>{keyLabel('Mod+C')}</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled={!clip.current.length} onSelect={() => paste(clip.current)}>Paste<DropdownMenuShortcut>{keyLabel('Mod+V')}</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled={!k.shapes.length} onSelect={() => sym && paste(k.shapes.map((i) => sym.shapes[i]))}>Duplicate<DropdownMenuShortcut>{short('edit.duplicate')}</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled={!some} onSelect={del}>Delete<DropdownMenuShortcut>Del</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => turn('rotate')}>{some ? 'Rotate' : 'Rotate the symbol'}<DropdownMenuShortcut>{short('edit.rotate')}</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => turn('mirror')}>{some ? 'Mirror' : 'Mirror the symbol'}<DropdownMenuShortcut>{short('edit.mirror')}</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={all}>Select all<DropdownMenuShortcut>{keyLabel('Mod+A')}</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled={!hist.current.undo.length} onSelect={undo}>Undo<DropdownMenuShortcut>{keyLabel('Mod+Z')}</DropdownMenuShortcut></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {fill ? side && createPortal(panel, side) : panel}
      </div>
    </div>
  )
}
// a triangle from two clicks: the flat side runs down from the first, the point is level with its middle at the second
const tri = (a: Pt, b: Pt): Pt[] => [a, { x: a.x, y: b.y }, { x: b.x, y: (a.y + b.y) / 2 }]

export function SymbolEditor({ lib, text, onSave, onClose }: { lib: ImportedLib; text: string; onSave: (l: ImportedLib) => Promise<unknown>; onClose: () => void }) {
  const parsed = useMemo(() => parseLibFile(text), [text])
  // each entry as customSymbol.ts wants it: its kind + subckt pins / pin map (models: the kind's pins)
  const ents = useMemo(() => lib.entries.map((e) => {
    const s = parsed.subckts.find((x) => x.name.toLowerCase() === e.name.toLowerCase())
    return { ...e, spice: s ? { type: 'subckt' as const, pins: s.pins, pinMap: e.pinMap } : { type: 'model' as const } }
  }), [lib, parsed])
  const [idx, setIdx] = useState(0)
  const [syms, setSyms] = useState<Record<number, CustomSymbol | null>>({}) // edited: symbol, or null = back to the generic one
  const e = ents[idx], sym = idx in syms ? syms[idx] : (e.symbol ?? null)
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const esc = useRef(() => false)
  const bad = Object.entries(syms).flatMap(([i, s]) => (s && symbolErrors(s, ents[+i]).length ? [ents[+i].name] : []))

  async function save() {
    setBusy(true), setErr('')
    try {
      await onSave({ ...lib, entries: lib.entries.map((x, i) => {
        if (!(i in syms)) return x
        const { symbol: _, ...rest } = x, s = syms[i]
        return s ? { ...rest, symbol: s } : rest
      }) })
      onClose()
    } catch (ex) {
      setErr(String((ex as Error)?.message ?? ex))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby="syme-d" className="flex max-h-[calc(100%-1rem)] flex-col gap-0 p-0 sm:max-w-[740px]"
        onEscapeKeyDown={(ev) => { if (esc.current()) ev.preventDefault() }} onKeyDown={(ev) => ev.stopPropagation()}>
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">Symbols in <code className="font-mono text-xs">{lib.file.replace(/^libs\//, '')}</code></DialogTitle>
          <DialogDescription id="syme-d" className="text-xs">Draw the part's symbol and place its pins on the grid. Each pin connects to one of the part's {e.spice.type === 'subckt' ? 'subcircuit' : 'model'} pins.</DialogDescription>
        </DialogHeader>
        <SymbolPad key={idx} e={e} sym={sym} put={(s) => setSyms((m) => ({ ...m, [idx]: s }))} esc={esc} lead={
          <Select value={String(idx)} onValueChange={(v) => setIdx(+v)}>
            <SelectTrigger size="sm" aria-label="Part" className="h-7 w-48 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{ents.map((x, i) => <SelectItem key={i} value={String(i)} className="font-mono text-xs">{x.name}{(i in syms ? syms[i] : x.symbol) ? ' ·' : ''}</SelectItem>)}</SelectContent>
          </Select>} />
        <DialogFooter className="items-center border-t px-4 py-3">
          <span className="mr-auto text-xs text-destructive">{err || (bad.length ? `Fix the pins of ${bad.join(', ')} to save` : '')}</span>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy || !Object.keys(syms).length || bad.length > 0}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
