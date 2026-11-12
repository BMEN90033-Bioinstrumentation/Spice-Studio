// .meas results from an ngspice-47 run log. Pure TS.
//   tdelay              =  6.93148e-04 targ=  6.93648e-04 trig=  5.00000e-07
//   Error: measure  bad  trig(TRIG) : out of interval      ⏎  " .meas tran bad trig ... failed!"
// Names come out lowercased. A failed one is listed with value null (its Error line as text), in log order.
import type { Measurement } from '../contracts.ts'
import { logicalLines } from './analysis.ts'

const OK = /^(\S+)\s+=\s+(\S+)(.*)$/
const ERR = /^Error: measure\s+(\S+)\s+(.*)$/
const FAILED = /^\.meas(?:ure)?\s+\w+\s+(\S+)\b.*\bfailed!$/i

// ngspice-47 skips .meas in `-b -r rawfile` runs ("No .measure possible in batch mode (-b) with -r rawfile set!"),
// and a .control run/write deck exits 0 even when the analysis fails. So decks with .meas get a second, rawfile-less
// pass with this control block (main/index.ts); null = no second pass. A deck with its own .control is left alone.
// ponytail: costs a second ngspice run per .meas deck; libngspice (shared mode) would give vectors and meas in one.
// In a .control deck ngspice evaluates .meas only for the analysis that ran last (with `run`, tran wins over ac, and a
// .tf/.pz/.sens/.disto after the .tran leaves the tran measurements empty). So the pass runs only the analyses
// something measures, each as its own command (each command evaluates its own type's .meas); a line that needs
// .param braces (or a 'quoted' expression) can't be a command, so then the others are commented out and `run` measures
// the last type only. Lines are read as ngspice reads them (logicalLines: + continuations, inline comments); the deck
// is otherwise left byte for byte, except that every physical line of an unmeasured analysis gets a `*`.
// .four is skipped like .meas ("fourier line ignored since rawfile was produced") and a .control deck ignores .four
// lines, so each becomes a `fourier` command on the transient plot (tran1: each run is a fresh ngspice), after an
// echoed marker that measSection starts at, so fourier errors (too short a run, no .tran) reach the log.
const AN = /^\.(op|tran|ac|dc|noise|tf|sens|pz|disto|sp|pss)\b/i
export const FOUR_MARK = 'Fourier analysis (.four):'
export function measDeck(netlist: string): string | null {
  const lines = logicalLines(netlist), grab = (re: RegExp) => lines.flatMap((l) => re.exec(l.text)?.[1] ?? [])
  // the arguments go into a .control block, where a backquote or $ would run a shell command or expand a variable:
  // only a frequency and plain vector names (v(a), v(a,b), i(v1), x1.out, @m1[id]) become a command
  const FOUR_OK = /^[\w.+-]+(\s+(?:[\w.#:+@[\]-]+\(\s*[\w.#:+-]+(?:\s*,\s*[\w.#:+-]+)?\s*\)|[\w.#:+@[\]-]+))+$/
  const four = grab(/^\.four(?:ier)?\s+(.*)/i).map((x) => (FOUR_OK.test(x.trim()) ? 'fourier ' + x.trim() : 'echo Error: a .four line was skipped: only a frequency and plain vector names are accepted'))
  const types = new Set(grab(/^\.meas(?:ure)?\s+(\w+)/i).map((x) => x.toLowerCase()))
  if (four.length) types.add('tran')
  if (!types.size || lines.some((l) => /^\.control\b/i.test(l.text))) return null
  const an = lines.filter((l) => AN.test(l.text)), measured = (l: { text: string }) => types.has(AN.exec(l.text)![1].toLowerCase())
  const off = new Set(an.filter((l) => !measured(l)).flatMap((l) => l.rows))
  const deck = netlist.split('\n').map((l, i) => (off.has(i) ? '*' + l : l)).join('\n')
  const cmds = an.filter(measured).map((l) => l.text.slice(1))
  const plain = cmds.length && cmds.every((c) => /^\w+(\s+[\w.+-]+)*$/.test(c)) // names, numbers, keywords only
  const ctl = ['.control', ...(plain ? cmds : ['run']), ...(four.length ? [`echo ${FOUR_MARK}`, 'setplot tran1', ...four] : []),
    'quit', '.endc', ''].join('\n'), END = /^[ \t]*\.end[ \t]*\r?$/im
  return END.test(deck) ? deck.replace(END, ctl + '.end') : deck.replace(/\n?$/, '\n' + ctl)
}
// the measurement (and Fourier) part of a measDeck run's log, appended to the run log, plus any Error lines from before
// it (stderr, e.g. a fourier failure, does not keep its place relative to stdout through the pipes)
export const measSection = (log: string) => {
  const i = log.search(/^\s*(Measurements for |Fourier analysis for |Fourier analysis \(\.four\):)/m)
  const errs = log.slice(0, i < 0 ? undefined : i).split('\n').filter((l) => /^\s*error\b/i.test(l)).map((l) => l.trim())
  const sec = i < 0 ? '' : log.slice(i).replace(/^ngspice-\S+ done\s*$/m, '').replace(/\n{3,}/g, '\n\n').trim()
  return [sec, ...errs].filter(Boolean).join('\n')
}

export function parseMeas(log: string): Measurement[] {
  const out: Measurement[] = [], seen = new Set<string>()
  const add = (name: string, value: number | null, text: string) => {
    if (!seen.has(name)) seen.add(name), out.push({ name, value, text })
  }
  let on = false // only inside a "Measurements for … Analysis" block: "x = 1" also appears in device listings
  for (const raw of log.split('\n')) {
    const l = raw.trim()
    if (/^Measurements for /.test(l)) on = true
    else if (/^(ngspice-\S+ done|Total analysis time|Doing analysis|Fourier analysis for|---)/.test(l)) on = false
    if (!on) continue
    let m
    if ((m = ERR.exec(l))) add(m[1].toLowerCase(), null, l)
    else if ((m = FAILED.exec(l))) add(m[1].toLowerCase(), null, l)
    else if ((m = OK.exec(l)) && !isNaN(Number(m[2]))) add(m[1].toLowerCase(), Number(m[2]), l.replace(/\s+/g, ' '))
  }
  return out
}

// ---- .four: "Fourier analysis for v(out):" blocks (from the measDeck pass) ----
export type Harmonic = { n: number; freq: number; mag: number; phase: number; nmag: number; nphase: number }
export type Fourier = { run: string; vector: string; thd: number; rows: Harmonic[] }
// log = the whole results log; sweep runs are marked "--- run R=1k ---" (main.tsx)
export function parseFour(log: string): Fourier[] {
  const out: Fourier[] = []
  let run = '', cur: Fourier | null = null, m
  for (const l of log.split('\n').map((x) => x.trim())) {
    if ((m = /^--- run (.*) ---$/.exec(l))) (run = m[1]), (cur = null)
    else if ((m = /^Fourier analysis for (.+):$/.exec(l))) out.push((cur = { run, vector: m[1], thd: NaN, rows: [] }))
    else if (!cur || !l || /^(Harmonic\s|-+\s)/.test(l)) continue
    else if ((m = /\bTHD:\s*(\S+)\s*%/.exec(l))) cur.thd = Number(m[1])
    else if ((m = /^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(l))) {
      const [n, freq, mag, phase, nmag, nphase] = m.slice(1).map(Number)
      cur.rows.push({ n, freq, mag, phase, nmag, nphase })
    } else cur = null
  }
  return out
}
