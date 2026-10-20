import type { Artifact, Span, SpanType, Trace } from '../schema/trace'

type SweStep = {
  response?: unknown
  thought?: unknown
  action?: unknown
  observation?: unknown
  state?: unknown
  query?: unknown
}

type SweTrajectory = {
  trajectory: SweStep[]
  info?: Record<string, unknown>
  environment?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSweAgentTrajectory(value: unknown): value is SweTrajectory {
  return isRecord(value) && Array.isArray(value.trajectory)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function cleanAction(action: string): string {
  const fenced = action.match(/```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/)
  return (fenced ? fenced[1] : action).trim()
}

function firstLine(text: string, max = 64): string {
  const line = text.split('\n').find((item) => item.trim().length > 0)?.trim() ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const PATH_PATTERN =
  /(?:^|[\s"'(])([\w./-]+\.(?:py|pyi|md|txt|json|toml|ya?ml|js|jsx|ts|tsx|css|html|sh|rs|go|java|rb|php|c|h|cpp|hpp|ini|cfg))/

function extractFile(action: string): string | undefined {
  const match = action.match(PATH_PATTERN)
  return match?.[1]?.replace(/^\.\//, '')
}

function extractQuery(action: string): string | undefined {
  const searchCall = action.match(/search_(?:dir|file)\s+["']?([^"'\n]+)["']?/)
  if (searchCall) return searchCall[1].trim()
  const grep = action.match(/(?:grep|rg)\s+(?:-[a-zA-Z]+\s+)*["']([^"']+)["']/)
  if (grep) return grep[1]
  return undefined
}

function languageFor(path: string | undefined): string {
  const extension = path?.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    py: 'python',
    pyi: 'python',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'shell',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    html: 'html',
    css: 'css',
    toml: 'ini',
  }
  return extension ? (map[extension] ?? 'plaintext') : 'plaintext'
}

type Classification = { type: SpanType; file?: string; query?: string }

function classify(action: string, thought: string): Classification {
  const file = extractFile(action)
  const query = extractQuery(action)
  const trimmed = action.trim()

  if (!trimmed && thought) return { type: 'reasoning' }
  if (/^submit\b/i.test(trimmed)) return { type: 'final' }
  if (/^(edit|str_replace|create|insert|apply_patch)\b/i.test(trimmed)) {
    return { type: 'edit', file }
  }
  if (/^(open|cat|head|tail|sed\s+-n|view|less)\b/i.test(trimmed)) {
    return { type: 'read', file }
  }
  if (/^(search_dir|search_file|find_file|grep|rg|find)\b/i.test(trimmed)) {
    return { type: 'search', file, query }
  }
  if (
    /(?:^|\s)(?:pytest|python\s+-m\s+pytest|npm\s+(?:run\s+)?test|yarn\s+test|cargo\s+test|go\s+test|make\s+test|tox|unittest)\b/i.test(
      trimmed,
    )
  ) {
    return { type: 'test', file }
  }
  if (/^(bash|sh|python|git|cd|pip|npm|node|ls|chmod|mv|cp)\b/i.test(trimmed)) {
    return { type: 'shell', file }
  }
  return { type: 'tool', file }
}

const DURATION_WEIGHTS: Record<SpanType, number> = {
  agent: 900,
  generation: 1200,
  reasoning: 1400,
  read: 900,
  search: 800,
  edit: 2600,
  shell: 1800,
  test: 4200,
  browser: 2400,
  tool: 1200,
  unknown: 1000,
  checkpoint: 700,
  final: 700,
}

function estimateDuration(
  type: SpanType,
  action: string,
  observation: string,
  thought: string,
): number {
  const weight = DURATION_WEIGHTS[type]
  const observationCost = Math.min(observation.length, 6000) * 0.22
  const thoughtCost = Math.min(thought.length, 1600) * 0.08
  const actionCost = Math.min(action.length, 800) * 0.1
  return Math.round((weight + observationCost + thoughtCost + actionCost) / 100) * 100
}

function parseTestOutcome(observation: string): { passed: number; failed: number } | null {
  const failed = observation.match(/(\d+)\s+failed/)
  const passed = observation.match(/(\d+)\s+passed/)
  if (!failed && !passed) return null
  return {
    passed: passed ? Number(passed[1]) : 0,
    failed: failed ? Number(failed[1]) : 0,
  }
}

function looksLikeRawFile(observation: string): boolean {
  return observation.length > 0 && !/^\s*\d+:\s/m.test(observation)
}

function buildArtifacts(
  type: SpanType,
  action: string,
  observation: string,
  thought: string,
  file: string | undefined,
): Artifact[] {
  if (type === 'reasoning') return [{ kind: 'reasoning', content: thought || action }]

  if (type === 'test') {
    const outcome = parseTestOutcome(observation)
    if (outcome) {
      const failedTests = [...observation.matchAll(/FAILED\s+([^\s]+)/g)]
        .map((match) => match[1])
        .slice(0, 12)
      return [
        {
          kind: 'test',
          command: firstLine(action, 80) || 'pytest',
          passed: outcome.passed,
          failed: outcome.failed,
          total: outcome.passed + outcome.failed,
          output: observation,
          failedTests: failedTests.length > 0 ? failedTests : undefined,
        },
      ]
    }
  }

  if (type === 'read' && file && looksLikeRawFile(observation)) {
    return [
      {
        kind: 'code',
        path: file,
        language: languageFor(file),
        content: observation,
      },
    ]
  }

  if (type === 'final') {
    return [
      {
        kind: 'markdown',
        content: observation || thought || 'Agent submitted a result.',
      },
    ]
  }

  return [
    {
      kind: 'terminal',
      command: firstLine(action, 80) || '(no command)',
      output: observation,
      exitCode: /traceback|error|failed/i.test(observation) ? 1 : 0,
    },
  ]
}

function spanName(
  type: SpanType,
  action: string,
  thought: string,
  file: string | undefined,
  query: string | undefined,
): string {
  switch (type) {
    case 'read':
      return file ?? 'Read file'
    case 'edit':
      return file ? `Edit ${file}` : 'Edit file'
    case 'search':
      return query ? `Search "${query}"` : 'Search'
    case 'test':
      return 'Run tests'
    case 'final':
      return 'Submit'
    case 'shell':
      return firstLine(action, 60) || 'Shell command'
    case 'reasoning':
      return firstLine(thought, 60) || 'Reasoning'
    default:
      return firstLine(action, 60) || 'Tool call'
  }
}

function phaseFor(type: SpanType, seenEdit: boolean, seenPassingTest: boolean): string {
  if (type === 'final') return 'Submit'
  if (seenPassingTest) return 'Verify'
  if (type === 'edit' || seenEdit) return 'Modify'
  return 'Explore'
}

function findModelName(info: Record<string, unknown>, environment: Record<string, unknown>): string | undefined {
  const config = environment.config
  if (isRecord(config) && isRecord(config.model)) {
    const name = config.model.model_name ?? config.model.name
    if (typeof name === 'string') return name
  }
  const stats = info.model_stats
  if (isRecord(stats) && typeof stats.model === 'string') return stats.model
  return undefined
}

export function adaptSweAgent(input: unknown): Trace {
  if (!isSweAgentTrajectory(input)) {
    throw new Error('Not a SWE-agent trajectory: missing "trajectory" array.')
  }
  if (input.trajectory.length === 0) {
    throw new Error('Trajectory contains no steps.')
  }

  const info = isRecord(input.info) ? input.info : {}
  const environment = isRecord(input.environment) ? input.environment : {}
  const instanceId =
    asString(info.instance_id) ||
    asString(environment.instance_id) ||
    asString(info.instanceId) ||
    'swe-agent-run'
  const startedAt = new Date().toISOString()

  let cursor = 0
  let seenEdit = false
  let seenPassingTest = false
  const spans: Span[] = []

  input.trajectory.forEach((step, index) => {
    const thought = asString(step.thought) || asString(step.response)
    const action = cleanAction(asString(step.action))
    const observation = asString(step.observation)
    const { type, file, query } = classify(action, thought)
    const duration = estimateDuration(type, action, observation, thought)
    const outcome = type === 'test' ? parseTestOutcome(observation) : null
    const passingTest = Boolean(outcome && outcome.failed === 0 && outcome.passed > 0)
    const phase = passingTest ? 'Verify' : phaseFor(type, seenEdit, seenPassingTest)
    if (type === 'edit') seenEdit = true
    if (passingTest) seenPassingTest = true

    const status =
      type === 'test' && outcome && outcome.failed > 0
        ? 'error'
        : /traceback|error:/i.test(observation) && type !== 'final'
          ? 'warning'
          : 'ok'

    spans.push({
      id: `swe-${String(index + 1).padStart(2, '0')}`,
      type,
      name: spanName(type, action, thought, file, query),
      summary: firstLine(thought || observation, 120),
      startMs: cursor,
      endMs: cursor + duration,
      status,
      files: file ? [file] : undefined,
      attributes: {
        phase,
        estimatedTiming: true,
        step: index + 1,
                ...(file ? { file } : {}),
        ...(outcome ? { passed: outcome.passed, failed: outcome.failed } : {}),
      },
      artifacts: buildArtifacts(type, action, observation, thought, file),
    })
    cursor += duration
  })

  const lastSpan = spans[spans.length - 1]
  const exitStatus = asString(info.exit_status)
  const submission = asString(info.submission)
  const submitted = /submit/i.test(exitStatus) || (submission.length > 0 && !/error/i.test(exitStatus))
  const durationMs = lastSpan?.endMs ?? 0
  const filesChanged = [
    ...new Set(
      spans
        .filter((span) => span.type === 'edit')
        .flatMap((span) => span.files ?? []),
    ),
  ]

  return {
    schemaVersion: 'agent-replay/v1',
    id: `swe_${instanceId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now().toString(36)}`,
    task: {
      id: instanceId,
      title: instanceId,
      description: `Imported SWE-agent trajectory · ${spans.length} steps`,
      repo: instanceId.includes('__') ? instanceId.split('__').slice(0, 2).join('/') : undefined,
    },
    agent: {
      name: 'SWE-agent',
      model: findModelName(info, environment),
    },
    status: submitted ? 'partial' : 'fail',
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + durationMs).toISOString(),
    durationMs,
    result: {
      summary: submitted
        ? 'SWE-agent submitted a patch. Benchmark evaluation is not included in this trace.'
        : `SWE-agent exited with status: ${exitStatus || 'unknown'}.`,
      filesChanged,
      patch: submission.includes('diff --git') ? submission : undefined,
    },
    spans,
    metadata: {
      source: 'swe-agent',
      estimatedTiming: true,
      instanceId,
      exitStatus: exitStatus || undefined,
    },
  }
}
