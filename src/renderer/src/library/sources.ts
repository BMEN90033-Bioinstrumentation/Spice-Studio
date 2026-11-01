// Library sources outside a project: personal library + packs, loaded once per app run (App level), and the
// tools.importLibrary command (opens the library page and starts an import).
import { useEffect, useMemo, useState } from 'react'
import { useCommands } from '../commands'
import { entriesFromImport, type ImportedLib, type LibEntry, type SourceLibs } from './library'

export type PackInfo = Awaited<ReturnType<typeof window.api.packs.list>>[number]
type UserLib = Awaited<ReturnType<typeof window.api.userlib.list>>
export type Sources = ReturnType<typeof useSources>

export function useSources() {
  const [user, setUser] = useState<UserLib>({ dir: '', libs: [], texts: {} })
  const [packs, setPacks] = useState<PackInfo[]>([])
  const reload = () => window.api.userlib.list().then(setUser)
  useEffect(() => {
    reload().catch(() => {})
    window.api.packs.list().then(setPacks, () => {})
  }, [])
  const entries: LibEntry[] = useMemo(() => [
    ...user.libs.flatMap((l) => (user.texts[l.file] == null ? [] : entriesFromImport(l, user.texts[l.file], { source: 'user', prefix: 'user:', dir: user.dir, group: 'My library' }))),
    ...packs.flatMap((p) => p.libs.flatMap((l) => (p.texts[l.file] == null ? [] :
      entriesFromImport(l, p.texts[l.file], { source: 'pack', prefix: `pack:${p.id}/`, dir: p.dir, group: p.name, compat: p.compat }))))
  ], [user, packs])
  const srcs: SourceLibs[] = useMemo(() => [
    { prefix: 'user:', libs: user.libs, texts: user.texts },
    ...packs.map((p) => ({ prefix: `pack:${p.id}/`, libs: p.libs, texts: p.texts }))
  ], [user, packs])
  return {
    user, packs, entries, srcs,
    save: (lib: ImportedLib) => window.api.userlib.save(lib).then(reload),
    remove: (file: string) => window.api.userlib.remove(file).then(reload)
  }
}

// tools.importLibrary: flag a pending import, show the library page; LibraryView picks it up (now or when it mounts)
let pending = false
const subs = new Set<() => void>()
export function useImportCommand(show: () => void) {
  useCommands([{ id: 'tools.importLibrary', run: () => ((pending = true), show(), subs.forEach((f) => f())) }])
}
export function useImportRequest(start: () => void) {
  useEffect(() => {
    const h = () => { if (pending) (pending = false), start() }
    subs.add(h), h()
    return () => void subs.delete(h)
  })
}
