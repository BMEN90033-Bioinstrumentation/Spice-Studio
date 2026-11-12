// Collapsible parts browser on the left of the schematic canvas: every enabled library's parts merged into the part
// categories (no library names here: Manage Libraries shows those); thousands of rows, so the list is windowed (VList),
// search is debounced and matched against one cached lower-case string per entry. The footer opens Manage Libraries.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKE, type ReactNode, type Ref } from 'react'
import { runCommand } from '../commands'
import { blockShape, sheetPorts, type Sheet } from '../schematic/model'
import type { Kind } from '../schematic/symbols'
import { blockPartFields, CATEGORIES, type LibEntry } from './library'
import { SymbolPreview } from './Symbol'
import { symbolFields } from './customSymbol'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tip'
import { cn } from '@/lib/utils'

export type SheetItem = { file: string; sheet: Sheet }
export type LibPick = LibEntry | SheetItem
export const sheetName = (file: string) => file.replace(/^.*\//, '').replace(/\.nsch$/i, '')

// name, description, category and value (what the lists show); every whitespace-separated term must appear
const HAY = new WeakMap<LibEntry, string>()
const hay = (e: LibEntry) => {
  let h = HAY.get(e)
  if (h == null) HAY.set(e, (h = [e.name, e.description, e.category, e.value].join('\n').toLowerCase()))
  return h
}
export const match = (e: LibEntry, q: string) => !q || q.split(/\s+/).every((t) => hay(e).includes(t))

export function useDebounced<T>(v: T, ms = 100): T {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setD(v), v ? ms : 0) // clearing applies at once
    return () => clearTimeout(t)
  }, [v])
  return d
}

// one element per kind, reused by every row: React skips identical elements, so minis cost nothing after the first
const MINI: Partial<Record<Kind, ReactNode>> = {}
export const mini = (e: LibEntry) =>
  e.symbol ? <SymbolPreview kind={e.kind} part={symbolFields(e) ?? (e.kind === 'block' ? blockPartFields(e) : undefined)} size="small" /> // custom (symbol editor)
  : e.kind === 'block' ? <SymbolPreview kind="block" part={blockPartFields(e)} size="small" /> : (MINI[e.kind] ??= <SymbolPreview kind={e.kind} size="small" />)

// Windowed list: fixed per-item heights, only rows within the viewport (+ overscan) are mounted. Rows keep their
// DOM focus while on screen; focus() on the next row scrolls it into view, so arrow keys still walk the list.
export function VList<T>({ items, height, keyOf, render, className, reset, onKeyDown, label }: {
  items: T[]; height: (t: T) => number; keyOf: (t: T) => string; render: (t: T) => ReactNode
  className: string; reset?: unknown; onKeyDown?: (e: RKE<HTMLDivElement>) => void; label?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, h: 0 })
  const tops = useMemo(() => {
    const t = new Float64Array(items.length + 1)
    items.forEach((x, i) => (t[i + 1] = t[i] + height(x)))
    return t
  }, [items])
  useLayoutEffect(() => {
    const el = ref.current!, upd = () => setView({ top: el.scrollTop, h: el.clientHeight })
    const ro = new ResizeObserver(upd)
    ro.observe(el), upd()
    return () => ro.disconnect()
  }, [])
  useLayoutEffect(() => { if (ref.current) ref.current.scrollTop = 0 }, [reset])
  const OVER = 300, lo = view.top - OVER, hi = view.top + (view.h || 1000) + OVER
  let a = 0, b = items.length
  while (a < b) { const m = (a + b) >> 1; tops[m + 1] <= lo ? (a = m + 1) : (b = m) } // first row ending below lo
  const rows: ReactNode[] = []
  for (let i = a; i < items.length && tops[i] < hi; i++)
    rows.push(<div key={keyOf(items[i])} className="vrow" style={{ top: tops[i], height: tops[i + 1] - tops[i] }}>{render(items[i])}</div>)
  return (
    <div ref={ref} className={className} aria-label={label} onKeyDown={onKeyDown}
      onScroll={(e) => setView({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })}>
      <div className="vlist" style={{ height: tops[items.length] }}>{rows}</div>
    </div>
  )
}

type Row =
  | { t: 'h'; key: string; label: string; n: number; open: boolean }
  | { t: 'e'; e: LibEntry }
  | { t: 's'; s: SheetItem }
const H = { h: 28, item: 38 }
const BIG = 60 // categories with more parts than this (library parts merged in) start collapsed
const rowH = (r: Row) => (r.t === 'h' ? H.h : H.item)
const rowKey = (r: Row) => (r.t === 'h' ? r.key : r.t === 'e' ? r.e.id : 'sheet:' + r.s.file)
// row chrome: fills its VList slot (.vrow > * is 100% high), so no size variant
const CAT = 'w-full justify-start gap-1.5 rounded-sm px-1.5 pt-2 pb-1 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent [&_svg]:size-3'
const ITEM = 'w-full justify-start gap-2 overflow-hidden px-1.5 py-1 text-left font-normal [&_.symp]:size-[34px]!'
const Item = ({ on, tip, onClick, sym, name, sub }: { on: boolean; tip: string; onClick: () => void; sym: ReactNode; name: string; sub: string }) => (
  <Tip label={tip} side="right">
    <Button variant="ghost" size={null} data-item className={cn(ITEM, on && 'bg-accent dark:hover:bg-accent')} onClick={onClick}>
      {sym}
      <span className="grid min-w-0 flex-1">
        <b className="truncate text-xs font-medium">{name}</b>
        <small className="truncate text-[11px] text-muted-foreground">{sub}</small>
      </span>
    </Button>
  </Tip>
)
const catRank = (g: string) => { const i = CATEGORIES.indexOf(g as never); return i < 0 ? CATEGORIES.length : i }

export function LibraryPanel({ entries, sheets, onPick, active, search }: {
  entries: LibEntry[]; sheets: SheetItem[]; onPick: (p: LibPick) => void; active?: string; search?: Ref<HTMLInputElement>
}) {
  const [q, setQ] = useState('')
  const [flip, setFlip] = useState<Set<string>>(() => new Set()) // headers toggled away from their default
  const ql = useDebounced(q.trim().toLowerCase())
  const { rows, total } = useMemo(() => {
    // every part by category (CATEGORIES order), then this project's sheets; a search opens everything
    const groups = new Map<string, LibEntry[]>()
    let total = 0
    for (const e of entries) {
      if (!match(e, ql)) continue
      const g = e.category
      groups.get(g)?.push(e) ?? groups.set(g, [e])
      total++
    }
    const open = (key: string, def: boolean) => !!ql || def !== flip.has(key)
    const rows: Row[] = []
    for (const [g, es] of [...groups].sort((a, b) => catRank(a[0]) - catRank(b[0]))) {
      const o = open('g:' + g, es.length <= BIG)
      rows.push({ t: 'h', key: 'g:' + g, label: g, n: es.length, open: o })
      if (o) for (const e of es) rows.push({ t: 'e', e })
    }
    const sh = sheets.filter((s) => !ql || s.file.toLowerCase().includes(ql))
    if (sh.length) {
      const o = open('g:Sheets', true)
      rows.push({ t: 'h', key: 'g:Sheets', label: 'Sheets', n: sh.length, open: o })
      if (o) for (const s of sh) rows.push({ t: 's', s })
    }
    return { rows, total: total + sh.length }
  }, [entries, sheets, ql, flip])
  const toggle = (k: string) => setFlip((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  // Enter may beat the debounce: match the box's current text, in display order (first entry, else first sheet)
  const first = () => {
    const t = q.trim().toLowerCase()
    let best: LibEntry | undefined
    for (const e of entries) if (match(e, t) && (!best || catRank(e.category) < catRank(best.category))) best = e
    return best ?? sheets.find((s) => !t || s.file.toLowerCase().includes(t))
  }

  const render = (r: Row) => {
    if (r.t === 'h')
      return (
        <Button variant="ghost" size={null} className={CAT} aria-expanded={r.open} onClick={() => toggle(r.key)}>
          {r.open ? <ChevronDown /> : <ChevronRight />}
          <span className="min-w-0 truncate">{r.label}</span>
          <span className="ml-auto font-mono text-[10px] font-normal opacity-70">{r.n.toLocaleString()}</span>
        </Button>
      )
    if (r.t === 'e') {
      const e = r.e
      return <Item on={active === e.id} tip={e.description} onClick={() => onPick(e)} sym={mini(e)} name={e.name} sub={e.description} />
    }
    const s = r.s
    return (
      <Item on={active === 'sheet:' + s.file} tip={`Place ${s.file} as a block`} onClick={() => onPick(s)}
        sym={<SymbolPreview kind="block" part={blockShape(sheetPorts(s.sheet))} size="small" />} name={sheetName(s.file)} sub={sheetPorts(s.sheet).join(', ') || 'no ports'} />
    )
  }

  return (
    // width 240px = LIBW in Schematic.tsx
    <aside className="panel-in absolute inset-y-0 left-0 z-2 flex w-[240px] flex-col border-r bg-card" aria-label="Parts library">
      <div className="border-b p-2">
        <Input ref={search} type="search" className="h-8 text-xs md:text-xs" placeholder="Search parts  ( / )" aria-label="Search parts" value={q} spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            const f = e.key === 'Enter' ? first() : undefined
            if (f) onPick(f)
            else if (e.key === 'Escape') setQ(''), e.currentTarget.blur()
            else if (e.key === 'ArrowDown') (e.preventDefault(), e.currentTarget.closest('aside')?.querySelector<HTMLElement>('[data-item]')?.focus())
          }} />
        {ql && <small className="mt-1 block px-0.5 text-[10px] text-muted-foreground" aria-live="polite">{total ? `${total.toLocaleString()} match${total === 1 ? '' : 'es'} · ↵ places the first` : ''}</small>}
      </div>
      {rows.length ? <VList className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-1 pb-3" label="Parts" items={rows} height={rowH} keyOf={rowKey} render={render} reset={ql}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-item]')], i = all.indexOf(document.activeElement as HTMLElement)
          e.preventDefault()
          all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
        }} /> : <p className="flex-1 p-2 text-xs text-muted-foreground">No parts match “{q}”</p>}
      <div className="border-t p-2">
        <Tip label="Show, hide or import component libraries">
          <Button variant="secondary" size="sm" className="w-full text-xs" onClick={() => runCommand('tools.manageLibraries')}>Manage libraries…</Button>
        </Tip>
      </div>
    </aside>
  )
}
