import { homedir } from 'node:os'

/**
 * Traces are meant to be shared. Any absolute path under the user's home
 * directory is rewritten to `~/...` so a recording does not leak who made it.
 * Everything else — repo-relative paths, /tmp worktrees — is left untouched.
 */
export function sanitizeTrace<T>(value: T, home: string = homedir()): T {
  if (!home) return value
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return node.split(home).join('~')
    }
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        out[key] = walk(child)
      }
      return out
    }
    return node
  }
  return walk(value) as T
}
