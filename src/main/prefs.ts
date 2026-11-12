// Preferences (userData/preferences.json): loaded before the first window, changed by the Settings window, pushed live
// to every window. The theme goes through nativeTheme.themeSource, which drives prefers-color-scheme in every renderer
// (index.css keys the light/dark tokens on it).
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanPrefs, type Prefs } from '../renderer/src/prefs'

const FILE = () => join(app.getPath('userData'), 'preferences.json')
let prefs: Prefs = cleanPrefs({})
try {
  prefs = cleanPrefs(JSON.parse(readFileSync(FILE(), 'utf8')))
} catch {} // none yet (or unreadable): defaults, written on the first change
nativeTheme.themeSource = prefs.theme

export const getPrefs = () => prefs
// window background shown before the page paints: no white flash in dark mode, no black one in light
export const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#ffffff') // = index.css --background
nativeTheme.on('updated', () => BrowserWindow.getAllWindows().forEach((w) => w.setBackgroundColor(windowBg())))

ipcMain.on('prefs:get', (e) => void (e.returnValue = prefs)) // sync: the renderer starts with them (preload)
ipcMain.handle('prefs:set', (_e, patch: Partial<Prefs>) => {
  prefs = cleanPrefs({ ...prefs, ...(patch && typeof patch === 'object' ? patch : {}) })
  nativeTheme.themeSource = prefs.theme
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('prefs:changed', prefs)
  mkdirSync(app.getPath('userData'), { recursive: true }) // applied first: a failed write only loses them at the next launch
  writeFileSync(FILE(), JSON.stringify(prefs, null, 1))
  return prefs
})
ipcMain.handle('prefs:pickEngine', async () => {
  const r = await dialog.showOpenDialog({ title: 'Choose the ngspice program', properties: ['openFile'] })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})

