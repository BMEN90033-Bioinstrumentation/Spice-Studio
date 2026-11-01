// Component libraries: bundled parts + vendor .lib/.mod import. Pure TS (node --test loads it).
// Bundled models are self-written from datasheet key figures and checked against ngspice in test/library.test.ts.
import type { Kind } from '../schematic/symbols.ts'
import { blockShape, type Part, type Sheet } from '../schematic/model.ts'
import type { Project } from '../project/project.ts'

export type Category = 'Passives' | 'Sources' | 'Diodes' | 'BJTs' | 'MOSFETs' | 'Op-amps' | 'Subcircuits'
export interface LibEntry {
  id: string
  name: string
  category: Category
  kind: Kind
  description: string
  value: string
  spice?:
    | { type: 'model'; name: string; text: string }
    | { type: 'subckt'; name: string; pins: string[]; pinMap: number[]; text?: string; include?: string }
  params?: Record<string, string>
  source: 'bundled' | 'project' | 'user' | 'pack'
  group?: string // non-bundled: 'Project', 'My library' or the pack's name (panel/browser group header)
  compat?: string // pack dialect hint (e.g. 'ltspice'), carried through; netlister handling comes later
}
export interface ImportedLib { file: string; entries: { name: string; kind: Kind; category: Category; pinMap: number[] }[] }
export interface ParsedLib {
  models: { name: string; type: string; params: Record<string, string>; text: string }[]
  subckts: { name: string; pins: string[]; text: string }[]
  errors: string[]
}

// ---------------------------------------------------------------------------------------------- parser

// inline comments: ';' anywhere, '$' standing alone or followed by a space
const uncomment = (l: string) => l.replace(/;.*|(^|\s)\$(\s.*)?$/, '').trim()
const STOP = /^(params|optional|text):/i // .subckt pin list ends here (or at a k=v token)

export function parseLibFile(text: string): ParsedLib {
  const raw = text.split(/\r\n?|\n/)
  // logical statements: '+' lines fold into the previous one; comments/blank lines in between don't break it
  const st: { s: string; a: number; b: number }[] = []
  raw.forEach((r, i) => {
    const t = r.trim()
    if (!t || t[0] === '*') return
    const s = uncomment(t)
    if (t[0] === '+') {
      const last = st.at(-1)
      if (last) (last.s += ' ' + s.slice(1).trim()), (last.b = i)
    } else if (s) st.push({ s, a: i, b: i })
  })
  const out: ParsedLib = { models: [], subckts: [], errors: [] }
  let open: { name: string; pins: string[]; a: number } | null = null, depth = 0
  for (const { s, a, b } of st) {
    const [kw, ...tok] = s.split(/\s+/)
    const k = kw.toLowerCase()
    if (k === '.subckt') {
      if (depth++) continue // nested: local to the outer subckt, kept in its text
      if (!tok[0]) out.errors.push(`Line ${a + 1}: .subckt without a name`)
      const stop = tok.findIndex((t, i) => i > 0 && (STOP.test(t) || t.includes('=')))
      open = { name: tok[0] ?? '?', pins: tok.slice(1, stop < 0 ? undefined : stop), a }
    } else if (k === '.ends') {
      if (!depth) out.errors.push(`Line ${a + 1}: .ends without .subckt`)
      else if (!--depth && open) {
        out.subckts.push({ name: open.name, pins: open.pins, text: raw.slice(open.a, b + 1).join('\n') })
        open = null
      }
    } else if (k === '.model' && !depth) { // models inside a subckt are local to it
      const m = /^\.model\s+(\S+)\s+([a-z_]\w*)\s*(.*)$/is.exec(s)
      if (!m) {
        out.errors.push(`Line ${a + 1}: malformed .model`)
        continue
      }
      const params: Record<string, string> = {}
      for (const [, pk, v] of m[3].matchAll(/([a-z_]\w*)\s*=\s*([^\s,()=]+)/gi)) params[pk.toUpperCase()] = v
      out.models.push({ name: m[1], type: m[2].toUpperCase(), params, text: raw.slice(a, b + 1).join('\n') })
    }
  }
  if (open) out.errors.push(`.subckt ${open.name} has no .ends`)
  return out
}

// SPICE number with SI suffix ('5.1', '100n', '2meg'); NaN if unparsable
const SI: Record<string, number> = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, mil: 25.4e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 }
function si(s: string | undefined): number {
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(meg|mil|[tgkmunpf])?/i.exec(s ?? '')
  return m ? +m[1] * (m[2] ? SI[m[2].toLowerCase()] : 1) : NaN
}

// ---------------------------------------------------------------------------------------------- suggestions

const CATEGORY: Partial<Record<Kind, Category>> = {
  diode: 'Diodes', zener: 'Diodes', led: 'Diodes', npn: 'BJTs', pnp: 'BJTs', nmos: 'MOSFETs', pmos: 'MOSFETs', opamp5: 'Op-amps', block: 'Subcircuits'
}
const ZENER_NAME = /^(bz|mmsz|mmbz|zpd|zmm|smbj?z|1n47\d\d|1n52\d\d|1n53\d\d)|zen/i
// symbol pin order patterns (names lowercased, '_' and spaces removed)
const OA = [
  /^(\+|\+in|in\+|vin\+|v?inp|inpos|non-?inv(erting)?(in(put)?)?|plus)$/,
  /^(-|-in|in-|vin-|v?inn|v?inm|inneg|inv(erting)?(in(put)?)?|minus)$/,
  /^(v\+|\+v|\+vs|vs\+|vcc|\+vcc|vdd|avdd|vp|vpos|vplus|pos)$/,
  /^(v-|-v|-vs|vs-|vee|-vee|vss|avss|vn|vneg|vminus|neg|gnd)$/,
  /^(out|output|vout|vo|o)$/
]
const BJT = [/^(c|col|coll(ector)?)$/, /^(b|base)$/, /^(e|emit(ter)?)$/]
const MOS = [/^(d|drain)$/, /^(g|gate)$/, /^(s|source|src)$/]

// pinMap[symbol pin] = subckt pin index, if every pattern matches exactly one distinct pin
function mapPins(pins: string[], pats: RegExp[]): number[] | undefined {
  const n = pins.map((p) => p.toLowerCase().replace(/[_\s]/g, ''))
  const map = pats.map((re) => {
    const hits = n.flatMap((p, i) => (re.test(p) ? [i] : []))
    return hits.length === 1 ? hits[0] : -1
  })
  return map.includes(-1) || new Set(map).size < map.length ? undefined : map
}

function modelKind(m: ParsedLib['models'][number]): Kind | undefined {
  switch (m.type) {
    case 'D':
      if (/led/i.test(m.name)) return 'led'
      return si(m.params.BV) < 30 && ZENER_NAME.test(m.name) ? 'zener' : 'diode'
    case 'NPN': case 'PNP': case 'NMOS': case 'PMOS':
      return m.type.toLowerCase() as Kind
    case 'VDMOS':
      return /\bpchan\b/i.test(m.text) ? 'pmos' : 'nmos'
  }
  // ponytail: other model types (SW, R, C, NJF…) have no symbol; they still arrive via .include with the subckts
}

export function suggest(p: ParsedLib): ImportedLib['entries'] {
  const out: ImportedLib['entries'] = []
  for (const m of p.models) {
    const kind = modelKind(m)
    if (kind) out.push({ name: m.name, kind, category: CATEGORY[kind]!, pinMap: [] })
  }
  for (const s of p.subckts) {
    let kind: Kind = 'block', pinMap: number[] | undefined
    if (s.pins.length === 5) (kind = 'opamp5'), (pinMap = mapPins(s.pins, OA) ?? [0, 1, 2, 3, 4]) // fallback: in+ in- v+ v- out
    else if (s.pins.length === 3 && (pinMap = mapPins(s.pins, BJT))) kind = 'npn'
    else if (s.pins.length === 3 && (pinMap = mapPins(s.pins, MOS))) kind = 'nmos'
    out.push({ name: s.name, kind, category: CATEGORY[kind]!, pinMap: pinMap ?? s.pins.map((_, i) => i) })
  }
  return out
}

// Library file outside the project: ids `${prefix}${file}#NAME` ('user:' / 'pack:<id>/'), subckts .include'd by
// absolute path (dir + '/' + file). Without it: a project lib, 'proj:' ids, include relative to the project folder.
export interface LibSource { source: 'user' | 'pack'; prefix: string; dir: string; group: string; compat?: string }

export function entriesFromImport(lib: ImportedLib, text: string, src?: LibSource): LibEntry[] {
  const p = parseLibFile(text), same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const include = src ? `${src.dir}/${lib.file}` : lib.file
  return lib.entries.flatMap((e): LibEntry[] => {
    const base = {
      id: `${src?.prefix ?? 'proj:'}${lib.file}#${e.name}`, name: e.name, category: e.category, kind: e.kind, value: e.name,
      source: src?.source ?? ('project' as const), group: src?.group ?? 'Project', ...(src?.compat && { compat: src.compat })
    }
    const m = p.models.find((m) => same(m.name, e.name))
    if (m) return [{ ...base, description: `${m.type} model from ${lib.file}`, spice: { type: 'model', name: m.name, text: m.text }, params: m.params }]
    const s = p.subckts.find((s) => same(s.name, e.name))
    if (s) return [{ ...base, description: `${s.pins.length}-pin subcircuit (${s.pins.join(' ')}) from ${lib.file}`, spice: { type: 'subckt', name: s.name, pins: s.pins, pinMap: e.pinMap, include } }]
    return [] // gone from the file since import
  })
}

// 'user:a.lib#Q1' -> 'user:a.lib' (the library file's key); '' for bundled parts
export const libKey = (id: string) => (id.startsWith('std:') ? '' : id.slice(0, id.indexOf('#')))

// ---------------------------------------------------------------------------------------------- copy-on-use

export interface SourceLibs { prefix: string; libs: ImportedLib[]; texts: Record<string, string> }
export interface ProjectIO { list(): Promise<string[]>; read(rel: string): Promise<string>; write(rel: string, text: string): Promise<void> }

// Parts in project sheets that use a personal/pack library get a project copy: the file goes to libs/ once (reused
// when a same-named file with the same text is there, else a -2, -3… name), its mapping joins project.libs and the
// parts' ids become 'proj:'. `only` limits which parts count. Returns only what changed, or null when nothing to copy.
export async function copyOnUse(sheets: Record<string, Sheet>, project: Project, srcs: SourceLibs[], io: ProjectIO, only = (_: Part) => true) {
  const foreign = (p: Part) => /^(user|pack):/.test(p.lib ?? '') && only(p)
  const keys = new Set(Object.values(sheets).flatMap((s) => s.parts.flatMap((p) => (foreign(p) ? [libKey(p.lib!)] : []))))
  const to = new Map<string, string>(), texts: Record<string, string> = {}
  let libs = project.libs, have: Set<string> | undefined
  for (const key of keys) {
    const src = srcs.find((s) => key.startsWith(s.prefix)), file = key.slice(src?.prefix.length ?? 0)
    const lib = src?.libs.find((l) => l.file === file), text = src?.texts[file]
    if (!lib || text == null) continue // unknown source: the netlister reports the part
    have ??= new Set(await io.list())
    const m = /^(.*?)(\.[^.]*)?$/.exec(file.replace(/^.*\//, ''))!
    let rel = ''
    for (let i = 1; ; i++) {
      rel = `libs/${m[1]}${i > 1 ? '-' + i : ''}${m[2] ?? ''}`
      if (!have.has(rel)) {
        await io.write(rel, text)
        have.add(rel)
        break
      }
      if ((await io.read(rel)) === text) break
    }
    const old = libs.find((l) => l.file === rel), got = new Set(old?.entries.map((e) => e.name.toLowerCase()))
    const merged = { file: rel, entries: [...(old?.entries ?? []), ...lib.entries.filter((e) => !got.has(e.name.toLowerCase()))] }
    libs = [...libs.filter((l) => l.file !== rel), merged]
    to.set(key, 'proj:' + rel), (texts[rel] = text)
  }
  if (!to.size) return null
  const out: Record<string, Sheet> = {}
  for (const [f, s] of Object.entries(sheets))
    if (s.parts.some((p) => foreign(p) && to.has(libKey(p.lib!))))
      out[f] = { ...s, parts: s.parts.map((p) => (foreign(p) && to.has(libKey(p.lib!)) ? { ...p, lib: to.get(libKey(p.lib!)) + p.lib!.slice(libKey(p.lib!).length) } : p)) }
  return { project: { ...project, libs }, texts, sheets: out }
}

export function resolver(entries: LibEntry[]): (id: string) => LibEntry | undefined {
  const m = new Map(entries.map((e) => [e.id, e]))
  return (id) => m.get(id)
}

// pins/size for placing a 'block' library part (generic box, pins in symbol order = pinMap order)
export function blockPartFields(e: LibEntry): Pick<Part, 'pins' | 'size'> {
  const s = e.spice?.type === 'subckt' ? e.spice : undefined
  return blockShape(s ? s.pinMap.map((i) => s.pins[i]) : [])
}

// ---------------------------------------------------------------------------------------------- bundled parts

const generic = (id: string, kind: Kind, category: Category, value: string, description: string): LibEntry =>
  ({ id: 'std:' + id, name: id, category, kind, description, value, source: 'bundled' })

const model = (name: string, kind: Kind, category: Category, description: string, text: string): LibEntry => {
  const m = parseLibFile(text).models[0]
  return { id: 'std:' + name, name, category, kind, description, value: name, spice: { type: 'model', name, text }, params: m.params, source: 'bundled' }
}

// Single-pole op-amp: gm into R||C (A0 = gm·R = 1e5 = 100 dB, GBW = gm/2πC), gain node clamped by diodes to
// 1.85 V inside each rail (output saturates ~1.2 V from the rails), unity buffer + Rout.
// ponytail: no slew limit, offset, CMRR or supply current; a vendor macromodel import covers those.
const opamp = (name: string, gbw: number, rin: string, rout: string, description: string): LibEntry => {
  const c = (1e-3 / (2 * Math.PI * gbw)).toPrecision(4)
  const pins = ['inp', 'inn', 'vp', 'vn', 'out']
  const text = `.subckt ${name} ${pins.join(' ')}
* in+ in- v+ v- out. Self-written single-pole macromodel, GBW ${gbw / 1e6} MHz
Rin inp inn ${rin}
G1 0 n1 inp inn 1m
R1 n1 0 100Meg
C1 n1 0 ${c}
Vh vp h DC 1.85
Dh n1 h ${name}_CL
Vl l vn DC 1.85
Dl l n1 ${name}_CL
E1 o 0 n1 0 1
Ro o out ${rout}
.model ${name}_CL D(IS=1e-15)
.ends ${name}`
  return {
    id: 'std:' + name, name, category: 'Op-amps', kind: 'opamp5', description, value: name,
    spice: { type: 'subckt', name, pins, pinMap: [0, 1, 2, 3, 4], text },
    params: { A0: '100 dB', GBW: `${gbw / 1e6} MHz`, Rin: rin, Rout: rout, Swing: '±(Vs − 1.2 V)' },
    source: 'bundled'
  }
}

export const BUNDLED: LibEntry[] = [
  generic('R', 'res', 'Passives', '1k', 'Resistor'),
  generic('C', 'cap', 'Passives', '1u', 'Capacitor'),
  generic('L', 'ind', 'Passives', '1m', 'Inductor'),
  generic('V', 'vsrc', 'Sources', 'DC 1', 'Voltage source (DC, AC, PULSE, SIN… spec in the value)'),
  generic('I', 'isrc', 'Sources', 'DC 1m', 'Current source (DC, AC, PULSE, SIN… spec in the value)'),

  model('1N4148', 'diode', 'Diodes', 'Small-signal fast switching diode, 100 V, Vf ≈ 0.73 V @ 10 mA, Cj ≈ 2 pF',
    '.model 1N4148 D(IS=4n N=1.9 RS=0.6 CJO=2p M=0.33 VJ=0.5 TT=4n BV=100 IBV=100n)'),
  model('1N4007', 'diode', 'Diodes', 'General-purpose rectifier, 1 A 1000 V, Vf ≈ 0.95 V @ 1 A (slow recovery)',
    '.model 1N4007 D(IS=7n N=1.8 RS=0.08 CJO=15p M=0.33 VJ=0.5 TT=4u BV=1000 IBV=5u)'),
  model('1N5819', 'diode', 'Diodes', 'Schottky rectifier, 1 A 40 V, Vf ≈ 0.39 V @ 1 A',
    '.model 1N5819 D(IS=10u N=1.1 RS=0.06 CJO=110p M=0.35 VJ=0.35 EG=0.69 XTI=2 BV=40 IBV=1m)'),
  model('BZX84C5V1', 'zener', 'Diodes', 'Zener diode, 5.1 V @ 5 mA',
    '.model BZX84C5V1 D(IS=1n N=1.2 RS=2 CJO=60p M=0.33 BV=5.1 IBV=5m)'),
  model('LED_RED', 'led', 'Diodes', 'Red LED, Vf ≈ 1.9 V @ 20 mA',
    '.model LED_RED D(IS=1e-17 N=2 RS=5 CJO=40p M=0.33 BV=5 IBV=10u)'),
  model('LED_GREEN', 'led', 'Diodes', 'Green LED (classic GaP), Vf ≈ 2.1 V @ 20 mA',
    '.model LED_GREEN D(IS=3e-19 N=2 RS=5 CJO=40p M=0.33 BV=5 IBV=10u)'),

  model('2N3904', 'npn', 'BJTs', 'General-purpose NPN, 40 V 200 mA, hFE ≈ 200 @ 10 mA, fT ≈ 300 MHz',
    `.model 2N3904 NPN(IS=6f BF=250 NF=1 VAF=80 IKF=70m ISE=10f NE=1.4 BR=4 NR=1 VAR=20
+ RB=10 RC=1 RE=0.2 CJE=4.5p VJE=0.75 MJE=0.33 CJC=3.6p VJC=0.75 MJC=0.3
+ TF=300p XTF=2 VTF=4 ITF=0.4 TR=200n EG=1.11 XTI=3 XTB=1.5)`),
  model('2N3906', 'pnp', 'BJTs', 'General-purpose PNP (2N3904 complement), 40 V 200 mA, hFE ≈ 170 @ 10 mA',
    `.model 2N3906 PNP(IS=1.4f BF=200 NF=1 VAF=70 IKF=80m ISE=5f NE=1.4 BR=4 NR=1 VAR=20
+ RB=10 RC=2.5 RE=0.3 CJE=4.5p VJE=0.75 MJE=0.33 CJC=4.5p VJC=0.75 MJC=0.33
+ TF=500p XTF=2 VTF=4 ITF=0.4 TR=30n EG=1.11 XTI=3 XTB=1.5)`),
  model('2N2222', 'npn', 'BJTs', 'Medium-power NPN, 40 V 600 mA, hFE ≈ 180 @ 10 mA',
    `.model 2N2222 NPN(IS=14f BF=200 NF=1 VAF=90 IKF=0.3 ISE=14f NE=1.5 BR=6 NR=1 VAR=20
+ RB=10 RC=0.3 RE=0.1 CJE=22p VJE=0.75 MJE=0.35 CJC=7p VJC=0.75 MJC=0.33
+ TF=400p XTF=3 VTF=2 ITF=0.6 TR=40n EG=1.11 XTI=3 XTB=1.5)`),

  // level 1 with ngspice's default W = L = 100u, so CGSO/CGDO (F/m) × 100u = Cgs/Cgd
  model('2N7000', 'nmos', 'MOSFETs', 'Small-signal N-MOSFET, 60 V 200 mA, Vth ≈ 2.1 V, Rds(on) ≈ 2.3 Ω @ Vgs 10 V',
    '.model 2N7000 NMOS(LEVEL=1 VTO=2 KP=0.1 LAMBDA=0.01 RD=0.5 RS=0.5 CBD=25p CGSO=1.5e-7 CGDO=0.3e-7 IS=1e-14)'),
  model('BS250', 'pmos', 'MOSFETs', 'Small-signal P-MOSFET, −45 V −250 mA, Vth ≈ −2.4 V, Rds(on) ≈ 11 Ω @ Vgs −10 V',
    '.model BS250 PMOS(LEVEL=1 VTO=-2 KP=0.0125 LAMBDA=0.02 RD=0.5 RS=0.5 CBD=30p CGSO=5e-7 CGDO=0.8e-7 IS=1e-14)'),

  generic('OPAMP', 'opamp', 'Op-amps', '1e6', 'Ideal op-amp: VCVS with gain 1e6, no supplies, no bandwidth or swing limits'),
  opamp('OA_GENERIC', 1e6, '2Meg', '75', 'Generic op-amp macromodel: 100 dB, GBW 1 MHz, output swings to ~1.2 V from the rails'),
  opamp('OA_FAST', 10e6, '1Meg', '50', 'Fast op-amp macromodel: 100 dB, GBW 10 MHz, output swings to ~1.2 V from the rails')
]
