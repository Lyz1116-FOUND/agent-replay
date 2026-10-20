import type { Trace } from '../schema/trace'

export type TraceDraft = Omit<Trace, 'schemaVersion' | 'endedAt' | 'durationMs'>

export function finalizeTrace(draft: TraceDraft): Trace {
  const durationMs = Math.max(...draft.spans.map((span) => span.endMs), 0)
  return {
    ...draft,
    schemaVersion: 'agent-replay/v1',
    durationMs,
    endedAt: new Date(Date.parse(draft.startedAt) + durationMs).toISOString(),
  }
}
