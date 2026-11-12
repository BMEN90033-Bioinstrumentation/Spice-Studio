// Live results: tail the rawfile ngspice is writing (see RawTail) and hand on the new points every `ms`.
// Only the bytes appended since the last tick are read, so a long run costs O(new data) per tick.
import { open } from 'node:fs/promises'
import { RawTail, type LiveChunk } from './rawfile.ts'

export function watchRaw(path: string, onChunks: (c: LiveChunk[]) => void, ms = 250): () => Promise<void> {
  const tail = new RawTail()
  let off = 0, busy: Promise<void> | null = null
  const tick = async () => {
    const fh = await open(path, 'r').catch(() => null) // not created yet
    if (!fh) return
    try {
      const n = Math.max(0, (await fh.stat()).size - off), buf = new Uint8Array(n)
      const data = n ? buf.subarray(0, (await fh.read(buf, 0, n, off)).bytesRead) : buf
      off += data.length
      let count = 0
      if (tail.countAt >= 0) { // read AFTER the data: see RawTail
        const b = new Uint8Array(12)
        await fh.read(b, 0, 12, tail.countAt)
        count = parseInt(new TextDecoder().decode(b), 10) || 0
      }
      const c = tail.feed(data, count)
      if (c.length) onChunks(c)
    } finally {
      await fh.close()
    }
  }
  const timer = setInterval(() => void (busy ??= tick().catch(() => {}).finally(() => (busy = null))), ms)
  return async () => {
    clearInterval(timer)
    await busy
  }
}
