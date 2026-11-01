// Sidebar › Bill of materials…: its own window with the BOM of the design under the top sheet, which sheets' parts
// to include (all by default), purchasing details per line (saved in the .nsproj), and CSV / Excel export. The
// workspace renders it, so it follows edits live.
import { useState } from 'react'
import { PopOut } from '../layout/PopOut'
import type { BomRow } from './bom'
import type { PartInfo } from './project'
import '../sim/AnalysisDialog.css'
import '../library/library.css'

export const BOMWIN = 'ngspice-bom' // frame name: main/index.ts WINDOWS allows it
const stem = (f: string) => f.replace(/\.nsch$/i, '')

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
      <div className="mlib bomwin" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="bomwin-sheets" role="group" aria-label="Sheets to include">
          <span className="lbl">Include sheets</span>
          {sheets.map((f) => (
            <label key={f}>
              <input type="checkbox" checked={!exclude.has(f)} onChange={(e) => toggle(f, e.target.checked)} />
              {stem(f)}
            </label>
          ))}
          <button className="mlib-rm" onClick={() => onExclude(all ? new Set(sheets) : new Set())}>{all ? 'None' : 'All'}</button>
        </div>
        <div className="mlib-body">
          {rows.length ? (
            <table className="bomt">
              <thead>
                <tr><th className="n">Qty</th><th>Value</th><th>Type</th>{COLS.map(([f, h]) => <th key={f}>{h}</th>)}<th title="A part inside a block is listed once per use of the block, with the block's name: XINA.R2 is R2 inside block XINA">References</th><th>Sheets</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.type + '\0' + r.value + '\0' + r.part}>
                    <td className="n">{r.qty}</td>
                    <td className="m">{r.value}</td>
                    <td title={r.part && `Library part ${r.part}`}>{r.type}</td>
                    {COLS.map(([f, h, ph]) => (
                      <td key={f} className="in">
                        <input value={r.info[f] ?? ''} placeholder={ph} aria-label={`${h} for ${r.qty}× ${r.value}`} spellCheck={false}
                          onChange={(e) => onInfo(r.key, f, e.target.value)} />
                      </td>
                    ))}
                    <td className="m dim">{r.refs.join(', ')}</td>
                    <td className="dim">{r.sheets.map(stem).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="adlg-msg">No components on the selected sheets.</p>
          )}
        </div>
        <div className="adlg-foot mlib-foot">
          <span className="adlg-hint" role="status">
            {note || `${parts} part${parts === 1 ? '' : 's'} in ${rows.length} line${rows.length === 1 ? '' : 's'} · ${withPn} with a part number` +
              (skipped ? ` · ${skipped} simulation-only element${skipped === 1 ? '' : 's'} (sources) left out` : '')}
          </span>
          <button disabled={!rows.length} onClick={() => void save('csv')}>Export CSV</button>
          <button className="primary" disabled={!rows.length} onClick={() => void save('xlsx')}>Export Excel</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </PopOut>
  )
}
