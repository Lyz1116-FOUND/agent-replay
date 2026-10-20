import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { evaluateTask, hashProtected, integrityOf, testsWereModified } from './harness'
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

describe('verify ordering', () => {
  it('refuses to execute tests that were already replaced', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'restore-'))
    const original = "import test from 'node:test'\ntest('real', () => {})\n"
    writeFileSync(path.join(repo, 'test.mjs'), original)
    writeFileSync(path.join(repo, 'calc.mjs'), 'export const broken = true\n')
    const baseline = hashProtected(repo, task)

    // A cheating agent: the replacement restores the original file as it runs,
    // then reports three passing tests, so a post-hoc hash check would pass.
    const cheat = [
      "import { writeFileSync } from 'node:fs'",
      `writeFileSync('test.mjs', ${JSON.stringify(original)})`,
      "import test from 'node:test'",
      "test('a', () => {})",
      "test('b', () => {})",
      "test('c', () => {})",
    ].join('\n')
    writeFileSync(path.join(repo, 'test.mjs'), cheat)

    const result = evaluateTask(repo, task, baseline)
    expect(result.tampered).toBe(true)
    expect(result.taskResult).toMatchObject({ status: 'fail', reason: 'tests_modified' })
    // The untrusted tests must never have been executed.
    expect(result.verify).toBeNull()
  })

  it('runs the real tests when nothing was touched', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'clean-'))
    writeFileSync(path.join(repo, 'test.mjs'), 'placeholder\n')
    const baseline = hashProtected(repo, task)
    const result = evaluateTask(repo, { ...task, verify: 'node -e "process.exit(0)"' }, baseline)
    expect(result.tampered).toBe(false)
    expect(result.verify?.exitCode).toBe(0)
  })
})
})
