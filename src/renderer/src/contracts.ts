// Phase 9 shared contracts: types only, imported by the main process, preload and renderer. Pure TS.

// ngspice compatibility mode, passed as `-D ngbehavior=<compat>` (PSpice / LTspice / both / KiCad-flavoured models)
export type Compat = 'ps' | 'lt' | 'ltps' | 'kicad'
export interface SimOptions {
  compat?: Compat
  timeoutS?: number // kill the run after this many seconds; 0/undefined = no limit
}
// SimResult.stopped: the run was killed by sim:stop ('user') or by timeoutS ('timeout')
export type Stopped = 'user' | 'timeout'

// project-level simulation settings, stored as the optional Project.sim in the .nsproj
export interface ProjectSim {
  compat?: Compat
  timeoutS?: number
}

// .meas results parsed from ngspice -b stdout ("name = 1.234e-05 targ= ... trig= ..."); value null = failed measurement
export interface Measurement { name: string; value: number | null; text: string }
export type MeasTable = { label: string; rows: Measurement[] }[] // one entry per run (sweep / Monte Carlo); label '' for a single run

// convergence help: a recognised failure in the ngspice log and one-click fixes (each adds an .options line)
export interface Diagnosis { problem: string; fixes: { label: string; options: string }[] }

// Plot selection convention: a `sels` entry starting with '=' is a maths expression evaluated by Plot over the plot's
// vectors, e.g. '=v(a)-v(b)', '=v(out)*i(r1)', '=db(v(out)/v(in))'. Everything else is a raw vector name (lowercase).
export const isExpr = (sel: string) => sel.startsWith('=')

// file save filters for export:save / export:pdf
export type Filter = { name: string; extensions: string[] }
