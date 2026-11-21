// Probe helpers: raw-file vector names for nets/parts, .op voltages, and mapping ngspice errors back to the schematic.
import { sheetPorts, type Part, type Sheet } from '../schematic/model.ts'
import type { NetlistResult } from '../schematic/netlist.ts'
import type { RawPlot } from '../../../main/rawfile.ts'
import { logicalLines } from './analysis.ts'

// Observed on ngspice-47 (`ngspice -b -r out.raw`) with `.options savecurrents`:
//  - .op / .tran / .dc plots gain device currents named `i(@r1[i])`, `i(@c1[i])`, `i(@l1[i])`, `i(@i1[current])`,
//    `i(@d1[id])`, `i(@q1[ic])` (+ ie ib is), `i(@m1[id])` (+ is ig ib). Branch currents are always there, named
//    `i(v1)`, `i(l1)`, `i(e1)` (the "v1#branch" spelling is only used in ngspice's console output).
//  - controlled sources: E, H and B with V= have a branch `i(e1)` `i(h1)` `i(b1)` (B also gets `i(@b1[i])`); G, F,
//    B with I=, S and W only have `i(@g1[i])` `i(@f1[i])` `i(@b2[i])` `i(@s1[i])` `i(@w1[i])`. A T line has no current
//    vectors, but its internal port-1 branch node holds the current into port1+: rawfile `v(t1#i1)` (also `t1#i2`).
//    A transformer XF1 is netlisted as LXF1_P / LXF1_S: `i(lxf1_p)` is the primary current.
//  - S/W in the .op plot: `@s1[i]` / `@w1[i]` are computed with Roff even when the switch is on (1 mV across it reads
//    1e-9 A); .dc and .tran are right. ponytail: not filtered out; findVector would need the part kind to know.
//  - .ac: exit status 0, but stderr gets "Warning: unrecognized variable - @r1[i]" per device and the @ vectors
//    hold garbage (zeros / other devices' values). Branch currents i(v1) i(l1) i(e1) are fine.
//  - .noise: no warnings, but both noise plots get the same junk i(@…) vectors appended.
// So findVector ignores @ vectors in complex (AC) and noise plots.
export const SAVE_CURRENTS = '.options savecurrents'

export const voltageVector = (net: string): string | null => (net === '0' ? null : `v(${net.toLowerCase()})`)

export function currentVectors(p: Part, ref: string): string[] {
  const r = ref.toLowerCase()
  const dev = (q: string) => [`i(@${r}[${q}])`, `@${r}[${q}]`]
  const branch = [`i(${r})`, `${r}#branch`]
  switch (p.kind) {
    case 'res': case 'cap': return dev('i')
    case 'ind': return [...branch, ...dev('i')]
    case 'vsrc': case 'opamp': return branch // opamp = VCVS E element
    case 'isrc': return dev('current')
    case 'diode': return dev('id')
    case 'npn': case 'pnp': return dev('ic')
    case 'nmos': case 'pmos': return dev('id')
    case 'vcvs': case 'ccvs': case 'bv': return branch
    case 'vccs': case 'cccs': case 'bi': case 'sw': case 'csw': return dev('i')
    case 'tline': return [`v(${r}#i1)`, `${r}#i1`]
    case 'xfmr': return [`i(l${r}_p)`, `l${r}_p#branch`]
    default: return []
  }
}

// ---- probing on a sub-sheet: its nets and parts live under the block(s) that instance it ----
export interface Hop { file: string; block: Part; ref: string } // a block on sheet `file`, one step down from the top
type Nl = (file: string) => Pick<NetlistResult, 'nets' | 'refs'> // a sheet's own netlist

// every way down from the top sheet to sheet f ([] = f is the top sheet itself); none = the design doesn't use f
export function instancesOf(sheets: Record<string, Sheet>, top: string, f: string, nl: Nl): Hop[][] {
  const out: Hop[][] = []
  const walk = (file: string, hops: Hop[]) => {
    if (file === f) return void out.push(hops)
    if (hops.some((h) => h.file === file)) return // hierarchy cycle: the netlister reports it
    for (const b of sheets[file]?.parts ?? []) {
      const ref = b.kind === 'block' && b.sheet ? nl(file).refs[b.id] : undefined
      if (ref) walk(b.sheet!, [...hops, { file, block: b, ref }])
    }
  }
  walk(top, [])
  return out
}
export const hopPath = (hops: Hop[]) => hops.map((h) => h.ref).join('.')
// net `net` of sheet f, instanced through hops, as ngspice names it after flattening: ground and power flags are
// global, a port's net is whatever the block pin is wired to on the parent, the rest get the instance path (xa.n001).
// ponytail: goes by the net's name on its own sheet; a net carrying both a label and a port is named by the label
// there and won't resolve to the parent's net. Match by port position if that turns up.
export function hierNet(sheets: Record<string, Sheet>, hops: Hop[], f: string, net: string, nl: Nl): string {
  for (let i = hops.length; i > 0; i--) {
    const s = sheets[i === hops.length ? f : hops[i].file], lc = net.toLowerCase(), h = hops[i - 1]
    if (net === '0' || s?.parts.some((p) => p.kind === 'power' && p.value.toLowerCase() === lc)) return net
    const pin = (h.block.pins ?? []).findIndex((q) => q.name.toLowerCase() === lc), up = nl(h.file).nets[h.block.id]?.[pin]
    if (!up || !s || !sheetPorts(s).some((n) => n.toLowerCase() === lc)) return `${hopPath(hops.slice(0, i))}.${net}`
    net = up
  }
  return net
}
// a part's SPICE name inside a block, the way ngspice spells flattened devices: R1 in XA.XB -> r.xa.xb.r1
export const hierRef = (hops: Hop[], ref: string) => (hops.length ? `${ref[0]}.${hopPath(hops)}.${ref}` : ref)

export function findVector(plot: RawPlot, candidates: string[]): string | null {
  const junk = plot.complex || /noise/i.test(plot.plotname) // see SAVE_CURRENTS note
  for (const c of candidates) {
    const lc = c.toLowerCase()
    if (junk && lc.includes('@')) continue
    const v = plot.vars.find((x) => x.name.toLowerCase() === lc)
    if (v) return v.name
  }
  return null
}

export function opVoltages(nl: NetlistResult, op: RawPlot): Record<string, number> {
  const out: Record<string, number> = {}
  for (const net of new Set(Object.values(nl.nets).flat())) {
    if (net === '0') { out[net] = 0; continue }
    const name = findVector(op, [voltageVector(net)!])
    if (name) out[net] = op.vars.find((v) => v.name === name)!.re[0]
  }
  return out
}

// Block / subcircuit instances of a netlist: instance path (lowercase, 'x1' or 'x1.x2') -> its subckt name (for a
// block, its sheet). The plot's vector list groups by these.
export function instances(netlist: string): Record<string, string> {
  const xs: Record<string, [string, string][]> = {}, scope = [''] // X lines per scope: '' = top level, else the subckt
  for (const { text } of logicalLines(netlist)) {
    const t = text.split(/\s+/)
    if (/^\.subckt$/i.test(t[0])) scope.push((t[1] ?? '').toLowerCase())
    else if (/^\.ends$/i.test(t[0])) scope.length > 1 && scope.pop()
    else if (/^x/i.test(t[0])) {
      const end = t.findIndex((w, i) => i > 0 && (/^params:$/i.test(w) || w.includes('='))), at = (end < 0 ? t.length : end) - 1
      if (at >= 1) (xs[scope[scope.length - 1]] ??= []).push([t[0].toLowerCase(), t[at]])
    }
  }
  const out: Record<string, string> = {}
  const walk = (s: string, pre: string, depth: number) => {
    for (const [ref, name] of xs[s] ?? []) {
      out[pre + ref] = name
      if (depth < 16) walk(name.toLowerCase(), `${pre}${ref}.`, depth + 1) // 16: a netlist that instances itself
    }
  }
  walk('', '', 0)
  return out
}
// the instance a vector belongs to ('' = the top level): v(x1.out) -> x1, i(@r.x1.x2.r1[i]) -> x1.x2, i(v.x1.v1) -> x1
export function instPath(name: string, insts: Record<string, string>): string {
  const segs = name.toLowerCase().replace(/^[a-z]+\(@?|(\[\w+\])?\)$/g, '').split('.')
  for (const from of [0, 1]) { // 1: past a device's type letter
    const p = segs.slice(from, -1).join('.')
    if (p && Object.hasOwn(insts, p)) return p
  }
  return ''
}

export interface Blame { parts: string[]; nets: string[] } // part ids, net names

// ngspice-47 diagnostics this is tested against (node/device names come out lowercased):
//   Warning: singular matrix:  check node out          | check nodes a and b   | check node v1#branch (V loop / L across V)
//   warning, can't find model 'foo' from line  ⏎  "    q1 b a 0 foo"
//   Error on line 4 or its substitute:  ⏎  "  c1 a 0 abc"
//   Fatal error: instance v1 is a shorted VSRC
//   Warning: Value of resistor r1 is too small, set to 1.000000e-12
//   doAnalyses: TRAN:  Timestep too small; initial timepoint: trouble with B-instance b1   (or: trouble with node "x")
const TRIGGER = /error|warning|singular|fatal|too small|no dc path/i
const IGNORE = /^\s*circuit:|unrecognized variable/i // title echo; savecurrents noise in .ac (see above)
const NODE = /\bnodes?\s+["']?([^\s"',;:()]+)["']?(?:\s+and\s+["']?([^\s"',;:()]+))?|\bv\(\s*([^\s,()]+)\s*(?:,\s*([^\s,()]+)\s*)?\)/gi

export function blame(log: string, nl: NetlistResult): { all: Blame; lines: { line: string; blame: Blame }[] } {
  const partOf = new Map(Object.entries(nl.refs).map(([id, ref]) => [ref.toLowerCase(), id]))
  const netOf = new Map<string, string>()
  for (const n of [...Object.values(nl.nets).flat(), ...Object.values(nl.wireNets)]) netOf.set(n.toLowerCase(), n)

  // nets only in explicit forms (node x, v(x), x#branch): bare words like "a" would hit English text
  const scan = (line: string, follow = false): Blame => {
    const parts = new Set<string>(), nets = new Set<string>()
    const word = (w: string) => {
      const base = w.toLowerCase().replace(/\.+$/, '')
      const [name, hash] = base.split('#')
      if (partOf.has(name)) parts.add(partOf.get(name)!)
      else if (hash !== undefined && netOf.has(name)) nets.add(netOf.get(name)!)
    }
    const words = line.split(/[\s'"`,;:()[\]{}=<>@]+/).filter(Boolean)
    // echoed netlist line ("q1 b a 0 foo"): only its element is to blame, not every node it touches
    if (follow && partOf.has(words[0]?.toLowerCase())) return { parts: [partOf.get(words[0].toLowerCase())!], nets: [] }
    words.forEach(word)
    for (const m of line.matchAll(NODE)) for (const n of m.slice(1)) {
      if (!n) continue
      const k = n.toLowerCase()
      if (netOf.has(k)) nets.add(netOf.get(k)!)
      else if (!k.includes('#')) word(k)
    }
    return { parts: [...parts], nets: [...nets] }
  }

  const src = log.split(/\r?\n/)
  const isTrigger = (l: string) => TRIGGER.test(l) && !IGNORE.test(l)
  const lines: { line: string; blame: Blame }[] = [], seen = new Set<string>()
  const all = { parts: new Set<string>(), nets: new Set<string>() }
  src.forEach((l, i) => {
    if (!isTrigger(l)) return
    const b = scan(l)
    let text = l.trim()
    const next = src[i + 1]
    // ngspice often puts the culprit on the following line
    if (next?.trim() && !isTrigger(next) && !IGNORE.test(next)) {
      const nb = scan(next, true)
      if (nb.parts.length || nb.nets.length) {
        b.parts = [...new Set([...b.parts, ...nb.parts])], b.nets = [...new Set([...b.nets, ...nb.nets])]
        text += ' ' + next.trim()
      }
    }
    if (!b.parts.length && !b.nets.length) return
    b.parts.forEach((p) => all.parts.add(p)), b.nets.forEach((n) => all.nets.add(n))
    if (!seen.has(text)) seen.add(text), lines.push({ line: text, blame: b })
  })
  return { all: { parts: [...all.parts], nets: [...all.nets] }, lines }
}
