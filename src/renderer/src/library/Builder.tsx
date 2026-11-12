// Component builder (Home › Component builder): define how a part behaves, either by filling in a form or by writing
// its SPICE (.model or .subckt); both edit the same text. Draw its symbol (the symbol editor), then add it: the import
// dialog confirms symbol kind, category and pins. The part is saved to My library as its own file.
import { useMemo, useState, type ComponentProps } from 'react'
import {
  blockPartFields, entriesFromImport, MODEL_PARAMS, MODEL_TYPES, modelParts, modelText, parseLibFile, STARTERS, subcktParts, subcktText, suggest,
  type ImportedLib, type LibEntry, type ParsedLib
} from './library'
import { symbolErrors, symbolFields, type CustomSymbol } from './customSymbol'
import type { Sources } from './sources'
import { ImportDialog } from './LibraryView'
import { SymbolEditor } from './SymbolEditor'
import { SymbolPreview } from './Symbol'
import { Editor } from '../Editor'
import { runCommand } from '../commands'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
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

function SubcktForm({ s, put }: { s: ParsedLib['subckts'][number]; put: (t: string) => void }) {
  const { tail, body } = subcktParts(s)
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-3.5">
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <Label className={FLD}>Name<Field value={s.name} ok={NAME} onCommit={(v) => put(subcktText(v, s.pins, tail, body))} /></Label>
        <Label className={FLD}>Pins, in order, separated by spaces
          <Field value={s.pins.join(' ')} ok={PINS} onCommit={(v) => put(subcktText(s.name, v.trim().split(/\s+/).filter(Boolean), tail, body))} />
        </Label>
      </div>
      <Label className={FLD}>The circuit inside: one element per line, wired between the pins and any internal nodes (0 is ground)
        <Textarea className="min-h-32 font-mono text-xs md:text-xs" spellCheck={false} value={body} onChange={(e) => put(subcktText(s.name, s.pins, tail, e.target.value))} />
      </Label>
      <p className={MUTED}>For example <code className="font-mono">R1 in out 10k</code> is a 10 kΩ resistor between pins in and out.</p>
    </div>
  )
}

export function Builder({ sources, taken, onLibrary }: {
  sources: Sources
  taken: LibEntry[] // every part there is: a new part with one of these names gets a warning
  onLibrary: () => void
}) {
  const [mode, setMode] = useState<'form' | 'code'>('form')
  const [initial, setInitial] = useState(STARTERS[0].text) // what the code editor was last loaded with
  const [text, setText] = useState(initial)
  const [syms, setSyms] = useState<Record<number, CustomSymbol>>({}) // drawn symbols, by part position
  const [mapping, setMapping] = useState(false) // the symbol kind / pins dialog
  const [drawing, setDrawing] = useState(false) // the symbol editor
  const [note, setNote] = useState(''), [err, setErr] = useState('')
  const parsed = useMemo(() => parseLibFile(text), [text])
  const draft: ImportedLib = useMemo(() => ({ file: 'new part', entries: suggest(parsed).map((e, i) => (syms[i] ? { ...e, symbol: syms[i] } : e)) }), [parsed, syms])
  const parts = useMemo(() => entriesFromImport(draft, text), [draft, text])
  const names = useMemo(() => new Set(taken.map((e) => e.name.toLowerCase())), [taken])
  const clash = parts.filter((e) => names.has(e.name.toLowerCase())).map((e) => e.name)
  const stale = parts.filter((e) => e.symbol && symbolErrors(e.symbol, e).length).map((e) => e.name) // drawn, then the pins changed
  const reload = (t: string) => setInitial(t === initial ? t + '\n' : t) // a changed `initial` reloads the editor
  const load = (t: string) => (reload(t), setText(t), setSyms({}), setNote(''), setErr(''))
  const edit = (old: string, now: string) => setText(text.replace(old, () => now)) // form: rewrite one definition in place

  async function add(l: ImportedLib) {
    setErr('')
    let file = ''
    try {
      file = (await window.api.userlib.create(l.entries[0].name, text)).file
      // the drawn symbols go with their parts (one that no longer fits its pins is ignored: the part uses the generic symbol)
      const sym = (n: string) => draft.entries.find((e) => e.name === n)?.symbol
      await sources.save({ file, entries: l.entries.map((e) => (sym(e.name) ? { ...e, symbol: sym(e.name) } : e)) })
      setMapping(false), setNote(`Added ${l.entries.map((e) => e.name).join(', ')} to My library.`)
    } catch (e) {
      if (file) window.api.userlib.remove(file).catch(() => {}) // written but not mapped: don't leave it behind
      setMapping(false), setErr(String((e as Error)?.message ?? e))
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px]">
      <section className="flex min-h-0 flex-col border-r" aria-label="How the part behaves">
        <div className="flex flex-none flex-wrap items-center gap-1.5 border-b px-3.5 py-2">
          <span className={H + ' mr-1'}>Start from</span>
          {STARTERS.map((s) => <Button key={s.title} variant="outline" size="sm" className="h-7 text-xs" onClick={() => load(s.text)}>{s.title}</Button>)}
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => (load(''), setMode('code'))}>Empty</Button>
          <ToggleGroup type="single" size="sm" variant="outline" value={mode} aria-label="Edit as" className="ml-auto">
            <ToggleGroupItem value="form" className="h-7 px-2.5 text-xs" onClick={() => setMode('form')}>Form</ToggleGroupItem>
            <ToggleGroupItem value="code" className="h-7 px-2.5 text-xs" onClick={() => (reload(text), setMode('code'))}>Code</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {mode === 'code' ? <div className="min-h-0 flex-1 overflow-hidden"><Editor initial={initial} onChange={setText} /></div> : (
          <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4">
            {parsed.models.map((m, i) => <ModelForm key={'m' + i} text={m.text} put={(t) => edit(m.text, t)} />)}
            {parsed.subckts.map((s, i) => <SubcktForm key={'s' + i} s={s} put={(t) => edit(s.text, t)} />)}
            {!parsed.models.length && !parsed.subckts.length && <p className={MUTED}>Nothing to fill in yet: pick a starter above, or write the SPICE yourself in Code.</p>}
          </div>
        )}
      </section>

      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3.5">
        <p className={MUTED}>
          A part is a SPICE <code className="font-mono">.model</code> (diode, transistor) or a <code className="font-mono">.subckt</code> (any circuit, with its pins).
          Form and Code edit the same definition: switch between them at any time.
        </p>
        <div className={H}>This defines</div>
        {parts.map((e) => (
          <div key={e.id} className="grid gap-1 rounded-lg border bg-card p-2.5">
            <b className="font-mono text-[13px] font-medium">{e.name}</b>
            <span className={MUTED}>{e.description}</span>
            <div className="rounded-md border bg-background p-1 [&_.symp]:text-foreground"><SymbolPreview kind={e.kind} part={symbolFields(e) ?? (e.kind === 'block' ? blockPartFields(e) : undefined)} size="large" /></div>
          </div>
        ))}
        {!parts.length && <p className={MUTED}>Nothing that can be placed yet. Write a .model of type D, NPN, PNP, NJF, PJF, NMOS or PMOS, or a .subckt … .ends block.</p>}
        {parts.length > 0 && <Button variant="outline" size="sm" onClick={() => setDrawing(true)}>{Object.keys(syms).length ? 'Edit the symbol…' : 'Draw a symbol…'}</Button>}
        {stale.length > 0 && <p className="text-xs leading-normal text-warn">The symbol drawn for {stale.join(', ')} no longer matches its pins, so the standard one is shown. Edit the symbol to reconnect its pins.</p>}
        {parsed.errors.length > 0 && <Alert variant="destructive"><AlertDescription><ul className="list-disc pl-4 text-xs">{parsed.errors.map((x, i) => <li key={i}>{x}</li>)}</ul></AlertDescription></Alert>}
        {clash.length > 0 && <p className="text-xs leading-normal text-warn">The library already has a part named {clash.join(', ')}. Rename yours so the two can't be mixed up in a circuit.</p>}
        {err && <Alert variant="destructive"><AlertDescription className="text-xs">{err}</AlertDescription></Alert>}
        <Button disabled={!parts.length || parsed.errors.length > 0} onClick={() => (setNote(''), setErr(''), setMapping(true))}>Add to My library…</Button>
        {note && (
          <div className="grid gap-2 rounded-lg border border-ok/35 bg-ok/10 p-2.5 text-xs" role="status">
            <span>{note}</span>
            <span><Button size="sm" variant="outline" onClick={onLibrary}>Open the library</Button></span>
          </div>
        )}
        <Button variant="link" className="mt-auto h-auto justify-start p-0 text-xs" onClick={() => runCommand('tools.manageLibraries')}>Edit or remove parts you've made: Manage libraries…</Button>
      </aside>

      {mapping && <ImportDialog rel={parts[0]?.name ?? 'part'} verb="Add" parsed={parsed} onClose={() => setMapping(false)} onImport={add} />}
      {drawing && <SymbolEditor lib={draft} text={text} onClose={() => setDrawing(false)}
        onSave={async (l) => setSyms(Object.fromEntries(l.entries.flatMap((e, i) => (e.symbol ? [[i, e.symbol]] : []))))} />}
    </div>
  )
}
