import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sanitizeTrace } from './sanitize'
import { normalizeEol } from './fsutil'
import { diffArtifact, patchArtifact } from './artifacts'
import { cleanupIsolation } from '../validation/harness'

describe('trace sanitization', () => {
  it('rewrites home-directory paths to ~ in every nested string', () => {
    const trace = {
      task: { title: 't' },
      spans: [
        {
          name: 'Read config',
          artifacts: [{ kind: 'terminal', output: 'cat /Users/alice/.codex/skills/x' }],
        },
      ],
      environment: { cwdRealpath: '/Users/alice/work/demo' },
    }
    const clean = sanitizeTrace(trace, '/Users/alice')
    expect(clean.spans[0].artifacts[0].output).toBe('cat ~/.codex/skills/x')
    expect(clean.environment.cwdRealpath).toBe('~/work/demo')
  })

  it('leaves paths outside the home directory alone', () => {
    const clean = sanitizeTrace({ cwd: '/private/tmp/probe' }, '/Users/alice')
    expect(clean.cwd).toBe('/private/tmp/probe')
  })
})

describe('line endings', () => {
  it('normalizes CRLF so diffs render without stray carriage returns', () => {
    expect(normalizeEol('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('stores diff and patch artifacts with LF endings', () => {
    const diff = diffArtifact('a.mjs', 'one\r\ntwo\r\n', 'one\r\nthree\r\n')
    expect(diff).toMatchObject({ before: 'one\ntwo\n', after: 'one\nthree\n' })
    const patch = patchArtifact('+one\r\n-two\r\n')
    expect(patch.kind === 'patch' && patch.diff).toBe('+one\n-two\n')
  })
})

describe('isolation cleanup', () => {
  it('removes the XDG sandbox after a run', () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'iso-')), 'data')
    mkdirSync(dir, { recursive: true })
    expect(existsSync(dir)).toBe(true)
    cleanupIsolation(dir)
    expect(existsSync(dir)).toBe(false)
  })

  it('tolerates a missing directory', () => {
    expect(() => cleanupIsolation('/private/tmp/does-not-exist-iso')).not.toThrow()
  })
})
