// Parser for SPICE rawfiles. ngspice (src/frontend/rawfile.c): text header, then "Binary:\n" + point-major float64
// data (re,im pairs if complex), or "Values:\n" + ASCII (`set filetype=ascii`). `unpadded` files skip the values of
// vectors shorter than the plot (their length is the var's dims=). LTspice: UTF-16LE header (newer versions), real data
// as float32 except a float64 scale (all float64 with `double`), `fastaccess` = var-major, time stored as |t| with sign flags.
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

type Head = { h: Record<string, string>; vars: { name: string; type: string; len: number }[] }
const dims = (s: string) => s.split(/[^\d]+/).filter(Boolean).reduce((a, b) => a * +b, 1)

// header lines up to "Binary:" / "Values:"; null when the buffer has no further plot
function header(line: () => string | null): (Head & { data: 'binary' | 'values' }) | null {
  const h: Record<string, string> = {}, vars: Head['vars'] = []
  for (let l: string | null; (l = line()) !== null; ) {
    const t = l.trim(), i = t.indexOf(':')
    if (/^(binary|values):$/i.test(t)) return { h, vars, data: t.slice(0, -1).toLowerCase() as 'binary' | 'values' }
    if (i <= 0) continue
    const k = t.slice(0, i).trim().toLowerCase()
    if (k !== 'variables') { h[k] ??= t.slice(i + 1).trim(); continue }
    // ngspice's reader allows the first var on the "Variables:" line itself
    let v: string | null = t.slice(i + 1).trim() || line()
    for (let n = parseInt(h['no. variables'] ?? '0', 10); n > 0 && v != null; n--, v = n ? line() : null) {
      if (/^(binary|values):$/i.test(v.trim())) return { h, vars, data: v.trim().slice(0, -1).toLowerCase() as 'binary' | 'values' } // fewer vars than declared
      const [, name = '', type = '', ...opt] = v.trim().split(/\s+/)
      const d = opt.find((o) => /^dims=/i.test(o))
      vars.push({ name, type, len: d ? dims(d.slice(5)) : -1 })
    }
  }
  return null
}

// partial: a cut-off file (a stopped run): the plot being written keeps the whole points present instead of throwing
export function parseRaw(buf: Uint8Array, partial = false): RawPlot[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const u16 = buf.length > 1 && buf[0] !== 0 && buf[1] === 0 // "T\0i\0t\0l\0e\0"
  const dec = new TextDecoder(u16 ? 'utf-16le' : 'utf-8')
  const plots: RawPlot[] = []
  let pos = 0
  const line = (): string | null => {
    if (pos >= buf.length) return null
    let end = pos
    if (u16) while (end + 1 < buf.length && !(buf[end] === 10 && buf[end + 1] === 0)) end += 2
    else if ((end = buf.indexOf(10, pos)) < 0) end = buf.length
    const s = dec.decode(buf.subarray(pos, end))
    pos = end + (u16 ? 2 : 1)
    return s
  }

  // Every count in the header is checked against what the bytes can hold BEFORE anything is allocated or looped over:
  // the file may come from anywhere (File > Open Raw File), and a 100-byte header can claim 2^53 points.
  for (let hd; pos < buf.length && (hd = header(line)); ) {
    const { h, vars: names, data } = hd
    const bad = (why: string) => new Error(`rawfile plot "${h['plotname'] ?? ''}": ${why}`)
    if (!names.length || names.length !== parseInt(h['no. variables'] ?? '', 10)) throw bad(`${names.length} variables listed, the header says ${h['no. variables'] ?? 'none'}`)
    const flags = (h['flags'] ?? '').toLowerCase().split(/\s+/)
    const complex = flags.includes('complex'), unpadded = flags.includes('unpadded'), fast = flags.includes('fastaccess')
    const lt = u16 || /lt ?spice|linear tech/i.test(h['command'] ?? '') || flags.includes('forward')
    const nv = names.length, stride = complex ? 2 : 1
    let points = Math.max(0, parseInt(h['no. points'] ?? '0', 10) || 0)
    // unpadded: a vector's own length is its dims=; no point lies beyond the longest vector
    const own = (v: number) => (unpadded && names[v].len >= 0 ? names[v].len : Infinity)
    if (unpadded) points = Math.min(points, Math.max(...names.map((_, v) => own(v))))
    const len = (v: number) => Math.min(own(v), points)
    // bytes per value: complex = 2 float64; LTspice real = float32, except a float64 scale (not .op/.tf) or `double`
    const axis = !/^(operating point|transfer function)/i.test(h['plotname'] ?? '')
    const size = names.map((_, v) => (complex ? 16 : !lt || flags.includes('double') || (v === 0 && axis) ? 8 : 4))
    const truncated = () => bad('truncated')
    const alloc = () => {
      if (nv * points > Math.max(1024, buf.length)) throw bad('too sparse to show (an unpadded plot with almost no values)') // NaN-padding cap
      return names.map(({ name, type }, v): RawVar => ({ name, type, re: new Float64Array(points).fill(len(v) < points ? NaN : 0), ...(complex ? { im: new Float64Array(points) } : {}) }))
    }

    if (data === 'binary') {
      const row = size.reduce((a, b) => a + b, 0), left = buf.length - pos, fit = Math.floor(left / row)
      if (partial && !unpadded && !fast && (!points || points > fit)) points = fit
      if (!unpadded && points > fit) throw truncated()
      if (names.reduce((a, _, v) => a + len(v) * size[v], 0) > left) throw truncated()
      const vars = alloc()
      const get = (v: number, p: number) => {
        if (size[v] === 4) vars[v].re[p] = view.getFloat32(pos, true)
        else vars[v].re[p] = view.getFloat64(pos, true)
        if (complex) vars[v].im![p] = view.getFloat64(pos + 8, true)
        pos += size[v]
      }
      if (fast) for (let v = 0; v < nv; v++) for (let p = 0; p < len(v); p++) get(v, p)
      else for (let p = 0; p < points; p++) for (let v = 0; v < nv; v++) if (p < len(v)) get(v, p)
      if (lt && names[0].type === 'time') vars[0].re = vars[0].re.map(Math.abs)
      plots.push({ title: h['title'] ?? '', plotname: h['plotname'] ?? '', complex, points, vars })
      continue
    }

    // ASCII: " <point>\t<value>\n\t<value>\n…", complex values as "re,im"; runs until the next header line
    const lines: string[] = []
    let eof = true
    for (let at = pos, l: string | null; (l = line()) !== null; at = pos) {
      if (/^[a-z]/i.test(l)) { pos = at, (eof = false); break }
      lines.push(l)
    }
    const tok = lines.join(' ').split(/[\s,]+/).filter(Boolean)
    if (eof && buf[buf.length - (u16 ? 2 : 1)] !== 10) tok.pop() // the file stops mid-line: its last number may be cut short
    const per = 1 + nv * stride, fit = Math.floor(tok.length / per)
    if (partial && !unpadded && (!points || points > fit)) points = fit
    if (points + names.reduce((a, _, v) => a + len(v) * stride, 0) > tok.length) throw truncated()
    const vars = alloc()
    let k = 0
    for (let p = 0; p < points; p++) {
      k++ // point index
      for (let v = 0; v < nv; v++) {
        if (p >= len(v)) continue
        vars[v].re[p] = +tok[k++]
        if (complex) vars[v].im![p] = +tok[k++]
      }
    }
    plots.push({ title: h['title'] ?? '', plotname: h['plotname'] ?? '', complex, points, vars })
  }
  return plots
}

// ---- live: a binary rawfile ngspice is still writing ----
// ngspice writes a plot's header with "No. Points: 0", appends float64 points as it goes and patches the count when
// the analysis ends (outitf.c fileEnd: fseek, write, fseek back, which flushes), so the patch is on disk before the
// next plot's header. The caller reads the bytes appended since the last call, THEN the count field at `countAt`
// (current plot), and passes both to feed(): a 0 count means no later plot's bytes can be in this chunk.
// A plot that ended with 0 points also reads 0: it is over when the next "Title:" follows its header directly.
export type LiveHead = { title: string; plotname: string; complex: boolean; vars: { name: string; type: string }[] }
export type LiveChunk = { plot: number; head?: LiveHead; rows: Float64Array } // rows: point-major, re[,im] per var

const ascii = (b: Uint8Array, s: string, from = 0) => {
  outer: for (let i = b.indexOf(s.charCodeAt(0), from); i >= 0; i = b.indexOf(s.charCodeAt(0), i + 1)) {
    for (let j = 1; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer
    return i
  }
  return -1
}

export class RawTail {
  private pending = new Uint8Array(0)
  private base = 0 // file offset of pending[0]
  private plot = -1
  private cur: { width: number; total: number; got: number; at: number } | null = null
  get countAt() { return this.cur && !this.cur.total ? this.cur.at : -1 } // file offset of the current plot's point count

  feed(bytes: Uint8Array, count = 0): LiveChunk[] {
    if (bytes.length) {
      const p = new Uint8Array(this.pending.length + bytes.length)
      p.set(this.pending), p.set(bytes, this.pending.length), (this.pending = p)
    }
    if (this.cur && count > 0) this.cur.total = count
    const out: LiveChunk[] = []
    for (;;) {
      let head: LiveHead | undefined
      if (!this.cur) {
        const end = ascii(this.pending, '\nBinary:\n')
        if (end < 0) break
        const text = new TextDecoder().decode(this.pending.subarray(0, end + 9)).split('\n')
        let i = 0
        const r = header(() => text[i++] ?? null)!
        const complex = /complex/i.test(r.h['flags'] ?? ''), np = ascii(this.pending, 'No. Points:')
        head = { title: r.h['title'] ?? '', plotname: r.h['plotname'] ?? '', complex, vars: r.vars.map(({ name, type }) => ({ name, type })) }
        this.cur = { width: r.vars.length * (complex ? 2 : 1), total: parseInt(r.h['no. points'] ?? '0', 10) || 0, got: 0, at: this.base + np + 11 }
        this.plot++
        this.drop(end + 9)
      }
      const c = this.cur, row = c.width * 8
      const empty = !c.total && !c.got && ascii(this.pending.subarray(0, 6), 'Title:') === 0
      let n = empty ? 0 : Math.floor(this.pending.length / row)
      if (c.total) n = Math.min(n, c.total - c.got)
      if (n || head) out.push({ plot: this.plot, ...(head && { head }), rows: new Float64Array(this.pending.slice(0, n * row).buffer) }) // little-endian hosts only (x64/arm64)
      c.got += n
      this.drop(n * row)
      if (!empty && (!c.total || c.got < c.total)) break
      this.cur = null
    }
    return out
  }
  private drop(n: number) {
    this.pending = this.pending.subarray(n)
    this.base += n
  }
}
