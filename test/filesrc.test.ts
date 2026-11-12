import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseRaw } from '../src/main/rawfile.ts'
import { expandFileSources, MAX_POINTS, parsePwlFile } from '../src/renderer/src/sim/filesrc.ts'
import { parseWav, traceWav } from '../src/renderer/src/sim/wav.ts'

test('parsePwlFile: CSV header, comments, separators, SI suffixes; bad lines and time going back are errors', () => {
  assert.deepEqual(parsePwlFile('time,value\n# comment\n0,0\n1m, 1.5\n\n2m;-1\n3e-3\t2k\n'), { t: [0, 1e-3, 2e-3, 3e-3], v: [0, 1.5, -1, 2000] })
  assert.match(parsePwlFile('0 0\nx y\n') as string, /line 2/)
  assert.match(parsePwlFile('0 0\n2 1\n1 0\n') as string, /line 3: time 1 is before/)
  assert.match(parsePwlFile('# nothing\n') as string, /no time\/value points/)
})

test('WAV: 16-bit round trip through traceWav (resampled, scaled), 24-bit and float parse, bad files', () => {
  const x = Float64Array.from({ length: 101 }, (_, i) => i / 1000), y = Float64Array.from(x, (t) => 0.5 * Math.sin(2 * Math.PI * 10 * t))
  const { wav, scale } = traceWav(x, [y, Float64Array.from(y, (v) => -v)], 8000)
  assert.equal(scale, 1)
  const w = parseWav(wav)
  assert.ok(typeof w !== 'string')
  assert.equal(w.rate, 8000)
  assert.equal(w.channels.length, 2)
  assert.equal(w.channels[0].length, 801) // 0…0.1 s at 8 kHz
  for (let i = 0; i < 801; i += 50) assert.ok(Math.abs(w.channels[0][i] - 0.5 * Math.sin(2 * Math.PI * 10 * (i / 8000))) < 2e-3, `sample ${i}`)
  assert.ok(Math.abs(w.channels[1][200] + w.channels[0][200]) < 1e-4)
  assert.equal(traceWav(x, [Float64Array.from(y, (v) => 4 * v)]).scale, 2) // louder than ±1: scaled to its peak
  // hand-built 24-bit mono and 32-bit float stereo
  const riff = (fmt: number, bits: number, nch: number, data: Buffer) => {
    const h = Buffer.alloc(44)
    h.write('RIFF', 0), h.writeUInt32LE(36 + data.length, 4), h.write('WAVEfmt ', 8), h.writeUInt32LE(16, 16), h.writeUInt16LE(fmt, 20), h.writeUInt16LE(nch, 22)
    h.writeUInt32LE(1000, 24), h.writeUInt32LE(1000 * nch * bits / 8, 28), h.writeUInt16LE(nch * bits / 8, 32), h.writeUInt16LE(bits, 34), h.write('data', 36), h.writeUInt32LE(data.length, 40)
    return Buffer.concat([h, data])
  }
  const d24 = Buffer.alloc(6); d24.writeIntLE(-4194304, 0, 3); d24.writeIntLE(8388607, 3, 3)
  assert.deepEqual([...(parseWav(riff(1, 24, 1, d24)) as { channels: Float64Array[] }).channels[0]], [-0.5, 8388607 / 8388608])
  const f32 = Buffer.alloc(8); f32.writeFloatLE(0.25, 0); f32.writeFloatLE(-0.75, 4)
  assert.deepEqual((parseWav(riff(3, 32, 2, f32)) as { channels: Float64Array[] }).channels.map((c) => c[0]), [0.25, -0.75])
  assert.match(parseWav(new Uint8Array(20)) as string, /not a WAV/)
  assert.match(parseWav(riff(2, 4, 1, Buffer.alloc(4))) as string, /unsupported/)
})

test('expandFileSources: V/I lines only, paths quoted or bare, missing files and the size ceiling reported', async () => {
  const files: Record<string, Uint8Array> = {
    'd.csv': new TextEncoder().encode('t,v\n0 0\n1m 1\n'),
    'a b.wav': traceWav([0, 1e-3], [[0, 0.5]], 2000).wav,
    'big.txt': new TextEncoder().encode(Array.from({ length: MAX_POINTS + 1 }, (_, i) => `${i} 0`).join('\n'))
  }
  const read = async (p: string) => files[p] ?? Promise.reject(new Error('ENOENT: no such file'))
  const r = await expandFileSources('* t\nV1 a 0 DC 0 PWL file="d.csv"\nI2 b 0 wavefile="a b.wav" chan=0\n* PWL file=nope.csv\nV3 c 0 pwl FILE=d.csv\n.end\n', read)
  assert.deepEqual(r.errors, [])
  assert.equal(r.text, '* t\nV1 a 0 DC 0 PWL(0 0 0.001 1)\nI2 b 0 PWL(0 0 0.0005 0.25 0.001 0.5)\n* PWL file=nope.csv\nV3 c 0 PWL(0 0 0.001 1)\n.end\n')
  const many = await expandFileSources('V1 a 0 PWL file=big.txt\nV2 b 0 PWL file=gone.csv\nV3 c 0 wavefile="a b.wav" chan=1\n', read)
  assert.equal(many.text, '')
  assert.equal(many.errors.length, 3)
  assert.match(many.errors[0], /big\.txt: 100,001 points; file sources are limited to 100,000/)
  assert.match(many.errors[1], /Can't read gone\.csv: ENOENT/)
  assert.match(many.errors[2], /chan=1, but the file has 1 channel/)
  assert.equal((await expandFileSources('V1 a 0 SIN(0 1 1k)\n', read)).text, 'V1 a 0 SIN(0 1 1k)\n')
  // PWL with more than 8 points continues on '+' lines
  files['long.csv'] = new TextEncoder().encode(Array.from({ length: 20 }, (_, i) => `${i}m ${i % 2}`).join('\n'))
  const long = await expandFileSources('V1 a 0 PWL file=long.csv\n', read)
  assert.equal(long.text.split('\n').filter((l) => l.startsWith('+ ')).length, 2)
})

test('file sources drive ngspice: CSV and WAV values at their time points (skipped if ngspice missing)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'filesrc-'))
  writeFileSync(join(dir, 'drive.csv'), 'time,volts\n0,0\n1m,2\n3m,-1\n4m,0\n')
  const sr = 8000, smp = Float64Array.from({ length: 41 }, (_, i) => 0.8 * Math.sin(2 * Math.PI * 500 * (i / sr)))
  writeFileSync(join(dir, 'tone.wav'), traceWav(Float64Array.from(smp, (_, i) => i / sr), [smp], sr).wav)
  const deck = '* file sources\nV1 a 0 PWL file="drive.csv"\nR1 a 0 1k\nV2 b 0 wavefile=tone.wav\nR2 b 0 1k\n.tran 10u 5m\n.end\n'
  const x = await expandFileSources(deck, (p) => readFile(resolve(dir, p)))
  assert.deepEqual(x.errors, [])
  writeFileSync(join(dir, 'c.cir'), x.text)
  const r = spawnSync('ngspice', ['-b', '-n', '-r', 'o.raw', 'c.cir'], { cwd: dir, encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const [p] = parseRaw(readFileSync(join(dir, 'o.raw')))
  const tt = p.vars[0].re, v = (n: string) => p.vars.find((q) => q.name === n)!.re
  const at = (n: string, time: number) => v(n)[tt.findIndex((u) => Math.abs(u - time) < 1e-9)]
  for (const [time, want] of [[1e-3, 2], [2e-3, 0.5], [3e-3, -1], [4.5e-3, 0]]) assert.ok(Math.abs(at('v(a)', time) - want) < 1e-6, `v(a) at ${time}`)
  for (const i of [3, 10, 25]) assert.ok(Math.abs(at('v(b)', i / sr) - smp[i]) < 1e-4, `v(b) sample ${i}`) // 16-bit: ±1/32768
})
