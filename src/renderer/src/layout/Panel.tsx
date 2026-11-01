// Collapsible workspace panels (sheets sidebar, parts panel, results) with a shared collapsed "rail".
import { useEffect, useState, type ReactNode } from 'react'
import { useCommands } from '../commands'
import { Icon, type IconName } from '../icons'
import { focusPopout, PopOut } from './PopOut'
import './layout.css'

export type Side = 'left' | 'right' | 'bottom'
export const RAILW = 28 // keep in sync with .rail in layout.css

const MAC = /Mac/.test(navigator.platform)
export const keyLabel = (k: string) => (MAC ? k.replace('Mod+', '⌘').replace('Shift+', '⇧') : k.replace('Mod+', 'Ctrl+'))
const CHEV: Record<Side, [IconName, IconName]> = { left: ['right', 'left'], right: ['left', 'right'], bottom: ['up', 'down'] } // [show, hide]

// collapsed panel: an icon strip; the label lives in the tooltip
export function Rail({ side, label, title, icon, dot, onOpen }: { side: Side; label: string; title: string; icon?: IconName; dot?: boolean; onOpen: () => void }) {
  return (
    <button className={`rail rail-${side}`} title={title} aria-label={title + (dot ? ' · new results' : '')} data-label={label} onClick={onOpen}>
      <Icon name={icon ?? CHEV[side][0]} />
      {dot && <i className="rail-dot" />}
    </button>
  )
}

export const HideBtn = ({ side, title, onClick }: { side: Side; title: string; onClick: () => void }) => (
  <button className="icon hide" title={title} aria-label={title} onClick={onClick}><Icon name={CHEV[side][1]} /></button>
)

type State = { sheets: boolean; parts: boolean; plots: boolean; popped: boolean }
const KEY = 'ngs.layout'
const DEF: State = { sheets: true, parts: true, plots: true, popped: false }
function load(): State {
  try {
    return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEF
  }
}

// Panel state for one workspace: persisted, registers the view.* commands. `runs` changing = a run finished.
export function usePanels({ active, hasSheets, isSch, runs, title }: { active: boolean; hasSheets: boolean; isSch: boolean; runs: unknown; title: string }) {
  const [s, setS] = useState(load)
  const [dot, setDot] = useState(false)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {} }, [s])
  const docked = s.plots && !s.popped
  useEffect(() => { if (runs && !docked) setDot(true) }, [runs])
  const set = (p: Partial<State>) => setS((x) => ({ ...x, ...p }))
  const show = (p: Partial<State>) => (setDot(false), set(p))
  const dock = () => show({ plots: true, popped: false })
  const togglePlots = () => (docked ? set({ plots: false }) : dock())
  const popout = () => (s.popped ? dock() : show({ popped: true }))

  useCommands([
    { id: 'view.sheets', keys: 'Mod+1', run: () => set({ sheets: !s.sheets }), enabled: () => active && hasSheets, checked: () => hasSheets && s.sheets },
    { id: 'view.parts', keys: 'Mod+2', run: () => set({ parts: !s.parts }), enabled: () => active && isSch, checked: () => s.parts },
    { id: 'view.plots', keys: 'Mod+3', run: togglePlots, enabled: () => active, checked: () => docked },
    { id: 'view.popoutPlots', run: popout, enabled: () => active, checked: () => s.popped }
  ])

  const sheetsRail = <Rail side="left" label="Sheets" icon="layers" title={`Show sheets (${keyLabel('Mod+1')})`} onOpen={() => set({ sheets: true })} />
  const sheetsHide = <HideBtn side="left" title={`Hide sheets (${keyLabel('Mod+1')})`} onClick={() => set({ sheets: false })} />
  // docked panel / rail, plus the pop-out window; render(actions) draws the results with header buttons
  const results = (render: (actions: ReactNode) => ReactNode) => (
    <>
      {docked
        ? render(<>
            <button className="icon" title="Open the results in their own window" aria-label="Pop out results" onClick={popout}><Icon name="popout" /></button>
            <HideBtn side="right" title={`Hide results (${keyLabel('Mod+3')})`} onClick={togglePlots} />
          </>)
        : s.popped
          ? <Rail side="right" label="Results" icon="popout" dot={dot} title="Results are in their own window: click to bring it forward" onOpen={() => (setDot(false), focusPopout())} />
          : <Rail side="right" label="Results" icon="chart" dot={dot} title={`Show results (${keyLabel('Mod+3')})`} onOpen={dock} />}
      {s.popped && (
        <PopOut title={`Plots — ${title}`} onClose={dock}>
          {render(<button className="primary" title="Put the results back in the main window" onClick={dock}>Dock</button>)}
        </PopOut>
      )}
    </>
  )
  return { ...s, docked, setParts: (parts: boolean) => set({ parts }), sheetsRail, sheetsHide, results }
}
