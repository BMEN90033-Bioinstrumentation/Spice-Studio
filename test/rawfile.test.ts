import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRaw } from '../src/main/rawfile.ts'

function raw(plotname: string, flags: string, vars: string[], rows: number[][]): Buffer {
  const head =
    `Title: t\nDate: d\nPlotname: ${plotname}\nFlags: ${flags}\nNo. Variables: ${vars.length}\n` +
    `No. Points: ${rows.length}\nVariables:\n${vars.map((v, i) => `\t${i}\t${v}\n`).join('')}Binary:\n`
  return Buffer.concat([Buffer.from(head), Buffer.from(new Float64Array(rows.flat()).buffer)])
}

test('parses real + complex plots back to back', () => {
  const buf = Buffer.concat([
    raw('Transient Analysis', 'real', ['time time', 'v(out) voltage'], [[0, 1], [1e-3, 0.5]]),
    raw('AC Analysis', 'complex', ['frequency frequency', 'v(out) voltage'], [[10, 0, 0.7, -0.7]])
  ])
  const [tr, ac] = parseRaw(buf)
  assert.equal(tr.plotname, 'Transient Analysis')
  assert.deepEqual([...tr.vars[1].re], [1, 0.5])
  assert.equal(ac.complex, true)
  assert.equal(ac.vars[0].re[0], 10)
  assert.equal(ac.vars[1].im![0], -0.7)
})

test('rejects truncated data', () => {
  assert.throws(() => parseRaw(raw('x', 'real', ['time time'], [[1]]).subarray(0, -4)), /truncated/)
})

test('round-trips a real ngspice run (skipped if ngspice missing)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rawtest-'))
  writeFileSync(join(dir, 'c.cir'), '* rc\nV1 in 0 DC 1 AC 1\nR1 in out 1k\nC1 out 0 1u\n.op\n.tran 1m 10m\n.ac dec 5 1 1k\n.end\n')
  try {
    execFileSync('ngspice', ['-b', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { stdio: 'ignore' })
  } catch {
    return t.skip('ngspice not on PATH')
  }
  // ngspice orders plots by its own analysis order (AC before OP), not netlist order
  const plots = parseRaw(readFileSync(join(dir, 'o.raw')))
  const by = (n: string) => plots.find((p) => p.plotname === n)!
  assert.equal(plots.length, 3)
  assert.equal(by('Transient Analysis').complex, false)
  const op = by('Operating Point').vars.find((v) => v.name === 'v(out)')!
  assert.ok(Math.abs(op.re[0] - 1) < 1e-6, 'DC op: v(out) = 1V')
  const ac = by('AC Analysis')
  assert.equal(ac.complex, true)
  const vout = ac.vars.find((v) => v.name === 'v(out)')!
  const f = ac.vars[0].re, last = f.length - 1
  const mag = Math.hypot(vout.re[last], vout.im![last])
  const expected = 1 / Math.hypot(1, 2 * Math.PI * f[last] * 1e3 * 1e-6)
  assert.ok(Math.abs(mag - expected) < 1e-3, `|H(${f[last]}Hz)| ${mag} vs ${expected}`)
})
