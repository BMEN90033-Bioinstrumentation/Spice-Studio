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
import { reloadPacks, setPackEnabled, usePacks, type PackInfo, type Sources } from './sources'
import '../sim/AnalysisDialog.css'
import './library.css'

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
  const first = useRef<HTMLButtonElement>(null)
  const seen = useRef(0) // import requests already handled (a fresh window handles the one that opened it)
  useEffect(() => { if (req > seen.current) (seen.current = req), setMenu(true) }, [req])
  useEffect(() => { if (menu) first.current?.focus() }, [menu])
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
    pack?: PackInfo; rm?: { warn: string; run: () => unknown }
  }) => (
    <li key={o.k} className={o.on ? '' : 'off'}>
      <div className="packs-row">
        {o.toggle ? <input type="checkbox" id={'ml-' + o.k} checked={o.on} onChange={(e) => o.toggle!(e.target.checked)} aria-describedby={'mld-' + o.k} />
          : <input type="checkbox" checked disabled aria-label="Always shown" />}
        <label htmlFor={'ml-' + o.k} className="packs-name" title={o.title ?? o.name}>{o.name}</label>
        {o.pack?.license && <span className="libv-lic" title={`Licence: ${o.pack.license}`}>{o.pack.license.length > 28 ? o.pack.license.slice(0, 26) + '…' : o.pack.license}</span>}
        {o.rm && <button className="mlib-rm" aria-expanded={ask === o.k} onClick={() => setAsk(ask === o.k ? null : o.k)}>Remove</button>}
      </div>
      <p className="packs-meta" id={'mld-' + o.k}>
        {o.meta}
        {o.pack && <>{' · '}<button className="libv-link" aria-expanded={notice === o.pack.id} onClick={() => setNotice(notice === o.pack!.id ? null : o.pack!.id)}>Notice</button></>}
      </p>
      {o.pack && notice === o.pack.id && <PackLicence pack={o.pack} />}
      {o.rm && ask === o.k && (
        <div className="mlib-ask" role="alertdialog" aria-label={`Remove ${o.name}?`}
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setAsk(null))}>
          <span>Remove <b>{o.name}</b>? {o.rm.warn}</span>
          <button className="mlib-danger" autoFocus onClick={() => remove(o.name, o.rm!.run)}>Remove</button>
          <button onClick={() => setAsk(null)}>Cancel</button>
        </div>
      )}
    </li>
  )
  const KEEP = 'Projects that already use its parts keep their own copy; loose sheets using it will stop netlisting.'

  return (
    <div className="mlib" onKeyDown={(e) => e.key === 'Escape' && !imp && (menu ? setMenu(false) : ask && setAsk(null))}>
      <div className="mlib-body">
        <p className="adlg-msg">
          Checked libraries’ parts are listed in the parts lists and found by search. Unchecking only hides a library: circuits that already use its parts keep simulating.
        </p>
        <h2>Built-in</h2>
        <ul className="packs-list">
          {row({ k: 'builtin', name: 'ngspice Studio parts', on: true, meta: `${plural(BUNDLED.length, 'part')} · bundled with the app · always shown` })}
        </ul>
        <h2>Library packs</h2>
        <ul className="packs-list">
          {packs.map((p) => row({
            k: 'pack-' + p.id, name: p.name, title: p.description || p.name, on: p.enabled, toggle: (on) => setPackEnabled(p.id, on), pack: p,
            meta: <>{[p.version && (/^\d/.test(p.version) ? `v${p.version}` : p.version), plural(packParts(p), 'part'), p.origin === 'user' ? 'added by you' : 'bundled'].filter(Boolean).join(' · ')}
              {p.source && <> · {isUrl(p.source) ? <a href={p.source} target="_blank" rel="noreferrer" title={p.source}>source</a> : p.source}</>}</>,
            rm: p.origin === 'user' ? { warn: KEEP, run: () => window.api.packs.remove(p.id).then(reloadPacks) } : undefined
          }))}
          {!packs.length && <li className="libv-muted">No library packs installed.</li>}
        </ul>
        <h2>My libraries</h2>
        <ul className="packs-list">
          {sources.user.libs.map((l) => row({
            k: 'user-' + l.file, name: l.file, on: libOn(l), toggle: (on) => sources.setEnabled(l.file, on),
            meta: `${plural(l.entries.length, 'part')} · available in every project${sources.user.texts[l.file] == null ? ' · file missing' : ''}`,
            rm: { warn: KEEP, run: () => sources.remove(l.file) }
          }))}
          {!sources.user.libs.length && <li className="libv-muted">Import a vendor .lib file into My libraries to use it in every project.</li>}
        </ul>
        {project && (
          <>
            <h2>This project</h2>
            <ul className="packs-list">
              {project.libs.map((l) => row({
                k: 'proj-' + l.file, name: l.file.replace(/^libs\//, ''), title: l.file, on: libOn(l), toggle: (on) => project.onToggle(l.file, on),
                meta: `${plural(l.entries.length, 'part')} · in this project’s libs/ folder${project.texts[l.file] == null ? ' · file missing' : ''}`,
                rm: { warn: 'Parts already placed from it will stop netlisting.', run: () => project.onRemove(l.file) }
              }))}
              {!project.libs.length && <li className="libv-muted">No libraries imported into this project yet.</li>}
            </ul>
          </>
        )}
        {errs && (
          <div className="packs-err" role="alert">
            <b>{errs.title}</b>
            <ul>{errs.list.slice(0, MAX_ERRS).map((e, i) => <li key={i}>{e}</li>)}{errs.list.length > MAX_ERRS && <li>… and {errs.list.length - MAX_ERRS} more</li>}</ul>
          </div>
        )}
        {note && <p className="adlg-msg" role="status">{note}</p>}
      </div>
      <div className="adlg-foot mlib-foot">
        <span className="adlg-hint">Library files: .lib / .mod / .sub with .model or .subckt. A pack is a folder with a <code>pack.json</code>.</span>
        <div className="mlib-imp">
          {menu && (
            <div className="mlib-menu" role="menu" aria-label="Import library">
              {project && (
                <div className="libv-to" role="radiogroup" aria-label="Import a library file into">
                  {(['user', 'project'] as const).map((t) => (
                    <button key={t} role="radio" aria-checked={target === t} className={target === t ? 'on' : ''} onClick={() => setTo(t)}>{t === 'user' ? 'My libraries' : 'This project'}</button>
                  ))}
                </div>
              )}
              <button ref={first} role="menuitem" onClick={() => importFile(target)}>
                <b>Library file (.lib, .mod, .sub…)</b>
                <small>{target === 'user' ? 'Into My libraries: usable in every project' : 'Copied into this project’s libs/ folder'}</small>
              </button>
              <button role="menuitem" onClick={addPack}><b>Library pack folder…</b><small>A folder with pack.json and its library files</small></button>
            </div>
          )}
          <button className="run" aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={() => setMenu(!menu)}>{busy ? 'Adding…' : 'Import library…'}</button>
        </div>
        <button onClick={onClose}>Done</button>
      </div>

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
