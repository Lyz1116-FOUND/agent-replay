import { describe, expect, it } from 'vitest'
import { appendRun, latestPerKey, mergeAvailability, nextAttempt } from './ledger'
import type { RunRecord } from './types'

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    task: 't',
    taskKind: 'bug',
    agent: 'opencode',
    run: 1,
    attempt: 1,
    timedOut: false,
    elapsedMs: 1_000,
    exit: 0,
    taskResult: { status: 'pass', passedTests: 3, totalTests: 3 },
    termination: { kind: 'completed' },
    verify: { command: 'node --test', exitCode: 0, passed: 3, failed: 0, total: 3 },
    end: { exitCode: 0, signal: null, timedOut: false },
    integrity: null,
    filesChanged: [],
    recovery: null,
    fidelity: null,
    environment: null,
    trace: null,
    ...overrides,
  }
}

describe('ledger', () => {
  it('appends a retry as a new attempt instead of overwriting', () => {
    const first = record({ elapsedMs: 60_000, termination: { kind: 'agent_error' } })
    const ledger = appendRun([], first)
    expect(nextAttempt(ledger, first)).toBe(2)

    const retry = record({ elapsedMs: 30_000 })
    const updated = appendRun(ledger, retry)
    expect(updated).toHaveLength(2)
    expect(updated.map((item) => item.attempt)).toEqual([1, 2])
  })

  it('aggregates only the latest attempt per task/agent/run', () => {
    const ledger = appendRun(
      appendRun([], record({ elapsedMs: 60_000, termination: { kind: 'agent_error' } })),
      record({ elapsedMs: 30_000 }),
    )
    const latest = latestPerKey(ledger)
    expect(latest).toHaveLength(1)
    expect(latest[0].attempt).toBe(2)
    expect(latest[0].elapsedMs).toBe(30_000)
  })

  it('keeps attempts of different runs apart', () => {
    const ledger = appendRun(appendRun([], record({ run: 1 })), record({ run: 2 }))
    expect(latestPerKey(ledger)).toHaveLength(2)
    expect(appendRun(ledger, record({ run: 1 })).at(-1)?.attempt).toBe(2)
  })

  it('never drops an agent from the availability map when a later run skips it', () => {
    const merged = mergeAvailability(
      { cursor: { status: 'login_required', detail: 'run cursor-agent login' } },
      { opencode: { status: 'ready' } },
    )
    expect(merged.cursor.status).toBe('login_required')
    expect(merged.opencode.status).toBe('ready')
  })
})
