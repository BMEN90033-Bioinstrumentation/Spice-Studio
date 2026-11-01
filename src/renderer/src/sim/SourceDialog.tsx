import { useId, useRef, useState, type JSX } from 'react'
import { isSpiceNumber, spiceValue } from './analysis.ts'
import { FIELDS, evalTran, parseSource, previewSpan, sourceText, type Source, type TranKind } from './source.ts'
import { useModal } from './AnalysisDialog.tsx'
import './AnalysisDialog.css'

type Fn = Exclude<TranKind, 'none' | 'pwl'>
const KINDS: [TranKind, string][] = [['none', 'None (DC only)'], ['pulse', 'Pulse'], ['sin', 'Sine'], ['exp', 'Exponential'], ['pwl', 'Piecewise linear'], ['sffm', 'FM (SFFM)'], ['am', 'AM']]
// field name -> [label, unit kind]: y = the source's unit (V/A), s, Hz, …
const NAMES: Record<string, [string, string]> = {
  V1: ['Initial value', 'y'], V2: ['Pulsed value', 'y'], VO: ['Offset', 'y'], VA: ['Amplitude', 'y'], TD: ['Delay', 's'], TR: ['Rise time', 's'],
  TF: ['Fall time', 's'], PW: ['Pulse width', 's'], PER: ['Period', 's'], NP: ['Number of pulses', ''], FREQ: ['Frequency', 'Hz'], THETA: ['Damping', '1/s'],
  PHASE: ['Phase', '°'], TD1: ['Rise delay', 's'], TAU1: ['Rise time constant', 's'], TD2: ['Fall delay', 's'], TAU2: ['Fall time constant', 's'],
  FC: ['Carrier frequency', 'Hz'], MDI: ['Modulation index', ''], FS: ['Signal frequency', 'Hz'], MF: ['Modulating frequency', 'Hz'],
  PHASEM: ['Modulation phase', '°'], PHASEC: ['Carrier phase', '°']
}
const DEFAULTS: Record<Fn, string[]> = {
  pulse: ['0', '1', '0', '1u', '1u', '5m', '10m'], sin: ['0', '1', '1k'], exp: ['0', '1', '0', '1m', '5m', '1m'], sffm: ['0', '1', '10k', '2', '1k'], am: ['1', '0.5', '1k', '10k', '0']
}
type Row = { t: string; v: string }

export function SourceDialog({ name, unit, value, onApply, onClose }: {
  name: string; unit: 'V' | 'A'; value: string; onApply: (v: string) => void; onClose: () => void
}): JSX.Element {
  const init = parseSource(value)
  const [raw, setRaw] = useState(value)
  const [dc, setDc] = useState(init?.dc ?? ''), [acMag, setAcMag] = useState(init?.acMag ?? ''), [acPhase, setAcPhase] = useState(init?.acPhase ?? '')
  const [kind, setKind] = useState<TranKind>(init?.tran.kind ?? 'none')
  // args per kind, padded to the field count, so switching kinds back and forth keeps what was typed
  const [args, setArgs] = useState(() => Object.fromEntries((Object.keys(FIELDS) as Fn[]).map((k) => {
    const a = init?.tran.kind === k ? init.tran.args : DEFAULTS[k]
    return [k, FIELDS[k].map((_, i) => a[i] ?? '')]
  })) as Record<Fn, string[]>)
  const pw = init?.tran.kind === 'pwl' ? init.tran : null
  const [rows, setRows] = useState<Row[]>(() => pw ? pw.args.filter((_, i) => i % 2 === 0).map((t, i) => ({ t, v: pw.args[2 * i + 1] }))
    : [{ t: '0', v: '0' }, { t: '1m', v: '1' }, { t: '2m', v: '0' }])
  const [rep, setRep] = useState(pw?.r ?? ''), [td, setTd] = useState(pw?.td ?? '')
  const uid = useId()
  const card = useRef<HTMLDivElement>(null)

  // build the Source + collect errors
  const errs: string[] = []
  const chk = (v: string, label: string) => v.trim() && !isSpiceNumber(v.trim()) && errs.push(`${label} must be a number`)
  let src: Source | null = null
  if (init) {
    chk(dc, 'DC value'), chk(acMag, 'AC magnitude'), chk(acPhase, 'AC phase')
    if (acPhase.trim() && !acMag.trim()) errs.push('AC phase needs an AC magnitude')
    let a: string[] = [], r: string | undefined, d: string | undefined
    if (kind === 'pwl') {
      const rs = rows.filter((x) => x.t.trim() || x.v.trim())
      rs.forEach((x, i) => (chk(x.t, `Point ${i + 1} time`), chk(x.v, `Point ${i + 1} value`), (!x.t.trim() || !x.v.trim()) && errs.push(`Point ${i + 1} needs a time and a value`)))
      if (!rs.length) errs.push('Add at least one point')
      const ts = rs.map((x) => spiceValue(x.t))
      if (ts.some((t, i) => i > 0 && t < ts[i - 1])) errs.push('Times must not decrease')
      chk(rep, 'Repeat from'), chk(td, 'Delay')
      if (rep.trim() && !ts.includes(spiceValue(rep))) errs.push('Repeat from must be one of the point times')
      ;(a = rs.flatMap((x) => [x.t.trim(), x.v.trim()])), (r = rep.trim() || undefined), (d = td.trim() || undefined)
    } else if (kind !== 'none') {
      const f = args[kind].map((v) => v.trim())
      f.forEach((v, i) => chk(v, `${NAMES[FIELDS[kind][i]][0]} (${FIELDS[kind][i]})`))
      if (!f[0] || !f[1]) errs.push(`${FIELDS[kind][0]} and ${FIELDS[kind][1]} are required`)
      // drop trailing blanks; a blank in the middle becomes 0, which ngspice reads as "use the default"
      let n = f.length
      while (n > 2 && !f[n - 1]) n--
      a = f.slice(0, n).map((v) => v || '0')
    }
    src = { dc: dc.trim(), acMag: acMag.trim(), acPhase: acMag.trim() ? acPhase.trim() : '', tran: { kind, args: a, ...(r ? { r } : {}), ...(d ? { td: d } : {}) } }
  }
  const text = src ? sourceText(src) : raw.trim()
  const ok = errs.length === 0 && !!text
  const apply = () => ok && (text === value.trim() ? onClose() : onApply(text))
  const cb = useRef({ apply, onClose })
  cb.current = { apply, onClose }
  useModal(card, () => card.current?.querySelector<HTMLElement>('.adlg-form input, .adlg-form select, .adlg-form textarea'), cb)

  const field = (id: string, label: string, u: string, v: string, set: (v: string) => void, ph = '') => (
    <div className="adlg-f" key={id}>
      <label htmlFor={uid + id}>{label}</label>
      <div className="adlg-in">
        <input id={uid + id} value={v} placeholder={ph} spellCheck={false} autoComplete="off" onChange={(e) => set(e.target.value)} />
        {u && <span>{u}</span>}
      </div>
    </div>
  )
  const u = (k: string) => (k === 'y' ? unit : k)

  return (
    <div className="adlg-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="adlg sdlg" ref={card} role="dialog" aria-modal="true" aria-labelledby={uid + 't'}>
        <div className="adlg-head">
          <h2 id={uid + 't'}>{name} waveform</h2>
          <button type="button" className="adlg-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="adlg-form sdlg-form">
          {!init ? <>
            <p className="adlg-msg">This value uses syntax the waveform editor doesn't cover, so it's shown as text and kept exactly as written.</p>
            <div className="adlg-f">
              <label htmlFor={uid + 'raw'}>Value</label>
              <textarea id={uid + 'raw'} className="sdlg-raw" rows={3} value={raw} spellCheck={false} onChange={(e) => setRaw(e.target.value)} />
            </div>
          </> : <>
            <div className="sdlg-grid">
              {field('dc', 'DC value', unit, dc, setDc, '0')}
              {field('acm', 'AC magnitude', unit, acMag, setAcMag, 'none')}
              {field('acp', 'AC phase', '°', acPhase, setAcPhase, '0')}
            </div>
            <div className="adlg-f">
              <label htmlFor={uid + 'k'}>Transient waveform</label>
              <select id={uid + 'k'} value={kind} onChange={(e) => setKind(e.target.value as TranKind)}>
                {KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
            {kind === 'pwl' ? <>
              <div className="sdlg-pwl" role="group" aria-label="Points">
                <span className="adlg-l">Time (s)</span><span className="adlg-l">Value ({unit})</span><span />
                {rows.map((x, i) => [
                  <input key={i + 't'} aria-label={`Point ${i + 1} time`} value={x.t} spellCheck={false} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, t: e.target.value } : y)))} />,
                  <input key={i + 'v'} aria-label={`Point ${i + 1} value`} value={x.v} spellCheck={false} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, v: e.target.value } : y)))} />,
                  <button key={i + 'x'} type="button" aria-label={`Remove point ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
                ])}
              </div>
              <button type="button" className="sdlg-add" onClick={() => setRows([...rows, { t: '', v: '' }])}>Add point</button>
              <div className="sdlg-grid">
                {field('r', 'Repeat from (r=)', 's', rep, setRep, 'no repeat')}
                {field('td', 'Delay (td=)', 's', td, setTd, '0')}
              </div>
            </> : kind !== 'none' && (
              <div className="sdlg-grid">
                {FIELDS[kind].map((f, i) => field(f, `${NAMES[f][0]} (${f})`, u(NAMES[f][1]), args[kind][i],
                  (v) => setArgs((s) => ({ ...s, [kind]: s[kind].map((x, j) => (j === i ? v : x)) })), i < 2 ? '' : 'default'))}
              </div>
            )}
            {src && <Preview src={src} unit={unit} />}
          </>}
        </div>
        <div className="adlg-prev" aria-live="polite">
          <span>Value</span>
          <code>{text}</code>
        </div>
        {errs.length > 0 && <ul className="adlg-errs" role="alert">{errs.map((m) => <li key={m}>{m}</li>)}</ul>}
        <div className="adlg-foot">
          <span className="adlg-hint"><kbd>Esc</kbd> cancel · <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl '}↵</kbd> apply</span>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="run" disabled={!ok} onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  )
}

const fmt = (v: number) => (Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-2) ? v.toExponential(1) : String(+v.toPrecision(3)))
// ~2 periods (or the PWL span) of the waveform. ponytail: 400 uniform samples, so sub-sample edges look vertical
function Preview({ src, unit }: { src: Source; unit: string }) {
  if (src.tran.kind === 'none') return null
  const T = previewSpan(src), N = 400, ctx = { step: T / 1000, stop: T }
  const ys = Array.from({ length: N + 1 }, (_, i) => evalTran(src, (T * i) / N, ctx))
  if (ys.some((y) => !isFinite(y))) return <p className="adlg-msg">No preview: {src.tran.kind === 'am' ? 'AM is not previewed' : 'some values are parameters'}.</p>
  let lo = Math.min(...ys), hi = Math.max(...ys)
  if (hi - lo < 1e-12) (lo -= 1), (hi += 1)
  const W = 300, H = 70, y = (v: number) => 4 + (H - 8) * (1 - (v - lo) / (hi - lo))
  return (
    <figure className="sdlg-plot">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Waveform preview">
        {lo < 0 && hi > 0 && <line className="z" x1={0} x2={W} y1={y(0)} y2={y(0)} />}
        <polyline points={ys.map((v, i) => `${((W * i) / N).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
      </svg>
      <figcaption><span>{fmt(hi)} {unit} max · {fmt(lo)} {unit} min</span><span>0 … {fmt(T)} s</span></figcaption>
    </figure>
  )
}
