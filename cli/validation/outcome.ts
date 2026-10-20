import type { Termination } from '../../src/schema/trace.ts'
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
export function resolveTaskResult(verify: VerifyResult | null): TaskResult {
  if (!verify || verify.total <= 0) return { status: 'unknown' }
  return {
    status: verify.failed === 0 && verify.passed > 0 ? 'pass' : 'fail',
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
