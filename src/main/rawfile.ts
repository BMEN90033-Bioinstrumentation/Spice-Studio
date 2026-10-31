// Parser for ngspice binary rawfiles (`ngspice -b -r out.raw`).
// Format written by ngspice-ngspice/src/frontend/rawfile.c: text header, then
// "Binary:\n", then point-major float64 data (re,im pairs if complex).
// A file may hold several plots back to back (e.g. .op then .tran).

export interface RawVar {
  name: string
  type: string // "time", "voltage", "current", "frequency", ...
  re: Float64Array
  im?: Float64Array // only for complex plots
}

export interface RawPlot {
  title: string
  plotname: string
  complex: boolean
  points: number
  vars: RawVar[] // vars[0] is the scale (time / frequency / sweep)
}

export function parseRaw(buf: Uint8Array): RawPlot[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const plots: RawPlot[] = []
  let pos = 0

  const readLine = (): string | null => {
    if (pos >= buf.length) return null
    let end = buf.indexOf(10, pos)
    if (end < 0) end = buf.length
    const line = new TextDecoder().decode(buf.subarray(pos, end))
    pos = end + 1
    return line
  }

  while (pos < buf.length) {
    const h: Record<string, string> = {}
    const names: { name: string; type: string }[] = []
    let line: string | null
    while ((line = readLine()) !== null) {
      if (line === 'Binary:') break
      if (line === 'Values:') throw new Error('ASCII rawfiles not supported (unset filetype=ascii)')
      if (line.startsWith('\t')) {
        const [, name, type] = line.trim().split(/\s+/)
        names.push({ name, type })
        continue
      }
      const i = line.indexOf(':')
      if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
    if (line === null) break // trailing whitespace / no more plots

    const flags = (h['flags'] ?? '').toLowerCase()
    if (flags.includes('unpadded')) throw new Error('unpadded rawfiles not supported')
    const complex = flags.includes('complex')
    const points = parseInt(h['no. points'] ?? '0', 10)
    const nv = names.length
    const stride = complex ? 2 : 1

    const vars: RawVar[] = names.map(({ name, type }) => ({
      name,
      type,
      re: new Float64Array(points),
      ...(complex ? { im: new Float64Array(points) } : {})
    }))
    const need = points * nv * stride * 8
    if (pos + need > buf.length) throw new Error(`rawfile truncated in plot "${h['plotname']}"`)
    for (let p = 0; p < points; p++) {
      for (let v = 0; v < nv; v++) {
        vars[v].re[p] = view.getFloat64(pos, true)
        pos += 8
        if (complex) {
          vars[v].im![p] = view.getFloat64(pos, true)
          pos += 8
        }
      }
    }
    plots.push({ title: h['title'] ?? '', plotname: h['plotname'] ?? '', complex, points, vars })
  }
  return plots
}
