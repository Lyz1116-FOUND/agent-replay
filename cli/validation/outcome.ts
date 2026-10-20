import type { Termination, Trace } from '../../src/schema/trace.ts'
import type { TaskResult } from './types.ts'

export type VerifyResult = {
  command: string
  exitCode: number | null
  passed: number
  failed: number
  total: number
}

export type EndReason = {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  spawnError?: string
}

/**
 * The task is judged by running the task's own command in the final worktree.
 * Whatever the agent claimed — and whatever its stream said — is evidence, not
 * the verdict.
 */
export function resolveTaskResult(verify: VerifyResult | null, testsModified = false): TaskResult {
  if (!verify || verify.total <= 0) return { status: 'unknown' }
  if (testsModified) {
    return {
      status: 'fail',
      reason: 'tests_modified',
      passedTests: verify.passed,
      totalTests: verify.total,
    }
  }
  // A green summary is not enough: the command itself must have succeeded.
  const green = verify.exitCode === 0 && verify.failed === 0 && verify.passed > 0
  return {
    status: green ? 'pass' : 'fail',
    passedTests: verify.passed,
    totalTests: verify.total,
  }
}

/**
 * How the run ended, independent of whether the task was solved. A timeout on a
 * green tree is still a timeout; a provider 403 from the trace outranks the
 * exit code because it says *why* the process stopped.
 */
export function resolveTermination(trace: Termination | undefined, end: EndReason): Termination {
  if (end.timedOut) {
    return { kind: 'timeout', message: 'run exceeded the harness timeout' }
  }
  if (trace && trace.kind !== 'completed') return trace
  if (end.spawnError) {
    return { kind: 'recorder_error', message: end.spawnError }
  }
  if (end.signal) {
    return { kind: 'agent_error', message: `terminated by signal ${end.signal}` }
  }
  if (end.exitCode !== null && end.exitCode !== 0) {
    return { kind: 'task_failure', message: `command exited with code ${end.exitCode}` }
  }
  if (!trace) {
    return { kind: 'recorder_error', message: 'no trace was produced' }
  }
  return trace
}

/** Every attempt keeps its own evidence file; a retry must not overwrite it. */
export function traceFileName(task: string, agent: string, run: number, attempt: number): string {
  return `${task}-${agent}-${run}-a${attempt}.trace.json`
}

/**
 * The saved trace must agree with the ledger about how the run ended. The
 * recorder cannot know it was killed, so the harness rewrites that one field
 * and leaves the rest of the artifact untouched.
 */
export function finalizeTrace(
  trace: Trace,
  termination: Termination,
  meta: { attempt: number; end: EndReason },
): Trace {
  return {
    ...trace,
    termination,
    metadata: {
      ...(trace.metadata ?? {}),
      harness: {
        attempt: meta.attempt,
        exitCode: meta.end.exitCode,
        signal: meta.end.signal,
        timedOut: meta.end.timedOut,
      },
    },
  }
}
