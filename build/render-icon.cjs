// Renders build/icon.svg to build/icon.png (1024x1024) with Electron itself: npm run icon
// electron-builder derives .icns/.ico from the png.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  const svg = readFileSync(join(__dirname, 'icon.svg'), 'utf8')
  await w.loadURL('data:text/html,' + encodeURIComponent(`<style>html,body{margin:0;background:transparent}</style>${svg}`))
  await new Promise((r) => setTimeout(r, 300))
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  writeFileSync(join(__dirname, 'icon.png'), img.toPNG())
  console.log('build/icon.png', img.getSize())
  app.quit()
})
