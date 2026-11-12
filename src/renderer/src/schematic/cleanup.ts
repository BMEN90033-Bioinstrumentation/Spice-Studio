// "Clean up": moves the name/value labels of parts so no label sits on a part, a wire, a directive card or another
// label. Parts and wires are never moved. Pure: the caller supplies the part box (it lives with the symbol drawing code).
import { isFlag } from './symbols.ts'
import type { Part, Pt, Sheet } from './model.ts'

export type Box = { x0: number; y0: number; x1: number; y1: number }
// where Texts draws the two labels (text baseline + anchor) for a part box: beside a tall part, above/below a wide one
export function labelAt(b: Box) {
  const tall = b.y1 - b.y0 >= b.x1 - b.x0, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
  return { n: tall ? [b.x1 + 3, cy - 2] : [cx, b.y0 - 4], v: tall ? [b.x1 + 3, cy + 10] : [cx, b.y1 + 11], anchor: tall ? ('start' as const) : ('middle' as const) }
}
// ponytail: text size estimated from the 9px monospace label font (no DOM here); close enough to keep labels apart
const CW = 5.5, UP = 8, DOWN = 2
const shown = (p: Part) => (p.value.length > 16 ? 16 : p.value.length)
const textBox = (x: number, y: number, chars: number, anchor: 'start' | 'middle'): Box => {
  const w = Math.max(1, chars) * CW, x0 = anchor === 'start' ? x : x - w / 2
  return { x0, y0: y - UP, x1: x0 + w, y1: y + DOWN }
}
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const shift = (b: Box, d: Pt): Box => ({ x0: b.x0 + d.x, y0: b.y0 + d.y, x1: b.x1 + d.x, y1: b.y1 + d.y })

// only: limit to these part ids (the selection); extra: other things labels must stay off (directive cards, notes)
export function cleanLabels(s: Sheet, pbox: (p: Part) => Box, only?: Set<string>, extra: Box[] = []): Sheet {
  const boxes = new Map(s.parts.map((p) => [p.id, pbox(p)]))
  const fixed: Box[] = [...extra, ...[...s.wires, ...(s.buses ?? [])].map((w) => ({ x0: Math.min(w.a.x, w.b.x) - 1, y0: Math.min(w.a.y, w.b.y) - 1, x1: Math.max(w.a.x, w.b.x) + 1, y1: Math.max(w.a.y, w.b.y) + 1 }))]
  const labelled = (p: Part) => !isFlag(p.kind)
  const def = (p: Part) => { const b = boxes.get(p.id)!, l = labelAt(b); return { b, n: textBox(l.n[0], l.n[1], p.name.length, l.anchor), v: textBox(l.v[0], l.v[1], shown(p), l.anchor) } }
  // labels that stay where they are (parts outside `only`) are obstacles from the start
  const placed: Box[] = s.parts.filter((p) => labelled(p) && only && !only.has(p.id)).flatMap((p) => { const d = def(p); return [shift(d.n, p.lo ?? { x: 0, y: 0 }), shift(d.v, p.vo ?? { x: 0, y: 0 })] })
  const cost = (box: Box, self: string) =>
    [...boxes].filter(([id, b]) => id !== self && hits(box, b)).length * 4 + fixed.filter((f) => hits(box, f)).length * 2 + placed.filter((f) => hits(box, f)).length * 4 + (hits(box, boxes.get(self)!) ? 8 : 0)
  const parts = s.parts.map((p) => {
    if (!labelled(p) || (only && !only.has(p.id))) return p
    const d = def(p), { b } = d, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, wn = d.n.x1 - d.n.x0, wv = d.v.x1 - d.v.x0, H = UP + DOWN
    // candidate top-left corners for the name and the value box: as drawn by default first (an untouched label wins a tie), then the four sides
    const at = (x: number, y: number, box: Box): Pt => ({ x: Math.round(x - box.x0), y: Math.round(y - box.y0) })
    const cands: [Pt, Pt][] = [
      [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      [at(b.x1 + 3, cy - H, d.n), at(b.x1 + 3, cy + 2, d.v)], // right
      [at(b.x0 - 3 - wn, cy - H, d.n), at(b.x0 - 3 - wv, cy + 2, d.v)], // left
      [at(cx - wn / 2, b.y0 - 2 - H, d.n), at(cx - wv / 2, b.y1 + 2, d.v)], // name above, value below
      [at(cx - wn / 2, b.y0 - 4 - 2 * H, d.n), at(cx - wv / 2, b.y0 - 2 - H, d.v)], // both above
      [at(cx - wn / 2, b.y1 + 2, d.n), at(cx - wv / 2, b.y1 + 4 + H, d.v)], // both below
      [at(b.x1 + 3, b.y0 - H, d.n), at(b.x1 + 3, b.y1, d.v)], // right, spread to the corners
      [at(b.x0 - 3 - wn, b.y0 - H, d.n), at(b.x0 - 3 - wv, b.y1, d.v)] // left, spread to the corners
    ]
    let best = cands[0], bc = Infinity
    for (const c of cands) {
      const nb = shift(d.n, c[0]), vb = shift(d.v, c[1]), k = cost(nb, p.id) + cost(vb, p.id) + (hits(nb, vb) ? 8 : 0)
      if (k < bc) (best = c), (bc = k)
      if (!k) break
    }
    placed.push(shift(d.n, best[0]), shift(d.v, best[1]))
    const same = (q: Pt, old?: Pt) => q.x === (old?.x ?? 0) && q.y === (old?.y ?? 0)
    if (same(best[0], p.lo) && same(best[1], p.vo)) return p
    const { lo: _n, vo: _v, ...rest } = p
    return { ...rest, ...((best[0].x || best[0].y) && { lo: best[0] }), ...((best[1].x || best[1].y) && { vo: best[1] }) }
  })
  return { ...s, parts }
}
