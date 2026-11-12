// Tools › Manage Libraries… (also the button under both parts lists): its own window listing every library (built-in,
// packs, My libraries, this project's) with a show / hide checkbox, Remove, and Import library… (a .lib file through
// the pin-mapping dialog, or a pack folder). Hidden libraries leave the parts lists and search only: parts already
// placed keep netlisting. Where "enabled" lives: packs userData/library-packs-enabled.json; My libraries the entry in
// userData/library/index.json; project libraries their entry in the .nsproj (enabled: false), so it travels with it.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useCommands } from '../commands'
import { isUrl, PackLicence } from '../Help'
import { focusPopout, LIBWIN, PopOut } from '../layout/PopOut'
import { BUNDLED, libOn, parseLibFile, type ImportedLib, type ParsedLib } from './library'
import { ImportDialog } from './LibraryView'
import { SymbolEditor } from './SymbolEditor'
import { reloadPacks, setPackEnabled, usePacks, type PackInfo, type Sources } from './sources'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Tip } from '@/components/ui/tip'
import { cn } from '@/lib/utils'

export type ProjectLibs = {
  dir: string; libs: ImportedLib[]; texts: Record<string, string>
  onImport: (lib: ImportedLib) => unknown; onRemove: (file: string) => unknown; onToggle: (file: string, on: boolean) => unknown
}
type Target = 'user' | 'project'

// open flag + import requests (tools.importLibrary): app-wide, so App and Workspace share one window
let st = { open: false, req: 0 }
const subs = new Set<() => void>()
const set = (p: Partial<typeof st>) => ((st = { ...st, ...p }), subs.forEach((f) => f()))
const useSt = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => st)

const msg = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`
const packParts = (p: PackInfo) => p.libs.reduce((n, l) => n + l.entries.length, 0)
const MAX_ERRS = 12
const MUTED = 'text-xs leading-normal text-muted-foreground'
const H2 = 'mt-2.5 mb-0.5 text-xs font-medium text-muted-foreground'
const UL = 'grid list-none gap-1.5'
const LINK = 'h-auto p-0 text-[11px]'
const ITEM = 'grid gap-px text-xs'

export function ManageLibraries({ sources, project }: { sources: Sources; project: ProjectLibs | null }) {
  const s = useSt()
  useCommands([
    { id: 'tools.manageLibraries', run: () => (st.open ? focusPopout(LIBWIN) : set({ open: true })) },
    { id: 'tools.importLibrary', run: () => (st.open && focusPopout(LIBWIN), set({ open: true, req: st.req + 1 })) }
  ])
  if (!s.open) return null
  return (
    <PopOut name={LIBWIN} size="width=760,height=560" title="Manage Libraries" onClose={() => set({ open: false })}>
      <Manager sources={sources} project={project} req={s.req} onClose={() => set({ open: false })} />
    </PopOut>
  )
}

function Manager({ sources, project, req, onClose }: { sources: Sources; project: ProjectLibs | null; req: number; onClose: () => void }) {
  const packs = usePacks()
  const [menu, setMenu] = useState(false) // Import library… choices
  const [to, setTo] = useState<Target>('user')
  const target: Target = project ? to : 'user'
  const [imp, setImp] = useState<{ rel: string; to: Target; parsed: ParsedLib } | null>(null)
  const [errs, setErrs] = useState<{ title: string; list: string[] } | null>(null)
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<string | null>(null) // pack id whose licence / notice is expanded
  const [ask, setAsk] = useState<string | null>(null) // row key whose Remove is awaiting confirmation
  const [busy, setBusy] = useState(false)
  const [symFor, setSymFor] = useState<{ lib: ImportedLib; text: string; save: (l: ImportedLib) => Promise<unknown> } | null>(null) // symbol editor
  const first = useRef<HTMLDivElement>(null)
  const seen = useRef(0) // import requests already handled (a fresh window handles the one that opened it)
  useEffect(() => { if (req > seen.current) (seen.current = req), setMenu(true) }, [req])
  useEffect(() => { if (menu) first.current?.focus() }, [menu]) // after Radix focuses the menu: start on Library file
  const say = (n: string) => (setErrs(null), setNote(n))
  const fail = (title: string, e: unknown) => (setNote(''), setErrs({ title, list: [msg(e)] }))

  async function importFile(t: Target) {
    setMenu(false), say('')
    try {
      const r = t === 'user' ? await window.api.userlib.import().then((r) => r && { rel: r.file, text: r.text }) : await window.api.project.importLib(project!.dir)
      if (r) setImp({ rel: r.rel, to: t, parsed: parseLibFile(r.text) })
    } catch (e) {
      fail('Couldn’t import that file:', e)
    }
  }
  // the pick already copied the file: drop it again unless it was imported before
  function cancelImport() {
    if (imp?.to === 'user' && !sources.user.libs.some((l) => l.file === imp.rel)) window.api.userlib.remove(imp.rel).catch(() => {})
    if (imp?.to === 'project' && project && !project.libs.some((l) => l.file === imp.rel)) window.api.project.remove(project.dir, imp.rel).catch(() => {})
    setImp(null)
  }
  async function addPack() {
    setMenu(false), say(''), setBusy(true)
    try {
      const r = await window.api.packs.add()
      if (r && 'errors' in r) setErrs({ title: 'Couldn’t add that pack:', list: r.errors })
      else if (r) say(`Added ${(await reloadPacks()).find((p) => p.id === r.id)?.name ?? r.id}.`)
    } catch (e) {
      fail('Couldn’t add that pack:', e)
    } finally {
      setBusy(false)
    }
  }
  async function remove(name: string, f: () => unknown) {
    setAsk(null), say('')
    try {
      await f()
      say(`Removed ${name}.`)
    } catch (e) {
      fail(`Couldn’t remove ${name}:`, e)
    }
  }

  // one library row: checkbox (none for built-in), name, meta line, optional licence / notice and inline Remove confirm
  const row = (o: {
    k: string; name: string; on: boolean; toggle?: (on: boolean) => void; meta: React.ReactNode; title?: string
    pack?: PackInfo; rm?: { warn: string; run: () => unknown }; sym?: () => void
  }) => (
    <li key={o.k} className="grid gap-1 rounded-lg border bg-card px-2.5 py-2">
      <div className="flex items-center gap-2">
        {o.toggle ? <Checkbox id={'ml-' + o.k} checked={o.on} onCheckedChange={(c) => o.toggle!(c === true)} aria-describedby={'mld-' + o.k} />
          : <Checkbox checked disabled aria-label="Always shown" />}
        <Tip label={o.title ?? o.name}>
          <Label htmlFor={'ml-' + o.k} className={cn('block min-w-0 flex-1 cursor-pointer truncate text-[13px] leading-normal', !o.on && 'opacity-60')}>{o.name}</Label>
        </Tip>
        {o.pack?.license && (
          <Tip label={`Licence: ${o.pack.license}`}>
            <Badge variant="outline" className="border-ok/35 font-mono text-[10px] font-normal text-ok">{o.pack.license.length > 28 ? o.pack.license.slice(0, 26) + '…' : o.pack.license}</Badge>
          </Tip>
        )}
        {o.sym && <Tip label="Draw custom symbols for this library's parts"><Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={o.sym}>Symbols…</Button></Tip>}
        {o.rm && (
          <Button variant="ghost" size="sm" aria-expanded={ask === o.k} onClick={() => setAsk(ask === o.k ? null : o.k)}
            className="h-6 px-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive aria-expanded:bg-destructive/10 aria-expanded:text-destructive dark:hover:bg-destructive/20">Remove</Button>
        )}
      </div>
      <Collapsible className="grid gap-1" open={!!o.pack && notice === o.pack.id} onOpenChange={(v) => setNotice(v ? o.pack!.id : null)}>
        <p className={cn('ml-6 text-[11px] leading-normal text-muted-foreground', !o.on && 'opacity-60')} id={'mld-' + o.k}>
          {o.meta}
          {o.pack && <>{' · '}<CollapsibleTrigger asChild><Button variant="link" className={LINK}>Notice</Button></CollapsibleTrigger></>}
        </p>
        {o.pack && <CollapsibleContent className="pt-1.5 pl-6 [&_.help-text]:max-h-[260px]"><PackLicence pack={o.pack} /></CollapsibleContent>}
      </Collapsible>
      {o.rm && ask === o.k && (
        <div className="ml-6 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-dashed border-destructive/40 px-2 py-1.5 text-xs" role="alertdialog" aria-label={`Remove ${o.name}?`}
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setAsk(null))}>
          <span className="flex-[1_1_260px] text-muted-foreground">Remove <b className="font-medium text-foreground">{o.name}</b>? {o.rm.warn}</span>
          <Button variant="destructive" size="sm" autoFocus onClick={() => remove(o.name, o.rm!.run)}>Remove</Button>
          <Button variant="outline" size="sm" onClick={() => setAsk(null)}>Cancel</Button>
        </div>
      )}
    </li>
  )
  const KEEP = 'Projects that already use its parts keep their own copy; loose sheets using it will stop netlisting.'

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" onKeyDown={(e) => e.key === 'Escape' && !imp && (menu ? setMenu(false) : ask && setAsk(null))}>
      <div className="grid min-h-0 flex-1 content-start gap-1.5 overflow-auto px-4.5 py-3.5">
        <p className={MUTED + ' mb-1'}>
          Checked libraries’ parts are listed in the parts lists and found by search. Unchecking only hides a library: circuits that already use its parts keep simulating.
        </p>
        <h2 className={H2}>Built-in</h2>
        <ul className={UL}>
          {row({ k: 'builtin', name: 'Spice Studio parts', on: true, meta: `${plural(BUNDLED.length, 'part')} · bundled with the app · always shown` })}
        </ul>
        <h2 className={H2}>Library packs</h2>
        <ul className={UL}>
          {packs.map((p) => row({
            k: 'pack-' + p.id, name: p.name, title: p.description || p.name, on: p.enabled, toggle: (on) => setPackEnabled(p.id, on), pack: p,
            meta: <>{[p.version && (/^\d/.test(p.version) ? `v${p.version}` : p.version), plural(packParts(p), 'part'), p.origin === 'user' ? 'added by you' : 'bundled'].filter(Boolean).join(' · ')}
              {p.source && <> · {isUrl(p.source) ? <Tip label={p.source}><Button asChild variant="link" className={LINK}><a href={p.source} target="_blank" rel="noreferrer">source</a></Button></Tip> : p.source}</>}</>,
            rm: p.origin === 'user' ? { warn: KEEP, run: () => window.api.packs.remove(p.id).then(reloadPacks) } : undefined
          }))}
          {!packs.length && <li className={MUTED}>No library packs installed.</li>}
        </ul>
        <h2 className={H2}>My libraries</h2>
        <ul className={UL}>
          {sources.user.libs.map((l) => row({
            k: 'user-' + l.file, name: l.file, on: libOn(l), toggle: (on) => sources.setEnabled(l.file, on),
            meta: `${plural(l.entries.length, 'part')} · available in every project${sources.user.texts[l.file] == null ? ' · file missing' : ''}`,
            rm: { warn: KEEP, run: () => sources.remove(l.file) },
            sym: sources.user.texts[l.file] == null ? undefined : () => setSymFor({ lib: l, text: sources.user.texts[l.file], save: sources.save })
          }))}
          {!sources.user.libs.length && <li className={MUTED}>Import a vendor .lib file into My libraries to use it in every project.</li>}
        </ul>
        {project && (
          <>
            <h2 className={H2}>This project</h2>
            <ul className={UL}>
              {project.libs.map((l) => row({
                k: 'proj-' + l.file, name: l.file.replace(/^libs\//, ''), title: l.file, on: libOn(l), toggle: (on) => project.onToggle(l.file, on),
                meta: `${plural(l.entries.length, 'part')} · in this project’s libs/ folder${project.texts[l.file] == null ? ' · file missing' : ''}`,
                rm: { warn: 'Parts already placed from it will stop netlisting.', run: () => project.onRemove(l.file) },
                sym: project.texts[l.file] == null ? undefined : () => setSymFor({ lib: l, text: project.texts[l.file], save: async (x) => project.onImport(x) })
              }))}
              {!project.libs.length && <li className={MUTED}>No libraries imported into this project yet.</li>}
            </ul>
          </>
        )}
        {errs && (
          <Alert variant="destructive">
            <AlertTitle>{errs.title}</AlertTitle>
            <AlertDescription>
              <ul className="grid list-disc gap-0.5 pl-4 text-xs">{errs.list.slice(0, MAX_ERRS).map((e, i) => <li key={i}>{e}</li>)}{errs.list.length > MAX_ERRS && <li>… and {errs.list.length - MAX_ERRS} more</li>}</ul>
            </AlertDescription>
          </Alert>
        )}
        {note && <p className={MUTED} role="status">{note}</p>}
      </div>
      <div className="flex items-center gap-2 border-t px-4 py-3">
        <span className="mr-auto text-xs text-muted-foreground">Library files: .lib / .mod / .sub with .model or .subckt. A pack is a folder with a <code className="font-mono">pack.json</code>.</span>
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={busy}>{busy ? 'Adding…' : 'Import library…'}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-72" aria-label="Import library">
            {project && (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Import a library file into</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={target} onValueChange={(v) => setTo(v as Target)} aria-label="Import a library file into">
                  {/* preventDefault: picking the target keeps the menu open */}
                  <DropdownMenuRadioItem value="user" onSelect={(e) => e.preventDefault()}>My libraries</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="project" onSelect={(e) => e.preventDefault()}>This project</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem ref={first} className={ITEM} onSelect={() => importFile(target)}>
              <b className="font-medium">Library file (.lib, .mod, .sub…)</b>
              <small className="text-[11px] text-muted-foreground">{target === 'user' ? 'Into My libraries: usable in every project' : 'Copied into this project’s libs/ folder'}</small>
            </DropdownMenuItem>
            <DropdownMenuItem className={ITEM} onSelect={addPack}><b className="font-medium">Library pack folder…</b><small className="text-[11px] text-muted-foreground">A folder with pack.json and its library files</small></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
      </div>

      {symFor && <SymbolEditor lib={symFor.lib} text={symFor.text} onClose={() => setSymFor(null)}
        onSave={(l) => symFor.save(l).then(() => say(`Saved the symbols of ${l.file.replace(/^libs\//, '')}. Parts you place from now on use them; select a placed part to switch it over.`))} />}
      {imp && (
        <ImportDialog rel={imp.rel} parsed={imp.parsed} onClose={cancelImport}
          onImport={(lib) => {
            const t = imp.to
            setImp(null)
            Promise.resolve(t === 'user' ? sources.save(lib) : project?.onImport(lib))
              .then(() => say(`Imported ${plural(lib.entries.length, 'part')} from ${lib.file} into ${t === 'user' ? 'My libraries' : 'this project'}.`), (e) => fail('Import failed:', e))
          }} />
      )}
    </div>
  )
}
