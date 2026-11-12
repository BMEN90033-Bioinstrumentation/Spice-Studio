// Symbol editor (Manage Libraries › Symbols… on one of your libraries): draw a part's symbol on the grid (lines,
// rectangles, ellipses, text) and place its pins, each connected to a subckt pin (or the model's C/B/E…). Saved on the
// library entry (customSymbol.ts); parts placed afterwards use it.
import { useMemo, useRef, useState, type PointerEvent as RPE } from 'react'
import { snap, uid, type Drawing, type Pt } from '../schematic/model'
import { NOTE_SIZES, shapePath } from '../schematic/drawings'
import { parseLibFile, type ImportedLib } from './library'
import { defaultSymbol, symbolErrors, targets, type CustomSymbol } from './customSymbol'
import { Circle, Minus, MousePointer2, Square, Trash2, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tip } from '@/components/ui/tip'
import { cn } from '@/lib/utils'

type Tool = 'select' | 'line' | 'rect' | 'ellipse' | 'text' | 'pin'
type Sel = { k: 'shape' | 'pin'; i: number } | null
const TOOLS: [Tool, string, React.ReactNode][] = [
  ['select', 'Select and move (Delete removes)', <MousePointer2 />], ['line', 'Line: click start, click end; keeps going until Esc', <Minus />],
  ['rect', 'Rectangle: click two corners', <Square />], ['ellipse', 'Ellipse: click two corners', <Circle />], ['text', 'Text: click to place', <Type />],
  ['pin', 'Pin: click a grid point; it connects to the next free pin', <span className="font-mono text-[11px]">pin</span>]
]
const VB = { x: -120, y: -90, w: 240, h: 180 } // world units shown; grid 10
const FLD = 'grid gap-1 text-[11px] font-normal text-muted-foreground'
const moved = (d: Drawing, v: Pt): Drawing => ('a' in d ? { ...d, a: { x: d.a.x + v.x, y: d.a.y + v.y }, b: { x: d.b.x + v.x, y: d.b.y + v.y } } : d.t === 'note' ? { ...d, x: d.x + v.x, y: d.y + v.y } : d)

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
  const [tool, setTool] = useState<Tool>('select')
  const [start, setStart] = useState<Pt | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [sel, setSel] = useState<Sel>(null)
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const drag = useRef<{ from: Pt; base: CustomSymbol; d: Pt } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const names = targets(e)
  const errs = sym ? symbolErrors(sym, e) : []
  const bad = Object.entries(syms).flatMap(([i, s]) => (s && symbolErrors(s, ents[+i]).length ? [ents[+i].name] : []))

  const put = (s: CustomSymbol | null) => setSyms((m) => ({ ...m, [idx]: s }))
  const world = (ev: { clientX: number; clientY: number }): Pt => {
    const m = svg.current!.getScreenCTM()!.inverse(), p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m)
    return { x: snap(p.x), y: snap(p.y) }
  }
  function pick(i: number) { setIdx(i), setSel(null), setStart(null), setTool('select') }
  function use(t: Tool) { setTool(t), setStart(null), setSel(null) }
  function del() {
    if (!sym || !sel) return
    put(sel.k === 'shape' ? { ...sym, shapes: sym.shapes.filter((_, i) => i !== sel.i) } : { ...sym, pins: sym.pins.filter((_, i) => i !== sel.i) })
    setSel(null)
  }

  function down(ev: RPE<SVGSVGElement>) {
    if (!sym || ev.button !== 0) return
    const p = world(ev)
    if (tool === 'select') {
      const hit = (ev.target as Element).closest('[data-k]')?.getAttribute('data-k')
      if (!hit) return setSel(null)
      setSel({ k: hit[0] === 's' ? 'shape' : 'pin', i: +hit.slice(1) })
      drag.current = { from: p, base: sym, d: { x: 0, y: 0 } }
      return ev.currentTarget.setPointerCapture(ev.pointerId)
    }
    if (tool === 'text') return put({ ...sym, shapes: [...sym.shapes, { id: uid(), t: 'note', x: p.x, y: p.y, text: 'Text', size: 7 }] }), setSel({ k: 'shape', i: sym.shapes.length }), setTool('select')
    if (tool === 'pin') {
      const used = new Set(sym.pins.map((q) => q.map)), free = names.findIndex((_, j) => !used.has(j))
      if (sym.pins.some((q) => q.x === p.x && q.y === p.y)) return
      return put({ ...sym, pins: [...sym.pins, { name: free < 0 ? `P${sym.pins.length + 1}` : names[free], x: p.x, y: p.y, map: free }] })
    }
    if (!start) return setStart(p)
    if (p.x === start.x && p.y === start.y) return
    put({ ...sym, shapes: [...sym.shapes, { id: uid(), t: tool, a: start, b: p }] })
    setStart(tool === 'line' ? p : null)
  }
  function move(ev: RPE<SVGSVGElement>) {
    const p = world(ev), d = drag.current
    setCursor(p)
    if (!d || !sel) return
    const v = { x: p.x - d.from.x, y: p.y - d.from.y }
    if (v.x === d.d.x && v.y === d.d.y) return
    d.d = v
    put(sel.k === 'shape' ? { ...d.base, shapes: d.base.shapes.map((s, i) => (i === sel.i ? moved(s, v) : s)) }
      : { ...d.base, pins: d.base.pins.map((q, i) => (i === sel.i ? { ...q, x: q.x + v.x, y: q.y + v.y } : q)) })
  }

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

  const selShape = sel?.k === 'shape' && sym ? sym.shapes[sel.i] : undefined
  const editShape = (f: string, v: string | number) => sym && sel && put({ ...sym, shapes: sym.shapes.map((s, i) => (i === sel.i ? ({ ...s, [f]: v } as Drawing) : s)) })
  const editPin = (i: number, f: 'name' | 'map', v: string | number) => sym && put({ ...sym, pins: sym.pins.map((q, j) => (j === i ? { ...q, [f]: v } : q)) })
  const ghost: Drawing | null = start && cursor && tool !== 'select' && tool !== 'text' && tool !== 'pin' ? { id: '', t: tool, a: start, b: cursor } : null
  const stroke = (on: boolean) => cn('fill-none stroke-[1.5] [vector-effect:non-scaling-stroke]', on ? 'stroke-[var(--sel)]' : 'stroke-foreground')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby="syme-d" className="flex max-h-[calc(100%-1rem)] flex-col gap-0 p-0 sm:max-w-[740px]"
        onEscapeKeyDown={(ev) => { if (start || tool !== 'select') ev.preventDefault(), use('select') }}
        onKeyDown={(ev) => {
          ev.stopPropagation()
          if ((ev.key === 'Delete' || ev.key === 'Backspace') && !(ev.target as Element).closest('input,textarea')) ev.preventDefault(), del()
        }}>
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">Symbols in <code className="font-mono text-xs">{lib.file.replace(/^libs\//, '')}</code></DialogTitle>
          <DialogDescription id="syme-d" className="text-xs">Draw the part's symbol and place its pins on the grid. Each pin connects to one of the part's {e.spice.type === 'subckt' ? 'subcircuit' : 'model'} pins.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <Select value={String(idx)} onValueChange={(v) => pick(+v)}>
            <SelectTrigger size="sm" aria-label="Part" className="h-7 w-48 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{ents.map((x, i) => <SelectItem key={i} value={String(i)} className="font-mono text-xs">{x.name}{(i in syms ? syms[i] : x.symbol) ? ' ·' : ''}</SelectItem>)}</SelectContent>
          </Select>
          {sym ? (
            <>
              <ToggleGroup type="single" size="sm" value={tool} aria-label="Drawing tool">
                {TOOLS.map(([t, label, icon]) => (
                  <Tip key={t} label={label}><ToggleGroupItem value={t} aria-label={label} className="h-7 min-w-7 px-1.5" onClick={() => use(t)}>{icon}</ToggleGroupItem></Tip>
                ))}
              </ToggleGroup>
              <Tip label="Delete the selection (Delete)"><Button variant="ghost" size="icon-sm" className="size-7" aria-label="Delete" disabled={!sel} onClick={del}><Trash2 /></Button></Tip>
              <span className="ml-auto flex gap-1.5">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => (put(defaultSymbol(e)), setSel(null))}>Start from a box</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => (put(null), setSel(null))}>Use the generic symbol</Button>
              </span>
            </>
          ) : (
            <Button size="sm" className="h-7 text-xs" onClick={() => put(defaultSymbol(e))}>Draw a custom symbol</Button>
          )}
        </div>
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden px-4 py-3">
          <div className="shrink-0 overflow-hidden rounded-md border bg-background">
            <svg ref={svg} width={440} height={330} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} className={cn('block touch-none select-none', tool !== 'select' && 'cursor-crosshair')}
              onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerLeave={() => setCursor(null)}
              onDoubleClick={() => setStart(null)} aria-label="Symbol drawing">
              <defs><pattern id="syme-grid" width={10} height={10} patternUnits="userSpaceOnUse" x={VB.x} y={VB.y}><circle r={0.5} className="fill-muted-foreground/40" /></pattern></defs>
              <rect x={VB.x} y={VB.y} width={VB.w} height={VB.h} fill="url(#syme-grid)" />
              <path d="M-4 0H4M0 -4V4" className="stroke-muted-foreground/50 stroke-[0.5]" />
              {sym?.shapes.map((d, i) => {
                const on = sel?.k === 'shape' && sel.i === i
                if (d.t === 'note') return <text key={i} data-k={'s' + i} x={d.x} y={d.y + (d.size ?? 7) * 0.85} fontSize={d.size ?? 7} className={cn('cursor-move font-mono', on ? 'fill-[var(--sel)]' : 'fill-foreground')}>{d.text}</text>
                if (!('a' in d)) return null
                const { path, fill } = shapePath(d)
                return (
                  <g key={i} data-k={'s' + i} className="cursor-move">
                    <path d={path} className="fill-none stroke-transparent stroke-[8]" />
                    <path d={path} className={stroke(on)} />
                    {fill && <path d={fill} className={on ? 'fill-[var(--sel)]' : 'fill-foreground'} />}
                  </g>
                )
              })}
              {sym?.pins.map((q, i) => {
                const on = sel?.k === 'pin' && sel.i === i, l = q.x < 0
                return (
                  <g key={'p' + i} data-k={'p' + i} className="cursor-move">
                    <circle cx={q.x} cy={q.y} r={2.2} className={on ? 'fill-[var(--sel)]' : 'fill-[var(--wire)]'} />
                    <text x={q.x + (l ? -3 : 3)} y={q.y - 3} fontSize={6} textAnchor={l ? 'end' : 'start'} className="fill-muted-foreground font-mono">{q.name}</text>
                  </g>
                )
              })}
              {ghost && 'a' in ghost && <path d={shapePath(ghost).path} className="fill-none stroke-[var(--hl)] stroke-[1.5] opacity-70 [vector-effect:non-scaling-stroke]" />}
              {cursor && tool !== 'select' && <circle cx={cursor.x} cy={cursor.y} r={1.5} className="fill-[var(--hl)]" />}
            </svg>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto text-xs">
            {!sym && <p className="text-muted-foreground">{e.name} uses the generic symbol. Draw a custom symbol to change how it looks on the canvas, in the parts list and in exports.</p>}
            {selShape?.t === 'note' && (
              <div className="grid gap-1.5 rounded-md border p-2">
                <Label className={FLD}>Text<Input className="h-7 font-mono text-xs md:text-xs" value={selShape.text} onChange={(ev) => editShape('text', ev.target.value)} /></Label>
                <Label className={FLD}>Size
                  <Select value={String(selShape.size ?? 7)} onValueChange={(v) => editShape('size', +v)}>
                    <SelectTrigger size="sm" className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{[['Tiny', 5] as const, ['Small', 7] as const, ...NOTE_SIZES.slice(1)].map(([l, v]) => <SelectItem key={v} value={String(v)}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </Label>
              </div>
            )}
            {sym && (
              <>
                <div className="font-medium text-muted-foreground">Pins</div>
                {!sym.pins.length && <p className="text-muted-foreground">Choose the pin tool and click where each pin goes.</p>}
                {sym.pins.map((q, i) => (
                  <div key={i} className={cn('grid grid-cols-[1fr_1fr_auto] items-center gap-1.5 rounded-md p-0.5', sel?.k === 'pin' && sel.i === i && 'bg-accent')}>
                    <Input aria-label={`Pin ${i + 1} name`} className="h-7 font-mono text-xs md:text-xs" value={q.name} onChange={(ev) => editPin(i, 'name', ev.target.value)} onFocus={() => setSel({ k: 'pin', i })} />
                    <Select value={String(q.map)} onValueChange={(v) => editPin(i, 'map', +v)}>
                      <SelectTrigger size="sm" aria-label={`Pin ${i + 1} connects to`} className="h-7 w-full font-mono text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-1">—</SelectItem>
                        {names.map((n, j) => <SelectItem key={j} value={String(j)} className="font-mono text-xs">{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon-xs" aria-label={`Delete pin ${q.name}`} onClick={() => put({ ...sym, pins: sym.pins.filter((_, j) => j !== i) })}><Trash2 /></Button>
                  </div>
                ))}
                {errs.map((x) => <p key={x} className="text-destructive">{x}</p>)}
              </>
            )}
          </div>
        </div>
        <DialogFooter className="items-center border-t px-4 py-3">
          <span className="mr-auto text-xs text-destructive">{err || (bad.length ? `Fix the pins of ${bad.join(', ')} to save` : '')}</span>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy || !Object.keys(syms).length || bad.length > 0}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
