import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanPrefs, DEFAULT_PREFS } from '../src/renderer/src/prefs.ts'

test('prefs: defaults keep the app as it was (dark, autosave on); garbage falls back per field', () => {
  assert.deepEqual(cleanPrefs(undefined), DEFAULT_PREFS)
  assert.equal(DEFAULT_PREFS.theme, 'dark')
  assert.deepEqual(cleanPrefs({ theme: 'light', autosave: false, autosaveSecs: 120, sim: { compat: 'lt', timeoutS: 30 }, projectDir: ' /x ', grid: false, showOp: false, ngspicePath: '/opt/ngspice', junk: 1 }),
    { ...DEFAULT_PREFS, theme: 'light', autosave: false, autosaveSecs: 120, sim: { compat: 'lt', timeoutS: 30 }, projectDir: '/x', grid: false, showOp: false, ngspicePath: '/opt/ngspice' })
  // the newer settings: valid values kept, anything else back to the default
  assert.deepEqual(cleanPrefs({ uiScale: 1.25, editorFont: 14, gridStyle: 'lines', labelSize: 'l', lineWeight: 'bold', wheel: 'zoom', live: false, plotWidth: 2, keys: { 'place.wire': 'K', bogus: 'X' } }),
    { ...DEFAULT_PREFS, uiScale: 1.25, editorFont: 14, gridStyle: 'lines', labelSize: 'l', lineWeight: 'bold', wheel: 'zoom', live: false, plotWidth: 2, keys: { 'place.wire': 'K' } })
  assert.deepEqual(cleanPrefs({ uiScale: 7, editorFont: 99, gridStyle: 'hex', labelSize: 'xl', lineWeight: 3, wheel: 'spin', live: 'yes', plotWidth: 0, keys: [1] }), DEFAULT_PREFS)
  const bad = cleanPrefs({ theme: 'neon', autosave: 'yes', autosaveSecs: 'soon', sim: { compat: 'hspice', timeoutS: -1 }, projectDir: 3, grid: null })
  assert.deepEqual(bad, DEFAULT_PREFS)
  assert.equal(cleanPrefs({ autosaveSecs: 1 }).autosaveSecs, 5) // clamped
  assert.equal(cleanPrefs({ autosaveSecs: 1e6 }).autosaveSecs, 600)
  assert.deepEqual(cleanPrefs({ sim: { timeoutS: 0 } }).sim, {}) // 0 = no limit = not stored
  assert.deepEqual(cleanPrefs(['dark']), DEFAULT_PREFS)
})
