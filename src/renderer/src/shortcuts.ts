// The keyboard shortcuts a user can change (Settings › Keyboard shortcuts). Pure: main (menu labels), the renderer and
// node --test load it. keys: 'Mod+Shift+K' style (Mod = ⌘ on macOS, Ctrl elsewhere), as commands.ts matches() reads them.
export interface Shortcut { id: string; title: string; group: string; keys: string }
const g = (group: string, rows: [string, string, string][]): Shortcut[] => rows.map(([id, title, keys]) => ({ id, title, group, keys }))
export const SHORTCUTS: Shortcut[] = [
  ...g('File', [['file.newProject', 'New project', 'Mod+N'], ['file.openProject', 'Open project', 'Mod+O'], ['file.openFile', 'Open file', 'Mod+Shift+O'], ['file.save', 'Save', 'Mod+S'],
    ['file.saveAs', 'Save as', 'Mod+Shift+S'], ['file.export.print', 'Print schematic', 'Mod+P'], ['app.preferences', 'Settings', 'Mod+,']]),
  ...g('Simulate', [['sim.run', 'Run', 'Mod+Enter'], ['sim.stop', 'Stop', 'Mod+.'], ['sim.setup', 'Analysis setup', 'A'], ['sim.probe', 'Probe tool', 'P']]),
  ...g('View', [['view.sheets', 'Sheets panel', 'Mod+1'], ['view.parts', 'Parts panel', 'Mod+2'], ['view.partsToggle', 'Parts panel (canvas)', 'Shift+L'], ['view.plots', 'Results panel', 'Mod+3'],
    ['place.fromLibrary', 'Search parts', '/'], ['view.fit', 'Fit to window', 'F'], ['help.shortcuts', 'Keyboard shortcuts', 'Mod+/']]),
  ...g('Edit', [['edit.find', 'Find a part or net label', 'Mod+F'], ['edit.duplicate', 'Duplicate', 'Mod+D'], ['edit.rotate', 'Rotate', 'Ctrl+R'], ['edit.mirror', 'Mirror', 'Ctrl+E']]),
  ...g('Place', [['place.wire', 'Wire', 'W'], ['place.bus', 'Bus', 'B'], ['place.directive', 'SPICE directive', 'S'], ['place.note', 'Text note', 'T'], ['place.comment', 'Comment block', ''], ['place.res', 'Resistor', 'R'],
    ['place.cap', 'Capacitor', 'C'], ['place.ind', 'Inductor', 'L'], ['place.vsrc', 'Voltage source', 'V'], ['place.isrc', 'Current source', 'I'], ['place.diode', 'Diode', 'D'],
    ['place.npn', 'NPN transistor', 'Q'], ['place.nmos', 'NMOS transistor', 'M'], ['place.gnd', 'Ground', 'G'], ['place.label', 'Net label', 'N'], ['place.port', 'Sheet port', 'H']])
]
// not changeable: standard editing keys (the native menu owns them in text fields) and the canvas' fixed keys
export const FIXED: [string, string][] = [['Undo', 'Mod+Z'], ['Redo', 'Mod+Shift+Z'], ['Cut / copy / paste', 'Mod+X · Mod+C · Mod+V'], ['Select all', 'Mod+A'], ['Delete', 'Del · ⌫'],
  ['Back to Select, close a popup', 'Esc'], ['Properties of the selection', 'Enter'], ['Zoom in / out', '+ · −'], ['Flip the wire corner', '/ (while wiring)'], ['Pan', 'Space+drag · middle-drag'],
  ['Add to the selection', 'Shift+click'], ['Probe from Select', 'Alt+click'], ['Differential probe', 'Alt+drag']]
const RESERVED = ['mod+z', 'mod+shift+z', 'mod+y', 'mod+x', 'mod+c', 'mod+v', 'mod+a', 'escape', 'enter', 'delete', 'backspace', ' ', '+', '=', '-', 'mod+q', 'mod+w', 'mod+r']
const DEFAULTS = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.keys]))
const norm = (k: string) => k.toLowerCase().split('+').sort().join('+') // modifier order doesn't matter

// user overrides (prefs.keys): '' = no shortcut. Unknown ids and odd values are dropped.
export function cleanKeys(x: unknown): Record<string, string> {
  const o = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
  return Object.fromEntries(Object.entries(o).filter(([id, k]) => id in DEFAULTS && typeof k === 'string' && k.length <= 30 && /^[\x20-\x7e]*$/.test(k) && k !== DEFAULTS[id]) as [string, string][])
}
export const keysFor = (over: Record<string, string>, id: string, dflt?: string): string => over[id] ?? DEFAULTS[id] ?? dflt ?? ''
// why `keys` can't be given to `id`: reserved, or already used by another shortcut ('' = fine)
export function clash(over: Record<string, string>, id: string, keys: string): string {
  if (!keys) return ''
  if (RESERVED.map(norm).includes(norm(keys))) return 'That key is used for standard editing and can\'t be reassigned'
  const other = SHORTCUTS.find((s) => s.id !== id && norm(keysFor(over, s.id)) === norm(keys))
  return other ? `Already used by ${other.title} (${other.group})` : ''
}
// a keydown -> 'Mod+Shift+K'; null for a bare modifier. Letters and digits by physical key, like matches().
export function comboOf(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, mac: boolean): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'Dead'].includes(e.key)) return null
  const phys = /^(?:Key|Digit)(.)$/.exec(e.code ?? '')?.[1]
  const key = phys ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  const mods = [(mac ? e.metaKey : e.ctrlKey) && 'Mod', mac && e.ctrlKey && 'Ctrl', !mac && e.metaKey && 'Meta', e.altKey && 'Alt', e.shiftKey && 'Shift']
  return [...mods.filter(Boolean), key].join('+')
}
// Electron accelerator for the native menu label ('Mod+Shift+K' -> 'CmdOrCtrl+Shift+K'); undefined = show none
export const accelOf = (keys: string) => (keys ? keys.replace(/\bMod\b/g, 'CmdOrCtrl').replace(/\+\+$/, '+Plus').replace(/^\+$/, 'Plus') : undefined)
