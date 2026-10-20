import type { Trace } from '../../src/schema/trace.ts'
import type {
  AgentSummary,
  Availability,
  CaptureIntegritySummary,
  LatencyStats,
  RunRecord,
  TaskResult,
  ValidationSummary,
} from './types.ts'

/** Kinds where the model never got a fair attempt at the task. */
export const UNAVAILABLE_KINDS = new Set([
  'provider_unavailable',
  'rate_limited',
  'permission_denied',
  'recorder_error',
])

export function isUnavailable(kind: string | undefined): boolean {
  return kind !== undefined && UNAVAILABLE_KINDS.has(kind)
}

/**
 * Task outcome comes from the task's own tests, never from how the process
 * ended. A run whose tests passed and whose socket then died is still a pass.
 */
export function taskResultOf(trace: Pick<Trace, 'result'>): TaskResult {
  const tests = trace.result.tests
  if (!tests || tests.total <= 0) return { status: 'unknown' }
  return {
    status: tests.failed === 0 && tests.passed > 0 ? 'pass' : 'fail',
    passedTests: tests.passed,
    totalTests: tests.total,
  }
}

export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  const weight = position - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

export function latencyStats(values: number[]): LatencyStats | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return {
    count: values.length,
    minMs: sorted[0],
    p25Ms: Math.round(percentile(values, 0.25) ?? sorted[0]),
    medianMs: Math.round(percentile(values, 0.5) ?? sorted[0]),
    p75Ms: Math.round(percentile(values, 0.75) ?? sorted[0]),
    maxMs: sorted[sorted.length - 1],
  }
}

export function emptyIntegrity(): CaptureIntegritySummary {
  return {
    nativeEditEvents: 0,
    workspaceEditEvents: 0,
    matchedEdits: 0,
    confirmedEdits: 0,
    supersededEdits: 0,
    unverifiedEdits: 0,
    outsideWorkspaceEdits: 0,
    nativeTestRuns: 0,
    capturedTestRuns: 0,
  }
}

export function sumIntegrity(runs: RunRecord[]): CaptureIntegritySummary {
  const total = emptyIntegrity()
  for (const run of runs) {
    const integrity = run.integrity
    if (!integrity) continue
    total.nativeEditEvents += integrity.nativeEditEvents
    total.workspaceEditEvents += integrity.workspaceEditEvents
    total.matchedEdits += integrity.matchedEdits
    total.confirmedEdits += integrity.confirmedEdits
    total.supersededEdits += integrity.supersededEdits
    total.unverifiedEdits += integrity.unverifiedEdits
    total.outsideWorkspaceEdits += integrity.outsideWorkspaceEdits
    total.nativeTestRuns += integrity.nativeTestRuns
    total.capturedTestRuns += integrity.capturedTestRuns
  }
  // Denominator is every native edit event, including the ones the workspace
  // could not corroborate. Undefined when the agent reported no edits at all.
  total.editConfirmationRecall =
    total.nativeEditEvents > 0
      ? round3(total.confirmedEdits / total.nativeEditEvents)
      : undefined
  total.testCaptureRecall =
    total.nativeTestRuns > 0 ? round3(total.capturedTestRuns / total.nativeTestRuns) : undefined
  return total
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function summarizeAgent(runs: RunRecord[], availability: Availability): AgentSummary {
  const unavailable = runs.filter((run) => isUnavailable(run.termination.kind))
  const attempted = runs.filter((run) => !isUnavailable(run.termination.kind))
  const taskPass = attempted.filter((run) => run.taskResult.status === 'pass')
  const taskFail = attempted.filter((run) => run.taskResult.status === 'fail')
  const taskUnknown = attempted.filter((run) => run.taskResult.status === 'unknown')
  const completed = runs.filter(
    (run) => run.termination.kind === 'completed' && run.taskResult.status === 'pass',
  )

  return {
    availability,
    runs: runs.length,
    attempted: attempted.length,
    taskPass: taskPass.length,
    taskFail: taskFail.length,
    taskUnknown: taskUnknown.length,
    unavailable: unavailable.length,
    agentError: runs.filter((run) => run.termination.kind === 'agent_error').length,
    passRate: attempted.length > 0 ? round3(taskPass.length / attempted.length) : null,
    captureIntegrity: sumIntegrity(runs),
    // Every run, including the ones that never reached the model.
    allRunsWallClock: latencyStats(runs.map((run) => run.elapsedMs)),
    // Only runs that actually solved the task, whatever happened afterwards.
    successfulTaskLatency: latencyStats(taskPass.map((run) => run.elapsedMs)),
    // Runs that solved the task and ended cleanly; the fairest speed signal.
    completedAgentLatency: latencyStats(completed.map((run) => run.elapsedMs)),
  }
}

export function summarize(
  runs: RunRecord[],
  availability: Record<string, Availability>,
  now: Date = new Date(),
): ValidationSummary {
  const agents = [...new Set(runs.map((run) => run.agent))].sort()
  const perAgent: Record<string, AgentSummary> = {}
  for (const agent of agents) {
    perAgent[agent] = summarizeAgent(
      runs.filter((run) => run.agent === agent),
      availability[agent] ?? { status: 'ready' },
    )
  }

  return {
    generatedAt: now.toISOString(),
    runs: runs.length,
    tasks: [...new Set(runs.map((run) => run.task))].sort(),
    agents,
    totals: {
      runs: runs.length,
      taskPass: runs.filter((r) => !isUnavailable(r.termination.kind) && r.taskResult.status === 'pass')
        .length,
      taskFail: runs.filter((r) => !isUnavailable(r.termination.kind) && r.taskResult.status === 'fail')
        .length,
      taskUnknown: runs.filter(
        (r) => !isUnavailable(r.termination.kind) && r.taskResult.status === 'unknown',
      ).length,
      unavailable: runs.filter((r) => isUnavailable(r.termination.kind)).length,
      agentError: runs.filter((r) => r.termination.kind === 'agent_error').length,
    },
    perAgent,
    availability,
  }
}
