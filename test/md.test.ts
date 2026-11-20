import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mdChars, parseMd } from '../src/renderer/src/schematic/md.ts'
import { parseSheet } from '../src/renderer/src/schematic/model.ts'

test('comment block markdown: headings, inline styles, lists, code fences, rules; markup is never passed through as HTML', () => {
  const l = parseMd('# Title\nplain **bold** *it* `v(out)` [doc](http://x)\n- item\n  - [x] done\n> quote\n---\n```\n**raw**\n```\n<b>2*3</b>')
  assert.deepEqual(l[0], { spans: [{ s: 'Title', b: true }], k: 1.6 })
  assert.deepEqual(l[1].spans, [{ s: 'plain ' }, { s: 'bold', b: true }, { s: ' ' }, { s: 'it', i: true }, { s: ' ' }, { s: 'v(out)', c: true }, { s: ' ' }, { s: 'doc', u: true }])
  assert.equal(l[2].spans[0].s, '• ')
  assert.equal(l[3].spans[0].s, '  ☑ ')
  assert.deepEqual(l[4].spans, [{ s: '│ ' }, { s: 'quote', i: true }])
  assert.equal(l[5].rule, true)
  assert.deepEqual(l[6], { spans: [{ s: '**raw**', c: true }], k: 1 }) // fenced: verbatim, the fence lines themselves dropped
  assert.deepEqual(l[7].spans, [{ s: '<b>2*3</b>' }]) // plain text; a lone * is not emphasis
  assert.equal(l.length, 8)
  assert.equal(mdChars(l[1]), 'plain bold it v(out) doc'.length)
})

test('parseSheet keeps a comment block (note with md) and rejects a bad md flag', () => {
  const sheet = (md: unknown) => JSON.stringify({ version: 1, parts: [], wires: [], texts: [], draw: [{ id: 'a', t: 'note', x: 0, y: 0, text: '# hi', md }] })
  assert.equal((parseSheet(sheet(true)).draw![0] as { md?: boolean }).md, true)
  assert.throws(() => parseSheet(sheet('yes')))
})
