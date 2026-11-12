// Component libraries: bundled parts + vendor .lib/.mod import. Pure TS (node --test loads it).
// Bundled models are self-written from datasheet key figures and checked against ngspice in test/library.test.ts.
import { isFlag, SYMBOLS, type Kind } from '../schematic/symbols.ts'
import { blockShape, type Part, type Sheet } from '../schematic/model.ts'
import type { Project } from '../project/project.ts'
import { DIGITAL_PARTS } from '../schematic/digital.ts'
import { validSymbol, type CustomSymbol } from './customSymbol.ts'

export type Category = 'Passives' | 'Sources' | 'Controlled sources' | 'Switches' | 'Diodes' | 'BJTs' | 'JFETs' | 'MOSFETs' | 'Op-amps' | 'Comparators'
  | 'Regulators' | 'References' | 'Optocouplers' | 'Timers' | 'Subcircuits' | 'Digital'
  | (string & {}) // your own: typed when adding a part to My library (packs stay on the built-in ones: checkPack)
export interface LibEntry {
  id: string
  name: string
  category: Category
  kind: Kind
  description: string
  mfr?: string; mpn?: string // manufacturer and its part number: shown on the detail card, the BOM's starting values
  value: string
  spice?:
    | { type: 'model'; name: string; text: string }
    | { type: 'subckt'; name: string; pins: string[]; pinMap: number[]; text?: string; include?: string }
  params?: Record<string, string>
  source: 'bundled' | 'project' | 'user' | 'pack'
  group?: string // non-bundled: 'Project', 'My library' or the pack's name (panel/browser group header)
  compat?: string // pack dialect hint (e.g. 'ltspice'), carried through; netlister handling comes later
  symbol?: CustomSymbol // drawn in the symbol editor (customSymbol.ts)
}
export interface ImportedLib {
  file: string; entries: { name: string; kind: Kind; category: Category; pinMap: number[]; symbol?: CustomSymbol; mfr?: string; mpn?: string }[] // mfr / mpn: manufacturer and its part number (component builder)
  enabled?: false // hidden from the parts lists and search (Manage Libraries); its parts still resolve for netlisting
}
export const libOn = (l: { enabled?: boolean }) => l.enabled !== false
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

// SPICE number with SI suffix (netlist.ts uses it to check transformer values) ('5.1', '100n', '2meg'); NaN if unparsable
const SI: Record<string, number> = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, mil: 25.4e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 }
export function si(s: string | undefined): number {
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(meg|mil|[tgkmunpf])?/i.exec(s ?? '')
  return m ? +m[1] * (m[2] ? SI[m[2].toLowerCase()] : 1) : NaN
}

// ---------------------------------------------------------------------------------------------- suggestions

const CATEGORY: Partial<Record<Kind, Category>> = {
  diode: 'Diodes', zener: 'Diodes', led: 'Diodes', npn: 'BJTs', pnp: 'BJTs', njf: 'JFETs', pjf: 'JFETs', nmos: 'MOSFETs', pmos: 'MOSFETs', opamp5: 'Op-amps', block: 'Subcircuits'
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
    case 'NPN': case 'PNP': case 'NJF': case 'PJF': case 'NMOS': case 'PMOS':
      return m.type.toLowerCase() as Kind
    case 'VDMOS':
      return /\bpchan\b/i.test(m.text) ? 'pmos' : 'nmos'
  }
  // ponytail: other model types (SW, R, C…) have no symbol; they still arrive via .include with the subckts
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

// Component builder (Builder.tsx): SPICE to start a new part from. Each parses cleanly into exactly one placeable part.
export const STARTERS: { title: string; text: string }[] = [
  { title: 'Diode', text: '* A diode: Is saturation current, N emission coefficient, Rs series resistance,\n* Cjo junction capacitance, Bv / Ibv reverse breakdown\n.model MyDiode D(Is=2.5n N=1.8 Rs=0.6 Cjo=4p Bv=100 Ibv=100u)\n' },
  { title: 'Zener', text: '* A 5.1 V zener: Bv sets the breakdown voltage\n.model MyZener D(Is=1n N=1.2 Rs=5 Cjo=150p Bv=5.1 Ibv=5m)\n' },
  { title: 'LED', text: '* An LED: about 1.9 V across it at 10 mA (a larger Is lowers that, a smaller one raises it)\n.model MyLED D(Is=1e-20 N=1.8 Rs=2 Cjo=30p Bv=5 Ibv=10u)\n' },
  { title: 'NPN', text: '* An NPN transistor: Bf forward gain, Vaf Early voltage (for a PNP, change NPN to PNP)\n.model MyNPN NPN(Is=1e-14 Bf=200 Vaf=100 Rb=10 Cje=8p Cjc=4p Tf=400p)\n' },
  { title: 'PNP', text: '* A PNP transistor: Bf forward gain, Vaf Early voltage\n.model MyPNP PNP(Is=1e-14 Bf=150 Vaf=80 Rb=10 Cje=8p Cjc=5p Tf=500p)\n' },
  { title: 'N-MOSFET', text: '* An N-channel MOSFET: Vto threshold, Kp transconductance (for P-channel, change NMOS to PMOS and make Vto negative)\n.model MyNMOS NMOS(Level=1 Vto=1.5 Kp=0.5 Lambda=0.02)\n' },
  { title: 'P-MOSFET', text: '* A P-channel MOSFET: Vto threshold (negative), Kp transconductance\n.model MyPMOS PMOS(Level=1 Vto=-1.5 Kp=0.2 Lambda=0.02)\n' },
  { title: 'N-JFET', text: '* An N-channel JFET: Vto pinch-off voltage, Beta transconductance (for P-channel, change NJF to PJF)\n.model MyJFET NJF(Vto=-2 Beta=1.3m Lambda=2m Cgs=4p Cgd=4p)\n' },
  { title: 'P-JFET', text: '* A P-channel JFET: Vto pinch-off voltage, Beta transconductance\n.model MyPJFET PJF(Vto=-2 Beta=1m Lambda=2m Cgs=5p Cgd=5p)\n' },
  { title: 'Op-amp', text: '* An op-amp built from parts: gain 100k, one pole near 10 Hz (about 1 MHz unity gain)\n* pins: in+ in- v+ v- out\n.subckt MyOpamp inp inn vcc vee out\nRin inp inn 10meg\nG1 0 n1 inp inn 1m\nR1 n1 0 100meg\nC1 n1 0 159p\nE1 n2 0 n1 0 1\nRout n2 out 50\n.ends MyOpamp\n' },
  { title: 'Custom block', text: '* Any circuit as one part: the names after the subcircuit name are its pins\n.subckt MyFilter in out gnd\nR1 in out 10k\nC1 out gnd 100n\n.ends MyFilter\n' }
]

// The builder's form view reads a definition's text into fields and writes it back (the text stays the one truth).
// ponytail: writing a .model back keeps only its k=v parameters (comments inside it and bare flags go); the code view keeps everything.
export const MODEL_TYPES = ['D', 'NPN', 'PNP', 'NJF', 'PJF', 'NMOS', 'PMOS']
const BJT_P: [string, string][] = [['Is', 'Saturation current (A)'], ['Bf', 'Forward gain β'], ['Vaf', 'Early voltage (V)'], ['Rb', 'Base resistance (Ω)'], ['Rc', 'Collector resistance (Ω)'], ['Re', 'Emitter resistance (Ω)'], ['Cje', 'Base-emitter capacitance (F)'], ['Cjc', 'Base-collector capacitance (F)'], ['Tf', 'Transit time (s)']]
const MOS_P: [string, string][] = [['Level', 'Model level'], ['Vto', 'Threshold voltage (V)'], ['Kp', 'Transconductance (A/V²)'], ['Lambda', 'Channel-length modulation (1/V)'], ['Rd', 'Drain resistance (Ω)'], ['Rs', 'Source resistance (Ω)'], ['Cgso', 'Gate-source overlap capacitance (F/m)'], ['Cgdo', 'Gate-drain overlap capacitance (F/m)']]
const JFET_P: [string, string][] = [['Vto', 'Pinch-off voltage (V)'], ['Beta', 'Transconductance (A/V²)'], ['Lambda', 'Channel-length modulation (1/V)'], ['Rd', 'Drain resistance (Ω)'], ['Rs', 'Source resistance (Ω)'], ['Cgs', 'Gate-source capacitance (F)'], ['Cgd', 'Gate-drain capacitance (F)']]
// the parameters the form always offers per model type: [name, what it is]; left empty = ngspice's default
export const MODEL_PARAMS: Record<string, [string, string][]> = {
  D: [['Is', 'Saturation current (A)'], ['N', 'Emission coefficient'], ['Rs', 'Series resistance (Ω)'], ['Cjo', 'Junction capacitance (F)'], ['Bv', 'Reverse breakdown voltage (V)'], ['Ibv', 'Current at breakdown (A)'], ['Tt', 'Transit time (s)']],
  NPN: BJT_P, PNP: BJT_P, NMOS: MOS_P, PMOS: MOS_P, NJF: JFET_P, PJF: JFET_P
}
export function modelParts(text: string): { name: string; type: string; params: [string, string][] } | undefined {
  const s = text.split('\n').map((l) => uncomment(l.trim())).filter((l) => l && l[0] !== '*').map((l) => (l[0] === '+' ? l.slice(1) : l)).join(' ')
  const m = /^\.model\s+(\S+)\s+([a-z_]\w*)\s*(.*)$/is.exec(s)
  return m ? { name: m[1], type: m[2], params: [...m[3].matchAll(/([a-z_]\w*)\s*=\s*([^\s,()=]+)/gi)].map((x) => [x[1], x[2]]) } : undefined
}
export const modelText = (name: string, type: string, params: [string, string][]) => `.model ${name} ${type}(${params.map(([k, v]) => `${k}=${v}`).join(' ')})`
// tail: whatever follows the pins on the .subckt line (params: …); body: the lines between it and .ends
export function subcktParts(s: ParsedLib['subckts'][number]): { tail: string; body: string } {
  const lines = s.text.split('\n')
  let h = 1
  while (h < lines.length - 1 && lines[h].trim()[0] === '+') h++
  const head = lines.slice(0, h).map((l, i) => uncomment(l.trim()).slice(i ? 1 : 0)).join(' ').trim().split(/\s+/)
  return { tail: head.slice(2 + s.pins.length).join(' '), body: lines.slice(h, -1).join('\n') }
}
export const subcktText = (name: string, pins: string[], tail: string, body: string) => `${['.subckt', name, ...pins, tail].filter(Boolean).join(' ')}\n${body}${body ? '\n' : ''}.ends ${name}`

// Library file outside the project: ids `${prefix}${file}#NAME` ('user:' / 'pack:<id>/'), subckts .include'd by
// absolute path (dir + '/' + file). Without it: a project lib, 'proj:' ids, include relative to the project folder.
export interface LibSource { source: 'user' | 'pack'; prefix: string; dir: string; group: string; compat?: string }

export function entriesFromImport(lib: ImportedLib, text: string, src?: LibSource): LibEntry[] {
  const p = parseLibFile(text)
  // case-insensitive lookup, first definition wins
  const byName = <T extends { name: string }>(xs: T[]) => {
    const m = new Map<string, T>()
    for (const x of xs) if (!m.has(x.name.toLowerCase())) m.set(x.name.toLowerCase(), x)
    return m
  }
  const models = byName(p.models), subckts = byName(p.subckts)
  const include = src ? `${src.dir}/${lib.file}` : lib.file
  // descriptions name no library or file: the parts lists never show where a part came from (its detail card does)
  return lib.entries.flatMap((e): LibEntry[] => {
    const base = {
      id: `${src?.prefix ?? 'proj:'}${lib.file}#${e.name}`, name: e.name, category: e.category, kind: e.kind, value: e.name,
      source: src?.source ?? ('project' as const), group: src?.group ?? 'Project', ...(src?.compat && { compat: src.compat }), ...(validSymbol(e.symbol) && { symbol: e.symbol }), ...(e.mfr && { mfr: e.mfr }), ...(e.mpn && { mpn: e.mpn })
    }
    const m = models.get(e.name.toLowerCase())
    if (m) return [{ ...base, description: `${m.type} model`, spice: { type: 'model', name: m.name, text: m.text }, params: m.params }]
    const s = subckts.get(e.name.toLowerCase())
    if (s) return [{ ...base, description: `${s.pins.length}-pin subcircuit (${s.pins.join(' ')})`, spice: { type: 'subckt', name: s.name, pins: s.pins, pinMap: e.pinMap, include } }]
    return [] // gone from the file since import
  })
}

// Parts of a set of library files (My library, a project): all of them (resolver, copy-on-use) and the shown ones
// (enabled files only: the parts lists and search)
export function libEntries(libs: ImportedLib[], texts: Record<string, string>, src?: LibSource): { all: LibEntry[]; shown: LibEntry[] } {
  const per = libs.map((l) => (texts[l.file] == null ? [] : entriesFromImport(l, texts[l.file], src)))
  return { all: per.flat(), shown: per.filter((_, i) => libOn(libs[i])).flat() }
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
    const merged = { ...old, file: rel, entries: [...(old?.entries ?? []), ...lib.entries.filter((e) => !got.has(e.name.toLowerCase()))] }
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

// ---------------------------------------------------------------------------------------------- packs

export const CATEGORIES: Category[] = ['Passives', 'Sources', 'Controlled sources', 'Switches', 'Diodes', 'BJTs', 'JFETs', 'MOSFETs', 'Op-amps', 'Comparators', 'Regulators', 'References', 'Optocouplers', 'Timers', 'Subcircuits', 'Digital']
export interface PackLibs { id: string; name: string; dir: string; compat?: string; enabled: boolean; libs: ImportedLib[]; texts: Record<string, string> }
// short provenance tag on panel rows: 'Qucs-S community parts' -> 'Qucs-S'
export const packTag = (name: string) => name.trim().split(/\s+/)[0] || name

// Every pack's parts (the resolver needs them all: circuits using a disabled pack keep netlisting) and the browsable
// ones (enabled packs only). Parsed once per pack list read: toggling `enabled` keeps `texts`, so no re-parse.
const PARSED = new WeakMap<object, LibEntry[]>()
export function packEntries(packs: PackLibs[]): { all: LibEntry[]; shown: LibEntry[] } {
  const per = packs.map((p) => {
    let es = PARSED.get(p.texts)
    if (!es) PARSED.set(p.texts, (es = p.libs.flatMap((l) => (p.texts[l.file] == null ? [] :
      entriesFromImport(l, p.texts[l.file], { source: 'pack', prefix: `pack:${p.id}/`, dir: p.dir, group: packTag(p.name), compat: p.compat })))))
    return es
  })
  return { all: per.flat(), shown: per.filter((_, i) => packs[i].enabled).flat() }
}

export const PACK_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i // also the folder name under library-packs/
const FILE = /^(?!\.\.?$)[^\\/\0]{1,200}$/

// A pack.json from outside the app (Library packs › Add pack): shape, ids, files present and every entry defined in its
// file with a sane pin map. `read`: a referenced file's text, undefined if missing/unreadable. [] = fine.
export function checkPack(raw: unknown, read: (file: string) => string | undefined, taken: string[]): string[] {
  const errs: string[] = [], p = raw as Record<string, unknown>
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['pack.json must be a JSON object']
  if (typeof p.id !== 'string' || !PACK_ID.test(p.id)) errs.push('"id" must be 1–64 letters, digits, ".", "_" or "-" (it names the pack\'s folder)')
  else if (taken.some((t) => t.toLowerCase() === (p.id as string).toLowerCase())) errs.push(`A pack with id "${p.id}" is already installed`)
  if (typeof p.name !== 'string' || !p.name.trim()) errs.push('"name" is missing')
  for (const k of ['description', 'license', 'source', 'version', 'compat'])
    if (p[k] != null && typeof p[k] !== 'string') errs.push(`"${k}" must be a string`)
  if (p.notice != null && (typeof p.notice !== 'string' || !FILE.test(p.notice))) errs.push('"notice" must be a file name in the pack folder')
  else if (typeof p.notice === 'string' && read(p.notice) == null) errs.push(`The notice file ${p.notice} is missing`)
  if (!Array.isArray(p.libs) || !p.libs.length) return [...errs, '"libs" must list at least one library file']
  p.libs.forEach((l: any, i: number) => {
    const at = typeof l?.file === 'string' ? l.file : `libs[${i}]`
    if (typeof l?.file !== 'string' || !FILE.test(l.file)) return errs.push(`${at}: "file" must be a file name in the pack folder`)
    if (!Array.isArray(l.entries) || !l.entries.length) return errs.push(`${at}: "entries" must list at least one part`)
    const text = read(l.file)
    if (text == null) return errs.push(`${at} is missing from the folder`)
    const lib = parseLibFile(text), seen = new Set<string>()
    for (const e of lib.errors) errs.push(`${at}: ${e}`)
    l.entries.forEach((e: any, j: number) => {
      const n = typeof e?.name === 'string' && e.name ? e.name : `entries[${j}]`, w = `${at} › ${n}`
      if (n !== e?.name) return errs.push(`${w}: "name" is missing`)
      if (seen.has(n.toLowerCase())) return errs.push(`${w}: listed twice`)
      seen.add(n.toLowerCase())
      if (!(e.kind in SYMBOLS) || isFlag(e.kind)) return errs.push(`${w}: unknown symbol kind "${e.kind}"`)
      if (!CATEGORIES.includes(e.category)) return errs.push(`${w}: unknown category "${e.category}" (one of ${CATEGORIES.join(', ')})`)
      if (!Array.isArray(e.pinMap) || !e.pinMap.every(Number.isInteger)) return errs.push(`${w}: "pinMap" must be a list of pin numbers`)
      const s = lib.subckts.find((x) => x.name.toLowerCase() === n.toLowerCase())
      if (!s) return void (lib.models.some((x) => x.name.toLowerCase() === n.toLowerCase()) || errs.push(`${w}: no .model or .subckt of that name in the file`))
      const want = e.kind === 'block' ? e.pinMap.length || -1 : SYMBOLS[e.kind as Kind].pins.length
      if (e.pinMap.length !== want || new Set(e.pinMap).size !== want || e.pinMap.some((k: number) => k < 0 || k >= s.pins.length))
        errs.push(`${w}: "pinMap" must map the symbol's ${e.kind === 'block' ? '' : want + ' '}pins to different subckt pins (0–${s.pins.length - 1})`)
    })
  })
  return errs
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

// Single-pole op-amp: gm into R||C (A0 = gm·R = 1e5 = 100 dB, GBW = gm/2πC), gain node clamped by diodes to `vh`
// inside each rail (default: output saturates ~1.2 V from the rails), unity buffer + Rout.
// Optional: slew limit (input stage current capped at SR·C via tanh), supply current iq (V+ to V-), and a tight
// clamp (rro: N = 0.2 diodes 0.135 V inside the rails, output swings to ~30 mV from them).
// ponytail: no offset, CMRR, input common-mode limits or output current limit; a vendor macromodel import covers those.
interface OpampOpts { gbw: number; rin: string; rout: string; slew?: number; iq?: string; rro?: boolean }
const opamp = (name: string, o: OpampOpts, description: string): LibEntry => {
  const cf = 1e-3 / (2 * Math.PI * o.gbw), c = cf.toPrecision(4), imax = o.slew && (o.slew * cf).toPrecision(4)
  const pins = ['inp', 'inn', 'vp', 'vn', 'out'], vh = o.rro ? '0.135' : '1.85'
  const text = `.subckt ${name} ${pins.join(' ')}
* in+ in- v+ v- out. Self-written single-pole macromodel, GBW ${o.gbw / 1e6} MHz${o.slew ? `, slew ${o.slew / 1e6} V/us` : ''}
Rin inp inn ${o.rin}
${imax ? `B1 0 n1 I=${imax}*tanh(V(inp,inn)*${(1e-3 / +imax).toPrecision(4)})` : 'G1 0 n1 inp inn 1m'}
R1 n1 0 100Meg
C1 n1 0 ${c}
Vh vp h DC ${vh}
Dh n1 h ${name}_CL
Vl l vn DC ${vh}
Dl l n1 ${name}_CL
E1 o 0 n1 0 1
Ro o out ${o.rout}${o.iq ? `\nIq vp vn DC ${o.iq}` : ''}
.model ${name}_CL D(IS=1e-15${o.rro ? ' N=0.2' : ''})
.ends ${name}`
  return {
    id: 'std:' + name, name, category: 'Op-amps', kind: 'opamp5', description, value: name,
    spice: { type: 'subckt', name, pins, pinMap: [0, 1, 2, 3, 4], text },
    params: {
      A0: '100 dB', GBW: `${o.gbw / 1e6} MHz`, ...(o.slew && { Slew: `${o.slew / 1e6} V/µs` }), Rin: o.rin, Rout: o.rout,
      ...(o.iq && { Iq: o.iq }), Swing: o.rro ? 'rail-to-rail (~30 mV)' : '±(Vs − 1.2 V)'
    },
    source: 'bundled'
  }
}

// defaults: subckt parameters with their defaults ("R=10k pos=0.5"); the instance value then overrides them
const subckt = (name: string, kind: Kind, category: Category, pins: string[], description: string, params: Record<string, string>, body: string, defaults = ''): LibEntry => ({
  id: 'std:' + name, name, category, kind, description, value: name, params, source: 'bundled',
  spice: { type: 'subckt', name, pins, pinMap: pins.map((_, i) => i), text: `.subckt ${name} ${pins.join(' ')}${defaults && ' params: ' + defaults}\n${body}\n.ends ${name}` }
})

// Comparator on the op-amp symbol (in+ in- V+ V- out): open-collector NPN to V-, needs a pull-up. Input tanh (±1 mV
// linear range) -> RC (τ 150 ns) -> output base drive; LM393-class figures.
const COMPARATOR = `* in+ in- v+ v- out. Self-written open-collector comparator
Rin inp inn 10Meg
B1 n1 0 V=0.5*(1-tanh(V(inp,inn)*1000))
R1 n1 n2 1k
C1 n2 0 150p
G1 vn b n2 0 0.2m
Rb b vn 20k
Qo out b vn CMP_OC_Q
Iq vp vn DC 0.4m
.model CMP_OC_Q NPN(IS=1e-14 BF=100 RB=10 RC=25 CJC=1p CJE=1p TF=1n)`

// TL431-style shunt reference: error gm (ref vs 2.495 V) drives an output NPN, cathode to anode; anode–cathode
// substrate diode; Rref models the ~2 µA ref input current.
// ponytail: DC/transient only: no minimum cathode current or open-loop frequency response.
const TL431 = `* cathode anode ref. Self-written shunt reference model, Vref 2.495 V
Vr r0 anode DC 2.495
Rref ref anode 1.25Meg
G1 anode b ref r0 50m
Rb b anode 10k
Db anode b TL431_D
Q1 cathode b anode TL431_Q
Ds anode cathode TL431_D
.model TL431_Q NPN(IS=1e-14 BF=100 VAF=100 RC=0.1)
.model TL431_D D(IS=1e-14)`

// 7805-style regulator: error gm (out vs 5 V) drives a Darlington-like pass NPN (NF=2) whose base is clamped
// 0.9 V - Vd below the input (dropout ≈ 2 V @ 1 A); Q2 across 0.3 Ω limits current at ~2.4 A; 4.5 mA quiescent.
// ponytail: no thermal shutdown, foldback or ripple-rejection rolloff.
const REG7805 = `* in gnd out. Self-written 5 V linear regulator model
Iq in gnd DC 4.5m
Vr r gnd DC 5
G1 in b r out 20m
Vh in h DC 0.9
Dh b h REG7805_D
Q1 in b e REG7805_QP
Rsc e out 0.33
Q2 b e out REG7805_QS
Rb b out 10k
Db out b REG7805_D
C1 b gnd 100p
.model REG7805_QP NPN(IS=1e-12 NF=2 BF=3000 RB=0.5)
.model REG7805_QS NPN(IS=1e-14 BF=100)
.model REG7805_D D(IS=1e-14)`

// Potentiometer: R split at the wiper, pos = travel from B (0) to A (1), clamped so neither half is 0 Ω
const POT = `* a w b. R = end-to-end resistance, pos = wiper position from B (0) to A (1)
.param p={min(max(pos,0.001),0.999)}
R1 a w {R*(1-p)}
R2 w b {R*p}`
// Quartz crystal: series motional L-C-R (L from F and Cm: series resonance at F) with shunt C0.
// ngspice .param expressions have no pi, hence 4π² written out.
const XTAL = `* 1 2. Butterworth–Van Dyke model: F = series resonance, Cm motional C, R motional (ESR), C0 shunt
L1 1 n1 {1/(39.4784176*F*F*Cm)}
C1 n1 n2 {Cm}
R1 n2 2 {R}
C0 1 2 {C0}`

export const BUNDLED: LibEntry[] = [
  generic('R', 'res', 'Passives', '1k', 'Resistor'),
  generic('C', 'cap', 'Passives', '1u', 'Capacitor'),
  generic('L', 'ind', 'Passives', '1m', 'Inductor'),
  { ...subckt('POT', 'pot', 'Passives', ['a', 'w', 'b'], 'Potentiometer: value R=<end-to-end> pos=<wiper 0…1 from B to A>',
    { R: '10k', pos: '0.5' }, POT, 'R=10k pos=0.5'), value: 'R=10k pos=0.5' },
  { ...subckt('XTAL', 'xtal', 'Passives', ['1', '2'], 'Quartz crystal (series RLC + C0): value F=<series resonance>, optional Cm R C0 (defaults 25f, 10 Ω, 5p)',
    { F: '10 MHz', Cm: '25 fF', R: '10 Ω', C0: '5 pF' }, XTAL, 'F=10meg Cm=25f R=10 C0=5p'), value: 'F=10meg' },
  generic('XFMR', 'xfmr', 'Passives', 'Lp=1m Ls=100u k=0.999', 'Transformer: two coupled inductors, turns ratio √(Lp/Ls); dots mark pri+ and sec+'),
  generic('K', 'kcouple', 'Passives', 'L1 L2 0.99', 'Mutual coupling between two inductors on the sheet: value <L> <L> <k>'),
  generic('T', 'tline', 'Passives', 'Z0=50 TD=1n', 'Lossless transmission line: Z0 impedance, TD delay (or F= NL=)'),
  generic('V', 'vsrc', 'Sources', 'DC 1', 'Voltage source (DC, AC, PULSE, SIN… spec in the value)'),
  generic('I', 'isrc', 'Sources', 'DC 1m', 'Current source (DC, AC, PULSE, SIN… spec in the value)'),
  generic('VCC', 'power', 'Sources', 'VCC', 'Power flag: a net label drawn as a supply rail; same-named flags join'),
  generic('E', 'vcvs', 'Controlled sources', '1', 'Voltage-controlled voltage source: V(out) = gain · V(ctrl)'),
  generic('G', 'vccs', 'Controlled sources', '1', 'Voltage-controlled current source: I(out) = gm · V(ctrl), flowing out+ → out- through the source'),
  generic('H', 'ccvs', 'Controlled sources', 'V1 1k', 'Current-controlled voltage source: value <V source> <transresistance>; senses the current through that V source'),
  generic('F', 'cccs', 'Controlled sources', 'V1 1', 'Current-controlled current source: value <V source> <gain>; senses the current through that V source'),
  generic('BV', 'bv', 'Controlled sources', 'V=1', 'Behavioural voltage source: value V=<expression>, e.g. V=V(a)*V(b)'),
  generic('BI', 'bi', 'Controlled sources', 'I=1m', 'Behavioural current source: value I=<expression>, e.g. I=V(in)/1k'),
  generic('S', 'sw', 'Switches', 'SW', 'Voltage-controlled switch: on when V(ctrl) > 0.5 V (default model SW: Ron 1 Ω, Roff 1 MΩ)'),
  generic('W', 'csw', 'Switches', 'V1 CSW', 'Current-controlled switch: value <V source> <model>; on above 1 mA (default model CSW: Ron 1 Ω, Roff 1 MΩ)'),

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
  // Self-written from datasheet key figures (no vendor model text). Zeners: BV at Izt, NBV sets the knee / Zzt.
  model('1N914', 'diode', 'Diodes', 'Small-signal switching diode, 100 V; self-written from datasheet figures: Vf ≈ 0.72 V @ 10 mA, Cj ≈ 2.5 pF, trr ≈ 4 ns',
    '.model 1N914 D(IS=2.5n N=1.85 RS=0.6 CJO=2.5p M=0.33 VJ=0.5 TT=4n BV=100 IBV=100n)'),
  model('BAT54', 'diode', 'Diodes', 'Small-signal Schottky, 30 V 200 mA; self-written from datasheet figures: Vf ≈ 0.29 V @ 1 mA, 0.37 V @ 10 mA, Cd ≈ 10 pF',
    '.model BAT54 D(IS=3.7e-8 N=1.1 RS=1.8 CJO=10p M=0.33 VJ=0.35 EG=0.69 XTI=2 TT=5n BV=30 IBV=2u)'),
  model('BAT85', 'diode', 'Diodes', 'Small-signal Schottky, 30 V 200 mA (DO-34); self-written from datasheet figures: Vf ≈ 0.29 V @ 1 mA, 0.37 V @ 10 mA, Cd ≈ 10 pF',
    '.model BAT85 D(IS=5e-8 N=1.1 RS=2 CJO=10p M=0.33 VJ=0.35 EG=0.69 XTI=2 TT=4n BV=30 IBV=2u)'),
  model('1N5408', 'diode', 'Diodes', 'General-purpose rectifier, 3 A 1000 V; self-written from datasheet figures: Vf ≈ 0.92 V @ 3 A (slow recovery)',
    '.model 1N5408 D(IS=10n N=1.7 RS=0.02 CJO=30p M=0.33 VJ=0.5 TT=3u BV=1000 IBV=10u)'),
  model('1N5822', 'diode', 'Diodes', 'Schottky rectifier, 3 A 40 V; self-written from datasheet figures: Vf ≈ 0.47 V @ 3 A, ≤ 0.95 V @ 9.4 A',
    '.model 1N5822 D(IS=40u N=1.1 RS=0.05 CJO=400p M=0.4 VJ=0.35 EG=0.69 XTI=2 BV=40 IBV=2m)'),
  model('UF4007', 'diode', 'Diodes', 'Ultrafast rectifier, 1 A 1000 V; self-written from datasheet figures: Vf ≈ 1.3 V @ 1 A, trr ≈ 50 ns (0.5 A / 1 A / 0.25 A)',
    '.model UF4007 D(IS=2e-10 N=2 RS=0.15 CJO=17p M=0.33 VJ=0.5 TT=130n BV=1000 IBV=10u)'),
  model('BZX55C3V3', 'zener', 'Diodes', 'Zener diode 500 mW; self-written from datasheet figures: 3.3 V @ 5 mA, Zzt ≈ 45 Ω (≤ 85 Ω)',
    '.model BZX55C3V3 D(IS=1p RS=2 CJO=200p M=0.33 BV=3.29 IBV=5m NBV=8)'),
  model('BZX55C5V6', 'zener', 'Diodes', 'Zener diode 500 mW; self-written from datasheet figures: 5.6 V @ 5 mA, Zzt ≈ 12 Ω (≤ 25 Ω)',
    '.model BZX55C5V6 D(IS=1p RS=2 CJO=150p M=0.33 BV=5.59 IBV=5m NBV=2)'),
  model('BZX55C12', 'zener', 'Diodes', 'Zener diode 500 mW; self-written from datasheet figures: 12 V @ 5 mA, Zzt ≈ 10 Ω (≤ 20 Ω)',
    '.model BZX55C12 D(IS=1p RS=2 CJO=60p M=0.33 BV=11.99 IBV=5m NBV=1.5)'),
  model('1N4728A', 'zener', 'Diodes', 'Zener diode 1 W; self-written from datasheet figures: 3.3 V @ 76 mA, Zzt ≈ 3 Ω (≤ 10 Ω)',
    '.model 1N4728A D(IS=1p RS=1 CJO=400p M=0.33 BV=3.22 IBV=76m NBV=5)'),
  model('1N4734A', 'zener', 'Diodes', 'Zener diode 1 W; self-written from datasheet figures: 5.6 V @ 45 mA, Zzt ≈ 2 Ω (≤ 5 Ω)',
    '.model 1N4734A D(IS=1p RS=1 CJO=250p M=0.33 BV=5.555 IBV=45m NBV=2)'),
  model('1N4742A', 'zener', 'Diodes', 'Zener diode 1 W; self-written from datasheet figures: 12 V @ 21 mA, Zzt ≈ 4.5 Ω (≤ 9 Ω)',
    '.model 1N4742A D(IS=1p RS=2 CJO=100p M=0.33 BV=11.96 IBV=21m NBV=2)'),
  model('LED_BLUE', 'led', 'Diodes', 'Blue LED (InGaN); self-written from typical figures: Vf ≈ 3.2 V @ 20 mA',
    '.model LED_BLUE D(IS=5e-17 N=3.5 RS=8 CJO=50p M=0.33 BV=5 IBV=10u)'),
  model('LED_WHITE', 'led', 'Diodes', 'White LED (blue die + phosphor); self-written from typical figures: Vf ≈ 3.25 V @ 20 mA',
    '.model LED_WHITE D(IS=3e-17 N=3.5 RS=8 CJO=50p M=0.33 BV=5 IBV=10u)'),
  model('LED_YELLOW', 'led', 'Diodes', 'Yellow LED; self-written from typical figures: Vf ≈ 2.05 V @ 20 mA',
    '.model LED_YELLOW D(IS=1e-18 N=2 RS=5 CJO=40p M=0.33 BV=5 IBV=10u)'),

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
  // Self-written Gummel-Poon models fitted to datasheet hFE / Vbe points (no breakdown modelled: mind the Vceo rating)
  model('BC547B', 'npn', 'BJTs', 'General-purpose NPN, 45 V 100 mA; self-written from datasheet figures: hFE ≈ 290 @ 2 mA (B group 200–450), fT ≈ 300 MHz',
    `.model BC547B NPN(IS=1.8e-14 BF=330 NF=1 VAF=70 IKF=0.1 ISE=2e-14 NE=1.5 BR=8 NR=1 VAR=20
+ RB=50 RC=1 RE=0.5 CJE=11p VJE=0.75 MJE=0.33 CJC=4p VJC=0.75 MJC=0.33
+ TF=0.5n XTF=2 VTF=4 ITF=0.2 TR=10n EG=1.11 XTI=3 XTB=1.5)`),
  model('BC557B', 'pnp', 'BJTs', 'General-purpose PNP (BC547B complement), −45 V −100 mA; self-written from datasheet figures: hFE ≈ 290 @ 2 mA (B group 220–475)',
    `.model BC557B PNP(IS=2e-14 BF=300 NF=1 VAF=40 IKF=0.08 ISE=2e-14 NE=1.5 BR=8 NR=1 VAR=20
+ RB=50 RC=1 RE=0.5 CJE=12p VJE=0.75 MJE=0.33 CJC=5p VJC=0.75 MJC=0.33
+ TF=0.6n XTF=2 VTF=4 ITF=0.2 TR=10n EG=1.11 XTI=3 XTB=1.5)`),
  model('BC337', 'npn', 'BJTs', 'Medium-power NPN, 45 V 800 mA; self-written from datasheet figures (-25 group): hFE ≈ 250 @ 100 mA, ≥ 60 @ 300 mA',
    `.model BC337 NPN(IS=4e-14 BF=300 NF=1 VAF=100 IKF=0.8 ISE=1e-13 NE=1.6 BR=10 NR=1 VAR=20
+ RB=5 RC=0.3 RE=0.1 CJE=50p VJE=0.75 MJE=0.33 CJC=12p VJC=0.75 MJC=0.33
+ TF=1.2n XTF=2 VTF=4 ITF=1 TR=50n EG=1.11 XTI=3 XTB=1.5)`),
  model('BC327', 'pnp', 'BJTs', 'Medium-power PNP (BC337 complement), −45 V −800 mA; self-written from datasheet figures (-25 group): hFE ≈ 250 @ 100 mA',
    `.model BC327 PNP(IS=5e-14 BF=290 NF=1 VAF=60 IKF=0.7 ISE=1e-13 NE=1.6 BR=10 NR=1 VAR=20
+ RB=5 RC=0.3 RE=0.1 CJE=60p VJE=0.75 MJE=0.33 CJC=15p VJC=0.75 MJC=0.33
+ TF=1.5n XTF=2 VTF=4 ITF=1 TR=50n EG=1.11 XTI=3 XTB=1.5)`),
  model('2N5551', 'npn', 'BJTs', 'High-voltage NPN, 160 V 600 mA; self-written from datasheet figures: hFE ≈ 150 @ 10 mA (80–250), Ccb ≈ 5 pF',
    `.model 2N5551 NPN(IS=2e-14 BF=170 NF=1 VAF=100 IKF=0.2 ISE=2e-14 NE=1.5 BR=5 NR=1 VAR=20
+ RB=10 RC=1.5 RE=0.2 CJE=20p VJE=0.75 MJE=0.33 CJC=5p VJC=0.75 MJC=0.33
+ TF=0.7n XTF=2 VTF=4 ITF=0.2 TR=0.5u EG=1.11 XTI=3 XTB=1.5)`),
  model('2N5401', 'pnp', 'BJTs', 'High-voltage PNP (2N5551 complement), −150 V −600 mA; self-written from datasheet figures: hFE ≈ 140 @ 10 mA (60–240)',
    `.model 2N5401 PNP(IS=2e-14 BF=160 NF=1 VAF=80 IKF=0.15 ISE=2e-14 NE=1.5 BR=5 NR=1 VAR=20
+ RB=10 RC=1.5 RE=0.2 CJE=25p VJE=0.75 MJE=0.33 CJC=6p VJC=0.75 MJC=0.33
+ TF=0.8n XTF=2 VTF=4 ITF=0.2 TR=0.5u EG=1.11 XTI=3 XTB=1.5)`),
  model('TIP31C', 'npn', 'BJTs', 'Power NPN, 100 V 3 A 40 W; self-written from datasheet figures: hFE ≈ 50 @ 1 A (≥ 25), 10–50 @ 3 A, Vbe ≤ 1.8 V @ 3 A',
    `.model TIP31C NPN(IS=1e-12 BF=100 NF=1 VAF=100 IKF=1.2 ISE=1e-11 NE=1.6 BR=5 NR=1 VAR=20
+ RB=5 RC=0.1 RE=0.05 CJE=300p VJE=0.75 MJE=0.33 CJC=100p VJC=0.75 MJC=0.33
+ TF=50n XTF=2 VTF=4 ITF=3 TR=1u EG=1.11 XTI=3 XTB=1.5)`),
  model('TIP32C', 'pnp', 'BJTs', 'Power PNP (TIP31C complement), −100 V −3 A 40 W; self-written from datasheet figures: hFE ≈ 50 @ 1 A (≥ 25), 10–50 @ 3 A',
    `.model TIP32C PNP(IS=1e-12 BF=100 NF=1 VAF=100 IKF=1.2 ISE=1e-11 NE=1.6 BR=5 NR=1 VAR=20
+ RB=5 RC=0.1 RE=0.05 CJE=300p VJE=0.75 MJE=0.33 CJC=120p VJC=0.75 MJC=0.33
+ TF=60n XTF=2 VTF=4 ITF=3 TR=1u EG=1.11 XTI=3 XTB=1.5)`),
  model('BD139', 'npn', 'BJTs', 'Medium-power NPN, 80 V 1.5 A; self-written from datasheet figures: hFE ≈ 100 @ 150 mA (40–250), ≥ 25 @ 500 mA',
    `.model BD139 NPN(IS=1e-13 BF=150 NF=1 VAF=100 IKF=0.6 ISE=1e-13 NE=1.5 BR=5 NR=1 VAR=20
+ RB=2 RC=0.1 RE=0.1 CJE=100p VJE=0.75 MJE=0.33 CJC=20p VJC=0.75 MJC=0.33
+ TF=1n XTF=2 VTF=4 ITF=1 TR=100n EG=1.11 XTI=3 XTB=1.5)`),
  model('BD140', 'pnp', 'BJTs', 'Medium-power PNP (BD139 complement), −80 V −1.5 A; self-written from datasheet figures: hFE ≈ 100 @ 150 mA (40–250)',
    `.model BD140 PNP(IS=1e-13 BF=150 NF=1 VAF=80 IKF=0.6 ISE=1e-13 NE=1.5 BR=5 NR=1 VAR=20
+ RB=2 RC=0.1 RE=0.1 CJE=100p VJE=0.75 MJE=0.33 CJC=30p VJC=0.75 MJC=0.33
+ TF=1.2n XTF=2 VTF=4 ITF=1 TR=100n EG=1.11 XTI=3 XTB=1.5)`),
  model('MPSA42', 'npn', 'BJTs', 'High-voltage NPN, 300 V 500 mA; self-written from datasheet figures: hFE ≈ 100 @ 10 mA (≥ 40), Ccb ≈ 3 pF, fT ≈ 50 MHz',
    `.model MPSA42 NPN(IS=1e-14 BF=120 NF=1 VAF=200 IKF=0.08 ISE=1e-13 NE=1.6 BR=5 NR=1 VAR=20
+ RB=20 RC=5 RE=0.5 CJE=25p VJE=0.75 MJE=0.33 CJC=3p VJC=0.75 MJC=0.33
+ TF=3n XTF=2 VTF=4 ITF=0.1 TR=1u EG=1.11 XTI=3 XTB=1.5)`),
  model('MPSA92', 'pnp', 'BJTs', 'High-voltage PNP (MPSA42 complement), −300 V −500 mA; self-written from datasheet figures: hFE ≈ 100 @ 10 mA (≥ 40), Ccb ≈ 6 pF',
    `.model MPSA92 PNP(IS=1e-14 BF=120 NF=1 VAF=150 IKF=0.08 ISE=1e-13 NE=1.6 BR=5 NR=1 VAR=20
+ RB=20 RC=5 RE=0.5 CJE=30p VJE=0.75 MJE=0.33 CJC=6p VJC=0.75 MJC=0.33
+ TF=3n XTF=2 VTF=4 ITF=0.1 TR=1u EG=1.11 XTI=3 XTB=1.5)`),
  model('2N4401', 'npn', 'BJTs', 'Switching NPN, 40 V 600 mA; self-written from datasheet figures: hFE ≈ 150 @ 150 mA (100–300), ≥ 80 @ 10 mA, fT ≈ 250 MHz',
    `.model 2N4401 NPN(IS=3e-14 BF=250 NF=1 VAF=90 IKF=0.4 ISE=3e-14 NE=1.5 BR=5 NR=1 VAR=20
+ RB=5 RC=0.5 RE=0.1 CJE=25p VJE=0.75 MJE=0.33 CJC=6p VJC=0.75 MJC=0.33
+ TF=0.6n XTF=2 VTF=4 ITF=0.5 TR=40n EG=1.11 XTI=3 XTB=1.5)`),
  model('2N4403', 'pnp', 'BJTs', 'Switching PNP (2N4401 complement), −40 V −600 mA; self-written from datasheet figures: hFE ≈ 150 @ 150 mA (100–300)',
    `.model 2N4403 PNP(IS=3e-14 BF=250 NF=1 VAF=60 IKF=0.35 ISE=3e-14 NE=1.5 BR=5 NR=1 VAR=20
+ RB=5 RC=0.5 RE=0.1 CJE=25p VJE=0.75 MJE=0.33 CJC=8p VJC=0.75 MJC=0.33
+ TF=0.8n XTF=2 VTF=4 ITF=0.5 TR=40n EG=1.11 XTI=3 XTB=1.5)`),

  // JFETs: Idss = BETA·VTO², pinch-off at VTO (ngspice wants VTO < 0 for PJF too)
  model('J201', 'njf', 'JFETs', 'Low-cutoff N-JFET; self-written from datasheet figures: Idss ≈ 0.6 mA (0.2–1 mA), Vgs(off) ≈ −0.8 V (−0.3…−1.5 V)',
    '.model J201 NJF(VTO=-0.8 BETA=0.9m LAMBDA=0.005 RD=20 RS=20 CGS=3p CGD=1.5p IS=1e-14)'),
  model('2N5457', 'njf', 'JFETs', 'General-purpose N-JFET; self-written from datasheet figures: Idss ≈ 3 mA (1–5 mA), Vgs(off) ≈ −1.8 V (−0.5…−6 V), gfs ≈ 3 mS',
    '.model 2N5457 NJF(VTO=-1.8 BETA=1m LAMBDA=0.005 RD=20 RS=20 CGS=4.5p CGD=2.5p IS=1e-14)'),
  model('BF245A', 'njf', 'JFETs', 'RF/general N-JFET; self-written from datasheet figures: Idss ≈ 4 mA (2–6.5 mA), Vgs ≈ −1.3 V @ 200 µA (−0.4…−2.2 V)',
    '.model BF245A NJF(VTO=-1.7 BETA=1.4m LAMBDA=0.01 RD=20 RS=20 CGS=3p CGD=1.2p IS=1e-14)'),
  model('J176', 'pjf', 'JFETs', 'P-JFET analog switch; self-written from datasheet figures: Idss ≈ −8 mA (−2…−25 mA), Vgs(off) ≈ 2.2 V (1–4 V), Rds(on) ≈ 150 Ω (≤ 250 Ω)',
    '.model J176 PJF(VTO=-2.2 BETA=1.8m LAMBDA=0.01 RD=10 RS=10 CGS=15p CGD=5p IS=1e-14)'),

  // level 1 with ngspice's default W = L = 100u, so CGSO/CGDO (F/m) × 100u = Cgs/Cgd
  model('2N7000', 'nmos', 'MOSFETs', 'Small-signal N-MOSFET, 60 V 200 mA, Vth ≈ 2.1 V, Rds(on) ≈ 2.3 Ω @ Vgs 10 V',
    '.model 2N7000 NMOS(LEVEL=1 VTO=2 KP=0.1 LAMBDA=0.01 RD=0.5 RS=0.5 CBD=25p CGSO=1.5e-7 CGDO=0.3e-7 IS=1e-14)'),
  model('BS250', 'pmos', 'MOSFETs', 'Small-signal P-MOSFET, −45 V −250 mA, Vth ≈ −2.4 V, Rds(on) ≈ 11 Ω @ Vgs −10 V',
    '.model BS250 PMOS(LEVEL=1 VTO=-2 KP=0.0125 LAMBDA=0.02 RD=0.5 RS=0.5 CBD=30p CGSO=5e-7 CGDO=0.8e-7 IS=1e-14)'),
  // VDMOS (ngspice's power MOSFET model, body diode included): generic self-written models matching key datasheet figures
  model('IRF540N', 'nmos', 'MOSFETs', 'Power N-MOSFET 100 V 33 A; generic self-written model matching key datasheet figures: Vth ≈ 3 V, Rds(on) ≈ 33 mΩ @ 10 V (≤ 44 mΩ), Ciss ≈ 1.9 nF',
    '.model IRF540N VDMOS(VTO=3 KP=20 LAMBDA=0.01 RD=20m RS=6m RG=2 IS=1e-11 N=1.3 RB=5m CJO=1n M=0.5 VJ=0.8 CGS=1.9n CGDMAX=1.5n CGDMIN=40p A=1 TT=100n BV=100 IBV=250u)'),
  model('IRF9540N', 'pmos', 'MOSFETs', 'Power P-MOSFET −100 V −23 A; generic self-written model matching key datasheet figures: Vth ≈ −3 V, Rds(on) ≈ 90 mΩ @ −10 V (≤ 117 mΩ)',
    '.model IRF9540N VDMOS(pchan VTO=-3 KP=10 LAMBDA=0.01 RD=60m RS=10m RG=3 IS=1e-11 N=1.3 RB=10m CJO=1n M=0.5 VJ=0.8 CGS=1.3n CGDMAX=1.2n CGDMIN=50p A=1 TT=100n BV=100 IBV=250u)'),
  model('IRLZ44N', 'nmos', 'MOSFETs', 'Logic-level power N-MOSFET 55 V 47 A; generic self-written model matching key datasheet figures: Vth ≈ 1.5 V, Rds(on) ≈ 20 mΩ @ 5 V (≤ 25 mΩ)',
    '.model IRLZ44N VDMOS(VTO=1.5 KP=40 LAMBDA=0.01 RD=12m RS=3m RG=2 IS=1e-11 N=1.3 RB=5m CJO=1.2n M=0.5 VJ=0.8 CGS=1.6n CGDMAX=1.5n CGDMIN=60p A=1 TT=80n BV=55 IBV=250u)'),
  model('BSS138', 'nmos', 'MOSFETs', 'Small-signal logic-level N-MOSFET 50 V 0.2 A (SOT-23); generic self-written model matching key datasheet figures: Vth ≈ 1.2 V, Rds(on) ≈ 0.7 Ω @ 10 V (≤ 3.5 Ω)',
    '.model BSS138 VDMOS(VTO=1.2 KP=1 LAMBDA=0.02 RD=0.4 RS=0.1 RG=5 IS=1e-13 N=1.1 CJO=15p M=0.5 VJ=0.8 CGS=25p CGDMAX=10p CGDMIN=2p A=1 BV=50 IBV=10u)'),
  model('BSS84', 'pmos', 'MOSFETs', 'Small-signal P-MOSFET −50 V −0.13 A (SOT-23); generic self-written model matching key datasheet figures: Vth ≈ −1.5 V, Rds(on) ≈ 2.5 Ω @ −5 V (≤ 10 Ω)',
    '.model BSS84 VDMOS(pchan VTO=-1.5 KP=0.3 LAMBDA=0.02 RD=1 RS=0.5 RG=5 IS=1e-13 N=1.1 CJO=15p M=0.5 VJ=0.8 CGS=20p CGDMAX=8p CGDMIN=2p A=1 BV=50 IBV=10u)'),
  model('AO3400', 'nmos', 'MOSFETs', 'Low-voltage N-MOSFET 30 V 5.7 A (SOT-23); generic self-written model matching key datasheet figures: Vth ≈ 1 V, Rds(on) ≈ 24 mΩ @ 4.5 V (≤ 32 mΩ)',
    '.model AO3400 VDMOS(VTO=1 KP=30 LAMBDA=0.02 RD=12m RS=3m RG=2 IS=1e-12 N=1.2 RB=10m CJO=150p M=0.5 VJ=0.8 CGS=600p CGDMAX=300p CGDMIN=30p A=1 BV=30 IBV=10u)'),

  generic('OPAMP', 'opamp', 'Op-amps', '1e6', 'Ideal op-amp: VCVS with gain 1e6, no supplies, no bandwidth or swing limits'),
  opamp('OA_GENERIC', { gbw: 1e6, rin: '2Meg', rout: '75' }, 'Generic op-amp macromodel: 100 dB, GBW 1 MHz, output swings to ~1.2 V from the rails'),
  opamp('OA_FAST', { gbw: 10e6, rin: '1Meg', rout: '50' }, 'Fast op-amp macromodel: 100 dB, GBW 10 MHz, output swings to ~1.2 V from the rails'),
  opamp('OA_LOWPOWER', { gbw: 1e6, rin: '10Meg', rout: '100', slew: 0.5e6, iq: '0.5m' },
    'Generic low-power op-amp macromodel (self-written): 100 dB, GBW 1 MHz, slew 0.5 V/µs, 0.5 mA supply, output swings to ~1.4 V from the rails (10 kΩ load)'),
  opamp('OA_RRO', { gbw: 1e6, rin: '1T', rout: '50', slew: 0.6e6, iq: '0.1m', rro: true },
    'Generic rail-to-rail-output CMOS op-amp macromodel (self-written): 100 dB, GBW 1 MHz, slew 0.6 V/µs, output within ~30 mV of the rails (10 kΩ load); input range not limited'),
  subckt('CMP_OC', 'opamp5', 'Comparators', ['inp', 'inn', 'vp', 'vn', 'out'],
    'Generic open-collector comparator (self-written, LM393-class figures): output sinks to V− when in− > in+ (needs a pull-up), Vol ≈ 0.2 V @ 4 mA, ~20 mA sink limit, delay ≈ 0.3 µs, 0.4 mA supply',
    { Vol: '0.2 V @ 4 mA', Isink: '~20 mA', Delay: '~0.3 µs', Iq: '0.4 mA' }, COMPARATOR),
  subckt('TL431', 'block', 'References', ['cathode', 'anode', 'ref'],
    'Adjustable shunt reference (TL431-style, self-written): regulates V(ref) to 2.495 V, Zka ≈ 0.2 Ω, Iref ≈ 2 µA; Vka = 2.495·(1 + R1/R2). DC/transient only, no minimum-current or frequency-response modelling',
    { Vref: '2.495 V', Zka: '~0.2 Ω', Iref: '~2 µA' }, TL431),
  subckt('7805', 'block', 'Regulators', ['in', 'gnd', 'out'],
    '5 V linear regulator (7805-style, self-written): 5 V ±2 %, dropout ≈ 2 V @ 1 A, current limit ≈ 2.4 A, quiescent 4.5 mA. No thermal shutdown',
    { Vout: '5 V', Dropout: '~2 V @ 1 A', Ilimit: '~2.4 A', Iq: '4.5 mA' }, REG7805),
  ...DIGITAL_PARTS // XSPICE gates and flip-flop (schematic/digital.ts)
]
