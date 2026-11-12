// Live tuning strip in the results panel: sliders on .param values and R/C/L values. A move re-runs the simulation
// (debounced); a run still going is stopped first, and the workspace keeps the old plot until the new one arrives.
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tip } from '@/components/ui/tip'
import { eng } from '../Plot'
import { spiceValue } from '../sim/analysis'
import { knobs, range, STEPS, toPos, toValue, type Knob } from '../sim/tune'

// the workspace's side (main.tsx): the netlist last run; set: the values every run uses from now on; run / cancel: start a
// run, stop the one going (its results are dropped)
export type TuneHost = { netlist: string; running: boolean; set: (k: Knob[]) => void; run: () => void; cancel: () => void }
type Slider = Knob & { min: number; max: number; log: boolean; text: [string, string] }
const DEBOUNCE = 150 // ms after the last slider move
const id = (k: Knob) => `${k.kind}:${k.name.toLowerCase()}`

export function Tune({ host, onClose }: { host: TuneHost; onClose: () => void }) {
  const [ks, setKs] = useState<Slider[]>([])
  const avail = useMemo(() => knobs(host.netlist).filter((k) => !ks.some((s) => id(s) === id(k))), [host.netlist, ks])
  const latest = useRef(host), pending = useRef<Knob[] | null>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  latest.current = host
  // run the newest values; a run going is stopped first and this fires again when it has ended (running -> false).
  // ponytail: relies on run() setting running before the next debounced fire (it does, synchronously or after a short sheet read)
  const fire = () => {
    const h = latest.current
    if (!pending.current) return
    if (h.running) return h.cancel()
    h.set(pending.current), h.run(), (pending.current = null)
  }
  useEffect(() => { if (!host.running) fire() }, [host.running])
  // closed (or the results panel popped in/out): later runs use the netlist's values again
  useEffect(() => () => (clearTimeout(timer.current), latest.current.set([])), [])
  const commit = (next: Slider[], now = false) => {
    setKs(next)
    pending.current = next.map(({ kind, name, value }) => ({ kind, name, value }))
    clearTimeout(timer.current)
    timer.current = setTimeout(fire, now ? 0 : DEBOUNCE)
  }
  const upd = (i: number, p: Partial<Slider>) => {
    const next = ks.map((s, j) => (j === i ? { ...s, ...p } : s))
    if (next[i].value !== ks[i].value) commit(next)
    else setKs(next)
  }
  const add = (key: string) => {
    const k = avail.find((a) => id(a) === key)
    if (!k) return
    const r = range(k.value)
    setKs([...ks, { ...k, ...r, text: [eng(r.min), eng(r.max)] }]) // same value as the netlist: nothing to re-run
  }
  // min/max typed as SPICE numbers; log needs 0 < min < max
  const setLimit = (i: number, which: 0 | 1, t: string) => {
    const s = ks[i], text: [string, string] = [...s.text]
    text[which] = t
    const min = spiceValue(text[0]), max = spiceValue(text[1])
    if (isNaN(min) || isNaN(max) || !(max > min) || (s.log && !(min > 0))) return setKs(ks.map((x, j) => (j === i ? { ...x, text } : x)))
    upd(i, { text, min, max, value: Math.min(max, Math.max(min, s.value)) })
  }
  const bad = (s: Slider) => { const a = spiceValue(s.text[0]), b = spiceValue(s.text[1]); return isNaN(a) || isNaN(b) || !(b > a) || (s.log && !(a > 0)) }
  const field = 'h-6 w-16 px-1.5 font-mono text-[11px] md:text-[11px]'
  return (
    <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto border-b bg-card px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">Tune</span>
        <Select value="" onValueChange={add}>
          <SelectTrigger size="sm" className="h-6 min-w-44 text-xs" aria-label="Add a slider"><SelectValue placeholder={avail.length ? 'Add a parameter or part…' : 'No .param or R/C/L values to tune'} /></SelectTrigger>
          <SelectContent>
            {avail.map((k) => <SelectItem key={id(k)} value={id(k)} className="font-mono text-xs">{k.kind === 'param' ? `.param ${k.name}` : k.name} = {eng(k.value)}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{ks.length ? 'Moving a slider re-runs the simulation' : 'Pick a .param (a number) or a resistor, capacitor or inductor to get a slider'}</span>
        <Tip label="Close the sliders: later runs use the netlist values">
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Close tuning" onClick={onClose}><X /></Button>
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
