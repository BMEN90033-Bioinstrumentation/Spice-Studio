import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRaw, type RawPlot } from '../src/main/rawfile.ts'
import { evalExpr, type Val } from '../src/renderer/src/plot/expr.ts'
import { toCsv } from '../src/renderer/src/plot/export.ts'

const f64 = (a: number[]) => Float64Array.from(a)
const tran: RawPlot = {
  title: 't', plotname: 'Transient Analysis', complex: false, points: 3,
  vars: [
    { name: 'time', type: 'time', re: f64([0, 1, 3]) },
    { name: 'v(a)', type: 'voltage', re: f64([1, 2, 3]) },
    { name: 'v(b)', type: 'voltage', re: f64([0.5, 0.5, 1]) },
    { name: 'i(@r1[i])', type: 'current', re: f64([1e-3, 2e-3, 3e-3]) },
    { name: 'i(@r.x1.r5[i])', type: 'current', re: f64([1, 1, 1]) }
  ]
}
const ok = (src: string, plot = tran): Val => {
  const v = evalExpr(src, plot)
  if ('error' in v) throw new Error(`${src}: ${v.error}`)
  return v
}
const near = (a: number, b: number, rel: number, msg = '') => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-15, `${msg} ${a} vs ${b}`)

test('arithmetic, precedence, SPICE suffixes, units', () => {
  assert.deepEqual([...ok('v(a)-v(b)').re], [0.5, 1.5, 2])
  assert.deepEqual([...ok('V(A, B)').re], [0.5, 1.5, 2])
  assert.deepEqual([...ok('-v(a)*2 + 1k/1k').re], [-1, -3, -5])
  assert.deepEqual([...ok('(1+2)*3').re], [9, 9, 9])
  assert.deepEqual([...ok('2.5meg/5meg - .5').re], [0, 0, 0])
  assert.equal(ok('v(a,b)').unit, 'V')
  const p = ok('v(a,b)*i(r1)') // display name I(R1) finds i(@r1[i])
  assert.equal(p.unit, 'W')
  near(p.re[2], 6e-3, 1e-12)
  assert.equal(ok('i(@r1[i])').re[0], 1e-3) // raw name
  assert.equal(ok('i(x1.r5)').re[0], 1) // subckt device
  assert.equal(ok('v(a)/i(r1)').unit, 'Ω')
  assert.deepEqual([...ok('deriv(v(a))').re], [1, 0.6666666666666666, 0.5])
  assert.equal(ok('deriv(v(a))').unit, 'V/s')
})

test('errors come back as messages', () => {
  for (const [src, re] of [['v(nope)', /Unknown vector/], ['v(a)+', /end of expression/], ['(v(a)', /Expected '\)'/], ['v(a) v(b)', /Unexpected/], ['gd(v(a))', /AC/], ['', /Empty/]] as const) {
    const v = evalExpr(src, tran)
    assert.ok('error' in v && re.test(v.error), `${src}: ${JSON.stringify(v)}`)
  }
})

function ngspice(t: { skip: (m: string) => void }, cir: string): RawPlot[] | null {
  const dir = mkdtempSync(join(tmpdir(), 'exprtest-'))
  writeFileSync(join(dir, 'c.cir'), cir)
  try {
    execFileSync('ngspice', ['-b', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { stdio: 'ignore' })
  } catch {
    t.skip('ngspice not on PATH')
    return null
  }
  return parseRaw(readFileSync(join(dir, 'o.raw')))
}

test('complex db/ph/gd of an RC low-pass, deriv of its step response (real ngspice)', (t) => {
  const plots = ngspice(t, '* rc\nV1 in 0 DC 0 AC 1 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.ac dec 100 1 100k\n.tran 10u 5m 0 5u\n.end\n')
  if (!plots) return
  const ac = plots.find((p) => p.plotname === 'AC Analysis')!, f = ac.vars[0].re, RC = 1e-3
  const db = ok('db(v(out)/v(in))', ac), ph = ok('ph(v(out))', ac), gd = ok('gd(v(out))', ac), h = ok('v(out)/v(in)', ac)
  assert.equal(db.unit, 'dB')
  assert.ok(h.im, 'quotient stays complex')
  for (const k of [0, 100, 200, 300, 400, 499]) {
    const w = 2 * Math.PI * f[k] * RC
    near(db.re[k], -10 * Math.log10(1 + w * w), 1e-6, `dB @${f[k]}`)
    near(ph.re[k], (-Math.atan(w) * 180) / Math.PI, 1e-6, `phase @${f[k]}`)
    if (k > 0 && k < 499) near(gd.re[k], RC / (1 + w * w), 0.01, `gd @${f[k]}`)
  }
  const tr = plots.find((p) => p.plotname === 'Transient Analysis')!, tt = tr.vars[0].re
  const d = ok('deriv(v(out))', tr), vo = tr.vars.find((v) => v.name === 'v(out)')!.re
  for (let k = 0; k < tt.length; k++) if (tt[k] > 1e-4 && tt[k] < 4e-3) near(d.re[k], (1 - vo[k]) / RC, 0.02, `dv/dt @${tt[k]}`)
})

test('CSV: shared x column when runs align, per-run x otherwise; quoted headers', () => {
  const x = f64([0, 1])
  assert.equal(
    toCsv('time', [{ label: 'r=1', x, cols: [{ name: 'v(a,b)', y: [1, null] }] }, { label: 'r=2', x: f64([0, 1]), cols: [{ name: 'V(out)', y: f64([3, 4]) }] }]),
    'time,"v(a,b) · r=1",V(out) · r=2\n0,1,3\n1,,4\n'
  )
  assert.equal(
    toCsv('time', [{ label: 'a', x, cols: [{ name: 'V(out)', y: f64([1, 2]) }] }, { label: 'b', x: f64([0, 0.5, 1]), cols: [{ name: 'V(out)', y: f64([5, 6, 7]) }] }]),
    'time · a,V(out) · a,time · b,V(out) · b\n0,1,0,5\n1,2,0.5,6\n,,1,7\n'
  )
  assert.equal(toCsv('frequency', [{ label: '', x, cols: [{ name: 'V(out) dB', y: [-3, Infinity] }] }]), 'frequency,V(out) dB\n0,-3\n1,\n')
})
