// Plot tabs + plot + console. Presentational: the workspace owns the state; rendered docked or inside the pop-out window.
import { useState, type ReactNode } from 'react'
import { eng, Plot, type PlotRun } from '../Plot'
import type { MeasTable } from '../contracts'
import type { Blame } from '../sim/probe'

export type ResultTab = { key: string; name: string; runs: PlotRun[] }

export function ResultsPanel({ tabs, cur, ran, onTab, sels, onSels, log, blamed, onBlame, actions, meas }: {
  tabs: ResultTab[]; cur?: ResultTab; ran: boolean; onTab: (key: string) => void
  sels: Record<string, string[]>; onSels: (s: Record<string, string[]>) => void
  log: string[]; blamed: { line: string; blame: Blame }[]; onBlame: (b: Blame) => void; actions?: ReactNode
  meas?: MeasTable
}) {
  // the Measurements tab is local view state; the plot stays mounted underneath (keeps its cursors and zoom)
  const [onMeas, setOnMeas] = useState(false)
  const hasMeas = !!meas?.some((r) => r.rows.length)
  const showMeas = hasMeas && (onMeas || !cur)
  return (
    <section className="right">
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={t === cur && !showMeas ? 'on' : ''} onClick={() => (setOnMeas(false), onTab(t.key))}>
            {t.name}
          </button>
        ))}
        {hasMeas && (
          <button className={showMeas ? 'on' : ''} onClick={() => setOnMeas(true)}>
            Measurements
          </button>
        )}
        {!ran && <span className="empty">Press ▶ Run (⌘↵) to simulate</span>}
        {ran && !tabs.length && !hasMeas && <span className="empty">No analysis results. Check the console.</span>}
        {actions && <span className="tabs-act">{actions}</span>}
      </nav>
      <div className="plotarea">
        {cur && <Plot key={cur.key} runs={cur.runs} sel={sels[cur.key] ?? []} onSel={(s) => onSels({ ...sels, [cur.key]: s })} />}
        {showMeas && <Measurements meas={meas!} />}
      </div>
      <pre className="console">
        {log.map((l, i) => {
          const t = l.trim() // blame() trims lines and may append the culprit from the next one
          const b = t ? blamed.find((x) => x.line === t || x.line.startsWith(t + ' '))?.blame : undefined
          const cls = /^warning:/i.test(l) ? 'warn' : /error|fatal|failed/i.test(l) ? 'err' : /warning/i.test(l) ? 'warn' : ''
          return (
            <div key={i} className={b ? cls + ' blame' : cls} onClick={b && (() => onBlame(b))} title={b && 'Show in schematic'}>
              {l}
            </div>
          )
        })}
      </pre>
    </section>
  )
}

// one column per run; with more than 2 runs (Monte Carlo / sweeps) also mean, σ (sample), min and max
function Measurements({ meas }: { meas: MeasTable }) {
  const names = [...new Set(meas.flatMap((r) => r.rows.map((m) => m.name)))]
  const stats = meas.length > 2
  return (
    <div className="meas">
      <table className="op">
        <thead>
          <tr>
            <th />
            {meas.map((r, i) => <th key={i}>{r.label || 'Value'}</th>)}
            {stats && ['mean', 'σ', 'min', 'max'].map((h) => <th key={h} className="stat">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {names.map((n) => {
            const cells = meas.map((r) => r.rows.find((m) => m.name === n))
            const v = cells.flatMap((m) => (m?.value != null ? [m.value] : []))
            const mean = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
            const sd = mean != null && v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : null
            return (
              <tr key={n}>
                <td>{n}</td>
                {cells.map((m, i) => (
                  <td key={i} title={m?.text} className={m && m.value == null ? 'bad' : ''}>
                    {!m ? '—' : m.value == null ? 'failed' : eng(m.value)}
                  </td>
                ))}
                {stats && [mean, sd, v.length ? Math.min(...v) : null, v.length ? Math.max(...v) : null].map((x, i) => <td key={i} className="stat">{eng(x)}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
