// WAV in (file sources) and out (Export > Plot as WAV). Pure TS. Full scale is ±1 V, as in LTspice's wavefile=.
// Reads PCM 8/16/24/32-bit and float 32/64 (plain or WAVE_FORMAT_EXTENSIBLE); writes 16-bit PCM.

export function parseWav(b: Uint8Array): { rate: number; channels: Float64Array[] } | string {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4))
  if (b.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return 'not a WAV file (no RIFF/WAVE header)'
  let fmt = 0, nch = 0, rate = 0, bits = 0, data: Uint8Array | null = null
  for (let o = 12; o + 8 <= b.length; o += 8 + v.getUint32(o + 4, true) + (v.getUint32(o + 4, true) & 1)) {
    const size = v.getUint32(o + 4, true)
    if (tag(o) === 'fmt ') {
      fmt = v.getUint16(o + 8, true), nch = v.getUint16(o + 10, true), rate = v.getUint32(o + 12, true), bits = v.getUint16(o + 22, true)
      if (fmt === 0xfffe && size >= 26) fmt = v.getUint16(o + 32, true) // extensible: the subformat GUID starts with the format code
    } else if (tag(o) === 'data') data = b.subarray(o + 8, Math.min(b.length, o + 8 + size))
  }
  if (!data || !nch || !rate) return 'WAV file has no fmt or data chunk'
  const bytes = bits / 8, n = Math.floor(data.length / (bytes * nch)), d = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const read: ((o: number) => number) | undefined = fmt === 3
    ? ({ 4: (o: number) => d.getFloat32(o, true), 8: (o: number) => d.getFloat64(o, true) } as Record<number, (o: number) => number>)[bytes]
    : fmt === 1
      ? ({ 1: (o: number) => (d.getUint8(o) - 128) / 128, 2: (o: number) => d.getInt16(o, true) / 32768,
        3: (o: number) => ((d.getUint8(o) | (d.getUint8(o + 1) << 8) | (d.getInt8(o + 2) << 16)) / 8388608), 4: (o: number) => d.getInt32(o, true) / 2147483648 } as Record<number, (o: number) => number>)[bytes]
      : undefined
  if (!read) return `unsupported WAV encoding (format ${fmt}, ${bits}-bit): use PCM or 32/64-bit float`
  const channels = Array.from({ length: nch }, (_, c) => Float64Array.from({ length: n }, (_, i) => read((i * nch + c) * bytes)))
  return { rate, channels }
}

// traces on a common x (seconds) -> 16-bit PCM WAV at `rate`, one channel per trace, linearly interpolated.
// Full scale = ±1 (V or A); louder traces are scaled down together to fit (`scale` is the full-scale value used).
export function traceWav(x: ArrayLike<number>, ys: ArrayLike<number | null>[], rate = 44100): { wav: Uint8Array; scale: number } {
  const t0 = x[0], n = Math.max(1, Math.floor((x[x.length - 1] - t0) * rate) + 1), nch = ys.length
  let peak = 1
  for (const y of ys) for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i] ?? 0))
  const out = new Uint8Array(44 + n * nch * 2), v = new DataView(out.buffer)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'), v.setUint32(4, 36 + n * nch * 2, true), str(8, 'WAVEfmt '), v.setUint32(16, 16, true)
  v.setUint16(20, 1, true), v.setUint16(22, nch, true), v.setUint32(24, rate, true), v.setUint32(28, rate * nch * 2, true)
  v.setUint16(32, nch * 2, true), v.setUint16(34, 16, true), str(36, 'data'), v.setUint32(40, n * nch * 2, true)
  ys.forEach((y, c) => {
    let j = 0
    for (let i = 0; i < n; i++) {
      const t = t0 + i / rate
      while (j < x.length - 2 && x[j + 1] < t) j++
      const a = y[j] ?? 0, b = y[j + 1] ?? a, dx = x[j + 1] - x[j]
      const s = dx > 0 ? a + ((b - a) * Math.min(1, Math.max(0, (t - x[j]) / dx))) : a
      v.setInt16(44 + (i * nch + c) * 2, Math.round(Math.max(-1, Math.min(1, s / peak)) * 32767), true)
    }
  })
  return { wav: out, scale: peak }
}
