import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashProtected, integrityOf, testsWereModified } from './harness'
import { traceFileName } from './outcome'
import { sumIntegrity } from './aggregate'
import type { Trace } from '../../src/schema/trace'
import type { RunRecord, ValidationTask } from './types'

const task: ValidationTask = {
  id: 'demo',
  title: 'demo',
  kind: 'bug',
  prompt: 'fix',
  verify: 'node --test',
  expectedFiles: ['calc.mjs'],
  baseline: { pass: 0, fail: 1 },
  protectedFiles: ['test.mjs'],
  dir: '/tmp/demo',
}

describe('test identity', () => {
  it('detects an agent that rewrote the tests to pass', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'tamper-'))
    writeFileSync(path.join(repo, 'test.mjs'), "import test from 'node:test'\ntest('a', () => {})\n")
    const before = hashProtected(repo, task)
    expect(testsWereModified(repo, before)).toBe(false)

    writeFileSync(path.join(repo, 'test.mjs'), "import test from 'node:test'\n")
    expect(testsWereModified(repo, before)).toBe(true)
  })

  it('ignores files that are not protected', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'tamper-'))
    writeFileSync(path.join(repo, 'test.mjs'), 'original\n')
    const before = hashProtected(repo, task)
    writeFileSync(path.join(repo, 'calc.mjs'), 'fixed\n')
    expect(testsWereModified(repo, before)).toBe(false)
  })
})

describe('capture integrity mapping', () => {
  it('does not let an extra command test inflate test recall', () => {
    const trace = {
      capture: {
        fidelity: 'native+workspace',
        timing: 'observed',
        integrity: {
          nativeEdits: 1,
          workspaceEdits: 1,
          matchedEdits: 1,
          unverifiedEdits: 0,
          outsideWorkspaceEdits: 0,
          nativeTestRuns: 1,
          parsedTestRuns: 1,
          capturedTests: 2,
        },
      },
    } as unknown as Trace

    const integrity = integrityOf(trace)!
    expect(integrity.capturedTestRuns).toBe(1)
    expect(sumIntegrity([{ integrity } as RunRecord]).testCaptureRecall).toBe(1)
  })
})

describe('evidence files', () => {
  it('keeps one trace per attempt', () => {
    expect(traceFileName('t', 'a', 1, 1)).toBe('t-a-1-a1.trace.json')
    expect(traceFileName('t', 'a', 1, 2)).not.toBe(traceFileName('t', 'a', 1, 1))
  })
})
