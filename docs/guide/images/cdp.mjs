// Tiny Chrome DevTools Protocol client for the guide screenshots (Node 22+, no dependencies). See README.md.
//   node cdp.mjs eval '<js>'            evaluate in the page, print the value
//   node cdp.mjs shot out.png [x y w h]  screenshot (CSS px clip optional)
//   node cdp.mjs click x y [alt|shift] [count]   mouse click at CSS px
//   node cdp.mjs drag x1 y1 x2 y2 [alt]  press, move, release
//   node cdp.mjs move x y [alt]
//   node cdp.mjs key <key> [meta|ctrl|shift|alt]  one key press (e.g. Enter, Escape, a)
//   node cdp.mjs type '<text>'           insert text into the focused field
// PORT (default 9334) and TARGET (substring of the page title, default: first non-devtools page) via env.
const PORT = process.env.PORT ?? 9334
const [, , cmd, ...a] = process.argv
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const pages = list.filter((x) => x.type === 'page' && !x.url.startsWith('devtools'))
const t = process.env.TARGET ? pages.find((x) => x.title.includes(process.env.TARGET)) : pages.find((x) => x.url.includes('index.html')) ?? pages[0]
if (!t) throw new Error('no target; pages: ' + pages.map((p) => p.title).join(' | '))
const open = async (url) => {
  const ws = new WebSocket(url)
  let id = 0
  const pend = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pend.get(d.id)?.(d); pend.delete(d.id) }
  await new Promise((r) => (ws.onopen = r))
  return { ws, call: (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })) }) }
}
const { ws, call } = await open(t.webSocketDebuggerUrl)
const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
const mods = (s) => (s ? s.split(',').reduce((m, k) => m | (MODS[k] ?? 0), 0) : 0)
const mouse = (type, x, y, m = 0, extra = {}) => call('Input.dispatchMouseEvent', { type, x: +x, y: +y, modifiers: m, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (cmd === 'eval') {
  const r = await call('Runtime.evaluate', { expression: a[0], awaitPromise: true, returnByValue: true, userGesture: true })
  console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result, null, 1))
} else if (cmd === 'shot') {
  const [file, x, y, w, h] = a
  const p = { format: 'png', ...(w ? { clip: { x: +x, y: +y, width: +w, height: +h, scale: 1 } } : {}) }
  const r = await call('Page.captureScreenshot', p)
  ;(await import('node:fs')).writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  console.log('shot', file)
} else if (cmd === 'click') {
  const [x, y, m, n] = a
  await mouse('mouseMoved', x, y, mods(m), { buttons: 0 })
  for (let i = 1; i <= (+n || 1); i++) {
    await mouse('mousePressed', x, y, mods(m), { clickCount: i })
    await mouse('mouseReleased', x, y, mods(m), { clickCount: i })
  }
} else if (cmd === 'move') {
  await mouse('mouseMoved', a[0], a[1], mods(a[2]), { buttons: 0 })
} else if (cmd === 'drag') {
  const [x1, y1, x2, y2, m] = a, k = mods(m)
  await mouse('mouseMoved', x1, y1, k, { buttons: 0 })
  await mouse('mousePressed', x1, y1, k)
  for (let i = 1; i <= 10; i++) await mouse('mouseMoved', +x1 + ((x2 - x1) * i) / 10, +y1 + ((y2 - y1) * i) / 10, k), await sleep(15)
  await mouse('mouseReleased', x2, y2, k)
} else if (cmd === 'key') {
  const [key, m] = a, k = mods(m)
  const code = key.length === 1 ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /\d/.test(key) ? 'Digit' + key : '') : key
  const vk = { Enter: 13, Escape: 27, Backspace: 8, Delete: 46, Tab: 9 }[key] ?? key.toUpperCase().charCodeAt(0)
  const base = { key, code, modifiers: k, windowsVirtualKeyCode: vk }
  await call('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key.length === 1 && !(k & 6) ? { text: key } : {}) })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
} else if (cmd === 'type') {
  await call('Input.insertText', { text: a[0] })
}
ws.close()
