import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eta, keepSel, liveRun, progress, runProgress } from '../src/renderer/src/sim/live.ts'

const vars = [{ name: 'time' }, { name: 'v(a)' }, { name: 'v(b)' }]

test('keepSel: expressions always survive a new result; vectors only if the plot has them', () => {
  assert.deepEqual(keepSel(['=v(a)-v(b)'], vars), ['=v(a)-v(b)']) // an expression-only pane (differential probe) is a usable selection
  assert.deepEqual(keepSel(['v(a)', 'v(gone)', '=db(v(b))'], vars), ['v(a)', '=db(v(b))'])
  assert.deepEqual(keepSel(['v(gone)'], vars), []) // nothing usable: the caller falls back to the default
  assert.deepEqual(keepSel(undefined, vars), [])
})

test('liveRun: chunks build growing plots; progress follows the analysis line', () => {
  const lv = liveRun()
  const head = { title: 't', plotname: 'Transient Analysis', complex: false, vars: [{ name: 'time', type: 'time' }, { name: 'v(a)', type: 'voltage' }] }
  lv.add([{ plot: 0, head, rows: new Float64Array([0, 1, 1e-3, 2]) }])
  const rows = new Float64Array(4000).map((_, i) => (i % 2 ? i : 2e-3 + (i / 2) * 1e-6)) // 2000 more points: forces the arrays to grow
  lv.add([{ plot: 0, rows }])
  const [p] = lv.plots()
  assert.equal(p.points, 2002)
  assert.deepEqual([p.vars[0].re[1], p.vars[1].re[1], p.vars[1].re[2001]], [1e-3, 2, 3999])
  assert.equal(progress(p, '* x\n.tran 1u 8m\n.end'), (2e-3 + 1999e-6) / 8e-3)
  const ac = { ...p, plotname: 'AC Analysis', vars: [{ ...p.vars[0], re: new Float64Array([100]) }], points: 1 }
  assert.equal(progress(ac, '.ac dec 10 1 10k'), 0.5) // log sweep: 100 Hz is half way from 1 Hz to 10 kHz
  assert.equal(progress(p, '* no analysis line'), null)
  assert.equal(runProgress([p, ac], '.tran 1u 8m\n.ac dec 10 1 10k\n.op'), 1.5 / 3) // tran done, half way through ac, .op to come
  assert.equal(runProgress([], '.tran 1u 8m'), 0)
  assert.equal(eta(10, 0.25), ' · about 30 s left')
  assert.equal(eta(50, 0.2), ' · about 3 min 20 s left')
  assert.deepEqual([eta(0.5, 0.5), eta(10, 0.01), eta(10, 1)], ['', '', '']) // too early to say; done
})
