import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { StreamLanguage } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'

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

  useEffect(() => {
    const view = new EditorView({
      doc: initial,
      parent: host.current!,
      extensions: [
        basicSetup,
        spice,
        oneDark,
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'var(--mono)' } }),
        EditorView.updateListener.of((u) => u.docChanged && cb.current(u.state.doc.toString()))
      ]
    })
    return () => view.destroy()
  }, [initial]) // remounts only when a file is loaded (new `initial`)

  return <div ref={host} className="editor" />
}
