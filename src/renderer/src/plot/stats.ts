// Statistics over sweep / Monte Carlo / worst-case runs: summary, yield against limits, histogram bins. Pure TS.

export type Stats = {
  n: number; failed: number // values; runs without one (a failed .meas, cursor off the data)
  mean: number | null; sd: number | null; min: number | null; max: number | null; imin: number; imax: number // sd: sample (n − 1)
  yield: number | null // fraction of all runs within [lo, hi]; a run without a value is out of spec; null without limits
  bins: { x0: number; x1: number; count: number }[]
}

export function stats(vals: (number | null | undefined)[], lo?: number, hi?: number): Stats {
  const v = vals.flatMap((x, i) => (x != null && Number.isFinite(x) ? [[x, i] as const] : []))
  const n = v.length, mean = n ? v.reduce((a, [x]) => a + x, 0) / n : null
  const sd = mean != null && n > 1 ? Math.sqrt(v.reduce((a, [x]) => a + (x - mean) ** 2, 0) / (n - 1)) : null
  let imin = -1, imax = -1
  for (const [x, i] of v) {
    if (imin < 0 || x < vals[imin]!) imin = i
    if (imax < 0 || x > vals[imax]!) imax = i
  }
  const min = imin < 0 ? null : vals[imin]!, max = imax < 0 ? null : vals[imax]!
  const limited = lo != null || hi != null
  const pass = v.filter(([x]) => (lo == null || x >= lo) && (hi == null || x <= hi)).length
  // √n bins (5…30) over [min, max]; equal values make one bin
  const k = min == null ? 0 : min === max ? 1 : Math.min(30, Math.max(5, Math.ceil(Math.sqrt(n))))
  const w = k > 1 ? (max! - min!) / k : 0
  const bins = Array.from({ length: k }, (_, j) => ({ x0: min! + j * w, x1: j === k - 1 ? max! : min! + (j + 1) * w, count: 0 }))
  for (const [x] of v) bins[Math.min(k - 1, w ? Math.floor((x - min!) / w) : 0)].count++
  return { n, failed: vals.length - n, mean, sd, min, max, imin, imax, yield: limited && vals.length ? pass / vals.length : null, bins }
}
