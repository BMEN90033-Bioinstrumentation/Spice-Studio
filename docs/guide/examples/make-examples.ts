// Regenerates the guide's example projects: node docs/guide/examples/make-examples.ts docs/guide/examples
// (new part ids each time; the circuits and layouts are fixed here).
const R = new URL('../../../src/renderer/src', import.meta.url).href
const { blockShape, emptySheet, newPart, pins, route, sheetPorts, uid, unconnectedPins } = await import(R + '/schematic/model.ts')
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

// ECG front end, one sheet per stage: body & 3 electrodes (RA, LA, RL) -> 3-op-amp instrumentation amp (G = 11) and
// right-leg drive -> 0.5-40 Hz band-pass (G = 101) -> 10 Hz QRS high-pass + comparator -> 150 ms one-shot -> LED.
{
  const H = 3 // horizontal resistor/cap
  const FLIP = { mirror: true } // with rot 2: vertical flip, in+ on top
  // op-amp / comparator with its supply flags (power flags are global, so sub-sheets share the top sheet's VCC/VEE)
  const opamp = (add: any) => (x: number, y: number, model: string, flip = false, lib = 'std:OA_RRO') => {
    add('opamp5', x, y, flip ? 2 : 0, model, { lib, ...(flip && FLIP) })
    add('power', x, flip ? y + 30 : y - 30, flip ? 2 : 0, 'VCC')
    add('power', x, flip ? y - 30 : y + 30, flip ? 0 : 2, 'VEE')
  }
  const body = draw((add, wire, note) => {
    // heart dipole between RA and the body, 50 Hz mains coupled in through 2 pF, 200 pF body-to-earth
    add('bv', -300, -70, 2, 'V=0.2+1m*(0.15*exp(-((time-floor(time*HR/60)*60/HR-0.10)/0.025)**2)' +
      '-0.15*exp(-((time-floor(time*HR/60)*60/HR-0.185)/0.008)**2)+1.2*exp(-((time-floor(time*HR/60)*60/HR-0.20)/0.010)**2)' +
      '-0.25*exp(-((time-floor(time*HR/60)*60/HR-0.215)/0.008)**2)+0.3*exp(-((time-floor(time*HR/60)*60/HR-0.42)/0.040)**2))')
    wire([-300, -40], [-300, 260])
    add('label', -300, 60, 0, 'body')
    wire([-300, 60], [-360, 60])
    add('cap', -360, 90, 0, '2p')
    add('vsrc', -360, 150, 0, 'DC 0 SIN(0 325 50)')
    add('gnd', -360, 180)
    add('cap', -300, 290, 0, '200p')
    add('gnd', -300, 320)
    // AC test source in series with the heart: 0 V in .tran, 1 V lead I in .ac (frequency response)
    add('vsrc', -300, -130, 2, 'DC 0 AC 1')
    // electrode-skin impedances (deliberately mismatched)
    wire([-300, -160], [-270, -160], [-270, -100]); add('res', -240, -100, H, '47k')
    wire([-300, 160], [-270, 160]); add('res', -240, 160, H, '56k')
    wire([-300, 260], [-270, 260]); add('res', -240, 260, H, '51k')
    wire([-210, -100], [-180, -100]); add('port', -180, -100, 0, 'RA')
    wire([-210, 160], [-180, 160]); add('port', -180, 160, 0, 'LA')
    wire([-210, 260], [-180, 260]); add('port', -180, 260, 0, 'RL')
    note(-440, 360, '* Patient: ECG (heart rate HR, set on the top sheet) between RA and the body, RA half-cell\n' +
      '* offset 0.2 V, 325 V mains through 2 pF, 200 pF body-to-earth; electrodes 47k / 56k / 51k')
  })
  const inamp = draw((add, wire, note) => {
    const oa = opamp(add)
    // input buffers U1 (RA) / U2 (LA), gain 1 + 2*22k/(2*2.2k) = 11; the split gain resistor's midpoint is the common mode
    add('port', -40, -100, LEFT, 'RA'); wire([-40, -100], [10, -100])
    add('port', -40, 160, LEFT, 'LA'); wire([-40, 160], [10, 160])
    oa(40, -90, 'OA_RRO', true)
    wire([80, -90], [80, -30], [70, -30]); add('res', 40, -30, H, '22k'); wire([10, -30], [10, -80])
    add('res', 10, 0, 0, '2.2k'); add('res', 10, 60, 0, '2.2k')
    wire([10, 30], [-20, 30]); add('port', -20, 30, LEFT, 'cm')
    oa(40, 150, 'OA_RRO')
    wire([80, 150], [80, 90], [70, 90]); add('res', 40, 90, H, '22k'); wire([10, 90], [10, 140])
    // difference amp U3, unity: ina = V(LA buffer) - V(RA buffer)
    wire([80, -90], [120, -90]); add('res', 150, -90, H, '10k'); wire([180, -90], [200, -90], [200, 20], [230, 20])
    wire([200, -40], [230, -40]); add('res', 260, -40, H, '10k'); wire([290, -40], [320, -40], [320, 30])
    wire([80, 150], [120, 150]); add('res', 150, 150, H, '10k'); wire([180, 150], [210, 150], [210, 60], [230, 60])
    wire([230, 40], [230, 70]); add('res', 230, 100, 0, '10k'); add('gnd', 230, 130)
    oa(260, 30, 'OA_RRO')
    wire([300, 30], [360, 30]); add('port', 360, 30, 0, 'ina')
    note(-40, 220, '* 3-op-amp instrumentation amp from discrete op-amps: buffers U1/U2 (G = 11), difference amp U3 (G = 1)\n' +
      '* cm: common-mode voltage for the right-leg drive')
  })
  const rld = draw((add, wire, note) => {
    // U4: -10 x common mode back into the body, 16 Hz rolloff, 100k limits patient current
    add('port', -40, 310, LEFT, 'cm'); wire([-40, 310], [-20, 310]); add('res', 10, 310, H, '100k'); wire([40, 310], [70, 310])
    wire([50, 310], [50, 220], [70, 220]); wire([50, 250], [70, 250])
    add('cap', 100, 220, H, '10n'); add('res', 100, 250, H, '1Meg')
    wire([130, 220], [160, 220], [160, 320]); wire([130, 250], [160, 250])
    opamp(add)(100, 320, 'OA_RRO')
    add('gnd', 70, 330)
    wire([140, 320], [190, 320]); add('res', 220, 320, H, '100k'); add('port', 250, 320, 0, 'RL')
    note(-40, 390, '* Right-leg drive: inverts the common mode (×−10) and drives it into the body through RL,\n' +
      '* cancelling mains pickup (body: ~3 Vpp without it, ~19 mVpp with it)')
  })
  const bandpass = draw((add, wire, note) => {
    // 0.48 Hz AC coupling, U5 gain 101 with a 41 Hz low-pass in the feedback
    add('port', 350, 30, LEFT, 'in'); wire([350, 30], [380, 30])
    add('cap', 410, 30, H, '3.3u'); add('res', 440, 60, 0, '100k'); add('gnd', 440, 90)
    wire([440, 30], [470, 30])
    wire([470, 10], [460, 10], [460, -80], [470, -80]); wire([460, -80], [460, -110], [470, -110])
    add('res', 500, -80, H, '100k'); add('cap', 500, -110, H, '39n')
    wire([530, -110], [560, -110], [560, 20]); wire([530, -80], [560, -80])
    wire([460, -40], [440, -40]); add('res', 410, -40, H, '1k'); add('gnd', 380, -40)
    opamp(add)(500, 20, 'OA_RRO')
    wire([540, 20], [610, 20]); add('port', 610, 20, 0, 'out')
    note(350, 140, '* Band-pass 0.48–41 Hz, gain 101: 3.3u/100k AC coupling removes the electrode offset,\n' +
      '* 39n across the 100k feedback rolls off above 41 Hz')
  })
  const detector = draw((add, wire, note) => {
    // 10 Hz high-pass kills P/T waves and drift, U6 fires above the 0.38 V threshold
    add('port', 580, 20, LEFT, 'in'); wire([580, 20], [610, 20])
    add('cap', 640, 20, H, '100n'); add('res', 670, 50, 0, '150k'); add('gnd', 670, 80)
    wire([670, 20], [710, 20])
    add('label', 670, 20, UP, 'qrs')
    wire([710, 40], [710, 110]); wire([710, 90], [730, 90])
    add('res', 760, 90, H, '120k'); add('power', 790, 90, 0, 'VCC')
    add('res', 710, 140, 0, '10k'); add('gnd', 710, 170)
    add('label', 710, 90, LEFT, 'thr')
    opamp(add)(740, 30, 'CMP_OC', false, 'std:CMP_OC')
    wire([780, 30], [820, 30]); add('port', 820, 30, 0, 'out')
    note(580, 210, '* QRS detector: 10 Hz high-pass (100n/150k), comparator fires while qrs > thr (0.38 V,\n' +
      '* tune with the 120k). Open-collector output: the pull-up is in the one-shot')
  })
  const oneshot = draw((add, wire, note) => {
    // U6 (detector) dumps Ct to VEE, 1Meg recharges it; U7 holds the LED on while trig < 0 (~0.7 RC = 150 ms)
    add('port', 790, 30, LEFT, 'trig'); wire([790, 30], [820, 30]); wire([820, 30], [860, 30], [890, 30])
    add('res', 820, 0, 0, '1Meg'); add('power', 820, -30, 0, 'VCC')
    add('cap', 860, 60, 0, '220n'); add('gnd', 860, 90)
    opamp(add)(920, 40, 'CMP_OC', true, 'std:CMP_OC')
    add('gnd', 890, 50)
    wire([960, 40], [980, 40])
    add('led', 980, 10, 0, 'LED_RED', { lib: 'std:LED_RED' }); add('res', 980, -50, 0, '560'); add('power', 980, -80, 0, 'VCC')
    // 10k bleed across the LED: the comparator model has no output leakage, so the off LED's cathode would float
    wire([980, -20], [1020, -20]); wire([980, 40], [1020, 40]); add('res', 1020, 10, 0, '10k')
    add('label', 1020, -20, 0, 'led_a'); add('label', 980, 40, DOWN, 'led_k')
    note(790, 150, '* One-shot: each detection pulls trig to VEE, the 1Meg/220n recharge holds the LED on ~150 ms\n' +
      '* (one clean flash per beat). LED ≈ 14 mA through 560 Ω; 10k bleed sets its off-state voltage')
  })
  // numbered in signal order: the sheet list reads body -> LED
  const sheets: Record<string, any> = { '1-body.nsch': body, '2-inamp.nsch': inamp, '3-rld.nsch': rld, '4-bandpass.nsch': bandpass, '5-detector.nsch': detector, '6-led.nsch': oneshot }
  const main = draw((add, wire, note) => {
    const blk = (file: string, name: string, title: string, x: number, y: number, shape = blockShape(sheetPorts(sheets[file]))) =>
      add('block', x, y, 0, title, { sheet: file, name, ...shape })
    const at = (p: any, n: string): P => { const q = pins(p)[p.pins.findIndex((v: any) => v.name === n)]; return [q.x, q.y] }
    // patient block: all three electrodes on its right edge
    const bod = blk('1-body.nsch', 'XBODY', 'Body', 0, 0, { size: { w: 100, h: 80 }, pins: [{ name: 'RA', x: 70, y: -20 }, { name: 'LA', x: 70, y: 0 }, { name: 'RL', x: 70, y: 20 }] })
    const ina = blk('2-inamp.nsch', 'XINA', 'In-amp', 220, -10)
    const drv = blk('3-rld.nsch', 'XRLD', 'RLD', 220, 110)
    const bpf = blk('4-bandpass.nsch', 'XBPF', 'Band-pass', 400, 0)
    const det = blk('5-detector.nsch', 'XDET', 'Detector', 580, 0)
    const led = blk('6-led.nsch', 'XLED', 'One-shot', 760, 0)
    const mid = (a: P, b: P, x: number, name: string, rot: number) => (wire(a, [x, a[1]]), wire([x, a[1]], b), add('label', x, a[1], rot, name))
    mid(at(bod, 'RA'), at(ina, 'RA'), 110, 'RA', UP)
    mid(at(bod, 'LA'), at(ina, 'LA'), 110, 'LA', DOWN)
    add('label', ...at(ina, 'cm'), UP, 'cm'); add('label', ...at(drv, 'cm'), LEFT, 'cm')
    { const [x, y] = at(drv, 'RL'), [bx, by] = at(bod, 'RL'); wire([x, y], [x + 20, y], [x + 20, y + 40], [bx + 20, y + 40], [bx + 20, by], [bx, by]) }
    add('label', 90, 150, DOWN, 'RL')
    mid(at(ina, 'ina'), at(bpf, 'in'), 320, 'ina', UP)
    mid(at(bpf, 'out'), at(det, 'in'), 490, 'ecg', UP)
    mid(at(det, 'out'), at(led, 'trig'), 670, 'tmr', UP)
    // supplies: VCC / VEE flags on every sheet are these nets (power flags are global)
    add('vsrc', 420, 130, 0, 'DC 5'); add('power', 420, 100, 0, 'VCC'); add('gnd', 420, 160)
    add('vsrc', 500, 130, 0, 'DC -5'); add('power', 500, 100, 0, 'VEE'); add('gnd', 500, 160)
    note(-60, 200, '* HR = heart rate (bpm), used by sheet 1-body\n.param HR=72\n.tran 0.5m 6 0 0.5m\n.ac dec 50 10m 1k\n' +
      '* gear: the 0.5 ms step is far longer than the LED node\'s ~0.4 µs time constant,\n' +
      '* which makes the default trapezoidal method ring (±11 mV, sign flips every step)\n.options method=gear')
    note(-60, 330, '* plotted on Run, one chart per line; text after ; is its title. xdet.qrs = net qrs inside block XDET\n' +
      '.plot tran v(la,ra) ; Electrodes: lead I (LA − RA) at the skin\n' +
      '.plot tran v(ina) v(ecg) ; Amplified: instrumentation amp (×11) and 0.5–40 Hz band (×1111)\n' +
      '.plot tran v(xdet.qrs) v(xdet.thr) v(tmr) ; Detection: QRS vs threshold, 150 ms one-shot\n' +
      '.plot tran I(XLED.D1) v(xled.led_a,xled.led_k) ; LED current and voltage\n' +
      '.plot ac v(ina) v(ecg) v(xdet.qrs) ; Frequency response: gain from the electrodes (1 V AC, lead I)')
    note(-60, 450, '* detected rate from the one-shot (0.833 s = 72 bpm)\n.meas tran beat TRIG v(tmr) VAL=0 FALL=2 TARG v(tmr) VAL=0 FALL=3')
  })
  ex['ECG-Frontend'] = { 'main.nsch': main, ...sheets }
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
