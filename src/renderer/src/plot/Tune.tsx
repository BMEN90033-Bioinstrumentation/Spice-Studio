// Live tuning strip in the results panel: sliders on .param values and R/C/L values. A move re-runs the simulation
// (debounced); a run still going is stopped first, and the workspace keeps the old plot until the new one arrives.
// ResultsPanel keeps this mounted (hidden) while closed, so closing can still re-run with the netlist values.
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tip'
import { eng } from '../Plot'
import { spiceValue } from '../sim/analysis'
import { knobs, range, STEPS, toPos, toValue, type Knob } from '../sim/tune'

// the workspace's side (main.tsx): the netlist last run, the values runs use now; set: the values every run uses from now
// on; run / cancel: start a run (resolves when it ends), stop the one going (its results are dropped)
export type TuneHost = { netlist: string; knobs: Knob[]; running: boolean; set: (k: Knob[]) => void; run: () => Promise<void> | void; cancel: () => void }
type Slider = Knob & { min: number; max: number; log: boolean; text: [string, string] }
const DEBOUNCE = 150 // ms after the last slider move
const id = (k: Knob) => `${k.kind}:${k.name.toLowerCase()}`
const RANGES = new Map<string, Pick<Slider, 'min' | 'max' | 'log' | 'text'>>() // each slider's range, for reopening (pop-out/dock)

// swept: .step params (sliding them would change nothing)
export function Tune({ host, swept, hidden, onClose }: { host: TuneHost; swept: string[]; hidden?: boolean; onClose: () => void }) {
  const slider = (k: Knob): Slider => { const r = RANGES.get(id(k)), d = range(k.value); return { ...k, ...(r ?? { ...d, text: [eng(d.min), eng(d.max)] }) } }
  const put = (next: Slider[]) => (next.forEach(({ min, max, log, text, ...k }) => RANGES.set(id(k), { min, max, log, text })), setKs(next))
  const [ks, setKs] = useState<Slider[]>(() => host.knobs.map(slider)) // reopened in the pop-out: the values in use
  const avail = useMemo(() => knobs(host.netlist).filter((k) => !ks.some((s) => id(s) === id(k)) && !(k.kind === 'param' && swept.includes(k.name.toLowerCase()))), [host.netlist, ks, swept.join()])
  const latest = useRef(host), pending = useRef<Knob[] | null>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const ours = useRef(false) // a run this strip started hasn't ended yet (run() awaits sheet reads before it sets running)
  const applied = useRef(host.knobs.length > 0) // runs use slider values (not just the netlist's)
  latest.current = host
  // run the newest values. A run going is stopped first: ours fires again when its promise ends, the user's when running
  // turns false. One run at a time, so two quick fires can't start two runs.
  const fire = () => {
    const h = latest.current
    if (!pending.current) return
    if (ours.current || h.running) return h.cancel()
    h.set(pending.current), (applied.current = pending.current.length > 0), (pending.current = null), (ours.current = true)
    Promise.resolve(h.run()).finally(() => ((ours.current = false), fire()))
  }
  useEffect(() => { if (!host.running) fire() }, [host.running])
  useEffect(() => () => clearTimeout(timer.current), [])
  const commit = (next: Slider[], now = false) => {
    put(next)
    pending.current = next.map(({ kind, name, value }) => ({ kind, name, value }))
    clearTimeout(timer.current)
    timer.current = setTimeout(fire, now ? 0 : DEBOUNCE)
  }
  const upd = (i: number, p: Partial<Slider>) => {
    const next = ks.map((s, j) => (j === i ? { ...s, ...p } : s))
    if (next[i].value !== ks[i].value) commit(next)
    else put(next)
  }
  const add = (key: string) => {
    const k = avail.find((a) => id(a) === key)
    if (k) put([...ks, slider(k)]) // same value as the netlist: nothing to re-run
  }
  // closing: back to the netlist values, re-run if sliders had changed anything (the strip stays mounted to see it through)
  const close = () => {
    clearTimeout(timer.current)
    if (applied.current) (pending.current = []), fire()
    else (pending.current = null), latest.current.set([])
    setKs([]), onClose()
  }
  // min/max typed as SPICE numbers; log needs 0 < min < max
  const setLimit = (i: number, which: 0 | 1, t: string) => {
    const s = ks[i], text: [string, string] = [...s.text]
    text[which] = t
    const min = spiceValue(text[0]), max = spiceValue(text[1])
    if (isNaN(min) || isNaN(max) || !(max > min) || (s.log && !(min > 0))) return put(ks.map((x, j) => (j === i ? { ...x, text } : x)))
    upd(i, { text, min, max, value: Math.min(max, Math.max(min, s.value)) })
  }
  const bad = (s: Slider) => { const a = spiceValue(s.text[0]), b = spiceValue(s.text[1]); return isNaN(a) || isNaN(b) || !(b > a) || (s.log && !(a > 0)) }
  const field = 'h-6 w-16 px-1.5 font-mono text-[11px] md:text-[11px]'
  return (
    <div hidden={hidden} className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto border-b bg-card px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">Tune</span>
        {/* native <select>: Radix Select positions its list in the opener window, off-screen in the pop-out */}
        <select value="" onChange={(e) => add(e.target.value)} className={SELECT + ' min-w-44'} aria-label="Add a slider">
          <option value="" disabled>{avail.length ? 'Add a parameter or part…' : 'No .param or R/C/L values to tune'}</option>
          {avail.map((k) => <option key={id(k)} value={id(k)}>{k.kind === 'param' ? `.param ${k.name}` : k.name} = {eng(k.value)}</option>)}
        </select>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{ks.length ? 'Moving a slider re-runs the simulation' : 'Pick a .param (a number) or a resistor, capacitor or inductor to get a slider'}</span>
        <Tip label="Close the sliders: later runs use the netlist values">
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Close tuning" onClick={close}><X /></Button>
        </Tip>
      </div>
      {ks.map((s, i) => (
        <div key={id(s)} className="grid grid-cols-[minmax(5rem,auto)_4.5rem_4rem_1fr_4rem_auto_auto] items-center gap-2">
          <code className="truncate">{s.name}</code>
          <code className="text-right text-hl">{eng(s.value)}</code>
          <Input className={field} aria-label={`${s.name} minimum`} aria-invalid={bad(s)} value={s.text[0]} onChange={(e) => setLimit(i, 0, e.target.value)} />
          <input type="range" min={0} max={STEPS} step={1} aria-label={s.name} className="w-full accent-(--hl)"
            value={Math.round(toPos(s.value, s.min, s.max, s.log) * STEPS)}
            onChange={(e) => upd(i, { value: Number(toValue(+e.target.value / STEPS, s.min, s.max, s.log).toPrecision(4)) })} />
          <Input className={field} aria-label={`${s.name} maximum`} aria-invalid={bad(s)} value={s.text[1]} onChange={(e) => setLimit(i, 1, e.target.value)} />
          <label className="flex items-center gap-1 text-muted-foreground">
            <Checkbox className="size-3.5" checked={s.log} disabled={!(s.min > 0)} onCheckedChange={(c) => upd(i, { log: !!c })} />log
          </label>
          <Tip label="Remove (back to the netlist value)">
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`Remove ${s.name}`} onClick={() => commit(ks.filter((_, j) => j !== i), true)}><X /></Button>
          </Tip>
        </div>
      ))}
    </div>
  )
}
// a native <select> dressed like the shadcn inputs
export const SELECT = 'h-6 rounded-md border border-input bg-transparent px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'
