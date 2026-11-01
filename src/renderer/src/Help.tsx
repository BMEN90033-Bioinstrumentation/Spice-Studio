// Help › Keyboard Shortcuts, About, Third-party Licences / Tools › Simulation Engine: in-app modals (AnalysisDialog's look).
import { useEffect, useRef, useState } from 'react'
import { useCommands } from './commands'
import { loadPacks, type PackInfo } from './library/sources'
import './sim/AnalysisDialog.css'
import './help.css'

const MAC = navigator.platform.includes('Mac')
// 'Mod+Shift+Z' -> ⇧⌘Z on macOS, Ctrl+Shift+Z elsewhere
const keyLabel = (k: string) =>
  MAC
    ? k.replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥').replace(/Ctrl\+/g, '⌃').replace(/Mod\+/g, '⌘').replace('Enter', '↵')
    : k.replace(/Mod\+/g, 'Ctrl+')

const SHORTCUTS: [string, [string, string][]][] = [
  ['File', [['New project', 'Mod+N'], ['Open project', 'Mod+O'], ['Open file', 'Mod+Shift+O'], ['Save', 'Mod+S'], ['Save as', 'Mod+Shift+S']]],
  ['Simulate', [['Run', 'Mod+Enter'], ['Stop', 'Mod+.'], ['Analysis setup', 'A'], ['Probe tool', 'P'], ['Probe from Select', 'Alt+click'], ['Differential probe', 'Alt+drag']]],
  ['View', [['Sheets panel', 'Mod+1'], ['Parts panel', 'Mod+2 · Shift+L'], ['Results panel', 'Mod+3'], ['Search parts', '/'], ['Zoom in / out', '+ · −'], ['Fit to window', 'F'], ['Pan', 'Space+drag · middle-drag']]],
  ['Edit (canvas)', [['Undo', 'Mod+Z'], ['Redo', 'Mod+Shift+Z'], ['Cut / copy / paste', 'Mod+X · Mod+C · Mod+V'], ['Duplicate', 'Mod+D'], ['Select all', 'Mod+A'], ['Add to selection', 'Shift+click'], ['Delete', 'Del · ⌫'], ['Rotate / mirror', 'Ctrl+R · Ctrl+E'], ['Back to Select', 'Esc']]],
  ['Place', [['Wire', 'W'], ['Flip wire corner', '/ (while wiring)'], ['Resistor / capacitor / inductor', 'R · C · L'], ['Voltage / current source', 'V · I'], ['Diode / NPN / NMOS', 'D · Q · M'], ['Ground / net label / port', 'G · N · H'], ['SPICE directive', 'S']]],
  ['Help', [['Keyboard shortcuts', 'Mod+/']]]
]

type Info = Awaited<ReturnType<typeof window.api.menu.info>> & { engine: Awaited<ReturnType<typeof window.api.engine>> }

// what the app itself is built from (its JS ships inside the app; their licences ask for this credit)
const CREDITS: [string, string, string][] = [
  ['Electron (Chromium, Node.js)', 'MIT; Chromium: BSD-3-Clause and others', 'https://github.com/electron/electron/blob/main/LICENSE'],
  ['React, React DOM', 'MIT', 'https://github.com/facebook/react/blob/main/LICENSE'],
  ['CodeMirror 6', 'MIT', 'https://github.com/codemirror/dev/blob/main/LICENSE'],
  ['uPlot', 'MIT', 'https://github.com/leeoniya/uPlot/blob/master/LICENSE']
]
type Lic = Awaited<ReturnType<typeof window.api.menu.licenses>> & { packs: PackInfo[] }

export const isUrl = (s?: string) => !!s && /^https?:\/\//i.test(s)
const link = (url: string, text = url) => <a href={url} target="_blank" rel="noreferrer">{text}</a>

// one library pack's licence, source, provenance and notice text (also the Library page's "Licence / notice")
export function PackLicence({ pack: p }: { pack: PackInfo }) {
  return (
    <div className="help-pack">
      {p.description && <p className="adlg-msg">{p.description}</p>}
      <dl>
        <dt>Licence</dt><dd>{p.license || 'not stated'}</dd>
        {p.version && <><dt>Version</dt><dd>{p.version}</dd></>}
        {p.source && <><dt>Source</dt><dd>{isUrl(p.source) ? link(p.source) : p.source}</dd></>}
        <dt>Parts</dt><dd>{p.libs.reduce((n, l) => n + l.entries.length, 0).toLocaleString()} in {p.libs.length} file{p.libs.length === 1 ? '' : 's'}</dd>
      </dl>
      {!!p.provenance?.length && (
        <table className="help-prov">
          <thead><tr><th>File</th><th>From</th><th>Retrieved</th><th>SHA-256</th></tr></thead>
          <tbody>{p.provenance.map((x, i) => (
            <tr key={i}>
              <td><code>{x.file}</code></td><td>{isUrl(x.url) ? link(x.url, x.url.replace(/^https?:\/\/(www\.)?/, '')) : x.url}</td><td>{x.retrieved}</td>
              <td><code title={x.sha256}>{x.sha256.slice(0, 12)}{x.sha256.length > 12 ? '…' : ''}</code></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {p.noticeText != null ? <pre className="help-text" tabIndex={0}>{p.noticeText}</pre>
        : <p className="adlg-msg">{p.notice ? `Notice file ${p.notice} is missing from the pack.` : 'This pack has no separate notice file.'}</p>}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    close.current?.focus()
    // capture + stop: canvas letter shortcuts must not see keys while the modal is up
    const k = (e: KeyboardEvent) => (e.stopPropagation(), e.key === 'Escape' && (e.preventDefault(), onClose()))
    window.addEventListener('keydown', k, true)
    return () => (window.removeEventListener('keydown', k, true), prev?.focus?.())
  }, [])
  return (
    <div className="adlg-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`adlg help-dlg${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="adlg-head">
          <h2>{title}</h2>
          <button ref={close} type="button" className="adlg-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Help() {
  const [open, setOpen] = useState<'shortcuts' | 'about' | 'licenses' | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [lic, setLic] = useState<Lic | null>(null)
  const licenses = () => {
    setOpen('licenses')
    Promise.all([window.api.menu.licenses(), loadPacks().catch(() => [])]).then(([l, packs]) => setLic({ ...l, packs }), () => setLic({ dir: '', files: [], packs: [] }))
  }
  const about = () => {
    setOpen('about')
    Promise.all([window.api.menu.info(), window.api.engine()]).then(([a, engine]) => setInfo({ ...a, engine }))
  }
  useCommands([
    { id: 'help.shortcuts', keys: 'Mod+/', run: () => setOpen('shortcuts') },
    { id: 'help.about', run: about },
    { id: 'help.licenses', run: licenses },
    { id: 'tools.engineInfo', run: about }
  ])
  if (open === 'shortcuts')
    return (
      <Modal title="Keyboard shortcuts" onClose={() => setOpen(null)}>
        <div className="help-keys">
          {SHORTCUTS.map(([group, rows]) => (
            <section key={group}>
              <h3>{group}</h3>
              {rows.map(([what, k]) => (
                <div key={what} className="help-row"><span>{what}</span><kbd>{keyLabel(k)}</kbd></div>
              ))}
            </section>
          ))}
        </div>
      </Modal>
    )
  if (open === 'about')
    return (
      <Modal title="About Spice Studio" onClose={() => setOpen(null)}>
        <div className="help-about">
          {!info ? <p className="adlg-msg">Loading…</p> : (
            <>
              <p><b>Spice Studio</b> {info.version}</p>
              <p className="adlg-msg">Schematic editor and front end for the ngspice circuit simulator.</p>
              <dl>
                <dt>Engine</dt>
                <dd className={info.engine.path ? '' : 'bad'}>{info.engine.version}{info.engine.bundled ? ' (bundled)' : ''}</dd>
                <dt>Engine path</dt>
                <dd><code>{info.engine.path ?? 'not found: npm run ngspice:build, or install ngspice'}</code></dd>
                <dt>Runtime</dt>
                <dd>Electron {info.electron} · Chromium {info.chrome} · Node {info.node}</dd>
                <dt>Platform</dt>
                <dd>{info.platform}</dd>
              </dl>
              <p className="adlg-msg">ngspice is BSD-3-Clause with third-party parts: <button className="help-link" onClick={licenses}>Third-party licences</button> lists them, the library packs' notices and the app's own components.</p>
            </>
          )}
        </div>
      </Modal>
    )
  if (open === 'licenses')
    return (
      <Modal title="Third-party licences" onClose={() => setOpen(null)} wide>
        <div className="help-lic">
          {!lic ? <p className="adlg-msg">Loading…</p> : (
            <>
              <section>
                <h3>ngspice simulation engine</h3>
                <p className="adlg-msg">An unmodified ngspice build, run as a separate program: modified BSD (3-clause), with the third-party parts listed in the notices. {link('https://ngspice.sourceforge.io/', 'ngspice.sourceforge.io')}</p>
                {lic.files.length ? lic.files.map((f) => (
                  <details key={f.name} open={f.name.startsWith('THIRD')}><summary>{f.name}</summary><pre className="help-text" tabIndex={0}>{f.text}</pre></details>
                )) : <p className="adlg-msg bad">No bundled engine in <code>{lic.dir || '(unknown)'}</code> (development build: run <code>npm run ngspice:build</code>). A system ngspice carries its own COPYING.</p>}
              </section>
              <section>
                <h3>Component library packs</h3>
                {!lic.packs.length && <p className="adlg-msg">No library packs installed.</p>}
                {lic.packs.map((p) => (
                  <details key={p.id}><summary>{p.name} <span className="help-badge">{p.license || 'licence not stated'}</span></summary><PackLicence pack={p} /></details>
                ))}
              </section>
              <section>
                <h3>Application components</h3>
                <table className="help-prov">
                  <thead><tr><th>Component</th><th>Licence</th><th>Text</th></tr></thead>
                  <tbody>{CREDITS.map(([n, l, u]) => <tr key={n}><td>{n}</td><td>{l}</td><td>{link(u, 'LICENSE')}</td></tr>)}</tbody>
                </table>
              </section>
            </>
          )}
        </div>
      </Modal>
    )
  return null
}
