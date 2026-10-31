import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { ANALYSES, analysisText, defaultAnalysis, validate, type Analysis, type Sweep } from './analysis.ts'
import './AnalysisDialog.css'

type Kind = Analysis['kind']
const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl '
const DESC: Record<Kind, string> = {
  op: 'DC bias point of every node',
  tran: 'Response over time',
  ac: 'Small-signal frequency response',
  dc: 'Sweep a source, trace the transfer curve',
  noise: 'Noise density over frequency',
}
const SWEEPS: [Sweep, string, string][] = [
  ['dec', 'Decade', 'Points per decade'],
  ['oct', 'Octave', 'Points per octave'],
  ['lin', 'Linear', 'Total points'],
]

// fit a default's placeholder source/output (V1, out) to what the circuit actually has
function seed(a: Analysis, sources: string[], outs: string[]): Analysis {
  const fit = (v: string, list: string[]) => (list.includes(v) ? v : list[0] ?? '')
  if (a.kind === 'dc') return { ...a, source: fit(a.source, sources) }
  if (a.kind === 'noise') return { ...a, source: fit(a.source, sources), output: fit(a.output, outs) }
  return a
}

export function AnalysisDialog(props: {
  initial?: Analysis
  sources: string[]
  nets: string[]
  onApply: (a: Analysis) => void
  onClose: () => void
}): JSX.Element {
  const { sources, onApply, onClose } = props
  const outs = props.nets.filter((n) => n !== '0')
  const init = props.initial ?? defaultAnalysis('tran')
  const [all, setAll] = useState(
    () => Object.fromEntries(ANALYSES.map(({ kind }) => [kind, kind === init.kind ? init : seed(defaultAnalysis(kind), sources, outs)])) as Record<Kind, Analysis>,
  )
  const [kind, setKind] = useState<Kind>(init.kind)
  const a = all[kind]
  const errs = validate(a)
  const ok = errs.length === 0
  const uid = useId()
  const card = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLDivElement>(null)
  const applyBtn = useRef<HTMLButtonElement>(null)

  const apply = () => ok && onApply(a)
  const cb = useRef({ apply, onClose })
  cb.current = { apply, onClose }

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ;(form.current?.querySelector<HTMLElement>('input, select') ?? applyBtn.current)?.focus()
    // capture on window: modal swallows every key so canvas letter shortcuts never see them.
    // ponytail: main.tsx's earlier-registered capture listener still runs first for ⌘S/⌘O/⌘Enter (see report)
    const k = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') e.preventDefault(), cb.current.onClose()
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.preventDefault(), cb.current.apply()
      else if (e.key === 'Tab') trap(e)
    }
    const trap = (e: KeyboardEvent) => {
      const f = [...card.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')]
      const i = f.indexOf(document.activeElement as HTMLElement)
      const to = i < 0 ? f[0] : e.shiftKey && i === 0 ? f[f.length - 1] : !e.shiftKey && i === f.length - 1 ? f[0] : null
      if (to) e.preventDefault(), to.focus()
    }
    window.addEventListener('keydown', k, true)
    return () => {
      window.removeEventListener('keydown', k, true)
      prev?.focus?.()
    }
  }, [])

  const upd = (p: Record<string, unknown>) => setAll((s) => ({ ...s, [kind]: { ...s[kind], ...p } as Analysis }))
  const val = (k: string) => (a as unknown as Record<string, string>)[k]

  // validate() messages start with the field's label: show those under the field, the rest in a list
  const shown = new Set<string>()
  const num = (k: string, label: string, unit: string, ph: string, help?: string, vl = label) => {
    const v = val(k)
    const mine = errs.filter((m) => m.startsWith(vl + ' '))
    mine.forEach((m) => shown.add(m))
    const bad = mine.length > 0
    const id = uid + k
    const note = bad ? mine.join('. ') : help
    return (
      <div className="adlg-f" key={k}>
        <label htmlFor={id}>{label}</label>
        <div className={'adlg-in' + (bad ? ' bad' : '')}>
          <input id={id} value={v} placeholder={ph} spellCheck={false} autoComplete="off" aria-invalid={bad}
            aria-describedby={note ? id + 'h' : undefined} onChange={(e) => upd({ [k]: e.target.value })} />
          {unit && <span>{unit}</span>}
        </div>
        {note && <small id={id + 'h'} className={bad ? 'err' : ''}>{note}</small>}
      </div>
    )
  }

  const pick = (k: string, label: string, opts: [string, string][], help?: string) => {
    const id = uid + k
    return (
      <div className="adlg-f" key={k}>
        <label htmlFor={id}>{label}</label>
        <select id={id} value={val(k)} onChange={(e) => upd({ [k]: e.target.value })} aria-describedby={help ? id + 'h' : undefined}>
          {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        {help && <small id={id + 'h'}>{help}</small>}
      </div>
    )
  }
  // keep a stale value selectable rather than silently showing the first option
  const opts = (k: string, list: string[]): [string, string][] => [...new Set([val(k), ...list])].filter(Boolean).map((n) => [n, n])

  // empty-state note stands in for validate()'s "Pick a source / output" message
  const none = (k: string, text: string) => {
    errs.forEach((m) => m.startsWith('Pick ') && shown.add(m))
    return <div className="adlg-f adlg-msg" key={k}>{text}</div>
  }
  const source = (label: string) =>
    sources.length ? pick('source', label, opts('source', sources)) : none('source', `${label}: no V or I sources in the circuit yet.`)

  const sweep = () => {
    const s = (a as { sweep: Sweep }).sweep
    return [
      <div className="adlg-f" key="sweep">
        <span className="adlg-l" id={uid + 'sw'}>Sweep type</span>
        <div className="seg" role="group" aria-labelledby={uid + 'sw'}>
          {SWEEPS.map(([v, t]) => (
            <button key={v} type="button" className={s === v ? 'on' : ''} aria-pressed={s === v} onClick={() => upd({ sweep: v })}>{t}</button>
          ))}
        </div>
      </div>,
      num('points', SWEEPS.find(([v]) => v === s)![2], '', '100', undefined, 'Points'),
      num('fstart', 'Start frequency', 'Hz', '1'),
      num('fstop', 'Stop frequency', 'Hz', '1meg'),
    ]
  }

  const fields = () => {
    switch (a.kind) {
      case 'op':
        return <p className="adlg-msg">No parameters. Solves the DC operating point with capacitors open and inductors shorted.</p>
      case 'tran':
        return <>
          {num('stop', 'Stop time', 's', '20m')}
          {num('step', 'Time step', 's', '10u', 'Output sample spacing')}
          {num('start', 'Start time', 's', '0', 'Leave blank to save from t = 0')}
          {num('maxStep', 'Max step', 's', 'auto', 'Leave blank for automatic')}
          <label className="adlg-chk">
            <input type="checkbox" checked={a.uic} onChange={(e) => upd({ uic: e.target.checked })} />
            Use initial conditions (UIC)<small>Skip the operating point, start from .ic values</small>
          </label>
        </>
      case 'ac':
        return sweep()
      case 'dc': {
        const u = a.source.toUpperCase().startsWith('I') ? 'A' : 'V'
        return <>
          {source('Source')}
          {num('start', 'Start value', u, '0')}
          {num('stop', 'Stop value', u, '5')}
          {num('step', 'Increment', u, '0.1')}
        </>
      }
      case 'noise':
        return <>
          {outs.length ? pick('output', 'Output node', opts('output', outs))
            : none('output', 'Output node: no nets in the circuit yet.')}
          {pick('ref', 'Reference node', [['', 'Ground (0)'], ...opts('ref', outs.filter((n) => n !== a.output))], 'Optional, ground by default')}
          {source('Input source')}
          {sweep()}
        </>
    }
  }

  const body = fields()
  const rest = errs.filter((m) => !shown.has(m))

  return (
    <div className="adlg-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="adlg" ref={card} role="dialog" aria-modal="true" aria-labelledby={uid + 't'}>
        <div className="adlg-head">
          <h2 id={uid + 't'}>Simulation setup</h2>
          <button type="button" className="adlg-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="adlg-body">
          <div className="adlg-kinds" role="group" aria-label="Analysis type">
            {ANALYSES.map(({ kind: k, title }) => (
              <button key={k} type="button" className={k === kind ? 'on' : ''} aria-pressed={k === kind} onClick={() => setKind(k)}>
                <b>{title}</b>
                <span>{DESC[k]}</span>
              </button>
            ))}
          </div>
          <div className="adlg-form" ref={form}>{body}</div>
        </div>
        <div className="adlg-prev" aria-live="polite">
          <span>Directive</span>
          <code>{analysisText(a)}</code>
        </div>
        {rest.length > 0 && <ul className="adlg-errs" role="alert">{rest.map((m) => <li key={m}>{m}</li>)}</ul>}
        <div className="adlg-foot">
          <span className="adlg-hint"><kbd>Esc</kbd> cancel · <kbd>{MOD}↵</kbd> apply</span>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="run" ref={applyBtn} disabled={!ok} onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  )
}
