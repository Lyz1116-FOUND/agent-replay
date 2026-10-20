import { mkdtempSync, rmSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { reconcileEdits } from './workspace'
import { readEvents } from './session'
import type { SessionMeta } from './types'

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
}

describe('workspace reconciliation', () => {
  it('records delete, rename, and modify operations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-replay-workspace-'))
    try {
      git(dir, ['init', '-q'])
      git(dir, ['config', 'user.email', 'dev@example.com'])
      git(dir, ['config', 'user.name', 'Dev'])
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src/old.ts'), 'export const old = 1\n')
      writeFileSync(join(dir, 'src/config-old.ts'), 'export const config = 1\n')
      writeFileSync(join(dir, 'src/keep.ts'), 'export const keep = 1\n')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-qm', 'initial'])

      unlinkSync(join(dir, 'src/old.ts'))
      git(dir, ['mv', 'src/config-old.ts', 'src/config.ts'])
      writeFileSync(join(dir, 'src/keep.ts'), 'export const keep = 2\n')

      const meta: SessionMeta = {
        version: 1,
        id: 'rec_fileops',
        name: 'fileops',
        cwd: dir,
        repoRoot: dir,
        repo: 'demo',
        baseCommit: 'abc1234',
        initialStatus: '',
        startedAt: new Date().toISOString(),
        startedAtMs: Date.now(),
        agent: 'Demo Agent',
        outputDir: 'replays',
        tracePath: join(dir, 'replays/fileops.trace.json'),
      }

      const added = reconcileEdits(dir, meta, { contents: {} }, [])
      const events = readEvents(dir).filter((event) => event.kind === 'edit')
      expect(added).toBe(3)
      expect(events.map((event) => event.operation).sort()).toEqual(['delete', 'modify', 'rename'])
      const rename = events.find((event) => event.operation === 'rename')
      expect(rename).toMatchObject({ path: 'src/config.ts', fromPath: 'src/config-old.ts' })
      const deleted = events.find((event) => event.operation === 'delete')
      expect(deleted).toMatchObject({ path: 'src/old.ts', after: '' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
