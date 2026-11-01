// Collapsible parts browser on the left of the schematic canvas.
import { useMemo, useState, type ReactNode, type Ref } from 'react'
import { blockShape, sheetPorts, type Sheet } from '../schematic/model'
import { blockPartFields, type LibEntry } from './library'
import { SymbolPreview } from './Symbol'

export type SheetItem = { file: string; sheet: Sheet }
export type LibPick = LibEntry | SheetItem
export const sheetName = (file: string) => file.replace(/^.*\//, '').replace(/\.nsch$/i, '')

export const match = (e: LibEntry, q: string) =>
  !q || [e.name, e.description, e.category, e.value].some((s) => s.toLowerCase().includes(q))

export function LibraryPanel({ entries, sheets, onPick, active, search }: {
  entries: LibEntry[]; sheets: SheetItem[]; onPick: (p: LibPick) => void; active?: string; search?: Ref<HTMLInputElement>
}) {
  const [q, setQ] = useState('')
  const [shut, setShut] = useState<Set<string>>(() => new Set())
  const ql = q.trim().toLowerCase()
  const groups = useMemo(() => {
    const m = new Map<string, LibEntry[]>()
    // bundled parts by category, then one group per source: 'Project', 'My library', each pack
    for (const e of entries) if (match(e, ql)) m.set(e.group ?? e.category, [...(m.get(e.group ?? e.category) ?? []), e])
    return [...m]
  }, [entries, ql])
  const sh = sheets.filter((s) => !ql || s.file.toLowerCase().includes(ql))
  const first = groups[0]?.[1][0] ?? sh[0]
  const toggle = (c: string) => setShut((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n })

  // plain function, not a component: an inner component type would remount (and drop focus) every render
  const group = (c: string, n: number, children: ReactNode) => {
    const open = !!ql || !shut.has(c)
    return (
      <section key={c}>
        <button className="libp-cat" aria-expanded={open} onClick={() => toggle(c)}>
          <span className="chev">{open ? '▾' : '▸'}</span>{c}<span className="cnt">{n}</span>
        </button>
        {open && <div>{children}</div>}
      </section>
    )
  }

  return (
    <aside className="libp" aria-label="Parts library">
      <div className="libp-search">
        <input ref={search} type="search" placeholder="Search parts  ( / )" aria-label="Search parts" value={q} spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && first) onPick(first)
            else if (e.key === 'Escape') setQ(''), e.currentTarget.blur()
            else if (e.key === 'ArrowDown') (e.preventDefault(), e.currentTarget.closest('.libp')?.querySelector<HTMLElement>('.libp-item')?.focus())
          }} />
      </div>
      <div className="libp-list" onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        const all = [...e.currentTarget.querySelectorAll<HTMLElement>('.libp-item')], i = all.indexOf(document.activeElement as HTMLElement)
        e.preventDefault()
        all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
      }}>
        {groups.map(([c, es]) => (
          group(c, es.length, es.map((e) => (
              <button key={e.id} className={`libp-item${active === e.id ? ' on' : ''}`} title={e.description} onClick={() => onPick(e)}>
                <SymbolPreview kind={e.kind} part={e.kind === 'block' ? blockPartFields(e) : undefined} size="small" />
                <span><b>{e.name}</b><small>{e.description}</small></span>
              </button>
            )))
        ))}
        {sh.length > 0 && (
          group('Sheets', sh.length, sh.map((s) => (
              <button key={s.file} className={`libp-item${active === 'sheet:' + s.file ? ' on' : ''}`} title={`Place ${s.file} as a block`} onClick={() => onPick(s)}>
                <SymbolPreview kind="block" part={blockShape(sheetPorts(s.sheet))} size="small" />
                <span><b>{sheetName(s.file)}</b><small>{sheetPorts(s.sheet).join(', ') || 'no ports'}</small></span>
              </button>
            )))
        )}
        {!groups.length && !sh.length && <p className="libp-none">No parts match “{q}”</p>}
      </div>
    </aside>
  )
}
