// Library sources outside a project: the personal library ("My library", userData/library: index.json + files/) and
// library packs (library-packs/<id>/pack.json + files): shipped with the app or added by the user (userData). Every renderer-supplied name is confined.
import { app, dialog, ipcMain } from 'electron'
import { constants, existsSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { checkPack, PACK_ID } from '../renderer/src/library/library'
import { validSymbol } from '../renderer/src/library/customSymbol'
import { inside } from './paths'

type Entry = { name: string; kind: string; category: string; pinMap: number[]; symbol?: unknown; mfr?: unknown; mpn?: unknown } // symbol: symbol editor
type Lib = { file: string; entries: Entry[]; enabled?: false } // enabled: false = hidden from browsing (Manage Libraries)
type Prov = { file: string; url: string; sha256: string; retrieved: string }
export type Pack = {
  id: string; name: string; description: string; license: string; source: string; compat?: string; libs: Lib[]; dir: string; texts: Record<string, string>
  version?: string; notice?: string; noticeText?: string; provenance?: Prov[]
  origin: 'bundled' | 'user' // shipped with the app (disable only) or added by the user (userData/library-packs)
  enabled: boolean // shown in the Parts panel / search; disabled packs still resolve for netlisting
}
const NOTICE_MAX = 256 * 1024 // licence texts are ~20 KB; a stray huge file is cut, not shipped over IPC whole

const DIR = () => join(app.getPath('userData'), 'library')
const FILES = () => join(DIR(), 'files')
const INDEX = () => join(DIR(), 'index.json')
const PACKS = () => (app.isPackaged ? join(process.resourcesPath, 'library-packs') : join(app.getAppPath(), 'library-packs'))

const isLib = (l: any): l is Lib =>
  typeof l?.file === 'string' && /^[^\\/]+$/.test(l.file) && Array.isArray(l.entries) &&
  l.entries.every((e: any) => typeof e?.name === 'string' && typeof e.kind === 'string' && typeof e.category === 'string' && Array.isArray(e.pinMap) && e.pinMap.every(Number.isInteger))

async function index(): Promise<Lib[]> {
  try {
    const r = JSON.parse(await readFile(INDEX(), 'utf8'))
    return Array.isArray(r) ? r.filter(isLib) : []
  } catch {
    return []
  }
}
const saveIndex = async (libs: Lib[]) => (await mkdir(DIR(), { recursive: true }), writeFile(INDEX(), JSON.stringify(libs, null, 1)))

// file texts by name; missing/unreadable files are left out (the renderer reports them)
async function texts(dir: string, libs: Lib[]) {
  const t: Record<string, string> = {}
  for (const l of libs) await readFile(inside(dir, l.file), 'utf8').then((s) => (t[l.file] = s), () => {})
  return t
}

// write text as a new file in files/ (never overwriting: -2, -3… when the name is taken); returns the name used
async function addFile(name: string, ext: string, text: string) {
  const stem = name.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '') || 'lib'
  let file = stem + ext
  for (let i = 2; existsSync(inside(FILES(), file)); i++) file = `${stem}-${i}${ext}`
  await mkdir(FILES(), { recursive: true })
  await writeFile(inside(FILES(), file), text)
  return file
}

ipcMain.handle('userlib:list', async () => {
  const libs = await index()
  return { dir: FILES(), libs, texts: await texts(FILES(), libs) }
})
// pick a model file and copy it into files/ (never overwriting); the mapping is stored by userlib:save
ipcMain.handle('userlib:import', async () => {
  const d = await dialog.showOpenDialog({
    filters: [{ name: 'SPICE models', extensions: ['lib', 'mod', 'cir', 'sub', 'txt', 'model', 'spi'] }, { name: 'All', extensions: ['*'] }],
    properties: ['openFile']
  })
  if (d.canceled || !d.filePaths[0]) return null
  const text = await readFile(d.filePaths[0], 'utf8')
  const ext = extname(d.filePaths[0])
  return { file: await addFile(basename(d.filePaths[0], ext), ext, text), text }
})
// a part written in the component builder: its SPICE text becomes a new file in files/; the mapping is stored by userlib:save
ipcMain.handle('userlib:create', async (_e, name: unknown, text: unknown) => {
  if (typeof name !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 4 * 1024 * 1024) throw new Error('Bad component')
  return { file: await addFile(name.slice(0, 64), '.lib', text) }
})
// the component builder editing a part made earlier: only a file My library already lists
ipcMain.handle('userlib:write', async (_e, file: unknown, text: unknown) => {
  if (typeof file !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 4 * 1024 * 1024 || !(await index()).some((l) => l.file === file)) throw new Error('Bad component')
  await writeFile(inside(FILES(), file), text)
})
const short = (s: unknown) => typeof s === 'string' && !!s && s.length <= 80
ipcMain.handle('userlib:save', async (_e, lib: Lib) => {
  if (!isLib(lib) || !existsSync(inside(FILES(), lib.file))) throw new Error('Bad library mapping')
  const l: Lib = { file: lib.file, entries: lib.entries.map(({ name, kind, category, pinMap, symbol, mfr, mpn }) => ({ name, kind, category, pinMap, ...(validSymbol(symbol) && { symbol }), ...(short(mfr) && { mfr }), ...(short(mpn) && { mpn }) })) }
  await saveIndex([...(await index()).filter((x) => x.file !== l.file), l])
})
ipcMain.handle('userlib:setEnabled', async (_e, file: unknown, on: unknown) => {
  if (typeof file !== 'string' || typeof on !== 'boolean') throw new Error('Bad library file')
  await saveIndex((await index()).map((l) => {
    if (l.file !== file) return l
    const { enabled: _, ...r } = l
    return on ? r : { ...r, enabled: false as const }
  }))
})
ipcMain.handle('userlib:remove', async (_e, file: string) => {
  const p = inside(FILES(), file)
  await saveIndex((await index()).filter((x) => x.file !== file))
  await rm(p, { force: true })
})

const USER_PACKS = () => join(app.getPath('userData'), 'library-packs')
const ENABLED = () => join(app.getPath('userData'), 'library-packs-enabled.json')
const FILE_MAX = 32 * 1024 * 1024 // per file read when adding a pack
const roots = () => [[PACKS(), 'bundled'], [USER_PACKS(), 'user']] as const
const goodId = (id: unknown): id is string => typeof id === 'string' && PACK_ID.test(id)

async function readPack(dir: string, id: string, origin: Pack['origin'], enabled: boolean): Promise<Pack> {
  const p = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8'))
  const libs: Lib[] = Array.isArray(p.libs) ? p.libs.filter(isLib) : []
  const s = (x: unknown) => (typeof x === 'string' ? x : '')
  const prov: Prov[] = Array.isArray(p.provenance) ? p.provenance.filter((x: any) => x && typeof x === 'object').map((x: any) => ({ file: s(x.file), url: s(x.url), sha256: s(x.sha256), retrieved: s(x.retrieved) })) : []
  const notice = s(p.notice), noticeText = notice ? await Promise.resolve().then(() => readFile(inside(dir, notice), 'utf8')).then((t) => (t.length > NOTICE_MAX ? t.slice(0, NOTICE_MAX) + '\n[… truncated]' : t), () => undefined) : undefined
  return {
    id, name: s(p.name) || id, description: s(p.description), license: s(p.license), source: s(p.source), ...(p.compat && { compat: s(p.compat) }), libs, dir, texts: await texts(dir, libs),
    ...(!!s(p.version) && { version: s(p.version) }), ...(!!notice && { notice }), ...(noticeText != null && { noticeText }), ...(prov.length > 0 && { provenance: prov }), origin, enabled
  }
}
// pack id -> false for disabled ones; everything else is enabled
async function disabled(): Promise<Record<string, boolean>> {
  try {
    const m = JSON.parse(await readFile(ENABLED(), 'utf8'))
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {}
  } catch {
    return {}
  }
}
const setDisabled = async (m: Record<string, boolean>) => (await mkdir(app.getPath('userData'), { recursive: true }), writeFile(ENABLED(), JSON.stringify(m, null, 1)))
// pack folder names, bundled first; a user pack never shadows a bundled one of the same id
async function packDirs() {
  const out: { id: string; dir: string; origin: Pack['origin'] }[] = []
  for (const [root, origin] of roots()) {
    if (!existsSync(root)) continue
    for (const d of await readdir(root, { withFileTypes: true }))
      if (d.isDirectory() && goodId(d.name) && !out.some((x) => x.id.toLowerCase() === d.name.toLowerCase())) out.push({ id: d.name, dir: inside(root, d.name), origin })
  }
  return out
}

ipcMain.handle('packs:list', async (): Promise<Pack[]> => {
  const off = await disabled(), out: Pack[] = []
  for (const { id, dir, origin } of await packDirs())
    await readPack(dir, id, origin, off[id] !== false).then((p) => out.push(p), (e) => console.warn(`library pack ${dir} skipped: ${e}`))
  return out
})
ipcMain.handle('packs:setEnabled', async (_e, id: unknown, on: unknown) => {
  if (!goodId(id) || typeof on !== 'boolean') throw new Error('Bad pack id')
  const m = await disabled()
  if (on) delete m[id]
  else m[id] = false
  await setDisabled(m)
})
// pick a folder holding pack.json, validate it (checkPack), copy pack.json + its files to userData/library-packs/<id>/
ipcMain.handle('packs:add', async (): Promise<{ id: string } | { errors: string[] } | null> => {
  const d = await dialog.showOpenDialog({ title: 'Add library pack', message: 'Choose a folder that contains pack.json', buttonLabel: 'Add pack', properties: ['openDirectory'] })
  if (d.canceled || !d.filePaths[0]) return null
  const src = d.filePaths[0]
  if (!existsSync(join(src, 'pack.json'))) return { errors: [`${basename(src)} has no pack.json: choose the folder that contains it`] }
  let raw: any
  try {
    raw = JSON.parse(await readFile(join(src, 'pack.json'), 'utf8'))
  } catch (e) {
    return { errors: [`pack.json is not valid JSON: ${(e as Error).message}`] }
  }
  const read = (f: string) => {
    try {
      const p = inside(src, f)
      return statSync(p).size > FILE_MAX ? undefined : readFileSync(p, 'utf8')
    } catch {
      return undefined
    }
  }
  const errors = checkPack(raw, read, (await packDirs()).map((x) => x.id))
  if (errors.length) return { errors }
  await mkdir(USER_PACKS(), { recursive: true })
  const dest = inside(USER_PACKS(), raw.id)
  try {
    await mkdir(dest) // never overwrite: fails if the folder exists
  } catch {
    return { errors: [`${dest} already exists`] }
  }
  try {
    for (const f of new Set<string>(['pack.json', ...raw.libs.map((l: Lib) => l.file), ...(raw.notice ? [raw.notice] : [])]))
      await copyFile(inside(src, f), inside(dest, f), constants.COPYFILE_EXCL)
  } catch (e) {
    await rm(dest, { recursive: true, force: true })
    throw e
  }
  return { id: raw.id }
})
// user-installed packs only: bundled ones live outside USER_PACKS and can only be disabled
ipcMain.handle('packs:remove', async (_e, id: unknown) => {
  if (!goodId(id)) throw new Error('Bad pack id')
  await rm(inside(USER_PACKS(), id), { recursive: true, force: true })
  const m = await disabled()
  if (id in m) delete m[id], await setDisabled(m)
})
