// XSPICE digital parts: gates and a D flip-flop. Each is a bundled subckt that carries its own bridges (adc_bridge on
// the inputs, dac_bridge on the outputs, XSPICE code models from the bundled digital.cm), so every pin is an ordinary
// analog net: gates wire to each other, to sources and to analog parts without bridge models, ERC sees plain X
// instances, and every net plots as a voltage. Instance value: vdd (logic high, input threshold vdd/2) and tpd (delay).
// ponytail: bridges on every pin, so gate-to-gate nets are analog too; netlister-inserted bridges would simulate big
// digital designs faster, add them if that matters.
import type { SymbolDef } from './symbols.ts'
import type { LibEntry } from '../library/library.ts'

export type DigitalKind = 'and2' | 'or2' | 'nand2' | 'nor2' | 'xor2' | 'inv' | 'buf' | 'dff'

const IN2 = { pins: [{ x: -30, y: -10 }, { x: -30, y: 10 }, { x: 30, y: 0 }], pinNames: ['A', 'B', 'Y'] }
const IN1 = { pins: [{ x: -30, y: 0 }, { x: 30, y: 0 }], pinNames: ['A', 'Y'] }
const bubble = (x: number) => `M${x + 6} 0A3 3 0 1 1 ${x} 0A3 3 0 1 1 ${x + 6} 0` // inversion circle from x to x+6
const and = (tip: number) => `M-30 -10H-20M-30 10H-20M-20 -20H${tip - 20}A20 20 0 0 1 ${tip - 20} 20H-20Z`
// OR: arcs to the tip, concave back (circle centred at x = -35, so the input stubs meet it at x ≈ -12)
const or = (tip: number, stub = -12) => `M-30 -10H${stub}M-30 10H${stub}M-20 -20A${tip + 20} ${tip + 20} 0 0 1 ${tip} 0A${tip + 20} ${tip + 20} 0 0 1 -20 20A25 25 0 0 0 -20 -20Z`
const sym = (title: string, path: string, extra = {}): SymbolDef => ({ title, prefix: 'U', value: 'vdd=5 tpd=10n', ...IN2, path, ...extra })

export const DIGITAL_SYMBOLS: Record<DigitalKind, SymbolDef> = {
  and2: sym('AND gate', and(20) + 'M20 0H30'),
  nand2: sym('NAND gate', and(18) + bubble(18) + 'M24 0H30'),
  or2: sym('OR gate', or(20) + 'M20 0H30'),
  nor2: sym('NOR gate', or(18) + bubble(18) + 'M24 0H30'),
  xor2: sym('XOR gate', or(20, -18) + 'M-26 -20A25 25 0 0 1 -26 20M20 0H30'),
  inv: sym('Inverter', 'M-30 0H-20M-20 -15V15L14 0Z' + bubble(14) + 'M20 0H30', IN1),
  buf: sym('Buffer', 'M-30 0H-20M-20 -15V15L20 0ZM20 0H30', IN1),
  // D, clock wedge, Q and Q̄ drawn as strokes: canvas symbols show no pin names
  dff: sym('D flip-flop', 'M-20 -30H20V30H-20ZM-40 -10H-20M-40 10H-20M20 -10H40M20 10H40M-20 4L-13 10L-20 16' +
    'M-16 -14V-6H-14A4 4 0 0 0 -14 -14ZM15 -10A3 4 0 1 0 9 -10A3 4 0 1 0 15 -10M13 -8L16 -5M15 10A3 4 0 1 0 9 10A3 4 0 1 0 15 10M13 12L16 15M9 3H15',
  { pins: [{ x: -40, y: -10 }, { x: -40, y: 10 }, { x: 40, y: -10 }, { x: 40, y: 10 }], pinNames: ['D', 'CLK', 'Q', 'Q̄'] }) // wider than tall: name/value go above/below
}
export const isDigital = (k: string) => k in DIGITAL_SYMBOLS

// subckt <name>: inputs -> adc_bridge -> code model -> dac_bridge -> outputs
const bridges = (n: string) => `.model ${n}_in adc_bridge(in_low={vdd/2} in_high={vdd/2})
.model ${n}_out dac_bridge(out_low=0 out_high={vdd} out_undef={vdd/2} t_rise=1n t_fall=1n)`
function part(kind: DigitalKind, name: string, description: string, ins: string[], outs: string[], core: string, model: string): LibEntry {
  const sub = name, pins = [...ins, ...outs], d = (x: string) => 'd' + x
  const text = `.subckt ${sub} ${pins.join(' ')} params: vdd=5 tpd=10n
* ${description}. Self-written: XSPICE ${model.split('(')[0]} between adc/dac bridges
Ain [${ins.join(' ')}] [${ins.map(d).join(' ')}] ${sub}_in
Ag ${core} ${sub}_g
Aout [${outs.map(d).join(' ')}] [${outs.join(' ')}] ${sub}_out
.model ${sub}_g ${model}
${bridges(sub)}
.ends ${sub}`
  return {
    id: 'std:' + sub, name, category: 'Digital', kind, description: `${description}; value vdd=<logic high> tpd=<delay>`, value: 'vdd=5 tpd=10n',
    spice: { type: 'subckt', name: sub, pins, pinMap: pins.map((_, i) => i), text },
    params: { 'Logic levels': '0 V / vdd (default 5 V)', 'Input threshold': 'vdd/2', Delay: 'tpd (default 10 ns) + 1 ns edges' },
    source: 'bundled'
  }
}
const gate = (kind: DigitalKind, name: string, fn: string, what: string) =>
  part(kind, name, `2-input ${what} gate`, ['a', 'b'], ['y'], '[da db] dy', `${fn}(rise_delay={tpd} fall_delay={tpd})`)

export const DIGITAL_PARTS: LibEntry[] = [
  gate('and2', 'AND2', 'd_and', 'AND'),
  gate('nand2', 'NAND2', 'd_nand', 'NAND'),
  gate('or2', 'OR2', 'd_or', 'OR'),
  gate('nor2', 'NOR2', 'd_nor', 'NOR'),
  gate('xor2', 'XOR2', 'd_xor', 'XOR'),
  part('inv', 'INV', 'Inverter', ['a'], ['y'], 'da dy', 'd_inverter(rise_delay={tpd} fall_delay={tpd})'),
  part('buf', 'BUF', 'Buffer', ['a'], ['y'], 'da dy', 'd_buffer(rise_delay={tpd} fall_delay={tpd})'),
  part('dff', 'DFF', 'D flip-flop, rising-edge clock, Q = 0 at start', ['d', 'clk'], ['q', 'qn'], 'dd dclk NULL NULL dq dqn',
    'd_dff(clk_delay={tpd} set_delay={tpd} reset_delay={tpd} ic=0)')
]
