// Sidebar › Bill of materials…: its own window with the BOM of the design under the top sheet, which sheets' parts
// to include (all by default), purchasing details per line (saved in the .nsproj), and CSV / Excel export. The
// workspace renders it, so it follows edits live.
import { useState } from 'react'
import { PopOut } from '../layout/PopOut'
import type { BomRow } from './bom'
import type { PartInfo } from './project'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export const BOMWIN = 'ngspice-bom' // frame name: main/index.ts WINDOWS allows it
const stem = (f: string) => f.replace(/\.nsch$/i, '')
// sticky header: a bottom rule as a shadow, since collapsed borders don't stick
const TH = 'sticky top-0 z-10 h-auto bg-background px-2.5 pt-2.5 pb-1.5 text-xs text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]'
const TD = 'px-2.5 py-1 align-top'

const COLS: [keyof PartInfo, string, string][] = [
  ['mfr', 'Manufacturer', 'e.g. Yageo'], ['mpn', 'Part number', 'manufacturer part no.'], ['supplier', 'Supplier', 'e.g. Digi-Key'], ['spn', 'Supplier part no.', '']
]

export function BomWindow({ title, sheets, exclude, onExclude, rows, skipped, onExport, onInfo, onClose }: {
  title: string; sheets: string[]; exclude: ReadonlySet<string>; onExclude: (s: Set<string>) => void
  rows: BomRow[]; skipped: number; onExport: (kind: 'csv' | 'xlsx') => Promise<string | null>
  onInfo: (key: string, field: keyof PartInfo, value: string) => void; onClose: () => void
}) {
  const [note, setNote] = useState('')
  const all = sheets.every((f) => !exclude.has(f))
  const toggle = (f: string, on: boolean) => { const s = new Set(exclude); on ? s.delete(f) : s.add(f); onExclude(s) }
  const save = async (kind: 'csv' | 'xlsx') => { const p = await onExport(kind); setNote(p ? `Saved ${p}` : '') }
  const parts = rows.reduce((n, r) => n + r.qty, 0), withPn = rows.filter((r) => r.info.mpn).length
  return (
    <PopOut name={BOMWIN} size="width=1240,height=680" title={title} onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col bg-background" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b px-4.5 py-3 text-xs" role="group" aria-label="Sheets to include">
          <span className="font-medium text-muted-foreground">Include sheets</span>
          {sheets.map((f) => (
            <Label key={f} className="cursor-pointer text-xs font-normal">
              <Checkbox checked={!exclude.has(f)} onCheckedChange={(c) => toggle(f, c === true)} />
              {stem(f)}
            </Label>
          ))}
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onExclude(all ? new Set(sheets) : new Set())}>{all ? 'None' : 'All'}</Button>
        </div>
        {/* the table's own container is the scroller, so the sticky header sticks */}
        <div className="min-h-0 flex-1 px-4.5 [&>[data-slot=table-container]]:h-full">
          {rows.length ? (
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={cn(TH, 'w-[3em] text-right')}>Qty</TableHead><TableHead className={TH}>Value</TableHead><TableHead className={TH}>Type</TableHead>
                  {COLS.map(([f, h]) => <TableHead key={f} className={TH}>{h}</TableHead>)}
                  <TableHead className={TH} title="A part inside a block is listed once per use of the block, with the block's name: XINA.R2 is R2 inside block XINA">References</TableHead>
                  <TableHead className={TH}>Sheets</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.type + '\0' + r.value + '\0' + r.part} className="group">
                    <TableCell className={cn(TD, 'text-right tabular-nums')}>{r.qty}</TableCell>
                    <TableCell className={cn(TD, 'font-mono')}>{r.value}</TableCell>
                    <TableCell className={TD} title={r.part && `Library part ${r.part}`}>{r.type}</TableCell>
                    {COLS.map(([f, h, ph]) => (
                      <TableCell key={f} className="px-1 py-px align-top">
                        <Input value={r.info[f] ?? ''} placeholder={ph} aria-label={`${h} for ${r.qty}× ${r.value}`} spellCheck={false} onChange={(e) => onInfo(r.key, f, e.target.value)}
                          className="h-7 min-w-[90px] rounded-sm border-transparent bg-transparent px-1.5 font-mono text-xs shadow-none group-hover:border-input placeholder:text-transparent focus:placeholder:text-muted-foreground focus-visible:ring-0 md:text-xs dark:bg-transparent dark:focus-visible:bg-background" />
                      </TableCell>
                    ))}
                    <TableCell className={cn(TD, 'font-mono whitespace-normal text-muted-foreground')}>{r.refs.join(', ')}</TableCell>
                    <TableCell className={cn(TD, 'whitespace-normal text-muted-foreground')}>{r.sheets.map(stem).join(', ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-3.5 text-xs text-muted-foreground">No components on the selected sheets.</p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <span className="mr-auto text-xs text-muted-foreground" role="status">
            {note || `${parts} part${parts === 1 ? '' : 's'} in ${rows.length} line${rows.length === 1 ? '' : 's'} · ${withPn} with a part number` +
              (skipped ? ` · ${skipped} simulation-only element${skipped === 1 ? '' : 's'} (sources) left out` : '')}
          </span>
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => void save('csv')}>Export CSV</Button>
          <Button size="sm" disabled={!rows.length} onClick={() => void save('xlsx')}>Export Excel</Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </PopOut>
  )
}
