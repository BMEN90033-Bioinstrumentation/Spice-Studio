// Library sources outside a project: personal library + packs (App level).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { libEntries, packEntries, type ImportedLib, type LibEntry, type SourceLibs } from './library'

export type PackInfo = Awaited<ReturnType<typeof window.api.packs.list>>[number]
type UserLib = Awaited<ReturnType<typeof window.api.userlib.list>>
export type Sources = ReturnType<typeof useSources>
// packs: one app-wide store, read once and re-read after Add / Remove; shared by the library, Manage Libraries and
// Help › Third-party Licences
let packs: PackInfo[] = [], packsP: Promise<PackInfo[]> | undefined
const packSubs = new Set<() => void>()
const setPacks = (p: PackInfo[]) => ((packs = p), packSubs.forEach((f) => f()), p)
export const reloadPacks = () => (packsP = window.api.packs.list().then(setPacks))
export const loadPacks = () => packsP ?? reloadPacks()
export const usePacks = () => useSyncExternalStore((f) => (packSubs.add(f), () => void packSubs.delete(f)), () => packs)
// optimistic: the panel updates at once; a failed write re-reads the truth
export function setPackEnabled(id: string, on: boolean) {
  setPacks(packs.map((p) => (p.id === id ? { ...p, enabled: on } : p)))
  window.api.packs.setEnabled(id, on).catch(() => reloadPacks())
}

export function useSources() {
  const [user, setUser] = useState<UserLib>({ dir: '', libs: [], texts: {} })
  const packs = usePacks()
  const reload = () => window.api.userlib.list().then(setUser)
  useEffect(() => {
    reload().catch(() => {})
    loadPacks().catch(() => {})
  }, [])
  // separate memos: saving to My library must not re-parse thousands of pack parts
  const ue = useMemo(() => libEntries(user.libs, user.texts, { source: 'user', prefix: 'user:', dir: user.dir, group: 'My library' }), [user])
  const pk = useMemo(() => packEntries(packs), [packs])
  // entries: everything (resolver, copy-on-use); browse: what the parts lists show and search (enabled libraries only)
  const entries: LibEntry[] = useMemo(() => [...ue.all, ...pk.all], [ue, pk.all])
  const browse: LibEntry[] = useMemo(() => [...ue.shown, ...pk.shown], [ue, pk.shown])
  const srcs: SourceLibs[] = useMemo(() => [
    { prefix: 'user:', libs: user.libs, texts: user.texts },
    ...packs.map((p) => ({ prefix: `pack:${p.id}/`, libs: p.libs, texts: p.texts }))
  ], [user, packs])
  return {
    user, packs, entries, browse, srcs,
    save: (lib: ImportedLib) => window.api.userlib.save(lib).then(reload),
    remove: (file: string) => window.api.userlib.remove(file).then(reload),
    // optimistic, like packs
    setEnabled: (file: string, on: boolean) => {
      setUser((u) => ({ ...u, libs: u.libs.map((l) => (l.file !== file ? l : { ...l, enabled: on ? undefined : false })) }))
      window.api.userlib.setEnabled(file, on).catch(() => reload())
    }
  }
}
