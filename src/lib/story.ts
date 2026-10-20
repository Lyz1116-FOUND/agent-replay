import type { Span, Trace } from '../schema/trace'
import { formatClock, leafSpans } from './trace'
import { t, tn } from '../i18n'

export type TestResult = {
  span: Span
  step: number
  passed: number
  failed: number
  total: number
  failedTests: string[]
  command: string
}

export type RecoveryInfo = {
  firstFailure: TestResult
  recoveredAt: TestResult
  failingRuns: number
  maxFailed: number
  regression: boolean
  regressionAt: TestResult | null
  summary: string
}

export type StoryNode = {
  id: string
  kind: 'test' | 'edit' | 'final'
  spanId?: string
  step: number
  timeMs: number
  title: string
  detail: string
  tone: 'fail' | 'pass' | 'edit' | 'neutral'
  regression: boolean
  recovered: boolean
}

export function testResults(trace: Trace): TestResult[] {
  const spans = leafSpans(trace)
  // Exported traces carry arbitrary attributes: `passed`/`failed`/`total` on a
  // tool span is not a test observation, so only explicit test artifacts count
  // there. Gating one field but not the others still fabricates "0 passed".
  const attributeCountsAllowed = trace.capture?.fidelity !== 'otel'
  const results: TestResult[] = []
  spans.forEach((span, index) => {
    if (span.type !== 'test') return
    const artifact = span.artifacts?.find((item) => item.kind === 'test')
    const passed =
      artifact?.kind === 'test'
        ? artifact.passed
        : attributeCountsAllowed && typeof span.attributes?.passed === 'number'
          ? span.attributes.passed
          : 0
    const failed =
      artifact?.kind === 'test'
        ? artifact.failed
        : attributeCountsAllowed && typeof span.attributes?.failed === 'number'
          ? span.attributes.failed
          : 0
    const total =
      artifact?.kind === 'test'
        ? artifact.total
        : attributeCountsAllowed && typeof span.attributes?.total === 'number'
          ? span.attributes.total
          : passed + failed
    if (total === 0 && passed === 0 && failed === 0) return
    results.push({
      span,
      step: index + 1,
      passed,
      failed,
      total,
      failedTests:
        artifact?.kind === 'test' && artifact.failedTests ? artifact.failedTests : [],
      command: artifact?.kind === 'test' ? artifact.command : span.name,
    })
  })
  return results
}

export function detectRecovery(trace: Trace): RecoveryInfo | null {
  const results = testResults(trace)
  const firstFailure = results.find((result) => result.failed > 0)
  if (!firstFailure) return null
  let lastFailureIndex = -1
  results.forEach((result, index) => {
    if (result.failed > 0) lastFailureIndex = index
  })
  const recoveredAt = results
    .slice(lastFailureIndex + 1)
    .find((result) => result.failed === 0 && result.passed > 0)
  if (!recoveredAt) return null
  const failingRuns = results.filter((result) => result.failed > 0).length
  const maxFailed = Math.max(...results.map((result) => result.failed))
  const regression = maxFailed > firstFailure.failed
  const regressionAt = regression
    ? results.find((result) => result.failed === maxFailed) ?? null
    : null
  const summary = results
    .filter((result) => result.span.startMs <= recoveredAt.span.startMs)
    .slice(-5)
    .map((result) => (result.failed > 0 ? `${result.failed} failed` : `${result.passed} passed`))
    .join(' → ')
  return { firstFailure, recoveredAt, failingRuns, maxFailed, regression, regressionAt, summary }
}

export function hasFailures(trace: Trace): boolean {
  return testResults(trace).some((result) => result.failed > 0)
}

function pushEditNode(nodes: StoryNode[], edits: Span[], stepIndex: Map<string, number>): void {
  if (edits.length === 0) return
  const first = edits[0]
  const last = edits[edits.length - 1]
  const paths = [...new Set(edits.flatMap((span) => span.files ?? []))]
  const names = paths.map((path) => path.split('/').pop() ?? path)
  nodes.push({
    id: `edit-${first.id}`,
    kind: 'edit',
    spanId: last.id,
    step: stepIndex.get(last.id) ?? 0,
    timeMs: last.startMs,
    title:
      names.length === 0
        ? tn('story.editCount', edits.length)
        : names.length === 1
          ? t('story.editOne', { file: names[0] })
          : t('story.editMany', { count: names.length }),
    detail:
      names.length > 0
        ? names.join(', ')
        : tn('story.workspaceChange', edits.length),
    tone: 'edit',
    regression: false,
    recovered: false,
  })
}

export function buildStory(trace: Trace): StoryNode[] {
  const spans = leafSpans(trace)
  const stepIndex = new Map(spans.map((span, index) => [span.id, index + 1]))
  const results = new Map(testResults(trace).map((result) => [result.span.id, result]))
  const recovery = detectRecovery(trace)
  const nodes: StoryNode[] = []
  let pendingEdits: Span[] = []
  let previousFailed: number | null = null

  for (const span of spans) {
    if (span.type === 'edit') {
      pendingEdits.push(span)
      continue
    }
    if (span.type !== 'test') continue
    const result = results.get(span.id)
    if (!result) continue
    pushEditNode(nodes, pendingEdits, stepIndex)
    pendingEdits = []
    const regression = previousFailed !== null && result.failed > previousFailed
    const recovered = recovery?.recoveredAt.span.id === span.id
    nodes.push({
      id: `test-${span.id}`,
      kind: 'test',
      spanId: span.id,
      step: result.step,
      timeMs: span.startMs,
      title: result.command,
      detail:
        result.failed > 0
          ? t('story.testDetail', { failed: result.failed, passed: result.passed })
          : t('story.testDetailPassed', { passed: result.passed }),
      tone: result.failed > 0 ? 'fail' : 'pass',
      regression,
      recovered,
    })
    previousFailed = result.failed
  }

  pushEditNode(nodes, pendingEdits, stepIndex)

  if (nodes.length === 0) {
    nodes.push({
      id: 'final',
      kind: 'final',
      step: spans.length,
      timeMs: spans[spans.length - 1]?.endMs ?? 0,
      title:
        trace.status === 'pass'
          ? t('story.runComplete')
          : trace.status === 'fail'
            ? t('story.runFailed')
            : trace.status === 'running'
              ? t('story.runInProgress')
              : t('story.outcomeUnknown'),
      detail: trace.result.summary,
      tone: trace.status === 'pass' ? 'pass' : trace.status === 'fail' ? 'fail' : 'neutral',
      regression: false,
      recovered: false,
    })
  }

  return nodes
}

export function storyHeadline(trace: Trace): string {
  const results = testResults(trace)
  if (results.length === 0) return t('story.noTests')
  return results
    .slice(-4)
    .map((result) =>
      result.failed > 0
        ? tn('story.failedCount', result.failed)
        : tn('story.passedCount', result.passed),
    )
    .join(' → ')
}

export function buildOutcomeSummary(trace: Trace): string {
  const results = testResults(trace)
  const spans = leafSpans(trace)
  const edits = spans.filter((span) => span.type === 'edit').length
  const reads = spans.filter((span) => span.type === 'read').length
  const recovery = detectRecovery(trace)
  const last = results[results.length - 1]

  if (recovery) {
    if (recovery.regression) return t('story.outcome.regression')
    if (reads >= 4 && edits <= 2) return t('story.outcome.readFirst')
    return tn('story.outcome.recovered', recovery.failingRuns)
  }

  if (last && last.failed > 0) {
    if (edits >= 2) {
      return tn('story.outcome.neverRecovered', edits, {
        runs: tn('story.testRuns', results.length),
      })
    }
    return tn('story.outcome.endedFailing', last.failed)
  }

  if (last && last.failed === 0) {
    if (reads >= 4 && edits <= 2) return t('story.outcome.readSolved')
    return tn('story.outcome.solved', edits, {
      runs: tn('story.testRuns', results.length),
    })
  }

  return edits > 0 ? tn('story.outcome.recordedEdits', edits) : t('story.outcome.recordedNothing')
}

export function formatStoryTime(ms: number): string {
  return formatClock(ms)
}
