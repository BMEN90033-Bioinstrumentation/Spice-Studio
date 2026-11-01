// Command registry: one place that menu clicks (main -> 'menu:command') and renderer shortcuts both go through.
// Pure helpers (matches, stateOf, sameState) are exported for tests; nothing touches the DOM until useCommands mounts.
import { useEffect, useRef } from 'react'

export interface Command {
  id: string
  run: (arg?: string) => void // arg: the suffix of a dynamic id, e.g. 'file.openRecent:/path/x.nsproj'
  enabled?: () => boolean // default true
  checked?: () => boolean // for toggle items
  keys?: string // renderer shortcut, e.g. 'Mod+S', 'Mod+Shift+Z', 'Ctrl+R', 'Shift+L'
}
export type MenuState = Record<string, { enabled: boolean; checked?: boolean }>
export type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

// Edit items that fall back to the web contents' own editing when focus is in a text field
export const NATIVE: Record<string, string> = {
  'edit.undo': 'undo', 'edit.redo': 'redo', 'edit.cut': 'cut', 'edit.copy': 'copy', 'edit.paste': 'paste', 'edit.selectAll': 'selectAll', 'edit.delete': 'delete'
}
const ALIAS: Record<string, string> = { plus: '+', minus: '-', space: ' ', esc: 'escape', del: 'delete', return: 'enter' }
const isMac = () => typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

// 'Mod+Shift+Z' -> exact modifier match (Mod = ⌘ on macOS, Ctrl elsewhere) + key, by e.key or by physical e.code
// for letters/digits (so Shift+1 / Alt+letter still match).
export function matches(keys: string, e: KeyLike, mac = isMac()): boolean {
  const parts = keys.split('+')
  const key = parts.pop()!.toLowerCase()
  const want = { meta: false, ctrl: false, shift: false, alt: false }
  for (const p of parts.map((p) => p.toLowerCase())) {
    if (p === 'mod') want[mac ? 'meta' : 'ctrl'] = true
    else if (p === 'ctrl') want.ctrl = true
    else if (p === 'cmd' || p === 'meta') want.meta = true
    else if (p === 'shift' || p === 'alt') want[p] = true
  }
  if (e.metaKey !== want.meta || e.ctrlKey !== want.ctrl || e.shiftKey !== want.shift || e.altKey !== want.alt) return false
  const k = e.key.toLowerCase(), code = /^(?:Key|Digit)(.)$/.exec(e.code ?? '')?.[1].toLowerCase()
  return k === key || code === key || ALIAS[key] === k
}
// shortcuts with a modifier (Mod+S, Mod+Enter, Mod+1…) still fire from text fields; bare keys don't
export const isGlobal = (keys: string) => /(^|\+)(mod|ctrl|cmd|meta|alt)\+/i.test(keys)

const call = (f: (() => boolean) | undefined, dflt: boolean) => {
  try {
    return f ? !!f() : dflt
  } catch {
    return false
  }
}
// later registrations win; with focus in a text field the native edit items are always available
export function stateOf(sources: Command[][], text: boolean): MenuState {
  const s: MenuState = {}
  for (const cmds of sources) for (const c of cmds) s[c.id] = c.checked ? { enabled: call(c.enabled, true), checked: call(c.checked, false) } : { enabled: call(c.enabled, true) }
  if (text) for (const id in NATIVE) s[id] = { enabled: true }
  return s
}
export function sameState(a: MenuState, b: MenuState) {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((id) => b[id] && a[id].enabled === b[id].enabled && a[id].checked === b[id].checked)
}

// ---- runtime (DOM) ----
const sources: { cmds: Command[] }[] = []
function find(id: string) {
  for (let i = sources.length - 1; i >= 0; i--) {
    const c = sources[i].cmds.find((c) => c.id === id)
    if (c) return c
  }
}
export function runCommand(id: string): boolean {
  const i = id.indexOf(':'), c = find(id) ?? (i > 0 ? find(id.slice(0, i)) : undefined)
  if (!c || !call(c.enabled, true)) return false
  c.run(i > 0 && c.id !== id ? id.slice(i + 1) : undefined)
  schedule()
  return true
}

const TEXT = 'textarea,select,.cm-editor,[contenteditable]:not([contenteditable="false"]),input:not([type=checkbox],[type=radio],[type=button],[type=submit],[type=range],[type=color])'
const inText = (el: EventTarget | Element | null) => !!(el as Element | null)?.closest?.(TEXT)

function onKey(e: KeyboardEvent) {
  const t = e.target as Element | null
  if (t?.closest?.('[aria-modal="true"]')) return // the open dialog owns its keys
  const text = inText(t)
  for (let i = sources.length - 1; i >= 0; i--)
    for (const c of sources[i].cmds) {
      if (!c.keys || !matches(c.keys, e) || (text && !isGlobal(c.keys))) continue
      e.preventDefault(), e.stopPropagation() // capture: beats CodeMirror's Mod-Enter and the canvas' own keys
      if (!e.repeat && call(c.enabled, true)) c.run(), schedule()
      return
    }
}

// menu click from main. accel: the native menu fired its own registered accelerator (only the native-edit items have
// one): the renderer already saw that key, so only text fields need the native op.
function onMenu(id: string, accel: boolean) {
  if (NATIVE[id] && inText(document.activeElement)) return window.api.menu.native(NATIVE[id])
  if (!accel) runCommand(id)
}

let last: MenuState | null = null, timer: ReturnType<typeof setTimeout> | undefined
function push() {
  const s = stateOf(sources.map((x) => x.cmds), inText(document.activeElement))
  if (last && sameState(last, s)) return
  last = s
  window.api.menu.setState(s)
}
// ponytail: recompute after any registrant render and any user input; a 40 ms debounce keeps drags cheap
function schedule() {
  if (typeof window === 'undefined') return
  clearTimeout(timer)
  timer = setTimeout(push, 40)
}

let installed = false
function install() {
  if (installed) return
  installed = true
  window.addEventListener('keydown', onKey, true)
  for (const ev of ['keyup', 'pointerup', 'focusin', 'focusout']) window.addEventListener(ev, schedule, true)
  window.api.menu.onCommand(({ id, accel }) => onMenu(id, accel))
}

// Registers cmds while mounted; always runs the latest closures (pass [] to register nothing, e.g. inactive views).
export function useCommands(cmds: Command[]): void {
  const src = useRef({ cmds })
  src.current.cmds = cmds
  useEffect(() => {
    install()
    const s = src.current
    sources.push(s)
    return () => void (sources.splice(sources.indexOf(s), 1), schedule())
  }, [])
  useEffect(schedule)
}
