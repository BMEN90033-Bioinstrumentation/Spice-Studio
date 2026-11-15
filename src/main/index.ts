import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { inside, safeName } from './paths'
import { parseRaw, type LiveChunk, type RawPlot } from './rawfile'
import { watchRaw } from './live'
import { readCapped } from './srcfile'
import { expandFileSources, MAX_FILE_BYTES } from '../renderer/src/sim/filesrc'
import type { SimOptions, Stopped } from '../renderer/src/contracts'
import { measDeck, measSection } from '../renderer/src/sim/meas'
import './userlib' // personal library + packs IPC
import { getPrefs, windowBg } from './prefs' // preferences, theme, crash-recovery IPC
import { installMenu, refreshMenu } from './menu'
import { installUpdater } from './updater'

export interface SimResult {
  ok: boolean
  log: string
  plots: RawPlot[]
  stopped?: Stopped // killed by sim:stop or the timeout; plots = the whole points written before that
}

// ngspice: NGSPICE_PATH > bundled (packaged: Resources/ngspice; dev: vendor/ngspice/<platform>-<arch>) > Homebrew > PATH.
// Apps launched from Finder don't inherit the shell PATH, hence the explicit Homebrew paths.
const EXE = process.platform === 'win32' ? 'ngspice.exe' : 'ngspice'
const BUNDLED = app.isPackaged ? join(process.resourcesPath, 'ngspice') : join(app.getAppPath(), 'vendor', 'ngspice', `${process.platform}-${process.arch}`)
type Engine = { path: string; bundled: boolean; env: NodeJS.ProcessEnv }
// SPICE_SCRIPTS would redirect spinit lookup; SPICE_ASCIIRAWFILE would make the rawfile ASCII (parseRaw wants binary)
const { SPICE_SCRIPTS: _s, SPICE_ASCIIRAWFILE: _a, ...ENV } = process.env
function engine(): Engine | null {
  if (getPrefs().ngspicePath) return { path: getPrefs().ngspicePath, bundled: false, env: ENV } // Settings › Simulation engine
  if (process.env.NGSPICE_PATH) return { path: process.env.NGSPICE_PATH, bundled: false, env: ENV }
  const b = join(BUNDLED, 'bin', EXE)
  // required on macOS/Linux: ngspice finds spinit (and through it the .cm code models) only via SPICE_LIB_DIR
  if (existsSync(b)) return { path: b, bundled: true, env: { ...ENV, SPICE_LIB_DIR: join(BUNDLED, 'share', 'ngspice') } }
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(delimiter).filter(Boolean)]
  const p = dirs.map((d) => join(d, EXE)).find(existsSync)
  return p ? { path: p, bundled: false, env: ENV } : null
}
const NO_NGSPICE =
  'ngspice was not found.\n' +
  `This build has no bundled engine (looked in ${BUNDLED}), and there is no ngspice on the PATH.\n` +
  '  • from source: npm run ngspice:build  (puts a relocatable ngspice in vendor/ngspice/)\n' +
  '  • or install it: brew install ngspice  /  apt install ngspice  /  https://ngspice.sourceforge.io\n' +
  '  • or point NGSPICE_PATH at an ngspice executable.'

const run = (e: Engine, args: string[], cwd?: string, spawned?: (p: ChildProcess) => void) =>
  new Promise<{ code: number | null; log: string }>((resolve) => {
    let log = ''
    const p = spawn(e.path, args, { cwd, env: e.env })
    spawned?.(p)
    p.stdout.on('data', (d) => (log += d))
    p.stderr.on('data', (d) => (log += d))
    p.on('error', (err) => resolve({ code: -1, log: `Failed to start ngspice (${e.path}${e.path === getPrefs().ngspicePath ? ', chosen in Settings › Simulation engine' : ''}): ${err.message}` }))
    p.on('close', (code) => resolve({ code, log }))
  })

ipcMain.handle('engine:info', async () => {
  const e = engine()
  if (!e) return { path: null, version: 'ngspice not found', bundled: false }
  let kid: ChildProcess | undefined // a program that never answers (Settings can point anywhere): give up after 5 s
  const late = new Promise<{ log: string }>((r) => setTimeout(() => (kid && kill(kid), r({ log: '' })), 5000).unref())
  const { log } = await Promise.race([run(e, ['--version'], undefined, (p) => (kid = p)), late])
  return { path: e.path, version: log.match(/ngspice-[\w.+-]+/)?.[0] ?? (log.split('\n')[0] || `No answer from ${basename(e.path)} --version`), bundled: e.bundled }
})

// SIGTERM, then SIGKILL after 1 s if ngspice ignores it (Windows: kill() is already TerminateProcess)
function kill(p: ChildProcess) {
  p.kill()
  if (process.platform !== 'win32') setTimeout(() => p.exitCode === null && p.signalCode === null && p.kill('SIGKILL'), 1000).unref()
}
let active: ((why: Stopped) => void) | null = null // stops the running simulation (one at a time: the renderer waits)
const COMPAT = ['ps', 'lt', 'ltps', 'kicad']

// -n: skip ~/.spiceinit (a `set filetype=ascii` there would break parseRaw). Success = exit code, not 'warning' lines.
// ponytail: CLI + rawfile; move to libngspice via koffi in a utilityProcess for live streaming.
// cwd = baseDir so relative .include/.lib resolve next to the user's file (ngspice resolves them against cwd).
// compat: -D ngbehavior=ps|lt|ltps|kicad (ngspice-47 batch mode accepts it and logs "Compatibility modes selected: ps";
// ps/lt apply to .include/.lib content, e.g. a PSpice VSWITCH model in an included subckt only parses with ps).
// live: called a few times a second with the points ngspice has added to the rawfile (main/live.ts)
async function runSim(netlist: string, baseDir?: string, opts?: SimOptions, live?: (c: LiveChunk[]) => void): Promise<SimResult> {
  const e = engine()
  if (!e) return { ok: false, log: NO_NGSPICE, plots: [] }
  const proj = baseDir && existsSync(baseDir) ? baseDir : undefined
  // PWL file= / wavefile= sources become inline PWL (sim/filesrc.ts), paths relative to the project folder
  const fs = await expandFileSources(netlist, (p) => readCapped(resolve(proj ?? tmpdir(), p), MAX_FILE_BYTES))
  if (fs.errors.length) return { ok: false, log: fs.errors.map((x) => 'Error: ' + x).join('\n'), plots: [] }
  netlist = fs.text
  const dir = await mkdtemp(join(tmpdir(), 'ngspice-'))
  const cir = join(dir, 'circuit.cir')
  const raw = join(dir, 'out.raw')
  const cwd = proj ?? dir
  const base = ['-b', '-n', ...(COMPAT.includes(opts?.compat as string) ? ['-D', `ngbehavior=${opts!.compat}`] : [])]
  let stopped: Stopped | undefined, child: ChildProcess | undefined
  const stop = (why: Stopped) => {
    stopped ??= why
    if (child) kill(child)
  }
  active = stop
  const secs = Number(opts?.timeoutS)
  const timer = secs > 0 && isFinite(secs) ? setTimeout(() => stop('timeout'), secs * 1000) : undefined
  const cut = async (log: string): Promise<SimResult> => ({
    ok: false, log: log + (stopped === 'user' ? '\nStopped.' : `\nTimed out after ${secs} s.`), stopped,
    plots: await readFile(raw).then((b) => parseRaw(b, true), () => []) // what ngspice wrote before it was killed
  })
  try {
    await writeFile(cir, netlist.endsWith('\n') ? netlist : netlist + '\n')
    const unwatch = live && watchRaw(raw, live)
    let { code, log } = await run(e, [...base, '-r', raw, cir], cwd, (p) => (child = p))
    await unwatch?.()
    if (stopped) return cut(log)
    // .meas: a second, rawfile-less pass (see measDeck); only its measurement section goes in the log
    const md = code === 0 ? measDeck(netlist) : null
    if (md) {
      await writeFile(join(dir, 'meas.cir'), md)
      const m = await run(e, [...base, join(dir, 'meas.cir')], cwd, (p) => (child = p))
      if (stopped) return cut(log)
      log = log.replace(/^No \.measure possible in batch mode.*\n.*\n.*\n/m, '').replace(/^\.fourier line ignored.*\n/gm, '') + `\n--- ${/^[ \t]*\.meas/im.test(netlist) ? '.meas' : '.four'} ---\n${measSection(m.log) || '(no measurements printed)'}\n`
    }
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
    clearTimeout(timer)
    if (active === stop) active = null
    await rm(dir, { recursive: true, force: true })
  }
}

// ---- export (plots, schematics): save dialog + write; PDF/print render the SVG in a hidden window ----
type Filter = { name: string; extensions: string[] }
async function saveAs(defaultName: string, filters: Filter[]) {
  const r = await dialog.showSaveDialog({ defaultPath: basename(String(defaultName || 'export')), filters: Array.isArray(filters) ? filters : [] })
  return r.canceled || !r.filePath ? null : r.filePath
}
ipcMain.handle('export:save', async (_e, defaultName: string, data: string | Uint8Array, filters: Filter[]) => {
  if (typeof data !== 'string' && !(data instanceof Uint8Array)) throw new Error('Bad export data')
  const p = await saveAs(defaultName, filters)
  if (p) await writeFile(p, data)
  return p
})
// mode 'pdf': save dialog + printToPDF; 'print': the system print dialog
ipcMain.handle('export:pdf', async (_e, svg: string, defaultName: string, mode: 'pdf' | 'print' = 'pdf') => {
  if (typeof svg !== 'string') throw new Error('Bad SVG')
  const p = mode === 'pdf' ? await saveAs(defaultName, [{ name: 'PDF', extensions: ['pdf'] }]) : null
  if (mode === 'pdf' && !p) return null
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
  try {
    const html = `<!doctype html><meta charset="utf-8"><style>@page{margin:10mm}html,body{margin:0;background:#fff}svg{width:100%;height:auto;max-height:100vh}</style>${svg}`
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    if (mode === 'print') return await new Promise<string | null>((res) => w.webContents.print({}, (ok) => res(ok ? 'printed' : null)))
    await writeFile(p!, await w.webContents.printToPDF({ landscape: true, printBackground: true }))
    return p
  } finally {
    w.destroy()
  }
})

ipcMain.handle('sim:run', (e, netlist: string, baseDir?: string, opts?: SimOptions, live?: number) =>
  runSim(netlist, baseDir, opts, typeof live === 'number' ? (c) => e.sender.isDestroyed() || e.sender.send('sim:live', { id: live, c }) : undefined))
ipcMain.handle('sim:stop', () => active?.('user'))
app.on('will-quit', () => active?.('user'))

const NETLIST = { name: 'SPICE netlist', extensions: ['cir', 'sp', 'spice', 'net', 'txt'] }
const SCHEMATIC = { name: 'Spice Studio schematic', extensions: ['nsch'] }

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

// File > Open Raw File…: an existing ngspice / LTspice .raw, shown in the plots panel without running anything
ipcMain.handle('raw:open', async () => {
  const r = await dialog.showOpenDialog({ filters: [{ name: 'SPICE raw files', extensions: ['raw'] }, { name: 'All', extensions: ['*'] }], properties: ['openFile'] })
  if (r.canceled || !r.filePaths[0]) return null
  return { path: r.filePaths[0], plots: parseRaw(await readFile(r.filePaths[0])) }
})
// source dialog Browse…: a data / WAV file, relative to the open project's folder when it's inside it
ipcMain.handle('source:pick', async (_e, kind: 'pwl' | 'wav') => {
  const r = await dialog.showOpenDialog({
    filters: [kind === 'wav' ? { name: 'WAV audio', extensions: ['wav'] } : { name: 'Time/value data', extensions: ['csv', 'txt', 'dat', 'pwl'] }, { name: 'All', extensions: ['*'] }],
    properties: ['openFile']
  })
  const p = r.canceled ? undefined : r.filePaths[0]
  const d = p && [...projects].filter((d) => p.startsWith(d + sep)).sort((a, b) => b.length - a.length)[0]
  return !p ? null : d ? relative(d, p).split(sep).join('/') : p
})
// File › Import Schematic…: LTspice .asc (UTF-16 with a BOM or NULs, else UTF-8, else Latin-1) or KiCad .kicad_sch (UTF-8)
ipcMain.handle('file:import', async () => {
  const r = await dialog.showOpenDialog({ filters: [{ name: 'LTspice or KiCad schematic', extensions: ['asc', 'kicad_sch'] }], properties: ['openFile'] })
  if (r.canceled || !r.filePaths[0]) return null
  const b = await readFile(r.filePaths[0])
  let text: string
  if ((b[0] === 0xff && b[1] === 0xfe) || b.subarray(0, 200).includes(0)) text = b.toString('utf16le').replace(/^\uFEFF/, '')
  else try { text = new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { text = b.toString('latin1') }
  return { path: r.filePaths[0], text }
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
const saveRecents = (r: Recent[]) => writeFile(RECENT(), JSON.stringify(r.slice(0, 12), null, 1)).then(refreshMenu) // File > Open Recent
async function opened(file: string) {
  const dir = dirname(file)
  projects.add(dir)
  await saveRecents([{ name: basename(file, extname(file)), file, opened: Date.now() }, ...(await recents()).filter((x) => x.file !== file)])
  return { dir, file, text: await readFile(file, 'utf8') }
}

ipcMain.handle('project:defaultParent', () => join(app.getPath('documents'), 'Spice Studio'))
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
  const r = await dialog.showOpenDialog({ filters: [{ name: 'Spice Studio project', extensions: ['nsproj'] }], properties: ['openFile'] })
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
ipcMain.handle('recent:list', async () => (await recents()).map((x) => ({ ...x, exists: existsSync(x.file), trash: trashTarget(x.file) })))
ipcMain.handle('recent:remove', async (_e, file: string) => saveRecents((await recents()).filter((x) => x.file !== file)))
// Home › Recent › delete (the renderer asks first): forget the entry, or also move it to the Trash. Only a path already in
// the recent list is accepted; a project's folder goes, unless the .nsproj sits loose in a shared folder (then only the file).
function trashTarget(file: string): { path: string; folder: boolean } {
  const dir = dirname(file), shared = dir === dirname(dir) || (['home', 'documents', 'desktop', 'downloads'] as const).some((k) => app.getPath(k) === dir)
  const folder = /\.nsproj$/i.test(file) && !shared
  return { path: folder ? dir : file, folder }
}
ipcMain.handle('recent:delete', async (_e, file: string, trash: boolean) => {
  const all = await recents()
  if (!all.some((x) => x.file === file)) return
  if (trash) await shell.trashItem(trashTarget(file).path)
  await saveRecents(all.filter((x) => x.file !== file))
})
// Home › Recent › show in Finder / File Explorer, with the file selected
ipcMain.handle('recent:reveal', async (_e, file: string) => { if ((await recents()).some((x) => x.file === file)) shell.showItemInFolder(file) })

// ---- files opened from the OS (.nsproj/.nsch associations): macOS open-file, argv on Windows/Linux ----
// Queued until the renderer pulls them (app:opens), then pushed as 'open-path'.
let win: BrowserWindow | null = null
let pulled = false
const queue: string[] = []
const OPENABLE = /\.(nsproj|nsch)$/i
async function deliver(p: string) {
  try {
    return extname(p).toLowerCase() === '.nsproj' ? { project: await opened(p) } : { path: p, text: await readFile(p, 'utf8') }
  } catch (e) {
    return { error: `Can't open ${p}: ${(e as Error).message}` }
  }
}
function openPath(p: string) {
  if (!OPENABLE.test(p)) return
  if (!pulled || !win) return void queue.push(resolve(p))
  if (win.isMinimized()) win.restore()
  win.focus()
  deliver(resolve(p)).then((x) => win?.webContents.send('open-path', x))
}
const fromArgv = (argv: string[], cwd = process.cwd()) => argv.slice(1).filter((a) => OPENABLE.test(a) && !a.startsWith('-')).map((a) => resolve(cwd, a))
ipcMain.handle('app:opens', async () => {
  pulled = true
  const p = queue.splice(0).at(-1) // ponytail: one session at a time, so the last file wins
  return p ? deliver(p) : null
})
app.on('open-file', (e, p) => (e.preventDefault(), openPath(p))) // before ready: macOS sends launch files early
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', (_e, argv, cwd) => fromArgv(argv, cwd).forEach(openPath))
fromArgv(process.argv).forEach(openPath)

// ---- quit guard: closing the window asks the renderer (it owns the dirty state and the inline Save/Discard/Cancel banner) ----
// The renderer acks at once and later calls app:closeNow; no ack within 3 s (hung renderer) -> native dialog.
let closeNow = false
let ackTimer: NodeJS.Timeout | undefined
ipcMain.on('app:closeAck', () => clearTimeout(ackTimer))
ipcMain.on('app:closeNow', () => ((closeNow = true), win?.close()))
installUpdater(() => win, () => (closeNow = true)) // updater.ts; Restart to update goes through the renderer's unsaved-work guard first
function guardClose(w: BrowserWindow) {
  w.on('close', (e) => {
    if (closeNow || w.webContents.isCrashed()) return
    e.preventDefault()
    clearTimeout(ackTimer)
    w.webContents.send('app:closeRequest')
    ackTimer = setTimeout(async () => {
      const r = await dialog.showMessageBox(w, {
        type: 'warning',
        message: 'Spice Studio is not responding',
        detail: 'Any unsaved changes will be lost if you quit now.',
        buttons: ['Quit anyway', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      })
      if (r.response === 0) (closeNow = true), w.close()
    }, 3000)
  })
}

// window.open: only the results pop-out, Manage Libraries and the BOM (renderer layout/PopOut.tsx) get a window; http(s) links,
// from any window, go to the browser. The pop-outs close with the main window.
const WINDOWS: Record<string, Electron.BrowserWindowConstructorOptions> = {
  'ngspice-plots': { width: 1000, height: 700, minWidth: 480, minHeight: 320, title: 'Plots' },
  'ngspice-libraries': { width: 760, height: 560, minWidth: 520, minHeight: 360, title: 'Manage Libraries' },
  'ngspice-bom': { width: 1240, height: 680, minWidth: 640, minHeight: 360, title: 'Bill of Materials' }
}
const external = ({ url }: { url: string }) => (/^https?:\/\//i.test(url) && void shell.openExternal(url), { action: 'deny' as const })
function popouts(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler((d) => WINDOWS[d.frameName]
    ? { action: 'allow', overrideBrowserWindowOptions: { ...WINDOWS[d.frameName], backgroundColor: windowBg(), autoHideMenuBar: true } }
    : external(d))
  w.webContents.on('did-create-window', (c) => c.webContents.setWindowOpenHandler(external))
  w.on('closed', () => BrowserWindow.getAllWindows().forEach((x) => x.destroy()))
}

app.whenReady().then(() => {
  installMenu({ recents, engineDir: BUNDLED, window: () => win }) // menu.ts; no Reload item: Ctrl/Cmd+R is the schematic's rotate
  win = new BrowserWindow({
    // editor = sheets + library panel + canvas + plots: use most of the screen
    width: Math.max(1200, Math.round(screen.getPrimaryDisplay().workAreaSize.width * 0.92)),
    height: Math.max(800, Math.round(screen.getPrimaryDisplay().workAreaSize.height * 0.92)),
    backgroundColor: windowBg(),
    // mac: inset traffic lights over the header; Windows/Linux: a normal frame with the menu bar in the window
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : { autoHideMenuBar: false }),
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  guardClose(win)
  popouts(win)
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
})

app.on('window-all-closed', () => app.quit())
