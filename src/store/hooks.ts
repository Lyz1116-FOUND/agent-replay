import { useMemo } from 'react'
import type { Span } from '../schema/trace'
import { useReplayStore } from './replay'

export function useCurrentSpan(): Span | null {
  const currentSpanId = useReplayStore((state) => state.currentSpanId)
  const spans = useReplayStore((state) => state.spans)
  return useMemo(
    () => spans.find((span) => span.id === currentSpanId) ?? spans[0] ?? null,
    [spans, currentSpanId],
  )
}
