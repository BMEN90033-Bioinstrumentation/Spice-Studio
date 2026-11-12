// File-driven V/I sources, expanded into inline PWL just before ngspice runs (main/index.ts runSim); ngspice itself
// has neither PWL-from-file nor a WAV source (its sndfile source isn't in this build). LTspice syntax:
//   V1 in 0 PWL file="drive.csv"              time/value pairs, one per line (spaces, tabs, commas or ;), SI suffixes ok
//   V1 in 0 wavefile="speech.wav" chan=0      the samples as volts, full scale ±1 V; chan 0 = left (the default)
// Relative paths are relative to the project folder (the run's working directory). Pure TS.
// ponytail: ngspice looks PWL points up by a linear scan per time step, so run time grows with the square of the
// point count; MAX_POINTS (~2.3 s of 44.1 kHz audio) keeps a run to roughly 20 s. An XSPICE filesource would scale.
import { spiceValue } from './analysis.ts'
import { parseWav } from './wav.ts'

export const MAX_POINTS = 100_000
export const MAX_FILE_BYTES = 64 * 2 ** 20 // checked (stat) before a file is read: index.ts runSim
const PWL_FILE = /\bpwl\s+file\s*=\s*(?:"([^"]*)"|([^\s"]+))/gi
const WAV_FILE = /\bwavefile\s*=\s*(?:"([^"]*)"|([^\s"]+))(?:\s+chan\s*=\s*(\d+))?/gi

// "t v" lines -> points; a first line that isn't numeric is taken as a CSV header. A line with ';' is the
// semicolon / decimal-comma dialect ("0,001;1,5"). A repeated time (a step) moves 1 ppb later: ngspice wants
// strictly increasing PWL times. Errors name the line, never its content (the path may point anywhere).
export function parsePwlFile(text: string): { t: number[]; v: number[] } | string {
  const t: number[] = [], v: number[] = [], lines = text.split(/\r?\n/)
  let first = true, last = -Infinity
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (!l || /^(#|\*|;|\/\/)/.test(l)) continue
    const [a, b] = l.includes(';') ? l.split(/\s*;\s*|\s+/).map((s) => s.replace(',', '.')) : l.split(/[\s,]+/)
    let x = spiceValue(a ?? '')
    const y = spiceValue(b ?? ''), head = first
    first = false
    if (isNaN(x) || isNaN(y)) {
      if (head) continue // a CSV header row
      return `line ${i + 1} isn't a time and a value`
    }
    if (x < last) return `line ${i + 1}: its time is before the previous point's`
    last = x
    if (t.length && x <= t[t.length - 1]) x = t[t.length - 1] + Math.max(Math.abs(x), 1e-6) * 1e-9
    t.push(x), v.push(y)
  }
  return t.length ? { t, v } : 'no time/value points in the file'
}

const num = (x: number, p: number) => String(+x.toPrecision(p))
// PWL(t v t v …) with a continuation line every 8 points, so no line gets huge; times keep 12 digits (the 1 ppb steps)
export function pwlText(t: ArrayLike<number>, v: ArrayLike<number>): string {
  const out: string[] = []
  for (let i = 0; i < t.length; i++) out.push((i && i % 8 === 0 ? '\n+ ' : '') + num(t[i], 12) + ' ' + num(v[i], 9))
  return `PWL(${out.join(' ')})`
}

export async function expandFileSources(net: string, read: (path: string) => Promise<Uint8Array>): Promise<{ text: string; errors: string[] }> {
  if (!/\b(pwl\s+file|wavefile)\s*=/i.test(net)) return { text: net, errors: [] }
  const errors: string[] = [], pwl = new Map<string, string>()
  const load = async (key: string, path: string, conv: (b: Uint8Array) => { t: ArrayLike<number>; v: ArrayLike<number> } | string) => {
    if (pwl.has(key)) return
    pwl.set(key, '')
    try {
      const r = conv(await read(path))
      if (typeof r === 'string') return void errors.push(`${path}: ${r}`)
      if (r.t.length > MAX_POINTS) return void errors.push(`${path}: ${r.t.length.toLocaleString('en')} points; file sources are limited to ${MAX_POINTS.toLocaleString('en')} (ngspice slows down with the square of the count): shorten or resample it`)
      pwl.set(key, pwlText(r.t, r.v))
    } catch (e) {
      errors.push(`Can't read ${path}: ${(e as Error).message}`)
    }
  }
  // V/I element lines and their '+' continuations; line 0 is the title
  const lines = net.split('\n')
  let prev = false
  const isEl = lines.map((l, i) => (i > 0 && /^\s*\+/.test(l) ? prev : (prev = i > 0 && /^\s*[vi]/i.test(l))))
  for (const l of lines.filter((_, i) => isEl[i])) {
    for (const m of l.matchAll(PWL_FILE)) await load('p:' + (m[1] ?? m[2]), m[1] ?? m[2], (b) => parsePwlFile(new TextDecoder().decode(b)))
    for (const m of l.matchAll(WAV_FILE)) {
      const path = m[1] ?? m[2], ch = +(m[3] ?? 0)
      await load(`w:${ch}:${path}`, path, (b) => {
        const w = parseWav(b)
        if (typeof w === 'string') return w
        if (ch >= w.channels.length) return `chan=${ch}, but the file has ${w.channels.length} channel${w.channels.length > 1 ? 's' : ''} (chan=0 is the first)`
        return { t: Float64Array.from(w.channels[ch], (_, i) => i / w.rate), v: w.channels[ch] }
      })
    }
  }
  if (errors.length) return { text: '', errors }
  const text = lines.map((l, i) => (isEl[i] ? l.replace(PWL_FILE, (_, q, u) => pwl.get('p:' + (q ?? u))!).replace(WAV_FILE, (_, q, u, c) => pwl.get(`w:${+(c ?? 0)}:${q ?? u}`)!) : l)).join('\n')
  return { text, errors }
}
