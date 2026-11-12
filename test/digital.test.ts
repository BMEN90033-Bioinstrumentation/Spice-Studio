import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRaw } from '../src/main/rawfile.ts'
import { emptySheet, newPart, unconnectedPins, type Sheet } from '../src/renderer/src/schematic/model.ts'
import { netlist } from '../src/renderer/src/schematic/netlist.ts'
import { SYMBOLS } from '../src/renderer/src/schematic/symbols.ts'
import { DIGITAL_PARTS } from '../src/renderer/src/schematic/digital.ts'
import { digitalCounter } from '../src/renderer/src/schematic/digitalExample.ts'
import { BUNDLED, parseLibFile, resolver } from '../src/renderer/src/library/library.ts'
import { erc } from '../src/renderer/src/sim/erc.ts'

// the bundled engine (XSPICE code models via spinit + SPICE_LIB_DIR), else ngspice on the PATH
const VENDOR = join(import.meta.dirname, '..', 'vendor', 'ngspice', `${process.platform}-${process.arch}`)
const exe = existsSync(join(VENDOR, 'bin', 'ngspice')) ? join(VENDOR, 'bin', 'ngspice') : 'ngspice'
const env = exe === 'ngspice' ? process.env : { ...process.env, SPICE_LIB_DIR: join(VENDOR, 'share', 'ngspice') }
const lib = resolver(BUNDLED)

function sim(s: Sheet) {
  const n = netlist(s, 'digital', { lib })
  assert.deepEqual([n.errors, n.warnings], [[], []])
  assert.deepEqual(erc(n.text), { errors: [], warnings: [] })
  const dir = mkdtempSync(join(tmpdir(), 'digtest-'))
  writeFileSync(join(dir, 'c.cir'), n.text)
  const r = spawnSync(exe, ['-b', '-n', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { encoding: 'utf8', env })
  if (r.error) return null
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const p = parseRaw(readFileSync(join(dir, 'o.raw'))).find((x) => x.plotname === 'Transient Analysis')!
  const v = (name: string) => p.vars.find((x) => x.name === name)!.re
  return { t: p.vars[0].re, v }
}
// times where y crosses level upwards
const rises = (t: Float64Array, y: Float64Array, level: number) => {
  const out: number[] = []
  for (let i = 1; i < y.length; i++) if (y[i - 1] < level && y[i] >= level) out.push(t[i - 1] + ((level - y[i - 1]) * (t[i] - t[i - 1])) / (y[i] - y[i - 1]))
  return out
}
const at = (t: Float64Array, y: Float64Array, x: number) => y[t.findIndex((u) => u >= x)]

test('digital parts: symbols match their subckts, which parse', () => {
  for (const e of DIGITAL_PARTS) {
    const s = e.spice!, sym = SYMBOLS[e.kind]
    assert.equal(s.type, 'subckt')
    assert.equal(sym.pins.length, s.pins.length, e.id)
    assert.deepEqual(parseLibFile((s as { text: string }).text).errors, [], e.id)
    for (const q of sym.pins) assert.ok(q.x % 10 === 0 && q.y % 10 === 0, `${e.id} pin on grid`)
  }
})

test('digital example: ripple counter, XOR and RC filter simulate through the bridges (skipped if ngspice missing)', (t) => {
  const s = digitalCounter()
  assert.deepEqual(unconnectedPins(s), [])
  const r = sim(s)
  if (!r) return void t.skip('ngspice not found')
  const { t: time, v } = r
  const per = (name: string) => { const x = rises(time, v(name), 2.5); return (x.at(-1)! - x[0]) / (x.length - 1) }
  assert.ok(Math.abs(per('v(clk)') - 1e-6) < 1e-8)
  assert.ok(Math.abs(per('v(q0)') - 2e-6) < 2e-8, `q0 period ${per('v(q0)')}`)
  assert.ok(Math.abs(per('v(q1)') - 4e-6) < 4e-8, `q1 period ${per('v(q1)')}`)
  // counting up: (q1 q0) = 01, 10, 11, 00 after successive clock edges (sampled mid-cycle)
  const bits = [0.7e-6, 1.7e-6, 2.7e-6, 3.7e-6].map((x) => [at(time, v('v(q1)'), x), at(time, v('v(q0)'), x)].map((y) => (y > 2.5 ? 1 : 0)).join(''))
  assert.deepEqual(bits, ['01', '10', '11', '00'])
  for (const x of [0.7e-6, 1.7e-6, 2.7e-6, 3.7e-6]) assert.equal(at(time, v('v(x)'), x) > 2.5, (at(time, v('v(q0)'), x) > 2.5) !== (at(time, v('v(q1)'), x) > 2.5))
  assert.ok(Math.max(...v('v(q1)')) <= 5 + 1e-9 && Math.min(...v('v(q0)')) >= -1e-9, 'outputs swing 0…vdd')
  const avg = v('v(avg)').subarray(Math.floor(v('v(avg)').length / 2))
  assert.ok(Math.max(...avg) < 4.9 && Math.min(...avg) > 0.1, 'RC filter smooths q1')
})

test('NAND ring oscillator: 3 gates, enable; period ≈ 6 gate delays; vdd=3.3 sets the swing (skipped if ngspice missing)', (t) => {
  const s = emptySheet()
  const add = (kind: Parameters<typeof newPart>[1], x: number, y: number, extra = {}) => s.parts.push(newPart(s, kind, x, y, 0, false, extra))
  const lab = (x: number, y: number, value: string) => add('label', x, y, { value })
  const nand = (y: number, a: string, b: string, out: string) => {
    add('nand2', 0, y, { lib: 'std:NAND2', value: 'vdd=3.3 tpd=5n' })
    lab(-30, y - 10, a), lab(-30, y + 10, b), lab(30, y, out)
  }
  nand(0, 'en', 'c', 'a'), nand(100, 'a', 'a', 'b'), nand(200, 'b', 'b', 'c')
  add('vsrc', -200, 0, { value: 'PULSE(0 3.3 100n 1n 1n 1 2)' }), lab(-200, -30, 'en'), add('gnd', -200, 30)
  s.texts.push({ id: 'd', x: 0, y: 300, text: '.tran 0.5n 1u' })
  const r = sim(s)
  if (!r) return void t.skip('ngspice not found')
  const x = rises(r.t, r.v('v(a)'), 1.65)
  assert.ok(x.length >= 8, `oscillates: ${x.length} rising edges`)
  assert.ok(x[0] > 100e-9, 'held until enabled')
  const period = (x.at(-1)! - x[1]) / (x.length - 2)
  assert.ok(period > 6 * 5e-9 && period < 6 * 8e-9, `period ${period}`) // 3 gates × 2 edges × (tpd + bridge edge)
  assert.ok(Math.abs(Math.max(...r.v('v(b)')) - 3.3) < 1e-6)
})
