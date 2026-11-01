import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRaw } from '../src/main/rawfile.ts'
import { fft, nextPow2 } from '../src/renderer/src/plot/fft.ts'

const peak = (m: Float64Array) => m.reduce((b, v, i) => (v > m[b] ? i : b), 1)

test('next power of two, capped', () => {
  assert.deepEqual([1, 2, 3, 1000, 1024, 1025, 1e6].map(nextPow2), [2, 2, 4, 1024, 1024, 2048, 65536])
})

test('sampled sine: peak bin and amplitude (uniform and jittered steps)', () => {
  const T = 1e-2, f0 = 1000 // 10 periods
  for (const jitter of [0, 0.4]) {
    let s = 1
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * jitter
    const x = Float64Array.from({ length: 1001 }, (_, k) => (k && k < 1000 ? (k + rnd()) * (T / 1000) : (k * T) / 1000))
    const y = x.map((t) => 2 * Math.sin(2 * Math.PI * f0 * t) + 0.5)
    const { f, mag, n, df } = fft(x, y)
    assert.equal(n, 1024)
    assert.ok(Math.abs(df - 100) < 1e-9)
    const k = peak(mag)
    assert.equal(f[k], f0)
    assert.ok(Math.abs(mag[k] - 2) < 0.01, `amplitude ${mag[k]} (jitter ${jitter})`)
    assert.ok(Math.abs(mag[0] - 0.5) < 0.01, `DC ${mag[0]}`)
    assert.ok(mag[k + 5] < 1e-3, 'leakage stays near the peak')
  }
})

test('real ngspice .tran of a 1 kHz SIN source peaks at 1 kHz, ≈ 0 dBV (skipped if ngspice missing)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fftest-'))
  writeFileSync(join(dir, 'c.cir'), '* sine\nV1 in 0 SIN(0 1 1k)\nR1 in 0 1k\n.tran 1u 10m 0 2u\n.end\n')
  try {
    execFileSync('ngspice', ['-b', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { stdio: 'ignore' })
  } catch {
    return t.skip('ngspice not on PATH')
  }
  const p = parseRaw(readFileSync(join(dir, 'o.raw')))[0]
  const v = p.vars.find((x) => x.name === 'v(in)')!
  const { f, mag } = fft(p.vars[0].re, v.re)
  const k = peak(mag)
  assert.ok(Math.abs(f[k] - 1000) < 1e-6, `peak at ${f[k]} Hz`)
  assert.ok(Math.abs(20 * Math.log10(mag[k])) < 0.1, `${20 * Math.log10(mag[k])} dBV`)
})
