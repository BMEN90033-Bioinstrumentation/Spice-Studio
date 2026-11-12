// Maths for the extra plot views: phase unwrap (Bode), Z → Γ and chart geometry (Nyquist / polar / Smith), eye folding. Pure TS.

// a phase in degrees, unwrapped: a step of more than 180° between neighbouring points is taken as a wrap. Gaps stay null.
export function unwrap(deg: ArrayLike<number | null>): (number | null)[] {
  let off = 0, prev = NaN
  return Array.from(deg, (y) => {
    if (y == null || !Number.isFinite(y)) return null
    if (Number.isFinite(prev)) off -= 360 * Math.round((y + off - prev) / 360)
    return (prev = y + off)
  })
}

// reflection coefficient of an impedance: Γ = (Z − Z0) / (Z + Z0)
export function gamma(zr: number, zi: number, z0: number): [number, number] {
  const ar = zr - z0, br = zr + z0, d = br * br + zi * zi
  return [(ar * br + zi * zi) / d, (zi * br - ar * zi) / d]
}

// ≈ count round-numbered ticks covering [lo, hi]
export function ticks(lo: number, hi: number, count = 6): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / count, p = 10 ** Math.floor(Math.log10(raw)), step = p * ([1, 2, 5, 10].find((m) => m * p >= raw) ?? 10)
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

// Smith chart grid: constant-resistance circles and constant-reactance arcs (normalised to Z0), as Γ-plane polylines
export const SMITH_R = [0, 0.2, 0.5, 1, 2, 5], SMITH_X = [0.2, 0.5, 1, 2, 5]
export function smithGrid(): { kind: 'r' | 'x'; v: number; pts: [number, number][] }[] {
  const g = (zr: number, zi: number) => gamma(zr, zi, 1), N = 160
  // x = tan(θ) sweeps the whole reactance line; r = t / (1 − t) sweeps resistance 0…∞
  const circles = SMITH_R.map((v) => ({ kind: 'r' as const, v, pts: Array.from({ length: N + 1 }, (_, k) => g(v, Math.tan(-Math.PI / 2 + (Math.PI * k) / N))) }))
  const arcs = SMITH_X.flatMap((x) => [x, -x]).map((v) => ({ kind: 'x' as const, v, pts: Array.from({ length: N + 1 }, (_, k) => g(k / N / (1 - k / N + 1e-9), v)) }))
  return [...circles, ...arcs]
}

// Eye diagram: y(x) resampled on n points per period (linear interpolation) for every whole period
// [offset + kT, offset + (k+1)T] inside the data. At most `max` segments (the first ones).
export function fold(x: ArrayLike<number>, y: ArrayLike<number>, period: number, offset: number, n = 256, max = 2000) {
  const t = Float64Array.from({ length: n }, (_, i) => (i * period) / (n - 1)), segs: Float64Array[] = []
  const x0 = x[0], x1 = x[x.length - 1]
  if (!(period > 0) || !(x1 > x0)) return { t, segs }
  let j = 0
  for (let k = Math.ceil((x0 - offset) / period - 1e-9); segs.length < max; k++) {
    const s = offset + k * period
    if (s + period > x1 * (1 + 1e-12)) break
    const seg = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const v = Math.min(x1, s + t[i])
      while (j < x.length - 2 && x[j + 1] < v) j++
      while (j > 0 && x[j] > v) j--
      const span = x[j + 1] - x[j], a = span > 0 ? Math.min(1, Math.max(0, (v - x[j]) / span)) : 0
      seg[i] = y[j] + a * (y[j + 1] - y[j])
    }
    segs.push(seg)
  }
  return { t, segs }
}
