// Qucs-S community parts pack (library-packs/qucs): converts the Qucs-S component library (GPL-2.0-or-later, github
// ra3xdh/qucs_s library/ at PIN) into plain SPICE .model / .subckt text, simulates every converted part in ngspice
// plain mode (-b -n, no compat flags), drops failures (BUILD.md) and writes per-category .lib files + pack.json.
// usage: node scripts/packs/qucs.ts <qucs_s checkout at PIN> [--jobs N] [--keep (testbench decks)]
// The checkout is untrusted data: files are only read as text, nothing in it is run. Deterministic for a given
// checkout + ngspice version (no clock, no randomness, sorted output).
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLibFile, type Category } from '../../src/renderer/src/library/library.ts'
import type { Kind } from '../../src/renderer/src/schematic/symbols.ts'

const PIN = '899808827218757b1241468d40d2b44d55d8957d', PIN_DATE = '2026-10-30', RETRIEVED = '2026-11-01'
const REPO = 'https://github.com/ra3xdh/qucs_s'
const OUT = resolve(fileURLToPath(import.meta.url), '../../../library-packs/qucs')
const NGSPICE = process.env.NGSPICE || 'ngspice'
const MAX_LIB = 900_000 // bytes per .lib file before it is split

// ---------------------------------------------------------------------------------------------- property tables
// Qucs library components store their properties positionally ("value" display pairs) in the order of Props.append()
// in the component's constructor. Tables below are that order at PIN; older library files carry a prefix of it
// (properties were only ever appended), except the diode, see DIODE_OLD.

// qucs/components/diode.cpp, Diode::Diode() @PIN (Ikf inserted at 11 and Temp moved to 17 on 2014-12-22)
const DIODE = ['Is', 'N', 'Cj0', 'M', 'Vj', 'Fc', 'Cp', 'Isr', 'Nr', 'Rs', 'Tt', 'Ikf', 'Kf', 'Af', 'Ffe', 'Bv', 'Ibv', 'Temp',
  'Xti', 'Eg', 'Tbv', 'Trs', 'Ttt1', 'Ttt2', 'Tm1', 'Tm2', 'Tnom', 'Area', 'Symbol']
// diode.cpp before 2014-12-22 (2005-06: first 17, 2006-08: 27, 2006-12: + Symbol). Component::load (component.cpp) treats
// a Diode with fewer than 28 values ("counts < 56" quotes) as this layout; its shifting code mishandles 17 values, so
// the layout is taken from the diode.cpp history instead.
const DIODE_OLD = ['Is', 'N', 'Cj0', 'M', 'Vj', 'Fc', 'Cp', 'Isr', 'Nr', 'Rs', 'Tt', 'Temp', 'Kf', 'Af', 'Ffe', 'Bv', 'Ibv',
  'Xti', 'Eg', 'Tbv', 'Trs', 'Ttt1', 'Ttt2', 'Tm1', 'Tm2', 'Tnom', 'Area', 'Symbol']
// qucs/components/bjtsub.cpp, Basic_BJT::Basic_BJT() @PIN (the '_BJT' library model is bjt.cpp, same properties)
const BJT = ['Type', 'Is', 'Nf', 'Nr', 'Ikf', 'Ikr', 'Vaf', 'Var', 'Ise', 'Ne', 'Isc', 'Nc', 'Bf', 'Br', 'Rbm', 'Irb', 'Rc', 'Re',
  'Rb', 'Cje', 'Vje', 'Mje', 'Cjc', 'Vjc', 'Mjc', 'Xcjc', 'Cjs', 'Vjs', 'Mjs', 'Fc', 'Tf', 'Xtf', 'Vtf', 'Itf', 'Tr', 'Temp', 'Kf',
  'Af', 'Ffe', 'Kb', 'Ab', 'Fb', 'Ptf', 'Xtb', 'Xti', 'Eg', 'Tnom', 'Area']
// qucs/components/jfet.cpp, JFET::JFET() @PIN
const JFET = ['Type', 'Vt0', 'Beta', 'Lambda', 'Rd', 'Rs', 'Is', 'N', 'Isr', 'Nr', 'Cgs', 'Cgd', 'Pb', 'Fc', 'M', 'Kf', 'Af', 'Ffe',
  'Temp', 'Xti', 'Vt0tc', 'Betatce', 'Tnom', 'Area']
// qucs/components/mosfet_sub.cpp, MOSFET_sub::MOSFET_sub() @PIN (the '_MOSFET' library model is mosfet.cpp, same)
const MOSFET = ['Type', 'Vt0', 'Kp', 'Gamma', 'Phi', 'Lambda', 'Rd', 'Rs', 'Rg', 'Is', 'N', 'W', 'L', 'Ld', 'Tox', 'Cgso', 'Cgdo',
  'Cgbo', 'Cbd', 'Cbs', 'Pb', 'Mj', 'Fc', 'Cjsw', 'Mjsw', 'Tt', 'Nsub', 'Nss', 'Tpg', 'Uo', 'Rsh', 'Nrd', 'Nrs', 'Cj', 'Js', 'Ad',
  'As', 'Pd', 'Ps', 'Kf', 'Af', 'Ffe', 'Temp', 'Tnom']

// Qucs name -> ngspice model parameter. Follows each component's spice_netlist() @PIN (drop lists, Tbv/Vt0tc -> Tcv,
// diode Ikf=0 dropped) with these changes, all checked against ngspice-47: Bv=0 is dropped (Qucs: no breakdown;
// ngspice: breakdown at 0 V), diode Isr/Nr and JFET N/M/Xti/Betatce are kept (ngspice supports them), Area/Temp/L/W/
// Ad/As/Pd/Ps become instance parameters, a MOSFET's Rg becomes a gate resistor and a diode's Cp a parallel capacitor.
const DROP: Record<string, string[]> = {
  D: ['Cp', 'Ffe', 'Temp', 'Area', 'Symbol', 'UseGlobTemp', 'LibName', 'CompName'],
  Q: ['Type', 'Area', 'Temp', 'Ffe', 'Kb', 'Ab', 'Fb', 'UseGlobTemp', 'LibName', 'CompName'],
  J: ['Type', 'Area', 'Temp', 'Ffe', 'Isr', 'Nr', 'UseGlobTemp', 'LibName', 'CompName'],
  M: ['Type', 'Temp', 'L', 'W', 'Ad', 'As', 'Pd', 'Ps', 'Rg', 'N', 'Tt', 'Nrd', 'Nrs', 'Ffe', 'UseGlobTemp', 'LibName', 'CompName']
}
const RENAME: Record<string, Record<string, string>> = { D: { Tbv: 'Tcv' }, J: { Vt0tc: 'Tcv' }, Q: {}, M: {} }
const INSTANCE: Record<string, string[]> = { D: ['Area'], Q: ['Area'], J: ['Area'], M: ['L', 'W', 'Ad', 'As', 'Pd', 'Ps'] }
const MOS_DEFAULT: Record<string, string> = { L: '1e-6', W: '1e-6' } // mosfet_sub.cpp defaults (ngspice's are 100u)

// Qucs value ("10 fF", "1.5 MOhm", "222p") -> plain SPICE number; null for expressions. Qucs 'M' is mega, SPICE's milli.
const SUF: Record<string, number> = { E: 18, P: 15, T: 12, G: 9, M: 6, k: 3, m: -3, u: -6, µ: -6, n: -9, p: -12, f: -15, a: -18 }
export function num(v: string): string | null {
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)([EPTGMkmuµnpfa]?)(Ohm|F|H|V|A|Hz|S|s|K|W|m)?$/.exec(v.replace(/\s+/g, ''))
  if (!m) return null
  const mant = m[1].replace(/^\+/, '')
  if (!m[2]) return mant
  return /e/i.test(mant) ? String(+(+mant * 10 ** SUF[m[2]]).toPrecision(12)) : `${mant}e${SUF[m[2]]}`
}
const zero = (v: string | undefined) => v != null && num(v) != null && +num(v)! === 0

// model parameters + instance parameters of one device from Qucs name/value pairs; throws on unconvertible values
function device(t: 'D' | 'Q' | 'J' | 'M', props: [string, string][]) {
  const model: string[] = [], inst: Record<string, string> = {}, extra: Record<string, string> = {}
  const get = (k: string) => props.find(([n]) => n.toLowerCase() === k.toLowerCase())?.[1]
  for (const [k, v] of props) {
    if (k === 'Type' || k === 'Symbol' || k === 'UseGlobTemp' || k === 'LibName' || k === 'CompName') continue
    const n = num(v)
    if (n == null) throw new Error(`${k}="${v}" is not a number`)
    if (INSTANCE[t].includes(k)) { if (+n !== 1 || t === 'M') inst[k] = n; continue }
    if (k === 'Temp') { if (+n !== 26.85) inst.Temp = n; continue }
    if ((t === 'D' && k === 'Cp') || (t === 'M' && k === 'Rg')) { if (+n !== 0) extra[k] = n; continue }
    if (DROP[t].includes(k)) continue
    if (t === 'D' && (k === 'Ikf' || k === 'Bv' || k === 'Ibv' || k === 'Isr' || k === 'Nr')) {
      if (k === 'Ikf' && +n === 0) continue
      if ((k === 'Bv' || k === 'Ibv') && zero(get('Bv'))) continue
      if ((k === 'Isr' || k === 'Nr') && (get('Isr') == null || zero(get('Isr')))) continue
    }
    if (t === 'M' && (k === 'Nsub' || k === 'Nss') && +n === 0) continue
    model.push(`${(RENAME[t][k] ?? k).toUpperCase()}=${n}`)
  }
  if (t === 'M') for (const [k, v] of Object.entries(MOS_DEFAULT)) inst[k] ??= v
  return { model, inst, extra }
}
const instStr = (i: Record<string, string>) => Object.entries(i).map(([k, v]) => ` ${k.toUpperCase()}=${v}`).join('')

// '.model NAME TYPE(...)' wrapped to ~100 columns
function modelLine(name: string, type: string, params: string[]) {
  const lines = [`.model ${name} ${type}(`]
  for (const p of params) {
    if (lines.at(-1)!.length + p.length > 100) lines.push('+')
    lines[lines.length - 1] += (/[(+]$/.test(lines.at(-1)!) ? '' : ' ') + p
  }
  lines[lines.length - 1] += ')'
  return lines.join('\n')
}

// ---------------------------------------------------------------------------------------------- library files

interface Comp { file: string; name: string; desc: string; body: string }
interface Part {
  name: string; kind: Kind; category: Category; text: string; pins: string[] // subckt pins in symbol order ([] = .model)
  test: Test; src: string; how: 'native' | 'def' | 'spice'
}
export type Test =
  | { t: 'diode' } | { t: 'led' } | { t: 'zener'; vz?: number } | { t: 'bjt'; darl?: boolean } | { t: 'jfet' } | { t: 'mos' }
  | { t: 'follower' } | { t: 'reg'; v: number } | { t: 'tl431' } | { t: 'lm334' } | { t: 'opto' } | { t: 'triac' } | { t: 'ssr' }
  | { t: '555' }

export const ROLES: Partial<Record<Kind, string[]>> = {
  diode: ['A', 'K'], zener: ['A', 'K'], led: ['A', 'K'], npn: ['C', 'B', 'E'], pnp: ['C', 'B', 'E'],
  njf: ['D', 'G', 'S'], pjf: ['D', 'G', 'S'], nmos: ['D', 'G', 'S'], pmos: ['D', 'G', 'S'], opamp5: ['in+', 'in-', 'v+', 'v-', 'out']
}

// in-scope library files, in build order (first definition of a name wins)
const NATIVE_FILES = ['Diodes', 'Diodes_Extended', 'DiodesSchottky', 'GeDiodes', 'Varactor', 'Z-Diodes', 'LEDs', 'Transistors',
  'BJT_Extended', 'JFETs', 'MOSFETs', 'NMOSFETs', 'PMOSFETs']
const SPICE_FILES = ['PIN_Diodes', 'Varactor_RF', 'OpAmp_140', 'OpAmp_544', 'SpiceOpamp', 'VoltageComparators', 'VoltageRegulators',
  'VoltageReferences', 'Regulators', 'Optocoupler', 'PhotovoltaicRelay', '555_timer', 'BJT_Darlington']
const SKIP_FILES: Record<string, string> = {
  VDMOS: 'copies the LTspice standard.mos VDMOS models (excluded by the pack contract)',
  VDMOS_IR: 'same origin and format as VDMOS.lib (LTspice standard.mos VDMOS parameter sets); excluded when in doubt',
  OpAmps: '.Def-only (qucsator) and listed in Qucs-S library/ngspice.blacklist'
}

// <Spice> components. roles: pin role of each top-level subckt pin after 'gnd' (they pass straight through to the
// part's own subckt, whose header/comments name them); written to the wrapper in symbol order (kind roles) or as listed.
type SpiceSpec = { kind: Kind; category: Category; test: Test; roles: string[] | 'portsym' }
const OPAMP: Omit<SpiceSpec, 'test'> & { test: Test } = { kind: 'opamp5', category: 'Op-amps', test: { t: 'follower' }, roles: ['in+', 'in-', 'v+', 'v-', 'out'] } // Boyle nodes 1..5
const SPICE_SPEC: Record<string, SpiceSpec> = {
  PIN_Diodes: { kind: 'diode', category: 'Diodes', test: { t: 'diode' }, roles: 'portsym' },
  Varactor_RF: { kind: 'diode', category: 'Diodes', test: { t: 'diode' }, roles: 'portsym' },
  OpAmp_140: OPAMP, OpAmp_544: OPAMP, 'SpiceOpamp#TL071': OPAMP, // TL071_SN: in+ in- +V -V out
  'VoltageRegulators#LM320_05': { kind: 'block', category: 'Regulators', test: { t: 'reg', v: -5 }, roles: ['in', 'gnd', 'out'] },
  'VoltageRegulators#LM340_05': { kind: 'block', category: 'Regulators', test: { t: 'reg', v: 5 }, roles: ['in', 'gnd', 'out'] },
  'VoltageRegulators#LM7805': { kind: 'block', category: 'Regulators', test: { t: 'reg', v: 5 }, roles: ['in', 'gnd', 'out'] },
  'VoltageReferences#TL431': { kind: 'block', category: 'References', test: { t: 'tl431' }, roles: ['cathode', 'anode', 'ref'] },
  'Regulators#TL431': { kind: 'block', category: 'References', test: { t: 'tl431' }, roles: ['cathode', 'anode', 'ref'] },
  'VoltageReferences#LM334': { kind: 'block', category: 'References', test: { t: 'lm334' }, roles: ['v+', 'v-', 'r'] },
  'Optocoupler#4N25': { kind: 'block', category: 'Optocouplers', test: { t: 'opto' }, roles: ['a', 'k', 'c', 'e'] }, // 4N25 1 2 5 4
  'Optocoupler#MOC3082': { kind: 'block', category: 'Optocouplers', test: { t: 'triac' }, roles: ['a', 'k', 'mt2', 'mt1'] },
  'Optocoupler#MOC3052': { kind: 'block', category: 'Optocouplers', test: { t: 'triac' }, roles: ['a', 'k', 'mt2', 'mt1'] },
  'Optocoupler#MOC3063': { kind: 'block', category: 'Optocouplers', test: { t: 'triac' }, roles: ['a', 'k', 'mt2', 'mt1'] },
  'PhotovoltaicRelay#CPC1018': { kind: 'block', category: 'Optocouplers', test: { t: 'ssr' }, roles: ['a', 'k', 'd1', 'd2'] },
  '555_timer#NE555_bipolar': { kind: 'block', category: 'Timers', test: { t: '555' }, roles: ['gnd', 'trig', 'out', 'reset', 'ctrl', 'thres', 'disch', 'vcc'] },
  '555_timer#555_XSPICE': { kind: 'block', category: 'Timers', test: { t: '555' }, roles: ['gnd', 'trig', 'out', 'reset', 'ctrl', 'thres', 'disch', 'vcc'] }
}

// provenance exclusions for <Spice> blocks (reviewed by hand at PIN); vendor text with a notice is caught by NOTICE
const NOTICE = /copyright|\(c\)|©|all rights reserved|licen[cs]e[ds]?\b|proprietary|confidential/i
const BOYLE = /^\s*egnd\s+99\s+0\s+poly\(2\)|^\s*fb\s+7\s+99\s+poly\(5\)|^\s*hlim\s+90\s+0\s+vlim/im
const SOVIET = ['OpAmp_140', 'OpAmp_544'] // Boyle-form models of Soviet parts written by the Qucs-S authors: kept
const STRIPPED = 'vendor macromodel with its notice stripped (provenance in doubt)'
const EXCLUDE: Record<string, string> = {
  'SpiceOpamp#LM311': `${STRIPPED}: classic National LM311 macromodel`,
  'SpiceOpamp#MAX495': `${STRIPPED}: Maxim macromodel`,
  'SpiceOpamp#ad822': `${STRIPPED}: Analog Devices macromodel`,
  'SpiceOpamp#OP491': `${STRIPPED}: Analog Devices macromodel`,
  'SpiceOpamp#LF356': `${STRIPPED}: National/TI macromodel ("Node assignments" header)`,
  'VoltageComparators#AD8561': `${STRIPPED}: Analog Devices macromodel`,
  'VoltageComparators#AD8611': `${STRIPPED}: Analog Devices macromodel`,
  'VoltageComparators#LM311': `${STRIPPED}: National macromodel ("CONNECTIONS:" header)`,
  'VoltageComparators#LM319': `${STRIPPED}: National macromodel ("CONNECTIONS:" header)`,
  'VoltageComparators#LM339': `${STRIPPED}: National macromodel ("CONNECTIONS:" header)`,
  'VoltageComparators#LMV339': `${STRIPPED}: National macromodel ("Connections" header)`,
  'VoltageComparators#LM311TI': `${STRIPPED}: TI transient model`,
  'VoltageComparators#TL3016': `${STRIPPED}: TI model`,
  'VoltageComparators#TLV3501': `${STRIPPED}: TI model`,
  'VoltageComparators#TLV3601': `${STRIPPED}: TI model`,
  'VoltageComparators#TLV3603': `${STRIPPED}: TI model`,
  'VoltageRegulators#LM7809': `${STRIPPED}: ON Semiconductor/Motorola regulator model header`,
  'VoltageRegulators#LM7909': `${STRIPPED}: ON Semiconductor/Motorola regulator model header`,
  'VoltageReferences#AD581': `${STRIPPED}: Analog Devices macromodel`,
  'VoltageReferences#REF191': `${STRIPPED}: Analog Devices macromodel`,
  'VoltageReferences#LM4041_1': `${STRIPPED}: National transistor-level model (OrCAD node names)`,
  'VoltageReferences#LM4041_ADJ': `${STRIPPED}: National transistor-level model (OrCAD node names)`,
  'Optocoupler#4N33': `${STRIPPED}: vendor-generated PSpice Darlington macro model`,
  'Optocoupler#MOC223': `${STRIPPED}: vendor-generated PSpice Darlington macro model`,
  'PhotovoltaicRelay#VOR14642': `${STRIPPED}: Vishay SSR model`,
  'BJT_Darlington#*': `${STRIPPED}: vendor-generated TIP14x PSpice macro models ("Model generated on ...")`
}

const ascii = (s: string) => s.replace(/[^\x20-\x7e\t]/g, '?')
const sname = (s: string) => s.replace(/[^\w.+-]/g, '_')
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)

function components(dir: string, file: string): Comp[] {
  const t = readFileSync(join(dir, file + '.lib'), 'utf8')
  return [...t.matchAll(/\n<Component ([^>\n]+)>\n([\s\S]*?)\n<\/Component>/g)].map((m) => ({
    file, name: m[1].trim(), body: m[2],
    desc: ascii(words(/<Description>([\s\S]*?)<\/Description>/.exec(m[2])?.[1] ?? '').join(' ')).slice(0, 200)
  }))
}
const section = (c: Comp, s: string) => new RegExp(`<${s}>([\\s\\S]*?)</${s}>`).exec(c.body)?.[1]
const header = (c: Comp, name: string) => [`* ${name}: ${c.desc || '(no description)'}`, `* from Qucs-S library/${c.file}.lib <Component ${ascii(c.name)}>`]

// native <Diode>/<_BJT>/<JFET>/<_MOSFET> -> .model, or a 3-pin/2-pin subckt when instance parameters are needed
function native(c: Comp, name: string): Omit<Part, 'test' | 'src' | 'category'> & { cat: Category; test: Test } {
  const line = /^\s*<(Diode|_BJT|JFET|_MOSFET)\s[^\n]*>\s*$/m.exec(section(c, 'Model') ?? '')
  if (!line) throw new Error('unsupported <Model> component ' + ((/<(\S+)/.exec(section(c, 'Model') ?? '') ?? [])[1] ?? '?'))
  const vals = [...line[0].matchAll(/"([^"]*)"/g)].map((m) => m[1])
  const type = line[1], h = header(c, name)
  if (type === 'Diode') {
    const names = vals.length < 28 ? DIODE_OLD : DIODE
    if (vals.length < 28 && vals.length > 11 && +num(vals[11])! !== 26.85) throw new Error(`old diode layout but Temp="${vals[11]}"`)
    const { model, inst, extra } = device('D', vals.map((v, i) => [names[i], v]))
    const led = c.file === 'LEDs' || /\bLED\b|light.emitting/i.test(c.desc), zen = /zener|z-diode/i.test(c.desc)
    const kind: Kind = led ? 'led' : zen ? 'zener' : 'diode'
    const test: Test = led ? { t: 'led' } : zen ? { t: 'zener', vz: vz(c) } : { t: 'diode' }
    if (!Object.keys(inst).length && !extra.Cp) return { name, kind, cat: 'Diodes', test, how: 'native', pins: [], text: [...h, modelLine(name, 'D', model)].join('\n') }
    const body = [`D1 A K DMOD${instStr(inst)}`, ...(extra.Cp ? [`CP A K ${extra.Cp}`] : []), modelLine('DMOD', 'D', model)]
    return { name, kind, cat: 'Diodes', test, how: 'native', pins: ['A', 'K'], text: [...h, `.subckt ${name} A K`, ...body, `.ends ${name}`].join('\n') }
  }
  const t = type === '_BJT' ? 'Q' : type === 'JFET' ? 'J' : 'M'
  const props = vals.map((v, i): [string, string] => [(t === 'Q' ? BJT : t === 'J' ? JFET : MOSFET)[i] ?? `extra${i}`, v])
  if (props.some(([k]) => k.startsWith('extra'))) throw new Error(`${vals.length} values, more than ${type} has properties`)
  const pol = vals[0].toLowerCase()
  if (!['npn', 'pnp', 'nfet', 'pfet'].includes(pol)) throw new Error(`Type="${vals[0]}"`)
  const { model, inst, extra } = device(t, props)
  if (t === 'Q') {
    const kind: Kind = pol === 'npn' ? 'npn' : 'pnp', mt = pol.toUpperCase()
    if (!Object.keys(inst).length) return { name, kind, cat: 'BJTs', test: { t: 'bjt' }, how: 'native', pins: [], text: [...h, modelLine(name, mt, model)].join('\n') }
    return { name, kind, cat: 'BJTs', test: { t: 'bjt' }, how: 'native', pins: ['C', 'B', 'E'], text: [...h, `.subckt ${name} C B E`, `Q1 C B E QMOD${instStr(inst)}`, modelLine('QMOD', mt, model), `.ends ${name}`].join('\n') }
  }
  if (t === 'J') {
    const kind: Kind = pol === 'nfet' ? 'njf' : 'pjf', mt = pol === 'nfet' ? 'NJF' : 'PJF'
    if (!Object.keys(inst).length) return { name, kind, cat: 'JFETs', test: { t: 'jfet' }, how: 'native', pins: [], text: [...h, modelLine(name, mt, model)].join('\n') }
    return { name, kind, cat: 'JFETs', test: { t: 'jfet' }, how: 'native', pins: ['D', 'G', 'S'], text: [...h, `.subckt ${name} D G S`, `J1 D G S JMOD${instStr(inst)}`, modelLine('JMOD', mt, model), `.ends ${name}`].join('\n') }
  }
  // MOSFETs always need L/W (and the bulk tied to the source, as the 3-pin Qucs symbol does)
  const kind: Kind = pol === 'nfet' ? 'nmos' : 'pmos', g = extra.Rg ? 'GI' : 'G'
  return {
    name, kind, cat: 'MOSFETs', test: { t: 'mos' }, how: 'native', pins: ['D', 'G', 'S'],
    text: [...h, `.subckt ${name} D G S`, ...(extra.Rg ? [`RG G GI ${extra.Rg}`] : []), `M1 D ${g} S S MMOD${instStr(inst)}`,
      modelLine('MMOD', pol === 'nfet' ? 'NMOS' : 'PMOS', model), `.ends ${name}`].join('\n')
  }
}

// Zener voltage from the description ("10.0V, 0.500W") or the part number ("BZX55C5V1"); undefined if neither says
function vz(c: Comp): number | undefined {
  const d = /(\d+(?:\.\d+)?)\s*V\b/.exec(c.desc)
  if (d) return +d[1]
  const n = /(\d+)V(\d*)$/i.exec(c.name)
  return n ? +`${n[1]}.${n[2] || 0}` : undefined
}

// qucsator '.Def:' subcircuit -> SPICE subckt (element by element, as qucs2spice::convert_netlist @PIN does, with the
// device tables above). Pins are renamed to symbol roles. Throws on any element/feature it cannot map exactly.
function mosKind(l: string): Kind { return /^\s*MOSFET:\S+ [^\n]*Type="pfet"/m.exec(l)?.index === /^\s*MOSFET:/m.exec(l)?.index ? 'pmos' : 'nmos' }
const DEF_PINS: Record<string, { kind: (lines: string) => Kind; roles: string[]; test: (c: Comp) => Test; cat: Category }> = {
  // Z-Diodes.lib DefaultSymbol: port 1 left = cathode (arrow points left), port 2 = anode
  'Z-Diodes': { kind: () => 'zener', roles: ['K', 'A'], test: (c) => ({ t: 'zener', vz: vz(c) }), cat: 'Diodes' },
  // LEDs.lib: pins are named _netC _netA
  LEDs: { kind: () => 'led', roles: ['K', 'A'], test: () => ({ t: 'led' }), cat: 'Diodes' },
  // N/PMOSFETs.lib, MOSFETs.lib DefaultSymbol: port 1 left = gate, 2 top = drain, 3 bottom = source
  // (polarity: the first MOSFET element, the main device; helpers further down may be of either type)
  NMOSFETs: { kind: mosKind, roles: ['G', 'D', 'S'], test: () => ({ t: 'mos' }), cat: 'MOSFETs' },
  PMOSFETs: { kind: mosKind, roles: ['G', 'D', 'S'], test: () => ({ t: 'mos' }), cat: 'MOSFETs' },
  MOSFETs: { kind: mosKind, roles: ['G', 'D', 'S'], test: () => ({ t: 'mos' }), cat: 'MOSFETs' },
  // Transistors.lib BD675..BD682 Darlingtons: BJT:Q1 base/collector on _net2/_net1, so pins are C B E
  Transistors: { kind: (l) => (/Type="pnp"/.test(l) ? 'pnp' : 'npn'), roles: ['C', 'B', 'E'], test: () => ({ t: 'bjt', darl: true }), cat: 'BJTs' }
}

function def(c: Comp, name: string) {
  const spec = DEF_PINS[c.file]
  if (!spec) throw new Error('.Def subcircuit in a file without a pin table')
  const src = (section(c, 'Model') ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const out: string[] = [], stack: string[] = []
  let top: { pins: string[]; map: Map<string, string> } | null = null
  const node = (n: string) => (n === 'gnd' ? '0' : (stack.length === 1 && top?.map.get(n)) || n)
  const kv = (rest: string) => [...rest.matchAll(/(\w+)="([^"]*)"/g)].map((m): [string, string] => [m[1], m[2]])
  const one = (rest: string, k: string) => { const v = kv(rest).find(([n]) => n === k)?.[1]; if (v == null) throw new Error(`missing ${k}`); const n = num(v); if (n == null) throw new Error(`${k}="${v}"`); return n }
  const nodes = (rest: string, n: number) => { const t = words(rest.replace(/\w+="[^"]*"/g, '')); if (t.length !== n) throw new Error(`expected ${n} nodes in "${rest}"`); return t.map(node) }
  for (const l of src) {
    const m = /^(\.Def|[A-Za-z]+):(\S+)\s*(.*)$/.exec(l)
    if (!m) throw new Error(`unparsable line "${l}"`)
    const [, typ, id, rest] = m
    if (typ === '.Def') {
      if (id === 'End') { out.push(stack.length === 1 ? `.ends ${name}` : '.ends'); stack.pop(); continue }
      const p = words(rest)
      if (!stack.length) {
        if (p.length !== spec.roles.length) throw new Error(`${p.length} pins, ${c.file} parts have ${spec.roles.length}`)
        top = { pins: p, map: new Map(p.map((x, i) => [x, spec.roles[i]])) }
        const internal = new Set(src.join(' ').match(/_\w+/g))
        if (spec.roles.some((r) => internal.has(r))) throw new Error('role name clashes with an internal node')
        out.push(`.subckt ${name} ${ROLES[spec.kind(src.join('\n'))]!.join(' ')}`)
      } else out.push(`.subckt ${id} ${p.map(node).join(' ')}`)
      stack.push(id)
      continue
    }
    if (!stack.length) throw new Error(`element outside .Def: ${l}`)
    const ref = (p: string) => p + id
    const props = kv(rest)
    switch (typ) {
      case 'R': case 'C': case 'L': {
        const [a, b] = nodes(rest, 2), v = one(rest, typ)
        let x = ''
        if (typ === 'R') for (const k of ['Tc1', 'Tc2']) { const t = props.find(([n]) => n === k); if (t && !zero(t[1])) x += ` ${k.toLowerCase()}=${num(t[1])}` }
        const known = typ === 'R' ? ['R', 'Temp', 'Tc1', 'Tc2', 'Tnom'] : typ === 'C' ? ['C', 'V'] : ['L', 'I']
        const bad = props.filter(([k, v]) => !known.includes(k) || (k === 'V' || k === 'I' ? v.trim() !== '' && !zero(v) : false))
        if (bad.length) throw new Error(`${typ}:${id} ${bad.map(([k]) => k).join(',')} not mapped`)
        out.push(`${ref(typ)} ${a} ${b} ${v}${x}`)
        break
      }
      case 'Vdc': case 'Idc': {
        const [a, b] = nodes(rest, 2)
        out.push(`${ref(typ[0])} ${a} ${b} DC ${one(rest, typ === 'Vdc' ? 'U' : 'I')}`)
        break
      }
      case 'VCVS': case 'VCCS': case 'CCCS': case 'CCVS': {
        const [n0, n1, n2, n3] = nodes(rest, 4), g = one(rest, 'G')
        if (props.some(([k, v]) => k === 'T' && !zero(v))) throw new Error(`${typ}:${id} has a delay T`)
        if (typ[0] === 'V') out.push(`${ref(typ === 'VCVS' ? 'E' : 'G')} ${n1} ${n2} ${n0} ${n3} ${g}`)
        else out.push(`${ref(typ === 'CCCS' ? 'F' : 'H')} ${n1} ${n2} V${id}_ctl ${g}`, `V${id}_ctl ${n0} ${n3} DC 0`)
        break
      }
      case 'Diode': {
        const [k, a] = nodes(rest, 2), d = device('D', props)
        out.push(`${ref('D')} ${a} ${k} DMOD_${id}${instStr(d.inst)}`, ...(d.extra.Cp ? [`${ref('CP')} ${a} ${k} ${d.extra.Cp}`] : []), modelLine(`DMOD_${id}`, 'D', d.model))
        break
      }
      case 'BJT': {
        const [b, cc, e, s] = nodes(rest, 4), d = device('Q', props), pol = props.find(([k]) => k === 'Type')?.[1]
        if (pol !== 'npn' && pol !== 'pnp') throw new Error(`BJT Type="${pol}"`)
        out.push(`${ref('Q')} ${cc} ${b} ${e} ${s} QMOD_${id}${instStr(d.inst)}`, modelLine(`QMOD_${id}`, pol.toUpperCase(), d.model))
        break
      }
      case 'JFET': {
        const [g, dd, s] = nodes(rest, 3), d = device('J', props), pol = props.find(([k]) => k === 'Type')?.[1]
        if (pol !== 'nfet' && pol !== 'pfet') throw new Error(`JFET Type="${pol}"`)
        out.push(`${ref('J')} ${dd} ${g} ${s} JMOD_${id}${instStr(d.inst)}`, modelLine(`JMOD_${id}`, pol === 'nfet' ? 'NJF' : 'PJF', d.model))
        break
      }
      case 'MOSFET': {
        const [g, dd, s, b] = nodes(rest, 4), d = device('M', props), pol = props.find(([k]) => k === 'Type')?.[1]
        if (pol !== 'nfet' && pol !== 'pfet') throw new Error(`MOSFET Type="${pol}"`)
        const gi = d.extra.Rg ? `${g}_rg${id}` : g
        if (d.extra.Rg) out.push(`${ref('RG')} ${g} ${gi} ${d.extra.Rg}`)
        out.push(`${ref('M')} ${dd} ${gi} ${s} ${b} MMOD_${id}${instStr(d.inst)}`, modelLine(`MMOD_${id}`, pol === 'nfet' ? 'NMOS' : 'PMOS', d.model))
        break
      }
      case 'Sub': {
        const type = props.find(([k]) => k === 'Type')?.[1]
        if (!type || props.length > 1) throw new Error(`Sub:${id} parameters not mapped`)
        out.push(`X${id} ${words(rest.replace(/\w+="[^"]*"/g, '')).map(node).join(' ')} ${type}`)
        break
      }
      default:
        throw new Error(`qucsator element ${typ} has no exact SPICE mapping`)
    }
  }
  if (stack.length || !top) throw new Error('unbalanced .Def')
  const kind = spec.kind(src.join('\n'))
  return { name, kind, cat: spec.cat, test: spec.test(c), how: 'def' as const, pins: ROLES[kind]!, text: [...header(c, name), ...out].join('\n') }
}

// <Spice> section (+ <SpiceAttach> files) -> wrapper subckt: X line ties the Qucs 'gnd' pin to 0, the original text is
// nested inside (keeps helper subckt/model names local). Throws for blocks it must not or cannot take.
function spiceText(dir: string, c: Comp) {
  const sp = section(c, 'Spice')
  if (sp == null) throw new Error('no <Spice> section')
  const att = [...c.body.matchAll(/<SpiceAttach\s*([^>]*)>/g)].flatMap((a) => [...a[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]))
  const parts = att.map((a) => {
    const p = join(dir, c.file, a)
    if (!/^[\w.-]+$/.test(a) || !existsSync(p)) throw new Error(`attachment ${a} missing`)
    const b = readFileSync(p), u = b.toString('utf8')
    return u.includes('�') ? b.toString('latin1') : u
  })
  return { sp, all: [...parts, sp].join('\n') }
}
// why a <Spice> block must not ship, or undefined
function provenance(dir: string, c: Comp) {
  const ex = EXCLUDE[`${c.file}#${c.name}`] ?? EXCLUDE[`${c.file}#*`]
  if (ex) return ex
  const { all } = spiceText(dir, c)
  if (NOTICE.test(all)) return 'carries a vendor copyright/licence notice'
  if (BOYLE.test(all) && !SOVIET.includes(c.file)) return 'classic TI/National Boyle macromodel with its notice stripped (provenance in doubt)'
}

function spice(dir: string, c: Comp, name: string, spec: SpiceSpec) {
  const { sp, all } = spiceText(dir, c)
  const bad = /^\s*\.(control|endc|include|inc|lib|ic|nodeset|spiceinit|options?|global|tran|op|ac|dc|meas|save|print|probe)\b/im.exec(all)
  if (bad) throw new Error(`contains ${bad[0].trim()}`)
  const lines = all.split(/\r\n?|\n/).filter((l) => !/^\s*\.end\s*$/i.test(l)).map((l) => {
    if (!/[^\x20-\x7e\t]/.test(l)) return l.replace(/\s+$/, '')
    if (/^\s*\*/.test(l)) return ascii(l).replace(/\s+$/, '')
    throw new Error('non-ASCII text outside comments')
  })
  const tops = [...sp.matchAll(/^\s*\.subckt\s+(\S+)\s+([^\n]*)$/gim)]
  const top = tops.at(-1)
  if (!top) throw new Error('no top-level .SUBCKT')
  const tp = words(top[2]).filter((p) => !/=|^params:/i.test(p))
  if (tp[0]?.toLowerCase() !== 'gnd') throw new Error(`top subckt's first pin is ${tp[0]}, not gnd`)
  let roles = spec.roles
  if (roles === 'portsym') {
    const ps = [...c.body.matchAll(/<\.PortSym\s+-?\d+\s+-?\d+\s+(\d+)\s+-?\d+\s+(\w+)\s*>/g)].map((m) => [+m[1], m[2].toUpperCase()] as const).sort((a, b) => a[0] - b[0])
    roles = ps.map(([, n]) => (n === 'ANODE' ? 'A' : n === 'CATHODE' ? 'K' : '?'))
    if (roles.includes('?') || ps.length !== 2) throw new Error(`port names ${ps.map(([, n]) => n).join(',') || 'missing'}`)
  }
  if (tp.length - 1 !== roles.length) throw new Error(`${tp.length - 1} pins, expected ${roles.length}`)
  // a nested subckt with the part's own name is renamed NAME_inner (definition, .ends and X-line references)
  const nested = new Set([...all.matchAll(/^\s*\.subckt\s+(\S+)/gim)].map((m) => m[1].toLowerCase())), nm = name.toLowerCase()
  if (nested.has(nm + '_inner')) throw new Error(`nested subckt ${name}_inner already exists`)
  const inner = (l: string) => {
    if (!nested.has(nm)) return l
    if (/^\s*\.(subckt|ends)\s/i.test(l)) return l.replace(/^(\s*\.(?:subckt|ends)\s+)(\S+)/i, (m, a, b) => (b.toLowerCase() === nm ? a + name + '_inner' : m))
    if (!/^\s*x/i.test(l)) return l
    const t = l.split(/(\s+)/), stop = t.findIndex((w) => /=|^params:$/i.test(w))
    let k = (stop < 0 ? t.length : stop) - 1
    while (k > 0 && !t[k].trim()) k--
    if (t[k]?.toLowerCase() === nm) t[k] = name + '_inner'
    return t.join('')
  }
  const order = ROLES[spec.kind] ?? roles
  return {
    name, kind: spec.kind, cat: spec.category, test: spec.test, how: 'spice' as const, pins: order,
    text: [...header(c, name), `* <Spice> section as shipped by Qucs-S, nested; its ground pin is tied to node 0`,
      `.subckt ${name} ${order.join(' ')}`, `X${name}_q 0 ${roles.join(' ')} ${top[1]}`, ...lines.filter((l, i, a) => l || a[i - 1]).map(inner), `.ends ${name}`].join('\n')
  }
}

// ---------------------------------------------------------------------------------------------- validation

const fmt = (x: number) => (Math.abs(x) >= 1e-3 || x === 0 ? x.toFixed(3) : x.toExponential(2))
// instance line: model parts placed like the app's netlister does (MOSFET bulk = source), subckts by their pin list
type Bench = Pick<Part, 'name' | 'kind' | 'pins' | 'test'>
export type Inst = (ref: string, at: Record<string, string>) => string
function inst(p: Bench, ref: string, at: Record<string, string>) {
  const roles = p.pins.length ? p.pins : ROLES[p.kind]!
  const n = roles.map((r) => { const x = at[r]; if (x == null) throw new Error(`testbench has no node for ${r}`); return x })
  if (p.pins.length) return `X${ref} ${n.join(' ')} ${p.name}`
  const pre = { diode: 'D', zener: 'D', led: 'D', npn: 'Q', pnp: 'Q', njf: 'J', pjf: 'J', nmos: 'M', pmos: 'M' }[p.kind as string]
  return `${pre}${ref} ${n.join(' ')}${pre === 'M' ? ' ' + n[2] : ''} ${p.name}`
}

// testbench + check for each test type; values printed by the control block as "name = value"
// circuit lines (instances via inst: the app's netlister in test/pack-qucs.test.ts), control lines, and the check
export function bench(p: Bench, place: Inst = (ref, at) => inst(p, ref, at)) {
  const T = p.test, L: string[] = [], c: string[] = [], inst_ = (_: Bench, ref: string, at: Record<string, string>) => place(ref, at)
  const op = (...pr: string[]) => c.push('op', ...pr.map((x) => `print ${x}`))
  let check: (v: Record<string, number>) => string | null
  switch (T.t) {
    case 'diode': case 'led': case 'zener': {
      const led = T.t === 'led'
      L.push(`VF vf 0 ${led ? 10 : 5}`, `RF vf a1 ${led ? '1k' : '4.3k'}`, inst_(p, '1', { A: 'a1', K: '0' }), 'VR vr 0 -1', 'RR vr a2 1k', inst_(p, '2', { A: 'a2', K: '0' }))
      const vs = T.t === 'zener' ? (T.vz ? Math.max(2 * T.vz, T.vz + 10) : 200) : 0
      if (T.t === 'zener') L.push(`VZ vz 0 ${vs}`, `RZ vz k3 ${(T.vz ? (vs - T.vz) / 5e-3 : 40e3).toPrecision(4)}`, inst_(p, '3', { A: '0', K: 'k3' }))
      op('v(a1)', 'v(a2)', ...(T.t === 'zener' ? ['v(k3)'] : []))
      check = (v) => {
        const [lo, hi] = led ? [1.0, 4.5] : [0.1, 1.5]
        if (!(v['v(a1)'] > lo && v['v(a1)'] < hi)) return `forward drop ${fmt(v['v(a1)'])} V at ${led ? 10 : 1} mA, expected ${lo}..${hi} V`
        if (!(v['v(a2)'] < -0.9)) return `reverse leakage at -1 V: ${fmt((-1 - v['v(a2)']) / -1e3)} A`
        if (T.t === 'zener') {
          const z = v['v(k3)']
          if (T.vz && Math.abs(z - T.vz) > 0.25 * T.vz) return `zener voltage ${fmt(z)} V at 5 mA, rated ${T.vz} V`
          if (!T.vz && !(z > 1.5 && z < 0.97 * vs)) return `no reverse breakdown below ${vs} V (${fmt(z)} V)`
        }
        return null
      }
      break
    }
    case 'bjt': {
      // 10 uA into 100 ohm (small-signal) and 1 mA into 1 ohm (power, Darlington with a B-E resistor): either must pass
      const n = p.kind === 'npn', s = n ? 1 : -1, ib = [10e-6, 1e-3], rc = [100, 1]
      L.push(`VCC vcc 0 ${5 * s}`)
      for (const i of [0, 1]) L.push(`RC${i} vcc c${i} ${rc[i]}`, n ? `IB${i} 0 b${i} DC ${ib[i]}` : `IB${i} b${i} 0 DC ${ib[i]}`, inst_(p, String(i), { C: `c${i}`, B: `b${i}`, E: '0' }))
      op('v(b0)', 'v(c0)', 'v(b1)', 'v(c1)')
      check = (v) => {
        const [lo, hi] = T.darl ? [0.6, 2.5] : [0.05, 1.2], why: string[] = []
        for (const i of [0, 1]) {
          const vbe = s * v[`v(b${i})`], ic = s * (5 * s - v[`v(c${i})`]) / rc[i]
          if (!(vbe > lo && vbe < hi)) why.push(`|Vbe| ${fmt(vbe)} V at Ib = ${fmt(ib[i])} A (expected ${lo}..${hi} V)`)
          else if (!(ic > 3 * ib[i])) why.push(`beta ${fmt(ic / ib[i])} at Ib = ${fmt(ib[i])} A`)
          else return null
        }
        return why.join('; ')
      }
      break
    }
    case 'jfet': case 'mos': {
      const n = p.kind === 'njf' || p.kind === 'nmos', s = n ? 1 : -1, j = T.t === 'jfet'
      // MOSFETs: off at Vgs = 0 (enhancement) or -10 V (depletion); JFETs: pinched off at -15 V
      const gon = j ? 0 : 10 * s, goff = j ? [-15 * s] : [0, -10 * s], rd = j ? 100 : 10
      L.push(`VDD vdd 0 ${5 * s}`, `RD1 vdd d1 ${rd}`, `VG1 g1 0 ${gon}`, inst_(p, '1', { D: 'd1', G: 'g1', S: '0' }))
      goff.forEach((g, i) => L.push(`RD${i + 2} vdd d${i + 2} ${rd}`, `VG${i + 2} g${i + 2} 0 ${g}`, inst_(p, String(i + 2), { D: `d${i + 2}`, G: `g${i + 2}`, S: '0' })))
      op('v(d1)', ...goff.map((_, i) => `v(d${i + 2})`))
      check = (v) => {
        const on = s * (5 * s - v['v(d1)']) / rd, off = Math.min(...goff.map((_, i) => s * (5 * s - v[`v(d${i + 2})`]) / rd))
        const lo = j ? 10e-6 : 1e-3
        if (!(on > lo)) return `drain current ${fmt(on)} A at Vgs = ${gon} V, expected > ${fmt(lo)} A`
        if (!(off < 0.05 * on)) return `drain current ${fmt(off)} A at Vgs = ${goff.join(' / ')} V does not turn off (on: ${fmt(on)} A)`
        return null
      }
      break
    }
    case 'follower': {
      L.push('VP vp 0 15', 'VN vn 0 -15', 'VI1 i1 0 1', inst_(p, '1', { 'in+': 'i1', 'in-': 'o1', 'v+': 'vp', 'v-': 'vn', out: 'o1' }), 'RL1 o1 0 10k',
        'VI2 i2 0 -2', inst_(p, '2', { 'in+': 'i2', 'in-': 'o2', 'v+': 'vp', 'v-': 'vn', out: 'o2' }), 'RL2 o2 0 10k')
      op('v(o1)', 'v(o2)')
      check = (v) => (Math.abs(v['v(o1)'] - 1) < 0.02 && Math.abs(v['v(o2)'] + 2) < 0.02 ? null : `follower at +-15 V: out ${fmt(v['v(o1)'])} V for 1 V in, ${fmt(v['v(o2)'])} V for -2 V in`)
      break
    }
    case 'reg': {
      const vin = T.v > 0 ? T.v + 7 : T.v - 7
      L.push(`VIN in 0 ${vin}`, inst_(p, '1', { in: 'in', gnd: '0', out: 'out' }), `RL out 0 ${Math.abs(T.v) / 0.05}`)
      op('v(out)')
      check = (v) => (Math.abs(v['v(out)'] - T.v) < 0.05 * Math.abs(T.v) ? null : `output ${fmt(v['v(out)'])} V at 50 mA load, rated ${T.v} V`)
      break
    }
    case 'tl431':
      L.push('VS vs 0 12', 'R1 vs k 1k', inst_(p, '1', { cathode: 'k', anode: '0', ref: 'k' }))
      op('v(k)')
      check = (v) => (v['v(k)'] > 2.42 && v['v(k)'] < 2.57 ? null : `shunt voltage ${fmt(v['v(k)'])} V with ref tied to cathode, expected 2.495 V`)
      break
    case 'lm334':
      L.push('VS vs 0 5', inst_(p, '1', { 'v+': 'vs', 'v-': '0', r: 'r' }), 'RSET r 0 68')
      op('i(vs)')
      check = (v) => (-v['i(vs)'] > 0.8e-3 && -v['i(vs)'] < 1.25e-3 ? null : `current ${fmt(-v['i(vs)'])} A with Rset = 68 ohm, expected ~1 mA`)
      break
    case 'opto':
      L.push('VF vf 0 5', 'RF vf a1 390', inst_(p, '1', { a: 'a1', k: '0', c: 'c1', e: '0' }), 'VCC vcc 0 5', 'RC1 vcc c1 1k',
        'RF2 0 a2 390', inst_(p, '2', { a: 'a2', k: '0', c: 'c2', e: '0' }), 'RC2 vcc c2 1k')
      op('v(c1)', 'v(c2)')
      check = (v) => {
        const on = (5 - v['v(c1)']) / 1e3, off = (5 - v['v(c2)']) / 1e3
        return on > 0.5e-3 && off < 10e-6 ? null : `collector current ${fmt(on)} A with 10 mA LED, ${fmt(off)} A dark`
      }
      break
    case 'triac': case 'ssr': {
      const ssr = T.t === 'ssr', tend = ssr ? 20e-3 : 5e-3
      L.push(`VF vf 0 PULSE(0 5 1m 1u 1u 1)`, `RF vf a1 ${ssr ? '820' : '270'}`, inst_(p, '1', { a: 'a1', k: '0', mt2: 'm1', mt1: '0', d1: 'm1', d2: '0' }),
        'VL vl 0 5', 'RL1 vl m1 1k', 'RF2 0 a2 1k', inst_(p, '2', { a: 'a2', k: '0', mt2: 'm2', mt1: '0', d1: 'm2', d2: '0' }), 'RL2 vl m2 1k')
      c.push(`tran 10u ${tend}`, `meas tran von FIND v(m1) AT=${tend * 0.95}`, `meas tran voff FIND v(m2) AT=${tend * 0.95}`, 'print von', 'print voff')
      check = (v) => {
        const on = (5 - v.von) / 1e3, off = (5 - v.voff) / 1e3
        return on > (ssr ? 3e-3 : 1e-3) && off < 10e-6 ? null : `load current ${fmt(on)} A with the LED on, ${fmt(off)} A dark`
      }
      break
    }
    case '555':
      L.push('VCC vcc 0 5', 'RA vcc dis 1k', 'RB dis thr 10k', 'CT thr 0 10n', inst_(p, '1', { gnd: '0', trig: 'thr', out: 'out', reset: 'vcc', ctrl: 'ctl', thres: 'thr', disch: 'dis', vcc: 'vcc' }),
        'CC ctl 0 10n', 'RL out 0 10k')
      c.push('tran 0.5u 3m', 'meas tran t1 WHEN v(out)=2.5 RISE=3', 'meas tran t2 WHEN v(out)=2.5 RISE=6', 'meas tran vhi MAX v(out) FROM=1m TO=3m',
        'meas tran vlo MIN v(out) FROM=1m TO=3m', 'print t1', 'print t2', 'print vhi', 'print vlo')
      check = (v) => {
        const per = (v.t2 - v.t1) / 3, want = 0.693 * 21e3 * 10e-9
        if (!(Math.abs(per - want) < 0.3 * want)) return `astable period ${fmt(per)} s, expected ~${fmt(want)} s (Ra 1k, Rb 10k, 10 nF)`
        return v.vhi - v.vlo > 3 ? null : `output swing ${fmt(v.vlo)}..${fmt(v.vhi)} V`
      }
      break
  }
  return { circuit: L, control: ['.control', ...c, '.endc'], check: check! }
}

const BAD_OUT = /unrecognized parameter|error|singular matrix|timestep too small|no convergence|cannot find|unknown subckt|could not find|not found/i
function run(dir: string, i: number, p: Part): Promise<string | null> {
  return new Promise((done) => {
    let b: ReturnType<typeof bench>
    try { b = bench(p) } catch (e) { return done(`testbench: ${(e as Error).message}`) }
    const deck = [`* ${p.name}`, ...b.circuit, ...b.control, p.text, '.end', ''].join('\n')
    const f = join(dir, `t${i}.cir`)
    writeFileSync(f, deck)
    const ch = spawn(NGSPICE, ['-b', '-n', f], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    ch.stdout.on('data', (d) => (out += d)), ch.stderr.on('data', (d) => (out += d))
    const kill = setTimeout(() => ch.kill('SIGKILL'), 60_000)
    ch.on('close', (code) => {
      clearTimeout(kill)
      const bad = out.split('\n').find((l) => BAD_OUT.test(l) && !/^\s*\*/.test(l))
      if (bad) return done(`ngspice: ${bad.trim().slice(0, 160)}`)
      if (code !== 0) return done(`ngspice exit ${code}`)
      const v: Record<string, number> = {}
      for (const m of out.matchAll(/^(\S+)\s+=\s+(\S+)/gm)) v[m[1].toLowerCase()] = +m[2]
      try { done(b.check(v)) } catch (e) { done(`check: ${(e as Error).message}`) }
    })
    ch.on('error', (e) => (clearTimeout(kill), done(`ngspice: ${e.message}`)))
  })
}

async function validate(parts: Part[], jobs: number) {
  const dir = mkdtempSync(join(tmpdir(), 'qucs-pack-')), res: (string | null)[] = []
  let next = 0, n = 0
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < parts.length) {
      const i = next++
      res[i] = await run(dir, i, parts[i])
      if (++n % 250 === 0) process.stderr.write(`  ${n}/${parts.length}\n`)
    }
  }))
  if (process.argv.includes('--keep')) process.stderr.write(`decks kept in ${dir}\n`)
  else rmSync(dir, { recursive: true, force: true })
  return res
}

// ---------------------------------------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2), src = args.find((a) => !a.startsWith('--'))
  const jobs = +(args[args.indexOf('--jobs') + 1] ?? 0) || Math.min(8, availableParallelism())
  if (!src) throw new Error('usage: node scripts/packs/qucs.ts <qucs_s checkout> [--jobs N]')
  const head = readFileSync(join(src, '.git/HEAD'), 'utf8').trim()
  if (head !== PIN) throw new Error(`checkout is at ${head}, expected the pinned commit ${PIN}`)
  const lib = join(src, 'library'), ver = spawnSync(NGSPICE, ['-v'], { encoding: 'utf8' }).stdout?.match(/ngspice-\d+\S*/)?.[0]
  if (!ver) throw new Error('ngspice not found (set NGSPICE)')

  const excluded: { src: string; why: string }[] = [], skipped: { src: string; why: string }[] = [], parts: Part[] = []
  const used: string[] = []
  const all = readdirSync(lib).filter((f) => f.endsWith('.lib')).map((f) => f.slice(0, -4)).sort()
  const OTHER = 'no symbol/category for these parts in this pack (digital, tubes, magnetics, passives, thyristors, multi-pin ICs, ...)'
  for (const f of all) {
    if (NATIVE_FILES.includes(f) || SPICE_FILES.includes(f)) continue
    ;(f.startsWith('VDMOS') ? excluded : skipped).push({ src: `${f}.lib (${components(lib, f).length} parts)`, why: SKIP_FILES[f] ?? OTHER })
  }
  for (const f of [...NATIVE_FILES, ...SPICE_FILES]) {
    if (f === 'Regulators') { // .Def-only except its TL431 <Spice> block
      skipped.push({ src: 'Regulators.lib (.Def parts)', why: '.Def-only (qucsator) and listed in Qucs-S library/ngspice.blacklist' })
    }
    used.push(f)
    for (const c of components(lib, f)) {
      const key = `${f}#${c.name}`
      if (f === 'Regulators' && !SPICE_SPEC[key]) continue
      try {
        let r
        if (SPICE_FILES.includes(f)) {
          const ex = provenance(lib, c)
          if (ex) { excluded.push({ src: key, why: ex }); continue }
          const spec = SPICE_SPEC[key] ?? SPICE_SPEC[f]
          if (!spec) { skipped.push({ src: key, why: 'no symbol/pin mapping for this part in the pack' }); continue }
          r = spice(lib, c, sname(c.name), spec)
        } else {
          // ngspice reads a model name like 237A or 201 as a number: prefix the device letter (D237A, J201)
          const pre = { JFETs: 'J', MOSFETs: 'M', NMOSFETs: 'M', PMOSFETs: 'M', Transistors: 'Q', BJT_Extended: 'Q' }[f] ?? 'D'
          const name = (/^\d[\d.]*[a-z]{0,3}$/i.test(c.name) ? pre : '') + sname(c.name)
          r = /^\s*\.Def:/m.test(section(c, 'Model') ?? '') ? def(c, name) : native(c, name)
        }
        parts.push({ name: r.name, kind: r.kind, category: r.cat, text: r.text, pins: r.pins, test: r.test, src: key, how: r.how })
      } catch (e) {
        skipped.push({ src: key, why: (e as Error).message })
      }
    }
  }
  // every part must stand alone and be found by the app's parser under its name
  for (const p of parts) {
    const q = parseLibFile(p.text), hit = p.pins.length ? q.subckts.find((s) => s.name === p.name) : q.models.find((m) => m.name === p.name)
    if (q.errors.length || !hit || (p.pins.length && hit && 'pins' in hit && hit.pins.join(' ') !== p.pins.join(' ')))
      throw new Error(`internal: ${p.src} does not parse back (${q.errors.join('; ')})`)
  }

  process.stderr.write(`simulating ${parts.length} parts with ${jobs} ngspice processes (${ver})\n`)
  const res = await validate(parts, jobs)
  const failed = parts.map((p, i) => ({ p, why: res[i] })).filter((x) => x.why)
  // one part per name (ngspice names are case-insensitive): the first that passed, in build order
  const ok: Part[] = [], first = new Set<string>()
  parts.forEach((p, i) => {
    if (res[i]) return
    if (first.has(p.name.toLowerCase())) return void skipped.push({ src: p.src, why: 'duplicate name: the first definition that passed is shipped' })
    first.add(p.name.toLowerCase()), ok.push(p)
  })

  // ---- write the pack
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const CATS: Category[] = ['Diodes', 'BJTs', 'JFETs', 'MOSFETs', 'Op-amps', 'Comparators', 'Regulators', 'References', 'Optocouplers', 'Timers']
  const libs: { file: string; entries: { name: string; kind: Kind; category: Category; pinMap: number[] }[] }[] = []
  const cmp = (a: Part, b: Part) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0)
  for (const cat of CATS) {
    const ps = ok.filter((p) => p.category === cat).sort(cmp)
    if (!ps.length) continue
    const stem = 'qucs-' + cat.toLowerCase().replace(/[^a-z]+/g, '')
    const chunks: Part[][] = [[]]
    let size = 0
    for (const p of ps) {
      if (size + p.text.length > MAX_LIB && chunks.at(-1)!.length) chunks.push([]), (size = 0)
      chunks.at(-1)!.push(p), (size += p.text.length + 2)
    }
    chunks.forEach((ch, i) => {
      const file = `${stem}${chunks.length > 1 ? '-' + (i + 1) : ''}.lib`
      const head = [`* Qucs-S community parts: ${cat}${chunks.length > 1 ? ` (${i + 1} of ${chunks.length})` : ''}, ${ch.length} parts`,
        `* Converted from ${REPO}/tree/${PIN}/library by scripts/packs/qucs.ts (ngspice Studio).`,
        '* Licence: GNU GPL version 2 or later, see COPYING; origin and changes: NOTICE.md and BUILD.md.', '']
      writeFileSync(join(OUT, file), [...head, ...ch.map((p) => p.text + '\n')].join('\n'))
      libs.push({ file, entries: ch.map((p) => ({ name: p.name, kind: p.kind, category: p.category, pinMap: p.pins.map((_, k) => k) })) })
    })
  }
  writeFileSync(join(OUT, 'COPYING'), readFileSync(join(src, 'COPYING')))
  // provenance: the source files (and <SpiceAttach> files) of the shipped parts
  const prov: { file: string; url: string; sha256: string; retrieved: string }[] = []
  const add = (file: string) => prov.some((x) => x.file === file) || prov.push({
    file, url: `https://raw.githubusercontent.com/ra3xdh/qucs_s/${PIN}/${file}`,
    sha256: createHash('sha256').update(readFileSync(join(src, file))).digest('hex'), retrieved: RETRIEVED
  })
  for (const f of used) {
    const shipped = new Set(ok.filter((p) => p.src.startsWith(f + '#')).map((p) => p.src.slice(f.length + 1)))
    if (!shipped.size) continue
    add(`library/${f}.lib`)
    for (const c of components(lib, f)) if (shipped.has(c.name)) for (const a of c.body.matchAll(/<SpiceAttach\s*"([^"]+)"/g)) add(`library/${f}/${a[1]}`)
  }
  const pack = {
    id: 'qucs', name: 'Qucs-S community parts',
    description: `${ok.length} discrete semiconductors and ICs from the Qucs-S component library (diodes, zeners, LEDs, BJTs, JFETs, MOSFETs, op-amps, regulators, references, optocouplers, 555 timers), converted to SPICE and checked in ngspice.`,
    license: 'GPL-2.0-or-later', source: `${REPO}/tree/${PIN}/library`, version: `qucs_s@${PIN.slice(0, 12)} (${PIN_DATE})`,
    notice: 'NOTICE.md', provenance: prov, libs
  }
  writeFileSync(join(OUT, 'pack.json'), JSON.stringify(pack, null, 1) + '\n')
  writeFileSync(join(OUT, 'NOTICE.md'), notice(ok.length))
  writeFileSync(join(OUT, 'BUILD.md'), build({ parts, ok, failed, excluded, skipped, ver, libs }))
  process.stderr.write(`shipped ${ok.length}/${parts.length} (${failed.length} failed simulation), ${excluded.length} excluded, ${skipped.length} skipped\n`)
}

function notice(n: number) {
  return `# Qucs-S community parts: origin and licence

This pack holds ${n} component models taken from the component library of **Qucs-S** (the Quite Universal Circuit
Simulator with SPICE), ${REPO}, \`library/\` directory at commit \`${PIN}\` (${PIN_DATE}).
Qucs-S and its library are distributed under the GNU General Public License, version 2 or (at your option) any later
version; the full licence text is in \`COPYING\` (copied unchanged from the Qucs-S repository). The models were written
or collected by the Qucs and Qucs-S contributors; where a part's description names an author it is kept in the comment
above the part.

## What was changed

The files here are a **converted (modified) form** of the Qucs-S library files, produced by \`scripts/packs/qucs.ts\` in
the ngspice Studio source:

- Qucs component properties (\`<Diode>\`, \`<_BJT>\`, \`<JFET>\`, \`<_MOSFET>\`) were rewritten as SPICE \`.model\` cards (or
  small \`.subckt\` wrappers where instance parameters such as MOSFET L/W are needed), following Qucs-S's own ngspice
  netlister; qucsator \`.Def:\` subcircuits were rewritten element by element as SPICE \`.subckt\`s.
- Qucs-S \`<Spice>\` sections are kept as shipped, nested inside a wrapper \`.subckt\` that ties the Qucs ground pin to
  node 0 and gives the pins readable names.
- Parts that carry third-party vendor notices, or look like vendor models with their notices removed, were left out,
  as were parts that failed a simulation check in ngspice. \`BUILD.md\` lists every part left out and why, plus the
  sha256 of each source file in \`pack.json\` (\`provenance\`).

## Where the original source is

${REPO}/tree/${PIN}/library — the exact files used are listed with download links in \`pack.json\`. The
conversion script that produced this folder is \`scripts/packs/qucs.ts\` in the ngspice Studio repository; together they
are the "preferred form for making modifications" of these files.

This pack comes with NO WARRANTY; see sections 11 and 12 of the GPL.
`
}

function build(o: { parts: Part[]; ok: Part[]; failed: { p: Part; why: string | null }[]; excluded: { src: string; why: string }[]; skipped: { src: string; why: string }[]; ver: string; libs: { file: string; entries: unknown[] }[] }) {
  const cats = [...new Set(o.parts.map((p) => p.category))]
  const bad = new Set(o.failed.map((f) => f.p))
  const row = (c: string, ps = o.parts.filter((p) => c === 'Total' || p.category === c)) => {
    const pass = ps.filter((p) => !bad.has(p)).length, ship = o.ok.filter((p) => c === 'Total' || p.category === c).length
    return `| ${c === 'Total' ? '**Total**' : c} | ${ps.length} | ${pass} | ${(100 * pass / ps.length).toFixed(1)}% | ${ship} |`
  }
  const how = (h: Part['how']) => { const ps = o.parts.filter((p) => p.how === h); return `${ps.filter((p) => !bad.has(p)).length}/${ps.length}` }
  const group = (xs: { src: string; why: string }[]) => {
    const m = new Map<string, string[]>()
    for (const x of xs) m.set(x.why, [...(m.get(x.why) ?? []), x.src])
    return [...m].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).map(([w, s]) => `- **${w}** (${s.length}): ${s.join(', ')}`).join('\n')
  }
  const sizes = o.libs.map((l) => `| ${l.file} | ${l.entries.length} | ${(statSync(join(OUT, l.file)).size / 1024).toFixed(0)} KiB |`)
  return `# Build log: Qucs-S community parts

Generated by \`node scripts/packs/qucs.ts <qucs_s checkout>\` from ${REPO} at \`${PIN}\`, simulated with ${o.ver}
in plain mode (\`ngspice -b -n\`, no compatibility flags). Every shipped part passed its category check below.

## Checks

- diodes (incl. Schottky, varactor, PIN): forward drop 0.1..1.5 V at ~1 mA, and < 0.1 mA leakage at -1 V
- LEDs: 1.0..4.5 V at ~10 mA, and the same leakage check; zeners: forward + leakage, then the reverse voltage at 5 mA
  within 25% of the rating in the description/part number (or any breakdown when no rating is given)
- BJTs: |Vbe| 0.05..1.2 V (Darlingtons 0.6..2.5 V) and beta > 3, at either Ib = 10 uA (5 V / 100 ohm collector) or
  Ib = 1 mA (5 V / 1 ohm; power parts, Darlingtons with a base-emitter resistor)
- JFETs: Idss > 10 uA at Vgs = 0, pinched off (< 5% of Idss) at Vgs = -15 V (P: mirrored)
- MOSFETs: Id > 1 mA at Vgs = 10 V (5 V / 10 ohm drain), off (< 5% of that) at Vgs = 0 or -10 V (P: mirrored)
- op-amps: unity-gain follower at +-15 V within 20 mV for +1 V and -2 V inputs
- regulators: output within 5% at 50 mA load; references: TL431 shunt 2.42..2.57 V, LM334 ~1 mA with 68 ohm
- optocouplers: 4N25 > 0.5 mA collector current with 10 mA LED and < 10 uA dark; triac/SSR outputs switch a 5 V / 1 k
  load on (transient) and stay off with the LED dark
- 555 timers: astable (1k, 10k, 10 nF) period within 30% of 0.693 (Ra + 2 Rb) C and > 3 V output swing

## Result

| Category | Converted | Passed | Pass rate | Shipped |
|---|---|---|---|---|
${cats.map((c) => row(c)).join('\n')}
${row('Total')}

Converted counts every candidate, including the same part number from two Qucs-S files; Shipped is after keeping the
first passing definition of each name.

Simulation pass rate by source form: native Qucs components ${how('native')}, qucsator .Def subcircuits ${how('def')},
<Spice> sections ${how('spice')}.

| File | Parts | Size |
|---|---|---|
${sizes.join('\n')}

## Dropped: failed simulation (${o.failed.length})

Mostly errors in the Qucs-S data itself (e.g. S2K has Is = 1.3 A, MMST4401 Nf = 410) or LTspice-only syntax; they
are dropped, not repaired.

${o.failed.map((f) => `- ${f.p.src} (${f.p.name}, ${f.p.how}): ${f.why}`).join('\n') || 'none'}

## Excluded: provenance / licence (${o.excluded.length})

${group(o.excluded)}

## Not converted (${o.skipped.length})

${group(o.skipped)}

## Conversion notes

- Positional properties follow Props.append() order in qucs/components/{diode,bjtsub,jfet,mosfet_sub}.cpp at the pinned
  commit. Diodes saved with fewer than 28 values use the pre-2014 layout (Temp at position 11, no Ikf), as
  Component::load assumes; the layout is taken from the diode.cpp history.
- Parameter names/drops follow each component's spice_netlist() in Qucs-S, except: Bv=0 is dropped (no breakdown;
  ngspice would break down at 0 V), diode Isr/Nr and JFET N/M/Xti/Betatce are kept (ngspice-47 supports them), MOSFET
  Rg becomes a series gate resistor, and MOSFET L/W default to Qucs's 1 um (ngspice's default is 100 um). JFET Isr/Nr
  are dropped as Qucs-S does (ngspice's JFET has no recombination current).
- Qucs values are converted to plain numbers (Qucs 'M' = mega, SPICE 'M' = milli).
- qucsator .Def lines map one-to-one (R C L Vdc Idc VCVS VCCS CCCS CCVS Diode BJT JFET MOSFET Sub); qucsator Diode
  nodes are cathode, anode; 'gnd' becomes node 0. Anything else (EDD, Eqn, delays, ...) is not converted.
- <Spice> sections are nested inside a wrapper subckt (ground pin tied to 0) so helper subckt/model names stay local.
`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
