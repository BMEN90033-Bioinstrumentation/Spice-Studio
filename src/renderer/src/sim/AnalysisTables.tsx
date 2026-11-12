// Result tables in the .meas table's style (layout/ResultsPanel): .tf / DC .sens / .pz plots in place of a chart, and
// the Fourier tab for .four.
import type { ReactNode } from 'react'
import { eng, type PlotRun } from '../Plot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { Fourier } from './meas'
import { pzRows, sensRows, tableKind, tfRows } from './results'

const TH = 'h-8 px-4 text-right font-medium text-muted-foreground'
const TD = 'px-4 py-1 text-right text-hl'
const NAME = 'px-4 py-1'
const NOTE = 'mb-3 max-w-prose text-xs text-muted-foreground'
// eng() has no prefix past T: an open circuit's 1e20 Ω reads better as 1e+20 Ω
const val = (v: number, unit = '') => (Math.abs(v) >= 1e15 ? `${v.toExponential(2)} ${unit}` : eng(v, unit))

const Head = ({ cols, className }: { cols: ReactNode[]; className?: string }) => (
  <TableHeader>
    <TableRow className="hover:bg-transparent">{cols.map((c, i) => <TableHead key={i} className={cn(TH, className)}>{c}</TableHead>)}</TableRow>
  </TableHeader>
)

export function ScalarTable({ runs }: { runs: PlotRun[] }) {
  const kind = tableKind(runs[0].plot)
  if (kind === 'pz') return <PoleZero runs={runs} />
  const per = runs.map((r) => (kind === 'tf' ? tfRows : sensRows)(r.plot))
  const names = [...new Set(per.flatMap((rows) => rows.map((x) => x.name)))]
  return (
    <div className="absolute inset-0 overflow-auto p-4">
      <p className={NOTE}>
        {kind === 'tf' ? 'Small-signal DC transfer function: the gain from the input source to the output, and the resistances they see.'
          : 'DC sensitivity: how far the output moves per unit change of each part value or parameter (r1: per ohm of R1, r1_m: per unit of its multiplier m). Largest first; zeros left out.'}
      </p>
      {names.length ? (
        <Table className="w-auto font-mono text-xs">
          <Head cols={['', ...runs.map((r) => r.label || 'Value')]} />
          <TableBody>
            {names.map((n) => (
              <TableRow key={n}>
                <TableCell className={NAME}>{n}</TableCell>
                {per.map((rows, i) => {
                  const x = rows.find((r) => r.name === n)
                  return <TableCell key={i} className={TD}>{x ? val(x.value, x.unit) : '—'}</TableCell>
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : <p className="text-xs">Every sensitivity is 0: the output does not depend on any part value.</p>}
    </div>
  )
}

function PoleZero({ runs }: { runs: PlotRun[] }) {
  const many = runs.length > 1
  const rows = runs.flatMap((r) => pzRows(r.plot).map((p, j) => ({ ...p, run: j ? '' : r.label })))
  return (
    <div className="absolute inset-0 overflow-auto p-4">
      <p className={NOTE}>Poles and zeros of the transfer function, in rad/s. f is the natural frequency |s|/2π; Q is shown for complex pairs.</p>
      {rows.length ? (
        <Table className="w-auto font-mono text-xs">
          <Head cols={[...(many ? ['Run'] : []), '', 'Real (rad/s)', 'Imaginary (rad/s)', 'f', 'Q']} />
          <TableBody>
            {rows.map((p, i) => (
              <TableRow key={i}>
                {many && <TableCell className={NAME}>{p.run}</TableCell>}
                <TableCell className={NAME}>{p.kind}</TableCell>
                <TableCell className={TD}>{val(p.re)}</TableCell>
                <TableCell className={TD}>{val(p.im)}</TableCell>
                <TableCell className={TD}>{eng(p.f, 'Hz')}</TableCell>
                <TableCell className={TD}>{p.q == null ? '' : eng(p.q)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : <p className="text-xs">No poles or zeros were found.</p>}
    </div>
  )
}

const deg = (v: number) => (isFinite(v) ? v.toFixed(2) + '°' : '—')

// one table per output vector (and sweep run): harmonics as ngspice prints them, THD in the heading
export function FourierTables({ four }: { four: Fourier[] }) {
  return (
    <div className="absolute inset-0 z-10 overflow-auto bg-background p-4">
      {four.map((f, i) => {
        const unit = /^i\(/i.test(f.vector) ? 'A' : 'V'
        return (
          <section key={i} className="mb-5">
            <h3 className="mb-1 flex gap-3 px-3 text-xs font-medium">
              <span className="font-mono">{f.vector}{f.run && <span className="text-muted-foreground"> · {f.run}</span>}</span>
              <span className="font-mono text-hl">THD {isFinite(f.thd) ? `${+f.thd.toPrecision(4)} %` : '—'}</span>
            </h3>
            <Table className="w-auto font-mono text-xs">
              <Head cols={['Harmonic', 'Frequency', 'Magnitude', 'Phase', 'Norm. mag', 'Norm. phase']} className="px-3" />
              <TableBody>
                {f.rows.map((r) => (
                  <TableRow key={r.n}>
                    <TableCell className={cn(TD, 'px-3 text-foreground')}>{r.n}</TableCell>
                    <TableCell className={cn(TD, 'px-3')}>{eng(r.freq, 'Hz')}</TableCell>
                    <TableCell className={cn(TD, 'px-3')}>{eng(r.mag, unit)}</TableCell>
                    <TableCell className={cn(TD, 'px-3')}>{deg(r.phase)}</TableCell>
                    <TableCell className={cn(TD, 'px-3')}>{eng(r.nmag)}</TableCell>
                    <TableCell className={cn(TD, 'px-3')}>{deg(r.nphase)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        )
      })}
    </div>
  )
}
