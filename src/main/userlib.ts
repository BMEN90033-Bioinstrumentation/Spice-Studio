// Library sources outside a project: the personal library ("My library", userData/library: index.json + files/) and
// read-only packs shipped with the app (library-packs/<id>/pack.json + files). Every renderer-supplied name is confined.
import { app, dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { inside } from './paths'

type Entry = { name: string; kind: string; category: string; pinMap: number[] }
type Lib = { file: string; entries: Entry[] }
export type Pack = { id: string; name: string; description: string; license: string; source: string; compat?: string; libs: Lib[]; dir: string; texts: Record<string, string> }

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
  const ext = extname(d.filePaths[0]), stem = basename(d.filePaths[0], ext).replace(/[^\w.-]+/g, '_') || 'lib'
  let file = stem + ext
  for (let i = 2; existsSync(inside(FILES(), file)); i++) file = `${stem}-${i}${ext}`
  await mkdir(FILES(), { recursive: true })
  await writeFile(inside(FILES(), file), text)
  return { file, text }
})
ipcMain.handle('userlib:save', async (_e, lib: Lib) => {
  if (!isLib(lib) || !existsSync(inside(FILES(), lib.file))) throw new Error('Bad library mapping')
  const l: Lib = { file: lib.file, entries: lib.entries.map(({ name, kind, category, pinMap }) => ({ name, kind, category, pinMap })) }
  await saveIndex([...(await index()).filter((x) => x.file !== l.file), l])
})
ipcMain.handle('userlib:remove', async (_e, file: string) => {
  const p = inside(FILES(), file)
  await saveIndex((await index()).filter((x) => x.file !== file))
  await rm(p, { force: true })
})

ipcMain.handle('packs:list', async (): Promise<Pack[]> => {
  const root = PACKS(), out: Pack[] = []
  if (!existsSync(root)) return out
  for (const d of await readdir(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    try {
      const dir = inside(root, d.name), p = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8'))
      const libs: Lib[] = Array.isArray(p.libs) ? p.libs.filter(isLib) : []
      const s = (x: unknown) => (typeof x === 'string' ? x : '')
      out.push({ id: d.name, name: s(p.name) || d.name, description: s(p.description), license: s(p.license), source: s(p.source), ...(p.compat && { compat: s(p.compat) }), libs, dir, texts: await texts(dir, libs) })
    } catch {} // ponytail: a broken pack is skipped silently; surface it if packs ever come from users
  }
  return out
})
