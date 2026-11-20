// The comment block's in-place editor: its markdown typed straight onto the card and formatted as you type (headings
// grow, **bold** is bold…), the syntax characters staying visible but dimmed. A plain-text contentEditable whose text
// is always exactly the markdown source: after every edit it is re-drawn from md.ts and the caret put back.
// The DOM inside is ours, not React's, and is built with textContent only (no HTML from the sheet).
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { parseMd } from './md'

function draw(el: HTMLElement, text: string, size: number) {
  const nodes: Node[] = []
  parseMd(text, true).forEach((l, i) => {
    if (i) nodes.push(document.createTextNode('\n'))
    const line = document.createElement('span')
    line.style.fontSize = l.k * size + 'px'
    for (const p of l.spans) {
      const e = document.createElement('span')
      e.textContent = p.s
      e.className = [p.m && 'm', p.c && 'c', p.b && 'b', p.i && 'i', p.u && 'u'].filter(Boolean).join(' ')
      line.append(e)
    }
    nodes.push(line)
  })
  if (!text || text.endsWith('\n')) nodes.push(document.createElement('br')) // gives the empty last line a place for the caret
  el.replaceChildren(...nodes)
}
// caret position <-> offset into the text
const offsetOf = (el: HTMLElement, node: Node, off: number) => { const r = document.createRange(); r.selectNodeContents(el); r.setEnd(node, off); return r.toString().length }
function locate(el: HTMLElement, pos: number): [Node, number] {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n: Node | null, last: Node | null = null
  while ((n = w.nextNode())) {
    const len = n.textContent!.length
    if (pos <= len) return [n, pos]
    pos -= len, last = n
  }
  return last ? [last, last.textContent!.length] : [el, 0]
}
const select = (el: HTMLElement, a: number, b = a) => getSelection()?.setBaseAndExtent(...locate(el, a), ...locate(el, b))
const caret = (el: HTMLElement): [number, number] => {
  const s = getSelection(), n = (el.textContent ?? '').length
  return s?.anchorNode && s.focusNode && el.contains(s.anchorNode) ? [offsetOf(el, s.anchorNode, s.anchorOffset), offsetOf(el, s.focusNode, s.focusOffset)] : [n, n]
}

export function MdEdit({ text, size, minW, minH, fresh, onChange, onDone, onUndo, onBlur }: {
  text: string; size: number; minW: number; minH: number
  fresh: RefObject<boolean> // a just-placed block: its starter text starts selected, so typing replaces it
  onChange: (text: string) => void; onDone: () => void; onUndo: (redo: boolean) => void; onBlur: () => void
}) {
  const ref = useRef<HTMLDivElement>(null), drawn = useRef<string | null>(null)
  const set = (el: HTMLElement, t: string, a: number, b = a) => (draw(el, t, size), select(el, a, b), (drawn.current = t + size))
  useLayoutEffect(() => { // first draw, and a change from outside (undo, the Size setting)
    const el = ref.current!, first = drawn.current == null
    if (drawn.current === text + size) return
    if (first) el.focus()
    set(el, text, first && fresh.current ? 0 : text.length, text.length)
  }, [text, size])
  const edit = (t: string, at: number) => (set(ref.current!, t, at), onChange(t))
  return (
    <div ref={ref} className="ed" contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false} role="textbox" aria-multiline aria-label="Comment markdown"
      style={{ fontSize: size, minWidth: minW, minHeight: minH }}
      onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onBlur={onBlur}
      onInput={(e) => { if (!(e.nativeEvent as InputEvent).isComposing) { const el = e.currentTarget, [a, b] = caret(el); set(el, el.textContent ?? '', a, b); onChange(el.textContent ?? '') } }}
      onCompositionEnd={(e) => edit(e.currentTarget.textContent ?? '', caret(e.currentTarget)[1])}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Escape') return onDone()
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') return e.preventDefault(), onUndo(e.shiftKey)
        if (e.key !== 'Enter') return
        e.preventDefault() // our own newline: the browser's differs by where the caret is (a <br>, a second \n at the end)
        const el = e.currentTarget, t = el.textContent ?? '', [a, b] = caret(el), lo = Math.min(a, b)
        edit(t.slice(0, lo) + '\n' + t.slice(Math.max(a, b)), lo + 1)
      }} />
  )
}
