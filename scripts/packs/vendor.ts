// Vendor packs: Zetex discretes (library-packs/vendor-zetex) and National Semiconductor op-amps/comparators
// (library-packs/vendor-natsemi). Files are copied byte-identical (their notices permit copying intact / distribution).
// usage: node scripts/packs/vendor.ts <srcDir>
//   <srcDir>/sources.json: { "<packId>": [{ "path": "<srcDir-relative file>", "url": "...", "retrieved": "YYYY-MM-DD" }] }
// Each candidate entry is simulated in ngspice plain mode (-b -n, no compat flags); failures are dropped and listed
// in BUILD.md. Deterministic for a given source dir + ngspice version.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLibFile, suggest, type Category, type ImportedLib, type ParsedLib } from '../../src/renderer/src/library/library.ts'
import type { Kind } from '../../src/renderer/src/schematic/symbols.ts'

type Entry = ImportedLib['entries'][number]
type Src = { path: string; url: string; retrieved: string }

// ---------------------------------------------------------------------------------------------- pin roles

const flat = (t: string) => t.split(/\r?\n/).map((l) => l.replace(/^\s*\*+/, '')).join(' ').replace(/\s+/g, ' ')

// National "connections" header above a .SUBCKT: label k sits after k '|' marks. Returns roles in subckt pin order.
export function nsRoles(text: string, name: string): string[] | undefined {
  const lines = text.split(/\r?\n/), at = lines.findIndex((l) => new RegExp(`^\\s*\\.subckt\\s+${name.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s`, 'i').test(l))
  if (at < 0) return
  let from = at - 1
  while (from >= 0 && from > at - 16 && /^\s*\*/.test(lines[from]) && !/connections/i.test(lines[from])) from--
  if (!/connections/i.test(lines[from] ?? '')) return
  const roles: string[] = []
  for (let i = from; i < at; i++) {
    const l = lines[i].replace(/^\s*\*/, '').replace(/connections:?/i, (m) => ' '.repeat(m.length))
    const label = l.replace(/^[\s|]*/, '').trim()
    if (label) roles[(l.match(/\|/g) ?? []).length] = label.toLowerCase()
  }
  return roles.length && !roles.includes(undefined as never) ? roles : undefined
}

const ROLE: [string, RegExp][] = [
  ['inp', /^non|positive input|^i_in\(\+\)/], ['inn', /inverting|negative input|^i_in\(-\)/],
  ['vp', /positive power|^\+vcc|^vcc|^vdd/], ['vn', /negative power|^-vee|^-vcc|^vee/], ['out', /^output/],
  ['gnd', /^ground/], ['iset', /current set/], ['sd', /shutdown/], ['dis', /vdis/], ['comp', /compensation/], ['in', /^input$/]
]
export const role = (label: string) => ROLE.find(([, re]) => re.test(label))?.[0]

// Zetex: pin legend 'D G S' / 'C B E' / 'DRAIN GATE SOURCE' next to the .SUBCKT line, else the lone Q element's nodes
function zxPins(sub: { pins: string[]; text: string }): string[] | undefined {
  const lines = sub.text.split(/\r?\n/).slice(1, 4)
  for (const l of lines) {
    if (!/^\s*\*/.test(l)) continue
    const w = l.replace(/^\s*\*|nodes:?|pins|connections|[_-]/gi, ' ').trim().toUpperCase().split(/\s+/).map((t) => t[0])
    const is = (set: string) => w.length === sub.pins.length && new Set(w).size === 3 && w.every((c) => set.includes(c))
    if (is('DGS') || is('CBE')) return w
  }
  const q = sub.text.split(/\r?\n/).filter((l) => /^\s*Q\w*\s/i.test(l))
  if (q.length === 1) {
    const n = q[0].trim().split(/\s+/).slice(1, 4), w = sub.pins.map((p) => 'CBE'[n.indexOf(p)])
    if (w.every(Boolean) && new Set(w).size === 3) return w
  }
}

// polarity of a discrete subckt: the model type named on its first Q/M line (models inside it, else at file level)
function polarity(sub: { text: string }, file: ParsedLib): Kind | undefined {
  const types = new Map(file.models.map((m) => [m.name.toLowerCase(), m.type.toLowerCase()]))
  for (const [, n, t] of sub.text.matchAll(/\.model\s+(\S+)\s+([a-z]+)/gi)) types.set(n.toLowerCase(), t.toLowerCase())
  const dev = sub.text.split(/\r?\n/).find((l) => /^\s*[QM]/i.test(l))
  const t = dev?.trim().toLowerCase().split(/\s+/).map((x) => types.get(x)).find(Boolean)
  return t && ['npn', 'pnp', 'nmos', 'pmos'].includes(t) ? (t as Kind) : undefined
}

// Zetex ICs with a pin legend, placed as blocks: shunt reference (Vz Vref Gnd) and LDOs (GND EN VIN VOUT)
const ZX_IC: [RegExp, string, Category, string[]][] = [
  [/^zr431/i, 'connections vz vref gnd', 'References', ['k', 'ref', 'a']],
  [/^zxcl\d/i, 'nodes: gnd en vin vout', 'Regulators', ['gnd', 'en', 'vin', 'vout']]
]

// ---------------------------------------------------------------------------------------------- mapping

export interface Mapped { entry: Entry; roles?: string[]; supply?: Supply }
type Supply = { vp: number; vn: number; vin: number }

// National op-amp supplies: CMOS (LMC/LPC) and LM7131 on 0/5 V, LM6xxx/LM71xx high-speed on ±5 V, the rest ±12 V
export const nsSupply = (name: string): Supply =>
  /^(lmc|lpc|lm7131)/i.test(name) ? { vp: 5, vn: 0, vin: 2.5 } : /^lm(6|71)/i.test(name) ? { vp: 5, vn: -5, vin: 0.5 } : { vp: 12, vn: -12, vin: 0.5 }

const OA_ORDER = ['inp', 'inn', 'vp', 'vn', 'out'] // opamp5 symbol pin order

export function mapNatsemi(text: string): { ok: Mapped[]; skip: { name: string; why: string }[] } {
  const ok: Mapped[] = [], skip: { name: string; why: string }[] = []
  const comparator = /comparator/i.test(text)
  for (const s of parseLibFile(text).subckts) {
    const labels = nsRoles(text, s.name), roles = labels?.map(role)
    if (!roles || roles.length !== s.pins.length || roles.includes(undefined)) {
      skip.push({ name: s.name, why: `${s.pins.length}-pin part without a recognised connections header (${labels?.join(', ') ?? 'none'})` })
      continue
    }
    const supply = nsSupply(s.name), category: Category = comparator ? 'Comparators' : 'Op-amps'
    if (s.pins.length === 5 && OA_ORDER.every((r) => roles.includes(r)))
      ok.push({ entry: { name: s.name, kind: 'opamp5', category, pinMap: OA_ORDER.map((r) => roles.indexOf(r)) }, roles: roles as string[], supply })
    else if (['inp', 'inn', 'vp', 'vn', 'out'].every((r) => roles.includes(r)) || ['in', 'vp', 'vn', 'out'].every((r) => roles.includes(r)))
      ok.push({ entry: { name: s.name, kind: 'block', category, pinMap: s.pins.map((_, i) => i) }, roles: roles as string[], supply })
    else skip.push({ name: s.name, why: `multi-function part (${labels!.join(', ')}): no generic symbol or test` })
  }
  return { ok, skip }
}

export function mapZetex(text: string): { ok: Mapped[]; skip: { name: string; why: string }[] } {
  const p = parseLibFile(text), ok: Mapped[] = [], skip: { name: string; why: string }[] = []
  const sug = suggest(p), zener = /zener/i.test(text)
  const used = (n: string) => p.subckts.some((s) => new RegExp(`\\s${n.replace(/[^\w]/g, '\\$&')}(\\s|$)`, 'im').test(s.text))
  for (const m of p.models) {
    const e = sug.find((x) => x.name === m.name)
    if (!e || used(m.name)) continue // helper model of a subckt in the same file
    ok.push({ entry: e.kind === 'diode' && zener ? { ...e, kind: 'zener' } : e })
  }
  for (const s of p.subckts) {
    const ic = ZX_IC.find(([re, legend, , r]) => re.test(s.name) && flat(s.text).toLowerCase().includes(legend) && r.length === s.pins.length)
    if (ic) {
      ok.push({ entry: { name: s.name, kind: 'block', category: ic[2], pinMap: s.pins.map((_, i) => i) }, roles: ic[3] })
      continue
    }
    const pol = polarity(s, p), w = zxPins(s)
    if (s.pins.length === 3 && pol && w) {
      const order = pol === 'npn' || pol === 'pnp' ? 'CBE' : 'DGS'
      if (order.split('').every((c) => w.includes(c))) {
        ok.push({ entry: { name: s.name, kind: pol, category: pol.endsWith('mos') ? 'MOSFETs' : 'BJTs', pinMap: order.split('').map((c) => w.indexOf(c)) } })
        continue
      }
    }
    if (s.pins.length === 2 && /^\s*D\w*\s/im.test(s.text)) {
      ok.push({ entry: { name: s.name, kind: zener ? 'zener' : 'diode', category: 'Diodes', pinMap: [0, 1] } })
      continue
    }
    skip.push({ name: s.name, why: `${s.pins.length}-pin subckt (${s.pins.join(' ')}): no single-device symbol/pin legend` })
  }
  return { ok, skip }
}

// ---------------------------------------------------------------------------------------------- benches

const NG = process.env.NGSPICE ?? 'ngspice'

// circuit + pass check for one entry; `inc` is the absolute path of its library file
export function bench(m: Mapped, text: string, inc: string): { cir: string; probes: string[]; pass: (v: number[]) => string | null } {
  const { name, kind, pinMap } = m.entry
  const model = parseLibFile(text).models.find((x) => x.name === name)
  const lib = model ? model.text : `.include "${inc}"`
  const el = (ref: string, nets: string[]) => {
    if (!model) {
      const o: string[] = []
      pinMap.forEach((j, i) => (o[j] = nets[i]))
      return `X${ref} ${o.join(' ')} ${name}`
    }
    const pre = kind === 'npn' || kind === 'pnp' ? 'Q' : kind === 'nmos' || kind === 'pmos' ? 'M' : 'D'
    return `${pre}${ref} ${nets.join(' ')}${pre === 'M' ? ' ' + nets[2] : ''} ${name}`
  }
  const range = (v: number, lo: number, hi: number, what: string) => (v > lo && v < hi ? null : `${what} = ${v.toPrecision(4)} outside (${lo}, ${hi})`)
  let body: string[], probes: string[], pass: (v: number[]) => string | null
  switch (kind) {
    case 'diode': case 'led':
      body = ['I1 0 a DC 10m', el('1', ['a', '0'])], probes = ['v(a)'], pass = ([v]) => range(v, 0.05, 4.5, 'Vf @ 10 mA')
      break
    case 'zener':
      body = ['I1 0 k DC 5m', el('1', ['0', 'k'])], probes = ['v(k)'], pass = ([v]) => range(v, 1, 250, 'Vz @ 5 mA')
      break
    case 'npn': case 'pnp': {
      const n = kind === 'npn'
      body = ['Vcc vcc 0 5', n ? 'Rc vcc c 100' : 'Rc c 0 100', n ? 'Rb vcc b 43k' : 'Rb b 0 43k', el('1', n ? ['c', 'b', '0'] : ['c', 'b', 'vcc'])]
      probes = n ? ['v(b)', '5-v(c)'] : ['5-v(b)', 'v(c)']
      pass = ([vbe, vrc]) => range(vbe, 0.3, 2.0, '|Vbe|') ?? range(vrc, 0.05, 5, 'Ic·100Ω (Ib ≈ 100 µA, hFE > 5)')
      break
    }
    case 'nmos': case 'pmos': {
      const n = kind === 'nmos' // on at |Vgs| = 10 V into 100 Ω, off at Vgs = 0 into 100k
      body = n ? ['Vdd vdd 0 10', 'Rd vdd d 100', el('1', ['d', 'vdd', '0']), 'Rd2 vdd d2 100k', el('2', ['d2', '0', '0'])]
        : ['Vdd vdd 0 10', 'Rd d 0 100', el('1', ['d', '0', 'vdd']), 'Rd2 d2 0 100k', el('2', ['d2', 'vdd', 'vdd'])]
      probes = n ? ['10-v(d)', '10-v(d2)'] : ['v(d)', 'v(d2)']
      pass = ([on, off]) => range(on, 0.05, 10, 'on: Id·100Ω') ?? range(off, -1, 1, 'off: Id·100k')
      break
    }
    default: { // opamp5 / block: roles say which subckt pin is which
      const r = m.roles!, ref = m.entry.category === 'References'
      if (ref || m.entry.category === 'Regulators') { // shunt ref with Vref tied to Vz via 1k from 10 V; LDO 5 V in, 1k load
        const net: Record<string, string> = { k: 'k', ref: 'k', a: '0', gnd: '0', en: 'vin', vin: 'vin', vout: 'o' }
        const nom = ref ? (/431l/i.test(name) ? 1.24 : 2.5) : +(/^zxcl(\d)(\d)/i.exec(name)?.slice(1).join('.') ?? NaN)
        body = [ref ? 'Vs vs 0 10' : 'Vin vin 0 5', ref ? 'R1 vs k 1k' : 'RL o 0 1k', `X1 ${r.map((x) => net[x]).join(' ')} ${name}`]
        probes = [ref ? 'v(k)' : 'v(o)']
        pass = ([v]) => range(v, nom * 0.95, nom * 1.05, ref ? 'Vref @ 7.5 mA' : 'Vout @ 1 kΩ load')
        break
      }
      const { vp, vn, vin } = m.supply!, cmp = m.entry.category === 'Comparators'
      const nets = (k: number) => r.map((x) => ({ inp: cmp ? `p${k}` : 'in', inn: cmp ? 'ref' : `o${k}`, in: 'in', vp: 'vp', vn: 'vn', out: `o${k}`, gnd: '0', iset: `is${k}`, sd: 'vp', dis: 'vp', comp: `c${k}` })[x]!)
      const x = (k: number) => {
        const o = nets(k)
        return [`X${k} ${o.join(' ')} ${name}`, ...(r.includes('iset') ? [`Ris${k} is${k} vn 1Meg`] : []), ...(r.includes('comp') ? [`Rc${k} c${k} 0 1G`] : [])]
      }
      const supplies = [`Vp vp 0 ${vp}`, `Vn vn 0 ${vn}`]
      if (cmp) { // two copies: in+ above / below ref; 10k pull-up covers open-collector/drain outputs
        const ref = (vp + Math.max(vn, 0)) / 2
        body = [...supplies, `Vr ref 0 ${ref}`, `V1 p1 0 ${ref + 0.1}`, `V2 p2 0 ${ref - 0.1}`, ...x(1), ...x(2), 'Rp1 o1 vp 10k', 'Rp2 o2 vp 10k']
        probes = ['v(o1)', 'v(o2)']
        pass = ([hi, lo]) => range(hi, ref + 0.5, vp + 0.5, 'out (in+ > in-)') ?? range(lo, vn - 0.5, ref - 0.5, 'out (in+ < in-)')
      } else { // unity follower (a buffer's input is driven directly)
        body = [...supplies, `Vin in 0 ${vin}`, ...x(1), 'RL o1 0 10k']
        probes = ['v(o1)']
        pass = ([v]) => range(v - vin, -0.05, 0.05, 'follower error')
      }
    }
  }
  return { cir: [`* bench ${name}`, lib, ...body, '.control', 'op', ...probes.map((p) => `print ${p}`), '.endc', '.end', ''].join('\n'), probes, pass }
}

// run a bench; null = pass, else the reason
export function simulate(b: ReturnType<typeof bench>): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'vpack-'))
  try {
    writeFileSync(join(dir, 'c.cir'), b.cir)
    const r = spawnSync(NG, ['-b', '-n', 'c.cir'], { cwd: dir, encoding: 'utf8', timeout: 30000 })
    if (r.error) throw r.error
    const log = (r.stdout ?? '') + (r.stderr ?? '')
    const v = [...log.matchAll(/^(?!Doing )\S.* = ([-+0-9.eE]+)\s*$/gm)].map((m) => +m[1])
    if (v.length !== b.probes.length || v.some(isNaN))
      return 'no result: ' + (/^.*(error|fatal|singular|unknown|not found).*(\n.*){0,2}/im.exec(log)?.[0].replace(/\s+/g, ' ') ?? `ngspice exit ${r.status}`).trim().slice(0, 160)
    return b.pass(v)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------------------------- packs

interface PackDef {
  id: string; name: string; description: string; license: string; source: string
  permit: RegExp // the redistribution sentence every file must carry (matched on comment-flattened text)
  notice: (lines: string[]) => [number, number] | undefined // line span of the notice block
  map: (text: string) => ReturnType<typeof mapZetex>
  header: string
  sources: string[] // BUILD.md: where the files came from and what was passed over
}

const span = (lines: string[], from: RegExp, to: (l: string, i: number) => boolean): [number, number] | undefined => {
  const a = lines.findIndex((l) => from.test(l))
  if (a < 0) return
  let b = a
  while (b + 1 < lines.length && !to(lines[b + 1], b + 1)) b++
  while (b > a && /^\s*\*+\s*(\$\s*)?$/.test(lines[b])) b--
  return [a, b]
}

const PACKS: PackDef[] = [
  {
    id: 'vendor-zetex', name: 'Zetex discretes (Diodes Inc.)',
    description: 'Zetex SPICE models of BJTs, MOSFETs, diodes, Schottky and varactor diodes, from the Zetex PLC model pages (now Diodes Incorporated). Shipped unmodified with their notices.',
    license: 'Zetex model notice: supplied free for research and design; may be used or copied intact (including the notice) for that purpose only.',
    source: 'Zetex PLC (zetex.com/3.0/spice, archived), now Diodes Incorporated',
    permit: /may be used or copied intact \(including this notice\) for (that|this) purpose only/i,
    notice: (ls) => span(ls, /\(c\)\s*(\d{4}\s+)?zetex|copyright in th(is|ese) model/i, (l) => !/^\s*\*/.test(l)),
    map: mapZetex,
    sources: [
      'Per-part files from the Zetex PLC model page http://www.zetex.com/3.0/spice/<part>.mod, the latest Internet Archive',
      'capture of each (2004-2009). diodes.com still hosts Zetex models but sits behind a browser challenge (no scripted download).',
      'Not used: the combined ZMODELS.LIB v4.3 (zetex.com, 2001) and v4.5 (community mirrors): not valid UTF-8 (a 0xB0 degree',
      'sign in a comment), which ngspice-47 rejects, and the notice forbids altering them. Community re-compilations',
      '(KiCad-Spice-Library zetex.lib) rename/wrap the vendor models, so the vendor originals are used instead.',
      'Six files on the Zetex index had no archived capture with model content (only HTML 404 pages): zmv931, zrc250,',
      'ZXM41N10F, zxmn3a14f, zxmp4a16g, ZXT4M322.'
    ],
    header: 'Zetex SPICE models: notice text\nEach model file in this pack is an unmodified copy of a Zetex PLC model file, as published at\nhttp://www.zetex.com/3.0/spice/ (retrieved from the Internet Archive; Zetex is now part of Diodes Incorporated).\nEvery file carries one of the notices below, quoted exactly from the first file listed (the others in a group\ndiffer at most in spacing or line breaks).'
  },
  {
    id: 'vendor-natsemi', name: 'National Semiconductor op-amps',
    description: 'National Semiconductor SPICE op-amp and comparator macromodels, version 4.4 (spice44.zip, 1996). Shipped unmodified with their notices.',
    license: 'National Semiconductor notice: intended for free software support; the file may be copied and distributed; reselling the material is illegal.',
    source: 'National Semiconductor (national.com/models/spice/analog/spice44.zip, archived), now Texas Instruments',
    permit: /the file may be copied, and distributed; however, reselling the material is illegal/i,
    notice: (ls) => span(ls, /\(c\) national semiconductor, inc\.\s*$/i, (_l, i) => /material is illegal/i.test(ls[i - 1] ?? '')),
    map: mapNatsemi,
    sources: [
      'spice44.zip from http://www.national.com/models/spice/analog/ (Internet Archive capture 2000-09-02), unzipped;',
      'its 147 .MOD files are shipped as they are (CRLF line endings kept). The zip itself is not shipped.',
      'Not used: nat_semi.lib (v4.30, a third-party compilation found in community mirrors): the vendor zip is newer and original.'
    ],
    header: 'National Semiconductor SPICE models: notice text\nEach model file in this pack is an unmodified copy of a file from National Semiconductor\'s spice44.zip (SPICE op-amp\nmacromodels v4.4), as published at http://www.national.com/models/spice/analog/spice44.zip (retrieved from the\nInternet Archive; National Semiconductor is now part of Texas Instruments).\nEvery file carries one of the notices below, quoted exactly from the first file listed (the others in a group\ndiffer at most in spacing or line breaks).'
  }
]

const utf8 = new TextDecoder('utf-8', { fatal: true })
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

function build(src: string, root: string) {
  const sources: Record<string, Src[]> = JSON.parse(readFileSync(join(src, 'sources.json'), 'utf8'))
  for (const def of PACKS) {
    const out = join(root, 'library-packs', def.id)
    rmSync(out, { recursive: true, force: true })
    mkdirSync(out, { recursive: true })
    const libs: ImportedLib[] = [], prov: { file: string; url: string; sha256: string; retrieved: string }[] = []
    const excluded: string[] = [], dropped: string[] = [], skipped: string[] = [], notices = new Map<string, { text: string; files: string[] }>()
    const files = [...(sources[def.id] ?? [])].sort((a, b) => basename(a.path).localeCompare(basename(b.path)))
    const seen = new Set<string>()
    for (const f of files) {
      const file = basename(f.path), buf = readFileSync(join(src, f.path))
      if (seen.has(file.toLowerCase())) { excluded.push(`${file}: duplicate file name`); continue }
      seen.add(file.toLowerCase())
      let text: string
      try { text = utf8.decode(buf) } catch { excluded.push(`${file}: not valid UTF-8 (ngspice-47 rejects it; not transcoded, the file must stay intact)`); continue }
      if (!def.permit.test(flat(text))) { excluded.push(`${file}: notice missing or different`); continue }
      const parsed = parseLibFile(text)
      if (parsed.errors.length) { excluded.push(`${file}: parse errors: ${parsed.errors.join('; ')}`); continue }
      const { ok, skip } = def.map(text)
      skip.forEach((s) => skipped.push(`${file} ${s.name}: ${s.why}`))
      const keep = ok.filter((m) => {
        const why = simulate(bench(m, text, join(resolve(src), f.path)))
        if (why) dropped.push(`${file} ${m.entry.name} (${m.entry.kind}): ${why}`)
        return !why
      })
      if (!keep.length) { if (ok.length) excluded.push(`${file}: no entry passed validation`); continue }
      const lines = text.split(/\r?\n/), s = def.notice(lines)
      if (s) {
        const t = lines.slice(s[0], s[1] + 1).join('\n'), k = flat(t).toLowerCase()
        const n = notices.get(k) ?? { text: t, files: [] }
        n.files.push(file), notices.set(k, n)
      }
      copyFileSync(join(src, f.path), join(out, file))
      libs.push({ file, entries: keep.map((m) => m.entry) })
      prov.push({ file, url: f.url, sha256: sha(buf), retrieved: f.retrieved })
    }
    const notice = [def.header, '', ...[...notices.values()].flatMap((n, i) => [
      `---- Notice ${i + 1} of ${notices.size} (${n.files.length} file${n.files.length > 1 ? 's' : ''}: ${n.files.slice(0, 6).join(', ')}${n.files.length > 6 ? ', …' : ''})`, n.text, ''])].join('\n')
    writeFileSync(join(out, 'NOTICE.txt'), notice)
    const pack = { id: def.id, name: def.name, description: def.description, license: def.license, source: def.source, version: '1', notice: 'NOTICE.txt', provenance: prov, libs }
    writeFileSync(join(out, 'pack.json'), JSON.stringify(pack, null, 1) + '\n')
    const all = libs.flatMap((l) => l.entries), byCat = new Map<string, number>()
    for (const e of all) byCat.set(`${e.category} (${e.kind})`, (byCat.get(`${e.category} (${e.kind})`) ?? 0) + 1)
    const tested = all.length + dropped.length
    writeFileSync(join(out, 'BUILD.md'), [
      `# ${def.name}: build log`, '',
      `Generated by \`node scripts/packs/vendor.ts <srcDir>\`; do not edit by hand. Source files are copied byte-identical`,
      `(sha256 and source URL per file in pack.json \`provenance\`; the URLs are Internet Archive captures of the vendor's own site).`, '',
      `Validation: every mapped entry simulated in ngspice plain mode (\`ngspice -b -n\`, no compat flags):`,
      `diodes 10 mA forward, zeners 5 mA reverse, BJTs bias point (Ib ≈ 100 µA, Rc 100 Ω, Vcc 5 V), MOSFETs on at |Vgs| 10 V and off at 0 V,`,
      `op-amps unity follower (±12 V; ±5 V for LM6xxx/LM71xx; 0/5 V for CMOS LMC/LPC and LM7131), comparators switching both ways,`,
      `shunt references Vref ±5 % at 7.5 mA, LDOs Vout ±5 % (5 V in, 1 kΩ load).`, '',
      `Result: ${all.length} of ${tested} entries passed (${tested ? ((100 * all.length) / tested).toFixed(1) : 0} %), in ${libs.length} files.`, '',
      '## Entries per category', '', ...[...byCat].sort().map(([c, n]) => `- ${c}: ${n}`), '',
      '## Sources', '', ...def.sources, '',
      '## Notice', '', `Every shipped file contains the redistribution sentence matched by \`${def.permit.source}\`.`,
      'The exact notice texts are in NOTICE.txt.', '',
      `## Dropped (failed validation): ${dropped.length}`, '', ...dropped.map((d) => `- ${d}`), '',
      `## Not mapped (no fitting symbol/test): ${skipped.length}`, '', ...skipped.map((d) => `- ${d}`), '',
      `## Files excluded: ${excluded.length}`, '', ...excluded.map((d) => `- ${d}`), ''
    ].join('\n'))
    console.log(`${def.id}: ${all.length}/${tested} entries, ${libs.length} files, ${dropped.length} dropped, ${skipped.length} unmapped, ${excluded.length} files excluded`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = process.argv[2]
  if (!src) throw new Error('usage: node scripts/packs/vendor.ts <srcDir>')
  build(resolve(src), resolve(import.meta.dirname, '../..'))
}
