import { useEffect, useRef, useState, type FormEvent } from 'react'
import { validName } from '../project/project'
import { TEMPLATES } from '../schematic/templates'
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

export function Home({ onCreate, onOpen, onOpenFile, onLibrary, error }: {
  onCreate: (parent: string, name: string, template: string) => Promise<void>
  onOpen: (file?: string) => Promise<void>
  onOpenFile: () => Promise<void>
  onLibrary: () => void
  error: string
}) {
  const [recents, setRecents] = useState<Recent[] | null>(null)
  const [form, setForm] = useState(false)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [tpl, setTpl] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const reload = () => window.api.recent.list().then(setRecents)
  useEffect(() => {
    reload()
    window.api.project.defaultParent().then((p) => setParent((cur) => cur || p))
  }, [])
  useEffect(() => { if (form) nameRef.current?.focus() }, [form])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return e.key === 'Escape' && setForm(false)
      const fn = ({ n: () => setForm(true), o: () => onOpen() } as Record<string, () => void>)[e.key]
      if (fn) e.preventDefault(), fn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpen])

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
      <div className="home-bar"><span className="brand">ngspice Studio</span></div>
      <div className="home-body">
        <section className="hero">
          <svg className="logo" viewBox="0 0 48 48" aria-hidden>
            <rect x="1" y="1" width="46" height="46" rx="11" />
            <path d="M8 30h7l3-12 5 20 5-26 4 18h8" />
          </svg>
          <div>
            <h1>ngspice Studio</h1>
            <p>Draw schematics, build hierarchical designs and simulate them with ngspice.</p>
          </div>
        </section>

        {error && <div className="home-error" role="alert">{error}</div>}

        <div className="home-grid">
          <div className="col">
            <div className="tiles">
              <button className={'tile' + (form ? ' on' : '')} onClick={() => setForm(!form)} aria-expanded={form}>
                <span className="ic">＋</span>
                <b>New project</b>
                <small>From a template or blank · ⌘N</small>
              </button>
              <button className="tile" onClick={() => onOpen()}>
                <span className="ic">⌂</span>
                <b>Open project</b>
                <small>A .nsproj folder · ⌘O</small>
              </button>
              <button className="tile" onClick={onOpenFile}>
                <span className="ic">≡</span>
                <b>Open file</b>
                <small>A single .nsch or .cir</small>
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
                    <code title={parent}>{tilde(parent)}{name.trim() && validName(name) ? '/' + name.trim() : ''}</code>
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
            <h2>Recent projects</h2>
            <div className="recents">
              {recents?.length === 0 && <div className="none">No recent projects yet.</div>}
              {recents?.map((r) => (
                <div key={r.file} className={'recent' + (r.exists ? '' : ' gone')}>
                  <button className="open" disabled={!r.exists} onClick={() => onOpen(r.file)} title={r.exists ? r.file : 'Missing: ' + r.file}>
                    <b>{r.name}</b>
                    <small>{tilde(r.file.replace(/\/[^/]*$/, ''))}</small>
                  </button>
                  <span className="when">{r.exists ? ago(r.opened) : 'missing'}</span>
                  {!r.exists && (
                    <button className="rm" onClick={() => window.api.recent.remove(r.file).then(reload)} aria-label={`Remove ${r.name} from recents`}>Remove</button>
                  )}
                </div>
              ))}
            </div>

            <button className="libcard" onClick={onLibrary}>
              <span className="ic">▤</span>
              <span>
                <b>Component library</b>
                <small>Browse bundled diodes, transistors and op-amps with their models.</small>
              </span>
              <span className="go">›</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
