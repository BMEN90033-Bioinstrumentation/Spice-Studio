import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedSince, recoveryStore } from '../src/main/recovery.ts'

const draft = (id: string, extra = {}) => ({ id, name: 'Amp', project: '/p/Amp/Amp.nsproj', sheets: { 'main.nsch': '{"v":1}' }, ...extra })

test('recovery: a run never lists its own (live) copies; the next run does, newest first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rec-'))
  try {
    const a = recoveryStore(() => join(dir, 'recovery'))
    assert.deepEqual(a.list(), []) // no folder yet
    a.write(draft('one'))
    a.write(draft('two', { net: { path: null, text: '* x\n' } }))
    assert.deepEqual(a.list(), [])
    assert.deepEqual(readdirSync(join(dir, 'recovery')).sort(), ['one.json', 'two.json']) // tmp + rename leaves no .tmp
    // the process dies here (no clearOwned): a fresh store is the next launch
    const b = recoveryStore(() => join(dir, 'recovery'))
    const l = b.list()
    assert.deepEqual(l.map((r) => r.id).sort(), ['one', 'two'])
    assert.ok(l[0].time >= l[1].time)
    assert.deepEqual(l.find((r) => r.id === 'two')!.net, { path: null, text: '* x\n' })
    assert.equal(l[0].sheets['main.nsch'], '{"v":1}')
    // restoring adopts the id: rewriting makes it this run's (hidden again); a clean close removes it
    b.write(draft('one'))
    assert.deepEqual(b.list().map((r) => r.id), ['two'])
    b.clearOwned()
    assert.ok(!existsSync(join(dir, 'recovery', 'one.json')))
    assert.ok(existsSync(join(dir, 'recovery', 'two.json'))) // not ours: still offered next time
    b.remove('two')
    assert.deepEqual(recoveryStore(() => join(dir, 'recovery')).list(), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recovery: ids cannot escape the folder, bad records are refused, unreadable files are left alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rec-'))
  try {
    const s = recoveryStore(() => dir)
    for (const id of ['../x', 'a/b', '', 'a.b', 'x'.repeat(65)]) assert.throws(() => s.write(draft(id)), /Bad recovery/, id), assert.throws(() => s.remove(id), /Bad recovery/)
    assert.throws(() => s.write({ ...draft('ok'), sheets: { 'main.nsch': 42 } } as never), /Bad recovery record/)
    assert.throws(() => s.write({ ...draft('ok'), net: { text: 1 } } as never), /Bad recovery record/)
    for (const k of ['../evil.nsch', 'sub/x.nsch', '.hidden.nsch', 'main.cir']) assert.throws(() => s.write({ ...draft('ok'), sheets: { [k]: '{}' } }), /Bad recovery record/, k)
    writeFileSync(join(dir, 'junk.json'), '{not json')
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ ...draft('mismatch'), time: 1 })) // id must match the file name
    writeFileSync(join(dir, 'half.json.tmp'), '{')
    assert.deepEqual(recoveryStore(() => dir).list(), [])
    assert.equal(readFileSync(join(dir, 'junk.json'), 'utf8'), '{not json')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recovery: each copy remembers the saved files it was based on; a restore sees which changed, went, or whether the project moved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rec-'))
  try {
    const p = join(dir, 'Amp'), store = recoveryStore(() => join(dir, 'recovery')), loose = join(dir, 'a.nsch'), cir = join(dir, 'b.cir')
    mkdirSync(p)
    for (const [f, t] of [['Amp.nsproj', '{}'], ['main.nsch', 'saved main'], ['f.nsch', 'saved f']]) writeFileSync(join(p, f), t)
    writeFileSync(loose, 'saved a'), writeFileSync(cir, '* saved b')
    store.write(draft('proj', { project: join(p, 'Amp.nsproj'), sheets: { 'main.nsch': '{}', 'f.nsch': '{}', 'new.nsch': '{}' }, net: { path: null, text: '*' } }))
    store.write({ id: 'loose', name: 'a.nsch', path: loose, sheets: { 'untitled.nsch': '{}' }, net: { path: cir, text: '* copy' } })
    const [a, b] = ['proj', 'loose'].map((id) => recoveryStore(() => join(dir, 'recovery')).list().find((r) => r.id === id)!)
    assert.deepEqual(Object.keys(a.base!).sort(), ['f.nsch', 'main.nsch', 'new.nsch']) // the untitled netlist has no file
    assert.equal(a.base!['new.nsch'], null) // not on disk yet
    assert.deepEqual(changedSince(a), { missing: false, changed: [] })
    assert.deepEqual(changedSince(b), { missing: false, changed: [] })
    // after the crash: main.nsch saved again (Later, edit, ⌘S), f.nsch deleted, new.nsch created elsewhere; the loose files edited outside
    writeFileSync(join(p, 'main.nsch'), 'newer main'), rmSync(join(p, 'f.nsch')), writeFileSync(join(p, 'new.nsch'), 'x')
    writeFileSync(cir, '* edited outside')
    assert.deepEqual(changedSince(a), { missing: false, changed: [['main.nsch', 'changed'], ['f.nsch', 'gone'], ['new.nsch', 'changed']] })
    assert.deepEqual(changedSince(b), { missing: false, changed: [['net', 'changed']] })
    // the project folder moved: missing, and a located copy is checked against the new folder
    renameSync(p, join(dir, 'Moved'))
    assert.equal(changedSince(a).missing, true)
    assert.deepEqual(changedSince({ ...a, project: join(dir, 'Moved', 'Amp.nsproj') }).changed.map(([k]) => k), ['main.nsch', 'f.nsch', 'new.nsch'])
    // a renderer can't plant base hashes: the store computes them
    store.write({ ...draft('spoof', { project: join(dir, 'Moved', 'Amp.nsproj') }), base: { 'main.nsch': 'x' } } as never)
    const sp = recoveryStore(() => join(dir, 'recovery')).list().find((r) => r.id === 'spoof')!
    assert.deepEqual(changedSince(sp).changed, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
