import path from 'node:path'
import type { Span, SpanStatus, Trace } from '../../src/schema/trace.ts'
import type {
  AgentErrorEvent,
  AgentEvent,
  AgentMessageEvent,
  AgentToolCompleted,
  AgentToolStarted,
  TestOutcome,
} from '../adapters/types.ts'
import type { CommandEvent, EditEvent, SessionMeta } from './types.ts'
import {
  codeArtifact,
  diffArtifact,
  patchArtifact,
  terminalArtifact,
  testArtifact,
} from './artifacts.ts'
import { truncateLine } from './fsutil.ts'
import { isTestCommand, parseTestOutput } from './testParser.ts'

type Capture = NonNullable<Trace['capture']>
type EditOperation = EditEvent['operation']

export type MergedSpan = {
  span: Span
  origin: 'native' | 'workspace' | 'command'
}

export type MergeResult = {
  spans: MergedSpan[]
  capture: Capture
  model?: string
  finalText?: string
  finalStatus?: 'success' | 'error'
  sessionId?: string
  /** Provider-reported token usage from the agent's final event, when available. */
  usage?: Record<string, string | number>
  errors: AgentErrorEvent[]
}

const MATCH_WINDOW_MS = 5000

function basename(file: string): string {
  return file.split('/').pop() ?? file
}

function normalizeFile(file: string | undefined, meta: SessionMeta): string | undefined {
  if (!file) return undefined
  const root = meta.repoRoot ?? meta.cwd
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file
  let normalized = relative.split(path.sep).join('/').replace(/^\.\//, '')
  // Agents sometimes report paths relative to the parent of the repo
  // (`repo-name/src/file.ts`). Strip that single prefix so native edits can
  // still be matched against the workspace diff.
  const prefix = `${path.basename(root)}/`
  if (normalized.startsWith(prefix)) normalized = normalized.slice(prefix.length)
  return normalized
}

function firstLine(text: string, max = 96): string {
  return truncateLine(text, max)
}

function statusFor(completed: AgentToolCompleted, test: TestOutcome | undefined): SpanStatus {
  if (test && test.failed > 0) return 'error'
  if (completed.status === 'error') return 'error'
  if (completed.status === 'warning') return 'warning'
  if (completed.exitCode !== undefined && completed.exitCode !== 0) return 'error'
  return 'ok'
}

function operationOf(event: EditEvent): EditOperation {
  if (event.operation) return event.operation
  if (!event.before && event.after) return 'create'
  if (event.before && !event.after) return 'delete'
  return 'modify'
}

function verbFor(operation: EditOperation): string {
  switch (operation) {
    case 'create':
      return 'Create'
    case 'delete':
      return 'Delete'
    case 'rename':
      return 'Rename'
    default:
      return 'Edit'
  }
}

export function editSpanName(edit: EditEvent): string {
  const operation = operationOf(edit)
  if (operation === 'rename' && edit.fromPath) {
    return `Rename ${basename(edit.fromPath)} → ${basename(edit.path)}`
  }
  return `${verbFor(operation)} ${basename(edit.path) ?? edit.path}`
}

function testFromShell(completed: AgentToolCompleted): TestOutcome | undefined {
  if (completed.test) return completed.test
  if (!completed.command) return undefined
  if (!isTestCommand(completed.command) && !/(\d+)\s+(?:passed|failed)/i.test(completed.output ?? '')) {
    return undefined
  }
  return parseTestOutput(completed.output ?? '') ?? undefined
}

function nativeSpan(
  completed: AgentToolCompleted,
  started: AgentToolStarted | undefined,
  adapterId: string | undefined,
  meta: SessionMeta,
): { merged: MergedSpan; test?: TestOutcome; startedAt: number; endedAt: number } {
  const test = testFromShell(completed)
  const tool = test ? 'test' : completed.tool
  const start = Math.max(0, started?.atMs ?? completed.startedAtMs ?? completed.atMs)
  const end = Math.max(completed.atMs, start)
  const instant = end - start <= 10
  const command = completed.command ?? started?.command
  const rawFiles =
    completed.files ?? started?.files ?? (completed.file ? [completed.file] : undefined)
  const files = rawFiles
    ? [...new Set(rawFiles.map((item) => normalizeFile(item, meta)).filter((item): item is string => Boolean(item)))]
    : undefined
  const file =
    normalizeFile(completed.file ?? started?.file, meta) ?? files?.[0]
  const operation = completed.operation ?? started?.operation
  const status = statusFor(completed, test)
  const output = completed.output
  const artifacts = []

  if (test) {
    artifacts.push(testArtifact(command ?? completed.name, test, output))
  } else if (tool === 'read' && file && output) {
    artifacts.push(codeArtifact(file, output))
  } else if (tool === 'edit') {
    if (completed.patch) artifacts.push(patchArtifact(completed.patch))
  } else {
    artifacts.push(terminalArtifact(command ?? completed.name, meta.cwd, output, completed.exitCode))
  }

  const span: Span = {
    id: `native-${completed.callId}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    type: tool,
    name:
      tool === 'read' && file
        ? `Read ${basename(file)}`
        : tool === 'edit' && files?.length
          ? files.length === 1
            ? `${verbFor(operation ?? 'modify')} ${basename(files[0])}`
            : `${files.length} files changed`
          : completed.name || started?.name || tool,
    summary: test
      ? `${test.passed}/${test.total} passed`
      : tool === 'shell'
        ? `exit ${completed.exitCode ?? 0}`
        : tool === 'edit'
          ? files?.join(', ')
          : file ?? completed.name,
    startMs: start,
    endMs: end,
    status,
    files,
    attributes: {
      phase: 'Observed',
      tool: 'native',
      adapter: adapterId ?? 'native',
      callId: completed.callId,
      timingKind: 'observed',
      ...(instant ? { instant: true, visualDurationMs: 250 } : {}),
      ...(command ? { command } : {}),
      ...(completed.exitCode !== undefined ? { exitCode: completed.exitCode } : {}),
      ...(test
        ? { passed: test.passed, failed: test.failed, total: test.total }
        : {}),
      ...(operation ? { operation } : {}),
      ...(completed.errorMessage ? { error: completed.errorMessage } : {}),
    },
    artifacts: artifacts.length > 0 ? artifacts : undefined,
  }
  return { merged: { span, origin: 'native' }, test, startedAt: start, endedAt: end }
}

function messageSpan(
  message: AgentMessageEvent,
  adapterId: string | undefined,
): MergedSpan {
  const span: Span = {
    id: `message-${message.atMs}-${Math.abs(hash(message.text))}`,
    type: 'reasoning',
    name: message.reasoning ? 'Reasoning' : 'Assistant message',
    summary: firstLine(message.text, 120),
    startMs: message.atMs,
    endMs: message.atMs,
    status: 'ok',
    attributes: {
      phase: 'Observed',
      tool: 'native',
      adapter: adapterId ?? 'native',
      timingKind: 'observed',
      instant: true,
      visualDurationMs: 250,
    },
    artifacts: [{ kind: 'reasoning', content: message.text.slice(0, 20_000) }],
  }
  return { span, origin: 'native' }
}

function hash(text: string): number {
  let value = 0
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) | 0
  }
  return value
}

function workspaceSpans(edits: EditEvent[]): MergedSpan[] {
  const groups = new Map<string, EditEvent[]>()
  for (const edit of edits) {
    const list = groups.get(edit.batch) ?? []
    list.push(edit)
    groups.set(edit.batch, list)
  }

  return [...groups.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path))
    const atMs = Math.min(...sorted.map((edit) => edit.atMs))
    const paths = [...new Set(sorted.map((edit) => edit.path))]
    const operations = [...new Set(sorted.map((edit) => operationOf(edit)))]
    const onlyOperation = operations.length === 1 ? operations[0] : undefined
    const name =
      sorted.length === 1
        ? editSpanName(sorted[0])
        : onlyOperation
          ? `${verbFor(onlyOperation)} ${sorted.length} files`
          : `${sorted.length} files changed`
    const span: Span = {
      id: `workspace-${atMs}-${Math.abs(hash(group.map((edit) => `${edit.path}:${edit.hashAfter}`).join('|')))}`,
      type: 'edit',
      name,
      summary:
        sorted.length === 1 && sorted[0].fromPath
          ? `${sorted[0].fromPath} → ${sorted[0].path}`
          : paths.join(', '),
      startMs: atMs,
      endMs: atMs,
      status: 'ok',
      files: paths,
      attributes: {
        phase: 'Observed',
        tool: 'workspace-watcher',
        timingKind: 'observed',
        timingResolutionMs: 650,
        instant: true,
        visualDurationMs: 250,
        ...(onlyOperation
          ? { operation: onlyOperation }
          : { operations }),
        ...(sorted.length === 1 && sorted[0].fromPath
          ? { fromPath: sorted[0].fromPath }
          : {}),
      },
      artifacts: sorted.map((edit) => diffArtifact(edit.path, edit.before, edit.after)),
    }
    return { span, origin: 'workspace' as const }
  })
}

function commandSpan(event: CommandEvent, meta: SessionMeta): MergedSpan {
  const isTest = event.spanType === 'test'
  const instant = event.endMs <= event.atMs
  const output = [event.stdout, event.stderr].filter(Boolean).join('\n')
  const artifacts = []
  if (isTest && event.test) {
    artifacts.push(testArtifact(event.displayCommand, event.test, output))
  } else {
    artifacts.push(
      terminalArtifact(event.displayCommand, event.cwd ?? meta.cwd, output, event.exitCode),
    )
  }
  const span: Span = {
    id: `command-${event.atMs}-${Math.abs(hash(event.displayCommand))}`,
    type: isTest ? 'test' : 'shell',
    name: truncateLine(event.displayCommand, 64),
    summary: event.test
      ? `${event.test.passed} passed · ${event.test.failed} failed`
      : `exit ${event.exitCode}`,
    startMs: event.atMs,
    endMs: Math.max(event.endMs, event.atMs),
    status: event.exitCode !== 0 || (event.test && event.test.failed > 0) ? 'error' : 'ok',
    attributes: {
      phase: 'Observed',
      tool: 'shell',
      timingKind: event.detectedFromOutput ? 'estimated' : 'observed',
      ...(event.detectedFromOutput ? { estimatedTiming: true } : {}),
      command: event.displayCommand,
      exitCode: event.exitCode,
      ...(event.test
        ? { passed: event.test.passed, failed: event.test.failed, total: event.test.total }
        : {}),
      ...(instant ? { instant: true, visualDurationMs: 250 } : {}),
    },
    artifacts,
  }
  return { span, origin: 'command' }
}

function distanceToWindow(atMs: number, start: number, end: number): number {
  if (atMs < start) return start - atMs
  if (atMs > end) return atMs - end
  return 0
}

export function mergeEvents(options: {
  agentEvents: AgentEvent[]
  editEvents: EditEvent[]
  commandEvents: CommandEvent[]
  meta: SessionMeta
  adapterId?: string
  sessionEndMs: number
  wrappedOutput?: boolean
}): MergeResult {
  const { agentEvents, editEvents, commandEvents, meta, adapterId } = options
  const events = [...agentEvents].sort((a, b) => a.atMs - b.atMs)
  const started = new Map<string, AgentToolStarted>()
  const merged: MergedSpan[] = []
  const nativeEditSpans: MergedSpan[] = []
  const errors: AgentErrorEvent[] = []
  let failedEdits = 0
  let model: string | undefined
  let finalText: string | undefined
  let finalStatus: 'success' | 'error' | undefined
  let sessionId: string | undefined
  let finalUsage: Record<string, string | number> | undefined

  for (const event of events) {
    if (event.kind === 'session') {
      model = event.model ?? model
      sessionId = event.sessionId ?? sessionId
      continue
    }
    if (event.kind === 'message') {
      if (event.role === 'assistant' && event.text.trim()) {
        merged.push(messageSpan(event, adapterId))
      }
      continue
    }
    if (event.kind === 'tool.started') {
      started.set(event.callId, event)
      continue
    }
    if (event.kind === 'tool.completed') {
      const start = started.get(event.callId)
      started.delete(event.callId)
      const built = nativeSpan(event, start, adapterId, meta)
      merged.push(built.merged)
      if (built.merged.span.type === 'edit') {
        // A failed edit is a failed attempt, not a claim the workspace owes us
        // evidence for. Counting it as a claim would manufacture a fidelity gap.
        if (built.merged.span.status === 'error') failedEdits += 1
        else nativeEditSpans.push(built.merged)
      }
      continue
    }
    if (event.kind === 'final') {
      finalText = event.text ?? finalText
      finalStatus = event.status ?? finalStatus
      finalUsage = event.usage ?? finalUsage
      continue
    }
    if (event.kind === 'error') {
      errors.push(event)
      merged.push({
        span: {
          id: `native-error-${event.atMs}-${Math.abs(hash(event.message))}`,
          type: 'tool',
          name: 'Agent error',
          summary: firstLine(event.message),
          startMs: event.atMs,
          endMs: event.atMs,
          status: 'error',
          attributes: {
            phase: 'Observed',
            tool: 'native',
            timingKind: 'observed',
            instant: true,
            visualDurationMs: 250,
          },
          artifacts: [{ kind: 'terminal', command: 'agent error', output: event.message, exitCode: 1 }],
        },
        origin: 'native',
      })
    }
  }

  for (const [callId, start] of started) {
    const end = Math.max(start.atMs, options.sessionEndMs)
    merged.push({
      span: {
        id: `native-${callId}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
        type: start.tool,
        name: start.name,
        summary: 'No completion event was received.',
        startMs: start.atMs,
        endMs: end,
        status: 'running',
        files: start.files ?? (start.file ? [start.file] : undefined),
        attributes: {
          phase: 'Observed',
          tool: 'native',
          adapter: adapterId ?? 'native',
          callId,
          timingKind: 'observed',
          missingCompletion: true,
          ...(start.command ? { command: start.command } : {}),
        },
        artifacts: [
          {
            kind: 'terminal',
            command: start.name,
            output: 'The agent stream ended before this tool call completed.',
            exitCode: 1,
          },
        ],
      },
      origin: 'native',
    })
  }

  const usedFacts = new Set<EditEvent>()
  // Counted in native-call units: several workspace facts can land on one call,
  // and recall is a property of the agent's claims, not of the watcher's batches.
  const verifiedSpans = new Set<MergedSpan>()

  for (const fact of [...editEvents].sort((a, b) => a.atMs - b.atMs)) {
    let best: MergedSpan | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const candidate of nativeEditSpans) {
      const files = candidate.span.files ?? []
      const pathMatches =
        files.length === 0 ||
        files.includes(fact.path) ||
        (fact.fromPath ? files.includes(fact.fromPath) : false)
      if (!pathMatches) continue
      const distance = distanceToWindow(fact.atMs, candidate.span.startMs, candidate.span.endMs)
      if (distance > MATCH_WINDOW_MS) continue
      if (distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    if (!best) continue

    usedFacts.add(fact)
    verifiedSpans.add(best)
    const operation = operationOf(fact)
    best.span.artifacts = [
      ...(best.span.artifacts ?? []),
      diffArtifact(fact.path, fact.before, fact.after),
    ]
    best.span.files = [...new Set([...(best.span.files ?? []), fact.path])]
    best.span.name = editSpanName(fact)
    best.span.summary = fact.fromPath ? `${fact.fromPath} → ${fact.path}` : fact.path
    if (!best.span.attributes) best.span.attributes = {}
    best.span.attributes.workspaceVerified = true
    best.span.attributes.operation = operation
    if (fact.fromPath) best.span.attributes.fromPath = fact.fromPath
    if (best.span.status === 'warning') best.span.status = 'ok'
  }

  let unverifiedEdits = 0
  let supersededEdits = 0
  for (const native of nativeEditSpans) {
    const verifiedCount = (native.span.artifacts ?? []).filter(
      (artifact) => artifact.kind === 'diff',
    ).length
    if (verifiedCount > 0) {
      if (!native.span.attributes) native.span.attributes = {}
      native.span.attributes.workspaceVerified = true
      continue
    }

    // A file can be edited several times between two watcher polls, so only one
    // of those calls can claim the diff. If the same file did change within the
    // window, the call is corroborated even though it has no diff of its own.
    const files = native.span.files ?? []
    const corroborated = editEvents.some(
      (fact) =>
        files.includes(fact.path) &&
        distanceToWindow(fact.atMs, native.span.startMs, native.span.endMs) <= MATCH_WINDOW_MS,
    )
    if (!native.span.attributes) native.span.attributes = {}
    native.span.attributes.workspaceVerified = false

    if (corroborated) {
      supersededEdits += 1
      native.span.attributes.workspaceConfirmed = true
      if (!native.span.artifacts || native.span.artifacts.length === 0) {
        native.span.artifacts = [
          terminalArtifact(
            native.span.name,
            meta.cwd,
            'The same file changed in the workspace within the match window, but the diff was already attributed to an earlier call.',
            0,
          ),
        ]
      }
      continue
    }

    unverifiedEdits += 1
    if (native.span.status === 'ok') native.span.status = 'warning'
    if (!native.span.artifacts || native.span.artifacts.length === 0) {
      native.span.artifacts = [
        terminalArtifact(
          native.span.name,
          meta.cwd,
          'The agent reported a file change, but the workspace watcher observed no diff. This may be an ignored file, a no-op edit, or a fidelity gap.',
          0,
        ),
      ]
    }
  }

  const workspaceVerified = verifiedSpans.size
  const nativeTestSpans = merged.filter((item) => item.span.type === 'test')
  const nativeTestRuns = nativeTestSpans.length
  const parsedTestRuns = nativeTestSpans.filter((item) => {
    const passed = item.span.attributes?.passed
    const failed = item.span.attributes?.failed
    return typeof passed === 'number' && typeof failed === 'number'
  }).length
  for (const event of commandEvents) {
    const duplicate = event.test
      ? nativeTestSpans.some(
          (native) =>
            Math.abs(native.span.startMs - event.atMs) < 2000 &&
            native.span.attributes?.passed === event.test?.passed &&
            native.span.attributes?.failed === event.test?.failed,
        )
      : false
    if (duplicate) continue
    merged.push(commandSpan(event, meta))
  }

  const unmatchedFacts = editEvents.filter((fact) => !usedFacts.has(fact))
  merged.push(...workspaceSpans(unmatchedFacts))

  merged.sort((a, b) => a.span.startMs - b.span.startMs || a.span.id.localeCompare(b.span.id))

  const hasNative = agentEvents.length > 0
  const hasWorkspace = editEvents.length > 0
  const hasCommands = commandEvents.length > 0
  const fidelity: Capture['fidelity'] = hasNative
    ? hasWorkspace || hasCommands
      ? 'native+workspace'
      : 'native-events'
    : hasCommands || options.wrappedOutput
      ? 'wrapped-output'
      : 'workspace'

  const timingKinds = new Set(
    merged
      .map((item) => item.span.attributes?.timingKind)
      .filter((value): value is string => typeof value === 'string'),
  )
  const hasEstimated = timingKinds.has('estimated')
  const hasObserved = timingKinds.has('observed')
  const timing: Capture['timing'] = hasEstimated
    ? hasObserved
      ? 'mixed'
      : 'estimated'
    : 'observed'

  const sources = [
    ...(hasNative ? [`native:${adapterId ?? 'agent'}`] : []),
    ...(hasWorkspace ? ['workspace'] : []),
    ...(hasCommands ? ['command'] : []),
    ...(commandEvents.some((event) => event.detectedFromOutput) || options.wrappedOutput ? ['stdout'] : []),
  ]

  const outsideWorkspaceEdits = nativeEditSpans.filter((item) =>
    (item.span.files ?? []).some((file) => file.startsWith('..') || path.isAbsolute(file)),
  ).length
  const capturedTests = merged.filter((item) => item.span.type === 'test').length

  return {
    spans: merged,
    capture: {
      fidelity,
      timing,
      ...(adapterId ? { adapter: adapterId } : {}),
      sources,
      workspaceVerified,
      unverifiedEdits,
      integrity: {
        nativeEdits: nativeEditSpans.length,
        failedEdits,
        workspaceEdits: editEvents.length,
        matchedEdits: workspaceVerified,
        confirmedEdits: workspaceVerified + supersededEdits,
        supersededEdits,
        unverifiedEdits,
        outsideWorkspaceEdits,
        nativeTestRuns,
        parsedTestRuns,
        capturedTests,
      },
    },
    model,
    finalText,
    finalStatus,
    sessionId,
    usage: finalUsage,
    errors,
  }
}
