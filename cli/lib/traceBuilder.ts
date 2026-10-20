import type { Artifact, Span, Termination, Trace } from '../../src/schema/trace.ts'
import type { BuildOptions, CommandEvent, EditEvent } from './types.ts'
import { mergeEvents, type MergeResult } from './eventMerger.ts'
import { formatDuration, plural } from './fsutil.ts'
import { patchArtifact, terminalArtifact } from './artifacts.ts'
import { completed, taskFailure } from './termination.ts'
import { buildEnvironment } from './environment.ts'

type TestRecord = {
  span: Span
  passed: number
  failed: number
  total: number
}

function testResults(spans: Span[]): TestRecord[] {
  const records: TestRecord[] = []
  for (const span of spans) {
    if (span.type !== 'test') continue
    const artifact = span.artifacts?.find((item) => item.kind === 'test')
    const passed =
      artifact?.kind === 'test'
        ? artifact.passed
        : typeof span.attributes?.passed === 'number'
          ? span.attributes.passed
          : 0
    const failed =
      artifact?.kind === 'test'
        ? artifact.failed
        : typeof span.attributes?.failed === 'number'
          ? span.attributes.failed
          : 0
    const total =
      artifact?.kind === 'test'
        ? artifact.total
        : typeof span.attributes?.total === 'number'
          ? span.attributes.total
          : passed + failed
    if (total > 0) records.push({ span, passed, failed, total })
  }
  return records.sort((a, b) => a.span.startMs - b.span.startMs || a.span.endMs - b.span.endMs)
}

function statusFor(
  options: BuildOptions,
  records: TestRecord[],
  merge: MergeResult,
): 'pass' | 'fail' | 'partial' {
  const last = records[records.length - 1]
  // The task's own tests decide `status`. A transport error after the tests
  // passed does not un-solve the task; it shows up in `termination` instead.
  if (last && last.failed > 0) return 'fail'
  if (last && last.failed === 0 && last.passed > 0) return 'pass'
  if (options.commandExitCode !== undefined && options.commandExitCode !== 0) return 'fail'
  if (merge.finalStatus === 'error') return 'fail'
  return 'partial'
}

/**
 * Status says whether the task's tests passed; termination says whether the run
 * got a fair attempt. Keeping them separate stops provider outages from being
 * averaged into a capability score.
 */
function terminationFor(
  options: BuildOptions,
  records: Array<{ passed: number; failed: number }>,
  merge: MergeResult,
  status: 'pass' | 'fail' | 'partial',
): Termination {
  const classified = merge.errors.find(
    (error) => error.termination && error.termination !== 'agent_error',
  )
  const trailing = merge.errors.find(
    (error) => !error.termination || error.termination === 'agent_error' || error.termination === 'timeout',
  )

  if (status === 'pass') {
    // A task that passed but whose process then died did not end cleanly, and
    // saying "completed" would hide a real failure mode. A transient provider
    // blip that the agent recovered from does not deserve that label.
    if (trailing) {
      return {
        kind: trailing.termination ?? 'agent_error',
        message: trailing.message,
        code: trailing.code,
      }
    }
    return completed()
  }

  if (classified?.termination) {
    return {
      kind: classified.termination,
      message: classified.message,
      code: classified.code,
    }
  }
  if (merge.errors.length > 0) {
    const first = merge.errors[0]
    return { kind: first.termination ?? 'agent_error', message: first.message, code: first.code }
  }

  const last = records[records.length - 1]
  if (last && last.failed > 0) {
    return taskFailure(`${last.failed} of ${last.passed + last.failed} tests failed`)
  }
  if (options.commandExitCode !== undefined && options.commandExitCode !== 0) {
    return taskFailure(`command exited with code ${options.commandExitCode}`)
  }
  return taskFailure('no passing test run was observed')
}

function captureSentence(merge: MergeResult): string {
  if (merge.capture.fidelity === 'native+workspace') {
    return 'Native agent events verified against workspace diffs.'
  }
  if (merge.capture.fidelity === 'native-events') {
    return 'Native agent events; workspace changes were not observed.'
  }
  if (merge.capture.fidelity === 'wrapped-output') {
    return 'Workspace facts plus wrapped command/output capture.'
  }
  return 'Workspace facts only.'
}

export function buildTrace(options: BuildOptions): Trace {
  const { meta, events, baseline, git } = options
  const nowMs = options.nowMs ?? Date.now()
  const agentEvents = options.agentEvents ?? []
  const editEvents = events.filter((event): event is EditEvent => event.kind === 'edit')
  const commandEvents = events.filter(
    (event): event is CommandEvent => event.kind === 'command',
  )
  const sessionElapsed = Math.max(
    0,
    nowMs - meta.startedAtMs,
    ...events.map((event) =>
      event.kind === 'command' ? event.endMs : event.kind === 'edit' ? event.atMs : 0,
    ),
  )
  const sessionEndMs = Math.max(sessionElapsed, ...agentEvents.map((event) => event.atMs))

  const merge = mergeEvents({
    agentEvents,
    editEvents,
    commandEvents,
    meta,
    adapterId: options.adapter?.id,
    sessionEndMs,
    wrappedOutput: options.wrappedOutput,
  })

  const mergedSpans = merge.spans.map((item) => item.span)
  const records = testResults(mergedSpans)
  const lastTest = records[records.length - 1]
  const status = statusFor(options, records, merge)
  const realEnd = Math.max(sessionElapsed, 1, ...mergedSpans.map((span) => span.endMs))
  const maxRealStart = Math.max(0, ...mergedSpans.map((span) => span.startMs))
  const baselineEnd = Math.min(200, realEnd)
  const checkpointStart = Math.max(realEnd - 400, maxRealStart + 1, baselineEnd)
  const checkpointEnd = checkpointStart + 200
  const finalStart = checkpointEnd + 50
  const finalEnd = finalStart + 200
  const durationMs = Math.max(realEnd, finalEnd, 1)
  const editSpans = mergedSpans.filter((span) => span.type === 'edit')
  const filesChanged = [...new Set(editSpans.flatMap((span) => span.files ?? []))].sort()
  const testRunCount = records.length
  const editCount = editSpans.length
  const firstFailure = records.find((record) => record.failed > 0)
  const recovery = firstFailure
    ? records.find(
        (record) =>
          record.failed === 0 &&
          record.passed > 0 &&
          record.span.startMs > firstFailure.span.startMs,
      )
    : undefined
  const maxFailed = Math.max(0, ...records.map((record) => record.failed))
  const regressionDetected = Boolean(firstFailure && maxFailed > firstFailure.failed)
  const summary =
    status === 'pass' && lastTest
      ? `Recorded session: ${lastTest.passed}/${lastTest.total} tests pass after ${plural(editCount, 'edit')}${recovery ? ' (recovered)' : ''}.`
      : status === 'fail' && lastTest
        ? `Recorded session ended with ${plural(lastTest.failed, 'failing test')} after ${plural(editCount, 'edit')}.`
        : merge.finalText
          ? merge.finalText.split('\n')[0].slice(0, 200)
          : `Recorded ${plural(editCount, 'edit')} and ${plural(commandEvents.length, 'command')}; no passing test run was observed.`

  const baselineSpan: Span = {
    id: 'rec-baseline',
    type: 'checkpoint',
    name: 'Baseline',
    summary: meta.initialStatus
      ? `${meta.initialStatus.split('\n').length} pre-existing change(s)`
      : 'Clean worktree at session start.',
    startMs: 0,
    endMs: baselineEnd,
    status: 'ok',
    files: Object.keys(baseline.contents),
    attributes: {
      phase: 'Setup',
      tool: 'git',
      baseCommit: meta.baseCommit ?? 'none',
      timingKind: 'synthetic',
    },
    artifacts: [
      terminalArtifact(
        'git status --short',
        meta.repoRoot ?? meta.cwd,
        meta.initialStatus || '(clean worktree)',
        0,
      ),
    ],
  }

  const patch = git.patch
  const checkpointArtifacts: Artifact[] = [
    terminalArtifact(
      'git diff --stat',
      meta.repoRoot ?? meta.cwd,
      git.diffStat || '(no tracked changes)',
      0,
    ),
  ]
  if (patch) checkpointArtifacts.push(patchArtifact(patch))

  const checkpointSpan: Span = {
    id: 'rec-checkpoint',
    type: 'checkpoint',
    name: git.available ? 'git diff --stat' : 'Workspace checkpoint',
    summary: git.diffStat.split('\n').pop() ?? 'Final workspace snapshot',
    startMs: checkpointStart,
    endMs: checkpointEnd,
    status: 'ok',
    files: filesChanged,
    attributes: { phase: 'Finish', tool: 'git', timingKind: 'synthetic' },
    artifacts: checkpointArtifacts,
  }

  const finalArtifacts: Artifact[] = [
    {
      kind: 'markdown',
      content: [
        '## Recorded session',
        '',
        summary,
        merge.finalText && merge.finalText.trim() !== summary
          ? `\n${merge.finalText.trim().slice(0, 4000)}`
          : '',
        '',
        `- ${plural(testRunCount, 'test run')}`,
        `- ${plural(editCount, 'edit')} across ${plural(filesChanged.length, 'file')}`,
        `- duration ${formatDuration(sessionElapsed)}`,
        `- capture ${merge.capture.fidelity} · ${merge.capture.timing} timing`,
        recovery
          ? `- recovery detected after ${plural(firstFailure?.failed ?? 0, 'failing test')}`
          : '',
        merge.capture.unverifiedEdits
          ? `- ${plural(merge.capture.unverifiedEdits, 'edit')} reported by the agent without a workspace diff`
          : '',
        '',
        captureSentence(merge),
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
  if (patch) finalArtifacts.push(patchArtifact(patch))

  const finalSpan: Span = {
    id: 'rec-final',
    type: 'final',
    name: status === 'pass' ? 'Done' : status === 'fail' ? 'Incomplete' : 'Recorded',
    summary,
    startMs: finalStart,
    endMs: finalEnd,
    status: status === 'pass' ? 'ok' : status === 'fail' ? 'error' : 'warning',
    files: filesChanged,
    attributes: {
      phase: 'Finish',
      tool: 'recorder',
      timingKind: 'synthetic',
      recoveryDetected: Boolean(recovery),
      regressionDetected,
    },
    artifacts: finalArtifacts,
  }

  const spans: Span[] = [baselineSpan, ...mergedSpans, checkpointSpan, finalSpan]
  const hasTests = records.length > 0
  let round = 1
  for (const span of spans) {
    if (span.id === 'rec-baseline' || span.id === 'rec-checkpoint' || span.id === 'rec-final') {
      continue
    }
    if (!span.attributes) span.attributes = {}
    if (hasTests) {
      span.attributes.phase = `Attempt ${round}`
      if (span.type === 'test') round += 1
    } else {
      span.attributes.phase = 'Work'
    }
  }

  return {
    schemaVersion: 'agent-replay/v1',
    id: meta.id,
    task: {
      id: meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || meta.id,
      title: meta.name,
      description: `Recorded ${meta.agent} session in ${meta.repo ?? meta.repoRoot ?? meta.cwd}.`,
      repo: meta.repo,
      baseCommit: meta.baseCommit,
    },
    agent: {
      name: meta.agent,
      model: merge.model ?? meta.model,
    },
    status,
    termination: terminationFor(options, records, merge, status),
    environment: buildEnvironment(meta),
    startedAt: meta.startedAt,
    endedAt: new Date(meta.startedAtMs + durationMs).toISOString(),
    durationMs,
    result: {
      summary,
      exitCode: options.commandExitCode,
      tests: lastTest
        ? { passed: lastTest.passed, failed: lastTest.failed, total: lastTest.total }
        : undefined,
      filesChanged,
      patch: patch || undefined,
    },
    capture: merge.capture,
    spans,
    metadata: {
      source: 'recorder',
      sessionId: meta.id,
      command: meta.command ?? null,
      cwd: meta.cwd,
      repoRoot: meta.repoRoot ?? null,
      baseCommit: meta.baseCommit ?? null,
      initialStatus: meta.initialStatus,
      gitAvailable: git.available,
      sessionDurationMs: sessionElapsed,
      adapter: options.adapter?.id ?? null,
      nativeSessionId: merge.sessionId ?? null,
      recoveryDetected: Boolean(recovery),
      regressionDetected,
      recordedAt: new Date().toISOString(),
    },
  }
}
