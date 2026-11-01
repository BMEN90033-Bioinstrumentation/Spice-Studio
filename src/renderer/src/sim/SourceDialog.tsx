import { useId, useRef, useState, type JSX } from 'react'
import { isSpiceNumber, spiceValue } from './analysis.ts'
import { FIELDS, evalTran, parseSource, previewSpan, sourceText, type Source, type TranKind } from './source.ts'
import { X, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { FormDialog, NumField, fieldGrid } from './AnalysisDialog.tsx'

const muted = 'text-xs text-muted-foreground'

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
  const formEl = useRef<HTMLDivElement>(null)

  const field = (id: string, label: string, u: string, v: string, set: (v: string) => void, ph = '') =>
    <NumField key={id} id={uid + id} label={label} unit={u} value={v} onChange={set} placeholder={ph} />
  const u = (k: string) => (k === 'y' ? unit : k)
  const pt = (i: number, p: Partial<Row>) => setRows(rows.map((y, j) => (j === i ? { ...y, ...p } : y)))
  const cell = 'h-8 font-mono text-xs md:text-xs'

  return (
    <FormDialog title={`${name} waveform`} className="sm:max-w-[480px]" ok={ok} apply={apply} onClose={onClose} errs={errs} label="Value" text={text}
      first={() => formEl.current?.querySelector<HTMLElement>('input, textarea, [data-slot=select-trigger]')}>
      <div className="-m-1 flex min-h-0 flex-col gap-3 overflow-auto p-1" ref={formEl}>
        {!init ? <>
          <Alert className="py-2"><AlertDescription className="text-xs">This value uses syntax the waveform editor doesn't cover, so it's shown as text and kept exactly as written.</AlertDescription></Alert>
          <div className="grid gap-1.5">
            <Label htmlFor={uid + 'raw'} className={muted}>Value</Label>
            <Textarea id={uid + 'raw'} rows={3} value={raw} spellCheck={false} onChange={(e) => setRaw(e.target.value)} className="resize-y font-mono text-xs md:text-xs" />
          </div>
        </> : <>
          <div className={fieldGrid}>
            {field('dc', 'DC value', unit, dc, setDc, '0')}
            {field('acm', 'AC magnitude', unit, acMag, setAcMag, 'none')}
            {field('acp', 'AC phase', '°', acPhase, setAcPhase, '0')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={uid + 'k'} className={muted}>Transient waveform</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as TranKind)}>
              <SelectTrigger id={uid + 'k'} size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map(([k, t]) => <SelectItem key={k} value={k} className="text-xs">{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {kind === 'pwl' ? <>
            <div className="grid max-h-[180px] grid-cols-[1fr_1fr_auto] items-center gap-x-1.5 gap-y-1 overflow-auto p-px" role="group" aria-label="Points">
              <span className={muted}>Time (s)</span><span className={muted}>Value ({unit})</span><span />
              {rows.map((x, i) => [
                <Input key={i + 't'} className={cell} aria-label={`Point ${i + 1} time`} value={x.t} spellCheck={false} onChange={(e) => pt(i, { t: e.target.value })} />,
                <Input key={i + 'v'} className={cell} aria-label={`Point ${i + 1} value`} value={x.v} spellCheck={false} onChange={(e) => pt(i, { v: e.target.value })} />,
                <Button key={i + 'x'} variant="ghost" size="icon-sm" aria-label={`Remove point ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><X /></Button>
              ])}
            </div>
            <Button variant="outline" size="sm" className="self-start" onClick={() => setRows([...rows, { t: '', v: '' }])}><Plus />Add point</Button>
            <div className={fieldGrid}>
              {field('r', 'Repeat from (r=)', 's', rep, setRep, 'no repeat')}
              {field('td', 'Delay (td=)', 's', td, setTd, '0')}
            </div>
          </> : kind !== 'none' && (
            <div className={fieldGrid}>
              {FIELDS[kind].map((f, i) => field(f, `${NAMES[f][0]} (${f})`, u(NAMES[f][1]), args[kind][i],
                (v) => setArgs((s) => ({ ...s, [kind]: s[kind].map((x, j) => (j === i ? v : x)) })), i < 2 ? '' : 'default'))}
            </div>
          )}
          {src && <Preview src={src} unit={unit} />}
        </>}
      </div>
    </FormDialog>
  )
}

const fmt = (v: number) => (Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-2) ? v.toExponential(1) : String(+v.toPrecision(3)))
// ~2 periods (or the PWL span) of the waveform. ponytail: 400 uniform samples, so sub-sample edges look vertical
function Preview({ src, unit }: { src: Source; unit: string }) {
  if (src.tran.kind === 'none') return null
  const T = previewSpan(src), N = 400, ctx = { step: T / 1000, stop: T }
  const ys = Array.from({ length: N + 1 }, (_, i) => evalTran(src, (T * i) / N, ctx))
  if (ys.some((y) => !isFinite(y))) return <p className={muted}>No preview: {src.tran.kind === 'am' ? 'AM is not previewed' : 'some values are parameters'}.</p>
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
