// Full-page library browser (enabled libraries, by category) + the vendor .lib import pin-mapping dialog (Manage Libraries).
import { useEffect, useMemo, useState, type KeyboardEvent as RKE } from 'react'
import { SYMBOLS, type Kind } from '../schematic/symbols'
import { blockPartFields, CATEGORIES as CATS, libKey, suggest, type Category, type ImportedLib, type LibEntry, type ParsedLib } from './library'
import { match, mini, useDebounced, VList } from './LibraryPanel'
import type { PackInfo } from './sources'
import { SymbolPreview } from './Symbol'
import { symbolFields } from './customSymbol'
import { isUrl, Modal, PackLicence } from '../Help'
import { runCommand } from '../commands'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tip } from '@/components/ui/tip'
import { cn } from '@/lib/utils'

const MODEL_KINDS: Kind[] = ['diode', 'zener', 'led', 'npn', 'pnp', 'njf', 'pjf', 'nmos', 'pmos']
const SUB_KINDS: Kind[] = ['opamp5', 'opamp', 'npn', 'pnp', 'njf', 'pjf', 'nmos', 'pmos', 'diode', 'zener', 'led', 'block']
const KIND_CAT: Partial<Record<Kind, Category>> = { diode: 'Diodes', zener: 'Diodes', led: 'Diodes', npn: 'BJTs', pnp: 'BJTs', njf: 'JFETs', pjf: 'JFETs', nmos: 'MOSFETs', pmos: 'MOSFETs', opamp: 'Op-amps', opamp5: 'Op-amps', block: 'Subcircuits' }
const packOf = (id: string) => (id.startsWith('pack:') ? id.slice(5, id.indexOf('/')) : '')
const ROW_H = 46
const rowH = () => ROW_H, rowKey = (e: LibEntry) => e.id
const fileOf = (e: LibEntry) => libKey(e.id).replace(/^(proj|user):|^pack:[^/]*\//, '')
const pinName = (k: Kind, i: number) => SYMBOLS[k].pinNames?.[i] ?? `pin ${i + 1}`
const spiceText = (e: LibEntry) =>
  e.spice?.type === 'model' ? e.spice.text : e.spice?.text ?? (e.spice?.include ? `.include ${e.spice.include}\n* .subckt ${e.spice.name} ${e.spice.pins.join(' ')}` : '')

const MUTED = 'text-xs leading-normal text-muted-foreground'
const CHIP = 'font-mono text-[10px] font-normal text-muted-foreground'
const LINK = 'h-auto p-0 text-xs'
const H3 = 'mt-2.5 flex items-center text-xs font-medium text-muted-foreground'
const TAB = 'w-max min-w-[260px] text-xs'
const TH = 'h-8 pr-4 pl-0 text-muted-foreground', TD = 'py-1 pr-4 pl-0'
const SEL = 'font-mono text-xs data-[size=sm]:h-7'

// arrow keys move between buttons of a list
function arrows(e: RKE<HTMLElement>, sel: string) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>(sel)], i = all.indexOf(e.currentTarget.ownerDocument.activeElement as HTMLElement)
  e.preventDefault()
  const to = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
  to?.focus(), to?.click()
}

export function LibraryView({ entries, packs }: {
  entries: LibEntry[] // enabled libraries only (Manage Libraries hides the rest)
  packs: PackInfo[] // detail card: pack name, version, licence
}) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all') // 'all' | Category
  const [notice, setNotice] = useState<PackInfo | null>(null)
  const [selId, setSelId] = useState<string>()
  const ql = useDebounced(q.trim().toLowerCase())
  const found = useMemo(() => entries.filter((e) => match(e, ql)), [entries, ql])
  const shown = useMemo(() => found.filter((e) => cat === 'all' || e.category === cat), [found, cat])
  const sel = shown.find((e) => e.id === selId) ?? shown[0]
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of found) m.set(e.category, (m.get(e.category) ?? 0) + 1)
    return m
  }, [found])
  const cats = useMemo(() => CATS.filter((c) => entries.some((e) => e.category === c)), [entries])

  const navBtn = (id: string, label: string, n: number) => (
    <Button key={id} variant="ghost" size="sm" className="w-full justify-start font-normal aria-pressed:bg-accent aria-pressed:text-accent-foreground" aria-pressed={cat === id} onClick={() => setCat(id)}>
      <span className="truncate">{label}</span><span className="ml-auto font-mono text-[10px] text-muted-foreground">{n.toLocaleString()}</span>
    </Button>
  )

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(260px,340px)_1fr]">
      <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-r px-2.5 py-3">
        <Input className="h-8 text-xs md:text-xs" type="search" placeholder="Search library" aria-label="Search library" value={q} spellCheck={false} onChange={(e) => setQ(e.target.value)} />
        <nav aria-label="Categories" className="flex flex-1 flex-col gap-px" onKeyDown={(e) => arrows(e, 'button')}>
          {navBtn('all', 'All parts', found.length)}
          {cats.map((c) => navBtn(c, c, counts.get(c) ?? 0))}
        </nav>
        <Tip label="Show, hide or import component libraries">
          <Button variant="outline" size="sm" onClick={() => runCommand('tools.manageLibraries')}>Manage libraries…</Button>
        </Tip>
      </aside>

      <section className="flex min-h-0 flex-col overflow-hidden border-r" aria-label="Parts">
        <div className="flex-none border-b px-3.5 pt-2 pb-1.5 text-[11px] text-muted-foreground">{shown.length.toLocaleString()} part{shown.length === 1 ? '' : 's'}{ql ? ` matching “${ql}”` : ''}</div>
        {shown.length ? (
          <VList className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2 [&_.vrow]:pb-px" items={shown} height={rowH} keyOf={rowKey} reset={`${ql}|${cat}`} onKeyDown={(e) => arrows(e, 'button')}
            render={(e) => (
              <Button variant="ghost" className="h-full w-full justify-start gap-2 overflow-hidden px-2 py-1.5 text-left font-normal aria-pressed:bg-accent" aria-pressed={e === sel} onClick={() => setSelId(e.id)}>
                {mini(e)}
                <span className="grid min-w-0 flex-1"><b className="truncate text-xs font-medium">{e.name}</b><small className="truncate text-[11px] text-muted-foreground">{e.description}</small></span>
              </Button>
            )} />
        ) : <p className={MUTED + ' p-4'}>Nothing matches{q ? ` “${q}”` : ''}.</p>}
      </section>

      <section className="min-h-0 overflow-y-auto px-6 py-5">{sel ? <Detail e={sel} packs={packs} onNotice={setNotice} /> : <p className={MUTED + ' p-4'}>Select a part.</p>}</section>

      {notice && <Modal title={`${notice.name}: licence`} onClose={() => setNotice(null)}><PackLicence pack={notice} /></Modal>}
    </div>
  )
}

function Detail({ e, packs, onNotice }: { e: LibEntry; packs: PackInfo[]; onNotice: (p: PackInfo) => void }) {
  const [copied, setCopied] = useState(false)
  const text = spiceText(e)
  const sub = e.spice?.type === 'subckt' ? e.spice : undefined
  const pack = e.source === 'pack' ? packs.find((p) => p.id === packOf(e.id)) : undefined
  useEffect(() => setCopied(false), [e.id])
  const copy = () => navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))
  return (
    <article className="grid max-w-[720px] grid-cols-[minmax(0,1fr)] gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1.5 font-mono text-xl font-semibold">{e.name}</h2>
        <Badge variant="outline" className={CHIP}>{e.category}</Badge>
        <Badge variant="outline" className={CHIP}>{e.source === 'bundled' ? 'bundled' : fileOf(e)}</Badge>
        {pack?.license && <Tip label={pack.license}><Badge variant="outline" className={cn(CHIP, 'max-w-full border-ok/35 text-ok')}><span className="truncate">{pack.license}</span></Badge></Tip>}
      </div>
      <p className="leading-normal">{e.description}</p>
      <div className="rounded-lg border bg-background p-2 [&_.symp]:text-foreground"><SymbolPreview kind={e.kind} part={symbolFields(e) ?? (e.kind === 'block' ? blockPartFields(e) : undefined)} size="large" /></div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs [&_code]:font-mono [&_dt]:text-muted-foreground">
        <dt>Value</dt><dd><code>{e.value}</code></dd>
        <dt>Symbol</dt><dd>{SYMBOLS[e.kind].title}</dd>
        <dt>Source</dt><dd>{
          e.source === 'bundled' ? 'Bundled with Spice Studio'
          : e.source === 'user' ? `My library · ${fileOf(e)}`
          : e.source === 'pack' ? <>{pack?.name ?? 'Pack'}{pack?.version && ` ${/^\d/.test(pack.version) ? 'v' : ''}${pack.version}`} · {fileOf(e)}{pack?.source && <> · from {isUrl(pack.source) ? <Button asChild variant="link" className={LINK}><a href={pack.source} target="_blank" rel="noreferrer">{pack.source}</a></Button> : pack.source}</>}</>
          : `Project file ${fileOf(e)}`
        }</dd>
        {pack && <><dt>Licence</dt><dd>{pack.license || 'not stated'} · <Button variant="link" className={LINK} onClick={() => onNotice(pack)}>notice</Button></dd></>}
        {e.compat && <><dt>Dialect</dt><dd>{e.compat}</dd></>}
        {!e.spice && <><dt>Model</dt><dd>Built-in SPICE element: the value is the whole spec</dd></>}
      </dl>
      {sub && (
        <>
          <h3 className={H3}>Pins</h3>
          <Table className={TAB}>
            <TableHeader><TableRow><TableHead className={TH}>#</TableHead><TableHead className={TH}>Symbol</TableHead><TableHead className={TH}>Subckt pin</TableHead></TableRow></TableHeader>
            <TableBody>{sub.pinMap.map((j, i) => <TableRow key={i}><TableCell className={TD}>{i + 1}</TableCell><TableCell className={TD}>{e.kind === 'block' ? sub.pins[j] : pinName(e.kind, i)}</TableCell><TableCell className={TD}><code className="font-mono">{sub.pins[j]}</code></TableCell></TableRow>)}</TableBody>
          </Table>
        </>
      )}
      {e.params && Object.keys(e.params).length > 0 && (
        <>
          <h3 className={H3}>Parameters</h3>
          <Table className={TAB}>
            <TableBody>{Object.entries(e.params).map(([k, v]) => <TableRow key={k}><TableCell className={TD}>{k}</TableCell><TableCell className={TD}><code className="font-mono">{v}</code></TableCell></TableRow>)}</TableBody>
          </Table>
        </>
      )}
      {text && (
        <>
          <h3 className={H3}>SPICE <Button size="sm" variant="outline" className="ml-auto" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button></h3>
          <pre className="max-h-[300px] overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-normal whitespace-pre outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" tabIndex={0}>{text}</pre>
        </>
      )}
    </article>
  )
}

type Row = ImportedLib['entries'][number] & { include: boolean }

// Problems with one row's mapping; sub = subckt pins (undefined for models).
function rowErrors(r: Row, sub?: string[]): string[] {
  if (!sub || r.kind === 'block') return []
  const n = SYMBOLS[r.kind].pins.length
  if (n !== sub.length) return [`${SYMBOLS[r.kind].title} has ${n} pins but the subckt has ${sub.length}: choose a ${sub.length}-pin symbol or Block`]
  if (r.pinMap.length !== n || r.pinMap.some((i) => i < 0 || i >= sub.length)) return ['Map every symbol pin to a subckt pin']
  if (new Set(r.pinMap).size !== n) return ['Each symbol pin needs a different subckt pin']
  return []
}

// renders in whichever window holds it (Manage Libraries is its own window): keys and focus use that window
// verb: what confirming does ('Add' from the component builder)
export function ImportDialog({ rel, parsed, onClose, onImport, verb = 'Import' }: { rel: string; parsed: ParsedLib; onClose: () => void; onImport: (l: ImportedLib) => void; verb?: string }) {
  const orig = useMemo(() => suggest(parsed), [parsed])
  const [rows, setRows] = useState<Row[]>(() => orig.map((r) => ({ ...r, include: true })))
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const info = rows.map((r) => ({ m: parsed.models.find((m) => same(m.name, r.name)), s: parsed.subckts.find((s) => same(s.name, r.name)) }))
  const errs = rows.map((r, i) => (r.include ? rowErrors(r, info[i].s?.pins) : []))
  const ok = rows.some((r) => r.include) && errs.every((e) => !e.length)
  const skipped = parsed.models.length + parsed.subckts.length - rows.length

  const upd = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  function setKind(i: number, kind: Kind) {
    const sub = info[i].s?.pins, o = orig[i]
    const pinMap = !sub ? [] : kind === o.kind ? o.pinMap : kind === 'block' ? sub.map((_, j) => j) : SYMBOLS[kind].pins.map((_, j) => (j < sub.length ? j : -1))
    upd(i, { kind, pinMap, category: KIND_CAT[kind] ?? rows[i].category })
  }
  function submit() {
    if (!ok) return
    const entries = rows.flatMap((r, i) => {
      if (!r.include) return []
      const sub = info[i].s?.pins
      return [{ name: r.name, kind: r.kind, category: r.category, pinMap: r.kind === 'block' && sub ? sub.map((_, j) => j) : r.pinMap }]
    })
    onImport({ file: rel, entries })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* Radix: focus trap, Esc, focus restore. Stop keys here so the pop-out never forwards them to the canvas */}
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-[720px]"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.preventDefault(), submit() }}>
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">{verb} <code className="font-mono text-xs">{rel}</code></DialogTitle>
        </DialogHeader>
        <div className="flex min-h-[120px] flex-col gap-2 overflow-y-auto px-4 py-3.5">
          {parsed.errors.length > 0 && (
            <Alert variant="destructive"><AlertDescription><ul className="list-disc pl-4 text-xs">{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></AlertDescription></Alert>
          )}
          {!rows.length && <p className={MUTED}>No usable .model or .subckt definitions found in this file.</p>}
          {skipped > 0 && <p className={MUTED}>{skipped} model{skipped > 1 ? 's' : ''} without a matching symbol (JFET, switch…) stay available to the subcircuits through the include.</p>}
          {rows.map((r, i) => {
            const { m, s } = info[i], kinds = s ? SUB_KINDS : MODEL_KINDS
            return (
              <div key={i} className={cn('grid gap-2 rounded-lg border bg-card px-3 py-2.5', !r.include && 'opacity-55')}>
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="mr-auto cursor-pointer">
                    <Checkbox checked={r.include} onCheckedChange={(c) => upd(i, { include: c === true })} />
                    <b className="font-mono text-[13px] font-medium">{r.name}</b>
                  </Label>
                  <Badge variant="outline" className={CHIP}>{m ? `.model ${m.type}` : `.subckt · ${s!.pins.length} pins`}</Badge>
                  <Select value={r.kind} disabled={!r.include} onValueChange={(v) => setKind(i, v as Kind)}>
                    <SelectTrigger size="sm" aria-label={`${r.name} symbol`} className={SEL}><SelectValue /></SelectTrigger>
                    <SelectContent>{[...new Set([...kinds, r.kind])].map((k) => <SelectItem key={k} value={k}>{SYMBOLS[k].title}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={r.category} disabled={!r.include} onValueChange={(v) => upd(i, { category: v as Category })}>
                    <SelectTrigger size="sm" aria-label={`${r.name} category`} className={SEL}><SelectValue /></SelectTrigger>
                    <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {s && r.include && r.kind !== 'block' && (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-2.5 gap-y-1.5">
                    {SYMBOLS[r.kind].pins.map((_, j) => {
                      const v = r.pinMap[j] ?? -1
                      return (
                        <Label key={j} className="grid gap-1 text-[11px] font-normal text-muted-foreground">
                          <span>{pinName(r.kind, j)}</span>
                          <Select value={String(v)} onValueChange={(x) => upd(i, { pinMap: SYMBOLS[r.kind].pins.map((_, k) => (k === j ? +x : r.pinMap[k] ?? -1)) })}>
                            <SelectTrigger size="sm" className={cn(SEL, 'w-full')} aria-invalid={r.pinMap.filter((x) => x === v).length > 1 || v < 0 || undefined}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="-1">—</SelectItem>
                              {s.pins.map((p, k) => <SelectItem key={k} value={String(k)}>{p}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </Label>
                      )
                    })}
                  </div>
                )}
                {s && r.include && r.kind === 'block' && <p className={MUTED}>Generic block with pins {s.pins.join(', ')}</p>}
                {errs[i].map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
              </div>
            )
          })}
        </div>
        <DialogFooter className="items-center border-t px-4 py-3">
          <span className="mr-auto text-xs text-muted-foreground"><Kbd>Esc</Kbd> cancel · <Kbd>⌘↵</Kbd> {verb.toLowerCase()}</span>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={!ok}>{verb} {rows.filter((r) => r.include).length || ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
