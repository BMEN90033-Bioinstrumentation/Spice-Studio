// Live results while ngspice runs: main/live.ts sends the rawfile's new points ('sim:live'); liveRun() rebuilds the
// RawPlots from them in growing arrays (each update copies only the new points) and says how far the run is. Pure TS.
import type { LiveChunk, LiveHead, RawPlot } from '../../../main/rawfile'
import { parseAnalysis, spiceValue } from './analysis.ts'
import { isExpr } from '../contracts.ts'

// what survives of a pane's selection on a new result: vectors the plot still has, and every expression ('=…')
export const keepSel = (sel: string[] | undefined, vars: { name: string }[]) => {
  const has = new Set(vars.map((v) => v.name.toLowerCase()))
  return sel?.filter((v) => isExpr(v) || has.has(v)) ?? []
}

export function liveRun() {
  const acc: { head: LiveHead; n: number; cols: Float64Array[] }[] = []
  return {
    add(cs: LiveChunk[]) {
      for (const c of cs) {
        if (c.head) acc[c.plot] = { head: c.head, n: 0, cols: Array.from({ length: c.head.vars.length * (c.head.complex ? 2 : 1) }, () => new Float64Array(1024)) }
        const a = acc[c.plot]
        if (!a) continue
        const w = a.cols.length, k = c.rows.length / w
        if (a.n + k > a.cols[0].length) {
          const cap = Math.max(2 * a.cols[0].length, a.n + k)
          a.cols = a.cols.map((x) => { const y = new Float64Array(cap); y.set(x.subarray(0, a.n)); return y })
        }
        for (let i = 0; i < k; i++) for (let j = 0; j < w; j++) a.cols[j][a.n + i] = c.rows[i * w + j]
        a.n += k
      }
    },
    // snapshot: new objects each call (React sees a change), arrays are views on the growing buffers
    plots(): RawPlot[] {
      return acc.filter(Boolean).map(({ head: h, n, cols }) => {
        const s = h.complex ? 2 : 1
        return { title: h.title, plotname: h.plotname, complex: h.complex, points: n,
          vars: h.vars.map((v, i) => ({ ...v, re: cols[i * s].subarray(0, n), ...(h.complex && { im: cols[i * s + 1].subarray(0, n) }) })) }
      })
    }
  }
}

// 0…1 through the analysis a plot belongs to, from its last scale value and the netlist's .tran / .ac / .dc line
export function progress(p: RawPlot, netlist: string): number | null {
  const kind = /^transient/i.test(p.plotname) ? 'tran' : /^ac\b/i.test(p.plotname) ? 'ac' : /^dc\b/i.test(p.plotname) ? 'dc' : ''
  const line = kind && new RegExp(`^[ \\t]*\\.${kind}\\b.*$`, 'im').exec(netlist)?.[0]
  const a = line ? parseAnalysis(line) : null, x = p.vars[0]?.re[p.points - 1]
  if (!a || x == null) return null
  const f = (lo: number, hi: number, log = false) => (log ? Math.log(x / lo) / Math.log(hi / lo) : (x - lo) / (hi - lo))
  const r = a.kind === 'tran' ? f(spiceValue(a.start || '0'), spiceValue(a.stop))
    : a.kind === 'ac' ? f(spiceValue(a.fstart), spiceValue(a.fstop), a.sweep !== 'lin')
      : a.kind === 'dc' ? f(spiceValue(a.start), spiceValue(a.stop)) : NaN
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : null
}
