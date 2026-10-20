import type { Termination, Trace } from '../schema/trace'
import { t, tn } from '../i18n'

export type CaptureInfo = {
  label: string
  description: string
  timingLabel: string
  /** Stable key for styling; the label itself is localized. */
  timingTone: 'observed' | 'exporter' | 'mixed' | 'estimated'
  tone: 'native' | 'wrapped' | 'workspace' | 'otel'
  sourceLine: string
}

/** Kinds where the model never got a fair attempt at the task. */
const UNAVAILABLE_KEYS: Record<string, 'termination.provider' | 'termination.rateLimited' | 'termination.authFailed' | 'termination.recorderError'> = {
  provider_unavailable: 'termination.provider',
  rate_limited: 'termination.rateLimited',
  permission_denied: 'termination.authFailed',
  recorder_error: 'termination.recorderError',
}

export function terminationLabel(termination: Termination | undefined): string | null {
  if (!termination) return null
  const key = UNAVAILABLE_KEYS[termination.kind]
  return key ? t(key) : null
}

function recallLine(trace: Trace): string {
  const integrity = trace.capture?.integrity
  if (!integrity) return ''
  const parts: string[] = []
  if (integrity.nativeEdits > 0) {
    const confirmed = integrity.confirmedEdits ?? integrity.matchedEdits
    parts.push(
      t('capture.recall.edit', { confirmed, native: integrity.nativeEdits }),
    )
    if ((integrity.supersededEdits ?? 0) > 0) {
      parts.push(tn('capture.recall.superseded', integrity.supersededEdits ?? 0))
    }
  }
  if (integrity.nativeTestRuns > 0) {
    parts.push(
      t('capture.recall.test', {
        parsed: integrity.parsedTestRuns,
        native: integrity.nativeTestRuns,
      }),
    )
  }
  if (integrity.outsideWorkspaceEdits > 0) {
    parts.push(tn('capture.recall.outside', integrity.outsideWorkspaceEdits))
  }
  return parts.join(' · ')
}

export function captureInfo(trace: Trace): CaptureInfo | null {
  const capture = trace.capture
  if (!capture) return null
  const verified = capture.workspaceVerified ?? 0
  const unverified = capture.unverifiedEdits ?? 0
  const verification =
    verified > 0 ? tn('capture.nativeWorkspace.verified', verified) : ''
  const gap = unverified > 0 ? tn('capture.nativeWorkspace.gap', unverified) : ''
  const timingTone =
    capture.timing === 'mixed' ? 'mixed' : capture.timing === 'estimated' ? 'estimated' : 'observed'
  const timingLabel =
    timingTone === 'mixed'
      ? t('capture.timing.mixed')
      : timingTone === 'estimated'
        ? t('capture.timing.estimated')
        : t('capture.timing.observed')
  const recall = recallLine(trace)

  if (capture.fidelity === 'otel') {
    const workspaceVerified = capture.workspaceVerification === 'verified'
    return {
      label: t('capture.otel'),
      description: workspaceVerified
        ? t('capture.otelVerified.desc')
        : t('capture.otel.desc'),
      timingLabel: t('capture.timing.exporter'),
      timingTone: 'exporter',
      tone: 'otel',
      sourceLine: workspaceVerified
        ? t('capture.source.otelVerified')
        : t('capture.source.otel'),
    }
  }
  if (capture.fidelity === 'native+workspace') {
    return {
      label: t('capture.nativeWorkspace'),
      description: t('capture.nativeWorkspace.desc', { verified: verification, gap }).trim(),
      timingLabel,
      timingTone,
      tone: 'native',
      sourceLine: t('capture.source.nativeWorkspace', {
        verified: verified ? t('capture.source.nativeWorkspace.verified', { count: verified }) : '',
        unverified: unverified
          ? t('capture.source.nativeWorkspace.unverified', { count: unverified })
          : '',
        recall: recall ? ` · ${recall}` : '',
      }),
    }
  }
  if (capture.fidelity === 'native-events') {
    return {
      label: t('capture.nativeEvents'),
      description: t('capture.nativeEvents.desc'),
      timingLabel,
      timingTone,
      tone: 'native',
      sourceLine: t('capture.source.nativeEvents'),
    }
  }
  if (capture.fidelity === 'wrapped-output') {
    return {
      label: t('capture.wrapped'),
      description: t('capture.wrapped.desc'),
      timingLabel,
      timingTone,
      tone: 'wrapped',
      sourceLine: t('capture.source.wrapped'),
    }
  }
  return {
    label: t('capture.workspace'),
    description: t('capture.workspace.desc'),
    timingLabel,
    timingTone,
    tone: 'workspace',
    sourceLine: t('capture.source.workspace'),
  }
}
