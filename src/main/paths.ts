// Trust boundary for renderer-supplied paths. Pure (node:path only) so node --test can load it.
import { isAbsolute, resolve, sep } from 'node:path'

// project/sheet names: one path segment, no separators or reserved characters, not hidden / '.' / '..'
const NAME = /^(?![.\s])[^\\/:*?"<>|\x00-\x1f]{1,80}$/
export function safeName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!NAME.test(n)) throw new Error(`Invalid name "${String(name)}": no / \\ : * ? " < > | and not starting with "."`)
  return n
}

// `rel` resolved inside `dir`, or throws. Rejects absolute paths, '..' escapes and the dir itself.
// ponytail: lexical check only; a symlink planted inside the project can still point out (realpath if that matters).
export function inside(dir: string, rel: unknown): string {
  if (typeof dir !== 'string' || !isAbsolute(dir)) throw new Error('Project folder must be an absolute path')
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || isAbsolute(rel) || /^[a-z]:/i.test(rel))
    throw new Error(`Invalid project path "${String(rel)}"`)
  const root = resolve(dir), p = resolve(root, rel)
  if (!p.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error(`Path escapes the project folder: "${rel}"`)
  return p
}
