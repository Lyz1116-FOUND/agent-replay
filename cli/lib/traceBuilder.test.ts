import { describe, expect, it } from 'vitest'
import { traceSchema } from '../../src/schema/trace'
import { buildTrace } from './traceBuilder'
import type { CommandEvent, EditEvent, SessionMeta } from './types'
import type { AgentEvent } from '../adapters/types'

const meta: SessionMeta = {
  version: 1,
  id: 'rec_test',
  name: 'recorded-demo',
  cwd: '/repo',
  repoRoot: '/repo',
  repo: 'demo',
  baseCommit: 'abc1234',
  initialStatus: '',
  startedAt: '2026-10-20T10:00:00.000Z',
  startedAtMs: 1_000_000,
  agent: 'Demo Agent',
  command: 'demo-agent',
  outputDir: 'replays',
  tracePath: '/repo/replays/recorded-demo.trace.json',
}

const edit = (path: string, atMs: number): EditEvent => ({
  kind: 'edit',
  atMs,
  batch: 'batch-1',
  path,
  before: 'old\n',
  after: 'new\n',
  hashBefore: 'a',
  hashAfter: 'b',
  operation: 'modify',
  truncated: false,
})

const command = (
  start: number,
  end: number,
  passed: number,
  failed: number,
): CommandEvent => ({
  kind: 'command',
  atMs: start,
  endMs: end,
  command: 'node --test',
  displayCommand: 'node --test',
  cwd: '/repo',
  exitCode: failed > 0 ? 1 : 0,
  stdout: failed > 0 ? '1 failed, 1 passed in 0.1s' : '2 passed in 0.1s',
  stderr: '',
  spanType: 'test',
  test: { passed, failed, total: passed + failed, failedTests: [], framework: 'node:test' },
  detectedFromOutput: false,
})

describe('recorded trace builder', () => {
  it('builds a schema-valid trace with grouped edits and recovered tests', () => {
    const trace = buildTrace({
      meta,
      events: [command(500, 800, 1, 1), edit('src/a.ts', 1000), edit('src/b.ts', 1050), command(1500, 1800, 2, 0)],
      baseline: { contents: {} },
      git: {
        available: true,
        head: 'abc1234',
        statusShort: ' M src/a.ts',
        diffStat: ' 2 files changed, 2 insertions(+), 2 deletions(-)',
        patch: 'diff --git a/src/a.ts b/src/a.ts',
      },
      nowMs: 1_005_000,
    })

    expect(() => traceSchema.parse(trace)).not.toThrow()
    expect(trace.status).toBe('pass')
    expect(trace.result.tests).toEqual({ passed: 2, failed: 0, total: 2 })
    expect(trace.result.filesChanged).toEqual(['src/a.ts', 'src/b.ts'])
    expect(trace.metadata?.recoveryDetected).toBe(true)
    expect(trace.capture).toMatchObject({ fidelity: 'wrapped-output', timing: 'observed' })
    expect(trace.spans.map((span) => span.type)).toEqual([
      'checkpoint',
      'test',
      'edit',
      'test',
      'checkpoint',
      'final',
    ])
    const editSpan = trace.spans.find((span) => span.type === 'edit')
    expect(editSpan?.files).toEqual(['src/a.ts', 'src/b.ts'])
    expect(editSpan?.artifacts).toHaveLength(2)
    const final = trace.spans[trace.spans.length - 1]
    expect(final.endMs).toBeLessThanOrEqual(trace.durationMs)
  })

  it('marks an unrecovered run as failed', () => {
    const trace = buildTrace({
      meta,
      events: [command(500, 900, 1, 2)],
      baseline: { contents: {} },
      git: { available: true, statusShort: '', diffStat: '', patch: 'diff --git a/x b/x' },
      commandExitCode: 1,
      nowMs: 1_003_000,
    })
    expect(trace.status).toBe('fail')
    expect(trace.result.tests?.failed).toBe(2)
    expect(trace.spans.at(-1)?.status).toBe('error')
    expect(() => traceSchema.parse(trace)).not.toThrow()
  })

  it('marks wrapped output even when no semantic events were parsed', () => {
    const trace = buildTrace({
      meta,
      events: [],
      baseline: { contents: {} },
      git: { available: true, statusShort: '', diffStat: '', patch: '' },
      wrappedOutput: true,
      nowMs: 1_001_000,
    })
    expect(trace.capture).toMatchObject({ fidelity: 'wrapped-output', timing: 'observed' })
    expect(trace.status).toBe('partial')
    expect(() => traceSchema.parse(trace)).not.toThrow()
  })

  it('handles a session with no tests', () => {
    const trace = buildTrace({
      meta,
      events: [edit('src/a.ts', 700)],
      baseline: { contents: {} },
      git: { available: true, statusShort: '', diffStat: '', patch: '' },
      nowMs: 1_002_000,
    })
    expect(trace.status).toBe('partial')
    expect(trace.capture).toMatchObject({ fidelity: 'workspace', timing: 'observed' })
    expect(trace.result.tests).toBeUndefined()
    expect(trace.spans.some((span) => span.type === 'final')).toBe(true)
    expect(() => traceSchema.parse(trace)).not.toThrow()
  })

  it('separates a provider outage from a failed task', () => {
    const providerError: AgentEvent = {
      kind: 'error',
      atMs: 400,
      message: 'This model is not available in your country (HTTP 403)',
      termination: 'provider_unavailable',
      code: 403,
    }
    const trace = buildTrace({
      meta,
      events: [],
      agentEvents: [providerError],
      baseline: { contents: {} },
      git: { available: true, statusShort: '', diffStat: '', patch: '' },
      commandExitCode: 1,
      nowMs: 1_002_000,
    })
    expect(trace.status).toBe('fail')
    expect(trace.termination).toEqual({
      kind: 'provider_unavailable',
      message: 'This model is not available in your country (HTTP 403)',
      code: 403,
    })
    expect(() => traceSchema.parse(trace)).not.toThrow()
  })

  it('reports completed and task_failure without touching status semantics', () => {
    const passing = buildTrace({
      meta,
      events: [command(500, 800, 2, 0)],
      baseline: { contents: {} },
      git: { available: true, statusShort: '', diffStat: '', patch: '' },
      nowMs: 1_002_000,
    })
    expect(passing.status).toBe('pass')
    expect(passing.termination).toEqual({ kind: 'completed' })

    const failing = buildTrace({
      meta,
      events: [command(500, 900, 1, 2)],
      baseline: { contents: {} },
      git: { available: true, statusShort: '', diffStat: '', patch: '' },
      commandExitCode: 1,
      nowMs: 1_003_000,
    })
    expect(failing.status).toBe('fail')
    expect(failing.termination?.kind).toBe('task_failure')
  })

  it('records capture integrity alongside fidelity', () => {
    const trace = buildTrace({
      meta,
      events: [edit('src/a.ts', 1000), command(1500, 1800, 2, 0)],
      baseline: { contents: {} },
      git: { available: true, statusShort: '', diffStat: '', patch: '' },
      nowMs: 1_004_000,
    })
    expect(trace.capture?.integrity).toMatchObject({
      nativeEdits: 0,
      workspaceEdits: 1,
      matchedEdits: 0,
      unverifiedEdits: 0,
      outsideWorkspaceEdits: 0,
      nativeTestRuns: 0,
      parsedTestRuns: 0,
      capturedTests: 1,
    })
    expect(trace.environment?.nodeVersion).toBe(process.version)
    expect(() => traceSchema.parse(trace)).not.toThrow()
  })
})
