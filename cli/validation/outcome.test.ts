import { describe, expect, it } from 'vitest'
import { resolveTaskResult, resolveTermination } from './outcome'
import type { EndReason, VerifyResult } from './outcome'

const green: VerifyResult = { command: 'node --test', exitCode: 0, passed: 3, failed: 0, total: 3 }
const red: VerifyResult = { command: 'node --test', exitCode: 1, passed: 1, failed: 2, total: 3 }
const done: EndReason = { exitCode: 0, signal: null, timedOut: false }

describe('task outcome is decided by the worktree, not by the agent', () => {
  it('believes a failing worktree even when the trace claims success', () => {
    // The agent said it was done; the final tree still fails.
    const trace = { kind: 'completed' as const }
    expect(resolveTaskResult(red)).toEqual({ status: 'fail', passedTests: 1, totalTests: 3 })
    expect(resolveTermination(trace, done).kind).toBe('completed')
  })

  it('believes a green worktree even when the trace claims failure', () => {
    expect(resolveTaskResult(green)).toEqual({ status: 'pass', passedTests: 3, totalTests: 3 })
  })

  it('reports unknown when the trusted command could not run', () => {
    expect(resolveTaskResult(null)).toEqual({ status: 'unknown' })
  })
})

describe('end reasons are recorded separately', () => {
  it('keeps a green run green when the harness timed out', () => {
    const end: EndReason = { exitCode: null, signal: 'SIGTERM', timedOut: true }
    expect(resolveTaskResult(green).status).toBe('pass')
    expect(resolveTermination(undefined, end)).toMatchObject({ kind: 'timeout' })
  })

  it('records a signal without inventing a timeout', () => {
    const end: EndReason = { exitCode: null, signal: 'SIGKILL', timedOut: false }
    expect(resolveTermination(undefined, end)).toMatchObject({
      kind: 'agent_error',
      message: expect.stringContaining('SIGKILL'),
    })
  })

  it('records an abnormal exit code as a task failure, not a timeout', () => {
    const end: EndReason = { exitCode: 137, signal: null, timedOut: false }
    expect(resolveTermination(undefined, end)).toMatchObject({ kind: 'task_failure' })
  })

  it('keeps a provider classification from the trace over the exit code', () => {
    const end: EndReason = { exitCode: 1, signal: null, timedOut: false }
    expect(resolveTermination({ kind: 'provider_unavailable', code: 403 }, end)).toMatchObject({
      kind: 'provider_unavailable',
      code: 403,
    })
  })

  it('marks a missing trace as a recorder error', () => {
    expect(resolveTermination(undefined, { exitCode: 0, signal: null, timedOut: false })).toMatchObject({
      kind: 'recorder_error',
    })
  })
})
