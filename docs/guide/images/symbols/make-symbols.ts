// node docs/guide/images/symbols/make-symbols.ts docs/guide/images/symbols  ->  <kind>.svg from symbols.ts, drawn like the library viewer's large preview (Symbol.tsx):
// symbol paths, pin dots and "n name" pin labels. Mid-grey so it reads on GitHub's light and dark themes.
const { SYMBOLS } = await import(new URL('../../../../src/renderer/src/schematic/symbols.ts', import.meta.url).href)
import { mkdirSync, writeFileSync } from 'node:fs'
const out = process.argv[2]
mkdirSync(out, { recursive: true })
function box(d: any) {
  const xs = d.pins.map((p: any) => p.x), ys = d.pins.map((p: any) => p.y)
  if (d.circle) xs.push(-d.circle, d.circle), ys.push(-d.circle, d.circle)
  for (const path of [d.path, d.fill ?? '']) {
    const t = path.match(/[A-Za-z]|-?[\d.]+/g) ?? []
    let cmd = '', x = 0, y = 0, i = 0
    const n = () => +t[i++]
    while (i < t.length) {
      if (/[A-Za-z]/.test(t[i])) { cmd = t[i++]; continue }
      if (cmd === 'H') x = n()
      else if (cmd === 'V') y = n()
      else if (cmd === 'A') (i += 5), (x = n()), (y = n())
      else (x = n()), (y = n())
      xs.push(x), ys.push(y)
    }
  }
  if (!xs.length) xs.push(0), ys.push(0)
  return { x0: Math.min(...xs) - 3, y0: Math.min(...ys) - 3, x1: Math.max(...xs) + 3, y1: Math.max(...ys) + 3 }
}
const C = '#8b949e', P = '#e3883e'
for (const [kind, d] of Object.entries(SYMBOLS) as [string, any][]) {
  if (kind === 'block') continue
  const b = box(d), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, s = Math.max(b.x1 - b.x0, b.y1 - b.y0, 90) + 68
  const pins = d.pins.map((q: any, i: number) => {
    const dx = q.x - cx, dy = q.y - cy, n = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 }
    const tx = q.x + n.x * 4, ty = q.y + n.y * 4 + (n.y > 0 ? 6.3 : n.y < 0 ? 0 : 2.45)
    const anchor = n.x > 0.5 ? 'start' : n.x < -0.5 ? 'end' : 'middle'
    const label = d.pinNames?.[i] ? `${i + 1} ${d.pinNames[i]}` : String(i + 1)
    return `<circle cx="${q.x}" cy="${q.y}" r="1.6" fill="${P}"/><text x="${tx}" y="${ty}" text-anchor="${anchor}">${label}</text>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cx - s / 2} ${cy - s / 2} ${s} ${s}" width="128" height="128">` +
    `<g fill="none" stroke="${C}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${d.path}"/>` +
    (d.circle ? `<circle r="${d.circle}"/>` : '') + `</g>` + (d.fill ? `<path d="${d.fill}" fill="${C}"/>` : '') +
    `<g font-family="ui-monospace,Menlo,Consolas,monospace" font-size="7" fill="${C}">${pins}</g></svg>\n`
  writeFileSync(`${out}/${kind}.svg`, svg)
}
console.log('ok')
