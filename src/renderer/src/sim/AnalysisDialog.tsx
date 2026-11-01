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
import {
  ANALYSES, OPTION_FIELDS, analysisText, defaultAnalysis, emptyOptions, optionsText, parseOptions, validate, validateOptions, type Analysis, type Options, type Sweep
} from './analysis.ts'

type Kind = Analysis['kind']
export type Tab = Kind | 'options'
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
  onOptions: (line: string) => void
  tab?: Tab // open on this tab (default: the initial analysis)
  onClose: () => void
}): JSX.Element {
  const { sources, onApply, onOptions, onClose } = props
  const outs = props.nets.filter((n) => n !== '0')
  const init = props.initial ?? defaultAnalysis('tran')
  const [all, setAll] = useState(
    () => Object.fromEntries(ANALYSES.map(({ kind }) => [kind, kind === init.kind ? init : seed(defaultAnalysis(kind), sources, outs)])) as Record<Kind, Analysis>,
  )
  const [opt, setOpt] = useState<Options>(() => (props.options && parseOptions(props.options)) || emptyOptions())
  const [kind, setKind] = useState<Tab>(props.tab ?? init.kind)
  const isOpt = kind === 'options'
  const a = all[isOpt ? init.kind : kind]
  const form = (isOpt ? opt : a) as unknown as Record<string, string>
  const errs = isOpt ? validateOptions(opt) : validate(a)
  const ok = errs.length === 0
  const uid = useId()
  const formEl = useRef<HTMLDivElement>(null)

  const apply = () => ok && (isOpt ? onOptions(optionsText(opt)) : onApply(a))

  const upd = (p: Record<string, unknown>) =>
    isOpt ? setOpt((o) => ({ ...o, ...p }) as Options) : setAll((s) => ({ ...s, [kind]: { ...s[kind as Kind], ...p } as Analysis }))
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

  const pick = (k: string, label: string, opts: [string, string][], help?: string) => {
    const id = uid + k
    return (
      <div className="grid gap-1.5" key={k}>
        <Label htmlFor={id} className={muted}>{label}</Label>
        <Select value={val(k) || NONE} onValueChange={(v) => upd({ [k]: v === NONE ? '' : v })}>
          <SelectTrigger id={id} size="sm" className="w-full font-mono text-xs" aria-describedby={help ? id + 'h' : undefined}><SelectValue /></SelectTrigger>
          <SelectContent>{opts.map(([v, t]) => <SelectItem key={v} value={v || NONE} className="font-mono text-xs">{t}</SelectItem>)}</SelectContent>
        </Select>
        {help && <p id={id + 'h'} className={muted}>{help}</p>}
      </div>
    )
  }
  // keep a stale value selectable rather than silently showing the first option
  const opts = (k: string, list: string[]): [string, string][] => [...new Set([val(k), ...list])].filter(Boolean).map((n) => [n, n])

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

  // empty-state note stands in for validate()'s "Pick a source / output" message
  const none = (k: string, text: string) => {
    errs.forEach((m) => m.startsWith('Pick ') && shown.add(m))
    return <Alert key={k} className="py-2"><AlertDescription className="text-xs text-warn">{text}</AlertDescription></Alert>
  }
  const source = (label: string) =>
    sources.length ? pick('source', label, opts('source', sources)) : none('source', `${label}: no V or I sources in the circuit yet.`)

  const sweep = () => {
    const s = (a as { sweep: Sweep }).sweep
    return [
      seg('sw', 'Sweep type', s, SWEEPS, (v) => upd({ sweep: v })),
      num('points', SWEEPS.find(([v]) => v === s)![2], '', '100', undefined, 'Points'),
      num('fstart', 'Start frequency', 'Hz', '1'),
      num('fstop', 'Stop frequency', 'Hz', '1meg'),
    ]
  }

  const fields = () => {
    if (isOpt) return <>
      <p className={muted}>Blank fields use ngspice's default (shown greyed). Written as one <code className="font-mono text-foreground">.options</code> line.</p>
      {seg('me', 'Integration method', opt.method || 'default', [['default', 'Default'], ['trap', 'Trapezoidal'], ['gear', 'Gear']],
        (v) => upd({ method: v === 'default' ? '' : v }), 'Gear damps the numerical ringing trapezoidal can show on stiff circuits')}
      <div className={fieldGrid}>{OPTION_FIELDS.map((f) => num(f.key, f.label, f.unit, f.ph, f.help))}</div>
      {num('extra', 'Other options', '', 'e.g. rshunt=1e12 cshunt=1e-12', 'Anything else, kept as typed')}
    </>
    switch (a.kind) {
      case 'op':
        return <p className={muted}>No parameters. Solves the DC operating point with capacitors open and inductors shorted.</p>
      case 'tran':
        return <>
          {num('stop', 'Stop time', 's', '20m')}
          {num('step', 'Time step', 's', '10u', 'Output sample spacing')}
          {num('start', 'Start time', 's', '0', 'Leave blank to save from t = 0')}
          {num('maxStep', 'Max step', 's', 'auto', 'Leave blank for automatic')}
          <div className="flex items-start gap-2">
            <Checkbox id={uid + 'uic'} className="mt-0.5" checked={a.uic} onCheckedChange={(c) => upd({ uic: c === true })} aria-describedby={uid + 'uich'} />
            <div className="grid gap-1">
              <Label htmlFor={uid + 'uic'} className="text-xs">Use initial conditions (UIC)</Label>
              <p id={uid + 'uich'} className={muted}>Skip the operating point, start from .ic values</p>
            </div>
          </div>
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
  const kinds: [Tab, string, string][] = [...ANALYSES.map(({ kind: k, title }): [Tab, string, string] => [k, title, DESC[k]]),
    ['options', 'Options', 'Tolerances, iteration limits, temperature']]

  return (
    <FormDialog title="Simulation setup" className="sm:max-w-[540px]" ok={ok} apply={apply} onClose={onClose} errs={rest}
      label="Directive" text={isOpt ? optionsText(opt) : analysisText(a)}
      first={() => formEl.current?.querySelector<HTMLElement>('input, [data-slot=select-trigger]')}>
      {/* narrow windows: the kinds become a wrapping strip above the form */}
      <div className="-m-1 grid min-h-0 gap-4 overflow-auto p-1 sm:grid-cols-[168px_minmax(0,1fr)]">
        <ToggleGroup type="single" spacing={1} value={kind} onValueChange={(v) => v && setKind(v as Tab)} aria-label="Analysis type"
          className="flex w-full flex-row flex-wrap items-stretch sm:flex-col">
          {kinds.map(([k, t, d]) => (
            <ToggleGroupItem key={k} value={k} className="h-auto flex-col items-start gap-0.5 px-2.5 py-1.5 text-left whitespace-normal hover:text-foreground">
              <span>{t}</span>
              <span className="hidden text-xs font-normal text-muted-foreground sm:block">{d}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex min-w-0 flex-col gap-3" ref={formEl}>{body}</div>
      </div>
    </FormDialog>
  )
}
