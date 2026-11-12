// Native application menu. Items carry the renderer command ids (src/renderer/src/commands.ts): a click sends
// 'menu:command', and enabled/checked follow the renderer's 'menu:state' pushes. Shortcuts the renderer handles are
// shown but not registered (registerAccelerator: false), so a key never fires twice. Only the text-editing items
// (undo/redo/cut/copy/paste/select all) register theirs: macOS text fields need the menu for ⌘C/⌘V.
import { app, BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions as Item } from 'electron'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

type State = Record<string, { enabled: boolean; checked?: boolean }>
type Recent = { name: string; file: string }
const mac = process.platform === 'darwin'
let state: State = {}
let opts: { recents: () => Promise<Recent[]>; engineDir: string; window: () => BrowserWindow | null }
const ids = new Set<string>(), exists = new Set<string>() // command items in the current menu; recents on disk

const send = (id: string, accel = false) => opts.window()?.webContents.send('menu:command', { id, accel })
// renderer command: label + shown-only accelerator
const cmd = (id: string, label: string, accelerator?: string, extra: Partial<Item> = {}): Item => (ids.add(id), {
  id, label, accelerator, registerAccelerator: false, enabled: false, click: () => send(id), ...extra
})
const check = (id: string, label: string, accelerator?: string) => cmd(id, label, accelerator, { type: 'checkbox' })
// text-editing command: accelerator registered; the renderer runs the native op when a text field has focus
const edit = (id: string, label: string, accelerator: string): Item => (ids.add(id), {
  id, label, accelerator, enabled: false, click: (_i, _w, e) => send(id, !!e?.triggeredByAccelerator)
})
const sep: Item = { type: 'separator' }

function template(recents: Recent[]): Item[] {
  const file: Item[] = [
    cmd('file.newProject', 'New Project…', 'CmdOrCtrl+N'),
    cmd('file.openProject', 'Open Project…', 'CmdOrCtrl+O'),
    cmd('file.openFile', 'Open File…', 'CmdOrCtrl+Shift+O'),
    {
      label: 'Open Recent',
      submenu: recents.length
        ? recents.map((r) => cmd('file.openRecent:' + r.file, `${r.name} — ${basename(r.file.replace(/[\\/][^\\/]*$/, ''))}`, undefined, { toolTip: r.file }))
        : [{ label: 'No Recent Projects', enabled: false }]
    },
    sep,
    cmd('file.closeProject', 'Close Project'),
    sep,
    cmd('file.save', 'Save', 'CmdOrCtrl+S'),
    cmd('file.saveAs', 'Save As…', 'CmdOrCtrl+Shift+S'),
    cmd('file.exportNetlist', 'Export Netlist…'),
    {
      label: 'Export',
      submenu: [
        cmd('file.export.plotPng', 'Plot as PNG…'),
        cmd('file.export.plotSvg', 'Plot as SVG…'),
        cmd('file.export.plotCsv', 'Plot Data as CSV…'),
        sep,
        cmd('file.export.schSvg', 'Schematic as SVG…'),
        cmd('file.export.schPdf', 'Schematic as PDF…')
      ]
    },
    cmd('file.export.print', 'Print Schematic…', 'CmdOrCtrl+P'),
    ...(mac ? [] : [sep, { role: 'quit' } as Item])
  ]
  const editMenu: Item[] = [
    edit('edit.undo', 'Undo', 'CmdOrCtrl+Z'),
    edit('edit.redo', 'Redo', mac ? 'Shift+Cmd+Z' : 'Ctrl+Y'),
    sep,
    edit('edit.cut', 'Cut', 'CmdOrCtrl+X'),
    edit('edit.copy', 'Copy', 'CmdOrCtrl+C'),
    edit('edit.paste', 'Paste', 'CmdOrCtrl+V'),
    cmd('edit.duplicate', 'Duplicate', 'CmdOrCtrl+D'),
    cmd('edit.delete', 'Delete', mac ? 'Backspace' : 'Delete'),
    edit('edit.selectAll', 'Select All', 'CmdOrCtrl+A'),
    sep,
    cmd('edit.rotate', 'Rotate', 'Ctrl+R'),
    cmd('edit.mirror', 'Mirror', 'Ctrl+E')
  ]
  const view: Item[] = [
    cmd('view.home', 'Home'),
    sep,
    check('view.schematic', 'Schematic'),
    check('view.netlist', 'Netlist'),
    sep,
    check('view.sheets', 'Sheets Panel', 'CmdOrCtrl+1'),
    check('view.parts', 'Parts Panel', 'CmdOrCtrl+2'),
    check('view.plots', 'Results Panel', 'CmdOrCtrl+3'),
    check('view.popoutPlots', 'Results in Separate Window'),
    sep,
    cmd('view.zoomIn', 'Zoom In', 'Plus'),
    cmd('view.zoomOut', 'Zoom Out', '-'),
    cmd('view.fit', 'Fit to Window', 'F'),
    check('view.showOp', 'Show Operating Point'),
    sep,
    { label: 'Interface Size', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { role: 'togglefullscreen' },
    { role: 'toggleDevTools' }
  ]
  const place: Item[] = [
    cmd('place.wire', 'Wire', 'W'),
    sep,
    cmd('place.res', 'Resistor', 'R'),
    cmd('place.cap', 'Capacitor', 'C'),
    cmd('place.ind', 'Inductor', 'L'),
    cmd('place.vsrc', 'Voltage Source', 'V'),
    cmd('place.isrc', 'Current Source', 'I'),
    cmd('place.diode', 'Diode', 'D'),
    cmd('place.npn', 'NPN Transistor', 'Q'),
    cmd('place.pnp', 'PNP Transistor'),
    cmd('place.nmos', 'NMOS Transistor', 'M'),
    cmd('place.pmos', 'PMOS Transistor'),
    cmd('place.opamp', 'Op-amp'),
    sep,
    cmd('place.gnd', 'Ground', 'G'),
    cmd('place.label', 'Net Label', 'N'),
    cmd('place.port', 'Sheet Port', 'H'),
    cmd('place.directive', 'SPICE Directive', 'S'),
    sep,
    cmd('place.note', 'Text Note', 'T'),
    { label: 'Shape', submenu: [cmd('place.line', 'Line'), cmd('place.arrow', 'Arrow'), cmd('place.rect', 'Rectangle'), cmd('place.ellipse', 'Ellipse')] },
    check('place.titleBlock', 'Title Block'),
    sep,
    cmd('place.fromLibrary', 'From Library…', '/')
  ]
  const sim: Item[] = [
    cmd('sim.run', 'Run', 'CmdOrCtrl+Enter'),
    cmd('sim.stop', 'Stop', 'CmdOrCtrl+.'),
    sep,
    cmd('sim.setup', 'Analysis Setup…', 'A'),
    cmd('sim.options', 'Simulation Options…'),
    cmd('sim.probe', 'Probe', 'P'),
    sep,
    cmd('sim.viewNetlist', 'View Generated Netlist')
  ]
  const tools: Item[] = [cmd('tools.annotateSheet', 'Annotate Sheet'), cmd('tools.annotateProject', 'Annotate Project'), sep, cmd('tools.library', 'Component Library'), cmd('tools.importLibrary', 'Import Library…'), cmd('tools.manageLibraries', 'Manage Libraries…'), sep, cmd('tools.engineInfo', 'Simulation Engine…')]
  const help: Item[] = [
    cmd('help.shortcuts', 'Keyboard Shortcuts', 'CmdOrCtrl+/'),
    ...(mac ? [] : [cmd('help.about', 'About Spice Studio')]),
    sep,
    cmd('help.licenses', 'Third-party Licences…')
  ]
  return [
    ...(mac
      ? [{
          label: 'Spice Studio',
          submenu: [cmd('help.about', 'About Spice Studio'), sep, { role: 'services' }, sep, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, { role: 'quit' }]
        } as Item]
      : []),
    { label: 'File', submenu: file },
    { label: 'Edit', submenu: editMenu },
    { label: 'View', submenu: view },
    { label: 'Place', submenu: place },
    { label: 'Simulate', submenu: sim },
    { label: 'Tools', submenu: tools },
    { role: 'windowMenu' },
    { role: 'help', submenu: help }
  ]
}


// ids the renderer hasn't registered (e.g. Place on the home page) are disabled
function apply() {
  const m = Menu.getApplicationMenu()
  for (const id of ids) {
    const item = m?.getMenuItemById(id)
    if (!item) continue
    const recent = id.startsWith('file.openRecent:'), s = state[recent ? 'file.openRecent' : id]
    item.enabled = !!s?.enabled && (!recent || exists.has(id.slice(16)))
    if (item.type === 'checkbox') item.checked = !!s?.checked
  }
}

export async function refreshMenu() {
  if (!opts) return // before installMenu (app not ready yet)
  const r = await opts.recents().catch(() => [])
  exists.clear(), ids.clear()
  for (const x of r) if (existsSync(x.file)) exists.add(x.file)
  Menu.setApplicationMenu(Menu.buildFromTemplate(template(r)))
  apply()
}

export function installMenu(o: typeof opts) {
  opts = o
  ipcMain.on('menu:state', (_e, s: State) => {
    state = s && typeof s === 'object' ? s : {}
    apply()
  })
  ipcMain.on('menu:native', (e, op: string) => {
    const ops = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'delete'] as const
    if (ops.includes(op as (typeof ops)[number])) e.sender[op as (typeof ops)[number]]()
  })
  // Help › Third-party Licences: the bundled ngspice's COPYING + THIRD_PARTY_NOTICES.md (none in dev before ngspice:build)
  ipcMain.handle('app:licenses', async () => ({
    dir: opts.engineDir,
    files: (await Promise.all(['THIRD_PARTY_NOTICES.md', 'COPYING'].map((name) => readFile(join(opts.engineDir, name), 'utf8').then((text) => ({ name, text }), () => null))))
      .filter((f) => f !== null)
  }))
  ipcMain.handle('app:info', () => ({ name: app.name, version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: `${process.platform}-${process.arch}` }))
  return refreshMenu()
}
