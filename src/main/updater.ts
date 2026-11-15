// Auto-update from the GitHub releases feed (electron-builder.cjs `publish`): the renderer's UpdateCard (Update.tsx)
// asks for a check at startup, then Download -> Restart to update.
// Unsigned (ad-hoc) macOS builds: Squirrel.Mac refuses an update whose signature doesn't match the running app,
// so those only announce the version and the card links to the download page (`manual`).
import { app, ipcMain, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppUpdater } from 'electron-updater'

export type UpdateStatus = { state: 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'; version?: string; percent?: number; manual?: boolean }

// beforeInstall: lets the window close without the quit guard (the renderer has already asked about unsaved work)
export function installUpdater(window: () => BrowserWindow | null, beforeInstall: () => void) {
  let status: UpdateStatus = { state: 'idle' }
  const send = (s: UpdateStatus) => {
    status = s
    const w = window()
    if (w && !w.isDestroyed()) w.webContents.send('update:status', s)
  }
  // SPICE_FAKE_UPDATE=1 npm run dev: walk the card through its states without a feed
  const fake = !app.isPackaged && !!process.env.SPICE_FAKE_UPDATE
  const live = app.isPackaged && process.platform !== 'linux' // ponytail: AppImage/deb not wired up; add when Linux builds ship
  // macAutoUpdate: written into the packaged package.json by electron-builder.cjs when the build is properly signed
  const manual = process.platform === 'darwin' && live && !JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')).macAutoUpdate

  // dynamic import: keeps electron-updater (which builds a platform updater on load) out of dev startup
  let updater: Promise<AppUpdater> | undefined
  const get = () =>
    (updater ??= import('electron-updater').then((m) => {
      const u = m.autoUpdater
      u.autoDownload = false // the card's Download button starts it
      u.on('update-available', (i) => send({ state: 'available', version: i.version, manual }))
      u.on('download-progress', (p) => send({ ...status, state: 'downloading', percent: p.percent }))
      u.on('update-downloaded', () => send({ ...status, state: 'downloaded' }))
      // a failed background check (offline, no release yet) stays silent; a failed download is shown
      u.on('error', () => status.state === 'downloading' && send({ ...status, state: 'error' }))
      return u
    }))

  ipcMain.handle('update:check', async () => {
    if (status.state !== 'idle') return send(status) // renderer reloaded: repeat what it missed
    if (fake) return send({ state: 'available', version: '9.9.9' })
    if (live) await (await get()).checkForUpdates().catch(() => {})
  })
  ipcMain.handle('update:download', async () => {
    send({ ...status, state: 'downloading', percent: 0 }) // progress events lag behind the click
    if (fake) {
      for (let p = 5; p <= 100; p += 5) await new Promise((r) => setTimeout(r, 80)).then(() => send({ ...status, percent: p }))
      return send({ ...status, state: 'downloaded' })
    }
    if (live) await (await get()).downloadUpdate().catch(() => {}) // failures arrive on 'error'
  })
  ipcMain.handle('update:install', async () => {
    if (!live) return
    beforeInstall()
    ;(await get()).quitAndInstall()
  })
}
