// Spectrum of a transient waveform. Pure TS.
// ngspice's time steps are adaptive: resample linearly onto N = 2ⁿ uniform points over [t0, t1), Hann window,
// radix-2 FFT, single-sided amplitude spectrum corrected for the window's coherent gain (a 1 V sine reads ≈ 1 V).

export const MAX_N = 65536
export const nextPow2 = (n: number) => Math.min(MAX_N, 2 ** Math.max(1, Math.ceil(Math.log2(Math.max(2, n)))))

export interface Spectrum { f: Float64Array; mag: Float64Array; n: number; df: number }

export function fft(x: Float64Array, y: ArrayLike<number>, opts: { n?: number; t0?: number; t1?: number } = {}): Spectrum {
  const t0 = opts.t0 ?? x[0], t1 = opts.t1 ?? x[x.length - 1]
  const n = opts.n ?? nextPow2(x.length), dt = (t1 - t0) / n
  const re = new Float64Array(n), im = new Float64Array(n)
  // sample k at t0 + k·dt (periodic: t1 itself is the next period's first sample)
  for (let k = 0, j = 0; k < n; k++) {
    const t = t0 + k * dt
    while (j < x.length - 2 && x[j + 1] <= t) j++
    const span = x[j + 1] - x[j], a = span > 0 ? Math.min(1, Math.max(0, (t - x[j]) / span)) : 0
    re[k] = (y[j] + a * (y[j + 1] - y[j])) * 0.5 * (1 - Math.cos((2 * Math.PI * k) / n)) // Hann (periodic)
  }
  transform(re, im)
  const h = n / 2, f = new Float64Array(h + 1), mag = new Float64Array(h + 1), df = 1 / (n * dt)
  // Hann coherent gain is 1/2: one-sided amplitude = 2·|X|/(N/2), DC and Nyquist aren't doubled
  for (let k = 0; k <= h; k++) (f[k] = k * df), (mag[k] = (Math.hypot(re[k], im[k]) * (k === 0 || k === h ? 2 : 4)) / n)
  return { f, mag, n, df }
}

// in-place iterative radix-2 Cooley–Tukey; length must be a power of two
export function transform(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) [re[i], re[j]] = [re[j], re[i]], [im[i], im[j]] = [im[j], im[i]]
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr, im[b] = im[a] - ti
        re[a] += tr, im[a] += ti
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr, cr = t
      }
    }
  }
}
