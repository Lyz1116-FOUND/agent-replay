export type TestOutcome = {
  passed: number
  failed: number
  total: number
  failedTests: string[]
  framework: string
}

export type EditOperation = 'create' | 'modify' | 'delete' | 'rename'

export type EditEvent = {
  kind: 'edit'
  atMs: number
  batch: string
  path: string
  fromPath?: string
  operation: EditOperation
  before: string
  after: string
  hashBefore: string
  hashAfter: string
  truncated: boolean
}

export type CommandEvent = {
  kind: 'command'
  atMs: number
  endMs: number
  command: string
  displayCommand: string
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
  spanType: 'test' | 'shell'
  test?: TestOutcome
  detectedFromOutput: boolean
}

export type AgentEventRecord = {
  kind: 'agent'
  event: import('../adapters/types.ts').AgentEvent
}

export type SessionEvent = EditEvent | CommandEvent | AgentEventRecord

export type SessionMeta = {
  version: 1
  id: string
  name: string
  cwd: string
  repoRoot?: string
  repo?: string
  baseCommit?: string
  initialStatus: string
  startedAt: string
  startedAtMs: number
  agent: string
  model?: string
  command?: string
  watcherPid?: number
  outputDir: string
  tracePath: string
  /** Run-environment fingerprint; only what the recorder was told or can observe. */
  isolation?: 'none' | 'xdg' | 'host-config' | 'custom'
  provider?: string
  harnessVersion?: string
}

export type Baseline = {
  contents: Record<string, string>
}

export type BuildGitInfo = {
  available: boolean
  head?: string
  statusShort: string
  diffStat: string
  patch: string
}

export type BuildOptions = {
  meta: SessionMeta
  events: SessionEvent[]
  baseline: Baseline
  git: BuildGitInfo
  commandExitCode?: number
  nowMs?: number
  agentEvents?: import('../adapters/types.ts').AgentEvent[]
  adapter?: { id: string; name: string }
  wrappedOutput?: boolean
}
