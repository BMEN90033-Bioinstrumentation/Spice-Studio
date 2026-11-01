// Schematic symbols. Local coords, y down, grid = 10. Pins are listed in SPICE
// node order (what the netlister will emit), and must sit on grid multiples so
// they stay on-grid after 90° rotations.

export type Kind =
  | 'res' | 'cap' | 'ind' | 'vsrc' | 'isrc' | 'diode'
  | 'npn' | 'pnp' | 'nmos' | 'pmos' | 'opamp' | 'gnd' | 'label'
  | 'port' | 'block' | 'opamp5' | 'zener' | 'led' | 'njf' | 'pjf'

export interface SymbolDef {
  title: string
  prefix: string // SPICE element letter; '' for gnd/label (not elements)
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
  }
}

export const PALETTE: Kind[] = ['res', 'cap', 'ind', 'vsrc', 'isrc', 'diode', 'zener', 'led', 'npn', 'pnp', 'njf', 'pjf', 'nmos', 'pmos', 'opamp', 'gnd', 'label', 'port']
export const isFlag = (k: Kind) => k === 'gnd' || k === 'label' || k === 'port' // connect nets, not SPICE elements
