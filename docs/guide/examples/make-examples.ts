// Regenerates the guide's example projects: node docs/guide/examples/make-examples.ts docs/guide/examples
// (new part ids each time; the circuits and layouts are fixed here).
const R = new URL('../../../src/renderer/src', import.meta.url).href
const { blockShape, emptySheet, newPart, route, sheetPorts, uid, unconnectedPins } = await import(R + '/schematic/model.ts')
const { netlist } = await import(R + '/schematic/netlist.ts')
const { BUNDLED, resolver } = await import(R + '/library/library.ts')
import { mkdirSync, writeFileSync } from 'node:fs'

type P = [number, number]
const UP = 3, DOWN = 1, LEFT = 2
function draw(f: (add: any, wire: (...p: P[]) => void, note: (x: number, y: number, t: string) => void) => void) {
  const s = emptySheet()
  const add = (kind: string, x: number, y: number, rot = 0, value?: string, extra?: any) => {
    const p = newPart(s, kind as any, x, y, rot, false, value == null ? extra : { value, ...extra })
    s.parts.push(p)
    return p
  }
  const wire = (...pts: P[]) => {
    for (let i = 1; i < pts.length; i++) {
      const a = { x: pts[i - 1][0], y: pts[i - 1][1] }, b = { x: pts[i][0], y: pts[i][1] }
      s.wires.push(...route(a, b, a.x === b.x))
    }
  }
  f(add, wire, (x, y, text) => s.texts.push({ id: uid(), x, y, text }))
  return s
}

// RC low-pass: V1 -> R1 -> out, C1 to ground. r = R1's value
const rc = (r: string, src: string) => (add: any, wire: any) => {
  add('vsrc', 0, 0, 0, src)
  add('gnd', 0, 30)
  add('label', 0, -60, UP, 'in')
  wire([0, -30], [0, -60], [30, -60])
  add('res', 60, -60, 3, r)
  wire([90, -60], [150, -60], [190, -60])
  wire([150, -60], [150, -30])
  add('cap', 150, 0, 0, '1u')
  add('gnd', 150, 30)
  add('label', 190, -60, 0, 'out')
}

const ex: Record<string, Record<string, any>> = {}

ex['RC-Filter'] = {
  'main.nsch': draw((add, wire, note) => {
    rc('1k', 'DC 0 AC 1 PULSE(0 1 0 1u 1u 5m 10m)')(add, wire)
    note(-10, 70, '.tran 10u 20m\n.ac dec 50 1 100k')
  })
}

ex['RC-Sweep'] = {
  'main.nsch': draw((add, wire, note) => {
    rc('{R}', 'DC 0 AC 1 PULSE(0 1 0 1u 1u 5m 10m)')(add, wire)
    note(-10, 70, '.param R=1k\n.step param R list 500 1k 2k')
    note(-10, 120, '.ac dec 50 1 100k\n.tran 10u 10m')
  })
}

ex['MonteCarlo-RC'] = {
  'main.nsch': draw((add, wire, note) => {
    rc('{R}', 'DC 0 PULSE(0 1 0 1u 1u 5m 10m)')(add, wire)
    note(-10, 70, '* R1 = 1k ±5 % (3 sigma), relative\n.param R={gauss(1k,0.05,3)}')
    note(-10, 120, '.mc 20\n.tran 10u 3m\n.meas tran t50 WHEN v(out)=0.5 RISE=1')
  })
}

ex['CE-Amplifier'] = {
  'main.nsch': draw((add, wire, note) => {
    add('vsrc', 0, 0, 0, 'DC 12')
    add('power', 0, -30, 0, 'VCC')
    add('gnd', 0, 30)
    add('vsrc', 120, 60, 0, 'DC 0 AC 1 SIN(0 10m 1k)')
    add('label', 120, 0, UP, 'in')
    wire([120, 30], [120, 0], [150, 0])
    add('cap', 180, 0, 3, '10u')
    wire([210, 0], [240, 0], [280, 0])
    add('res', 240, -60, 0, '56k')
    add('res', 240, 60, 0, '10k')
    wire([240, -30], [240, 0], [240, 30])
    add('power', 240, -90, 0, 'VCC')
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
    note(0, 130, '.op\n.tran 10u 5m\n.ac dec 20 10 10meg')
    note(0, 190, '.meas tran vpp PP v(out) from=2m to=5m')
  })
}

ex['E-Amplifier'] = {
  'main.nsch': draw((add, wire, note) => {
    add('vsrc', 0, 0, 0, 'DC 0 SIN(0 0.1 1k)')
    add('gnd', 0, 30)
    add('label', 0, -60, UP, 'in')
    wire([0, -30], [0, -60], [130, -60], [130, -10], [160, -10])
    add('vcvs', 190, 0, 0, '10')
    wire([160, 10], [130, 10], [130, 40])
    add('gnd', 130, 40)
    add('gnd', 190, 30)
    wire([190, -30], [190, -60], [270, -60], [270, -30])
    add('label', 270, -60, UP, 'out')
    add('res', 270, 0, 0, '1k')
    add('gnd', 270, 30)
    note(-10, 80, '* E1: out = 10 x (ctrl+ - ctrl-)\n.tran 10u 3m')
  })
}

ex['Flyback'] = {
  'main.nsch': draw((add, wire, note) => {
    // output stage first, so V(out) is the first vector in the results
    wire([150, 20], [190, 20])
    add('diode', 220, 20, 3, '1N4148', { lib: 'std:1N4148' })
    wire([250, 20], [290, 20], [350, 20], [380, 20])
    add('cap', 290, 50, 0, '10u')
    add('gnd', 290, 80)
    add('res', 350, 50, 0, '1k')
    add('gnd', 350, 80)
    add('label', 380, 20, 0, 'out')
    // transformer: secondary dot (sec+) to ground, so energy moves to the output while the switch is off
    add('xfmr', 120, 0, 0, 'Lp=100u Ls=400u k=0.98')
    wire([150, -20], [170, -20])
    add('gnd', 170, -20)
    // supply -> primary dot
    add('vsrc', 0, 0, 0, 'DC 12')
    add('gnd', 0, 30)
    wire([0, -30], [0, -60], [90, -60], [90, -20])
    // primary low side -> switch, with a snubber capacitor
    wire([90, 20], [60, 20], [60, 90])
    add('label', 60, 90, LEFT, 'sw')
    wire([60, 90], [110, 90])
    add('cap', 110, 120, 0, '10n') // snubber: keeps the leakage-inductance spike to ~100 V
    add('gnd', 110, 150)
    add('sw', 60, 120, 0, 'SW')
    add('gnd', 60, 150)
    // gate drive: 100 kHz, 50 % duty
    add('vsrc', -120, 140, 0, 'DC 0 PULSE(0 1 0 10n 10n 5u 10u)')
    add('gnd', -120, 170)
    wire([-120, 110], [30, 110])
    wire([30, 130], [30, 170])
    add('gnd', 30, 170)
    note(170, 130, '* 100 kHz, 50 % duty; turns ratio 1:2\n.tran 100n 2m\n.meas tran vout AVG v(out) from=1.5m to=2m')
  })
}

ex['Diode-TempSweep'] = {
  'main.nsch': draw((add, wire, note) => {
    add('vsrc', 0, 0, 0, 'DC 0')
    add('gnd', 0, 30)
    add('label', 0, -60, UP, 'in')
    wire([0, -30], [0, -60], [30, -60])
    add('res', 60, -60, 3, '1k')
    wire([90, -60], [150, -60], [190, -60])
    wire([150, -60], [150, -30])
    add('diode', 150, 0, 0, '1N4148', { lib: 'std:1N4148' })
    add('gnd', 150, 30)
    add('label', 190, -60, 0, 'a')
    note(-10, 70, '.step temp list -40 25 85\n.dc V1 0 5 0.05')
  })
}

{
  const filter = draw((add, wire) => {
    add('port', 0, -60, LEFT, 'in')
    add('res', 30, -60, 3, '1k')
    wire([60, -60], [120, -60], [180, -60])
    add('cap', 120, -30, 0, '100n')
    add('gnd', 120, 0)
    add('port', 180, -60, 0, 'out')
  })
  const blk = () => ({ sheet: 'filter.nsch', ...blockShape(sheetPorts(filter)) })
  const main = draw((add, wire, note) => {
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
    note(0, 70, '.ac dec 50 10 1meg\n.tran 5u 4m')
  })
  ex['Hier-Filter'] = { 'main.nsch': main, 'filter.nsch': filter }
}

const base = process.argv[2]
const lib = resolver(BUNDLED)
let bad = 0
for (const [name, sheets] of Object.entries(ex)) {
  const d = `${base}/${name}`
  mkdirSync(d, { recursive: true })
  for (const [f, s] of Object.entries(sheets)) {
    writeFileSync(`${d}/${f}`, JSON.stringify(s, null, 1) + '\n')
    const nc = unconnectedPins(s)
    if (nc.length) bad++, console.log(name, f, 'unconnected pins', nc)
  }
  writeFileSync(`${d}/${name}.nsproj`, JSON.stringify({ version: 1, name, top: 'main.nsch', libs: [] }, null, 1) + '\n')
  const n = netlist(sheets['main.nsch'], name, { sheets, lib })
  if (n.errors.length || n.warnings.length) bad++, console.log(name, n.errors, n.warnings)
}
console.log(bad ? `${bad} problems` : 'ok')
