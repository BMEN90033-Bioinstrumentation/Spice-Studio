// Help › Keyboard Shortcuts, About, Third-party Licences / Tools › Simulation Engine: in-app modals (AnalysisDialog's look).
import { useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tip } from '@/components/ui/tip'
import { runCommand, useCommands } from './commands'
import { loadPacks, type PackInfo } from './library/sources'

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

export type Info = Awaited<ReturnType<typeof window.api.menu.info>> & { engine: Awaited<ReturnType<typeof window.api.engine>> }

// what the app itself is built from (its JS ships inside the app; their licences ask for this credit)
const CREDITS: [string, string, string][] = [
  ['Electron (Chromium, Node.js)', 'MIT; Chromium: BSD-3-Clause and others', 'https://github.com/electron/electron/blob/main/LICENSE'],
  ['React, React DOM', 'MIT', 'https://github.com/facebook/react/blob/main/LICENSE'],
  ['CodeMirror 6', 'MIT', 'https://github.com/codemirror/dev/blob/main/LICENSE'],
  ['uPlot', 'MIT', 'https://github.com/leeoniya/uPlot/blob/master/LICENSE']
]
type Lic = Awaited<ReturnType<typeof window.api.menu.licenses>> & { packs: PackInfo[] }

export const isUrl = (s?: string) => !!s && /^https?:\/\//i.test(s)
const link = (url: string, text = url) => <a href={url} target="_blank" rel="noreferrer" className="text-hl hover:underline">{text}</a>
const muted = 'text-xs text-muted-foreground'
const dl = 'm-0 grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1.5 text-xs [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-muted-foreground'
const pre = 'help-text m-0 max-h-[420px] overflow-auto rounded-md border bg-muted/50 px-3 py-2.5 font-mono text-[11px] leading-normal whitespace-pre-wrap [overflow-wrap:anywhere] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
const h3 = 'm-0 text-xs font-medium text-muted-foreground'

// one library pack's licence, source, provenance and notice text (also the Library page's "Licence / notice")
// own padding, except where a dialog or a Fold already pads it
export function PackLicence({ pack: p }: { pack: PackInfo }) {
  return (
    <div className="grid min-h-0 min-w-0 content-start gap-2.5 overflow-auto px-4 py-3 [[data-slot=collapsible-content]>&]:p-0 [[data-slot=dialog-content]>&]:p-0">
      {p.description && <p className={muted}>{p.description}</p>}
      <dl className={dl}>
        <dt>Licence</dt><dd>{p.license || 'not stated'}</dd>
        {p.version && <><dt>Version</dt><dd>{p.version}</dd></>}
        {p.source && <><dt>Source</dt><dd>{isUrl(p.source) ? link(p.source) : p.source}</dd></>}
        <dt>Parts</dt><dd>{p.libs.reduce((n, l) => n + l.entries.length, 0).toLocaleString()} in {p.libs.length} file{p.libs.length === 1 ? '' : 's'}</dd>
      </dl>
      {!!p.provenance?.length && (
        <Table className="text-[11px]">
          <TableHeader><TableRow><TableHead className={th}>File</TableHead><TableHead className={th}>From</TableHead><TableHead className={th}>Retrieved</TableHead><TableHead className={th}>SHA-256</TableHead></TableRow></TableHeader>
          <TableBody>{p.provenance.map((x, i) => (
            <TableRow key={i}>
              <TableCell className={td}><code className="font-mono">{x.file}</code></TableCell>
              <TableCell className={td}>{isUrl(x.url) ? link(x.url, x.url.replace(/^https?:\/\/(www\.)?/, '')) : x.url}</TableCell>
              <TableCell className={td}>{x.retrieved}</TableCell>
              <TableCell className={td}><Tip label={x.sha256}><code className="font-mono">{x.sha256.slice(0, 12)}{x.sha256.length > 12 ? '…' : ''}</code></Tip></TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      )}
      {p.noticeText != null ? <pre className={pre} tabIndex={0}>{p.noticeText}</pre>
        : <p className={muted}>{p.notice ? `Notice file ${p.notice} is missing from the pack.` : 'This pack has no separate notice file.'}</p>}
    </div>
  )
}
const th = 'h-auto py-1 pr-3 pl-0 text-muted-foreground'
const td = 'py-1 pr-3 pl-0 align-top whitespace-normal [overflow-wrap:anywhere]'

// Esc / backdrop close and focus restore come from Radix; keys stop here so canvas letter shortcuts don't see them
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const card = useRef<HTMLDivElement>(null)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent ref={card} aria-describedby={undefined} onKeyDown={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => (e.preventDefault(), card.current?.querySelector<HTMLElement>('[data-slot=dialog-close]')?.focus())}
        className={cn('flex max-h-[calc(100vh-3rem)] flex-col gap-4 p-5 sm:max-w-[760px]', wide && 'h-[min(760px,calc(100vh-3rem))] sm:max-w-[900px]')}>
        <DialogHeader><DialogTitle className="text-base">{title}</DialogTitle></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

// a bordered disclosure: licence file or library pack
function Fold({ title, open, children }: { title: React.ReactNode; open?: boolean; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen={open} className="group/fold rounded-md border bg-card">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/fold:rotate-90" />{title}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t p-2.5">{children}</CollapsibleContent>
    </Collapsible>
  )
}

// the bodies of the Keyboard shortcuts and About dialogs; Home's Settings page shows the same two
export function Shortcuts() {
  return (
    <div className="grid min-h-0 grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-7 gap-y-1 overflow-auto">
      {SHORTCUTS.map(([group, rows]) => (
        <section key={group}>
          <h3 className={cn(h3, 'mt-2.5 mb-1')}>{group}</h3>
          {rows.map(([what, k]) => (
            <div key={what} className="flex items-center gap-3 border-b py-1 text-xs"><span className="flex-1">{what}</span><Kbd className="font-mono">{keyLabel(k)}</Kbd></div>
          ))}
        </section>
      ))}
    </div>
  )
}
export function About({ info }: { info: Info | null }) {
  return (
    <div className="grid gap-2.5 text-sm">
      {!info ? <p className={muted}>Loading…</p> : (
        <>
          <p><b className="font-semibold">Spice Studio</b> {info.version}</p>
          <p className={muted}>Schematic editor and front end for the ngspice circuit simulator.</p>
          <dl className={dl}>
            <dt>Engine</dt>
            <dd className={info.engine.path ? '' : 'text-err'}>{info.engine.version}{info.engine.bundled ? ' (bundled)' : ''}</dd>
            <dt>Engine path</dt>
            <dd><code className="font-mono text-[11px]">{info.engine.path ?? 'not found: npm run ngspice:build, or install ngspice'}</code></dd>
            <dt>Runtime</dt>
            <dd>Electron {info.electron} · Chromium {info.chrome} · Node {info.node}</dd>
            <dt>Platform</dt>
            <dd>{info.platform}</dd>
          </dl>
          <p className={muted}>ngspice is BSD-3-Clause with third-party parts: <Button variant="link" className="h-auto p-0 text-xs text-hl" onClick={() => runCommand('help.licenses')}>Third-party licences</Button> lists them, the library packs' notices and the app's own components.</p>
        </>
      )}
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
        <Shortcuts />
      </Modal>
    )
  if (open === 'about')
    return (
      <Modal title="About Spice Studio" onClose={() => setOpen(null)}>
        <About info={info} />
      </Modal>
    )
  if (open === 'licenses')
    return (
      <Modal title="Third-party licences" onClose={() => setOpen(null)} wide>
        <div className="-m-1 grid min-h-0 flex-1 content-start gap-5 overflow-auto p-1">
          {!lic ? <p className={muted}>Loading…</p> : (
            <>
              <section className="grid min-w-0 gap-2">
                <h3 className={h3}>ngspice simulation engine</h3>
                <p className={muted}>An unmodified ngspice build, run as a separate program: modified BSD (3-clause), with the third-party parts listed in the notices. {link('https://ngspice.sourceforge.io/', 'ngspice.sourceforge.io')}</p>
                {lic.files.length ? lic.files.map((f) => (
                  <Fold key={f.name} title={f.name} open={f.name.startsWith('THIRD')}><pre className={pre} tabIndex={0}>{f.text}</pre></Fold>
                )) : <p className="text-xs text-warn">No bundled engine in <code className="font-mono">{lic.dir || '(unknown)'}</code> (development build: run <code className="font-mono">npm run ngspice:build</code>). A system ngspice carries its own COPYING.</p>}
              </section>
              <section className="grid min-w-0 gap-2">
                <h3 className={h3}>Component library packs</h3>
                {!lic.packs.length && <p className={muted}>No library packs installed.</p>}
                {lic.packs.map((p) => (
                  <Fold key={p.id} title={<>{p.name} <Badge variant={p.license ? 'outline' : 'secondary'} className="font-mono text-[10px]">{p.license || 'licence not stated'}</Badge></>}>
                    <PackLicence pack={p} />
                  </Fold>
                ))}
              </section>
              <section className="grid min-w-0 gap-2">
                <h3 className={h3}>Application components</h3>
                <Table className="text-[11px]">
                  <TableHeader><TableRow><TableHead className={th}>Component</TableHead><TableHead className={th}>Licence</TableHead><TableHead className={th}>Text</TableHead></TableRow></TableHeader>
                  <TableBody>{CREDITS.map(([n, l, u]) => <TableRow key={n}><TableCell className={td}>{n}</TableCell><TableCell className={td}>{l}</TableCell><TableCell className={td}>{link(u, 'LICENSE')}</TableCell></TableRow>)}</TableBody>
                </Table>
              </section>
            </>
          )}
        </div>
      </Modal>
    )
  return null
}
