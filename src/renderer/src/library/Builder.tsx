// Component builder (Home › Component builder), laid out like the main window. Left: the parts you've made, by
// category, searchable; open one to change it. Right: Design (draw the symbol and place its pins, then fill in how
// the part behaves) or Code (its SPICE, a .model or .subckt); both edit the same definition. Save asks for the name,
// type, category (existing or new), manufacturer and part number, and stores the part in My library as its own file.
import { useMemo, useState, type ComponentProps } from 'react'
import {
  blockPartFields, CATEGORIES, entriesFromImport, MODEL_PARAMS, MODEL_TYPES, modelParts, modelText, parseLibFile, STARTERS, subcktParts, subcktText, suggest,
  type ImportedLib, type LibEntry, type ParsedLib
} from './library'
import { standardSymbol, symbolErrors, type CustomSymbol } from './customSymbol'
import { SymbolPreview } from './Symbol'
import type { Sources } from './sources'
import { KIND_CAT, SUB_KINDS } from './LibraryView'
import { mini } from './LibraryPanel'
import { SYMBOLS, type Kind } from '../schematic/symbols'
import { SymbolPad } from './SymbolEditor'
import { Editor } from '../Editor'
import { runCommand } from '../commands'
import { ChevronDown, FileCode2, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const MUTED = 'text-xs leading-normal text-muted-foreground'
const H = 'text-xs font-medium text-muted-foreground'
const FLD = 'grid content-start gap-1 text-[11px] font-normal text-muted-foreground'
const IN = 'h-8 font-mono text-xs md:text-xs'
const NAME = (s: string) => /^[^\s(){}=,;*]+$/.test(s), VALUE = (s: string) => /^[^\s,()=]*$/.test(s), PINS = (s: string) => /^[^(){}=,;*]*$/.test(s)

// An input over a value derived from the SPICE text: keeps what is being typed (a half-typed value would not survive
// the round trip through the text), writes through only while it is valid, and follows the text when that changes.
function Field({ value, ok, onCommit, ...p }: { value: string; ok: (s: string) => boolean; onCommit: (s: string) => void } & Omit<ComponentProps<typeof Input>, 'value' | 'onChange'>) {
  const [d, setD] = useState(value), [seen, setSeen] = useState(value)
  if (value !== seen) setSeen(value), setD(value)
  return <Input className={IN} spellCheck={false} {...p} value={d} aria-invalid={!ok(d) || undefined} onChange={(e) => (setD(e.target.value), ok(e.target.value) && onCommit(e.target.value))} />
}

function ModelForm({ text, put }: { text: string; put: (t: string) => void }) {
  const m = modelParts(text)
  if (!m) return null
  const type = m.type.toUpperCase(), known = MODEL_PARAMS[type] ?? []
  const has = (k: string) => m.params.find((p) => p[0].toLowerCase() === k.toLowerCase())
  // the type's usual parameters, then whatever else the text sets
  const rows = [...known, ...m.params.filter(([k]) => !known.some((x) => x[0].toLowerCase() === k.toLowerCase())).map(([k]): [string, string] => [k, ''])]
  const set = (k: string, v: string) => put(modelText(m.name, m.type,
    !v ? m.params.filter((p) => p !== has(k)) : has(k) ? m.params.map((p): [string, string] => (p === has(k) ? [p[0], v] : p)) : [...m.params, [k, v]]))
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-3.5">
      <div className="grid grid-cols-2 gap-3">
        <Label className={FLD}>Name<Field value={m.name} ok={NAME} onCommit={(v) => put(modelText(v, m.type, m.params))} /></Label>
        <Label className={FLD}>Type
          <Select value={type} onValueChange={(v) => put(modelText(m.name, v, m.params))}>
            <SelectTrigger size="sm" className="w-full font-mono text-xs data-[size=sm]:h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{[...new Set([...MODEL_TYPES, type])].map((t) => <SelectItem key={t} value={t} className="font-mono text-xs">{t}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
      </div>
      <div className="grid gap-2.5">
        {rows.map(([k, what]) => (
          <Label key={k.toLowerCase()} className={FLD}>
            <span><b className="font-mono font-medium text-foreground">{has(k)?.[0] ?? k}</b>{what && ` · ${what}`}</span>
            <Field value={has(k)?.[1] ?? ''} ok={VALUE} placeholder="default" onCommit={(v) => set(k, v)} />
          </Label>
        ))}
      </div>
      <p className={MUTED}>Values take SPICE suffixes (2.5n, 10k, 1meg). An empty field uses ngspice's default. Any other parameter: add it in Code.</p>
    </div>
  )
}

const CODE = 'overflow-hidden rounded-md border border-input text-xs dark:bg-input/30 [&_.cm-editor]:bg-transparent'
function SubcktForm({ s, put }: { s: ParsedLib['subckts'][number]; put: (t: string) => void }) {
  const { tail, body } = subcktParts(s)
  const [init] = useState({ pins: s.pins.join(' '), body }) // what the two code fields were loaded with (they keep their own text from then on)
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-3.5">
      <Label className={FLD}>Name<Field value={s.name} ok={NAME} onCommit={(v) => put(subcktText(v, s.pins, tail, body))} /></Label>
      <div className={FLD}>Pins, in order, separated by spaces
        <div className={CODE + ' h-8'}><Editor plain initial={init.pins} onChange={(v) => PINS(v) && put(subcktText(s.name, v.trim().split(/\s+/).filter(Boolean), tail, body))} /></div>
      </div>
      <div className={FLD}>The circuit inside: one element per line, wired between the pins and any internal nodes (0 is ground)
        <div className={CODE + ' h-44'}><Editor plain initial={init.body} onChange={(v) => put(subcktText(s.name, s.pins, tail, v))} /></div>
      </div>
      <p className={MUTED}>For example <code className="font-mono">R1 in out 10k</code> is a 10 kΩ resistor between pins in and out.</p>
    </div>
  )
}

const TILE = 'grid justify-items-center gap-1 rounded-lg border bg-card p-3 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50'
// the start screen's tiles: each starter with the part it makes (for its symbol)
const TILES = STARTERS.map((s) => ({ ...s, e: entriesFromImport({ file: 'starter', entries: suggest(parseLibFile(s.text)) }, s.text)[0] }))

type Meta = { old: string; name: string; kind: Kind; category: string; mfr: string; mpn: string }
type Entry = ImportedLib['entries'][number]
const subPins = (e: LibEntry) => (e.spice?.type === 'subckt' ? e.spice : undefined)
// the symbol types a part can take: a diode model is a diode, zener or LED; a subcircuit is a block or any symbol with as many pins
const kindsFor = (e: LibEntry): Kind[] => {
  const s = subPins(e)
  if (!s) return ['diode', 'zener', 'led'].includes(e.kind) ? ['diode', 'zener', 'led'] : [e.kind]
  return [...new Set<Kind>(['block', ...SUB_KINDS.filter((k) => k !== 'block' && SYMBOLS[k].pins.length === s.pins.length), e.kind])]
}
// pinMap[symbol pin] = subckt pin: what was saved before for this type, else the suggestion, else in order
const pinMapFor = (e: LibEntry, kind: Kind, was?: Entry) => {
  const s = subPins(e)
  if (!s) return []
  return was?.kind === kind && was.pinMap.length === s.pins.length ? was.pinMap : kind === e.kind ? s.pinMap : s.pins.map((_, i) => i)
}

// Save: name, type, category (pick or type a new one), manufacturer, part number; one block per part in the definition
function SaveDialog({ parts, was, drawn, taken, categories, error, onSave, onClose }: {
  parts: LibEntry[]; was?: Entry[]; drawn: (i: number) => boolean; taken: Set<string>; categories: string[]; error: string
  onSave: (rows: Meta[]) => Promise<unknown>; onClose: () => void
}) {
  const prev = (e: LibEntry) => was?.find((x) => x.name === e.name)
  const [rows, setRows] = useState<Meta[]>(() => parts.map((e) => { const o = prev(e); return { old: e.name, name: e.name, kind: o?.kind ?? e.kind, category: o?.category ?? e.category, mfr: o?.mfr ?? '', mpn: o?.mpn ?? '' } }))
  const [busy, setBusy] = useState(false)
  const upd = (i: number, p: Partial<Meta>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const dup = (r: Meta) => rows.filter((x) => x.name.toLowerCase() === r.name.toLowerCase()).length > 1
  const ok = rows.every((r) => NAME(r.name) && !dup(r) && r.category.trim())
  const submit = () => ok && !busy && (setBusy(true), onSave(rows).finally(() => setBusy(false)))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-[520px]"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !(e.target as Element).closest('button')) e.preventDefault(), submit() }}>
        <DialogHeader className="border-b px-4 py-3"><DialogTitle className="text-sm">Save to My library</DialogTitle></DialogHeader>
        <div className="grid gap-3 overflow-y-auto px-4 py-3.5">
          {rows.map((r, i) => {
            const e = parts[i], s = subPins(e), map = pinMapFor(e, r.kind, prev(e))
            return (
              <div key={i} className={cn('grid grid-cols-2 gap-3', rows.length > 1 && 'rounded-lg border bg-card p-3')}>
                <Label className={FLD}>Name
                  <Input className={IN} spellCheck={false} autoFocus={!i} value={r.name} aria-invalid={!NAME(r.name) || dup(r) || undefined} onChange={(ev) => upd(i, { name: ev.target.value })} />
                </Label>
                <Label className={FLD}>Type
                  <Select value={r.kind} onValueChange={(v) => upd(i, { kind: v as Kind, ...(r.category === (KIND_CAT[r.kind] ?? '') && KIND_CAT[v as Kind] && { category: KIND_CAT[v as Kind] }) })}>
                    <SelectTrigger size="sm" className="w-full text-xs data-[size=sm]:h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{kindsFor(e).map((k) => <SelectItem key={k} value={k} className="text-xs">{SYMBOLS[k].title}</SelectItem>)}</SelectContent>
                  </Select>
                </Label>
                {/* native combobox: pick a category or type a new one */}
                <Label className={FLD + ' col-span-2'}>Category: choose one, or type a new one
                  <Input className="h-8 text-xs md:text-xs" list="bld-cats" maxLength={40} value={r.category} aria-invalid={!r.category.trim() || undefined} onChange={(ev) => upd(i, { category: ev.target.value })} />
                </Label>
                <Label className={FLD}>Manufacturer (optional)<Input className="h-8 text-xs md:text-xs" maxLength={80} value={r.mfr} onChange={(ev) => upd(i, { mfr: ev.target.value })} /></Label>
                <Label className={FLD}>Part number (optional)<Input className={IN} spellCheck={false} maxLength={80} value={r.mpn} onChange={(ev) => upd(i, { mpn: ev.target.value })} /></Label>
                {taken.has(r.name.toLowerCase()) && <p className="col-span-2 text-xs leading-normal text-warn">The library already has a part named {r.name}. A different name keeps the two from being mixed up in a circuit.</p>}
                {dup(r) && <p className="col-span-2 text-xs text-destructive">Two parts can't share a name.</p>}
                {s && r.kind !== 'block' && !drawn(i) && (
                  <p className={MUTED + ' col-span-2'}>Its pins connect as {SYMBOLS[r.kind].pins.map((_, j) => `${SYMBOLS[r.kind].pinNames?.[j] ?? `pin ${j + 1}`} → ${s.pins[map[j]]}`).join(', ')}. For another arrangement, draw the symbol and connect its pins yourself.</p>
                )}
              </div>
            )
          })}
          {error && <Alert variant="destructive"><AlertDescription className="text-xs">{error}</AlertDescription></Alert>}
        </div>
        <datalist id="bld-cats">{[...new Set([...CATEGORIES, ...categories])].map((c) => <option key={c} value={c} />)}</datalist>
        <DialogFooter className="border-t px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={!ok || busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// text with the definition called `old` renamed (the name is the .model / .subckt name in the SPICE)
function renamed(text: string, old: string, now: string) {
  const p = parseLibFile(text), m = p.models.find((x) => x.name === old), s = p.subckts.find((x) => x.name === old), f = m && modelParts(m.text)
  if (m && f) return text.replace(m.text, () => modelText(now, f.type, f.params))
  if (!s) return text
  const { tail, body } = subcktParts(s)
  return text.replace(s.text, () => subcktText(now, s.pins, tail, body))
}

export function Builder({ sources, taken }: {
  sources: Sources
  taken: LibEntry[] // every part there is: a new part with one of these names gets a warning
}) {
  const [started, setStarted] = useState(false) // false: the start screen (choose a kind of part, or open one of yours)
  const [mode, setMode] = useState<'design' | 'code'>('design')
  const [initial, setInitial] = useState(STARTERS[0].text) // what the code editor was last loaded with
  const [text, setText] = useState(initial)
  const [syms, setSyms] = useState<Record<number, CustomSymbol>>({}) // symbols you've drawn or changed, by part position; the others show (and are saved with) their standard symbol
  const [editing, setEditing] = useState<ImportedLib | null>(null) // a part made earlier, open again: saving rewrites it
  const [gen, setGen] = useState(0) // counts loads: the form's code fields start afresh
  const [cur, setCur] = useState(0) // which part is on the drawing canvas (a definition can hold several)
  const [saving, setSaving] = useState(false) // the Save dialog
  const [q, setQ] = useState('')
  const [side, setSide] = useState<HTMLDivElement | null>(null) // where the drawing's pin list goes (right panel)
  const [note, setNote] = useState(''), [err, setErr] = useState('')
  const parsed = useMemo(() => parseLibFile(text), [text])
  const plain = useMemo(() => entriesFromImport({ file: 'new part', entries: suggest(parsed) }, text), [parsed, text])
  const std = useMemo(() => plain.map(standardSymbol), [plain]) // what the canvas starts from: the standard symbol, as shapes you can change
  const parts = useMemo(() => plain.map((e, i) => (syms[i] ? { ...e, symbol: syms[i] } : e)), [plain, syms])
  const ci = parts[cur] ? cur : 0, part = parts[ci]
  const names = useMemo(() => new Set(taken.filter((e) => !editing || !e.id.startsWith(`user:${editing.file}#`)).map((e) => e.name.toLowerCase())), [taken, editing]) // not the part being edited itself
  const stale = parts.filter((e) => e.symbol && symbolErrors(e.symbol, e).length).map((e) => e.name) // drawn, but not every pin is connected
  const reload = (t: string) => setInitial(t === initial ? t + '\n' : t) // a changed `initial` reloads the editor
  const load = (t: string) => (setStarted(true), reload(t), setText(t), setGen((g) => g + 1), setSyms({}), setEditing(null), setCur(0), setNote(''), setErr(''))
  const edit = (old: string, now: string) => setText(text.replace(old, () => now)) // form: rewrite one definition in place
  const draw = (s: CustomSymbol | null) => setSyms((m) => { const { [ci]: _, ...rest } = m; return s ? { ...rest, [ci]: s } : rest })
  const custom = useMemo(() => [...new Set(taken.map((e) => e.category))].filter((c) => !CATEGORIES.includes(c)).sort(), [taken])

  // the list: every part of My library under its category (built-in order, then your own)
  // ponytail: My library has no "made here" mark, so imported vendor files are listed too; the big ones (one form per part) are left to Manage Libraries
  const ql = q.trim().toLowerCase()
  const mine = sources.user.libs.filter((l) => l.entries.length <= 12 && sources.user.texts[l.file] != null).flatMap((l) => l.entries.map((e) => ({ l, e })))
  const found = mine.filter(({ e }) => !ql || [e.name, e.category, e.mfr, e.mpn].some((x) => x?.toLowerCase().includes(ql)))
  const groups = [...CATEGORIES, ...custom].map((c) => ({ c, items: found.filter((x) => x.e.category === c) })).filter((g) => g.items.length)
  const entryOf = (l: ImportedLib, e: Entry) => sources.entries.find((x) => x.id === `user:${l.file}#${e.name}`) // for its small symbol

  function open(l: ImportedLib, name: string) {
    const t = sources.user.texts[l.file], sg = suggest(parseLibFile(t))
    load(t), setEditing(l), setCur(Math.max(0, sg.findIndex((s) => s.name === name)))
    setSyms(Object.fromEntries(sg.flatMap((s, i) => { const o = l.entries.find((e) => e.name === s.name); return o?.symbol ? [[i, o.symbol]] : [] })))
  }

  async function save(rows: Meta[]) {
    setErr('')
    let file = ''
    const t = rows.reduce((t, r) => (r.name === r.old ? t : renamed(t, r.old, r.name)), text)
    try {
      if (editing) await window.api.userlib.write(editing.file, t)
      else file = (await window.api.userlib.create(rows[0].name, t)).file
      // a drawn symbol goes with its part (one that doesn't connect every pin is ignored when placing: the part uses the standard symbol)
      const lib: ImportedLib = { file: editing?.file ?? file, entries: rows.map((r, i) => ({
        name: r.name, kind: r.kind, category: r.category.trim(), pinMap: pinMapFor(parts[i], r.kind, editing?.entries.find((x) => x.name === r.old)),
        ...(syms[i] && { symbol: syms[i] }), ...(r.mfr.trim() && { mfr: r.mfr.trim() }), ...(r.mpn.trim() && { mpn: r.mpn.trim() })
      })) }
      await sources.save(lib)
      setText(t), reload(t), setSaving(false), setEditing(lib) // from here on, Save rewrites this part instead of adding another
      setNote(`Saved ${rows.map((r) => r.name).join(', ')} under ${[...new Set(lib.entries.map((e) => e.category))].join(', ')}.${editing ? ' Projects that already use it keep the copy they have.' : ''}`)
    } catch (e) {
      if (file && !editing) window.api.userlib.remove(file).catch(() => {}) // written but not listed: don't leave it behind
      setErr(String((e as Error)?.message ?? e))
    }
  }

  return (
    <div className={cn('grid h-full min-h-0', started ? 'grid-cols-[250px_minmax(0,1fr)_340px]' : 'grid-cols-[250px_minmax(0,1fr)]')}>
      <aside className="flex min-h-0 flex-col gap-2 border-r px-2.5 py-3" aria-label="Parts you've made">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Plus />New part<ChevronDown className="ml-auto opacity-60" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[230px]">
            {STARTERS.map((s) => <DropdownMenuItem key={s.title} onSelect={() => (load(s.text), setMode('design'))}>{s.title}</DropdownMenuItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => (load(''), setMode('code'))}>Empty: write the SPICE yourself</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Input className="h-8 text-xs md:text-xs" type="search" placeholder="Search your parts" aria-label="Search your parts" value={q} spellCheck={false} onChange={(e) => setQ(e.target.value)} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {groups.map((g) => (
            <div key={g.c} className="mb-1.5 grid gap-px">
              <div className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground">{g.c}</div>
              {g.items.map(({ l, e }) => { const le = entryOf(l, e); return (
                <Button key={l.file + '#' + e.name} variant="ghost" className="h-auto w-full justify-start gap-2 px-2 py-1 text-left font-normal aria-pressed:bg-accent" aria-pressed={editing?.file === l.file && part?.name === e.name} onClick={() => open(l, e.name)}>
                  {le && mini(le)}
                  <span className="grid min-w-0"><b className="truncate font-mono text-xs font-medium">{e.name}</b>
                    {(e.mfr || e.mpn) && <small className="truncate text-[11px] text-muted-foreground">{[e.mfr, e.mpn].filter(Boolean).join(' · ')}</small>}</span>
                </Button>
              ) })}
            </div>
          ))}
          {!found.length && <p className={MUTED + ' px-2 py-1'}>{mine.length ? `Nothing matches “${q}”.` : 'Parts you save appear here under their category, ready to open and change.'}</p>}
        </div>
        <Button variant="link" className="h-auto justify-start p-0 px-2 text-xs" onClick={() => runCommand('tools.manageLibraries')}>Remove or hide parts…</Button>
      </aside>

      {!started && (
        <section className="min-h-0 overflow-y-auto px-10 py-8" aria-label="Start a new part">
          <div className="mx-auto grid max-w-[860px] gap-4">
            <div>
              <h2 className="text-base font-semibold">What are you making?</h2>
              <p className={MUTED + ' mt-1'}>Choose a kind of part to start from: it opens in the drawing editor with its usual symbol and values, ready to change. Empty starts from SPICE you write yourself. Or open one of your parts on the left.</p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {TILES.map((s) => (
                <button key={s.title} type="button" className={TILE} onClick={() => (load(s.text), setMode('design'))}>
                  <span className="w-full [&_.symp]:h-24 [&_.symp]:text-foreground"><SymbolPreview kind={s.e.kind} part={s.e.kind === 'block' ? blockPartFields(s.e) : undefined} size="large" /></span>
                  <b className="text-xs font-medium">{s.title}</b>
                </button>
              ))}
              <button type="button" className={TILE} onClick={() => (load(''), setMode('code'))}>
                <span className="grid h-24 w-full place-items-center text-muted-foreground"><FileCode2 className="size-10" strokeWidth={1.25} /></span>
                <b className="text-xs font-medium">Empty</b>
              </button>
            </div>
          </div>
        </section>
      )}
      {started && <>
      <section className="flex min-h-0 flex-col border-r" aria-label="The part">
        <div className="flex flex-none items-center gap-2 border-b px-3.5 py-2">
          <b className="min-w-0 truncate font-mono text-[13px] font-medium">{parts.map((e) => e.name).join(', ') || 'New part'}</b>
          <span className={MUTED + ' flex-none'}>{editing ? 'saved in My library' : 'not saved yet'}</span>
          <ToggleGroup type="single" size="sm" variant="outline" value={mode} aria-label="Edit as" className="ml-auto flex-none">
            <ToggleGroupItem value="design" className="h-7 px-2.5 text-xs" onClick={() => setMode('design')}>Design</ToggleGroupItem>
            <ToggleGroupItem value="code" className="h-7 px-2.5 text-xs" onClick={() => (reload(text), setMode('code'))}>Code</ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" className="h-7 flex-none" disabled={!parts.length || parsed.errors.length > 0} onClick={() => (setNote(''), setErr(''), setSaving(true))}>Save…</Button>
        </div>
        {(parsed.errors.length > 0 || stale.length > 0 || note) && (
          <div className="grid flex-none gap-1 border-b px-3.5 py-2 text-xs leading-normal">
            {parsed.errors.map((x, i) => <p key={i} className="text-destructive">{x}</p>)}
            {stale.length > 0 && <p className="text-warn">The symbol drawn for {stale.join(', ')} doesn't connect every pin yet. Until it does, the part is placed with its standard symbol.</p>}
            {note && <p className="text-ok" role="status">{note}</p>}
          </div>
        )}
        {mode === 'code' ? <div className="min-h-0 flex-1 overflow-hidden"><Editor initial={initial} onChange={setText} /></div>
          : part ? (
            <SymbolPad key={ci} e={part} sym={syms[ci] ?? std[ci]} put={draw} side={side} lead={parts.length > 1 && (
              <Select value={String(ci)} onValueChange={(v) => setCur(+v)}>
                <SelectTrigger size="sm" aria-label="Part to draw" className="h-7 w-44 font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{parts.map((x, i) => <SelectItem key={i} value={String(i)} className="font-mono text-xs">{x.name}</SelectItem>)}</SelectContent>
              </Select>)} />
          ) : <p className={MUTED + ' p-4'}>Nothing to draw yet: choose a starting point under New part, or write the SPICE yourself in Code.</p>}
      </section>

      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3.5" aria-label="Preview and behaviour">
        <div className={H}>Preview</div>
        {part ? <div className="flex-none rounded-md border bg-background p-1 [&_.symp]:text-foreground"><SymbolPreview kind={part.kind} part={{ pins: (syms[ci] ?? std[ci]).pins, sym: (syms[ci] ?? std[ci]).shapes }} size="large" /></div>
          : <p className={MUTED}>Nothing that can be placed yet.</p>}
        <div ref={setSide} className="flex-none empty:hidden" />
        {/* Code edits the same text: the form stays out of its way */}
        {mode === 'design' && (
          <>
            <div className={H}>How it behaves</div>
            {parsed.models.map((m, i) => <ModelForm key={'m' + i} text={m.text} put={(t) => edit(m.text, t)} />)}
            {parsed.subckts.map((s, i) => <SubcktForm key={'s' + i + '|' + gen} s={s} put={(t) => edit(s.text, t)} />)}
            {parsed.models.length + parsed.subckts.length > parts.length && <p className={MUTED}>Only models of type D, NPN, PNP, NJF, PJF, NMOS and PMOS, and subcircuits, become parts you can place.</p>}
          </>
        )}
      </aside>
      </>}

      {saving && <SaveDialog parts={parts} was={editing?.entries} drawn={(i) => !!syms[i]} taken={names} categories={custom} error={err} onSave={save} onClose={() => setSaving(false)} />}
    </div>
  )
}
