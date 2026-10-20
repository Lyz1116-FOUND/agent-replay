import type { Span, SpanType, Trace } from '../schema/trace'

export const SPAN_LABELS: Record<SpanType, string> = {
  agent: 'Agent',
  reasoning: 'Reasoning',
  read: 'Read',
  search: 'Search',
  edit: 'Edit',
  shell: 'Shell',
  test: 'Test',
  browser: 'Browser',
  tool: 'Tool',
  checkpoint: 'Checkpoint',
  final: 'Final',
}

export const SPAN_COLORS: Record<SpanType, string> = {
  agent: '#8f98a6',
  reasoning: '#d29922',
  read: '#4d9bff',
  search: '#39c5cf',
  edit: '#a371f7',
  shell: '#8f98a6',
  test: '#3fb950',
  browser: '#db6d28',
  tool: '#7d8590',
  checkpoint: '#6e7681',
  final: '#3fb950',
}

export const TIMELINE_LANES: SpanType[] = [
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
} as const
