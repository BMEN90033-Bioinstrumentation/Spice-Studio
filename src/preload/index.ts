import { contextBridge, ipcRenderer } from 'electron'
import type { SimResult } from '../main/index'
import type { Pack } from '../main/userlib'
import type { ImportedLib } from '../renderer/src/library/library'
import type { Filter, SimOptions } from '../renderer/src/contracts'

type Opened = { dir: string; file: string; text: string }
// a file the OS asked us to open (double-click / Open With): a project, a loose sheet, or why it failed
export type OsOpen = { project: Opened } | { path: string; text: string } | { error: string }
const inv = ipcRenderer.invoke.bind(ipcRenderer)
const on = <T>(ch: string, cb: (x: T) => void) => {
  const h = (_e: unknown, x: T) => cb(x)
  ipcRenderer.on(ch, h)
  return () => void ipcRenderer.off(ch, h)
}

const api = {
  runSim: (netlist: string, baseDir?: string, opts?: SimOptions): Promise<SimResult> => inv('sim:run', netlist, baseDir, opts),
  stopSim: (): Promise<void> => inv('sim:stop'), // kills the running ngspice; its runSim resolves with stopped: 'user'
  openFile: (): Promise<{ path: string; text: string } | null> => inv('file:open'),
  importFile: (): Promise<{ path: string; text: string } | null> => inv('file:import'), // LTspice .asc / KiCad .kicad_sch, decoded
  saveFile: (text: string, path: string | null, kind: 'cir' | 'nsch'): Promise<string | null> => inv('file:save', text, path, kind),
  project: {
    defaultParent: (): Promise<string> => inv('project:defaultParent'),
    pickParent: (defaultPath?: string): Promise<string | null> => inv('project:pickParent', defaultPath),
    create: (parent: string, name: string, files: Record<string, string>): Promise<string> => inv('project:create', parent, name, files),
    open: (): Promise<Opened | null> => inv('project:open'),
    openPath: (file: string): Promise<Opened> => inv('project:openPath', file),
    list: (dir: string): Promise<string[]> => inv('project:list', dir),
    read: (dir: string, rel: string): Promise<string> => inv('project:read', dir, rel),
    write: (dir: string, rel: string, text: string): Promise<void> => inv('project:write', dir, rel, text),
    remove: (dir: string, rel: string): Promise<void> => inv('project:remove', dir, rel),
    rename: (dir: string, from: string, to: string): Promise<void> => inv('project:rename', dir, from, to),
    importLib: (dir: string): Promise<{ rel: string; text: string } | null> => inv('project:importLib', dir)
  },
  // export: save dialog + write (string or bytes); pdf: SVG -> PDF file, or 'print' for the system print dialog
  exportSave: (defaultName: string, data: string | Uint8Array, filters: Filter[]): Promise<string | null> => inv('export:save', defaultName, data, filters),
  exportPdf: (svg: string, defaultName: string, mode: 'pdf' | 'print' = 'pdf'): Promise<string | null> => inv('export:pdf', svg, defaultName, mode),
  engine: (): Promise<{ path: string | null; version: string; bundled: boolean }> => inv('engine:info'),
  osOpens: (): Promise<OsOpen | null> => inv('app:opens'),
  onOsOpen: (cb: (x: OsOpen) => void) => on('open-path', cb),
  // window close / quit: ack at once (main falls back to a native dialog if this never arrives), then cb decides
  onCloseRequest: (cb: () => void) => on('app:closeRequest', () => (ipcRenderer.send('app:closeAck'), cb())),
  closeNow: () => ipcRenderer.send('app:closeNow'),
  // native menu (main/menu.ts <-> renderer commands.ts)
  menu: {
    setState: (s: Record<string, { enabled: boolean; checked?: boolean }>) => ipcRenderer.send('menu:state', s),
    onCommand: (cb: (x: { id: string; accel: boolean }) => void) => on('menu:command', cb),
    native: (op: string) => ipcRenderer.send('menu:native', op),
    info: (): Promise<{ name: string; version: string; electron: string; chrome: string; node: string; platform: string }> => inv('app:info'),
    licenses: (): Promise<{ dir: string; files: { name: string; text: string }[] }> => inv('app:licenses')
  },
  // personal library (userData) + library packs (bundled or user-installed)
  userlib: {
    list: (): Promise<{ dir: string; libs: ImportedLib[]; texts: Record<string, string> }> => inv('userlib:list'),
    import: (): Promise<{ file: string; text: string } | null> => inv('userlib:import'),
    save: (lib: ImportedLib): Promise<void> => inv('userlib:save', lib),
    setEnabled: (file: string, on: boolean): Promise<void> => inv('userlib:setEnabled', file, on),
    remove: (file: string): Promise<void> => inv('userlib:remove', file)
  },
  packs: {
    list: (): Promise<(Omit<Pack, 'libs'> & { libs: ImportedLib[] })[]> => inv('packs:list'),
    setEnabled: (id: string, on: boolean): Promise<void> => inv('packs:setEnabled', id, on),
    add: (): Promise<{ id: string } | { errors: string[] } | null> => inv('packs:add'), // folder picker + validation + copy
    remove: (id: string): Promise<void> => inv('packs:remove', id) // user-installed packs only
  },
  recent: {
    list: (): Promise<{ name: string; file: string; opened: number; exists: boolean }[]> => inv('recent:list'),
    remove: (file: string): Promise<void> => inv('recent:remove', file)
  }
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window {
    api: typeof api
  }
}
