// Schematic -> SPICE netlist. Pure TS, follows the connectivity rules in model.ts.
// Hierarchy: blocks (Part.sheet) become `.subckt` definitions of their sheets, library parts
// (Part.lib) pull in their .model / .subckt text once.
import { busMembers, key, onSegment, pins, same, sheetPorts, wiresThrough, type Part, type Pt, type Sheet } from './model.ts'
import { SYMBOLS, isFlag } from './symbols.ts'
import { isDigital } from './digital.ts'
import { si, type LibEntry } from '../library/library.ts'

export interface NetlistResult {
  text: string // full netlist; '' when errors.length > 0
  errors: string[] // fatal: don't run ngspice
  warnings: string[] // shown, run proceeds
  nets: Record<string, string[]> // part id -> net per pin, SPICE pin order
  wireNets: Record<string, string> // wire id -> net
  refs: Record<string, string> // part id -> SPICE name as emitted (after auto-prefixing)
}
export interface NetCtx {
  sheets?: Record<string, Sheet> // project sheets by file name, for blocks
  lib?: (id: string) => LibEntry | undefined
}

const BAD = /^$|[\s=(),{}"']/ // illegal in SPICE node/element names
const MODELS: Record<string, string> = {
  d: '.model D D',
  dz: '.model DZ D(bv=5.1 ibv=1m)',
  led: '.model LED D(is=1e-20 n=1.8 rs=5)',
  npn: '.model NPN NPN',
  pnp: '.model PNP PNP',
  nmos: '.model NMOS NMOS (level=1 vto=0.7 kp=110u)',
  pmos: '.model PMOS PMOS (level=1 vto=-0.7 kp=50u)',
  njf: '.model NJF NJF (vto=-2 beta=1m)',
  pjf: '.model PJF PJF (vto=-2 beta=1m)', // SPICE JFET: VTO is negative for P-channel too
  sw: '.model SW SW(ron=1 roff=1meg vt=0.5 vh=0)',
  csw: '.model CSW CSW(ron=1 roff=1meg it=1m)'
}
const LINES = /\r\n?|\n/ // ngspice drops a CR, which could join two words into a keyword: a CR ends the line here
const ANALYSIS = /^\s*\.(op|tran|ac|dc|noise|tf|sens|pz|disto|sp|pss|control)\b/im

// state shared across the whole hierarchy
interface Global {
  ctx: NetCtx
  errors: string[]
  warnings: string[]
  libText: Map<string, string> // entry id / include path -> text, emitted once
  defs: Map<string, { id: string; sig: string }> // lib model/subckt name (lowercase) -> who defines it
  models: Set<string> // default models
  subs: Map<string, string> // sheet file -> subckt name
  subText: string[]
  names: Set<string> // subckt names taken (lowercase)
  chain: string[] // sheet files being netlisted, for cycle detection
  globals: Map<string, string> // power flags used on sub-sheets (lowercase -> as written): .global, so VCC is one net everywhere
  ground: boolean
}

export function netlist(s: Sheet, title?: string, ctx: NetCtx = {}): NetlistResult {
  const g: Global = {
    ctx, errors: [], warnings: [], libText: new Map(), defs: new Map(), models: new Set(), subs: new Map(), subText: [], names: new Set(), chain: [], globals: new Map(), ground: false
  }
  // lib subckt/model names can't be reused for sheet subckts
  for (const sh of [s, ...Object.values(ctx.sheets ?? {})])
    for (const p of sh.parts) {
      const n = p.lib && ctx.lib?.(p.lib)?.spice?.name
      if (n) g.names.add(n.toLowerCase())
    }
  const top = Object.keys(ctx.sheets ?? {}).find((f) => ctx.sheets![f] === s)
  if (top) g.chain.push(top)
  const r = sheet(s, g, null)
  const { errors, warnings } = g
  if (!r.parts) errors.push('Empty schematic: no parts to simulate')
  else if (!g.ground) errors.push('No ground: add a ground symbol (G) to the circuit')
  if (!ANALYSIS.test(r.directives)) warnings.push('No analysis directive (.op, .tran, .ac, .dc, …): ngspice will have nothing to run')
  const body = s.texts.flatMap((t) => t.text.split(LINES).filter((l) => !/^\s*\.end\s*$/i.test(l)))
  const glob = g.globals.size ? [`.global ${[...g.globals.values()].join(' ')}`] : []
  // the title is one comment line, whatever the file or project is called: a line break in it could start a "*#" line,
  // which ngspice runs as a command
  const text = errors.length ? '' : [`* ${(title ?? 'schematic').replace(/[\r\n]+/g, ' ')}`, ...glob, ...r.lines, ...body, ...g.libText.values(), ...g.subText, ...g.models, '.end', ''].join('\n')
  return { text, errors, warnings, nets: r.nets, wireNets: r.wireNets, refs: r.refs }
}

// Netlist one sheet. file = null for the top sheet; else it's a subckt whose ports name its pins.
function sheet(s: Sheet, g: Global, file: string | null) {
  const pre = file ? `${file}: ` : ''
  const err = (m: string) => g.errors.push(pre + m), warn = (m: string) => g.warnings.push(pre + m)
  const nets: Record<string, string[]> = {}, wireNets: Record<string, string> = {}, refs: Record<string, string> = {}

  // union-find over point keys; '@name' are virtual nodes joining same-named labels (and '@0' = ground)
  const up = new Map<string, string>()
  const find = (k: string): string => {
    const p = up.get(k) ?? k
    if (p === k) return k
    const r = find(p)
    up.set(k, r)
    return r
  }
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) up.set(ra, rb)
  }
  const through = wiresThrough(s.wires) // T-junctions: wire ends on another wire's middle
  for (const w of s.wires) {
    union(key(w.a), key(w.b))
    for (const e of [w.a, w.b]) for (const o of through(e)) if (o !== w) union(key(e), key(o.a))
  }
  // a pin joins whatever sits at its point; coincident pins share a key so they join for free
  const flagName = (p: Part) => (p.kind === 'gnd' || /^(0|gnd)$/i.test(p.value) ? '0' : p.value)
  const onBus = buses(s, err, warn), busLabel = (p: Part) => onBus.has(p.id) // names a bus's members, not a net
  for (const p of s.parts) {
    if (!isFlag(p.kind) || busLabel(p)) continue
    if (p.kind !== 'gnd' && BAD.test(p.value)) err(`Invalid net ${p.kind === 'port' ? 'port' : p.kind === 'power' ? 'power flag' : 'label'} "${p.value}": no spaces or =(),{}"' allowed`)
    union(key(pins(p)[0]), '@' + flagName(p).toLowerCase())
    // power flags are global like ground (a subckt's other nets are local to it); labels stay local to their sheet
    if (file && p.kind === 'power' && flagName(p) !== '0' && !BAD.test(p.value)) g.globals.set(p.value.toLowerCase(), p.value)
  }
  const portFlags = s.parts.filter((p) => p.kind === 'port')
  if (!file && portFlags.length) warn(`Top sheet has ports (${portFlags.map((p) => p.value).join(', ')}); they act as net labels here`)

  // name each net: ground, then (in a sub-sheet) its port, then labels (ngspice is case-insensitive, so compare lowercased)
  const labels = new Map<string, Map<string, string>>() // root -> lower -> display
  for (const p of s.parts) if (isFlag(p.kind) && !busLabel(p)) {
    const r = find(key(pins(p)[0])), n = flagName(p)
    if (!labels.has(r)) labels.set(r, new Map())
    if (!labels.get(r)!.has(n.toLowerCase())) labels.get(r)!.set(n.toLowerCase(), n)
  }
  const portNames = new Set(file ? portFlags.map((p) => flagName(p).toLowerCase()) : [])
  const name = new Map<string, string>(), used = new Set<string>()
  for (const [r, m] of labels) {
    const all = [...m.values()].sort()
    const n = m.has('0') ? '0' : all.find((x) => portNames.has(x.toLowerCase())) ?? all[0]
    if (all.length > 1) warn(`Net has several labels (${all.join(', ')}); using "${n}"`)
    name.set(r, n)
    used.add(n.toLowerCase())
  }
  // a subckt pin must be its own net, or its name won't appear on any element
  if (file) for (const p of portFlags) {
    const n = name.get(find(key(pins(p)[0])))!
    if (n.toLowerCase() !== p.value.toLowerCase()) err(`Port "${p.value}" is connected to ${n === '0' ? 'ground' : `port/net "${n}"`}; each port needs its own net`)
  }
  let seq = 0
  const netOf = (k: string) => {
    const r = find(k)
    if (!name.has(r)) {
      let n = ''
      do n = 'N' + String(++seq).padStart(3, '0')
      while (used.has(n.toLowerCase()))
      name.set(r, n)
    }
    return name.get(r)!
  }
  const pinCount = new Map<string, number>()
  for (const p of s.parts) {
    nets[p.id] = pins(p).map((q) => netOf(key(q)))
    for (const q of pins(p)) pinCount.set(find(key(q)), (pinCount.get(find(key(q))) ?? 0) + 1)
  }
  for (const w of s.wires) wireNets[w.id] = netOf(key(w.a))
  if ([...name.values()].includes('0')) g.ground = true

  // elements
  const lines: string[] = [], seen = new Set<string>()
  const directives = s.texts.map((t) => t.text).join('\n')
  const userModels = new Set([...directives.matchAll(/^\s*\.model\s+(\S+)/gim)].map((m) => m[1].toLowerCase()))
  const parts = s.parts.filter((p) => !isFlag(p.kind))
  // elements a F/H/W/K value names, checked once every ref is known; directive lines can define elements too
  const named: { ref: string; name: string; what: string }[] = []
  for (const l of directives.split(LINES)) if (/^\s*[a-z]/i.test(l)) seen.add(l.trim().split(/\s+/)[0].toLowerCase())
  const own = new Set<string>() // refs emitted by this sheet's parts (dup check; directive names may repeat)
  for (const p of parts) {
    const { prefix } = SYMBOLS[p.kind]
    let ref = p.name.trim()
    if (BAD.test(ref)) {
      err(`Invalid part name "${p.name}"`)
      continue
    }
    const entry = p.lib ? g.ctx.lib?.(p.lib) : undefined
    if (p.lib && !entry) err(`${ref}: unknown library part "${p.lib}"`)
    const spice = entry?.spice, sub = !!p.sheet || spice?.type === 'subckt'
    if ((p.kind === 'pot' || p.kind === 'xtal' || isDigital(p.kind)) && !sub) {
      err(`${ref}: place the ${SYMBOLS[p.kind].title.toLowerCase()} from the library (its subcircuit comes from there)`)
      continue
    }
    if (spice) {
      // two different library parts defining the same SPICE name: ngspice silently keeps the first definition for
      // both, so one part would simulate with the other's model. Same source (e.g. a pack part and its project copy) is fine.
      const k = spice.name.toLowerCase(), sig = spice.text ?? 'inc:' + ((spice.type === 'subckt' && spice.include) || '').split(/[\\/]/).pop()
      const d = g.defs.get(k)
      if (!d) g.defs.set(k, { id: entry!.id, sig })
      else if (d.sig !== sig) err(`${ref}: "${spice.name}" is defined by two different library parts (${d.id} and ${entry!.id}); ngspice would use one model for both — use the same library part for both, or pick a differently named one`)
    }
    const want = sub ? 'X' : prefix
    if (p.kind !== 'xfmr' && ref[0].toUpperCase() !== want) { // xfmr: no element of its own, any name
      // a library subckt placed with e.g. the npn symbol is named Q1: becoming XQ1 is expected, not worth a warning
      if (!(sub && prefix !== 'X')) warn(`${ref}: SPICE needs names starting with "${want}", using ${want + ref}`)
      ref = want + ref
    }
    const mine = p.kind === 'xfmr' ? [ref, `L${ref}_P`, `L${ref}_S`, `K${ref}`] : [ref]
    for (const r of mine) {
      if (own.has(r.toLowerCase())) err(`Duplicate part name ${r}`)
      own.add(r.toLowerCase()), seen.add(r.toLowerCase())
    }
    refs[p.id] = ref
    // a block that is neither a sheet nor a library part: an imported symbol that wasn't converted (importer.ts)
    if (p.kind === 'block' && !p.sheet && !p.lib) {
      err(`${ref}: placeholder for the imported part "${p.value.replace(/^\?/, '')}": replace it with a real part`)
      continue
    }
    const value = p.value.trim().replace(/\s+/g, ' ')
    const n = nets[p.id]
    pins(p).forEach((q, i) => {
      if (pinCount.get(find(key(q))) === 1) warn(`${ref} pin ${p.pins ? `"${p.pins[i].name}"` : i + 1} is unconnected`)
    })

    if (p.sheet) {
      const r = block(p, ref, n, g, err)
      if (r) lines.push(r)
      continue
    }
    if (spice?.type === 'subckt') {
      const nodes: string[] = []
      spice.pinMap.forEach((j, i) => (nodes[j] = n[i]))
      // the value may carry instance parameters ("R=10k pos=0.3", optionally after the subckt name / "params:")
      const t = value.split(' ').filter(Boolean)
      if (t[0]?.toLowerCase() === spice.name.toLowerCase()) t.shift()
      if (/^params:$/i.test(t[0] ?? '')) t.shift()
      if (spice.pins.some((_, j) => nodes[j] == null) || spice.pinMap.length !== n.length)
        err(`${ref}: pin map of "${entry!.name}" doesn't cover its ${spice.pins.length} subckt pins`)
      else if (t.some((x) => !/^[a-z_]\w*=\S+$/i.test(x))) err(`${ref}: value "${value}" must be ${entry!.name} parameters as name=value pairs`)
      else lines.push(`${ref} ${nodes.join(' ')} ${spice.name}${t.length ? ' params: ' + t.join(' ') : ''}`)
      if (spice.text) g.libText.set(entry!.id, spice.text)
      else if (spice.include) g.libText.set('inc:' + spice.include, `.include ${/\s/.test(spice.include) ? `"${spice.include}"` : spice.include}`)
      continue
    }
    if (!value) {
      err(`${ref} has no value`)
      continue
    }
    const t = value.split(' ')
    if (p.kind === 'xfmr') {
      const x = xfmr(value)
      if (typeof x === 'string') err(`${ref}: ${x}`)
      else lines.push(`L${ref}_P ${n[0]} ${n[1]} ${x.lp}`, `L${ref}_S ${n[2]} ${n[3]} ${x.ls}`, `K${ref} L${ref}_P L${ref}_S ${x.k}`)
      continue
    }
    if (p.kind === 'kcouple') {
      if (t.length !== 3) err(`${ref}: value "${value}" must be "<inductor> <inductor> <k>", e.g. L1 L2 0.99`)
      else named.push({ ref, name: t[0], what: 'inductor' }, { ref, name: t[1], what: 'inductor' }), lines.push(`${ref} ${value}`)
      continue
    }
    if (p.kind === 'ccvs' || p.kind === 'cccs' || p.kind === 'csw') {
      if (t.length < 2) err(`${ref}: value "${value}" must be "<V source> <${p.kind === 'csw' ? 'model' : 'gain'}>", e.g. V1 ${p.kind === 'csw' ? 'CSW' : '10'}`)
      else if (!/^poly\(/i.test(t[0])) named.push({ ref, name: t[0], what: 'controlling voltage source' })
    }
    const v = (p.kind === 'bv' || p.kind === 'bi') && !/^[vi]\s*=/i.test(value) ? (p.kind === 'bv' ? 'V=' : 'I=') + value : value
    const nodes = p.kind === 'opamp' ? [n[0], '0', n[1], n[2]] : p.kind === 'nmos' || p.kind === 'pmos' ? [...n, n[2]] : n
    lines.push(`${ref} ${nodes.join(' ')} ${v}`)
    const m = (prefix === 'W' ? t[1] ?? '' : t[0]).toLowerCase()
    if (spice) g.libText.set(entry!.id, spice.text)
    // defaults go after the directives: ngspice keeps the first .model, so user/.include'd models of the same name win
    else if (/^[DQMJSW]$/.test(prefix) && MODELS[m] && !userModels.has(m)) g.models.add(MODELS[m])
  }
  // ponytail: names only checked on this sheet (+ its directives); an element in another sheet or an .include warns falsely
  for (const { ref, name, what } of named) if (!seen.has(name.toLowerCase())) warn(`${ref}: ${what} "${name}" is not on this sheet`)
  return { lines, directives, parts: parts.length, nets, wireNets, refs }
}

// Buses carry names only: segments join at their ends and T's, a bus label (D[0..7]) on a bus gives it members, and a
// bus tap joins its wire to the member net named by its value (like a net label, so members connect by name across
// buses and labels). A label named like D[0..7] is a bus label only when it sits on a bus; elsewhere it is an ordinary
// net label, as it always was. Checks that taps sit on a bus and name one of its members; returns the bus labels' ids.
function buses(s: Sheet, err: (m: string) => void, warn: (m: string) => void): Set<string> {
  const bs = s.buses ?? [], up = bs.map((_, i) => i)
  const g = (i: number): number => (up[i] === i ? i : (up[i] = g(up[i])))
  bs.forEach((w, i) => bs.forEach((o, j) => {
    if (i < j && ([w.a, w.b].some((q) => same(q, o.a) || same(q, o.b) || onSegment(o, q)) || [o.a, o.b].some((q) => onSegment(w, q)))) up[g(i)] = g(j)
  }))
  const at = (q: Pt) => { const i = bs.findIndex((w) => same(w.a, q) || same(w.b, q) || onSegment(w, q)); return i < 0 ? -1 : g(i) }
  const members = new Map<number, Set<string>>(), labels = new Map<number, string[]>(), ids = new Set<string>()
  for (const p of s.parts) {
    const i = p.kind === 'label' && busMembers(p.value) ? at(pins(p)[0]) : -1
    if (i < 0) continue
    ids.add(p.id)
    members.set(i, new Set([...(members.get(i) ?? []), ...busMembers(p.value)!.map((m) => m.toLowerCase())]))
    labels.set(i, [...(labels.get(i) ?? []), p.value])
  }
  for (const p of s.parts) {
    if (p.kind !== 'bustap') continue
    const i = at(p)
    if (i < 0) warn(`Bus tap "${p.value}" isn't on a bus; it still joins net "${p.value}"`)
    else if (members.has(i) && !members.get(i)!.has(p.value.toLowerCase())) err(`Bus tap "${p.value}" isn't a member of bus ${labels.get(i)!.join(', ')}`)
  }
  return ids
}

// Transformer value "Lp=1m Ls=100u k=0.999" (any order, case-insensitive); an error message if malformed
function xfmr(value: string): { lp: string; ls: string; k: string } | string {
  const kv: Record<string, string> = {}
  for (const tok of value.split(' ')) {
    const m = /^(lp|ls|k)=(\S+)$/i.exec(tok)
    if (!m) return `value "${value}" must be Lp=<H> Ls=<H> k=<0…1>, e.g. Lp=1m Ls=100u k=0.999 ("${tok}" isn't one of them)`
    kv[m[1].toLowerCase()] = m[2]
  }
  const miss = ['Lp', 'Ls', 'k'].filter((x) => !kv[x.toLowerCase()])
  if (miss.length) return `value "${value}" is missing ${miss.join(', ')} (Lp=<H> Ls=<H> k=<0…1>)`
  const expr = (x: string) => /^\{.*\}$/.test(x) // .param expression: ngspice checks it
  for (const x of ['lp', 'ls']) if (!expr(kv[x]) && !(si(kv[x]) > 0)) return `${x === 'lp' ? 'Lp' : 'Ls'}=${kv[x]} must be a positive inductance`
  if (!expr(kv.k) && !(si(kv.k) > 0 && si(kv.k) <= 1)) return `k=${kv.k} must be a coupling factor in (0, 1]`
  return { lp: kv.lp, ls: kv.ls, k: kv.k }
}

// X line for a block; netlists its sheet as a .subckt the first time it's used.
function block(p: Part, ref: string, n: string[], g: Global, err: (m: string) => void): string | null {
  const file = p.sheet!, s = g.ctx.sheets?.[file]
  if (!s) return void err(`${ref}: sheet "${file}" not found`), null
  const ports = sheetPorts(s), mine = (p.pins ?? []).map((q) => q.name)
  const norm = (a: string[]) => a.map((x) => x.toLowerCase()).sort().join(',')
  if (norm(ports) !== norm(mine))
    return void err(`${ref}: pins (${mine.join(', ') || 'none'}) don't match the ports of "${file}" (${ports.join(', ') || 'none'}); update the block`), null
  if (g.chain.includes(file)) return void err(`Hierarchy cycle: ${[...g.chain, file].join(' → ')}`), null
  let name = g.subs.get(file)
  if (!name) {
    const base = file.replace(/^.*\//, '').replace(/\.nsch$/i, '').replace(/[^A-Za-z0-9_]/g, '_') || 'sheet'
    name = base
    for (let i = 2; g.names.has(name.toLowerCase()); i++) name = `${base}_${i}`
    g.names.add(name.toLowerCase())
    g.subs.set(file, name)
    g.chain.push(file)
    const r = sheet(s, g, file)
    g.chain.pop()
    const pre = `${file}: `
    // analysis belongs to the top sheet; drop it (and .control blocks) here
    const body: string[] = []
    let ctl = false, dropped = false
    for (const l of s.texts.flatMap((t) => t.text.split(LINES))) {
      if (/^\s*\.control\b/i.test(l)) ctl = true
      if (ctl || ANALYSIS.test(l)) {
        dropped = true
        if (/^\s*\.endc\b/i.test(l)) ctl = false
      } else if (!/^\s*\.end\s*$/i.test(l)) body.push(l)
    }
    if (dropped) g.warnings.push(pre + 'Analysis directives ignored: only the top sheet\'s analyses run')
    g.subText.push(`.subckt ${name} ${ports.join(' ')}`, ...r.lines, ...body, `.ends ${name}`)
  }
  const at = new Map(mine.map((x, i) => [x.toLowerCase(), n[i]]))
  return `${ref} ${ports.map((x) => at.get(x.toLowerCase())).join(' ')} ${name}`
}
