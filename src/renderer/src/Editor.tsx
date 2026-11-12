import { useEffect, useRef } from 'react'
import { Compartment } from '@codemirror/state'
import { EditorView, basicSetup } from 'codemirror'
import { StreamLanguage } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { useDark } from './Preferences'

// Minimal SPICE highlighter: comments, dot-directives, element names, numbers w/ SI suffixes.
const spice = StreamLanguage.define<{ control: boolean }>({
  startState: () => ({ control: false }),
  token(stream, state) {
    if (stream.sol()) {
      if (stream.match(/^\s*\*.*/)) return 'comment'
      if (stream.match(/^\s*\+/)) return 'operator'
      if (stream.match(/^\s*\.control\b/i)) return (state.control = true), 'keyword'
      if (stream.match(/^\s*\.endc\b/i)) return (state.control = false), 'keyword'
      if (stream.match(/^\s*\.\w+/)) return 'keyword'
      if (stream.match(/^\s*[a-z]\w*/i)) return state.control ? 'keyword' : 'def'
    }
    if (stream.eatSpace()) return null
    if (stream.match(/^[;$].*/)) return 'comment'
    if (stream.match(/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?[a-z]*/i)) return 'number'
    if (stream.match(/^"[^"]*"?/)) return 'string'
    if (stream.match(/^[{}()=,]/)) return 'bracket'
    if (!stream.match(/^[^\s;$(){}=,"]+/)) stream.next()
    return null
  }
})

export function Editor({ initial, onChange }: { initial: string; onChange: (s: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef(onChange)
  cb.current = onChange
  const dark = useDark(), theme = useRef(new Compartment()), view = useRef<EditorView | null>(null)

  useEffect(() => {
    const v = new EditorView({
      doc: initial,
      parent: host.current!,
      extensions: [
        basicSetup,
        spice,
        theme.current.of(dark ? oneDark : []),
        EditorView.theme({ '&': { height: '100%' }, '&.cm-focused': { outline: 'none' }, '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: 'var(--editor-font, inherit)' } }),
        EditorView.updateListener.of((u) => u.docChanged && cb.current(u.state.doc.toString()))
      ]
    })
    view.current = v
    return () => v.destroy()
  }, [initial]) // remounts only when a file is loaded (new `initial`)
  useEffect(() => view.current?.dispatch({ effects: theme.current.reconfigure(dark ? oneDark : []) }), [dark])

  return <div ref={host} className="editor" />
}
