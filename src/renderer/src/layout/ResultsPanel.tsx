// Plot tabs + plot + console. Presentational: the workspace owns the state; rendered docked or inside the pop-out window.
import type { ReactNode } from 'react'
import { Plot, type PlotRun } from '../Plot'
import type { Blame } from '../sim/probe'

export type ResultTab = { key: string; name: string; runs: PlotRun[] }

export function ResultsPanel({ tabs, cur, ran, onTab, sels, onSels, log, blamed, onBlame, actions }: {
  tabs: ResultTab[]; cur?: ResultTab; ran: boolean; onTab: (key: string) => void
  sels: Record<string, string[]>; onSels: (s: Record<string, string[]>) => void
  log: string[]; blamed: { line: string; blame: Blame }[]; onBlame: (b: Blame) => void; actions?: ReactNode
}) {
  return (
    <section className="right">
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={t === cur ? 'on' : ''} onClick={() => onTab(t.key)}>
            {t.name}
          </button>
        ))}
        {!ran && <span className="empty">Press ▶ Run (⌘↵) to simulate</span>}
        {ran && !tabs.length && <span className="empty">No analysis results. Check the console.</span>}
        {actions && <span className="tabs-act">{actions}</span>}
      </nav>
      <div className="plotarea">
        {cur && <Plot key={cur.key} runs={cur.runs} sel={sels[cur.key] ?? []} onSel={(s) => onSels({ ...sels, [cur.key]: s })} />}
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
