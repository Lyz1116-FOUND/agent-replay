import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { isIgnoredPath, toPosix, truncate } from './fsutil'

export type GitRename = {
  from: string
  to: string
  kind: 'rename' | 'copy'
}

export type GitStatus = {
  raw: string
  files: string[]
  renames: GitRename[]
}

type GitResult = {
  ok: boolean
  stdout: string
  stderr: string
}

export function git(cwd: string, args: string[]): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trimEnd(),
    stderr: (result.stderr ?? '').trimEnd(),
  }
}

export function isGitRepo(cwd: string): boolean {
  return git(cwd, ['rev-parse', '--is-inside-work-tree']).stdout === 'true'
}

export function repoRoot(cwd: string): string | undefined {
  const result = git(cwd, ['rev-parse', '--show-toplevel'])
  return result.ok ? result.stdout : undefined
}

export function headCommit(cwd: string): string | undefined {
  const result = git(cwd, ['rev-parse', '--short', 'HEAD'])
  return result.ok ? result.stdout : undefined
}

export function repoName(cwd: string): string | undefined {
  const remote = git(cwd, ['config', '--get', 'remote.origin.url'])
  if (remote.ok && remote.stdout) {
    return remote.stdout
      .replace(/\/+$/, '')
      .split(/[/:]/)
      .pop()
      ?.replace(/\.git$/, '')
  }
  const root = repoRoot(cwd)
  return root ? path.basename(root) : undefined
}

export function statusPorcelain(cwd: string): GitStatus {
  const result = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (!result.ok) return { raw: '', files: [], renames: [] }
  const files: string[] = []
  const renames: GitRename[] = []
  const tokens = result.stdout.split('\0')
  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index]
    if (!entry) continue
    const status = entry.slice(0, 2)
    const file = entry.slice(3)
    if (!file) continue
    let original: string | undefined
    if (status[0] === 'R' || status[0] === 'C') {
      // In porcelain -z, the next token is the original path.
      original = tokens[index + 1]
      index += 1
    }
    const normalized = toPosix(file)
    if (!isIgnoredPath(normalized)) files.push(normalized)
    if (original) {
      const from = toPosix(original)
      if (!isIgnoredPath(from) && !isIgnoredPath(normalized)) {
        renames.push({ from, to: normalized, kind: status[0] === 'R' ? 'rename' : 'copy' })
      }
    }
    if (files.length >= 5000) break
  }
  return { raw: files.join('\n'), files, renames }
}

export function statusShort(cwd: string): string {
  return git(cwd, ['status', '--short']).stdout
}

export function fileAtHead(cwd: string, file: string): string {
  const result = git(cwd, ['show', `HEAD:${file}`])
  return result.ok ? result.stdout : ''
}

export function diffStat(cwd: string): string {
  const head = git(cwd, ['diff', 'HEAD', '--stat', '--no-color'])
  if (head.ok) return head.stdout
  return git(cwd, ['diff', '--stat', '--no-color']).stdout
}

export function diffPatch(cwd: string): string {
  const result = git(cwd, ['diff', 'HEAD', '--no-color', '--no-ext-diff'])
  const text = result.ok ? result.stdout : ''
  return truncate(text, 300_000).text
}

export function gitSnapshot(cwd: string) {
  return {
    available: isGitRepo(cwd),
    head: headCommit(cwd),
    statusShort: statusShort(cwd),
    diffStat: diffStat(cwd),
    patch: diffPatch(cwd),
  }
}
