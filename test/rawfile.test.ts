import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRaw, RawTail, type RawPlot } from '../src/main/rawfile.ts'
import { watchRaw } from '../src/main/live.ts'

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

// ---- ASCII, unpadded, partial, LTspice, live tail ----
const ngspice = (dir: string, deck: string, env: Record<string, string> = {}, args: string[] = []) => {
  writeFileSync(join(dir, 'c.cir'), deck)
  try {
    execFileSync('ngspice', ['-b', '-n', ...args, join(dir, 'c.cir')], { cwd: dir, stdio: 'ignore', env: { ...process.env, ...env } })
    return true
  } catch {
    return false
  }
}
const RC = '* rc\nV1 in 0 DC 1 AC 1 PULSE(0 1 0 1u 1u 5m 10m)\nR1 in out 1k\nC1 out 0 1u\n'
const same = (a: RawPlot[], b: RawPlot[]) => {
  assert.deepEqual(a.map((p) => [p.plotname, p.points, p.complex, p.vars.map((v) => v.name)]), b.map((p) => [p.plotname, p.points, p.complex, p.vars.map((v) => v.name)]))
  a.forEach((p, i) => p.vars.forEach((v, j) => {
    const w = b[i].vars[j]
    for (let k = 0; k < p.points; k++) {
      assert.ok(Math.abs(v.re[k] - w.re[k]) <= 1e-12 * Math.max(1, Math.abs(w.re[k])), `${p.plotname} ${v.name}[${k}] ${v.re[k]} vs ${w.re[k]}`)
      if (v.im) assert.ok(Math.abs(v.im[k] - w.im![k]) <= 1e-12 * Math.max(1, Math.abs(w.im![k])))
    }
  }))
}

test('ASCII rawfile (SPICE_ASCIIRAWFILE) matches the binary one (skipped if ngspice missing)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rawtest-'))
  const deck = RC + '.op\n.tran 1m 10m\n.ac dec 5 1 1k\n.end\n'
  if (!ngspice(dir, deck, {}, ['-r', 'b.raw'])) return t.skip('ngspice not on PATH')
  ngspice(dir, deck, { SPICE_ASCIIRAWFILE: '1' }, ['-r', 'a.raw'])
  assert.match(readFileSync(join(dir, 'a.raw'), 'latin1'), /^Values:$/m)
  const a = parseRaw(readFileSync(join(dir, 'a.raw'))), b = parseRaw(readFileSync(join(dir, 'b.raw')))
  assert.equal(a.length, 3)
  same(a, b)
})

test('unpadded binary (set nopadding) and ASCII written by `write` (skipped if ngspice missing)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rawtest-'))
  const ctl = '.control\ntran 1m 10m\nlet short = vector(5)\nset nopadding\nwrite u.raw\nunset nopadding\nwrite p.raw\nset filetype=ascii\nset nopadding\nwrite ua.raw\nac dec 5 1 1k\nwrite a.raw\n.endc\n.end\n'
  if (!ngspice(dir, RC + ctl)) return t.skip('ngspice not on PATH')
  const [u] = parseRaw(readFileSync(join(dir, 'u.raw'))), [p] = parseRaw(readFileSync(join(dir, 'p.raw'))), [ua] = parseRaw(readFileSync(join(dir, 'ua.raw')))
  assert.match(readFileSync(join(dir, 'u.raw'), 'latin1'), /Flags: real unpadded/)
  const short = (x: RawPlot) => x.vars.find((v) => v.name === 'short')!.re
  assert.deepEqual([...short(u).subarray(0, 5)], [0, 1, 2, 3, 4])
  assert.ok(Number.isNaN(short(u)[5]), 'past its dims: NaN (a gap), not a made-up 0')
  assert.deepEqual([...short(ua).subarray(0, 5)], [0, 1, 2, 3, 4])
  for (const x of [u, ua]) same([{ ...x, vars: x.vars.filter((v) => v.name !== 'short') }], [{ ...p, vars: p.vars.filter((v) => v.name !== 'short') }])
  const [ac] = parseRaw(readFileSync(join(dir, 'a.raw')))
  assert.equal(ac.complex, true)
  assert.ok(Math.abs(Math.hypot(ac.vars[2].re[0], ac.vars[2].im![0]) - 1) < 1e-3) // v(out) ≈ 1 at 1 Hz
})

test('partial: a cut-off plot keeps its whole points; strict parse still throws', () => {
  const full = raw('Transient Analysis', 'real', ['time time', 'v(a) voltage'], [[0, 1], [1, 2], [2, 3]])
  const cut = Buffer.from(full.subarray(0, full.length - 12)) // 2.5 points
  assert.throws(() => parseRaw(cut), /truncated/)
  assert.equal(parseRaw(cut, true)[0].points, 2)
  cut.write('No. Points: 0', cut.indexOf('No. Points: 3'), 'latin1') // as ngspice leaves it mid-run
  const [p] = parseRaw(cut, true)
  assert.equal(p.points, 2)
  assert.deepEqual([...p.vars[1].re], [1, 2])
})

test('LTspice: UTF-16 header, float32 values with a float64 |time|, double flag, fastaccess, ASCII', () => {
  const head = (flags: string, n: number) => Buffer.from(
    `Title: * lt\nDate: x\nPlotname: Transient Analysis\nFlags: ${flags}\nNo. Variables: 2\nNo. Points: ${n}\nOffset: 0\nCommand: Linear Technology Corporation LTspice XVII\nVariables:\n\t0\ttime\ttime\n\t1\tV(out)\tvoltage\nBinary:\n`, 'utf16le')
  const row = (t: number, v: number) => { const b = Buffer.alloc(12); b.writeDoubleLE(t); b.writeFloatLE(v, 8); return b }
  const [p] = parseRaw(Buffer.concat([head('real forward', 2), row(0, 0.5), row(-1e-3, 1.5)]))
  assert.deepEqual([...p.vars[0].re], [0, 1e-3])
  assert.deepEqual([...p.vars[1].re], [0.5, 1.5])
  assert.equal(p.vars[1].name, 'V(out)')
  const d = Buffer.alloc(32); [0, 0.25, 1, 0.75].forEach((x, i) => d.writeDoubleLE(x, 8 * i))
  assert.deepEqual([...parseRaw(Buffer.concat([head('real forward double', 2), d]))[0].vars[1].re], [0.25, 0.75])
  // fastaccess: all of time, then all of V(out)
  const f = Buffer.alloc(24); f.writeDoubleLE(0); f.writeDoubleLE(2, 8); f.writeFloatLE(4, 16); f.writeFloatLE(5, 20)
  const [q] = parseRaw(Buffer.concat([head('real forward fastaccess', 2), f]))
  assert.deepEqual([[...q.vars[0].re], [...q.vars[1].re]], [[0, 2], [4, 5]])
  const asc = parseRaw(Buffer.from('Title: x\nPlotname: AC Analysis\nFlags: complex forward\nNo. Variables: 2\nNo. Points: 1\nVariables:\n\t0\tfrequency\tfrequency\n\t1\tV(out)\tvoltage\nValues:\n0\t1.0e+003,0.0\n\t-5.0e-001,2.5e-001\n'))[0]
  assert.equal(asc.vars[0].re[0], 1000)
  assert.deepEqual([asc.vars[1].re[0], asc.vars[1].im![0]], [-0.5, 0.25])
})

test('RawTail: chunks in any sizes decode to the same points; a patched count ends the plot at the next header', () => {
  const op = raw('Operating Point', 'real', ['v(a) voltage', 'v(b) voltage'], [[1, 2]])
  const tran = raw('Transient Analysis', 'real', ['time time', 'v(a) voltage'], Array.from({ length: 50 }, (_, i) => [i, i * i]))
  const ac = raw('AC Analysis', 'complex', ['frequency frequency', 'v(a) voltage'], [[1, 0, 3, 4], [2, 0, 5, 6]])
  const file = Buffer.concat([op, tran, ac])
  const want = parseRaw(file)
  for (const step of [1, 7, 64, 1000, file.length]) {
    const tail = new RawTail(), rows: number[][] = [[], [], []], heads: string[] = []
    for (let i = 0; i < file.length; i += step) {
      const chunk = file.subarray(i, i + step)
      const at = tail.countAt
      const count = at >= 0 ? parseInt(file.subarray(at, at + 12).toString(), 10) : 0
      for (const c of tail.feed(chunk, count)) {
        if (c.head) heads.push(c.head.plotname)
        rows[c.plot].push(...c.rows)
      }
    }
    assert.deepEqual(heads, want.map((p) => p.plotname), `step ${step}`)
    want.forEach((p, i) => {
      const w = p.complex ? 4 : p.vars.length
      assert.equal(rows[i].length, p.points * w, `${p.plotname} step ${step}`)
      p.vars.forEach((v, j) => assert.deepEqual(rows[i].filter((_, k) => k % w === (p.complex ? 2 * j : j)), [...v.re]))
    })
  }
  // mid-run: count 0 and no later header yet -> every whole point so far, then the rest when it arrives
  const run = Buffer.from(tran), np = run.indexOf('No. Points: 50')
  run.write('No. Points: 0 ', np, 'latin1')
  const tail = new RawTail(), body = run.indexOf('Binary:\n') + 8
  const a = tail.feed(run.subarray(0, body + 8 * 2 * 10 + 5))
  assert.equal(a[0].rows.length, 20)
  const b = tail.feed(run.subarray(body + 8 * 2 * 10 + 5))
  assert.equal(b[0].rows.length, 80)
})

test('watchRaw: points arrive while ngspice is still running and add up to the final file (skipped if ngspice missing)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rawtest-'))
  const deck = RC + '.op\n.tran 1u 0.5 0 1u\n.end\n'
  writeFileSync(join(dir, 'c.cir'), deck)
  const { spawn } = await import('node:child_process')
  const p = spawn('ngspice', ['-b', '-n', '-r', join(dir, 'o.raw'), join(dir, 'c.cir')], { stdio: 'ignore' })
  const ok = await new Promise<boolean>((res) => (p.on('error', () => res(false)), p.on('spawn', () => res(true))))
  if (!ok) return t.skip('ngspice not on PATH')
  let early = 0, done = false
  const rows: number[][] = [[], []]
  const stop = watchRaw(join(dir, 'o.raw'), (cs) => {
    for (const c of cs) for (let i = 0; i < c.rows.length; i++) rows[c.plot].push(c.rows[i])
    if (!done && rows[1].length) early++
  }, 50)
  await new Promise((res) => p.on('close', res))
  done = true
  await new Promise((res) => setTimeout(res, 200))
  await stop()
  const [op, tr] = parseRaw(readFileSync(join(dir, 'o.raw')))
  assert.ok(early >= 2, `live updates before the run ended: ${early}`)
  assert.equal(rows[0].length, op.vars.length)
  assert.equal(rows[1].length, tr.points * tr.vars.length)
  const w = tr.vars.length
  assert.equal(rows[1][(tr.points - 1) * w + 2], tr.vars[2].re[tr.points - 1])
})

// ---- hostile input (File > Open Raw File reads anything): every case returns or throws at once, without huge allocations
const quick = (what: string, f: () => unknown) => {
  const t0 = performance.now()
  try { f() } catch (e) { if (e instanceof assert.AssertionError) throw e } // a parse error is fine, a failed check isn't
  const ms = performance.now() - t0
  assert.ok(ms < 250, `${what}: ${ms.toFixed(0)} ms`)
}
test('hostile headers: counts are bounded by the bytes before anything is allocated or looped over', () => {
  const B = (s: string) => Buffer.from(s, 'latin1')
  for (const n of ['9007199254740991', '2000000000']) {
    const f = B(`Title: t\nPlotname: x\nFlags: real\nNo. Points: ${n}\nBinary:\n`)
    assert.throws(() => parseRaw(f), /0 variables listed/)
    quick('no variables ' + n, () => parseRaw(f, true))
  }
  const sparse = B('Title: t\nPlotname: x\nFlags: real unpadded\nNo. Variables: 2\nNo. Points: 500000000\nVariables:\n\t0\ttime\ttime dims=0\n\t1\tv\tvoltage dims=0\nBinary:\n')
  quick('unpadded dims=0', () => assert.equal(parseRaw(sparse)[0].points, 0))
  const one = B('Title: t\nPlotname: x\nFlags: real unpadded\nNo. Variables: 2\nNo. Points: 500000000\nVariables:\n\t0\ttime\ttime dims=1\n\t1\tv\tvoltage dims=0\nBinary:\n' + 'x'.repeat(8))
  quick('unpadded, one value', () => assert.equal(parseRaw(one)[0].points, 1))
  const huge = B(`Title: t\nPlotname: x\nFlags: real unpadded\nNo. Variables: 2\nNo. Points: 500000000\nVariables:\n\t0\ttime\ttime dims=100000\n\t1\tv\tvoltage dims=0\nBinary:\n`)
  quick('unpadded, claims 100000 values', () => assert.throws(() => parseRaw(huge), /truncated/))
  for (const n of ['400000000', '4000000000']) {
    const a = B(`Title: t\nPlotname: x\nFlags: real\nNo. Variables: 1\nNo. Points: ${n}\nVariables:\n\t0\ttime\ttime\nValues:\n0\t1\n`)
    quick('ascii ' + n, () => assert.throws(() => parseRaw(a), /truncated/))
    quick('ascii partial ' + n, () => assert.equal(parseRaw(a, true)[0].points, 1))
  }
  for (const h of ['No. Variables: 999999999', 'No. Variables: -3', 'No. Variables: x', 'No. Points: -5', 'No. Points: NaN'])
    quick(h, () => parseRaw(B(`Title: t\nPlotname: x\nFlags: complex\n${h}\nVariables:\n\t0\tf\tfrequency\nBinary:\n` + 'z'.repeat(64)), true))
  let seed = 1
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  for (let i = 0; i < 200; i++) {
    const g = Buffer.from(Array.from({ length: 200 }, () => Math.floor(rnd() * 256)))
    const head = B(`Title: g\nPlotname: x\nFlags: ${['real', 'complex', 'real unpadded', 'real forward fastaccess'][i % 4]}\nNo. Variables: ${1 + (i % 3)}\nNo. Points: ${Math.floor(rnd() * 1e12)}\nVariables:\n\t0\ttime\ttime dims=${i}\n\t1\tv\tvoltage\n\t2\tw\tvoltage\n${i % 2 ? 'Binary' : 'Values'}:\n`)
    const f = Buffer.concat([head, g])
    quick(`garbage ${i}`, () => parseRaw(f)), quick(`garbage partial ${i}`, () => parseRaw(f, true))
  }
})

test('cut anywhere: a rawfile truncated at every byte returns or throws at once; strict never invents values', () => {
  const bin = Buffer.concat([raw('Operating Point', 'real', ['v(a) voltage'], [[1]]), raw('Transient Analysis', 'real', ['time time', 'v(a) voltage'], [[0, 1.25], [1, 2.5], [2, 3.75]])])
  const asc = Buffer.from('Title: t\nPlotname: Transient Analysis\nFlags: real\nNo. Variables: 2\nNo. Points: 2\nVariables:\n\t0\ttime\ttime\n\t1\tv(a)\tvoltage\nValues:\n0\t0.000000e+00\n\t1.234567e+00\n\n1\t1.000000e-03\n\t2.345678e+00\n\n')
  for (const f of [bin, asc])
    for (let n = 0; n <= f.length; n++) {
      const cut = f.subarray(0, n)
      quick(`cut ${n}`, () => parseRaw(cut, true))
      let plots: RawPlot[] = []
      try { plots = parseRaw(cut) } catch (e) { assert.match((e as Error).message, /truncated|variables listed/); continue }
      for (const p of plots) for (const v of p.vars) for (const x of v.re) assert.ok([0, 1, 2, 1.25, 2.5, 3.75, 1e-3, 1.234567, 2.345678].includes(x), `cut ${n}: ${x}`)
    }
  // a number cut short at the end of an ASCII file is dropped, not read as 2.3
  const cut = asc.subarray(0, asc.indexOf('2.345678') + 3)
  assert.throws(() => parseRaw(cut), /truncated/)
  assert.equal(parseRaw(cut, true)[0].points, 1)
})

test('RawTail: a plot that ended with 0 points does not swallow the next header', () => {
  const file = Buffer.concat([raw('DC transfer characteristic', 'real', ['v-sweep voltage', 'v(a) voltage'], []), raw('Transient Analysis', 'real', ['time time', 'v(a) voltage'], [[0, 1], [1, 2]])])
  for (const step of [1, 5, 9, 300]) {
    const tail = new RawTail(), heads: string[] = [], rows: number[][] = [[], []]
    for (let i = 0; i < file.length; i += step) {
      const at = tail.countAt
      for (const c of tail.feed(file.subarray(i, i + step), at >= 0 ? parseInt(file.subarray(at, at + 12).toString(), 10) : 0)) {
        if (c.head) heads.push(c.head.plotname)
        rows[c.plot].push(...c.rows)
      }
    }
    assert.deepEqual(heads, ['DC transfer characteristic', 'Transient Analysis'], `step ${step}`)
    assert.deepEqual(rows, [[], [0, 1, 1, 2]], `step ${step}`)
  }
})
