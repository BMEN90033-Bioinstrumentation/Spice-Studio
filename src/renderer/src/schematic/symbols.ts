// Schematic symbols. Local coords, y down, grid = 10. Pins are listed in SPICE
// node order (what the netlister will emit), and must sit on grid multiples so
// they stay on-grid after 90° rotations.

export type Kind =
  | 'res' | 'cap' | 'ind' | 'vsrc' | 'isrc' | 'diode'
  | 'npn' | 'pnp' | 'nmos' | 'pmos' | 'opamp' | 'gnd' | 'label'
  | 'port' | 'block' | 'opamp5' | 'zener' | 'led' | 'njf' | 'pjf'
  | 'vcvs' | 'vccs' | 'ccvs' | 'cccs' | 'bv' | 'bi' | 'sw' | 'csw' | 'tline' | 'xfmr' | 'kcouple' | 'power' | 'pot' | 'xtal'
  | 'bustap'

export interface SymbolDef {
  title: string
  prefix: string // SPICE element letter ('' for flags); nextName prefix for the composites (xfmr XF, pot RV, xtal Y)
  value: string // default value / model
  key?: string // placement shortcut
  pins: { x: number; y: number }[] // 'block' has none: instances carry their own (Part.pins)
  pinNames?: string[] // display names, same order as pins
  path: string // stroked
  fill?: string // filled (arrowheads, diode body)
  circle?: number // radius of a circle at origin
}

const diodeBody = { pins: [{ x: 0, y: -30 }, { x: 0, y: 30 }], pinNames: ['A', 'K'] }
const npnBody = 'M-20 0H-5M-5 -15V15M-5 -6L20 -20V-30M-5 6L20 20V30'
const mosBody = 'M-20 0H-8M-8 -12V12M-3 -15V15M-3 -10H20V-30M-3 10H20V30'
// dependent sources: diamond, out+ top / out- bottom; 4-pin ones add ctrl+ / ctrl- stubs on the left (+ / - marked)
const two = [{ x: 0, y: -30 }, { x: 0, y: 30 }]
const four = { pins: [{ x: 0, y: -30 }, { x: 0, y: 30 }, { x: -30, y: -10 }, { x: -30, y: 10 }] }
const diamond = 'M0 -30V-14M0 14V30M0 -14L14 0L0 14L-14 0Z'
const ctrl = 'M-30 -10H-20M-30 10H-20M-27 -16H-23M-25 -18V-14M-27 16H-23'
const vMark = 'M0 -9V-3M-3 -6H3M-3 6H3', iMark = 'M0 -8V4', iArrow = 'M-3 2L0 8L3 2Z'
const box = 'M0 -30V-14M0 14V30M-12 -14H12V14H-12Z' // behavioural: square body
const lever = 'M0 -30V-12M0 12V30M0 12L-9 -9'

export const SYMBOLS: Record<Kind, SymbolDef> = {
  res: {
    title: 'Resistor', prefix: 'R', value: '1k', key: 'r',
    pins: [{ x: 0, y: -30 }, { x: 0, y: 30 }],
    path: 'M0 -30V-20L6 -16.7L-6 -10L6 -3.3L-6 3.3L6 10L-6 16.7L0 20V30'
  },
  cap: {
    title: 'Capacitor', prefix: 'C', value: '1u', key: 'c',
    pins: [{ x: 0, y: -30 }, { x: 0, y: 30 }],
    path: 'M0 -30V-4M-12 -4H12M-12 4H12M0 4V30'
  },
  ind: {
    title: 'Inductor', prefix: 'L', value: '1m', key: 'l',
    pins: [{ x: 0, y: -30 }, { x: 0, y: 30 }],
    path: 'M0 -30V-20A5 5 0 0 1 0 -10A5 5 0 0 1 0 0A5 5 0 0 1 0 10A5 5 0 0 1 0 20V30'
  },
  vsrc: {
    title: 'Voltage source', prefix: 'V', value: 'DC 1', key: 'v',
    pins: [{ x: 0, y: -30 }, { x: 0, y: 30 }],
    path: 'M0 -30V-15M0 15V30M0 -11V-3M-4 -7H4M-4 7H4',
    circle: 15
  },
  isrc: {
    title: 'Current source', prefix: 'I', value: 'DC 1m', key: 'i',
    pins: [{ x: 0, y: -30 }, { x: 0, y: 30 }],
    path: 'M0 -30V-15M0 15V30M0 -9V7',
    fill: 'M-4 3L0 9L4 3Z',
    circle: 15
  },
  diode: {
    title: 'Diode', prefix: 'D', value: 'D', key: 'd', ...diodeBody,
    path: 'M0 -30V-8M-10 8H10M0 8V30',
    fill: 'M-10 -8H10L0 8Z'
  },
  npn: {
    title: 'NPN transistor', prefix: 'Q', value: 'NPN', key: 'q',
    pins: [{ x: 20, y: -30 }, { x: -20, y: 0 }, { x: 20, y: 30 }], pinNames: ['C', 'B', 'E'],
    path: npnBody,
    fill: 'M13 16L6.3 15.7L9.3 10.5Z'
  },
  pnp: {
    title: 'PNP transistor', prefix: 'Q', value: 'PNP',
    pins: [{ x: 20, y: -30 }, { x: -20, y: 0 }, { x: 20, y: 30 }], pinNames: ['C', 'B', 'E'],
    path: npnBody,
    fill: 'M2 7.7L5.7 13.2L8.7 8Z'
  },
  nmos: {
    title: 'NMOS transistor', prefix: 'M', value: 'NMOS', key: 'm',
    pins: [{ x: 20, y: -30 }, { x: -20, y: 0 }, { x: 20, y: 30 }], pinNames: ['D', 'G', 'S'],
    path: mosBody,
    fill: 'M3 10L9 7V13Z'
  },
  pmos: {
    title: 'PMOS transistor', prefix: 'M', value: 'PMOS',
    pins: [{ x: 20, y: -30 }, { x: -20, y: 0 }, { x: 20, y: 30 }], pinNames: ['D', 'G', 'S'],
    path: mosBody,
    fill: 'M10 10L4 7V13Z'
  },
  opamp: {
    title: 'Op-amp (ideal)', prefix: 'E', value: '1e6',
    pins: [{ x: 30, y: 0 }, { x: -30, y: 10 }, { x: -30, y: -10 }], pinNames: ['out', 'in+', 'in-'],
    path: 'M-20 -25L-20 25L25 0ZM-30 -10H-20M-30 10H-20M25 0H30M-16 -10H-10M-16 10H-10M-13 7V13'
  },
  gnd: {
    title: 'Ground', prefix: '', value: '', key: 'g',
    pins: [{ x: 0, y: 0 }],
    path: 'M0 0V10M-10 10H10M-6 14H6M-2 18H2'
  },
  label: {
    title: 'Net label', prefix: '', value: 'out', key: 'n',
    pins: [{ x: 0, y: 0 }],
    path: 'M0 0L5 -6H24V6H5Z'
  },
  // sheet pin: flag pointing away from its pin (a label's tag points at it)
  port: {
    title: 'Sheet port', prefix: '', value: 'in', key: 'h',
    pins: [{ x: 0, y: 0 }],
    path: 'M0 0H4M4 -6H20L26 0L20 6H4Z'
  },
  // drawn from Part.size / Part.pins by the renderer
  block: { title: 'Block', prefix: 'X', value: '', pins: [], path: '' },
  opamp5: {
    title: 'Op-amp', prefix: 'X', value: 'OA_GENERIC',
    pins: [{ x: -30, y: 10 }, { x: -30, y: -10 }, { x: 0, y: -30 }, { x: 0, y: 30 }, { x: 40, y: 0 }],
    pinNames: ['in+', 'in-', 'V+', 'V-', 'out'],
    path: 'M-20 -30V30L30 0ZM-30 -10H-20M-30 10H-20M30 0H40M0 -30V-18M0 18V30M-16 -10H-10M-16 10H-10M-13 7V13'
  },
  zener: {
    title: 'Zener diode', prefix: 'D', value: 'DZ', ...diodeBody,
    path: 'M0 -30V-8M-14 4L-10 8H10L14 12M0 8V30',
    fill: 'M-10 -8H10L0 8Z'
  },
  led: {
    title: 'LED', prefix: 'D', value: 'LED', ...diodeBody,
    path: 'M0 -30V-8M-10 8H10M0 8V30M11 -2L17.5 -8.5M11 6L17.5 -0.5',
    fill: 'M-10 -8H10L0 8ZM21 -12L15.7 -10.2L19.2 -6.7ZM21 -4L15.7 -2.2L19.2 1.3Z'
  },
  // JFETs: gate arrow points into the channel for N, out of it for P
  njf: {
    title: 'N-channel JFET', prefix: 'J', value: 'NJF',
    pins: [{ x: 20, y: -30 }, { x: -20, y: 0 }, { x: 20, y: 30 }], pinNames: ['D', 'G', 'S'],
    path: 'M-20 0H-3M-3 -15V15M-3 -10H20V-30M-3 10H20V30',
    fill: 'M-3 0L-10 -4V4Z'
  },
  pjf: {
    title: 'P-channel JFET', prefix: 'J', value: 'PJF',
    pins: [{ x: 20, y: -30 }, { x: -20, y: 0 }, { x: 20, y: 30 }], pinNames: ['D', 'G', 'S'],
    path: 'M-20 0H-3M-3 -15V15M-3 -10H20V-30M-3 10H20V30',
    fill: 'M-16 0L-9 -4V4Z'
  },
  vcvs: { title: 'VCVS (E)', prefix: 'E', value: '1', ...four, pinNames: ['out+', 'out-', 'ctrl+', 'ctrl-'], path: diamond + ctrl + vMark },
  vccs: { title: 'VCCS (G)', prefix: 'G', value: '1', ...four, pinNames: ['out+', 'out-', 'ctrl+', 'ctrl-'], path: diamond + ctrl + iMark, fill: iArrow },
  // value: controlling V source + gain ("V1 10")
  ccvs: { title: 'CCVS (H)', prefix: 'H', value: 'V1 1k', pins: two, pinNames: ['out+', 'out-'], path: diamond + vMark },
  cccs: { title: 'CCCS (F)', prefix: 'F', value: 'V1 1', pins: two, pinNames: ['out+', 'out-'], path: diamond + iMark, fill: iArrow },
  bv: { title: 'Behavioural voltage (B)', prefix: 'B', value: 'V=1', pins: two, pinNames: ['+', '-'], path: box + vMark },
  bi: { title: 'Behavioural current (B)', prefix: 'B', value: 'I=1m', pins: two, pinNames: ['+', '-'], path: box + iMark, fill: iArrow },
  // switches: lever open; S has its control as a small box on the left
  sw: {
    title: 'Voltage-controlled switch', prefix: 'S', value: 'SW', ...four, pinNames: ['sw+', 'sw-', 'ctrl+', 'ctrl-'],
    path: lever + 'M-30 -10H-24M-30 10H-24M-24 -14H-16V14H-24ZM-16 0H-13M-11 0H-8M-27 -16H-23M-25 -18V-14M-27 16H-23'
  },
  csw: { title: 'Current-controlled switch', prefix: 'W', value: 'V1 CSW', pins: two, pinNames: ['sw+', 'sw-'], path: lever + 'M10 -8V4', fill: 'M7 2L10 8L13 2Z' },
  tline: {
    title: 'Transmission line', prefix: 'T', value: 'Z0=50 TD=1n',
    pins: [{ x: -30, y: -10 }, { x: -30, y: 10 }, { x: 30, y: -10 }, { x: 30, y: 10 }], pinNames: ['port1+', 'port1-', 'port2+', 'port2-'],
    path: 'M-30 -10H-20M20 -10H30M-20 -14H20V-4H-20ZM-30 10H-16V-4M30 10H16V-4'
  },
  // two coupled inductors (netlisted as L<ref>_P, L<ref>_S, K<ref>); dots mark pri+ / sec+
  xfmr: {
    title: 'Transformer', prefix: 'XF', value: 'Lp=1m Ls=100u k=0.999',
    pins: [{ x: -30, y: -20 }, { x: -30, y: 20 }, { x: 30, y: -20 }, { x: 30, y: 20 }], pinNames: ['pri+', 'pri-', 'sec+', 'sec-'],
    path: 'M-30 -20H-10A5 5 0 0 1 -10 -10A5 5 0 0 1 -10 0A5 5 0 0 1 -10 10A5 5 0 0 1 -10 20H-30' +
      'M30 -20H10A5 5 0 0 0 10 -10A5 5 0 0 0 10 0A5 5 0 0 0 10 10A5 5 0 0 0 10 20H30M-2 -20V20M2 -20V20',
    fill: 'M-18 -14A2 2 0 1 0 -18 -10A2 2 0 1 0 -18 -14ZM18 -14A2 2 0 1 0 18 -10A2 2 0 1 0 18 -14Z'
  },
  // mutual coupling between inductors named in the value ("L1 L2 0.99"); no pins
  kcouple: { title: 'Coupling (K)', prefix: 'K', value: 'L1 L2 0.99', pins: [], path: 'M-6 -10V10M6 -10L-6 0L6 10M-12 -14A18 18 0 0 1 12 -14M-12 14A18 18 0 0 0 12 14' },
  // supply net flag: joins nets by name like a label
  power: { title: 'Power flag', prefix: '', value: 'VCC', pins: [{ x: 0, y: 0 }], path: 'M0 0V-12M-10 -12H10' },
  // library subckts (std:POT / std:XTAL); the value is their parameter list
  pot: {
    title: 'Potentiometer', prefix: 'RV', value: 'R=10k pos=0.5',
    pins: [{ x: 0, y: -30 }, { x: 20, y: 0 }, { x: 0, y: 30 }], pinNames: ['A', 'W', 'B'],
    path: 'M0 -30V-20L6 -16.7L-6 -10L6 -3.3L-6 3.3L6 10L-6 16.7L0 20V30M20 0H12',
    fill: 'M6 0L12 -3V3Z'
  },
  xtal: { title: 'Crystal', prefix: 'Y', value: 'F=10meg', pins: two, path: 'M0 -30V-10M-12 -10H12M0 10V30M-12 10H12M-8 -6H8V6H-8Z' },
  // bus entry: origin on the bus, pin on the wire; the value names the bus member (D3) and joins that net like a label
  bustap: { title: 'Bus tap', prefix: '', value: 'D0', pins: [{ x: 10, y: 10 }], path: 'M0 0L10 10' }
}

export const PALETTE: Kind[] = ['res', 'cap', 'ind', 'pot', 'xtal', 'xfmr', 'kcouple', 'tline', 'vsrc', 'isrc', 'vcvs', 'vccs', 'ccvs', 'cccs', 'bv', 'bi',
  'sw', 'csw', 'diode', 'zener', 'led', 'npn', 'pnp', 'njf', 'pjf', 'nmos', 'pmos', 'opamp', 'gnd', 'power', 'label', 'port']
export const isFlag = (k: Kind) => k === 'gnd' || k === 'label' || k === 'port' || k === 'power' || k === 'bustap' // connect nets, not SPICE elements
