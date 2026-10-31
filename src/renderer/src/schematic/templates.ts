// Starter projects for the home page. Each is a set of sheets; 'main.nsch' is the top.
// Library parts reference bundled entry ids (resolved by the netlister through NetCtx.lib).
import { blockShape, emptySheet, exampleSheet, newPart, route, sheetPorts, uid, type Part, type Pt, type Sheet } from './model.ts'
import type { Kind } from './symbols.ts'

export interface Template { id: string; name: string; description: string; sheets: Record<string, Sheet> }

// tiny drawing helper: parts by position, wires as orthogonal polylines through the given points
function draw(f: (add: (kind: Kind, x: number, y: number, rot?: number, value?: string, extra?: Partial<Part>) => Part, wire: (...pts: [number, number][]) => void, s: Sheet) => void): Sheet {
  const s = emptySheet()
  const add = (kind: Kind, x: number, y: number, rot = 0, value?: string, extra?: Partial<Part>) => {
    const p = newPart(s, kind, x, y, rot, false, value == null ? extra : { value, ...extra })
    s.parts.push(p)
    return p
  }
  const wire = (...pts: [number, number][]) => {
    for (let i = 1; i < pts.length; i++) {
      const a: Pt = { x: pts[i - 1][0], y: pts[i - 1][1] }, b: Pt = { x: pts[i][0], y: pts[i][1] }
      s.wires.push(...route(a, b, a.x === b.x))
    }
  }
  f(add, wire, s)
  return s
}
const note = (s: Sheet, x: number, y: number, text: string) => s.texts.push({ id: uid(), x, y, text })
const UP = 3, DOWN = 1, LEFT = 2 // flag orientations

function commonEmitter(): Sheet {
  return draw((add, wire, s) => {
    add('vsrc', 0, 0, 0, 'DC 12')
    add('label', 0, -30, UP, 'vcc')
    add('gnd', 0, 30)
    add('vsrc', 120, 60, 0, 'DC 0 AC 1 SIN(0 10m 1k)')
    add('label', 120, 0, UP, 'in')
    wire([120, 30], [120, 0], [150, 0])
    add('cap', 180, 0, 3, '10u')
    wire([210, 0], [240, 0], [280, 0])
    add('res', 240, -60, 0, '56k')
    add('res', 240, 60, 0, '10k')
    wire([240, -30], [240, 0], [240, 30])
    add('label', 240, -90, UP, 'vcc')
    wire([240, -90], [320, -90])
    add('res', 320, -60, 0, '4.7k')
    add('npn', 300, 0, 0, '2N3904', { lib: 'std:2N3904' })
    wire([320, -30], [380, -30])
    add('label', 380, -30, 0, 'out')
    add('res', 320, 60, 0, '1k')
    add('cap', 380, 60, 0, '100u')
    wire([320, 30], [380, 30])
    wire([120, 90], [240, 90], [320, 90], [380, 90])
    add('gnd', 320, 90)
    note(s, 0, 130, '.tran 10u 5m\n.ac dec 20 10 10meg')
  })
}

function invertingAmp(): Sheet {
  return draw((add, wire, s) => {
    add('vsrc', 120, 30, 0, 'DC 0 AC 1 SIN(0 0.1 1k)')
    add('label', 120, -10, UP, 'in')
    add('gnd', 120, 60)
    wire([120, 0], [120, -10], [170, -10])
    add('res', 200, -10, 3, '10k')
    wire([230, -10], [250, -10], [270, -10])
    wire([250, -10], [250, -90], [270, -90])
    add('res', 300, -90, 3, '100k')
    wire([330, -90], [360, -90], [360, 0])
    add('opamp5', 300, 0, 0, 'OA_GENERIC', { lib: 'std:OA_GENERIC' })
    wire([340, 0], [360, 0])
    add('label', 360, 0, 0, 'out')
    wire([270, 10], [250, 10], [250, 30])
    add('gnd', 250, 30)
    add('label', 300, -30, UP, 'vcc')
    add('label', 300, 30, DOWN, 'vee')
    add('vsrc', 0, 140, 0, 'DC 12')
    add('label', 0, 110, UP, 'vcc')
    add('gnd', 0, 170)
    add('vsrc', 60, 140, 0, 'DC -12')
    add('label', 60, 110, UP, 'vee')
    add('gnd', 60, 170)
    note(s, 140, 110, '.tran 10u 3m\n.ac dec 20 10 10meg')
  })
}

function filterSheet(): Sheet {
  return draw((add, wire) => {
    add('port', 0, -60, LEFT, 'in')
    add('res', 30, -60, 3, '1k')
    wire([60, -60], [120, -60], [180, -60])
    add('cap', 120, -30, 0, '100n')
    add('gnd', 120, 0)
    add('port', 180, -60, 0, 'out')
  })
}

function hierMain(filter: Sheet): Sheet {
  const blk = () => ({ sheet: 'filter.nsch', ...blockShape(sheetPorts(filter)) }) // fresh pins per instance
  return draw((add, wire, s) => {
    add('vsrc', 0, 0, 0, 'DC 0 AC 1 PULSE(0 1 0 1u 1u 1m 2m)')
    add('gnd', 0, 30)
    add('label', 0, -60, UP, 'in')
    wire([0, -30], [0, -60], [60, -60])
    add('block', 120, -60, 0, 'filter', blk())
    wire([180, -60], [210, -60], [240, -60])
    add('label', 210, -60, UP, 'mid')
    add('block', 300, -60, 0, 'filter', blk())
    wire([360, -60], [400, -60])
    add('label', 400, -60, 0, 'out')
    note(s, 0, 70, '.ac dec 50 10 1meg\n.tran 5u 4m')
  })
}

const filter = filterSheet()
export const TEMPLATES: Template[] = [
  { id: 'rc', name: 'RC low-pass', description: 'First-order RC filter with transient and AC analyses.', sheets: { 'main.nsch': exampleSheet() } },
  { id: 'bjt-ce', name: 'BJT common-emitter', description: '2N3904 amplifier with divider bias and emitter bypass, 12 V supply.', sheets: { 'main.nsch': commonEmitter() } },
  { id: 'opamp-inv', name: 'Op-amp inverting amplifier', description: 'Gain of −10 with a 1 MHz GBW op-amp on ±12 V supplies.', sheets: { 'main.nsch': invertingAmp() } },
  {
    id: 'hier', name: 'Hierarchical filter', description: 'Two instances of a reusable RC block (filter.nsch) in cascade.',
    sheets: { 'main.nsch': hierMain(filter), 'filter.nsch': filter }
  }
]
