// Shared symbol renderer: canvas parts, library panel minis and the library viewer's large preview.
// Normal kinds draw from SYMBOLS; 'block' draws a box from part.size with stubs out to part.pins; a part with a custom
// symbol (part.sym, from the symbol editor) draws its shapes, whatever its kind.
import { xform, type Part, type Pt } from '../schematic/model'
import { SYMBOLS, type Kind, type SymbolDef } from '../schematic/symbols'
import { dbox, shapePath, type Shape as Drawn } from '../schematic/drawings'

export type Box = { x0: number; y0: number; x1: number; y1: number }
export type Shape = Partial<Pick<Part, 'pins' | 'size' | 'sym'>>
type Orient = Pick<Part, 'x' | 'y' | 'rot' | 'mirror'>
const ID: Orient = { x: 0, y: 0, rot: 0, mirror: false }

// ponytail: only parses absolute M/L/H/V/A/Z (all symbols.ts uses); arc bulge covered by the padding
// body: leave the pins (and so the leads out to them) out of the box
function pathBox(d: SymbolDef, body = false): Box {
  const xs = body ? [] : d.pins.map((p) => p.x), ys = body ? [] : d.pins.map((p) => p.y)
  if (d.circle) xs.push(-d.circle, d.circle), ys.push(-d.circle, d.circle)
  for (const path of [d.path, d.fill ?? '']) {
    const t = path.match(/[A-Za-z]|-?[\d.]+/g) ?? []
    let cmd = '', x = 0, y = 0, i = 0
    const n = () => +t[i++]
    while (i < t.length) {
      if (/[A-Za-z]/.test(t[i])) { cmd = t[i++]; continue }
      if (cmd === 'H') x = n()
      else if (cmd === 'V') y = n()
      else if (cmd === 'A') (i += 5), (x = n()), (y = n())
      else (x = n()), (y = n())
      if (!body || !d.pins.some((p) => p.x === x && p.y === y)) xs.push(x), ys.push(y)
    }
  }
  if (!xs.length) return body ? pathBox(d) : { x0: -3, y0: -3, x1: 3, y1: 3 }
  return { x0: Math.min(...xs) - 3, y0: Math.min(...ys) - 3, x1: Math.max(...xs) + 3, y1: Math.max(...ys) + 3 }
}
const BOX = Object.fromEntries(Object.entries(SYMBOLS).map(([k, d]) => [k, pathBox(d)])) as Record<Kind, Box>
const BODY = Object.fromEntries(Object.entries(SYMBOLS).map(([k, d]) => [k, pathBox(d, true)])) as Record<Kind, Box>

const body = (p?: Shape) => ({ w: p?.size?.w ?? 40, h: p?.size?.h ?? 40 })
const symPins = (kind: Kind, p?: Shape) => p?.pins ?? SYMBOLS[kind].pins

// Local (unrotated) bounding box, padded by 3.
export function localBox(kind: Kind, p?: Shape): Box {
  if (p?.sym) {
    const bs = [...p.sym.map(dbox), ...(p.pins ?? []).map((q) => ({ x0: q.x, y0: q.y, x1: q.x, y1: q.y }))]
    if (!bs.length) return { x0: -3, y0: -3, x1: 3, y1: 3 }
    return { x0: Math.min(...bs.map((b) => b.x0)) - 3, y0: Math.min(...bs.map((b) => b.y0)) - 3, x1: Math.max(...bs.map((b) => b.x1)) + 3, y1: Math.max(...bs.map((b) => b.y1)) + 3 }
  }
  if (kind !== 'block') return BOX[kind]
  const { w, h } = body(p), ps = symPins(kind, p)
  const xs = [-w / 2, w / 2, ...ps.map((q) => q.x)], ys = [-h / 2, h / 2, ...ps.map((q) => q.y)]
  return { x0: Math.min(...xs) - 3, y0: Math.min(...ys) - 3, x1: Math.max(...xs) + 3, y1: Math.max(...ys) + 3 }
}

// The drawn body without the leads out to the pins (Clean up puts labels beside this). A custom symbol keeps its whole box.
export function bodyBox(kind: Kind, p?: Shape): Box {
  if (p?.sym) return localBox(kind, p)
  if (kind !== 'block') return BODY[kind]
  const { w, h } = body(p)
  return { x0: -w / 2 - 3, y0: -h / 2 - 3, x1: w / 2 + 3, y1: h / 2 + 3 }
}

// a block pin's point on the box edge, and the unit vector pointing into the box
function edge(q: Pt, w: number, h: number): { e: Pt; n: Pt } {
  if (Math.abs(q.x) >= w / 2) return { e: { x: Math.sign(q.x) * (w / 2), y: q.y }, n: { x: -Math.sign(q.x), y: 0 } }
  if (Math.abs(q.y) >= h / 2) return { e: { x: q.x, y: Math.sign(q.y) * (h / 2) }, n: { x: 0, y: -Math.sign(q.y) } }
  return { e: q, n: { x: q.x < 0 ? 1 : -1, y: 0 } } // inside the box: label beside it
}

// closed subpaths (M…Z) of a stroked path: the symbol's body, drawn again as a translucent fill
const shade = (d: string) => (d.match(/M[^M]*Z/g) ?? []).join('')

// Paths in local coords; caller supplies the transform. Stroke/fill styling via CSS (.sym / .symp).
export function SymBody({ kind, part }: { kind: Kind; part?: Shape }) {
  if (part?.sym) {
    const ps = part.sym.filter((d): d is Drawn => 'a' in d).map(shapePath)
    return (
      <>
        <path d={ps.map((x) => x.path).join('')} />
        {ps.some((x) => x.fill) && <path className="f" d={ps.map((x) => x.fill).join('')} />}
      </>
    )
  }
  if (kind === 'block') {
    const { w, h } = body(part)
    const stubs = symPins(kind, part).map((q) => { const { e } = edge(q, w, h); return `M${q.x} ${q.y}L${e.x} ${e.y}` }).join('')
    const box = `M${-w / 2} ${-h / 2}H${w / 2}V${h / 2}H${-w / 2}Z`
    return <><path className="shade" d={box} /><path d={box + stubs} /></>
  }
  const d = SYMBOLS[kind]
  return (
    <>
      {shade(d.path) && <path className="shade" d={shade(d.path)} />}
      <path d={d.path} />
      {d.fill && <path className="f" d={d.fill} />}
      {d.circle && <circle r={d.circle} />}
    </>
  )
}

// text anchor/baseline for a label at q reading in direction n (after orientation), like net labels
function anchor(at: Orient, q: Pt, n: Pt, gap: number, fs: number, s: string, key: number | string, cls: string) {
  const a = xform(at, q), b = xform(at, { x: q.x + n.x, y: q.y + n.y }), dx = b.x - a.x, dy = b.y - a.y
  const t = { x: a.x + dx * gap, y: a.y + dy * gap }
  return (
    <text key={key} className={cls} x={t.x} y={t.y + (dy > 0 ? fs * 0.9 : dy < 0 ? 0 : fs * 0.35)} fontSize={fs}
      textAnchor={dx > 0.5 ? 'start' : dx < -0.5 ? 'end' : 'middle'}>{s}</text>
  )
}

// Block pin names inside the box, drawn in world space (unrotated text) for a part at `at`.
export function PinNames({ part, at, fs = 7 }: { part: Shape; at: Orient; fs?: number }) {
  const { w, h } = body(part)
  return <>{(part.pins ?? []).map((q, i) => { const { e, n } = edge(q, w, h); return anchor(at, e, n, 3, fs, (q as { name?: string }).name ?? '', i, 'pn') })}</>
}

// A custom symbol's text, drawn in world space (upright) for a part at `at`.
export function SymTexts({ part, at }: { part: Shape; at: Orient }) {
  return <>{(part.sym ?? []).map((d, i) => {
    if (d.t !== 'note') return null
    const q = xform(at, { x: d.x, y: d.y }), fs = d.size ?? 7
    return <text key={i} className="pn" x={q.x} y={q.y + fs * 0.85} fontSize={fs}>{d.text}</text>
  })}</>
}

// Standalone <svg>: 'small' = mini icon, 'large' = viewer preview with pin names and numbers.
export function SymbolPreview({ kind, part, size }: { kind: Kind; part?: Shape; size: 'small' | 'large' }) {
  const b = localBox(kind, part), big = size === 'large'
  const pad = big ? 34 : 2, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
  const s = Math.max(b.x1 - b.x0, b.y1 - b.y0, big ? 90 : 50) + 2 * pad
  const names = kind === 'block' || part?.sym ? (part?.pins ?? []).map((q) => (q as { name?: string }).name ?? '') : SYMBOLS[kind].pinNames ?? []
  return (
    <svg className={`symp ${size}`} viewBox={`${cx - s / 2} ${cy - s / 2} ${s} ${s}`} aria-hidden="true">
      <g className="sym"><SymBody kind={kind} part={part} /></g>
      {big && kind === 'block' && part && !part.sym && <PinNames part={part} at={ID} fs={6} />}
      {part?.sym && <SymTexts part={part} at={ID} />}
      {big && symPins(kind, part).map((q, i) => {
        // outward direction: away from the box centre along the dominant axis
        const dx = q.x - cx, dy = q.y - cy, n = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 }
        const label = (kind !== 'block' || part?.sym) && names[i] ? `${i + 1} ${names[i]}` : String(i + 1)
        return (
          <g key={i}>
            <circle className="pin" cx={q.x} cy={q.y} r={1.6} />
            {anchor(ID, q, n, 4, 7, label, 'n' + i, 'pnum')}
          </g>
        )
      })}
    </svg>
  )
}
