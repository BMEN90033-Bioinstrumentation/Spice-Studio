import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isGlobal, matches, NATIVE, sameState, stateOf, type Command, type KeyLike } from '../src/renderer/src/commands.ts'

const ev = (key: string, code: string, m: Partial<KeyLike> = {}): KeyLike => ({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m })

test('matches: Mod is ⌘ on macOS and Ctrl elsewhere, modifiers must match exactly', () => {
  const cmdS = ev('s', 'KeyS', { metaKey: true }), ctrlS = ev('s', 'KeyS', { ctrlKey: true })
  assert.equal(matches('Mod+S', cmdS, true), true)
  assert.equal(matches('Mod+S', ctrlS, true), false)
  assert.equal(matches('Mod+S', ctrlS, false), true)
  assert.equal(matches('Mod+S', cmdS, false), false)
  assert.equal(matches('Mod+S', ev('S', 'KeyS', { metaKey: true, shiftKey: true }), true), false) // ⇧⌘S is Save As
  assert.equal(matches('Mod+Shift+S', ev('S', 'KeyS', { metaKey: true, shiftKey: true }), true), true)
  assert.equal(matches('Mod+Shift+Z', ev('z', 'KeyZ', { metaKey: true, shiftKey: true }), true), true)
  assert.equal(matches('Mod+Shift+Z', ev('z', 'KeyZ', { metaKey: true }), true), false)
  assert.equal(matches('Ctrl+R', ev('r', 'KeyR', { ctrlKey: true }), true), true) // literal Ctrl on macOS
  assert.equal(matches('Ctrl+R', ev('r', 'KeyR', { metaKey: true }), true), false)
})

test('matches: named keys, digits under Shift, letters by physical code', () => {
  assert.equal(matches('Mod+Enter', ev('Enter', 'Enter', { metaKey: true }), true), true)
  assert.equal(matches('Mod+1', ev('1', 'Digit1', { ctrlKey: true }), false), true)
  assert.equal(matches('Shift+1', ev('!', 'Digit1', { shiftKey: true }), false), true)
  assert.equal(matches('Shift+L', ev('L', 'KeyL', { shiftKey: true }), true), true)
  assert.equal(matches('Shift+L', ev('l', 'KeyL'), true), false)
  assert.equal(matches('Alt+P', ev('π', 'KeyP', { altKey: true }), true), true) // macOS Alt+P types π
  assert.equal(matches('Mod+/', ev('/', 'Slash', { metaKey: true }), true), true)
  assert.equal(matches('Plus', ev('+', 'Equal'), true), true)
  assert.equal(matches('Esc', ev('Escape', 'Escape'), true), true)
  assert.equal(matches('F', ev('f', 'KeyF'), true), true)
  assert.equal(matches('F', ev('g', 'KeyG'), true), false)
})

test('isGlobal: only modifier shortcuts fire from text fields', () => {
  assert.equal(isGlobal('Mod+S'), true)
  assert.equal(isGlobal('Ctrl+R'), true)
  assert.equal(isGlobal('Mod+Shift+Z'), true)
  assert.equal(isGlobal('Shift+L'), false)
  assert.equal(isGlobal('F'), false)
})

test('stateOf: defaults, later registrations win, checked only for toggles, throwing getters are disabled', () => {
  const a: Command[] = [{ id: 'file.save', run() {}, enabled: () => false }, { id: 'sim.run', run() {} }]
  const b: Command[] = [{ id: 'file.save', run() {}, enabled: () => true }, { id: 'view.showOp', run() {}, checked: () => true }, { id: 'x', run() {}, enabled: () => { throw new Error('boom') } }]
  assert.deepEqual(stateOf([a, b], false), {
    'file.save': { enabled: true },
    'sim.run': { enabled: true },
    'view.showOp': { enabled: true, checked: true },
    x: { enabled: false }
  })
})

test('stateOf: a focused text field enables the native edit items', () => {
  const s = stateOf([[{ id: 'edit.undo', run() {}, enabled: () => false }, { id: 'edit.rotate', run() {}, enabled: () => false }]], true)
  for (const id in NATIVE) assert.deepEqual(s[id], { enabled: true })
  assert.deepEqual(s['edit.rotate'], { enabled: false })
  assert.equal(stateOf([], false)['edit.undo'], undefined)
})

test('sameState: diffing ignores key order, catches enabled/checked/added/removed', () => {
  const s = { a: { enabled: true }, b: { enabled: false, checked: true } }
  assert.equal(sameState(s, { b: { enabled: false, checked: true }, a: { enabled: true } }), true)
  assert.equal(sameState(s, { a: { enabled: false }, b: { enabled: false, checked: true } }), false)
  assert.equal(sameState(s, { a: { enabled: true }, b: { enabled: false, checked: false } }), false)
  assert.equal(sameState(s, { a: { enabled: true } }), false)
  assert.equal(sameState(s, { a: { enabled: true }, c: { enabled: false } }), false)
  assert.equal(sameState({}, {}), true)
})
