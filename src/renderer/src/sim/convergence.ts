// Convergence help: recognise ngspice-47 failures in a run log and suggest .options fixes. Pure TS.
// Messages captured from real ngspice-47 runs (see test/convergence.test.ts for the circuits and logs).
import type { Diagnosis } from '../contracts.ts'

const OP_FIXES = [
  { label: 'More iterations, finer source stepping', options: 'itl1=1000 srcsteps=100' },
  { label: 'More iterations, finer gmin stepping', options: 'itl1=1000 gminsteps=100' },
  { label: 'Larger minimum conductance', options: 'gmin=1e-10 itl1=500' }
]

export function diagnose(log: string): Diagnosis[] {
  const out: Diagnosis[] = []
  const who = (re: RegExp) => re.exec(log)?.[1]?.toUpperCase()

  // "Warning: singular matrix:  check node b" / "check nodes a and b"; a #branch node = a voltage source / inductor loop
  const sm = /singular matrix:\s+check nodes? (\S+)(?: and (\S+))?/i.exec(log)
  if (sm) {
    const br = /^(.+)#branch$/i.exec(sm[1])
    out.push(br
      // ponytail: no option fixes a source loop; the circuit itself has to change
      ? { problem: `Singular matrix at ${br[1].toUpperCase()}: voltage sources or inductors form a loop with no resistance, or a source is shorted.`, fixes: [] }
      : { problem: `Singular matrix at node ${sm[2] ? sm[1] + ' / ' + sm[2] : sm[1]}: it has no DC path to ground (floating, or only capacitors / current sources).`,
          fixes: [{ label: 'Add a 1 TΩ resistor from every node to ground', options: 'rshunt=1e12' }] })
  }

  // OP failure: all stepping and the transient-op fallback failed, or the plain iteration limit was hit
  const opDead = /operating point could not be simulated|Transient op failed|DC solution failed|iteration limit reached|Too many iterations without convergence/i.test(log)
  const stepping = /(gmin|source) stepping failed/i.test(log)
  if (opDead || stepping) {
    const d = who(/(?:OP:|initial timepoint).*?trouble with \S*?-instance (\S+)/i)
    out.push({
      problem: opDead
        ? `No convergence in the DC operating point${d ? ` (trouble with ${d})` : ''}.`
        : 'The DC operating point needed ngspice\'s fallbacks: gmin and source stepping failed before a transient ramp found it.',
      fixes: OP_FIXES
    })
  }

  // "doAnalyses: TRAN:  Timestep too small; time = 0.002, timestep = 1.25e-18: trouble with dmod-instance d1"
  const ts = /Timestep too small; time = ([^,\s]+)(?:.*?trouble with \S*?-instance (\S+))?/i.exec(log)
  if (ts) {
    out.push({
      problem: `Transient timestep too small at t = ${ts[1]} s${ts[2] ? ` (trouble with ${ts[2].toUpperCase()})` : ''}: the circuit has an edge the solver can't follow.`,
      fixes: [
        { label: 'Add 1 pF from every node to ground', options: 'cshunt=1e-12' },
        { label: 'Use Gear integration (damps ringing)', options: 'method=gear' },
        { label: 'Loosen the tolerance, allow more iterations per step', options: 'reltol=3e-3 itl4=100' }
      ]
    })
  }
  return out
}
