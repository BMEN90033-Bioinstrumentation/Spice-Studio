// Collapsible workspace panels (sheets sidebar, parts panel, results) with a shared collapsed "rail".
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChartLine, ExternalLink, Layers, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tip'
import { cn } from '@/lib/utils'
import { useCommands } from '../commands'
import { focusPopout, PopOut } from './PopOut'

export type Side = 'left' | 'right' | 'bottom'
export const RAILW = 28 // keep in sync with the rail's w-7 below and div.sch rules in layout.css

const MAC = /Mac/.test(navigator.platform)
// 'Mod+Shift+Z' -> ⇧⌘Z on macOS (⇧ before ⌘), Ctrl+Shift+Z elsewhere
export const keyLabel = (k: string) => (MAC
  ? k.replace(/Mod\+Shift\+/g, 'Shift+Mod+').replace(/Ctrl\+/g, '⌃').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧').replace(/Mod\+/g, '⌘').replace(/Enter/g, '↵')
  : k.replace(/Mod\+/g, 'Ctrl+'))
const CHEV: Record<Side, [LucideIcon, LucideIcon]> = { left: [ChevronRight, ChevronLeft], right: [ChevronLeft, ChevronRight], bottom: [ChevronUp, ChevronDown] } // [show, hide]
const RAIL: Record<Side, string> = { left: 'w-7 flex-col border-r', right: 'w-7 flex-col border-l', bottom: 'h-7 px-2.5 border-t' }
const TIP: Record<Side, 'right' | 'left' | 'top'> = { left: 'right', right: 'left', bottom: 'top' }

// collapsed panel: an icon strip; the label lives in the tooltip. `rail rail-<side>`: hooks for layout.css (position, slide-in)
export function Rail({ side, label, title, icon, dot, onOpen }: { side: Side; label: string; title: string; icon?: LucideIcon; dot?: boolean; onOpen: () => void }) {
  const I = icon ?? CHEV[side][0]
  return (
    <Tip label={title} side={TIP[side]}>
      <Button variant="ghost" size={null} aria-label={title + (dot ? ' · new results' : '')} data-label={label} onClick={onOpen}
        className={cn(`rail rail-${side} shrink-0 justify-start gap-2.5 rounded-none bg-card py-2.5 text-muted-foreground focus-visible:ring-inset`, RAIL[side])}>
        <I />
        {dot && <span className="absolute top-1 right-1 size-[7px] rounded-full bg-hl ring-2 ring-card" />}
      </Button>
    </Tip>
  )
}

export const HideBtn = ({ side, title, onClick }: { side: Side; title: string; onClick: () => void }) => {
  const I = CHEV[side][1]
  return (
    <Tip label={title}>
      <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={title} onClick={onClick}><I /></Button>
    </Tip>
  )
}

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
// onOpen, autoShow: Settings › Simulation and plots (how a project's results start; a finished run opens hidden results)
const START = { hidden: { plots: false }, docked: { plots: true, popped: false }, window: { popped: true } }
export function usePanels({ active, hasSheets, isSch, runs, title, onOpen, autoShow }: { active: boolean; hasSheets: boolean; isSch: boolean; runs: unknown; title: string; onOpen: keyof typeof START; autoShow: boolean }) {
  const [s, setS] = useState(() => ({ ...load(), ...(hasSheets && START[onOpen]) }))
  const [dot, setDot] = useState(false)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {} }, [s])
  const docked = s.plots && !s.popped
  const set = (p: Partial<State>) => setS((x) => ({ ...x, ...p }))
  const show = (p: Partial<State>) => (setDot(false), set(p))
  const dock = () => show({ plots: true, popped: false })
  // results in their own window stay there: the dot on the rail says they're new
  useEffect(() => { if (runs && !docked) autoShow && !s.popped ? dock() : setDot(true) }, [runs])
  const togglePlots = () => (docked ? set({ plots: false }) : dock())
  const popout = () => (s.popped ? dock() : show({ popped: true }))

  useCommands([
    { id: 'view.sheets', keys: 'Mod+1', run: () => set({ sheets: !s.sheets }), enabled: () => active && hasSheets, checked: () => hasSheets && s.sheets },
    { id: 'view.parts', keys: 'Mod+2', run: () => set({ parts: !s.parts }), enabled: () => active && isSch, checked: () => s.parts },
    { id: 'view.plots', keys: 'Mod+3', run: togglePlots, enabled: () => active, checked: () => docked },
    { id: 'view.popoutPlots', run: popout, enabled: () => active, checked: () => s.popped }
  ])

  const sheetsRail = <Rail side="left" label="Sheets" icon={Layers} title={`Show sheets (${keyLabel('Mod+1')})`} onOpen={() => set({ sheets: true })} />
  const sheetsHide = <HideBtn side="left" title={`Hide sheets (${keyLabel('Mod+1')})`} onClick={() => set({ sheets: false })} />
  // docked panel / rail, plus the pop-out window; render(actions) draws the results with header buttons
  const results = (render: (actions: ReactNode) => ReactNode) => (
    <>
      {docked
        ? render(<>
            <Tip label="Open the results in their own window">
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Pop out results" onClick={popout}><ExternalLink /></Button>
            </Tip>
            <HideBtn side="right" title={`Hide results (${keyLabel('Mod+3')})`} onClick={togglePlots} />
          </>)
        : s.popped
          ? <Rail side="right" label="Results" icon={ExternalLink} dot={dot} title="Results are in their own window: click to bring it forward" onOpen={() => (setDot(false), focusPopout())} />
          : <Rail side="right" label="Results" icon={ChartLine} dot={dot} title={`Show results (${keyLabel('Mod+3')})`} onOpen={dock} />}
      {s.popped && (
        <PopOut title={`Plots — ${title}`} onClose={dock}>
          {render(<Tip label="Put the results back in the main window"><Button size="sm" className="h-7" onClick={dock}>Dock</Button></Tip>)}
        </PopOut>
      )}
    </>
  )
  return { ...s, docked, reveal: () => void (!s.plots && !s.popped && dock()), setParts: (parts: boolean) => set({ parts }), sheetsRail, sheetsHide, results }
}
