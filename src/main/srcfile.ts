// A file a netlist names (PWL file= / wavefile=): regular files only, and at most `max` bytes counted while reading,
// since stat sizes can lie (/dev/zero is 0 bytes and endless; a file can grow after the stat).
import { open, stat } from 'node:fs/promises'

export async function readCapped(path: string, max: number): Promise<Uint8Array> {
  if (!(await stat(path)).isFile()) throw new Error('not a regular file')
  const fh = await open(path, 'r'), chunks: Uint8Array[] = []
  try {
    for (let total = 0; ; ) {
      const b = new Uint8Array(Math.min(max + 1 - total, 1 << 20)), n = (await fh.read(b, 0, b.length, total)).bytesRead
      if (!n) return Buffer.concat(chunks)
      chunks.push(b.subarray(0, n)), (total += n)
      if (total > max) throw new Error(`larger than ${max / 2 ** 20} MB, the limit for file sources`)
    }
  } finally {
    await fh.close()
  }
}
