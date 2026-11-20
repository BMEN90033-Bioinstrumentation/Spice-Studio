// Markdown for comment blocks (a note with md: true), parsed to lines of styled spans that drawings.tsx draws as SVG
// text. Pure, no React, no HTML: a schematic from someone else can't inject markup.
// ponytail: one source line is one drawn line (no wrapping, no tables or images) and inline styles don't nest;
// swap in a real parser + foreignObject if comments outgrow that.
export type Span = { s: string; b?: boolean; i?: boolean; c?: boolean; u?: boolean; m?: boolean } // bold, italic, code, link; m: markdown syntax (keep mode)
export type MdLine = { spans: Span[]; k: number; rule?: boolean } // k: font scale (headings); rule: a horizontal line

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\*(\S(?:.*?\S)?)\*|\[([^\]]+)\]\([^)]*\)/g
function inline(s: string, base: Span, keep: boolean): Span[] {
  const out: Span[] = []
  let at = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index > at) out.push({ ...base, s: s.slice(at, m.index) })
    const body: Span = m[1] != null ? { ...base, s: m[1], c: true } : m[2] != null ? { ...base, s: m[2], b: true } : m[3] != null ? { ...base, s: m[3], i: true } : { ...base, s: m[4], u: true }
    const open = m[0].indexOf(body.s, m[1] != null || m[3] != null || m[4] != null ? 1 : 2), mark = (t: string): Span => ({ ...base, s: t, m: true })
    out.push(...(keep ? [mark(m[0].slice(0, open)), body, mark(m[0].slice(open + body.s.length))] : [body]))
    at = m.index + m[0].length
  }
  if (at < s.length) out.push({ ...base, s: s.slice(at) })
  return out
}

const HEAD = [1.6, 1.3, 1.1]
// keep: for the in-place editor. Every source line gives exactly one line whose spans join back to it, the markdown
// syntax kept as `m` spans (drawn dimmed), so what is typed and what is shown stay the same text.
export function parseMd(text: string, keep = false): MdLine[] {
  let code = false
  const syn = (l: string): MdLine[] => (keep ? [{ spans: [{ s: l, m: true }], k: 1 }] : [])
  return text.split('\n').flatMap((l): MdLine[] => {
    if (/^\s*```/.test(l)) return (code = !code), syn(l)
    if (code) return [{ spans: [{ s: l, c: true }], k: 1 }]
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) return keep ? syn(l) : [{ spans: [], k: 1, rule: true }]
    // a line that starts with syntax: `pre` is that syntax as typed, `shown` what the card draws in its place
    const line = (pre: string, shown: string, rest: string, base: Span, k = 1): MdLine[] =>
      [{ spans: [...(keep ? [{ ...base, s: pre, m: true }] : shown ? [{ s: shown }] : []), ...inline(rest, base, keep)], k }]
    const h = /^(#{1,3})\s+(.*)$/.exec(l)
    if (h) return line(l.slice(0, l.length - h[2].length), '', h[2], { s: '', b: true }, HEAD[h[1].length - 1])
    const li = /^(\s*)[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(l)
    if (li) return line(l.slice(0, l.length - li[3].length), li[1] + (li[2] == null ? '• ' : li[2] === ' ' ? '☐ ' : '☑ '), li[3], { s: '' })
    const q = /^\s*>\s?(.*)$/.exec(l)
    if (q) return line(l.slice(0, l.length - q[1].length), '│ ', q[1], { s: '', i: true })
    return [{ spans: inline(l, { s: '' }, keep), k: 1 }]
  })
}
export const mdChars = (l: MdLine) => l.spans.reduce((n, s) => n + s.s.length, 0)
