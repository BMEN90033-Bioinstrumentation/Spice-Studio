// Re-annotate: renumber reference designators per prefix (R1, R2…; the letters before the trailing number) in reading
// order, top-to-bottom then left-to-right, and rewrite references to renamed parts where SPICE reads an element name:
// i(R1), @R1[i], the sources of .dc / .tf / .noise, the inductors of a K line, the V source of an F/H/W line, and the
// same positions in part values. Node names, model names and comments are never touched. Names without a trailing
// number (Rload) are left alone. Pure TS.
import type { Part, Sheet } from './model.ts'

const REF = /^([A-Za-z_]+)(\d+)$/
type Map_ = Map<string, string>
const swap = (t: string, map: Map_) => map.get(t.toLowerCase()) ?? t
// i(R1) / I(X1.R1) (the instance part before a dot) and @R1[i]
const calls = (s: string, map: Map_) =>
  s.replace(/(\bi\(\s*)([A-Za-z_][\w]*)/gi, (_, a: string, n: string) => a + swap(n, map)).replace(/@([A-Za-z_][\w]*)(?=[.[])/g, (_, n: string) => '@' + swap(n, map))
// rewrite the whitespace-separated tokens at positions `at` of a line (keeping its spacing)
function tokens(line: string, at: number[], map: Map_) {
  let i = -1
  return line.replace(/\S+/g, (t) => (at.includes(++i) && !/^[-+.\d]/.test(t) ? swap(t, map) : t))
}

// One directive card's text
export function rewriteRefs(text: string, map: Map_): string {
  if (!map.size) return text
  return text.split('\n').map((l) => {
    const t = l.trim(), k = t.split(/\s+/)[0]?.toLowerCase() ?? ''
    if (!t || t[0] === '*') return l
    let r = l
    if (k === '.dc') r = tokens(l, [1, 5], map)
    else if (k === '.tf') r = tokens(l, [t.split(/\s+/).length - 1], map)
    else if (k === '.noise') r = tokens(l, [2], map)
    else if (/^k/.test(k)) r = tokens(l, [1, 2], map) // K1 L1 L2 0.99
    else if (/^[fhw]/.test(k) && !/\bpoly\s*\(/i.test(t)) r = tokens(l, [3], map) // F1 n+ n- V1 2
    return calls(r, map)
  }).join('\n')
}

// A part's value: only the kinds whose value names other elements
export function rewriteValue(p: Pick<Part, 'kind' | 'value'>, map: Map_): string {
  if (!map.size) return p.value
  if (p.kind === 'ccvs' || p.kind === 'cccs' || p.kind === 'csw') return calls(tokens(p.value, [0], map), map)
  if (p.kind === 'kcouple') return tokens(p.value, [0, 1], map)
  if (p.kind === 'bv' || p.kind === 'bi') return calls(p.value, map)
  return p.value
}

// Sheets in order; numbering continues from one sheet to the next (pass one sheet for "this sheet only").
// Returns the sheets (unchanged ones by identity) and how many parts got a new name.
export function annotate(sheets: Sheet[]): { sheets: Sheet[]; renamed: number } {
  const next = new Map<string, number>() // prefix (upper) -> last number used
  // names defined by element lines in directive cards keep their numbers
  const taken = new Set(sheets.flatMap((s) => s.texts.flatMap((t) => t.text.split('\n').filter((l) => /^\s*[a-z]/i.test(l)).map((l) => l.trim().split(/\s+/)[0].toLowerCase()))))
  let renamed = 0
  const out = sheets.map((s) => {
    const map = new Map<string, string>(), ids = new Map<string, string>() // old name -> new (references); part id -> new name
    const names = new Set(s.parts.map((p) => p.name.trim().toLowerCase()))
    // ponytail: exact y then x of the part origin; no row banding, so parts 10 apart vertically read as separate rows
    const order = s.parts.filter((p) => REF.test(p.name.trim())).sort((a, b) => a.y - b.y || a.x - b.x)
    for (const p of order) {
      const [, pre] = REF.exec(p.name.trim())!, k = pre.toUpperCase()
      let n = next.get(k) ?? 0
      do n++
      while (taken.has((pre + n).toLowerCase()))
      next.set(k, n)
      const old = p.name.trim(), now = pre + n
      if (old === now) continue
      ids.set(p.id, now) // by part: duplicate names (R1, R1) each get their own number
      const o = old.toLowerCase()
      if (map.has(o)) continue // ponytail: a duplicated name's references go to the first of them in reading order
      map.set(o, now)
      // names the netlister derives from a part name: transformer elements, and the X it puts before a library
      // subckt placed with another symbol (unless a real part already has that name)
      if (p.kind === 'xfmr') for (const [a, b] of [['l', '_p'], ['l', '_s'], ['k', '']]) map.set(`${a}${o}${b}`, `${a.toUpperCase()}${now}${b.toUpperCase()}`)
      if (!/^x/i.test(old) && !names.has('x' + o)) map.set('x' + o, 'X' + now)
    }
    if (!ids.size) return s
    renamed += ids.size
    return {
      ...s,
      parts: s.parts.map((p) => {
        const name = ids.get(p.id) ?? p.name, value = rewriteValue(p, map)
        return name === p.name && value === p.value ? p : { ...p, name, value }
      }),
      texts: s.texts.map((t) => { const text = rewriteRefs(t.text, map); return text === t.text ? t : { ...t, text } })
    }
  })
  return { sheets: out, renamed }
}
