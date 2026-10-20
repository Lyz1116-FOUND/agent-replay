import { useMemo } from 'react'
import { demoRuns } from '../data/runs'
import type { Trace } from '../schema/trace'
import { useRunsStore } from '../store/runs'
import { leafSpans, traceFiles } from './trace'

export function useAllRuns(): Trace[] {
  const imported = useRunsStore((state) => state.imported)
  const transient = useRunsStore((state) => state.transient)
  return useMemo(() => {
    const byId = new Map<string, Trace>()
    for (const run of [...demoRuns, ...imported, ...transient]) byId.set(run.id, run)
    return [...byId.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  }, [imported, transient])
}

export function useRunById(id: string | undefined): Trace | undefined {
  const runs = useAllRuns()
  return useMemo(() => runs.find((run) => run.id === id), [runs, id])
}

export type RunStats = {
  steps: number
  /** null when the trace never observed the workspace (e.g. an OTel import). */
  files: number | null
  edits: number
  testRuns: number
  tokens: number
}

export function runStats(trace: Trace): RunStats {
  const spans = leafSpans(trace)
  const observedWorkspace = trace.capture?.fidelity !== 'otel'
  return {
    steps: spans.length,
    files:
      trace.result.filesChanged?.length ??
      (observedWorkspace ? traceFiles(trace).length : null),
    edits: spans.filter((span) => span.type === 'edit').length,
    testRuns: spans.filter((span) => span.type === 'test').length,
    tokens: spans.reduce((total, span) => {
      const value = span.attributes?.tokens
      return total + (typeof value === 'number' ? value : 0)
    }, 0),
  }
}
