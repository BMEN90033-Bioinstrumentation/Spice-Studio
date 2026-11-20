// Markdown for comment blocks (a note with md: true), parsed to lines of styled spans that drawings.tsx draws as SVG
// text. Pure, no React, no HTML: a schematic from someone else can't inject markup.
// ponytail: one source line is one drawn line (no wrapping, no tables or images) and inline styles don't nest;
// swap in a real parser + foreignObject if comments outgrow that.
export type Span = { s: string; b?: boolean; i?: boolean; c?: boolean; u?: boolean } // bold, italic, code, link
export type MdLine = { spans: Span[]; k: number; rule?: boolean } // k: font scale (headings); rule: a horizontal line

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\*(\S(?:.*?\S)?)\*|\[([^\]]+)\]\([^)]*\)/g
function inline(s: string, base: Span = { s: '' }): Span[] {
  const out: Span[] = []
  let at = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index > at) out.push({ ...base, s: s.slice(at, m.index) })
    out.push(m[1] != null ? { ...base, s: m[1], c: true } : m[2] != null ? { ...base, s: m[2], b: true } : m[3] != null ? { ...base, s: m[3], i: true } : { ...base, s: m[4], u: true })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push({ ...base, s: s.slice(at) })
  return out
}

const HEAD = [1.6, 1.3, 1.1]
export function parseMd(text: string): MdLine[] {
  let code = false
  return text.split('\n').flatMap((l): MdLine[] => {
    if (/^\s*```/.test(l)) return (code = !code), []
    if (code) return [{ spans: [{ s: l, c: true }], k: 1 }]
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) return [{ spans: [], k: 1, rule: true }]
    const h = /^(#{1,3})\s+(.*)$/.exec(l)
    if (h) return [{ spans: inline(h[2], { s: '', b: true }), k: HEAD[h[1].length - 1] }]
    const li = /^(\s*)[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(l)
    if (li) return [{ spans: [{ s: li[1] + (li[2] == null ? '• ' : li[2] === ' ' ? '☐ ' : '☑ ') }, ...inline(li[3])], k: 1 }]
    const q = /^\s*>\s?(.*)$/.exec(l)
    if (q) return [{ spans: [{ s: '│ ' }, ...inline(q[1], { s: '', i: true })], k: 1 }]
    return [{ spans: inline(l), k: 1 }]
  })
}
export const mdChars = (l: MdLine) => l.spans.reduce((n, s) => n + s.s.length, 0)
