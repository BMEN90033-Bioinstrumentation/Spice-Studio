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
  assert.deepEqual(cleanPrefs({ showResults: true, resultsOnOpen: 'window' }), { ...DEFAULT_PREFS, showResults: true, resultsOnOpen: 'window' })
  assert.deepEqual(cleanPrefs({ showResults: 1, resultsOnOpen: 'floating' }), DEFAULT_PREFS)
})

test('prefs: schematic colour themes — known ids kept, unknown back to default; every theme yields a full set of colours', async () => {
  const { SCH_THEMES, schThemeCss } = await import('../src/renderer/src/schematic/themes.ts')
  assert.equal(cleanPrefs({ schTheme: 'tokyo_night' }).schTheme, 'tokyo_night')
  assert.equal(cleanPrefs({ schTheme: 'nope' }).schTheme, 'fusion_slate_amber') // the default theme
  assert.equal(schThemeCss('default'), '')
  assert.equal(SCH_THEMES.length, 22)
  for (const t of SCH_THEMES) assert.match(schThemeCss(t.id), /--bg:#[0-9a-f]{6};.*--err:#[0-9a-f]{6,8};/, t.id), assert.doesNotMatch(schThemeCss(t.id), /undefined/, t.id)
  assert.match(schThemeCss('tokyo_night'), /--wire:#9ece6a;.*--sel:#f0b35a/) // dark background: the dark selection colours
  assert.match(schThemeCss('altium_light'), /--bg:#ffffff;.*--sel:#c2410c/)
  // comment blocks: the theme accent furthest from its outlines, labels and wires
  const { commentColor } = await import('../src/renderer/src/schematic/themes.ts')
  const fusion = SCH_THEMES.find((x) => x.id === 'fusion_slate_amber')!.c
  assert.equal(commentColor(fusion), fusion.junction) // green: its note and bus blues sit next to the blue labels
  assert.match(schThemeCss('fusion_slate_amber'), /--cmt:#64d282;/)
  for (const x of SCH_THEMES) assert.ok([x.c.junction, x.c.bus, x.c.note].includes(commentColor(x.c)), x.id)
})

test('prefs: toolbar layout — a list of short ids, each tool once, separators repeat; anything else is the default', () => {
  assert.deepEqual(cleanPrefs({ toolbar: ['wire', '|', 'res', 'wire', '|', 7, 'a b', 'x'.repeat(21)] }).toolbar, ['wire', '|', 'res', '|'])
  assert.deepEqual(cleanPrefs({ toolbar: 'wire' }).toolbar, [])
})
