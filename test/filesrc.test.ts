import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseRaw } from '../src/main/rawfile.ts'
import { expandFileSources, MAX_POINTS, parsePwlFile, pwlText } from '../src/renderer/src/sim/filesrc.ts'
import { parseWav, traceWav } from '../src/renderer/src/sim/wav.ts'
import { readCapped } from '../src/main/srcfile.ts'

test('parsePwlFile: CSV header, comments, separators, SI suffixes; bad lines and time going back are errors', () => {
  assert.deepEqual(parsePwlFile('time,value\n# comment\n0,0\n1m, 1.5\n\n2m;-1\n3e-3\t2k\n'), { t: [0, 1e-3, 2e-3, 3e-3], v: [0, 1.5, -1, 2000] })
  assert.equal(parsePwlFile('0 0\nroot:x:0:0:secret\n'), 'line 2 isn\'t a time and a value') // the line number, never the content
  assert.match(parsePwlFile('0 0\n2 1\n1 0\n') as string, /line 3: its time is before/)
  // semicolon / decimal-comma dialect
  assert.deepEqual(parsePwlFile('Zeit;Spannung\n0;0\n0,001;1,5\n2e-3 ; -0,25\n'), { t: [0, 0.001, 0.002], v: [0, 1.5, -0.25] })
  // trailing comments after comma-separated points; decimal commas with a tab; a mix that could be either is an error
  assert.deepEqual(parsePwlFile('0,1 ; start\n1,2\n'), { t: [0, 1], v: [1, 2] })
  assert.deepEqual(parsePwlFile('0,1\n1,2 ; end\n2 3 # c\n3,4 // c\n'), { t: [0, 1, 2, 3], v: [1, 2, 3, 4] })
  assert.deepEqual(parsePwlFile('0,5\t1,5\n1,25 -2,5\n'), { t: [0.5, 1.25], v: [1.5, -2.5] })
  assert.equal(parsePwlFile('0,5\t1,5\n1,5\t2\n'), 'line 2: can\'t tell decimal commas from separators (use ; between the columns, or dots)')
  // a step (repeated time) becomes strictly increasing, and stays so when printed
  const st = parsePwlFile('0 0\n1 1\n1 2\n1 3\n2 0\n') as { t: number[]; v: number[] }
  assert.deepEqual(st.v, [0, 1, 2, 3, 0])
  assert.ok(st.t.every((x, i) => !i || x > st.t[i - 1]) && st.t[2] - 1 < 1e-8)
  const pts = pwlText(st.t, st.v).slice(4, -1).split(/\s+/).filter((_, i) => i % 2 === 0).map(Number)
  assert.ok(pts.every((x, i) => !i || x > pts[i - 1]), pwlText(st.t, st.v))
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
  assert.equal(parseWav(riff(1, 16, 1, Buffer.alloc(4)).subarray(0, 30)), 'damaged WAV file (a chunk runs past the end of the file)')
  // NaN samples: silence, and the other trace keeps its level
  const nan = traceWav([0, 1e-3], [[NaN, NaN], [0.5, 0.5]], 1000)
  assert.equal(nan.scale, 1)
  const nw = parseWav(nan.wav) as { channels: Float64Array[] }
  assert.deepEqual([nw.channels[0][0], Math.round(nw.channels[1][0] * 100) / 100], [0, 0.5])
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
  const many = await expandFileSources('* t\nV1 a 0 PWL file=big.txt\nV2 b 0 PWL file=gone.csv\nV3 c 0 wavefile="a b.wav" chan=1\n', read)
  assert.equal(many.text, '')
  assert.equal(many.errors.length, 3)
  assert.match(many.errors[0], /big\.txt: 100,001 points; file sources are limited to 100,000/)
  assert.match(many.errors[1], /Can't read gone\.csv: ENOENT/)
  assert.match(many.errors[2], /chan=1, but the file has 1 channel/)
  assert.equal((await expandFileSources('V1 a 0 SIN(0 1 1k)\n', read)).text, 'V1 a 0 SIN(0 1 1k)\n')
  // '+' continuation lines belong to their element; the title line (first) is never an element
  assert.deepEqual(await expandFileSources('V title PWL file=nope.csv\nV1 a 0\n+ PWL file="d.csv"\nR1 a 0 1k\n+ PWL file=nope.csv\n', read),
    { text: 'V title PWL file=nope.csv\nV1 a 0\n+ PWL(0 0 0.001 1)\nR1 a 0 1k\n+ PWL file=nope.csv\n', errors: [] })
  // ngspice continuation rule: a '+' line continues the previous non-comment, non-blank line; comments stay as written
  assert.deepEqual(await expandFileSources('* t\nV1 a 0\n* note: d.csv\n\n+ PWL file="d.csv"\n', read), { text: '* t\nV1 a 0\n* note: d.csv\n\n+ PWL(0 0 0.001 1)\n', errors: [] })
  // .control blocks hold commands, not elements
  const ctl = '* t\nV1 a 0 DC 1\n.control\nversion pwl file=nope\nif 1\n+ PWL file=nope\nend\n.endc\nI1 a 0 PWL file=d.csv\n'
  assert.deepEqual(await expandFileSources(ctl, read), { text: ctl.replace('PWL file=d.csv', 'PWL(0 0 0.001 1)'), errors: [] })
  // PWL with more than 8 points continues on '+' lines
  files['long.csv'] = new TextEncoder().encode(Array.from({ length: 20 }, (_, i) => `${i}m ${i % 2}`).join('\n'))
  const long = await expandFileSources('* t\nV1 a 0 PWL file=long.csv\n', read)
  assert.equal(long.text.split('\n').filter((l) => l.startsWith('+ ')).length, 2)
})

test('readCapped: regular files only, bytes counted while reading (stat sizes lie for devices)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'filesrc-'))
  writeFileSync(join(dir, 'a.txt'), 'x'.repeat(3000))
  assert.equal((await readCapped(join(dir, 'a.txt'), 3000)).length, 3000)
  await assert.rejects(readCapped(join(dir, 'a.txt'), 2999), /larger than/)
  await assert.rejects(readCapped(dir, 1e6), /not a regular file/)
  const t0 = performance.now()
  if (process.platform !== 'win32') await assert.rejects(readCapped('/dev/zero', 64 * 2 ** 20), /not a regular file/)
  assert.ok(performance.now() - t0 < 100)
})

test('file sources drive ngspice: CSV and WAV values at their time points (skipped if ngspice missing)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'filesrc-'))
  writeFileSync(join(dir, 'drive.csv'), 'time,volts\n0,0\n1m,2\n3m,-1\n4m,0\n')
  writeFileSync(join(dir, 'step.csv'), '0 0\n1m 0\n1m 1\n5m 1\n')
  const sr = 8000, smp = Float64Array.from({ length: 41 }, (_, i) => 0.8 * Math.sin(2 * Math.PI * 500 * (i / sr)))
  writeFileSync(join(dir, 'tone.wav'), traceWav(Float64Array.from(smp, (_, i) => i / sr), [smp], sr).wav)
  const deck = '* file sources\nV1 a 0 PWL file="drive.csv"\nR1 a 0 1k\nV2 b 0 wavefile=tone.wav\nR2 b 0 1k\nV3 c 0 PWL file=step.csv\nR3 c 0 1k\n.tran 10u 5m\n.end\n'
  const x = await expandFileSources(deck, (p) => readFile(resolve(dir, p)))
  assert.deepEqual(x.errors, [])
  writeFileSync(join(dir, 'c.cir'), x.text)
  const r = spawnSync('ngspice', ['-b', '-n', '-r', 'o.raw', 'c.cir'], { cwd: dir, encoding: 'utf8' })
  if (r.error) return void t.skip('ngspice not on PATH')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.doesNotMatch(r.stdout + r.stderr, /non-increasing/i) // the step file's repeated time was nudged
  const [p] = parseRaw(readFileSync(join(dir, 'o.raw')))
  const tt = p.vars[0].re, v = (n: string) => p.vars.find((q) => q.name === n)!.re
  const at = (n: string, time: number) => v(n)[tt.findIndex((u) => Math.abs(u - time) < 1e-9)]
  for (const [time, want] of [[1e-3, 2], [2e-3, 0.5], [3e-3, -1], [4.5e-3, 0]]) assert.ok(Math.abs(at('v(a)', time) - want) < 1e-6, `v(a) at ${time}`)
  assert.ok(Math.abs(at('v(c)', 2e-3) - 1) < 1e-9 && Math.abs(v('v(c)')[tt.findIndex((u) => u >= 0.9e-3)]) < 1e-6, 'step at 1 ms')
  for (const i of [3, 10, 25]) assert.ok(Math.abs(at('v(b)', i / sr) - smp[i]) < 1e-4, `v(b) sample ${i}`) // 16-bit: ±1/32768
})
