import { describe, expect, it } from 'vitest'
import {
  emptyIntegrity,
  isUnavailable,
  latencyStats,
  percentile,
  summarize,
  summarizeAgent,
  sumIntegrity,
  taskResultOf,
} from './aggregate'
import type { CaptureIntegritySummary, RunRecord } from './types'

function run(overrides: Partial<RunRecord> & { elapsedMs: number }): RunRecord {
  return {
    task: 't',
    taskKind: 'bug',
    agent: 'opencode',
    run: 1,
    timedOut: false,
    exit: 0,
    taskResult: { status: 'pass', passedTests: 3, totalTests: 3 },
    termination: { kind: 'completed' },
    integrity: null,
    filesChanged: [],
    recovery: null,
    fidelity: null,
    environment: null,
    trace: null,
    ...overrides,
  }
}

describe('task outcome', () => {
  it('reads the outcome from the tests, not from the process', () => {
    expect(taskResultOf({ result: { tests: { passed: 3, failed: 0, total: 3 } } } as never)).toEqual({
      status: 'pass',
      passedTests: 3,
      totalTests: 3,
    })
    expect(taskResultOf({ result: { tests: { passed: 1, failed: 2, total: 3 } } } as never)).toEqual({
      status: 'fail',
      passedTests: 1,
      totalTests: 3,
    })
    expect(taskResultOf({ result: {} } as never)).toEqual({ status: 'unknown' })
  })

  it('keeps a passing task passing when the agent errors afterwards', () => {
    const summary = summarizeAgent(
      [run({ elapsedMs: 240_000, termination: { kind: 'agent_error', message: 'socket closed' } })],
      { status: 'ready' },
    )
    expect(summary.taskPass).toBe(1)
    expect(summary.taskFail).toBe(0)
    expect(summary.agentError).toBe(1)
  })

  it('treats provider outages as unavailable rather than task failures', () => {
    expect(isUnavailable('provider_unavailable')).toBe(true)
    expect(isUnavailable('rate_limited')).toBe(true)
    expect(isUnavailable('permission_denied')).toBe(true)
    expect(isUnavailable('recorder_error')).toBe(true)
    expect(isUnavailable('task_failure')).toBe(false)
    expect(isUnavailable('agent_error')).toBe(false)
  })
})

describe('latency aggregation', () => {
  it('keeps provider failures out of the successful latency median', () => {
    const runs = [
      run({ elapsedMs: 10_000 }),
      run({ elapsedMs: 20_000 }),
      run({ elapsedMs: 4_000, termination: { kind: 'provider_unavailable' }, taskResult: { status: 'unknown' } }),
    ]
    const summary = summarizeAgent(runs, { status: 'ready' })
    expect(summary.successfulTaskLatency?.medianMs).toBe(15_000)
    expect(summary.successfulTaskLatency?.count).toBe(2)
    // Every run is still visible in the wall-clock bucket.
    expect(summary.allRunsWallClock?.count).toBe(3)
    expect(summary.unavailable).toBe(1)
  })

  it('separates a clean completion from a pass that ended badly', () => {
    const runs = [
      run({ elapsedMs: 10_000 }),
      run({ elapsedMs: 240_000, termination: { kind: 'agent_error' } }),
    ]
    const summary = summarizeAgent(runs, { status: 'ready' })
    expect(summary.successfulTaskLatency?.medianMs).toBe(125_000)
    expect(summary.completedAgentLatency?.medianMs).toBe(10_000)
    expect(summary.completedAgentLatency?.count).toBe(1)
  })

  it('computes percentiles without inventing values', () => {
    expect(percentile([], 0.5)).toBeUndefined()
    expect(percentile([5], 0.5)).toBe(5)
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(latencyStats([4, 1, 3, 2])).toMatchObject({ minMs: 1, medianMs: 3, maxMs: 4 })
    expect(latencyStats([])).toBeNull()
  })
})

describe('capture integrity', () => {
  function integrity(overrides: Partial<CaptureIntegritySummary>): CaptureIntegritySummary {
    return { ...emptyIntegrity(), ...overrides }
  }

  it('separates matched, confirmed, superseded and unverified edits', () => {
    const total = sumIntegrity([
      run({
        elapsedMs: 1,
        integrity: integrity({
          nativeEditEvents: 4,
          workspaceEditEvents: 3,
          matchedEdits: 2,
          confirmedEdits: 3,
          supersededEdits: 1,
          unverifiedEdits: 1,
          outsideWorkspaceEdits: 0,
          nativeTestRuns: 2,
          capturedTestRuns: 2,
        }),
      }),
    ])
    expect(total).toMatchObject({
      nativeEditEvents: 4,
      workspaceEditEvents: 3,
      matchedEdits: 2,
      confirmedEdits: 3,
      supersededEdits: 1,
      unverifiedEdits: 1,
    })
    // Denominator is every native edit, including the unverified one.
    expect(total.editConfirmationRecall).toBe(0.75)
    expect(total.testCaptureRecall).toBe(1)
  })

  it('leaves recall undefined when there was nothing to match', () => {
    const total = sumIntegrity([run({ elapsedMs: 1, integrity: integrity({}) })])
    expect(total.editConfirmationRecall).toBeUndefined()
    expect(total.testCaptureRecall).toBeUndefined()
  })

  it('keeps an outside-workspace edit visible', () => {
    const total = sumIntegrity([
      run({ elapsedMs: 1, integrity: integrity({ nativeEditEvents: 1, outsideWorkspaceEdits: 1, unverifiedEdits: 1 }) }),
    ])
    expect(total.outsideWorkspaceEdits).toBe(1)
    expect(total.editConfirmationRecall).toBe(0)
  })
})

describe('availability', () => {
  it('records a missing CLI as availability, never as a task failure', () => {
    const summary = summarize([], { cursor: { status: 'login_required', detail: 'run cursor-agent login' } })
    expect(summary.runs).toBe(0)
    expect(summary.availability.cursor.status).toBe('login_required')
    expect(summary.totals.taskFail).toBe(0)
  })

  it('skips an agent that is not ready without failing the matrix', () => {
    const summary = summarize([run({ elapsedMs: 1 })], {
      opencode: { status: 'ready' },
      claude: { status: 'cli_missing' },
    })
    expect(summary.totals.taskPass).toBe(1)
    expect(summary.availability.claude.status).toBe('cli_missing')
    expect(summary.perAgent.claude).toBeUndefined()
  })
})
