// Mixed-signal starter sheet (template + guide example): a 1 MHz clock into a 2-bit ripple counter of D flip-flops
// (Q̄ fed back to D), an XOR of the two bits, and an RC filter averaging q1 back into the analog world.
import { emptySheet, newPart, route, uid, type Part, type Sheet } from './model.ts'
import type { Kind } from './symbols.ts'

export function digitalCounter(): Sheet {
  const s = emptySheet()
  const add = (kind: Kind, x: number, y: number, rot = 0, value?: string, extra?: Partial<Part>) =>
    s.parts.push(newPart(s, kind, x, y, rot, false, { ...(value != null && { value }), ...extra }))
  const wire = (...p: [number, number][]) => p.slice(1).forEach((b, i) => s.wires.push(...route({ x: p[i][0], y: p[i][1] }, { x: b[0], y: b[1] })))
  const lib = (id: string) => ({ lib: 'std:' + id })
  const UP = 3, LEFT = 2
  add('vsrc', 0, 40, 0, 'PULSE(0 5 0 2n 2n 0.5u 1u)')
  add('gnd', 0, 70)
  add('label', 0, 10, UP, 'clk')
  wire([0, 10], [80, 10])
  // bit 0: toggles on every clock edge
  add('dff', 120, 0, 0, undefined, lib('DFF'))
  add('label', 60, -10, LEFT, 'q0n'), wire([60, -10], [80, -10])
  wire([160, -10], [210, -10]), add('label', 210, -10, 0, 'q0')
  wire([160, 10], [210, 10]), add('label', 210, 10, 0, 'q0n')
  // bit 1: clocked by q0n, so it toggles when q0 falls (an up-counter)
  add('dff', 380, 0, 0, undefined, lib('DFF'))
  add('label', 300, -10, LEFT, 'q1n'), wire([300, -10], [340, -10])
  add('label', 300, 10, LEFT, 'q0n'), wire([300, 10], [340, 10])
  wire([420, -10], [470, -10]), add('label', 470, -10, UP, 'q1')
  wire([420, 10], [470, 10]), add('label', 470, 10, 0, 'q1n')
  // analog side: q1 through an RC low-pass (τ = 1 µs)
  add('res', 500, -10, 3, '1k')
  add('cap', 530, 20, 0, '1n')
  add('gnd', 530, 50)
  add('label', 530, -10, 0, 'avg')
  // XOR of the two bits
  add('xor2', 380, 120, 0, undefined, lib('XOR2'))
  add('label', 300, 110, LEFT, 'q0'), wire([300, 110], [350, 110])
  add('label', 300, 130, LEFT, 'q1'), wire([300, 130], [350, 130])
  wire([410, 120], [460, 120]), add('label', 460, 120, 0, 'x')
  s.texts.push({ id: uid(), x: -20, y: 180, text: '* digital parts: value vdd=<logic high> tpd=<delay>\n.tran 10n 8u' },
    { id: uid(), x: -20, y: 240, text: '.plot tran v(clk) v(q0) v(q1) ; Clock and counter bits\n.plot tran v(x) v(avg) ; q0 XOR q1, and q1 through the RC filter' })
  return s
}
