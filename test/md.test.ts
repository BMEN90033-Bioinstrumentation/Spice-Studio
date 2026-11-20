import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mdChars, parseMd } from '../src/renderer/src/schematic/md.ts'
import { callout, parseSheet } from '../src/renderer/src/schematic/model.ts'

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
  // a size saved on a comment block (it once had a Size setting) is dropped on load; a plain note keeps its size
  const sized = (md?: boolean) => parseSheet(JSON.stringify({ version: 1, parts: [], wires: [], texts: [], draw: [{ id: 'a', t: 'note', x: 0, y: 0, text: 'x', size: 20, md }] })).draw![0]
  assert.equal('size' in sized(true), false)
  assert.equal((sized() as { size?: number }).size, 20)
})

test('call-out arrow: from the edge of the comment to just short of the part, along the line between centres; none when they overlap', () => {
  const card = { x0: 0, y0: 0, x1: 100, y1: 40 }
  assert.deepEqual(callout(card, { x0: 190, y0: 10, x1: 210, y1: 30 }), { a: { x: 100, y: 20 }, b: { x: 186, y: 20 } }) // straight right, 4 short
  assert.deepEqual(callout(card, { x0: 40, y0: 100, x1: 60, y1: 120 }, 0), { a: { x: 50, y: 40 }, b: { x: 50, y: 100 } }) // straight down
  assert.equal(callout(card, { x0: 90, y0: 10, x1: 110, y1: 30 }), null)
  const s = (pins: unknown) => JSON.stringify({ version: 1, parts: [], wires: [], texts: [], draw: [{ id: 'a', t: 'note', x: 0, y: 0, text: '', md: true, pins }] })
  assert.deepEqual((parseSheet(s(['p1'])).draw![0] as { pins?: string[] }).pins, ['p1'])
  assert.throws(() => parseSheet(s([1])))
})

test('comment editor (keep mode): one line per source line, the spans joining back to exactly what was typed', () => {
  const src = '# Title\nplain **bold** *it* `v(out)` [doc](http://x)\n- item\n  - [x] done\n> quote\n---\n```\n**raw**\n```\n\n<b>2*3</b>'
  const l = parseMd(src, true)
  assert.equal(l.map((x) => x.spans.map((p) => p.s).join('')).join('\n'), src)
  assert.deepEqual(l[0], { spans: [{ s: '# ', b: true, m: true }, { s: 'Title', b: true }], k: 1.6 })
  assert.deepEqual(l[1].spans.slice(1, 4), [{ s: '**', m: true }, { s: 'bold', b: true }, { s: '**', m: true }])
  assert.deepEqual(l[1].spans.slice(-3), [{ s: '[', m: true }, { s: 'doc', u: true }, { s: '](http://x)', m: true }])
  assert.deepEqual(l[7].spans, [{ s: '**raw**', c: true }])
})
