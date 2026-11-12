import { useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Plus, X } from 'lucide-react'
import {
  ANALYSES, OPTION_FIELDS, analysisText, defaultAnalysis, emptyOptions, nodeValsText, optionsText, parseNodeVals, parseOptions, validate, validateNodeVals, validateOptions,
  type Analysis, type NodeVals, type Options, type Sweep
} from './analysis.ts'

type Kind = Analysis['kind']
type NvKind = 'ic' | 'nodeset'
export type Tab = Kind | NvKind | 'options'
const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl '
const DESC: Record<Kind, string> = {
  op: 'DC bias point of every node',
  tran: 'Response over time',
  ac: 'Small-signal frequency response',
  dc: 'Sweep a source, trace the transfer curve',
  noise: 'Noise density over frequency',
  tf: 'DC gain, input and output resistance',
  sens: 'How much each part value moves an output',
  pz: 'Poles and zeros of a transfer function',
  disto: 'Small-signal harmonic distortion',
  sp: 'S, Y and Z parameters between ports',
  four: 'Harmonics and THD of a transient result',
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
  if (a.kind === 'tf') return { ...a, source: fit(a.source, sources), output: fit(a.output, outs) }
  if (a.kind === 'sens') return { ...a, output: fit(a.output, outs) }
  if (a.kind === 'pz') return { ...a, in1: fit(a.in1, outs), out1: fit(a.out1, outs) }
  if (a.kind === 'four') return { ...a, outputs: outs.includes('out') ? a.outputs : outs.slice(0, 1).map((n) => `v(${n})`) }
  return a
}

const muted = 'text-xs text-muted-foreground'
const NONE = '\u0000' // Radix Select can't hold '': stands in for a blank value

// Shell shared with SourceDialog. Radix gives the focus trap, Esc/backdrop → onClose and focus restore. Keys stop at
// the card (React's stopPropagation stops the native event too), so the canvas's bubble-phase window listener never
// sees them while typing. ponytail: commands.ts's capture listener still runs first for ⌘S/⌘O/⌘Enter
export function FormDialog({ title, className, first, ok, apply, onClose, label, text, errs, children }: {
  title: ReactNode; className?: string; first: () => HTMLElement | null | undefined; ok: boolean; apply: () => void; onClose: () => void
  label: string; text: string; errs: string[]; children: ReactNode
}): JSX.Element {
  const applyBtn = useRef<HTMLButtonElement>(null)
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.preventDefault(), apply()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className={cn('flex max-h-[calc(100vh-3rem)] flex-col gap-4 p-5', className)} onKeyDown={keys}
        onOpenAutoFocus={(e) => {
          const f = first() ?? (ok ? applyBtn.current : null)
          if (f) e.preventDefault(), f.focus()
        }}>
        <DialogHeader><DialogTitle className="text-base">{title}</DialogTitle></DialogHeader>
        {children}
        <div aria-live="polite" className="flex shrink-0 items-baseline gap-2.5 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">
          <span className="font-sans text-muted-foreground">{label}</span>
          <code className="whitespace-pre text-hl">{text}</code>
        </div>
        {errs.length > 0 && (
          <Alert variant="destructive" className="shrink-0 py-2">
            <AlertDescription><ul className="list-disc pl-4 text-xs">{errs.map((m) => <li key={m}>{m}</li>)}</ul></AlertDescription>
          </Alert>
        )}
        <DialogFooter className="shrink-0 items-center">
          <span className={cn(muted, 'mr-auto hidden items-center gap-1 sm:flex')}><Kbd>Esc</Kbd> cancel · <Kbd>{MOD}↵</Kbd> apply</span>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" ref={applyBtn} disabled={!ok} onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// labelled text input with a unit suffix and an optional help / error line under it (also SourceDialog's fields)
export function NumField({ id, label, unit, value, placeholder, onChange, note, bad }: {
  id: string; label: string; unit?: string; value: string; placeholder?: string; onChange: (v: string) => void; note?: string; bad?: boolean
}): JSX.Element {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className={muted}>{label}</Label>
      <InputGroup className="h-8">
        <InputGroupInput id={id} value={value} placeholder={placeholder} spellCheck={false} autoComplete="off" aria-invalid={bad}
          aria-describedby={note ? id + 'h' : undefined} onChange={(e) => onChange(e.target.value)} className="h-8 font-mono text-xs md:text-xs" />
        {unit && <InputGroupAddon align="inline-end" className="font-mono text-xs">{unit}</InputGroupAddon>}
      </InputGroup>
      {note && <p id={id + 'h'} className={cn('text-xs', bad ? 'text-destructive' : 'text-muted-foreground')}>{note}</p>}
    </div>
  )
}
export const fieldGrid = 'grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5'

export function AnalysisDialog(props: {
  initial?: Analysis
  sources: string[]
  nets: string[]
  onApply: (a: Analysis) => void
  options?: string // the sheet's current .options line, if any
  ic?: string // … .ic line
  nodeset?: string // … .nodeset line
  onOptions: (line: string) => void // an .options, .ic or .nodeset line: replaces the sheet's line of that kind
  tab?: Tab // open on this tab (default: the initial analysis)
  onClose: () => void
}): JSX.Element {
  const { sources, onApply, onOptions, onClose } = props
  const outs = props.nets.filter((n) => n !== '0')
  const vsrcs = sources.filter((s) => /^v/i.test(s)) // i(x) needs a voltage source
  const init = props.initial ?? defaultAnalysis('tran')
  const [all, setAll] = useState(
    () => Object.fromEntries(ANALYSES.map(({ kind }) => [kind, kind === init.kind ? init : seed(defaultAnalysis(kind), sources, outs)])) as Record<Kind, Analysis>,
  )
  const [opt, setOpt] = useState<Options>(() => (props.options && parseOptions(props.options)) || emptyOptions())
  const [nv, setNv] = useState<Record<NvKind, NodeVals>>(() => {
    const blank = (): NodeVals => ({ rows: [{ net: outs[0] ?? '', value: '0' }], extra: '' })
    return { ic: (props.ic && parseNodeVals(props.ic)) || blank(), nodeset: (props.nodeset && parseNodeVals(props.nodeset)) || blank() }
  })
  const [kind, setKind] = useState<Tab>(props.tab ?? init.kind)
  const isOpt = kind === 'options', isNv = kind === 'ic' || kind === 'nodeset', setup = isOpt || isNv
  const a = all[setup ? init.kind : kind]
  const form = (isOpt ? opt : isNv ? nv[kind] : a) as unknown as Record<string, string>
  const errs = isOpt ? validateOptions(opt) : isNv ? validateNodeVals(nv[kind]) : validate(a)
  const text = isOpt ? optionsText(opt) : isNv ? nodeValsText(kind, nv[kind]) : analysisText(a)
  const ok = errs.length === 0
  const uid = useId()
  const formEl = useRef<HTMLDivElement>(null)

  const apply = () => ok && (setup ? onOptions(text) : onApply(a))

  const upd = (p: Record<string, unknown>) =>
    isOpt ? setOpt((o) => ({ ...o, ...p }) as Options)
      : isNv ? setNv((s) => ({ ...s, [kind]: { ...s[kind], ...p } }))
        : setAll((s) => ({ ...s, [kind]: { ...s[kind as Kind], ...p } as Analysis }))
  const val = (k: string) => form[k]

  // validate() messages start with the field's label: show those under the field, the rest in a list
  const shown = new Set<string>()
  const num = (k: string, label: string, unit: string, ph: string, help?: string, vl = label) => {
    const mine = errs.filter((m) => m.startsWith(vl + ' '))
    mine.forEach((m) => shown.add(m))
    const bad = mine.length > 0
    return <NumField key={k} id={uid + k} label={label} unit={unit} value={val(k)} placeholder={ph} onChange={(v) => upd({ [k]: v })}
      note={bad ? mine.join('. ') : help} bad={bad} />
  }

  const pick = (k: string, label: string, opts: [string, string][], help?: string, set = (v: string) => upd({ [k]: v })) => {
    const id = uid + k
    return (
      <div className="grid gap-1.5" key={k}>
        <Label htmlFor={id} className={muted}>{label}</Label>
        <Select value={val(k) || NONE} onValueChange={(v) => set(v === NONE ? '' : v)}>
          <SelectTrigger id={id} size="sm" className="w-full font-mono text-xs" aria-describedby={help ? id + 'h' : undefined}><SelectValue /></SelectTrigger>
          <SelectContent>{opts.map(([v, t]) => <SelectItem key={v} value={v || NONE} className="font-mono text-xs">{t}</SelectItem>)}</SelectContent>
        </Select>
        {help && <p id={id + 'h'} className={muted}>{help}</p>}
      </div>
    )
  }
  // keep a stale value selectable rather than silently showing the first option
  const opts = (k: string, list: string[], v = val(k)): [string, string][] => [...new Set([v, ...list])].filter(Boolean).map((n) => [n, n])

  // segmented choice; Radix reports '' when the pressed item is clicked again, so ignore that (never deselect)
  const seg = (k: string, label: string, value: string, items: readonly (readonly [string, string, ...string[]])[], set: (v: string) => void, help?: string) => (
    <div className="grid gap-1.5" key={k}>
      <span className={cn(muted, 'font-medium')} id={uid + k}>{label}</span>
      <ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={(v) => v && set(v)} aria-labelledby={uid + k}>
        {items.map(([v, t]) => <ToggleGroupItem key={v} value={v} className="text-xs">{t}</ToggleGroupItem>)}
      </ToggleGroup>
      {help && <p className={muted}>{help}</p>}
    </div>
  )

  const check = (k: string, label: string, help: string) => (
    <div className="flex items-start gap-2" key={k}>
      <Checkbox id={uid + k} className="mt-0.5" checked={!!form[k]} onCheckedChange={(c) => upd({ [k]: c === true })} aria-describedby={uid + k + 'h'} />
      <div className="grid gap-1">
        <Label htmlFor={uid + k} className="text-xs">{label}</Label>
        <p id={uid + k + 'h'} className={muted}>{help}</p>
      </div>
    </div>
  )

  // empty-state note stands in for validate()'s "Pick a source / output" message
  const none = (k: string, text: string) => {
    errs.forEach((m) => m.startsWith('Pick ') && shown.add(m))
    return <Alert key={k} className="py-2"><AlertDescription className="text-xs text-warn">{text}</AlertDescription></Alert>
  }
  const note = (text: ReactNode) => <p className={cn(muted, 'rounded-md border px-2.5 py-2')}>{text}</p>
  const code = (t: string) => <code className="font-mono text-foreground">{t}</code>
  const source = (label: string) =>
    sources.length ? pick('source', label, opts('source', sources)) : none('source', `${label}: no V or I sources in the circuit yet.`)
  // output node + optional reference (noise, tf, sens)
  const outNode = () => <>
    {outs.length ? pick('output', 'Output node', opts('output', outs)) : none('output', 'Output node: no nets in the circuit yet.')}
    {pick('ref', 'Reference node', [['', 'Ground (0)'], ...opts('ref', outs.filter((n) => n !== val('output')))], 'Optional, ground by default')}
  </>
  // .tf / .sens output: a node voltage or the current through a voltage source
  const outVar = (current: boolean) => <>
    {seg('cur', 'Output', current ? 'i' : 'v', [['v', 'Node voltage'], ['i', 'Source current']],
      (v) => upd({ current: v === 'i', output: v === 'i' ? (vsrcs[0] ?? '') : (outs[0] ?? ''), ref: '' }))}
    {!current ? outNode()
      : vsrcs.length ? pick('output', 'Current through', opts('output', vsrcs))
        : none('output', 'Current through: no voltage sources in the circuit yet.')}
  </>

  const sweep = () => {
    const s = (a as { sweep: Sweep }).sweep
    return [
      seg('sw', 'Sweep type', s, SWEEPS, (v) => upd({ sweep: v })),
      num('points', SWEEPS.find(([v]) => v === s)![2], '', '100', undefined, 'Points'),
      num('fstart', 'Start frequency', 'Hz', '1'),
      num('fstop', 'Stop frequency', 'Hz', '1meg'),
    ]
  }

  // .ic / .nodeset: one row per net
  const nodeRows = (k: NvKind) => {
    const { rows, extra } = nv[k]
    const set = (r: NodeVals['rows']) => upd({ rows: r }) // per-row problems go to the list under the form
    return <>
      <p className={muted}>{k === 'ic'
        ? <>Node voltages at the start of a transient run. With {code('uic')} on the {code('.tran')} they are the starting values; without it they hold the nodes while the operating point is solved, then let go.</>
        : <>Starting guesses for the operating point. Use them to pick the state of a bistable circuit or to help a hard one converge; the result is still a true solution.</>}
      </p>
      <div className="grid gap-1.5">
        {rows.length > 0 && <div className={cn(muted, 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] gap-2')}><span>Net</span><span>Voltage</span></div>}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-2">
            <Select value={r.net || NONE} onValueChange={(v) => set(rows.map((x, j) => (j === i ? { ...x, net: v === NONE ? '' : v } : x)))}>
              <SelectTrigger size="sm" className="w-full font-mono text-xs" aria-label={`Net, row ${i + 1}`}><SelectValue placeholder="Net" /></SelectTrigger>
              <SelectContent>{opts('', outs, r.net).map(([v]) => <SelectItem key={v} value={v} className="font-mono text-xs">{v}</SelectItem>)}</SelectContent>
            </Select>
            <InputGroup className="h-8">
              <InputGroupInput value={r.value} placeholder="0" spellCheck={false} autoComplete="off" aria-label={`Voltage, row ${i + 1}`}
                onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="h-8 font-mono text-xs md:text-xs" />
              <InputGroupAddon align="inline-end" className="font-mono text-xs">V</InputGroupAddon>
            </InputGroup>
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`Remove row ${i + 1}`} onClick={() => set(rows.filter((_, j) => j !== i))}><X /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-fit" onClick={() => set([...rows, { net: outs.find((n) => !rows.some((r) => r.net === n)) ?? '', value: '0' }])}><Plus />Add net</Button>
      </div>
      {extra.trim() && num('extra', 'Other entries', '', '', 'Kept as typed')}
    </>
  }

  const fields = () => {
    if (isOpt) return <>
      <p className={muted}>Blank fields use ngspice's default (shown greyed). Written as one {code('.options')} line.</p>
      {seg('me', 'Integration method', opt.method || 'default', [['default', 'Default'], ['trap', 'Trapezoidal'], ['gear', 'Gear']],
        (v) => upd({ method: v === 'default' ? '' : v }), 'Gear damps the numerical ringing trapezoidal can show on stiff circuits')}
      <div className={fieldGrid}>{OPTION_FIELDS.map((f) => num(f.key, f.label, f.unit, f.ph, f.help))}</div>
      {num('extra', 'Other options', '', 'e.g. rshunt=1e12 cshunt=1e-12', 'Anything else, kept as typed')}
    </>
    if (isNv) return nodeRows(kind)
    switch (a.kind) {
      case 'op':
        return <p className={muted}>No parameters. Solves the DC operating point with capacitors open and inductors shorted.</p>
      case 'tran':
        return <>
          {num('stop', 'Stop time', 's', '20m')}
          {num('step', 'Time step', 's', '10u', 'Output sample spacing')}
          {num('start', 'Start time', 's', '0', 'Leave blank to save from t = 0')}
          {num('maxStep', 'Max step', 's', 'auto', 'Leave blank for automatic')}
          {check('uic', 'Use initial conditions (UIC)', 'Skip the operating point, start from .ic values')}
        </>
      case 'ac':
        return sweep()
      case 'dc': {
        const u = (s: string) => (s.toUpperCase().startsWith('I') ? 'A' : 'V')
        return <>
          {source('Source')}
          {num('start', 'Start value', u(a.source), '0')}
          {num('stop', 'Stop value', u(a.source), '5')}
          {num('step', 'Increment', u(a.source), '0.1')}
          {sources.length > 1 && pick('source2', 'Second source', [['', 'None'], ...opts('source2', sources.filter((s) => s !== a.source))],
            'Optional: one curve per value of this source',
            (v) => upd(v ? { source2: v, start2: a.start2 || '0', stop2: a.stop2 || '5', step2: a.step2 || '1' } : { source2: '', start2: '', stop2: '', step2: '' }))}
          {a.source2 && <div className={fieldGrid}>
            {num('start2', 'Second start', u(a.source2), '0')}
            {num('stop2', 'Second stop', u(a.source2), '5')}
            {num('step2', 'Second increment', u(a.source2), '1')}
          </div>}
        </>
      }
      case 'noise':
        return <>
          {outNode()}
          {source('Input source')}
          {sweep()}
        </>
      case 'tf':
        return <>
          {outVar(a.current)}
          {source('Input source')}
          {note('Small-signal DC gain from the input source to the output, plus the input resistance seen by the source and the output resistance at the output. Results are a table.')}
        </>
      case 'sens':
        return <>
          {outVar(a.current)}
          {seg('mode', 'Analysis', a.ac ? 'ac' : 'dc', [['dc', 'DC'], ['ac', 'AC']], (v) => upd({ ac: v === 'ac' }),
            a.ac ? 'Sensitivity over frequency, plotted per part' : 'DC sensitivity: a table, largest first')}
          {a.ac && sweep()}
        </>
      case 'pz': {
        const node = (k: string, label: string) => pick(k, label, [['0', 'Ground (0)'], ...opts(k, outs).filter(([v]) => v !== '0')])
        return <>
          <div className="grid grid-cols-2 gap-2.5">{node('in1', 'Input node')}{node('in2', 'Input reference')}</div>
          <div className="grid grid-cols-2 gap-2.5">{node('out1', 'Output node')}{node('out2', 'Output reference')}</div>
          {seg('tf', 'Transfer function', a.tf, [['vol', 'V(out) / V(in)'], ['cur', 'V(out) / I(in)']], (v) => upd({ tf: v }),
            'Voltage gain, or transimpedance for a current fed in at the input')}
          {seg('find', 'Find', a.find, [['pz', 'Poles and zeros'], ['pol', 'Poles'], ['zer', 'Zeros']], (v) => upd({ find: v }))}
        </>
      }
      case 'disto':
        return <>
          {sweep()}
          {num('f2', 'F2/F1 ratio', '', 'none', 'Optional, between 0 and 1: adds the intermodulation products')}
          {note(<>Needs {code('DISTOF1')} on the input source value (and {code('DISTOF2')} for the ratio), e.g. {code('AC 1 DISTOF1 0.1 DISTOF2 0.1')}. Without them every result is 0.</>)}
        </>
      case 'sp':
        return <>
          {sweep()}
          {check('noise', 'Noise correlation', 'Also compute the noise correlation matrix (Cy vectors)')}
          {note(<>Needs one voltage source per port with {code('portnum')} and {code('z0')} in its value, e.g. {code('dc 0 ac 1 portnum 1 z0 50')}. Port numbers start at 1.</>)}
        </>
      case 'four': {
        const items = [...new Set([...outs.map((n) => `v(${n})`), ...a.outputs])]
        return <>
          {num('freq', 'Fundamental frequency', 'Hz', '1k')}
          <div className="grid gap-1.5">
            <span className={cn(muted, 'font-medium')} id={uid + 'outs'}>Outputs</span>
            {items.length ? (
              <ToggleGroup type="multiple" variant="outline" size="sm" spacing={1} value={a.outputs} onValueChange={(v) => upd({ outputs: v })}
                aria-labelledby={uid + 'outs'} className="w-full flex-wrap">
                {items.map((v) => <ToggleGroupItem key={v} value={v} className="font-mono text-xs">{v}</ToggleGroupItem>)}
              </ToggleGroup>
            ) : none('outputs', 'Outputs: no nets in the circuit yet.')}
          </div>
          {note(<>Runs on the {code('.tran')} result: the last period of the fundamental, so make the stop time at least one period. Shows 10 harmonics (set {code('nfreqs')} in Options for more) and the THD in the Fourier tab.</>)}
        </>
      }
    }
  }

  const body = fields()
  const rest = errs.filter((m) => !shown.has(m))
  const kinds: [Tab, string][] = [...ANALYSES.map(({ kind: k, title }): [Tab, string] => [k, title]),
    ['ic', 'Initial conditions'], ['nodeset', 'Nodeset'], ['options', 'Options']]
  const desc: Record<NvKind | 'options', string> = { ic: '.ic: node voltages at t = 0', nodeset: '.nodeset: operating point guesses', options: 'Tolerances, iteration limits, temperature' }

  return (
    <FormDialog title="Simulation setup" className="sm:max-w-[600px]" ok={ok} apply={apply} onClose={onClose} errs={rest}
      label="Directive" text={text}
      first={() => formEl.current?.querySelector<HTMLElement>('input, [data-slot=select-trigger]')}>
      {/* narrow windows: the kinds become a wrapping strip above the form */}
      <div className="-m-1 grid min-h-0 gap-4 overflow-auto p-1 sm:grid-cols-[168px_minmax(0,1fr)]">
        <ToggleGroup type="single" spacing={1} value={kind} onValueChange={(v) => v && setKind(v as Tab)} aria-label="Analysis type"
          className="flex w-full flex-row flex-wrap items-stretch sm:flex-col">
          {kinds.map(([k, t]) => (
            <ToggleGroupItem key={k} value={k} className={cn('h-7 justify-start px-2.5 text-left hover:text-foreground', k === 'ic' && 'sm:mt-2.5')}>{t}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex min-w-0 flex-col gap-3" ref={formEl}>
          <p className="text-xs text-muted-foreground">{setup ? desc[kind] : DESC[kind]}</p>
          {body}
        </div>
      </div>
    </FormDialog>
  )
}
