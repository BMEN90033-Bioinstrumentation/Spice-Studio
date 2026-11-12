// Plot tabs + plot + console. Presentational: the workspace owns the state; rendered docked or inside the pop-out window.
import { Component, useMemo, useState, type ReactNode } from 'react'
import { ChartColumn, SlidersHorizontal } from 'lucide-react'
import { eng, Plot, type PlotRun } from '../Plot'
import { keysOf } from '../commands'
import { keyLabel } from './Panel'
import { Histogram } from '../plot/Histogram'
import { Tune, type TuneHost } from '../plot/Tune'
import { isWorstCase } from '../sim/sweep'
import { steppedNames } from '../sim/tune'
import type { MeasTable } from '../contracts'
import type { Blame } from '../sim/probe'
import { FourierTables, ScalarTable } from '../sim/AnalysisTables'
import { parseFour } from '../sim/meas'
import { tableKind } from '../sim/results'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tip } from '@/components/ui/tip'
import { cn } from '@/lib/utils'

// a plot tab: quiet until hovered, the open one filled
const TabBtn = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) => (
  <Button variant="ghost" size="xs" aria-pressed={on} onClick={onClick}
    className={cn('h-7 px-2.5 font-normal text-muted-foreground', on && 'bg-accent text-accent-foreground dark:hover:bg-accent')}>
    {children}
  </Button>
)

// a view that throws while drawing shows a plain message instead of blanking the app; new results (reset) try again
class Guard extends Component<{ children: ReactNode; reset?: unknown }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError = (err: Error) => ({ err })
  componentDidUpdate(prev: { reset?: unknown }) { if (prev.reset !== this.props.reset && this.state.err) this.setState({ err: null }) }
  render() {
    const { err } = this.state
    if (!err) return this.props.children
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
        <span>This view failed to draw: <span className="text-err">{err.message}</span></span>
        <Button size="xs" variant="outline" onClick={() => this.setState({ err: null })}>Try again</Button>
      </div>
    )
  }
}

export type ResultTab = { key: string; name: string; runs: PlotRun[]; panes?: { title: string; sel: string[] }[] }
// sels key of a tab's pane i (.plot lines stack several charts); pane 0 is the tab's own key, so probing lands there
export const paneKey = (key: string, i: number) => (i ? `${key}|${i}` : key)

export function ResultsPanel({ tabs, cur, ran, onTab, sels, onSels, log, blamed, onBlame, actions, meas, tune }: {
  tabs: ResultTab[]; cur?: ResultTab; ran: boolean; onTab: (key: string) => void
  sels: Record<string, string[]>; onSels: (s: Record<string, string[]>) => void
  log: string[]; blamed: { line: string; blame: Blame }[]; onBlame: (b: Blame) => void; actions?: ReactNode
  meas?: MeasTable
  tune?: TuneHost // live tuning sliders (plot/Tune.tsx)
}) {
  const [tuning, setTuning] = useState(() => !!tune?.knobs.length) // reopened (pop-out) with the sliders in use
  // the Measurements tab is local view state; the plot stays mounted underneath (keeps its cursors and zoom)
  const [onMeas, setOnMeas] = useState<boolean | 'four'>(false) // 'four': the Fourier tab (.four)
  const hasMeas = !!meas?.some((r) => r.rows.length)
  const four = useMemo(() => parseFour(log.join('\n')), [log])
  const showFour = four.length > 0 && (onMeas === 'four' || (!cur && !hasMeas))
  const showMeas = hasMeas && !showFour && (onMeas === true || !cur)
  return (
    <section className="right" style={tune && tuning ? { gridTemplateRows: '36px auto 1fr 180px' } : undefined}>
      <nav className="flex items-center gap-0.5 overflow-x-auto border-b px-2">
        {tabs.map((t) => (
          <TabBtn key={t.key} on={t === cur && !showMeas && !showFour} onClick={() => (setOnMeas(false), onTab(t.key))}>{t.name}</TabBtn>
        ))}
        {hasMeas && <TabBtn on={showMeas} onClick={() => setOnMeas(true)}>Measurements</TabBtn>}
        {four.length > 0 && <TabBtn on={showFour} onClick={() => setOnMeas('four')}>Fourier</TabBtn>}
        {!ran && <span className="px-1.5 text-muted-foreground">Press Run{keysOf('sim.run') ? ` (${keyLabel(keysOf('sim.run'))})` : ''} to simulate</span>}
        {ran && !tabs.length && !hasMeas && !four.length && <span className="px-1.5 text-muted-foreground">No analysis results. Check the console.</span>}
        {tune && ran && (
          <Tip label="Sliders on .param and part values: moving one re-runs the simulation">
            <TabBtn on={tuning} onClick={() => setTuning(!tuning)}><SlidersHorizontal />Tune</TabBtn>
          </Tip>
        )}
        {actions && <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">{actions}</span>}
      </nav>
      {tune && <Guard><Tune host={tune} swept={steppedNames(tabs[0]?.runs.map((r) => r.label) ?? [])} hidden={!tuning} onClose={() => setTuning(false)} /></Guard>}
      <div className="plotarea">
        {cur && (
          <div className="plotpanes">
            {(cur.panes?.length ? cur.panes : [null]).map((p, i) => {
              const k = paneKey(cur.key, i)
              return (
                <div key={k} className="plotpane">
                  {p?.title && <h3 className="panetitle">{p.title}</h3>}
                  <div className="panebody">
                    <Guard reset={cur.runs}>
                      {tableKind(cur.runs[0].plot) ? <ScalarTable runs={cur.runs} /> : <Plot runs={cur.runs} sel={sels[k] ?? []} onSel={(s) => onSels({ ...sels, [k]: s })} hold={tuning} />}
                    </Guard>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {showMeas && <Guard reset={meas}><Measurements meas={meas!} /></Guard>}
        {showFour && <Guard reset={four}><FourierTables four={four} /></Guard>}
      </div>
      <pre className="console">
        {log.map((l, i) => {
          const t = l.trim() // blame() trims lines and may append the culprit from the next one
          const b = t ? blamed.find((x) => x.line === t || x.line.startsWith(t + ' '))?.blame : undefined
          const cls = /^warning:/i.test(l) ? 'warn' : /error|fatal|failed/i.test(l) ? 'err' : /warning/i.test(l) ? 'warn' : ''
          return (
            <Tip key={i} label={b && 'Show in schematic'} side="left">
              <div className={b ? cls + ' blame' : cls} onClick={b && (() => onBlame(b))}>{l}</div>
            </Tip>
          )
        })}
      </pre>
    </section>
  )
}

// one column per run; with more than 2 runs (Monte Carlo / sweeps / worst case) mean, σ (sample), min and max come first (.wc: min/max only)
// (each naming the run it came from), and a measurement's histogram button opens its histogram, statistics and yield
function Measurements({ meas }: { meas: MeasTable }) {
  const names = [...new Set(meas.flatMap((r) => r.rows.map((m) => m.name)))]
  const stats = meas.length > 2, wc = isWorstCase(meas.map((r) => r.label)) // .wc corners: no mean or σ
  const [pick, setPick] = useState<string | null>(null)
  const values = (n: string) => meas.map((r) => r.rows.find((m) => m.name === n)?.value ?? null)
  return (
    <div className="absolute inset-0 z-10 overflow-auto bg-background p-4">
      {pick && names.includes(pick) && (
        <div className="mb-4">
          <Histogram id={'meas:' + pick} title={`${pick} over ${meas.length} runs`} values={values(pick)} labels={meas.map((r) => r.label)} unit="" onClose={() => setPick(null)} />
        </div>
      )}
      <Table className="w-auto font-mono text-xs">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={TH} />
            {stats && ['mean', 'σ', 'min', 'max'].map((h, i) => (i > 1 || !wc) && <TableHead key={h} className={cn(TH, 'text-warn')} title={h === 'σ' ? 'sample standard deviation (n − 1)' : undefined}>{h}</TableHead>)}
            {meas.map((r, i) => <TableHead key={i} className={TH}>{r.label || 'Value'}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {names.map((n) => {
            const cells = meas.map((r) => r.rows.find((m) => m.name === n))
            const v = cells.flatMap((m) => (m?.value != null ? [m.value] : []))
            const mean = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
            const sd = mean != null && v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : null
            return (
              <TableRow key={n}>
                <TableCell className="px-4 py-1">
                  {n}
                  {stats && (
                    <Tip label={`Histogram, statistics and yield of ${n}`}>
                      <Button variant="ghost" size="icon-xs" className="ml-1 size-4 align-middle text-muted-foreground" aria-label={`Histogram of ${n}`} onClick={() => setPick(n)}><ChartColumn className="size-3" /></Button>
                    </Tip>
                  )}
                </TableCell>
                {stats && [mean, sd, v.length ? Math.min(...v) : null, v.length ? Math.max(...v) : null].map((x, i) => (i > 1 || !wc) && (
                  <TableCell key={i} className={cn(TD, 'text-warn')}>
                    {eng(x)}
                    {i > 1 && x != null && <div className="ml-auto max-w-40 truncate text-[10px] text-muted-foreground" title={meas[values(n).indexOf(x)]?.label}>{meas[values(n).indexOf(x)]?.label}</div>/* which run: the worst-case corner */}
                  </TableCell>
                ))}
                {cells.map((m, i) => (
                  <TableCell key={i} title={m?.text} className={cn(TD, m && m.value == null && 'cursor-help text-err')}>
                    {!m ? '—' : m.value == null ? 'failed' : eng(m.value)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
const TH = 'h-8 px-4 text-right font-medium text-muted-foreground'
const TD = 'px-4 py-1 text-right text-hl'
