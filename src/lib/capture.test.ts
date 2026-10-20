import { describe, expect, it } from 'vitest'
import { captureInfo, terminationLabel } from './capture'
import { traceSchema, type Trace } from '../schema/trace'

const base: Trace = traceSchema.parse({
  schemaVersion: 'agent-replay/v1',
  id: 'rec_test',
  task: { id: 't', title: 't' },
  agent: { name: 'OpenCode' },
  status: 'fail',
  startedAt: '2026-10-20T10:00:00.000Z',
  endedAt: '2026-10-20T10:00:01.000Z',
  durationMs: 1000,
  result: { summary: 'failed' },
  capture: {
    fidelity: 'native+workspace',
    timing: 'observed',
    workspaceVerified: 3,
    unverifiedEdits: 0,
    integrity: {
      nativeEdits: 3,
      workspaceEdits: 3,
      matchedEdits: 3,
      unverifiedEdits: 0,
      outsideWorkspaceEdits: 0,
      nativeTestRuns: 2,
      parsedTestRuns: 2,
      capturedTests: 2,
    },
  },
  spans: [
    { id: 'a', type: 'final', name: 'Done', startMs: 0, endMs: 10, status: 'ok' },
  ],
})

describe('capture presentation', () => {
  it('shows capture integrity recall next to fidelity', () => {
    const info = captureInfo(base)
    expect(info?.sourceLine).toContain('edit recall 3/3')
    expect(info?.sourceLine).toContain('test recall 2/2')
  })

  it('labels an unavailable provider instead of a plain failure', () => {
    expect(
      terminationLabel({ kind: 'provider_unavailable', message: 'nope', code: 403 }),
    ).toBe('UNAVAILABLE')
    expect(terminationLabel({ kind: 'rate_limited' })).toBe('RATE LIMITED')
  })

  it('leaves ordinary task outcomes alone', () => {
    expect(terminationLabel({ kind: 'completed' })).toBeNull()
    expect(terminationLabel({ kind: 'task_failure' })).toBeNull()
    expect(terminationLabel(undefined)).toBeNull()
  })
})
