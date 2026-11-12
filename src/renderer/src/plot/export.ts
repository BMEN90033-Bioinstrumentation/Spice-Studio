// Plot export: CSV (pure), SVG (hand-built from a drawn uPlot) and PNG (the uPlot canvas + a legend line).
import type uPlot from 'uplot'

export type CsvRun = { label: string; x: ArrayLike<number>; cols: { name: string; y: ArrayLike<number | null | undefined> }[] }

export const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s) // one CSV field
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : String(v))
function same(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// one shared x column when every run has the same x points (AC/DC sweeps), else an x column per run
// (adaptive transient steps differ per run: no resampling, shorter runs leave blank cells)
export function toCsv(xName: string, runs: CsvRun[]): string {
  const shared = runs.every((r) => same(r.x, runs[0].x))
  const tag = (s: string, r: CsvRun) => (r.label && runs.length > 1 ? `${s} · ${r.label}` : s)
  const cols: { name: string; y: ArrayLike<number | null | undefined> }[] = shared ? [{ name: xName, y: runs[0].x }] : []
  for (const r of runs) {
    if (!shared) cols.push({ name: tag(xName, r), y: r.x })
    for (const c of r.cols) cols.push({ name: tag(c.name, r), y: c.y })
  }
  const rows = Math.max(0, ...cols.map((c) => c.y.length)), out = [cols.map((c) => cell(c.name)).join(',')]
  for (let i = 0; i < rows; i++) out.push(cols.map((c) => num(c.y[i])).join(','))
  return out.join('\n') + '\n'
}

// Minimal .xlsx (Office Open XML) with one sheet: strings as inline strings, numbers as numbers, packed in an
// uncompressed ("stored") zip. No library: Excel, Numbers and LibreOffice open it without the .xls-HTML warning.
export function toXlsx(rows: (string | number)[][], sheetName = 'Sheet1'): Uint8Array {
  const esc = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
  const col = (i: number) => { let s = ''; for (let n = i + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
  const c = (v: string | number, r: number, i: number) => typeof v === 'number' && Number.isFinite(v)
    ? `<c r="${col(i)}${r}"><v>${v}</v></c>`
    : `<c r="${col(i)}${r}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', NS = 'http://schemas.openxmlformats.org'
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${NS}/officeDocument/2006/relationships/${type}" Target="${target}"/>`
  const rels = (r: string) => `${X}<Relationships xmlns="${NS}/package/2006/relationships">${r}</Relationships>`
  // each column as wide as its longest cell (characters), capped
  const widths = (rows[0] ?? []).map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(...rows.map((r) => String(r[i] ?? '').length)) + 2)}" customWidth="1"/>`).join('')
  return zip({
    '[Content_Types].xml': `${X}<Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': rels(rel('rId1', 'officeDocument', 'xl/workbook.xml')),
    'xl/workbook.xml': `${X}<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels(rel('rId1', 'worksheet', 'worksheets/sheet1.xml')),
    'xl/worksheets/sheet1.xml': `${X}<worksheet xmlns="${NS}/spreadsheetml/2006/main"><cols>${widths}</cols><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, i) => c(v, r + 1, i)).join('')}</row>`).join('')}</sheetData></worksheet>`
  })
}

const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0 })
export const crc32 = (b: Uint8Array) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0 }
// zip with every entry stored (method 0), dated 1980-01-01; ponytail: no compression or zip64, fine for small exports
function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder(), local: Uint8Array[] = [], central: Uint8Array[] = []
  let off = 0
  const rec = (size: number, fill: (v: DataView) => void) => { const b = new Uint8Array(size); fill(new DataView(b.buffer)); return b }
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), d = enc.encode(text), crc = crc32(d)
    // from 'version needed' on, local and central headers share a layout: flags, method 0, time, date, crc, sizes, name length
    const common = (v: DataView, o: number) => { v.setUint16(o, 20, true); v.setUint16(o + 8, 0x21, true); v.setUint32(o + 10, crc, true); v.setUint32(o + 14, d.length, true); v.setUint32(o + 18, d.length, true); v.setUint16(o + 22, n.length, true) }
    const h = rec(30, (v) => { v.setUint32(0, 0x04034b50, true); common(v, 4) })
    central.push(rec(46, (v) => { v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); common(v, 6); v.setUint32(42, off, true) }), n)
    local.push(h, n, d)
    off += h.length + n.length + d.length
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0), count = Object.keys(files).length
  const end = rec(22, (v) => { v.setUint32(0, 0x06054b50, true); v.setUint16(8, count, true); v.setUint16(10, count, true); v.setUint32(12, cdSize, true); v.setUint32(16, off, true) })
  const all = [...local, ...central, end], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0))
  let p = 0
  for (const b of all) out.set(b, p), (p += b.length)
  return out
}

type Item = { label: string; color: string }
const strokeOf = (u: uPlot, i: number) => {
  const s = u.series[i].stroke as unknown
  return String(typeof s === 'function' ? s(u, i) : (s ?? '#888'))
}
function items(u: uPlot): (Item & { i: number })[] {
  return u.series.flatMap((s, i) => (i && s.show !== false ? [{ i, label: String(s.label ?? ''), color: strokeOf(u, i) }] : []))
}
// plot area in CSS px (uPlot positions .u-over exactly over it)
const area = (u: uPlot) => ({ l: parseFloat(u.over.style.left), t: parseFloat(u.over.style.top), w: u.over.clientWidth, h: u.over.clientHeight })
type Ax = uPlot.Axis & { _splits?: number[]; _values?: (string | number | null)[]; _show?: boolean; side?: number }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const LEG = 18 // legend row height

function legendRows(list: Item[], width: number, charW: number) {
  const rows: { x: number; it: Item }[][] = [[]]
  let x = 8
  for (const it of list) {
    const w = 18 + it.label.length * charW + 16
    if (x + w > width && rows[rows.length - 1].length) rows.push([]), (x = 8)
    rows[rows.length - 1].push({ x, it })
    x += w
  }
  return rows
}

// cursors: x values (data units) drawn as dashed lines labelled A, B
export function toSvg(u: uPlot, cursors: (number | undefined)[] = []): string {
  const { l, t, w, h } = area(u), W = u.width
  const legend = legendRows(items(u), W, 7), H = u.height + legend.length * LEG + 6
  const o: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif" font-size="11">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<defs><clipPath id="plot"><rect x="${l}" y="${t - 2}" width="${w}" height="${h + 4}"/></clipPath></defs>`
  ]
  const f = (v: number) => v.toFixed(1)
  const axes = u.axes as Ax[]
  axes.forEach((a, ai) => {
    if (a._show === false || !a._splits || !a._values) return
    const key = a.scale ?? (ai ? 'y' : 'x')
    a._splits.forEach((s, k) => {
      const lab = a._values![k]
      const p = u.valToPos(s, key)
      if (!(p >= -0.5 && p <= (ai ? h : w) + 0.5)) return
      if (!ai) {
        o.push(`<line x1="${f(l + p)}" y1="${t}" x2="${f(l + p)}" y2="${t + h}" stroke="#e3e6ea"/>`)
        if (lab != null && lab !== '') o.push(`<text x="${f(l + p)}" y="${t + h + 15}" text-anchor="middle" fill="#333">${esc(String(lab))}</text>`)
        return
      }
      if (ai === 1) o.push(`<line x1="${l}" y1="${f(t + p)}" x2="${l + w}" y2="${f(t + p)}" stroke="#e3e6ea"/>`)
      const right = a.side === 1
      if (lab != null && lab !== '')
        o.push(`<text x="${right ? l + w + 6 : l - 6}" y="${f(t + p + 4)}" text-anchor="${right ? 'start' : 'end'}" fill="#333">${esc(String(lab))}</text>`)
    })
  })
  o.push(`<rect x="${l}" y="${t}" width="${w}" height="${h}" fill="none" stroke="#999"/>`, '<g clip-path="url(#plot)" fill="none" stroke-width="1.5" stroke-linejoin="round">')
  const xs = u.data[0], xmin = u.scales.x.min ?? xs[0], xmax = u.scales.x.max ?? xs[xs.length - 1]
  for (const { i, color } of items(u)) {
    const ys = u.data[i] as ArrayLike<number | null | undefined>, key = u.series[i].scale ?? 'y'
    o.push(`<polyline stroke="${color}" points="${decimate(u, xs, ys, key, lo(xs, xmin), hi(xs, xmax)).join(' ')}"/>`)
  }
  o.push('</g>')
  cursors.forEach((c, k) => {
    if (c == null) return
    const p = u.valToPos(c, 'x')
    if (!(p >= 0 && p <= w)) return
    o.push(`<line x1="${f(l + p)}" y1="${t}" x2="${f(l + p)}" y2="${t + h}" stroke="#555" stroke-dasharray="4 3"/>`, `<text x="${f(l + p + 3)}" y="${t + 11}" fill="#555">${'AB'[k]}</text>`)
  })
  legend.forEach((row, r) => {
    const y = u.height + 6 + r * LEG + 9
    for (const { x, it } of row)
      o.push(`<line x1="${x}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="${it.color}" stroke-width="2"/>`, `<text x="${x + 18}" y="${y + 4}" fill="#333">${esc(it.label)}</text>`)
  })
  o.push('</svg>')
  return o.join('\n')
}

// first index with x >= v (minus one, so the line enters the plot), last index with x <= v (plus one)
function lo(xs: ArrayLike<number>, v: number) {
  let a = 0, b = xs.length
  while (a < b) { const m = (a + b) >> 1; if (xs[m] < v) a = m + 1; else b = m }
  return Math.max(0, a - 1)
}
function hi(xs: ArrayLike<number>, v: number) {
  let a = 0, b = xs.length
  while (a < b) { const m = (a + b) >> 1; if (xs[m] <= v) a = m + 1; else b = m }
  return Math.min(xs.length - 1, a)
}

// ≈ one point per pixel column (when there are more than 2 per column): each column keeps its min and max (in order) so peaks survive. Gaps are spanned,
// like the chart's spanGaps.
function decimate(u: uPlot, xs: ArrayLike<number>, ys: ArrayLike<number | null | undefined>, key: string, i0: number, i1: number): string[] {
  const { l, t, w } = area(u), pts: string[] = []
  if (i1 - i0 <= 2 * w) {
    // sparse enough: every point, no decimation steps
    for (let i = i0; i <= i1; i++) {
      const y = ys[i], p = u.valToPos(xs[i], 'x'), q = y == null ? NaN : u.valToPos(y, key)
      if (Number.isFinite(p) && Number.isFinite(q)) pts.push(`${(l + p).toFixed(1)},${(t + q).toFixed(1)}`)
    }
    return pts
  }
  let col = NaN, mn = 0, mx = 0, imn = 0, imx = 0, px = 0
  const flush = () => {
    if (Number.isNaN(col)) return
    const a: [number, number][] = imn <= imx ? [[imn, mn], [imx, mx]] : [[imx, mx], [imn, mn]]
    pts.push(`${(l + px).toFixed(1)},${(t + a[0][1]).toFixed(1)}`)
    if (a[1][1] !== a[0][1]) pts.push(`${(l + px).toFixed(1)},${(t + a[1][1]).toFixed(1)}`)
  }
  for (let i = i0; i <= i1; i++) {
    const y = ys[i]
    if (y == null || !Number.isFinite(y)) continue
    const p = u.valToPos(xs[i], 'x'), q = u.valToPos(y, key), c = Math.round(p)
    if (!Number.isFinite(p) || !Number.isFinite(q)) continue
    if (c !== col) {
      flush()
      col = c, px = p, mn = mx = q, imn = imx = i
    } else if (q < mn) mn = q, imn = i
    else if (q > mx) mx = q, imx = i
  }
  flush()
  return pts
}

export async function toPng(u: uPlot, cursors: (number | undefined)[] = []): Promise<Uint8Array> {
  const src = u.ctx.canvas, pr = src.width / u.width
  const legend = legendRows(items(u), u.width, 7.5)
  const c = src.ownerDocument.createElement('canvas')
  c.width = src.width, c.height = src.height + Math.round((legend.length * LEG + 6) * pr)
  const g = c.getContext('2d')!
  const dark = !!src.ownerDocument.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches, fg = dark ? '#e2e4e8' : '#262626' // the canvas' axes follow the theme
  g.fillStyle = dark ? '#111316' : '#ffffff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(src, 0, 0)
  g.scale(pr, pr)
  const { l, t, w, h } = area(u)
  g.font = '12px Menlo, Consolas, monospace'
  cursors.forEach((x, k) => {
    if (x == null) return
    const p = u.valToPos(x, 'x')
    if (!(p >= 0 && p <= w)) return
    g.strokeStyle = g.fillStyle = fg
    g.setLineDash([4, 3])
    g.beginPath(), g.moveTo(l + p, t), g.lineTo(l + p, t + h), g.stroke()
    g.fillText('AB'[k], l + p + 3, t + 12)
  })
  g.setLineDash([])
  legend.forEach((row, r) => {
    const y = u.height + 6 + r * LEG + 9
    for (const { x, it } of row) {
      g.fillStyle = it.color
      g.fillRect(x, y - 1, 14, 2)
      g.fillStyle = fg
      g.fillText(it.label, x + 18, y + 4)
    }
  })
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'))
  if (!blob) throw new Error('PNG encoding failed')
  return new Uint8Array(await blob.arrayBuffer())
}
