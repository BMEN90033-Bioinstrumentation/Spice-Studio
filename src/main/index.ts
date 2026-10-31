import { app, BrowserWindow, dialog, ipcMain, Menu, screen, type MenuItemConstructorOptions } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { inside, safeName } from './paths'
import { parseRaw, type RawPlot } from './rawfile'

export interface SimResult {
  ok: boolean
  log: string
  plots: RawPlot[]
}

// ponytail: Homebrew/PATH lookup for dev; Phase 5 bundles ngspice in extraResources.
// Apps launched from Finder don't inherit the shell PATH, hence the explicit paths.
const NGSPICE =
  process.env.NGSPICE_PATH ??
  ['/opt/homebrew/bin/ngspice', '/usr/local/bin/ngspice'].find(existsSync) ??
  'ngspice'

// ponytail: CLI + rawfile; move to libngspice via koffi in a utilityProcess for live streaming.
// cwd = baseDir so relative .include/.lib resolve next to the user's file (ngspice resolves them against cwd).
async function runSim(netlist: string, baseDir?: string): Promise<SimResult> {
  const dir = await mkdtemp(join(tmpdir(), 'ngspice-'))
  const cir = join(dir, 'circuit.cir')
  const raw = join(dir, 'out.raw')
  try {
    await writeFile(cir, netlist.endsWith('\n') ? netlist : netlist + '\n')
    const { code, log } = await new Promise<{ code: number | null; log: string }>((resolve) => {
      let log = ''
      const p = spawn(NGSPICE, ['-b', '-r', raw, cir], { cwd: baseDir && existsSync(baseDir) ? baseDir : dir })
      p.stdout.on('data', (d) => (log += d))
      p.stderr.on('data', (d) => (log += d))
      p.on('error', (e) => resolve({ code: -1, log: `Failed to start ngspice (${NGSPICE}): ${e.message}` }))
      p.on('close', (code) => resolve({ code, log }))
    })
    let plots: RawPlot[] = []
    let parseErr = ''
    if (existsSync(raw)) {
      try {
        plots = parseRaw(await readFile(raw))
      } catch (e) {
        parseErr = `\nRawfile error: ${(e as Error).message}`
      }
    }
    return { ok: code === 0 && !parseErr, log: log + parseErr, plots }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

ipcMain.handle('sim:run', (_e, netlist: string, baseDir?: string) => runSim(netlist, baseDir))

const NETLIST = { name: 'SPICE netlist', extensions: ['cir', 'sp', 'spice', 'net', 'txt'] }
const SCHEMATIC = { name: 'ngspice Studio schematic', extensions: ['nsch'] }

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog({
    filters: [
      { name: 'Netlists & schematics', extensions: [...NETLIST.extensions, ...SCHEMATIC.extensions] },
      NETLIST,
      SCHEMATIC,
      { name: 'All', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return null
  return { path: r.filePaths[0], text: await readFile(r.filePaths[0], 'utf8') }
})

ipcMain.handle('file:save', async (_e, text: string, path: string | null, kind: 'cir' | 'nsch') => {
  if (!path) {
    const filter = kind === 'nsch' ? SCHEMATIC : { name: NETLIST.name, extensions: ['cir'] }
    const r = await dialog.showSaveDialog({ filters: [filter] })
    if (r.canceled || !r.filePath) return null
    path = r.filePath
  }
  await writeFile(path, text)
  return path
})

// ---- projects: folder <parent>/<Name>/ with <Name>.nsproj, *.nsch sheets, libs/ ----
// Only folders the user created/opened through these handlers are writable; every `rel` is confined to its folder.
const projects = new Set<string>()
const root = (dir: unknown) => {
  const r = typeof dir === 'string' && isAbsolute(dir) ? resolve(dir) : ''
  if (!projects.has(r)) throw new Error('That project is not open')
  return r
}

type Recent = { name: string; file: string; opened: number }
const RECENT = () => join(app.getPath('userData'), 'recent.json')
async function recents(): Promise<Recent[]> {
  try {
    const r = JSON.parse(await readFile(RECENT(), 'utf8'))
    return Array.isArray(r) ? r.filter((x) => typeof x?.file === 'string' && typeof x.name === 'string' && typeof x.opened === 'number') : []
  } catch {
    return []
  }
}
const saveRecents = (r: Recent[]) => writeFile(RECENT(), JSON.stringify(r.slice(0, 12), null, 1))
async function opened(file: string) {
  const dir = dirname(file)
  projects.add(dir)
  await saveRecents([{ name: basename(file, extname(file)), file, opened: Date.now() }, ...(await recents()).filter((x) => x.file !== file)])
  return { dir, file, text: await readFile(file, 'utf8') }
}

ipcMain.handle('project:defaultParent', () => join(app.getPath('documents'), 'ngspice Studio'))
ipcMain.handle('project:pickParent', async (_e, defaultPath?: string) => {
  const r = await dialog.showOpenDialog({ defaultPath, properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})
ipcMain.handle('project:create', async (_e, parent: string, name: string, files: Record<string, string>) => {
  const n = safeName(name)
  if (typeof parent !== 'string' || !isAbsolute(parent)) throw new Error('Pick a folder for the project')
  const dir = join(resolve(parent), n)
  if (existsSync(dir)) throw new Error(`"${dir}" already exists`)
  const writes = Object.entries(files ?? {}).map(([rel, text]) => {
    if (typeof text !== 'string') throw new Error(`Bad content for ${rel}`)
    return [inside(dir, rel), text] as const
  })
  await mkdir(parent, { recursive: true })
  await mkdir(dir)
  for (const [p, text] of writes) await mkdir(dirname(p), { recursive: true }), await writeFile(p, text)
  await opened(join(dir, n + '.nsproj'))
  return dir
})
ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog({ filters: [{ name: 'ngspice Studio project', extensions: ['nsproj'] }], properties: ['openFile'] })
  return r.canceled || !r.filePaths[0] ? null : opened(r.filePaths[0])
})
ipcMain.handle('project:openPath', (_e, file: string) => {
  if (typeof file !== 'string' || !isAbsolute(file) || extname(file).toLowerCase() !== '.nsproj') throw new Error('Not a .nsproj file')
  return opened(resolve(file))
})
ipcMain.handle('project:list', async (_e, dir: string) => {
  const r = root(dir)
  const files = async (sub: string) =>
    existsSync(join(r, sub)) ? (await readdir(join(r, sub), { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name) : []
  return [...(await files('.')).filter((f) => /\.nsch$/i.test(f)), ...(await files('libs')).map((f) => 'libs/' + f)]
})
ipcMain.handle('project:read', (_e, dir: string, rel: string) => readFile(inside(root(dir), rel), 'utf8'))
ipcMain.handle('project:write', async (_e, dir: string, rel: string, text: string) => {
  const p = inside(root(dir), rel)
  if (typeof text !== 'string') throw new Error('Bad content')
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, text)
})
ipcMain.handle('project:remove', (_e, dir: string, rel: string) => rm(inside(root(dir), rel)))
ipcMain.handle('project:rename', async (_e, dir: string, from: string, to: string) => {
  const r = root(dir), a = inside(r, from), b = inside(r, to)
  if (existsSync(b)) throw new Error(`${to} already exists`)
  await rename(a, b)
})
ipcMain.handle('project:importLib', async (_e, dir: string) => {
  const r = root(dir)
  const d = await dialog.showOpenDialog({
    filters: [{ name: 'SPICE models', extensions: ['lib', 'mod', 'cir', 'sub', 'txt', 'model', 'spi'] }, { name: 'All', extensions: ['*'] }],
    properties: ['openFile']
  })
  if (d.canceled || !d.filePaths[0]) return null
  const text = await readFile(d.filePaths[0], 'utf8')
  const ext = extname(d.filePaths[0]), stem = basename(d.filePaths[0], ext).replace(/[^\w.-]+/g, '_') || 'lib'
  let rel = `libs/${stem}${ext}`
  for (let i = 2; existsSync(inside(r, rel)); i++) rel = `libs/${stem}-${i}${ext}` // never clobber an imported lib
  await mkdir(join(r, 'libs'), { recursive: true })
  await writeFile(inside(r, rel), text)
  return { rel, text }
})
ipcMain.handle('recent:list', async () => (await recents()).map((x) => ({ ...x, exists: existsSync(x.file) })))
ipcMain.handle('recent:remove', async (_e, file: string) => saveRecents((await recents()).filter((x) => x.file !== file)))

// Minimal menu: the default one binds Ctrl/Cmd+R to reload, which fights the schematic's rotate.
const viewMenu: MenuItemConstructorOptions = {
  label: 'View',
  submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }]
}
const menu: MenuItemConstructorOptions[] = [{ role: 'editMenu' }, viewMenu, { role: 'windowMenu' }]
if (process.platform === 'darwin') menu.unshift({ role: 'appMenu' })

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu))
  const win = new BrowserWindow({
    // editor = sheets + library panel + canvas + plots: use most of the screen
    width: Math.max(1200, Math.round(screen.getPrimaryDisplay().workAreaSize.width * 0.92)),
    height: Math.max(800, Math.round(screen.getPrimaryDisplay().workAreaSize.height * 0.92)),
    backgroundColor: '#16181d',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
})

app.on('window-all-closed', () => app.quit())
