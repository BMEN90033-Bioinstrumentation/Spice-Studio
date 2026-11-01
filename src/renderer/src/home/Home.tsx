import { useEffect, useRef, useState, type FormEvent } from 'react'
import { validName } from '../project/project'
import { TEMPLATES } from '../schematic/templates'
import { Icon } from '../icons'
import './Home.css'

type Recent = { name: string; file: string; opened: number; exists: boolean }

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536e3], ['month', 2592e3], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
function ago(t: number) {
  const s = (t - Date.now()) / 1000
  for (const [u, n] of UNITS) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u)
  return 'just now'
}
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

export const BLANK = 'blank'
const CHOICES = [{ id: BLANK, name: 'Blank', description: 'An empty main sheet.' }, ...TEMPLATES]

export function Home({ onCreate, onOpen, onOpenFile, onLibrary, error, form, setForm }: {
  onCreate: (parent: string, name: string, template: string) => Promise<void>
  onOpen: (file?: string) => Promise<void>
  onOpenFile: () => Promise<void>
  onLibrary: () => void
  error: string
  form: boolean // the new-project form (owned by App: File › New Project opens it)
  setForm: (open: boolean) => void
}) {
  const [recents, setRecents] = useState<Recent[] | null>(null)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [tpl, setTpl] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof window.api.engine>> | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const reload = () => window.api.recent.list().then(setRecents)
  useEffect(() => {
    reload()
    window.api.engine().then(setEngine)
    window.api.project.defaultParent().then((p) => setParent((cur) => cur || p))
  }, [])
  useEffect(() => { if (form) nameRef.current?.focus() }, [form])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setForm(false) // ⌘N/⌘O: commands in main.tsx
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ok = validName(name) && !!parent
  async function create(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    await onCreate(parent, name.trim(), tpl).finally(() => setBusy(false))
  }
  const pick = async () => {
    const p = await window.api.project.pickParent(parent)
    if (p) setParent(p)
  }

  return (
    <div className="home">
      <div className="home-bar">
        {engine && (
          <span className={'engine' + (engine.path ? '' : ' bad')} title={engine.path ?? 'Build it with npm run ngspice:build, or install ngspice'}>
            {engine.version}{engine.bundled ? ' (bundled)' : ''}
          </span>
        )}
      </div>
      <div className="home-body">
        <h1>Spice Studio</h1>

        {error && <div className="home-error" role="alert">{error}</div>}

        <div className="home-grid">
          <div className="col">
            <h2>Start</h2>
            <div className="acts">
              <button className={form ? 'on' : ''} onClick={() => setForm(!form)} aria-expanded={form} title="From a template or blank">
                <Icon name="plus" /><span>New project</span><kbd>⌘N</kbd>
              </button>
              <button onClick={() => onOpen()} title="A .nsproj folder">
                <Icon name="folder" /><span>Open project…</span><kbd>⌘O</kbd>
              </button>
              <button onClick={onOpenFile} title="A single .nsch or .cir">
                <Icon name="file" /><span>Open file…</span><kbd>⇧⌘O</kbd>
              </button>
              <button onClick={onLibrary} title="Browse bundled diodes, transistors and op-amps with their models">
                <Icon name="book" /><span>Component library</span>
              </button>
            </div>

            {form && (
              <form className="newproj" onSubmit={create}>
                <label>
                  <span>Name</span>
                  <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="My amplifier" spellCheck={false} />
                </label>
                {name && !validName(name) && <div className="bad">No / \ : * ? " &lt; &gt; | and it can't start with "."</div>}
                <label>
                  <span>Location</span>
                  <div className="loc">
                    <code title={parent}><bdi dir="ltr">{tilde(parent)}{name.trim() && validName(name) ? '/' + name.trim() : ''}</bdi></code>
                    <button type="button" onClick={pick}>Change…</button>
                  </div>
                </label>
                <div className="lbl">Template</div>
                <div className="tpls" role="radiogroup" aria-label="Template">
                  {CHOICES.map((t) => (
                    <button type="button" key={t.id} role="radio" aria-checked={tpl === t.id} className={tpl === t.id ? 'on' : ''} onClick={() => setTpl(t.id)}>
                      <b>{t.name}</b>
                      <small>{t.description}</small>
                    </button>
                  ))}
                </div>
                <div className="row">
                  <button type="button" onClick={() => setForm(false)}>Cancel</button>
                  <button type="submit" className="primary" disabled={!ok || busy}>{busy ? 'Creating…' : 'Create project'}</button>
                </div>
              </form>
            )}
          </div>

          <div className="col">
            <h2>Recent</h2>
            <div className="recents">
              {recents?.length === 0 && <div className="none">No recent projects yet.</div>}
              {recents?.map((r) => (
                <div key={r.file} className={'recent' + (r.exists ? '' : ' gone')}>
                  <button className="open" disabled={!r.exists} onClick={() => onOpen(r.file)} title={r.exists ? r.file : 'Missing: ' + r.file}>
                    <b>{r.name}</b>
                    <small><bdi dir="ltr">{tilde(r.file.replace(/\/[^/]*$/, ''))}</bdi></small>
                  </button>
                  <span className="when">{r.exists ? ago(r.opened) : 'missing'}</span>
                  {!r.exists && (
                    <button className="rm" onClick={() => window.api.recent.remove(r.file).then(reload)} aria-label={`Remove ${r.name} from recents`}>Remove</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
