// Re-annotate: renumber reference designators per prefix (R1, R2…; the letters before the trailing number) in reading
// order, top-to-bottom then left-to-right, and rewrite references to renamed parts in the sheet's directive cards and
// part values (i(R1), @R1[i], .dc V1 …, F/H/W values naming a V source, K values naming inductors). Names without a
// trailing number (Rload) are left alone. Pure TS.
import type { Sheet } from './model.ts'
import { isFlag } from './symbols.ts'

const REF = /^([A-Za-z_]+)(\d+)$/
// an element-name token: not inside another word, not after '.' (X1.R1 is R1 inside X1's subckt)
const TOKEN = /(?<![\w.$#])[A-Za-z_][\w]*/g
// inside v(...) / vdb(...) … arguments are nodes, not elements
const IN_V = /\bv[a-z]*\(\s*(?:[^()]*,\s*)?$/i

export function rewriteRefs(text: string, map: Map<string, string>): string {
  if (!map.size) return text
  return text.replace(TOKEN, (t, at: number, all: string) => {
    const n = map.get(t.toLowerCase())
    return n == null || IN_V.test(all.slice(Math.max(0, at - 40), at)) ? t : n
  })
}

// Sheets in order; numbering continues from one sheet to the next (pass one sheet for "this sheet only").
// Returns the sheets (unchanged ones by identity) and how many parts got a new name.
export function annotate(sheets: Sheet[]): { sheets: Sheet[]; renamed: number } {
  const next = new Map<string, number>() // prefix (upper) -> last number used
  // names defined by element lines in directive cards keep their numbers
  const taken = new Set(sheets.flatMap((s) => s.texts.flatMap((t) => t.text.split('\n').filter((l) => /^\s*[a-z]/i.test(l)).map((l) => l.trim().split(/\s+/)[0].toLowerCase()))))
  let renamed = 0
  const out = sheets.map((s) => {
    const map = new Map<string, string>()
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
      map.set(old.toLowerCase(), now)
      // names the netlister derives from a part name: transformer elements, X prefix added to library subckts
      if (p.kind === 'xfmr') for (const [a, b] of [['l', '_p'], ['l', '_s'], ['k', '']]) map.set(`${a}${old}${b}`.toLowerCase(), `${a.toUpperCase()}${now}${b.toUpperCase()}`)
      if (!/^x/i.test(old) && !map.has('x' + old.toLowerCase())) map.set('x' + old.toLowerCase(), 'X' + now)
    }
    const ids = new Map(order.filter((p) => map.has(p.name.trim().toLowerCase())).map((p) => [p.id, map.get(p.name.trim().toLowerCase())!]))
    if (!ids.size) return s
    renamed += ids.size
    return {
      ...s,
      parts: s.parts.map((p) => {
        const name = ids.get(p.id) ?? p.name, value = isFlag(p.kind) || p.sheet ? p.value : rewriteRefs(p.value, map) // flag values are net names
        return name === p.name && value === p.value ? p : { ...p, name, value }
      }),
      texts: s.texts.map((t) => { const text = rewriteRefs(t.text, map); return text === t.text ? t : { ...t, text } })
    }
  })
  return { sheets: out, renamed }
}
