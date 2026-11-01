// Help › Keyboard Shortcuts and About / Tools › Simulation Engine: in-app modals (AnalysisDialog's look).
import { useEffect, useRef, useState } from 'react'
import { useCommands } from './commands'
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
  ['Simulate', [['Run', 'Mod+Enter'], ['Analysis setup', 'A'], ['Probe tool', 'P'], ['Probe from Select', 'Alt+click']]],
  ['View', [['Sheets panel', 'Mod+1'], ['Parts panel', 'Mod+2 · Shift+L'], ['Results panel', 'Mod+3'], ['Search parts', '/'], ['Zoom in / out', '+ · −'], ['Fit to window', 'F'], ['Pan', 'Space+drag · middle-drag']]],
  ['Edit (canvas)', [['Undo', 'Mod+Z'], ['Redo', 'Mod+Shift+Z'], ['Cut / copy / paste', 'Mod+X · Mod+C · Mod+V'], ['Duplicate', 'Mod+D'], ['Select all', 'Mod+A'], ['Delete', 'Del · ⌫'], ['Rotate / mirror', 'Ctrl+R · Ctrl+E'], ['Back to Select', 'Esc']]],
  ['Place', [['Wire', 'W'], ['Flip wire corner', '/ (while wiring)'], ['Resistor / capacitor / inductor', 'R · C · L'], ['Voltage / current source', 'V · I'], ['Diode / NPN / NMOS', 'D · Q · M'], ['Ground / net label / port', 'G · N · H'], ['SPICE directive', 'S']]],
  ['Help', [['Keyboard shortcuts', 'Mod+/']]]
]

type Info = Awaited<ReturnType<typeof window.api.menu.info>> & { engine: Awaited<ReturnType<typeof window.api.engine>> }

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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
      <div className="adlg help-dlg" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
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
  const [open, setOpen] = useState<'shortcuts' | 'about' | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const about = () => {
    setOpen('about')
    Promise.all([window.api.menu.info(), window.api.engine()]).then(([a, engine]) => setInfo({ ...a, engine }))
  }
  useCommands([
    { id: 'help.shortcuts', keys: 'Mod+/', run: () => setOpen('shortcuts') },
    { id: 'help.about', run: about },
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
      <Modal title="About ngspice Studio" onClose={() => setOpen(null)}>
        <div className="help-about">
          {!info ? <p className="adlg-msg">Loading…</p> : (
            <>
              <p><b>ngspice Studio</b> {info.version}</p>
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
              <p className="adlg-msg">ngspice is BSD-3-Clause with third-party parts: Help › Third-party Licences opens the notices shipped with the bundled engine.</p>
            </>
          )}
        </div>
      </Modal>
    )
  return null
}
