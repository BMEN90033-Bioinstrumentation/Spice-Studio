import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accelOf, clash, cleanKeys, comboOf, keysFor, SHORTCUTS } from '../src/renderer/src/shortcuts.ts'
import { matches } from '../src/renderer/src/commands.ts'

const ev = (key: string, code: string, m: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m })

test('shortcut table: unique ids, and no two defaults share a key', () => {
  assert.equal(new Set(SHORTCUTS.map((s) => s.id)).size, SHORTCUTS.length)
  for (const s of SHORTCUTS) assert.equal(clash({}, s.id, s.keys), '', `${s.title} ${s.keys}`)
})

test('cleanKeys keeps only known ids with sane values that differ from the default', () => {
  assert.deepEqual(cleanKeys({ 'place.wire': 'K', 'place.res': 'R', nope: 'X', 'sim.run': 7, 'file.save': '', 'view.fit': 'x'.repeat(40) }), { 'place.wire': 'K', 'file.save': '' })
  assert.deepEqual(cleanKeys('junk'), {})
})

test('keysFor: override, cleared, default', () => {
  assert.equal(keysFor({ 'place.wire': 'K' }, 'place.wire'), 'K')
  assert.equal(keysFor({ 'place.wire': '' }, 'place.wire'), '')
  assert.equal(keysFor({}, 'place.wire'), 'W')
  assert.equal(keysFor({}, 'unknown.id', 'Mod+J'), 'Mod+J')
})

test('clash: reserved keys and keys already in use (after overrides)', () => {
  assert.match(clash({}, 'place.wire', 'Mod+Z'), /standard editing/)
  assert.match(clash({}, 'place.wire', 'R'), /Resistor/)
  assert.equal(clash({ 'place.res': 'K' }, 'place.wire', 'R'), '') // R was freed
  assert.match(clash({ 'place.res': 'K' }, 'place.wire', 'k'), /Resistor/)
  assert.match(clash({}, 'place.wire', 'Shift+Mod+S'), /Save as/) // modifier order doesn't matter
})

test('comboOf round-trips through matches()', () => {
  for (const [e, mac, want] of [
    [ev('k', 'KeyK'), true, 'K'], [ev('K', 'KeyK', { shiftKey: true }), true, 'Shift+K'], [ev('k', 'KeyK', { metaKey: true }), true, 'Mod+K'],
    [ev('k', 'KeyK', { ctrlKey: true }), false, 'Mod+K'], [ev('k', 'KeyK', { ctrlKey: true }), true, 'Ctrl+K'], [ev('/', 'Slash'), true, '/'], [ev('?', 'Slash', { shiftKey: true }), true, 'Shift+?'],
    [ev('Enter', 'Enter', { metaKey: true, shiftKey: true }), true, 'Mod+Shift+Enter'], [ev('1', 'Digit1', { metaKey: true, altKey: true }), true, 'Mod+Alt+1'], [ev('F5', 'F5'), false, 'F5']
  ] as const) {
    assert.equal(comboOf(e, mac), want)
    assert.ok(matches(want, e, mac), `${want} should match its own event`)
  }
  assert.equal(comboOf(ev('Shift', 'ShiftLeft', { shiftKey: true }), true), null)
})

test('accelOf: Electron accelerators for the menu', () => {
  assert.equal(accelOf('Mod+Shift+K'), 'CmdOrCtrl+Shift+K')
  assert.equal(accelOf('W'), 'W')
  assert.equal(accelOf(''), undefined)
})
