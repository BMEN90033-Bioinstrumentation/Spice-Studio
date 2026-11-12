// App preferences: one JSON file in userData, owned by main (main/prefs.ts), pushed live to every window.
// Pure (no React, no Electron) so main and node --test load it.
import type { ProjectSim } from './contracts.ts'
import { COMPATS } from './project/project.ts'

export type Theme = 'dark' | 'light' | 'system'
export interface Prefs {
  theme: Theme
  autosave: boolean // recovery copies of unsaved work (Recovery.tsx)
  autosaveSecs: number
  sim: ProjectSim // run settings for new projects and loose files
  projectDir: string // where New project puts projects; '' = Documents/Spice Studio
  grid: boolean // schematic grid dots
  showOp: boolean // OP values on the schematic after a run (the canvas' OP toggle starts here)
  ngspicePath: string // '' = bundled (or NGSPICE_PATH / Homebrew / PATH)
}
export const DEFAULT_PREFS: Prefs = { theme: 'dark', autosave: true, autosaveSecs: 30, sim: {}, projectDir: '', grid: true, showOp: true, ngspicePath: '' }
export const AUTOSAVE_MIN = 5, AUTOSAVE_MAX = 600

// anything (a hand-edited file, a renderer patch) -> valid Prefs; unknown keys dropped, bad values back to their defaults
export function cleanPrefs(x: unknown): Prefs {
  const p = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, any>) : {}
  const d = DEFAULT_PREFS, bool = (k: 'autosave' | 'grid' | 'showOp') => (typeof p[k] === 'boolean' ? p[k] : d[k])
  const str = (k: 'projectDir' | 'ngspicePath') => (typeof p[k] === 'string' ? p[k].trim() : d[k])
  const secs = Number(p.autosaveSecs), s = p.sim && typeof p.sim === 'object' ? p.sim : {}, t = Number(s.timeoutS)
  return {
    theme: ['dark', 'light', 'system'].includes(p.theme) ? p.theme : d.theme,
    autosave: bool('autosave'),
    autosaveSecs: Number.isFinite(secs) ? Math.round(Math.min(AUTOSAVE_MAX, Math.max(AUTOSAVE_MIN, secs))) : d.autosaveSecs,
    sim: { ...(COMPATS.includes(s.compat) && { compat: s.compat }), ...(t > 0 && Number.isFinite(t) && { timeoutS: t }) },
    projectDir: str('projectDir'),
    grid: bool('grid'),
    showOp: bool('showOp'),
    ngspicePath: str('ngspicePath')
  }
}
