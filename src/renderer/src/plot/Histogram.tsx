// Histogram + statistics of one value over sweep / Monte Carlo / worst-case runs, with a yield against limits.
import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tip'
import { eng } from '../Plot'
import { spiceValue } from '../sim/analysis'
import { isWorstCase } from '../sim/sweep'
import { stats } from './stats'
import { ticks } from './views'

const LIMITS = new Map<string, [string, string]>() // limits typed per value (id), kept while the app runs
const W = 560, H = 170, L = 8, B = 22 // histogram viewBox, bottom axis band

export function Histogram({ id, title, values, labels, unit, onClose }: {
  id: string; title: string; values: (number | null)[]; labels: string[]; unit: string; onClose: () => void
}) {
  const [lim, setLim] = useState<[string, string]>(() => LIMITS.get(id) ?? ['', ''])
  const set = (i: 0 | 1, v: string) => { const n: [string, string] = [...lim]; n[i] = v; setLim(n), LIMITS.set(id, n) }
  const num = (s: string) => (s.trim() ? spiceValue(s.trim()) : undefined)
  const lo = num(lim[0]), hi = num(lim[1]), badLim = [lo, hi].some((v) => v != null && isNaN(v))
  const s = stats(values, badLim ? undefined : lo, badLim ? undefined : hi)
  const u = unit === '1' ? '' : unit, f = (v: number | null) => (/^(dB|°)/.test(u) ? (v == null ? '—' : v.toFixed(3) + u) : eng(v, u))
  const top = Math.max(1, ...s.bins.map((b) => b.count))
  const x0 = Math.min(s.min ?? 0, lo ?? Infinity), x1 = Math.max(s.max ?? 1, hi ?? -Infinity), span = x1 - x0 || Math.abs(x1) || 1
  const X0 = x0 - span * 0.05, X1 = x1 + span * 0.05, sx = (v: number) => L + ((v - X0) / (X1 - X0)) * (W - 2 * L), base = H - B
  const vline = (v: number | undefined | null, c: string, dash?: boolean) => v != null && !isNaN(v) && <line x1={sx(v)} x2={sx(v)} y1={4} y2={base} stroke={c} strokeDasharray={dash ? '4 3' : undefined} />
  const Item = ({ k, v, tip }: { k: string; v: string; tip?: string }) => <span title={tip}><span className="text-muted-foreground">{k} </span>{v}</span>
  const wc = isWorstCase(labels) // corners, not a distribution: no mean or σ
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-3 font-mono text-xs">
      <div className="flex items-center gap-2 font-sans">
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        <Tip label="Close"><Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Close histogram" onClick={onClose}><X /></Button></Tip>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Item k="runs" v={`${s.n}${s.failed ? ` (+${s.failed} without a value)` : ''}`} />
        {!wc && <Item k="mean" v={f(s.mean)} />}
        {!wc && <Item k="σ" v={f(s.sd)} tip="sample standard deviation (n − 1)" />}
        <Item k="min" v={f(s.min)} />
        <Item k="max" v={f(s.max)} />
        {s.n > 0 && <span className="font-sans text-muted-foreground">{wc ? 'worst case: ' : ''}min in {labels[s.imin] || `run ${s.imin + 1}`}, max in {labels[s.imax] || `run ${s.imax + 1}`}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[720px]" role="img" aria-label={`Histogram of ${title}`}>
        {s.bins.map((b, i) => {
          const a = sx(b.x0), w = Math.max(1, sx(b.x1) - a - 1), h = (b.count / top) * (base - 8)
          return <rect key={i} x={a} y={base - h} width={w} height={h} className="fill-hl/60"><title>{`${f(b.x0)} … ${f(b.x1)}: ${b.count}`}</title></rect>
        })}
        <line x1={L} x2={W - L} y1={base} y2={base} className="stroke-border" />
        {!wc && vline(s.mean, 'currentColor')}
        {vline(lo, 'var(--err)', true)}
        {vline(hi, 'var(--err)', true)}
        {ticks(X0, X1, 4).filter((v) => v >= X0 && v <= X1).map((v, i) => (
          <text key={i} x={sx(v)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">{f(v)}</text>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-2 font-sans">
        <span className="text-muted-foreground">Limits</span>
        <Input className="h-7 w-24 font-mono text-xs md:text-xs" placeholder="low" aria-label="Low limit" value={lim[0]} onChange={(e) => set(0, e.target.value)} />
        <Input className="h-7 w-24 font-mono text-xs md:text-xs" placeholder="high" aria-label="High limit" value={lim[1]} onChange={(e) => set(1, e.target.value)} />
        {badLim ? <span className="text-err">Limits must be numbers, e.g. 680u or 1.2k</span>
          : s.yield != null ? <span><span className="text-muted-foreground">yield </span><span className="font-mono">{(100 * s.yield).toFixed(1)} %</span><span className="text-muted-foreground"> ({Math.round(s.yield * values.length)} of {values.length} runs in spec{s.failed ? '; runs without a value count as out of spec' : ''})</span></span>
          : <span className="text-muted-foreground">Enter a low and/or high limit for the yield</span>}
      </div>
    </div>
  )
}
