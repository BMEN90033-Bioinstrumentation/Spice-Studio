import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DARK, paint, scene, svgOf, type CTrace, type CvKind, type Shape } from '../src/renderer/src/plot/complex.ts'
import { ticks } from '../src/renderer/src/plot/views.ts'

// an RC low-pass V(out) (|H| ≤ 1), an impedance in Ω and an active trace with |Γ| up to 3
const f = Float64Array.from({ length: 50 }, (_, i) => 10 ** (i / 10))
const tr = (label: string, unit: string, h: (w: number) => [number, number]): CTrace => {
  const v = Array.from(f, (x) => h(2 * Math.PI * x * 1e-3))
  return { label, unit, color: '#fff', x: f, re: Float64Array.from(v, (p) => p[0]), im: Float64Array.from(v, (p) => p[1]) }
}
const TRACES = [
  tr('V(out)', 'V', (w) => [1 / (1 + w * w), -w / (1 + w * w)]),
  tr('Z', 'Ω', (w) => [25, 100 * w - 1 / w]),
  tr('S_2_1', '1', (w) => [3 * Math.cos(w), 3 * Math.sin(w)])
]

// a canvas context that fails like Chromium's on a negative radius and records what it was given
function fakeCtx(bad: string[]) {
  const num = (name: string, ...v: number[]) => v.forEach((x) => Number.isFinite(x) || bad.push(`${name}(${v})`))
  return {
    save() {}, restore() {}, beginPath() {}, clip() {}, fill() {}, stroke() {}, setLineDash() {},
    rect: (...v: number[]) => num('rect', ...v),
    moveTo: (...v: number[]) => num('moveTo', ...v),
    lineTo: (...v: number[]) => num('lineTo', ...v),
    fillText: (_s: string, ...v: number[]) => num('fillText', ...v),
    arc: (x: number, y: number, r: number) => { if (r < 0) throw new Error(`IndexSizeError: The radius provided (${r}) is negative`); num('arc', x, y, r) }
  } as unknown as CanvasRenderingContext2D
}

test('complex views: 0×0, tiny and normal sizes give no negative radii or non-finite shapes, and paint() never throws', () => {
  for (const kind of ['nyquist', 'polar', 'smith'] as CvKind[])
    for (const [w, h] of [[0, 0], [20, 10], [60, 40], [100, 50], [400, 300], [1200, 120]])
      for (const zoom of [{ f: 1 }, { f: 37, c: [0.2, -0.1] as [number, number] }]) {
        const { shapes, pts } = scene(kind, TRACES, 50, w, h, DARK, [10, 1e6], zoom)
        const where = `${kind} ${w}×${h} zoom ${zoom.f}`
        for (const s of shapes as Shape[]) {
          if (s.t === 'clip') {
            const g = (s.rect ?? s.circle)!
            assert.ok(g.every(Number.isFinite), `${where}: clip ${g}`)
            assert.ok(s.circle ? g[2] > 0 : g[2] > 0 && g[3] > 0, `${where}: clip size ${g}`)
          }
          if (s.t === 'dot') assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && s.r > 0, `${where}: dot`)
          if (s.t === 'text') assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), `${where}: text ${s.s}`)
          if (s.t === 'line') assert.ok(s.p.every(Number.isFinite) || s.p.length > 2, `${where}: line`) // NaN only breaks long lines
        }
        if (Math.min(w, h) < 96) assert.equal(shapes.length, 0, `${where}: too small to draw`)
        else assert.ok(shapes.length > 10 && pts.every((p) => p.length === 100), where)
        const bad: string[] = []
        paint(fakeCtx(bad), shapes)
        assert.deepEqual(bad.filter((b) => !b.startsWith('moveTo') && !b.startsWith('lineTo')), [], where)
        svgOf(shapes)
      }
  // a negative or zero clip radius is skipped, not passed to arc()
  assert.doesNotThrow(() => paint(fakeCtx([]), [{ t: 'clip', circle: [10, 10, -28] }, { t: 'dot', x: 1, y: 1, r: -2, c: '#fff' }, { t: 'unclip' }]))
})

test('Smith: |Γ| > 1 gets the note and is clipped at the circle; the note is absent when every point is inside', () => {
  const texts = (t: CTrace[]) => scene('smith', t, 50, 400, 300, DARK, []).shapes.flatMap((s) => (s.t === 'text' ? [s.s] : []))
  assert.ok(texts(TRACES).includes('|Γ| > 1 in places: cut at the edge'))
  assert.ok(!texts(TRACES.slice(0, 2)).includes('|Γ| > 1 in places: cut at the edge'))
  const { shapes, hit } = scene('smith', [TRACES[2]], 50, 400, 300, DARK, [])
  assert.ok(shapes.some((s) => s.t === 'clip' && !!s.circle))
  assert.ok(Array.from(hit[0]).every((v, i) => i % 2 || Number.isNaN(v)), 'points outside the chart are not hoverable')
})

test('ticks stay bounded when the span is far below the values\' precision', () => {
  const t = ticks(1e9, 1e9 + 1e-7, 4)
  assert.ok(t.length >= 1 && t.length <= 11, String(t.length))
  assert.deepEqual(ticks(5, 5), [5])
  assert.deepEqual(ticks(NaN, 1), [])
})

test('complex views on live, still-growing data: 0, 1 and 2 points draw nothing non-finite', () => {
  for (const n of [0, 1, 2])
    for (const kind of ['nyquist', 'polar', 'smith'] as CvKind[]) {
      const cut = TRACES.map((t) => ({ ...t, x: t.x.slice(0, n), re: t.re.slice(0, n), im: t.im.slice(0, n) }))
      const { shapes } = scene(kind, cut, 50, 400, 300, DARK, [f[0], 1e9])
      for (const s of shapes) if (s.t === 'dot' || s.t === 'text') assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), `${kind} n=${n}`)
      assert.doesNotThrow(() => paint(fakeCtx([]), shapes))
    }
})
