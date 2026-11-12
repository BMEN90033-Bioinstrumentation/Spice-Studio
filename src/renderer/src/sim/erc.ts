// Electrical rules check on the emitted netlist text (so hand-written netlists too), before ngspice runs. Pure TS.
//   errors:   a loop of voltage-defined branches (V, E/H outputs, L: a short at DC), or one of them across a single net
//   warnings: nets with no DC path to ground (ngspice: "singular matrix" or a meaningless DC point)
// Each .subckt body is its own scope: its ports (and .global nodes) count as ground, since the instance connects them.
// An instance whose subckt reaches ground or a .global node inside (or isn't defined here, e.g. .include) grounds its pins.
// Lenient on purpose (a false error blocks the run): X/T/O/A/N pins are all DC-joined, M/J/Q/B conduct between all
// their pins. Elements inside .include/.lib files aren't seen. Refs and nets come back as written (first spelling).
export interface Issue { message: string; refs: string[]; nets: string[] }

type Scope = { name?: string; anchors: string[]; els: { ref: string; dc: string[][]; vdef?: [string, string]; nets: string[]; sub?: string; xs?: string[] }[] }
const KEYWORD = /^(value|poly|table|vol|cur|laplace|freq|and|or|nand|nor)\b/i

// one element line -> its DC-conducting node groups, voltage-defined output pair, and every node it touches
function element(t: string[]): Scope['els'][number] | null {
  const ref = t[0], c = ref[0].toLowerCase(), n = (k: number) => t.slice(1, 1 + k)
  const two = n(2)
  if (two.length < 2 && !'kax'.includes(c)) return null
  switch (c) {
    case 'r': case 'd': case 'b':
      return { ref, dc: [two], nets: two }
    case 'v': case 'l': case 'h':
      return { ref, dc: [two], vdef: [two[0], two[1]], nets: two }
    case 'c': case 'i': case 'f':
      return { ref, dc: [], nets: two }
    case 'e': case 'g': {
      const ctl = t.length >= 6 && !KEYWORD.test(t[3]) ? t.slice(3, 5) : [] // linear form: 2 control nodes
      return c === 'e' ? { ref, dc: [two], vdef: [two[0], two[1]], nets: [...two, ...ctl] } : { ref, dc: [], nets: [...two, ...ctl] }
    }
    case 's': { const ns = n(4); return { ref, dc: [two], nets: ns } }
    case 'w': return { ref, dc: [two], nets: two }
    case 'q': case 'j': case 'z': case 'u': { const ns = n(3); return { ref, dc: [ns], nets: ns } }
    case 'm': { const ns = n(4); return { ref, dc: [ns], nets: ns } }
    case 't': case 'o': { const ns = n(4); return { ref, dc: [ns], nets: ns } } // ponytail: DC passes along the line, so all four join
    case 'x': case 'n': case 'p': {
      // X1 n1 n2 … subname [params: | k=v …]: nodes are everything before the subckt/model name
      const end = t.findIndex((s, i) => i > 0 && (/^params:$/i.test(s) || s.includes('=')))
      const last = (end < 0 ? t.length : end) - 1, ns = t.slice(1, last)
      return { ref, dc: [ns], nets: ns, ...(c === 'x' && { sub: t[last]?.toLowerCase() }) }
    }
    case 'a': {
      // XSPICE: [ ] vectors, %v-style port types, model last. Digital nets have no analog DC path: tie them to ground.
      const ns = t.slice(1, -1).join(' ').replace(/[[\]]/g, ' ').split(/\s+/).filter((s) => s && !s.startsWith('%') && s !== '~')
      return { ref, dc: [[...ns, '0']], nets: ns, xs: t }
    }
  }
  return null // K (no nodes) and anything unknown
}

class UF {
  p = new Map<string, string>()
  find(a: string): string {
    const q = this.p.get(a) ?? a
    if (q === a) return a
    const r = this.find(q)
    this.p.set(a, r)
    return r
  }
  union(a: string, b: string) {
    const x = this.find(a), y = this.find(b)
    if (x === y) return false
    this.p.set(x, y)
    return true
  }
}

export function erc(netlistText: string): { errors: Issue[]; warnings: Issue[] } {
  // logical lines: title skipped, comments stripped, + continuations joined, .control blocks dropped
  const lines: string[] = []
  let ctl = false
  for (const raw of netlistText.split(/\r?\n/).slice(1)) {
    const l = raw.replace(/(^|\s)(;|\$\s|\/\/).*$/, '').trim()
    if (/^\.control\b/i.test(l)) ctl = true
    else if (/^\.endc\b/i.test(l)) ctl = false
    else if (ctl || !l || l.startsWith('*')) continue
    else if (l.startsWith('+') && lines.length) lines[lines.length - 1] += ' ' + l.slice(1)
    else lines.push(l)
  }

  const scopes: Scope[] = [{ anchors: ['0'], els: [] }], stack = [scopes[0]], globals: string[] = [], models = new Map<string, string>()
  for (const l of lines) {
    const t = l.split(/\s+/)
    if (/^\.subckt$/i.test(t[0])) {
      const rest = t.slice(2), end = rest.findIndex((s) => /^params:$/i.test(s) || s.includes('='))
      const sc: Scope = { name: t[1]?.toLowerCase(), anchors: ['0', ...(end < 0 ? rest : rest.slice(0, end))], els: [] }
      scopes.push(sc), stack.push(sc)
    } else if (/^\.ends$/i.test(t[0])) stack.length > 1 && stack.pop()
    else if (/^\.global$/i.test(t[0])) globals.push(...t.slice(1))
    else if (/^\.model$/i.test(t[0]) && t[2]) models.set(t[1].toLowerCase(), /^\w*/.exec(t[2])![0].toLowerCase())
    else if (/^\.end$/i.test(t[0])) break
    else if (!t[0].startsWith('.')) {
      const e = element(t)
      if (e) stack.at(-1)!.els.push(e)
    }
  }

  // does a subckt touch ground / a global node, itself or through the subckts it instantiates? (cycle-safe)
  const byName = new Map(scopes.filter((s) => s.name).map((s) => [s.name!, s]))
  const glob = new Set(['0', 'gnd', ...globals.map((g) => g.toLowerCase())])
  const memo = new Map<string, boolean>()
  const grounded = (name: string): boolean => {
    const sc = byName.get(name)
    if (!sc) return true // defined elsewhere (.include / .lib): assume it does
    if (memo.has(name)) return memo.get(name)!
    memo.set(name, false)
    const r = sc.els.some((e) => e.nets.some((n) => glob.has(n.toLowerCase())) || (!!e.sub && grounded(e.sub)))
    memo.set(name, r)
    return r
  }

  // XSPICE dac_bridge outputs are voltage sources to ground: one on a net with another output (directly, or through the
  // subckt ports they drive, as in the digital parts) or a V source is a short like two V sources in parallel
  const drivenMemo = new Map<string, Set<number>>()
  const outs = (sc: Scope) => sc.els.flatMap((e) => {
    if (e.xs && models.get(e.xs.at(-1)!.toLowerCase()) === 'dac_bridge') {
      const ports = e.xs.slice(1, -1).join(' ').match(/\[[^\]]*\]|[^\s[\]]+/g)?.filter((x) => !x.startsWith('%')) ?? []
      return (ports[1] ?? '').replace(/[[\]]/g, ' ').split(/\s+/).filter(Boolean).map((net) => ({ ref: e.ref, net }))
    }
    const d = e.sub ? driven(e.sub) : null
    return d ? e.nets.flatMap((net, i) => (d.has(i) ? [{ ref: e.ref, net }] : [])) : []
  })
  const driven = (name: string): Set<number> => {
    const sc = byName.get(name)
    if (!sc || drivenMemo.has(name)) return drivenMemo.get(name) ?? new Set()
    drivenMemo.set(name, new Set())
    const o = new Set(outs(sc).map((x) => x.net.toLowerCase()))
    const r = new Set(sc.anchors.slice(1).flatMap((p, i) => (o.has(p.toLowerCase()) ? [i] : [])))
    drivenMemo.set(name, r)
    return r
  }

  const errors: Issue[] = [], warnings: Issue[] = []
  for (const s of scopes) {
    const spell = new Map<string, string>()
    const k = (net: string) => {
      const x = net.toLowerCase() === 'gnd' ? '0' : net.toLowerCase()
      if (!spell.has(x)) spell.set(x, net)
      return x
    }
    const dc = new UF(), vloop = new UF(), vedges: { a: string; b: string; ref: string }[] = []
    const drv: Scope['els'] = outs(s).map((o) => ({ ref: o.ref, dc: [], vdef: [o.net, '0'], nets: [] })), digital = new Set(drv.map((d) => d.ref))
    for (const a of [...s.anchors, ...globals]) dc.union(k(a), '0')
    for (const e of [...s.els, ...drv]) {
      for (const g of e.dc) for (const n of g.slice(1)) dc.union(k(g[0]), k(n))
      if (e.sub && grounded(e.sub)) for (const n of e.nets) dc.union(k(n), '0')
      if (!e.vdef) continue
      const [a, b] = e.vdef.map(k)
      if (a === b) {
        errors.push({ message: `${e.ref} is shorted: both ends are on net ${spell.get(a)}`, refs: [e.ref], nets: [spell.get(a)!] })
        continue
      }
      if (!vloop.union(a, b)) {
        const path = vpath(vedges, a, b).sort((x, y) => vedges.indexOf(x) - vedges.indexOf(y)) // netlist order
        const refs = [...path.map((x) => x.ref), e.ref]
        const nets = [...new Set([a, b, ...path.flatMap((x) => [x.a, x.b])])].map((n) => spell.get(n)!)
        const dig = refs.filter((r) => digital.has(r)), other = refs.filter((r) => !digital.has(r)), on = nets.filter((n) => n !== '0')
        errors.push({ message: dig.length > 1
          ? `Digital outputs fight: ${dig.join(', ')} drive ${on.length > 1 ? 'the nets' : 'the same net'} ${on.join(', ')}${other.length ? ` (also through ${other.join(', ')})` : ''} (an output is a voltage source; ngspice can't solve two in parallel)`
          : dig.length ? `Digital output of ${dig[0]} is shorted at DC through ${other.join(', ')} on ${on.join(', ')} (a voltage source or inductor across an output)`
            : `Loop of voltage sources / inductors: ${refs.join(', ')} (a short circuit at DC)`, refs, nets })
      }
      vedges.push({ a, b, ref: e.ref })
    }
    // floating: group the unreachable nets by DC island, one warning per island
    const islands = new Map<string, Set<string>>()
    for (const e of s.els) for (const n of e.nets) {
      const x = k(n), r = dc.find(x)
      if (r !== dc.find('0')) (islands.get(r) ?? islands.set(r, new Set()).get(r)!).add(x)
    }
    for (const nets of islands.values()) {
      const refs = s.els.filter((e) => e.nets.some((n) => nets.has(k(n)))).map((e) => e.ref)
      const names = [...nets].map((n) => spell.get(n)!)
      warnings.push({
        message: `No DC path to ground from net${names.length > 1 ? 's' : ''} ${names.join(', ')} (only ${refs.join(', ')} connect there: add a resistor to ground?)`,
        refs, nets: names
      })
    }
  }
  return { errors, warnings }
}

// the existing voltage-branch path a..b (BFS), i.e. the rest of the loop a new branch a-b closes
function vpath(edges: { a: string; b: string; ref: string }[], a: string, b: string) {
  const prev = new Map<string, { from: string; e: (typeof edges)[number] }>([[a, null as never]])
  const q = [a]
  while (q.length) {
    const x = q.shift()!
    if (x === b) break
    for (const e of edges) {
      const y = e.a === x ? e.b : e.b === x ? e.a : null
      if (y !== null && !prev.has(y)) prev.set(y, { from: x, e }), q.push(y)
    }
  }
  const out: (typeof edges)[number][] = []
  for (let x = b; x !== a; ) {
    const p = prev.get(x)!
    out.unshift(p.e)
    x = p.from
  }
  return out
}
