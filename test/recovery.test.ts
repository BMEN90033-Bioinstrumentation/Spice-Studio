import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recoveryStore } from '../src/main/recovery.ts'

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
    writeFileSync(join(dir, 'junk.json'), '{not json')
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ ...draft('mismatch'), time: 1 })) // id must match the file name
    writeFileSync(join(dir, 'half.json.tmp'), '{')
    assert.deepEqual(recoveryStore(() => dir).list(), [])
    assert.equal(readFileSync(join(dir, 'junk.json'), 'utf8'), '{not json')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
