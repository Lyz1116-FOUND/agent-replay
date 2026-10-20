import type { Termination, Trace } from '../schema/trace'

export type CaptureInfo = {
  label: string
  description: string
  timingLabel: string
  tone: 'native' | 'wrapped' | 'workspace'
  sourceLine: string
}

/** Kinds where the model never got a fair attempt at the task. */
const UNAVAILABLE_LABELS: Record<string, string> = {
  provider_unavailable: 'UNAVAILABLE',
  rate_limited: 'RATE LIMITED',
  permission_denied: 'AUTH FAILED',
  recorder_error: 'RECORDER ERROR',
}

export function terminationLabel(termination: Termination | undefined): string | null {
  if (!termination) return null
  return UNAVAILABLE_LABELS[termination.kind] ?? null
}

function recallLine(trace: Trace): string {
  const integrity = trace.capture?.integrity
  if (!integrity) return ''
  const parts: string[] = []
  if (integrity.nativeEdits > 0) {
    const confirmed = integrity.confirmedEdits ?? integrity.matchedEdits
    parts.push(`edit recall ${confirmed}/${integrity.nativeEdits}`)
    if ((integrity.supersededEdits ?? 0) > 0) {
      parts.push(`${integrity.supersededEdits} superseded`)
    }
  }
  if (integrity.nativeTestRuns > 0) {
    parts.push(`test recall ${integrity.parsedTestRuns}/${integrity.nativeTestRuns}`)
  }
  if (integrity.outsideWorkspaceEdits > 0) {
    parts.push(`${integrity.outsideWorkspaceEdits} outside workspace`)
  }
  return parts.join(' · ')
}

export function captureInfo(trace: Trace): CaptureInfo | null {
  const capture = trace.capture
  if (!capture) return null
  const verified = capture.workspaceVerified ?? 0
  const unverified = capture.unverifiedEdits ?? 0
  const verification =
    verified > 0
      ? `${verified} edit${verified === 1 ? '' : 's'} verified against the workspace.`
      : ''
  const gap =
    unverified > 0
      ? `${unverified} agent-reported edit${unverified === 1 ? '' : 's'} had no workspace diff.`
      : ''
  const timingLabel =
    capture.timing === 'mixed'
      ? 'MIXED TIMING'
      : capture.timing === 'estimated'
        ? 'ESTIMATED TIMING'
        : 'OBSERVED TIMING'
  const recall = recallLine(trace)

  if (capture.fidelity === 'native+workspace') {
    return {
      label: 'NATIVE + WORKSPACE',
      description: `Native agent tool events, verified against workspace diffs. ${verification} ${gap}`.trim(),
      timingLabel,
      tone: 'native',
      sourceLine: `Native agent events + workspace verification${verified ? ` · ${verified} verified` : ''}${unverified ? ` · ${unverified} unverified` : ''}${recall ? ` · ${recall}` : ''}`,
    }
  }
  if (capture.fidelity === 'native-events') {
    return {
      label: 'NATIVE EVENTS',
      description: `Native agent tool events. Workspace changes were not observed, so edits are agent-reported only.`,
      timingLabel,
      tone: 'native',
      sourceLine: 'Native agent event stream · no workspace verification',
    }
  }
  if (capture.fidelity === 'wrapped-output') {
    return {
      label: 'WRAPPED OUTPUT',
      description:
        'Workspace facts plus wrapped stdout. Tool commands are not native; test results may be heuristic.',
      timingLabel,
      tone: 'wrapped',
      sourceLine: 'Workspace facts + wrapped command/output · tool semantics are heuristic',
    }
  }
  return {
    label: 'WORKSPACE ONLY',
    description:
      'Only file changes and the final git diff were observed. Agent reads, searches, and commands are not captured.',
    timingLabel,
    tone: 'workspace',
    sourceLine: 'Workspace facts only · no agent tool stream',
  }
}
