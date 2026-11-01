// Electrical rules check on the emitted netlist text (so hand-written netlists too), before ngspice runs. Pure TS.
//   errors:   a loop of voltage-defined branches (V, E/H outputs, L: a short at DC), or one of them across a single net
//   warnings: nets with no DC path to ground (ngspice: "singular matrix" or a meaningless DC point)
// Each .subckt body is its own scope: its ports (and .global nodes) count as ground, since the instance connects them.
// Lenient on purpose (a false error blocks the run): X/T/O/A/N pins are all DC-joined, M/J/Q/B conduct between all
// their pins. Elements inside .include/.lib files aren't seen. Refs and nets come back as written (first spelling).
export interface Issue { message: string; refs: string[]; nets: string[] }

type Scope = { anchors: string[]; els: { ref: string; dc: string[][]; vdef?: [string, string]; nets: string[] }[] }
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
      const ns = t.slice(1, (end < 0 ? t.length : end) - 1)
      return { ref, dc: [ns], nets: ns }
    }
    case 'a': {
      // XSPICE: [ ] vectors, %v-style port types, model last. Digital nets have no analog DC path: tie them to ground.
      const ns = t.slice(1, -1).join(' ').replace(/[[\]]/g, ' ').split(/\s+/).filter((s) => s && !s.startsWith('%') && s !== '~')
      return { ref, dc: [[...ns, '0']], nets: ns }
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

  const scopes: Scope[] = [{ anchors: ['0'], els: [] }], stack = [scopes[0]], globals: string[] = []
  for (const l of lines) {
    const t = l.split(/\s+/)
    if (/^\.subckt$/i.test(t[0])) {
      const rest = t.slice(2), end = rest.findIndex((s) => /^params:$/i.test(s) || s.includes('='))
      const sc: Scope = { anchors: ['0', ...(end < 0 ? rest : rest.slice(0, end))], els: [] }
      scopes.push(sc), stack.push(sc)
    } else if (/^\.ends$/i.test(t[0])) stack.length > 1 && stack.pop()
    else if (/^\.global$/i.test(t[0])) globals.push(...t.slice(1))
    else if (/^\.end$/i.test(t[0])) break
    else if (!t[0].startsWith('.')) {
      const e = element(t)
      if (e) stack.at(-1)!.els.push(e)
    }
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
    for (const a of [...s.anchors, ...globals]) dc.union(k(a), '0')
    for (const e of s.els) {
      for (const g of e.dc) for (const n of g.slice(1)) dc.union(k(g[0]), k(n))
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
        errors.push({ message: `Loop of voltage sources / inductors: ${refs.join(', ')} (a short circuit at DC)`, refs, nets })
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
