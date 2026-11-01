// .meas results from an ngspice-47 run log. Pure TS.
//   tdelay              =  6.93148e-04 targ=  6.93648e-04 trig=  5.00000e-07
//   Error: measure  bad  trig(TRIG) : out of interval      ⏎  " .meas tran bad trig ... failed!"
// Names come out lowercased. A failed one is listed with value null (its Error line as text), in log order.
import type { Measurement } from '../contracts.ts'

const OK = /^(\S+)\s+=\s+(\S+)(.*)$/
const ERR = /^Error: measure\s+(\S+)\s+(.*)$/
const FAILED = /^\.meas(?:ure)?\s+\w+\s+(\S+)\b.*\bfailed!$/i

// ngspice-47 skips .meas in `-b -r rawfile` runs ("No .measure possible in batch mode (-b) with -r rawfile set!"),
// and a .control run/write deck exits 0 even when the analysis fails. So decks with .meas get a second, rawfile-less
// pass with this control block (main/index.ts); null = no second pass. A deck with its own .control is left alone.
// ponytail: costs a second ngspice run per .meas deck; libngspice (shared mode) would give vectors and meas in one.
// ngspice prints .meas for only one analysis type when a deck has several (tran wins over ac, checked on ngspice-47).
export function measDeck(netlist: string): string | null {
  if (!/^[ \t]*\.meas(ure)?\b/im.test(netlist) || /^[ \t]*\.control\b/im.test(netlist)) return null
  const ctl = '.control\nrun\nquit\n.endc\n', END = /^[ \t]*\.end[ \t]*$/im
  return END.test(netlist) ? netlist.replace(END, ctl + '.end') : netlist.replace(/\n?$/, '\n' + ctl)
}
// the measurement part of a measDeck run's log, appended to the run log
export const measSection = (log: string) => {
  const i = log.search(/^\s*Measurements for /m)
  return i < 0 ? '' : log.slice(i).replace(/^ngspice-\S+ done\s*$/m, '').replace(/\n{3,}/g, '\n\n').trim()
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
    else if (/^(ngspice-\S+ done|Total analysis time|Doing analysis|---)/.test(l)) on = false
    if (!on) continue
    let m
    if ((m = ERR.exec(l))) add(m[1].toLowerCase(), null, l)
    else if ((m = FAILED.exec(l))) add(m[1].toLowerCase(), null, l)
    else if ((m = OK.exec(l)) && !isNaN(Number(m[2]))) add(m[1].toLowerCase(), Number(m[2]), l.replace(/\s+/g, ' '))
  }
  return out
}
