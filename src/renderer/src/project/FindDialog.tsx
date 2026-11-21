// Edit › Find… (⌘F): type a reference (R2, D14) or a net label; Enter or a click opens that sheet with the part selected.
import { useState } from 'react'
import type { Hit } from './project'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const stem = (f: string) => f.replace(/\.nsch$/i, '')

export function FindDialog({ find, multi, onPick, onClose }: { find: (q: string) => Hit[]; multi: boolean /* show the sheet column */; onPick: (h: Hit) => void; onClose: () => void }) {
  const [q, setQ] = useState(''), [at, setAt] = useState(0)
  const hits = find(q), i = Math.min(at, hits.length - 1)
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation() // the canvas' own keys stay out of it
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') e.preventDefault(), setAt(Math.max(0, Math.min(hits.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))))
    else if (e.key === 'Enter' && hits[i]) onPick(hits[i])
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[20%] translate-y-0 gap-2 p-3 sm:max-w-[420px]" showCloseButton={false} onKeyDown={keys}>
        <DialogHeader className="sr-only">
          <DialogTitle>Find</DialogTitle>
          <DialogDescription>Find a part by its reference, or a net label, on any sheet.</DialogDescription>
        </DialogHeader>
        <Input autoFocus spellCheck={false} placeholder={multi ? 'Find a part or net label on any sheet: R2, D14, out…' : 'Find a part or net label: R2, D14, out…'} aria-label="Find" value={q} onChange={(e) => (setQ(e.target.value), setAt(0))} />
        {q.trim() && !hits.length && <p className="px-1 py-1 text-xs text-muted-foreground">Nothing named “{q.trim()}”.</p>}
        {hits.length > 0 && (
          <ul role="listbox" aria-label="Matches" className="max-h-[320px] overflow-y-auto">
            {hits.map((h, n) => (
              <li
                key={h.file + h.id}
                role="option"
                aria-selected={n === i}
                ref={n === i ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                className={cn('flex cursor-default items-baseline gap-2 rounded-sm px-2 py-1 text-[13px]', n === i && 'bg-accent')}
                onPointerMove={() => setAt(n)}
                onClick={() => onPick(h)}
              >
                <span className="shrink-0 font-medium">{h.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{h.detail}</span>
                {multi && <span className="shrink-0 text-xs text-muted-foreground">{stem(h.file)}</span>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
