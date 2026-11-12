// App preferences: one JSON file in userData, owned by main (main/prefs.ts), pushed live to every window.
// Pure (no React, no Electron) so main and node --test load it.
import type { ProjectSim } from './contracts.ts'
import { COMPATS } from './project/project.ts'
import { cleanKeys } from './shortcuts.ts'

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
  keys: Record<string, string> // changed keyboard shortcuts by command id (shortcuts.ts); '' = none
  uiScale: number // whole-interface zoom, 1 = 100 %
  editorFont: number // netlist editor text size in px; 0 = the default
  gridStyle: 'dots' | 'lines'
  labelSize: 's' | 'm' | 'l' // part name/value text on the schematic
  lineWeight: 'thin' | 'normal' | 'bold' // symbol and wire strokes
  wheel: 'pan' | 'zoom' // what a plain scroll wheel does on the schematic (Ctrl+wheel / pinch always zooms)
  live: boolean // waveforms fill in while a simulation runs
  plotWidth: number // trace thickness in px
}
export const DEFAULT_PREFS: Prefs = { theme: 'dark', autosave: true, autosaveSecs: 30, sim: {}, projectDir: '', grid: true, showOp: true, ngspicePath: '', keys: {},
  uiScale: 1, editorFont: 0, gridStyle: 'dots', labelSize: 'm', lineWeight: 'normal', wheel: 'pan', live: true, plotWidth: 1.5 }
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5], EDITOR_FONTS = [0, 11, 12, 13, 14, 16, 18], PLOT_WIDTHS = [1, 1.5, 2, 3]
export const AUTOSAVE_MIN = 5, AUTOSAVE_MAX = 600

// anything (a hand-edited file, a renderer patch) -> valid Prefs; unknown keys dropped, bad values back to their defaults
const one = <T,>(ok: readonly T[], v: unknown, dflt: T): T => (ok.includes(v as T) ? (v as T) : dflt)
export function cleanPrefs(x: unknown): Prefs {
  const p = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, any>) : {}
  const d = DEFAULT_PREFS, bool = (k: 'autosave' | 'grid' | 'showOp' | 'live') => (typeof p[k] === 'boolean' ? p[k] : d[k])
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
    ngspicePath: str('ngspicePath'),
    keys: cleanKeys(p.keys),
    uiScale: one(UI_SCALES, p.uiScale, d.uiScale),
    editorFont: one(EDITOR_FONTS, p.editorFont, d.editorFont),
    gridStyle: one(['dots', 'lines'] as const, p.gridStyle, d.gridStyle),
    labelSize: one(['s', 'm', 'l'] as const, p.labelSize, d.labelSize),
    lineWeight: one(['thin', 'normal', 'bold'] as const, p.lineWeight, d.lineWeight),
    wheel: one(['pan', 'zoom'] as const, p.wheel, d.wheel),
    live: bool('live'),
    plotWidth: one(PLOT_WIDTHS, p.plotWidth, d.plotWidth)
  }
}
