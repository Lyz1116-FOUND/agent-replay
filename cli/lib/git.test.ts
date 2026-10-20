import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { diffPatch } from './git'

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

describe('diffPatch', () => {
  it('produces a patch git can actually apply', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'patch-'))
    git(repo, ['init', '-q'])
    git(repo, ['config', 'user.email', 'dev@example.com'])
    git(repo, ['config', 'user.name', 'Dev'])
    writeFileSync(path.join(repo, 'calc.mjs'), 'export const x = 1\n')
    git(repo, ['add', '.'])
    git(repo, ['commit', '-qm', 'init'])

    writeFileSync(path.join(repo, 'calc.mjs'), 'export const x = 2\n')
    const patch = diffPatch(repo)

    expect(patch.endsWith('\n')).toBe(true)
    // The patch must round-trip: restore the file, then apply what we captured.
    git(repo, ['checkout', '--', '.'])
    const patchFile = path.join(repo, 'change.patch')
    writeFileSync(patchFile, patch)
    const check = spawnSync('git', ['apply', '--check', patchFile], { cwd: repo, encoding: 'utf8' })
    expect(`${check.stderr ?? ''}`).toBe('')
    expect(check.status).toBe(0)
  })

  it('keeps trailing blank context lines intact', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'patch-blank-'))
    git(repo, ['init', '-q'])
    git(repo, ['config', 'user.email', 'dev@example.com'])
    git(repo, ['config', 'user.name', 'Dev'])
    // The file ends with a blank line; the diff ends with a " " context line.
    writeFileSync(path.join(repo, 'notes.txt'), 'first\n\n')
    git(repo, ['add', '.'])
    git(repo, ['commit', '-qm', 'init'])

    writeFileSync(path.join(repo, 'notes.txt'), 'second\n\n')
    const patch = diffPatch(repo)
    git(repo, ['checkout', '--', '.'])
    const patchFile = path.join(repo, 'blank.patch')
    writeFileSync(patchFile, patch)
    const check = spawnSync('git', ['apply', '--check', patchFile], { cwd: repo, encoding: 'utf8' })
    expect(`${check.stderr ?? ''}`).toBe('')
    expect(check.status).toBe(0)
  })
})
