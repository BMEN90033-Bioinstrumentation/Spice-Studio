// Full-page library browser (enabled libraries, by category) + the vendor .lib import pin-mapping dialog (Manage Libraries).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKE } from 'react'
import { SYMBOLS, type Kind } from '../schematic/symbols'
import { blockPartFields, CATEGORIES as CATS, libKey, suggest, type Category, type ImportedLib, type LibEntry, type ParsedLib } from './library'
import { match, mini, useDebounced, VList } from './LibraryPanel'
import type { PackInfo } from './sources'
import { SymbolPreview } from './Symbol'
import { isUrl, Modal, PackLicence } from '../Help'
import { runCommand } from '../commands'

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
    <button className={`libv-nav-b${cat === id ? ' on' : ''}`} aria-pressed={cat === id} onClick={() => setCat(id)}>
      <span>{label}</span><span className="cnt">{n.toLocaleString()}</span>
    </button>
  )

  return (
    <div className="libv">
      <aside className="libv-nav">
        <input className="libv-search" type="search" placeholder="Search library" aria-label="Search library" value={q} spellCheck={false} onChange={(e) => setQ(e.target.value)} />
        <nav aria-label="Categories" onKeyDown={(e) => arrows(e, '.libv-nav-b')}>
          {navBtn('all', 'All parts', found.length)}
          {cats.map((c) => <div key={c}>{navBtn(c, c, counts.get(c) ?? 0)}</div>)}
        </nav>
        <button className="libv-manage" onClick={() => runCommand('tools.manageLibraries')} title="Show, hide or import component libraries">Manage libraries…</button>
      </aside>

      <section className="libv-list" aria-label="Parts">
        <div className="libv-count">{shown.length.toLocaleString()} part{shown.length === 1 ? '' : 's'}{ql ? ` matching “${ql}”` : ''}</div>
        {shown.length ? (
          <VList className="libv-rows" items={shown} height={rowH} keyOf={rowKey} reset={`${ql}|${cat}`} onKeyDown={(e) => arrows(e, '.libv-row')}
            render={(e) => (
              <button className={`libv-row${e === sel ? ' on' : ''}`} aria-pressed={e === sel} onClick={() => setSelId(e.id)}>
                {mini(e)}
                <span><b>{e.name}</b><small>{e.description}</small></span>
              </button>
            )} />
        ) : <p className="libv-muted pad">Nothing matches{q ? ` “${q}”` : ''}.</p>}
      </section>

      <section className="libv-detail">{sel ? <Detail e={sel} packs={packs} onNotice={setNotice} /> : <p className="libv-muted pad">Select a part.</p>}</section>

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
    <article className="libv-card">
      <div className="libv-head">
        <h2>{e.name}</h2>
        <span className="chip">{e.category}</span>
        <span className="chip">{e.source === 'bundled' ? 'bundled' : fileOf(e)}</span>
        {pack?.license && <span className="chip libv-lic" title={pack.license}>{pack.license}</span>}
      </div>
      <p className="libv-desc">{e.description}</p>
      <div className="libv-sym"><SymbolPreview kind={e.kind} part={e.kind === 'block' ? blockPartFields(e) : undefined} size="large" /></div>
      <dl className="libv-dl">
        <dt>Value</dt><dd><code>{e.value}</code></dd>
        <dt>Symbol</dt><dd>{SYMBOLS[e.kind].title}</dd>
        <dt>Source</dt><dd>{
          e.source === 'bundled' ? 'Bundled with Spice Studio'
          : e.source === 'user' ? `My library · ${fileOf(e)}`
          : e.source === 'pack' ? <>{pack?.name ?? 'Pack'}{pack?.version && ` ${/^\d/.test(pack.version) ? 'v' : ''}${pack.version}`} · {fileOf(e)}{pack?.source && <> · from {isUrl(pack.source) ? <a href={pack.source} target="_blank" rel="noreferrer">{pack.source}</a> : pack.source}</>}</>
          : `Project file ${fileOf(e)}`
        }</dd>
        {pack && <><dt>Licence</dt><dd>{pack.license || 'not stated'} · <button className="libv-link" onClick={() => onNotice(pack)}>notice</button></dd></>}
        {e.compat && <><dt>Dialect</dt><dd>{e.compat}</dd></>}
        {!e.spice && <><dt>Model</dt><dd>Built-in SPICE element: the value is the whole spec</dd></>}
      </dl>
      {sub && (
        <>
          <h3>Pins</h3>
          <table className="libv-tab">
            <thead><tr><th>#</th><th>Symbol</th><th>Subckt pin</th></tr></thead>
            <tbody>{sub.pinMap.map((j, i) => <tr key={i}><td>{i + 1}</td><td>{e.kind === 'block' ? sub.pins[j] : pinName(e.kind, i)}</td><td><code>{sub.pins[j]}</code></td></tr>)}</tbody>
          </table>
        </>
      )}
      {e.params && Object.keys(e.params).length > 0 && (
        <>
          <h3>Parameters</h3>
          <table className="libv-tab">
            <tbody>{Object.entries(e.params).map(([k, v]) => <tr key={k}><td>{k}</td><td><code>{v}</code></td></tr>)}</tbody>
          </table>
        </>
      )}
      {text && (
        <>
          <h3>SPICE <button className="libv-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></h3>
          <pre className="libv-code" tabIndex={0}>{text}</pre>
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
export function ImportDialog({ rel, parsed, onClose, onImport }: { rel: string; parsed: ParsedLib; onClose: () => void; onImport: (l: ImportedLib) => void }) {
  const orig = useMemo(() => suggest(parsed), [parsed])
  const [rows, setRows] = useState<Row[]>(() => orig.map((r) => ({ ...r, include: true })))
  const card = useRef<HTMLDivElement>(null)
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

  const cb = useRef({ onClose, submit })
  cb.current = { onClose, submit }
  useEffect(() => {
    const d = card.current!.ownerDocument, w = d.defaultView!
    const prev = d.activeElement as HTMLElement | null
    card.current?.querySelector<HTMLElement>('input, select, button:not(.adlg-x)')?.focus()
    const k = (e: KeyboardEvent) => {
      e.stopPropagation() // modal: canvas shortcuts never see these keys
      if (e.key === 'Escape') e.preventDefault(), cb.current.onClose()
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.preventDefault(), cb.current.submit()
      else if (e.key === 'Tab') {
        const f = [...card.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')]
        const i = f.indexOf(d.activeElement as HTMLElement)
        const to = i < 0 ? f[0] : e.shiftKey && i === 0 ? f[f.length - 1] : !e.shiftKey && i === f.length - 1 ? f[0] : null
        if (to) e.preventDefault(), to.focus()
      }
    }
    w.addEventListener('keydown', k, true)
    return () => { w.removeEventListener('keydown', k, true); prev?.focus?.() }
  }, [])

  return (
    <div className="adlg-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="adlg libv-dlg" role="dialog" aria-modal="true" aria-labelledby="libv-dlg-t" ref={card}>
        <div className="adlg-head">
          <h2 id="libv-dlg-t">Import <code>{rel}</code></h2>
          <button className="adlg-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="libv-dlg-body">
          {parsed.errors.length > 0 && (
            <ul className="libv-perr" role="alert">{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
          {!rows.length && <p className="libv-muted">No usable .model or .subckt definitions found in this file.</p>}
          {skipped > 0 && <p className="libv-muted">{skipped} model{skipped > 1 ? 's' : ''} without a matching symbol (JFET, switch…) stay available to the subcircuits through the include.</p>}
          {rows.map((r, i) => {
            const { m, s } = info[i], kinds = s ? SUB_KINDS : MODEL_KINDS
            return (
              <div key={i} className={`libv-imp${r.include ? '' : ' off'}`}>
                <div className="libv-imp-h">
                  <label className="adlg-chk">
                    <input type="checkbox" checked={r.include} onChange={(e) => upd(i, { include: e.target.checked })} />
                    <b>{r.name}</b>
                  </label>
                  <span className="chip">{m ? `.model ${m.type}` : `.subckt · ${s!.pins.length} pins`}</span>
                  <select aria-label={`${r.name} symbol`} value={r.kind} disabled={!r.include} onChange={(e) => setKind(i, e.target.value as Kind)}>
                    {[...new Set([...kinds, r.kind])].map((k) => <option key={k} value={k}>{SYMBOLS[k].title}</option>)}
                  </select>
                  <select aria-label={`${r.name} category`} value={r.category} disabled={!r.include} onChange={(e) => upd(i, { category: e.target.value as Category })}>
                    {CATS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                {s && r.include && r.kind !== 'block' && (
                  <div className="libv-pins">
                    {SYMBOLS[r.kind].pins.map((_, j) => (
                      <label key={j}>
                        <span>{pinName(r.kind, j)}</span>
                        <select value={r.pinMap[j] ?? -1} className={r.pinMap.filter((x) => x === r.pinMap[j]).length > 1 || (r.pinMap[j] ?? -1) < 0 ? 'bad' : ''}
                          onChange={(e) => upd(i, { pinMap: SYMBOLS[r.kind].pins.map((_, k) => (k === j ? +e.target.value : r.pinMap[k] ?? -1)) })}>
                          <option value={-1}>—</option>
                          {s.pins.map((p, k) => <option key={k} value={k}>{p}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
                {s && r.include && r.kind === 'block' && <p className="libv-muted">Generic block with pins {s.pins.join(', ')}</p>}
                {errs[i].map((e) => <p key={e} className="libv-err">{e}</p>)}
              </div>
            )
          })}
        </div>
        <div className="adlg-foot">
          <span className="adlg-hint"><kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> import</span>
          <button onClick={onClose}>Cancel</button>
          <button className="run" onClick={submit} disabled={!ok}>Import {rows.filter((r) => r.include).length || ''}</button>
        </div>
      </div>
    </div>
  )
}
