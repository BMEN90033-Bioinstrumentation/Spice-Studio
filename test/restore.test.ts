import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autosaveStep, keysOf, matches, withRecovery } from '../src/renderer/src/restore.ts'
import { emptySheet, type Sheet } from '../src/renderer/src/schematic/model.ts'
import { newProject } from '../src/renderer/src/project/project.ts'
import type { Recovery } from '../src/main/recovery.ts'
import type { Session } from '../src/renderer/src/main.tsx'

const marked = (text: string): Sheet => ({ ...emptySheet(), texts: [{ id: 't', x: 0, y: 0, text }] as Sheet['texts'] })
const rec = (x: Partial<Recovery> = {}): Recovery => ({ id: 'r1', time: 1, name: 'Amp', project: '/p/Amp/Amp.nsproj', sheets: { 'main.nsch': JSON.stringify(marked('copy main')), 'f.nsch': JSON.stringify(marked('copy f')) }, ...x })
const proj = (): Session => ({ kind: 'project', dir: '/p/Amp', file: 'Amp.nsproj', project: newProject('Amp'), sheets: { 'main.nsch': marked('saved main'), 'f.nsch': marked('saved f'), 'g.nsch': marked('saved g') }, libTexts: {}, warn: '' })
const textOf = (s: Sheet) => s.texts[0]?.text

test('matches: a project by its .nsproj, a loose sheet by its file, a loose netlist by net.path', () => {
  assert.ok(matches(rec(), proj()))
  assert.ok(!matches(rec({ project: '/p/Other/Other.nsproj' }), proj()))
  const loose: Session = { kind: 'loose', path: '/x/a.nsch', sheet: emptySheet() }
  assert.ok(matches(rec({ project: undefined, path: '/x/a.nsch' }), loose))
  assert.ok(!matches(rec({ project: undefined, path: null }), { ...loose, path: null })) // two untitled sessions are not the same file
  const cir: Session = { kind: 'loose', path: null, sheet: emptySheet(), net: { path: '/x/b.cir', text: '* saved' } }
  assert.ok(matches(rec({ project: undefined, path: null, sheets: {}, net: { path: '/x/b.cir', text: '* copy' } }), cir))
  assert.ok(!matches(rec({ project: undefined, path: null, sheets: {}, net: { path: null, text: '* copy' } }), cir))
})

test('withRecovery: only the chosen keys come back, marked unsaved; the rest stay as saved', () => {
  const all = withRecovery(proj(), rec({ net: { path: null, text: '* copy net' } }))
  assert.equal(all.kind, 'project')
  if (all.kind !== 'project') return
  assert.equal(textOf(all.sheets['main.nsch']), 'copy main')
  assert.equal(textOf(all.sheets['f.nsch']), 'copy f')
  assert.equal(textOf(all.sheets['g.nsch']), 'saved g')
  assert.deepEqual(all.dirty, ['main.nsch', 'f.nsch', 'net'])
  assert.deepEqual(all.net, { path: null, text: '* copy net' })
  assert.equal(all.rid, 'r1')
  // "Keep saved files" for main.nsch (it changed on disk after the copy): main stays as saved and is not marked unsaved
  const some = withRecovery(proj(), rec(), ['f.nsch'])
  if (some.kind !== 'project') return
  assert.equal(textOf(some.sheets['main.nsch']), 'saved main')
  assert.equal(textOf(some.sheets['f.nsch']), 'copy f')
  assert.deepEqual(some.dirty, ['f.nsch'])
  assert.deepEqual(keysOf(rec({ net: { path: null, text: '' } })), ['main.nsch', 'f.nsch', 'net'])
})

test('withRecovery: a loose sheet gets its file back only with its content; a damaged copy is a plain error', () => {
  const blank: Session = { kind: 'loose', path: null, sheet: emptySheet() }
  const r = rec({ project: undefined, name: 'a.nsch', path: '/x/a.nsch', sheets: { 'untitled.nsch': JSON.stringify(marked('copy')) }, net: { path: '/x/b.cir', text: '* copy' } })
  const full = withRecovery(blank, r)
  assert.ok(full.kind === 'loose' && full.path === '/x/a.nsch' && textOf(full.sheet) === 'copy')
  assert.deepEqual(full.dirty, ['untitled.nsch', 'net'])
  const netOnly = withRecovery(blank, r, ['net']) // sheet kept as saved: never an empty sheet tied to /x/a.nsch
  assert.ok(netOnly.kind === 'loose' && netOnly.path === null && netOnly.sheet.texts.length === 0)
  assert.deepEqual(netOnly.net, { path: '/x/b.cir', text: '* copy' })
  assert.throws(() => withRecovery(proj(), rec({ sheets: { 'main.nsch': '{not json' } })), /recovery copy of main\.nsch is damaged/)
  assert.throws(() => withRecovery(blank, rec({ project: undefined, name: 'a.nsch', sheets: { 'untitled.nsch': '{"version":2}' } })), /recovery copy of a\.nsch is damaged/)
})

test('autosaveStep: nothing unsaved removes the copy whatever the setting; writes only when allowed and changed', () => {
  const fresh = { onDisk: false, last: '' }, written = { onDisk: true, last: '{"a":1}' }, restored = { onDisk: true, last: '' }
  assert.equal(autosaveStep('{"a":1}', fresh, true), 'write')
  assert.equal(autosaveStep('{"a":1}', fresh, false), null) // autosave off: no copies
  assert.equal(autosaveStep('{"a":1}', written, true), null) // unchanged
  assert.equal(autosaveStep('{"a":2}', written, true), 'write')
  assert.equal(autosaveStep('', written, true), 'remove') // saved / discarded
  assert.equal(autosaveStep('', restored, false), 'remove') // restored with autosave off, then saved: the copy still goes
  assert.equal(autosaveStep('{"a":1}', restored, false), null) // restored, still unsaved, autosave off: the copy stays
  assert.equal(autosaveStep('', fresh, false), null)
})
