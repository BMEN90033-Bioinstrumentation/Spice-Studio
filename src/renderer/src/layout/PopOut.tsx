// Renders its children into a separate window (same renderer process, so state is shared and live).
// main/index.ts setWindowOpenHandler only allows this frame name and sets the BrowserWindow options.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const POPOUT = 'ngspice-plots'
let child: Window | null = null
export const focusPopout = () => child?.focus()

export function PopOut({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const closed = useRef(onClose)
  closed.current = onClose

  useEffect(() => {
    const w = window.open('', POPOUT, 'width=1000,height=700')
    if (!w) return void closed.current() // blocked: stay docked
    const d = w.document
    // stylesheets: copies of the opener's (dev: vite <style> tags; build: <link>, made absolute for about:blank)
    d.head.replaceChildren(...[...document.querySelectorAll<HTMLElement>('style, link[rel=stylesheet]')].map((n) => {
      const c = d.importNode(n, true)
      if (n instanceof HTMLLinkElement) (c as HTMLLinkElement).href = n.href
      return c
    }))
    const root = d.createElement('div')
    root.className = 'popout'
    d.body.replaceChildren(root)
    // uPlot binds its drag-end mouseup to the opener's document (module-level `document`): forward the child's
    const up = (e: MouseEvent) =>
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons }))
    const gone = () => closed.current() // user closed the window: dock
    const bye = () => w.close() // opener reloads/closes: take the child with it
    d.addEventListener('mouseup', up)
    // shortcuts (⌘S, ⌘↵, ⌘3…) live on the main window's dispatcher: forward modifier keys from the child
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const f = new KeyboardEvent('keydown', { key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, repeat: e.repeat, cancelable: true })
      window.dispatchEvent(f)
      if (f.defaultPrevented) e.preventDefault()
    }
    w.addEventListener('keydown', key)
    w.addEventListener('pagehide', gone)
    window.addEventListener('pagehide', bye)
    child = w
    setHost(root)
    return () => {
      w.removeEventListener('pagehide', gone)
      w.removeEventListener('keydown', key)
      window.removeEventListener('pagehide', bye)
      child = null
      w.close()
    }
  }, [])
  useEffect(() => { if (child) child.document.title = title }, [title, host])

  return host && createPortal(children, host)
}
