import type { TestOutcome } from '../lib/types.ts'

export type AgentId = 'codex' | 'cursor' | 'claude' | 'opencode' | 'qoder' | 'zcode' | 'generic'

export type ToolKind =
  | 'read'
  | 'search'
  | 'edit'
  | 'shell'
  | 'test'
  | 'browser'
  | 'tool'

export type EditOperation = 'create' | 'modify' | 'delete' | 'rename'

export type AgentSessionEvent = {
  kind: 'session'
  atMs: number
  agent: AgentId
  model?: string
  cwd?: string
  sessionId?: string
}

export type AgentMessageEvent = {
  kind: 'message'
  atMs: number
  role: 'assistant' | 'user' | 'system'
  text: string
  reasoning: boolean
}

export type AgentToolStarted = {
  kind: 'tool.started'
  atMs: number
  callId: string
  tool: ToolKind
  name: string
  file?: string
  files?: string[]
  command?: string
  operation?: EditOperation
  argsSummary?: string
}

export type AgentToolCompleted = {
  kind: 'tool.completed'
  atMs: number
  startedAtMs?: number
  callId: string
  tool: ToolKind
  name: string
  file?: string
  files?: string[]
  command?: string
  operation?: EditOperation
  status: 'ok' | 'error' | 'warning'
  output?: string
  exitCode?: number
  test?: TestOutcome
  patch?: string
  errorMessage?: string
}

export type AgentFinalEvent = {
  kind: 'final'
  atMs: number
  text?: string
  status?: 'success' | 'error'
  durationMs?: number
  usage?: Record<string, string | number>
}

export type AgentErrorEvent = {
  kind: 'error'
  atMs: number
  message: string
  /** Provider/agent failure class, when the CLI tells us enough to know it. */
  termination?: import('../lib/termination.ts').TerminationKind
  code?: string | number
}

export type AgentEvent =
  | AgentSessionEvent
  | AgentMessageEvent
  | AgentToolStarted
  | AgentToolCompleted
  | AgentFinalEvent
  | AgentErrorEvent

export type AgentCommand = {
  command: string
  args: string[]
}

export interface AgentStreamAdapter {
  id: AgentId
  name: string
  env?: Record<string, string | undefined>
  detect(command: string, args: string[]): boolean
  buildCommand(prompt: string, extraArgs?: string[]): AgentCommand
  parseLine(line: string, receivedAtMs: number): AgentEvent[]
  finalize?(): AgentEvent[]
}

export type { TestOutcome }
