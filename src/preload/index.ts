import { contextBridge, ipcRenderer } from 'electron'
import type { SimResult } from '../main/index'

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
  runSim: (netlist: string, baseDir?: string): Promise<SimResult> => inv('sim:run', netlist, baseDir),
  openFile: (): Promise<{ path: string; text: string } | null> => inv('file:open'),
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
  engine: (): Promise<{ path: string | null; version: string; bundled: boolean }> => inv('engine:info'),
  osOpens: (): Promise<OsOpen | null> => inv('app:opens'),
  onOsOpen: (cb: (x: OsOpen) => void) => on('open-path', cb),
  // window close / quit: ack at once (main falls back to a native dialog if this never arrives), then cb decides
  onCloseRequest: (cb: () => void) => on('app:closeRequest', () => (ipcRenderer.send('app:closeAck'), cb())),
  closeNow: () => ipcRenderer.send('app:closeNow'),
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
