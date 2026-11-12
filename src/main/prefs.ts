// Preferences (userData/preferences.json): loaded before the first window, changed by the Settings window, pushed live
// to every window. The theme goes through nativeTheme.themeSource, which drives prefers-color-scheme in every renderer
// (index.css keys the light/dark tokens on it). Also the crash-recovery store's IPC (recovery.ts).
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanPrefs, type Prefs } from '../renderer/src/prefs'
import { changedSince, isRecovery, recoveryStore, writeAtomic, type RecoveryDraft } from './recovery'

const FILE = () => join(app.getPath('userData'), 'preferences.json')
let prefs: Prefs = cleanPrefs({})
try {
  prefs = cleanPrefs(JSON.parse(readFileSync(FILE(), 'utf8')))
} catch {} // none yet (or unreadable): defaults, written on the first change
nativeTheme.themeSource = prefs.theme

export const getPrefs = () => prefs
export const onPrefs = new Set<() => void>() // main-side listeners (the menu shows changed shortcuts)
// Settings › Appearance › Interface scale: page zoom of every window, new ones included
const zoom = (w: BrowserWindow) => !w.isDestroyed() && w.webContents.setZoomFactor(prefs.uiScale)
app.on('browser-window-created', (_e, w) => w.webContents.on('did-finish-load', () => zoom(w)))
// window background shown before the page paints: no white flash in dark mode, no black one in light
export const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#ffffff') // = index.css --background
nativeTheme.on('updated', () => BrowserWindow.getAllWindows().forEach((w) => w.setBackgroundColor(windowBg())))

// applied and pushed first, then saved: a failed write (reported to the Settings window) only loses them at the next launch
function update(p: Prefs) {
  prefs = p
  nativeTheme.themeSource = prefs.theme
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('prefs:changed', prefs), zoom(w)
  onPrefs.forEach((f) => f())
  try {
    writeAtomic(FILE(), JSON.stringify(prefs, null, 1))
  } catch (e) {
    throw new Error(`Couldn't save your settings (${(e as Error).message}). They apply until you quit.`)
  }
  return prefs
}
ipcMain.on('prefs:get', (e) => void (e.returnValue = prefs)) // sync: the renderer starts with them (preload)
// the engine path is executed: only the file picker below sets it; the renderer may only clear it
ipcMain.handle('prefs:set', (_e, patch: Partial<Prefs>) => {
  const { ngspicePath, ...rest } = patch && typeof patch === 'object' ? patch : ({} as Partial<Prefs>)
  return update(cleanPrefs({ ...prefs, ...rest, ...(ngspicePath === '' && { ngspicePath: '' }) }))
})
ipcMain.handle('prefs:pickEngine', async () => {
  const r = await dialog.showOpenDialog({ title: 'Choose the ngspice program', properties: ['openFile'] })
  return r.canceled || !r.filePaths[0] ? prefs : update(cleanPrefs({ ...prefs, ngspicePath: r.filePaths[0] }))
})

// crash recovery: app:closeNow means the renderer has saved or the user chose Discard, so this run's copies go;
// writes arriving after it (a blur as the window closes) are dropped rather than leaving a stale copy behind
const recovery = recoveryStore(() => join(app.getPath('userData'), 'recovery'))
let closing = false
ipcMain.handle('recovery:list', () => recovery.list())
ipcMain.handle('recovery:write', (_e, r: RecoveryDraft) => void (closing || recovery.write(r)))
ipcMain.handle('recovery:remove', (_e, id: string) => recovery.remove(id))
ipcMain.handle('recovery:check', (_e, r: unknown) => {
  if (!isRecovery(r)) throw new Error('Bad recovery record')
  return changedSince(r)
})
ipcMain.on('app:closeNow', () => ((closing = true), recovery.clearOwned()))
