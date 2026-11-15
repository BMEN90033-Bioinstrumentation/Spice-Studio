// Bottom-right card for a pending update (main/updater.ts): Download -> progress -> Restart to update.
import { useEffect, useState } from 'react'
import { CircleArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UpdateStatus } from '../../main/updater'

// opens in the browser (main's window-open handler)
const RELEASES = 'https://github.com/BMEN90033-Bioinstrumentation/Spice-Studio/releases/latest'

// guard: asks about unsaved work before the app restarts (main.tsx `leaving`)
export function UpdateCard({ guard }: { guard: (then: () => void) => void }) {
  const [s, setS] = useState<UpdateStatus>({ state: 'idle' })
  const [later, setLater] = useState(false) // dismissed until the next launch
  useEffect(() => {
    const off = window.api.update.onStatus(setS)
    void window.api.update.check() // asked from here, so the answer can't arrive before the listener
    return off
  }, [])
  if (s.state === 'idle' || later) return null
  const v = `Version ${s.version}`
  return (
    <div role="status" className="fixed right-4 bottom-4 z-50 w-[22rem] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg">
      <div className="flex items-start gap-3">
        <CircleArrowUp className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{s.state === 'error' ? 'Update failed' : 'Update available'}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {s.state === 'available' && `${v} is available.`}
            {s.state === 'downloading' && `Downloading ${v.toLowerCase()}… ${Math.round(s.percent ?? 0)}%`}
            {s.state === 'downloaded' && `${v} is ready to install.`}
            {s.state === 'error' && `${v} couldn't be installed automatically. Download it from the releases page.`}
          </p>
        </div>
      </div>
      {s.state === 'downloading' && (
        <div role="progressbar" aria-valuenow={Math.round(s.percent ?? 0)} aria-valuemin={0} aria-valuemax={100} className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${s.percent ?? 0}%` }} />
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {s.state === 'downloaded' ? (
          <Button size="sm" onClick={() => guard(() => void window.api.update.install())}>Restart to update</Button>
        ) : s.manual || s.state === 'error' ? (
          <Button size="sm" onClick={() => window.open(RELEASES)}>Download</Button>
        ) : (
          <Button size="sm" disabled={s.state === 'downloading'} onClick={() => void window.api.update.download()}>Download</Button>
        )}
        {!s.manual && s.state !== 'error' && <Button size="sm" variant="outline" onClick={() => window.open(RELEASES)}>Release notes</Button>}
        <Button size="sm" variant="ghost" onClick={() => setLater(true)}>Later</Button>
      </div>
    </div>
  )
}
