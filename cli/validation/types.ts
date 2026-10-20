import type { Termination } from '../../src/schema/trace.ts'

export type TaskResultStatus = 'pass' | 'fail' | 'unknown'

export type TaskResult = {
  status: TaskResultStatus
  passedTests?: number
  totalTests?: number
}

export type AvailabilityStatus = 'ready' | 'cli_missing' | 'login_required' | 'error'

export type Availability = {
  status: AvailabilityStatus
  detail?: string
}

export type ValidationTask = {
  id: string
  title: string
  kind: 'bug' | 'feature'
  prompt: string
  verify: string
  expectedFiles: string[]
  baseline: { pass: number; fail: number }
  dir: string
}

export type CaptureIntegritySummary = {
  nativeEditEvents: number
  workspaceEditEvents: number
  matchedEdits: number
  confirmedEdits: number
  supersededEdits: number
  unverifiedEdits: number
  outsideWorkspaceEdits: number
  editConfirmationRecall?: number
  nativeTestRuns: number
  capturedTestRuns: number
  testCaptureRecall?: number
}

export type RunRecord = {
  task: string
  taskKind: string
  agent: string
  run: number
  /** 1 for the first try; a retry appends instead of replacing. */
  attempt: number
  timedOut: boolean
  elapsedMs: number
  exit: number | null
  taskResult: TaskResult
  termination: Termination
  /** Trusted verdict from running the task command in the final worktree. */
  verify: import('./outcome.ts').VerifyResult | null
  end: import('./outcome.ts').EndReason
  integrity: CaptureIntegritySummary | null
  filesChanged: string[]
  recovery: boolean | null
  fidelity: string | null
  environment: Record<string, unknown> | null
  trace: string | null
}

export type LatencyStats = {
  count: number
  minMs: number
  p25Ms: number
  medianMs: number
  p75Ms: number
  maxMs: number
}

export type AgentSummary = {
  availability: Availability
  runs: number
  attempted: number
  taskPass: number
  taskFail: number
  taskUnknown: number
  unavailable: number
  agentError: number
  passRate: number | null
  captureIntegrity: CaptureIntegritySummary
  allRunsWallClock: LatencyStats | null
  successfulTaskLatency: LatencyStats | null
  completedAgentLatency: LatencyStats | null
}

export type ValidationSummary = {
  generatedAt: string
  runs: number
  tasks: string[]
  agents: string[]
  totals: {
    runs: number
    taskPass: number
    taskFail: number
    taskUnknown: number
    unavailable: number
    agentError: number
  }
  perAgent: Record<string, AgentSummary>
  availability: Record<string, Availability>
}
