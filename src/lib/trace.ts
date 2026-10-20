import type { Span, SpanType, Trace } from '../schema/trace'

export const SPAN_LABELS: Record<SpanType, string> = {
  agent: 'Agent',
  generation: 'LLM',
  reasoning: 'Reasoning',
  read: 'Read',
  search: 'Search',
  edit: 'Edit',
  shell: 'Shell',
  test: 'Test',
  browser: 'Browser',
  tool: 'Tool',
  unknown: 'Span',
  checkpoint: 'Checkpoint',
  final: 'Final',
}

export const SPAN_COLORS: Record<SpanType, string> = {
  agent: '#8f98a6',
  generation: '#d2a8ff',
  reasoning: '#d29922',
  read: '#4d9bff',
  search: '#39c5cf',
  edit: '#a371f7',
  shell: '#8f98a6',
  test: '#3fb950',
  browser: '#db6d28',
  tool: '#7d8590',
  unknown: '#5d6675',
  checkpoint: '#6e7681',
  final: '#3fb950',
}

export const TIMELINE_LANES: SpanType[] = [
  'generation',
  'reasoning',
  'read',
  'search',
  'edit',
  'shell',
  'test',
  'final',
]

export function orderSpans(spans: Span[]): Span[] {
  return [...spans].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
}

export function leafSpans(trace: Trace): Span[] {
  const parentIds = new Set(trace.spans.map((span) => span.parentId).filter(Boolean))
  const leaves = trace.spans.filter((span) => !parentIds.has(span.id))
  return orderSpans(leaves.length > 0 ? leaves : trace.spans)
}

/**
 * Everything the playhead can stop on, parents included. `leafSpans` answers
 * "which steps actually did something"; this answers "which spans exist", so a
 * nested import keeps its containers selectable instead of only its leaves.
 */
export function playbackSpans(trace: Trace): Span[] {
  return orderSpans(trace.spans)
}

/** Depth in the parent chain. Missing parents count as roots. */
export function spanDepths(spans: Span[]): Map<string, number> {
  const byId = new Map(spans.map((span) => [span.id, span]))
  const depths = new Map<string, number>()
  for (const span of spans) {
    let depth = 0
    const seen = new Set<string>([span.id])
    let cursor = span.parentId
    while (cursor && !seen.has(cursor)) {
      const parent = byId.get(cursor)
      if (!parent) break
      seen.add(cursor)
      depth += 1
      cursor = parent.parentId
    }
    depths.set(span.id, depth)
  }
  return depths
}

export function spanParent(span: Span, spans: Span[]): Span | undefined {
  if (!span.parentId) return undefined
  return spans.find((item) => item.id === span.parentId)
}

/**
 * Greedy interval packing. Overlapping spans (same type or not) land on
 * separate rows so the flame view never hides one behind another; the spans
 * themselves keep their real start/end.
 */
export function packSpanRows(spans: Span[]): Span[][] {
  const rows: Span[][] = []
  for (const span of orderSpans(spans)) {
    const row = rows.find((candidate) => candidate[candidate.length - 1].endMs <= span.startMs)
    if (row) row.push(span)
    else rows.push([span])
  }
  return rows
}

export function spanAtTime(spans: Span[], ms: number): Span {
  let current = spans[0]
  for (const span of spans) {
    if (span.startMs <= ms) current = span
    else break
  }
  return current
}

export function spanEnd(trace: Trace): number {
  return Math.max(trace.durationMs, ...trace.spans.map((span) => span.endMs))
}

export function spanProgress(span: Span, ms: number): number {
  const duration = Math.max(span.endMs - span.startMs, 1)
  return Math.min(Math.max((ms - span.startMs) / duration, 0), 1)
}

export function spanDuration(span: Span): number {
  return Math.max(span.endMs - span.startMs, 0)
}

export function formatSpanDuration(span: Span): string {
  if (span.attributes?.instant === true) return 'instant'
  return formatDuration(spanDuration(span))
}

export function spanVisualDuration(span: Span): number {
  const visual = span.attributes?.visualDurationMs
  return typeof visual === 'number' ? Math.max(spanDuration(span), visual) : spanDuration(span)
}

export function spanPhase(span: Span): string {
  const phase = span.attributes?.phase
  return typeof phase === 'string' ? phase : 'Steps'
}

export type PhaseGroup = { phase: string; spans: Span[] }

export function groupSpansByPhase(spans: Span[]): PhaseGroup[] {
  const groups: PhaseGroup[] = []
  for (const span of spans) {
    const phase = spanPhase(span)
    const last = groups[groups.length - 1]
    if (last && last.phase === phase) last.spans.push(span)
    else groups.push({ phase, spans: [span] })
  }
  return groups
}

export function formatClock(ms: number): string {
  const safe = Math.max(ms, 0)
  const totalSeconds = Math.floor(safe / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const tenths = Math.floor((safe % 1000) / 100)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function formatStartedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export type FileActivity = {
  path: string
  spans: Span[]
  reads: Span[]
  edits: Span[]
  firstTouchMs: number
  lastTouchMs: number
}

export function buildFileIndex(trace: Trace): FileActivity[] {
  const map = new Map<string, FileActivity>()
  for (const span of leafSpans(trace)) {
    for (const path of span.files ?? []) {
      const entry =
        map.get(path) ??
        ({
          path,
          spans: [],
          reads: [],
          edits: [],
          firstTouchMs: span.startMs,
          lastTouchMs: span.endMs,
        } satisfies FileActivity)
      entry.spans.push(span)
      entry.firstTouchMs = Math.min(entry.firstTouchMs, span.startMs)
      entry.lastTouchMs = Math.max(entry.lastTouchMs, span.endMs)
      if (span.type === 'read') entry.reads.push(span)
      if (span.type === 'edit') entry.edits.push(span)
      map.set(path, entry)
    }
  }
  return [...map.values()].sort(
    (a, b) => a.firstTouchMs - b.firstTouchMs || a.path.localeCompare(b.path),
  )
}

export function traceFiles(trace: Trace): string[] {
  return [...new Set(trace.spans.flatMap((span) => span.files ?? []))].sort()
}

export function sumAttribute(trace: Trace, key: string): number {
  return trace.spans.reduce((total, span) => {
    const value = span.attributes?.[key]
    return total + (typeof value === 'number' ? value : 0)
  }, 0)
}

export function isEstimatedTiming(trace: Trace): boolean {
  if (trace.metadata?.estimatedTiming === true) return true
  return trace.spans.some((span) => span.attributes?.estimatedTiming === true)
}

export const STATUS_COLORS = {
  pass: 'var(--color-pass)',
  fail: 'var(--color-fail)',
  partial: 'var(--color-warn)',
  running: 'var(--color-accent)',
  ok: 'var(--color-pass)',
  error: 'var(--color-fail)',
  warning: 'var(--color-warn)',
  unset: 'var(--color-faint)',
} as const
