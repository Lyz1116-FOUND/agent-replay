import { clsx } from 'clsx'
import type { Span, SpanType } from '../../schema/trace'
import { SPAN_COLORS, SPAN_LABELS, formatClock, formatSpanDuration, spanVisualDuration } from '../../lib/trace'
import { useReplayStore } from '../../store/replay'
import { detectRecovery } from '../../lib/story'
import { SpanIcon } from '../spanMeta'

const LANE_ORDER: SpanType[] = [
  'reasoning',
  'read',
  'search',
  'edit',
  'shell',
  'test',
  'tool',
  'checkpoint',
  'final',
  'browser',
  'agent',
]

const LANE_LABELS: Partial<Record<SpanType, string>> = {
  reasoning: 'Think',
  checkpoint: 'Check',
  browser: 'Web',
}

function tickStep(durationMs: number): number {
  const target = durationMs / 5
  const steps = [1000, 2000, 5000, 10_000, 15_000, 20_000, 30_000, 60_000, 120_000, 300_000]
  return steps.find((step) => step >= target) ?? steps[steps.length - 1]
}

export function TimelineFlame({ spans }: { spans: Span[] }) {
  const playheadMs = useReplayStore((state) => state.playheadMs)
  const currentSpanId = useReplayStore((state) => state.currentSpanId)
  const hoveredSpanId = useReplayStore((state) => state.hoveredSpanId)
  const seek = useReplayStore((state) => state.seek)
  const seekToSpan = useReplayStore((state) => state.seekToSpan)
  const pause = useReplayStore((state) => state.pause)
  const setHovered = useReplayStore((state) => state.setHovered)
  const trace = useReplayStore((state) => state.trace)
  const recovery = trace ? detectRecovery(trace) : null

  const duration = Math.max(...spans.map((span) => span.endMs), 1)
  const lanes = LANE_ORDER.filter((lane) => spans.some((span) => span.type === lane))
  const step = tickStep(duration)
  const ticks: number[] = []
  for (let time = 0; time <= duration; time += step) ticks.push(time)
  const playheadRatio = Math.min(playheadMs / duration, 1)
  const currentSpan = spans.find((span) => span.id === currentSpanId)

  function seekAt(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
    pause()
    seek(ratio * duration)
  }

  return (
    <div className="px-2 pb-5 pt-1">
      <div className="flex">
        <div className="w-[64px] shrink-0" />
        <div className="relative h-5 flex-1">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-faint"
              style={{ left: `${(tick / duration) * 100}%` }}
            >
              {tick === 0 ? '0' : `${Math.round(tick / 1000)}s`}
            </span>
          ))}
        </div>
      </div>

      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-[64px] right-0">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute inset-y-0 w-px bg-line/35"
              style={{ left: `${(tick / duration) * 100}%` }}
            />
          ))}
        </div>

        {lanes.map((lane) => {
          const laneSpans = spans.filter((span) => span.type === lane)
          const active = currentSpan?.type === lane
          return (
            <div key={lane} className="flex h-8 items-center">
              <div
                className={clsx(
                  'flex w-[64px] shrink-0 items-center gap-1.5 pr-2',
                  active ? 'text-ink' : 'text-faint',
                )}
              >
                <SpanIcon type={lane} size={11} />
                <span className="truncate text-[9.5px]">{LANE_LABELS[lane] ?? SPAN_LABELS[lane]}</span>
              </div>
              <div
                className="relative h-8 min-w-0 flex-1 cursor-crosshair border-l border-line/60"
                onPointerDown={seekAt}
              >
                {laneSpans.map((span) => {
                  const left = (span.startMs / duration) * 100
                  const width = (spanVisualDuration(span) / duration) * 100
                  const future = span.startMs > playheadMs
                  const current = span.id === currentSpanId
                  const hovered = span.id === hoveredSpanId
                  const color = SPAN_COLORS[span.type]
                  const showLabel = width > 16
                  return (
                    <button
                      key={span.id}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        pause()
                        seekToSpan(span.id)
                      }}
                      onMouseEnter={() => setHovered(span.id)}
                      onMouseLeave={() => setHovered(null)}
                      title={`${span.name} · ${formatSpanDuration(span)}${span.id === recovery?.recoveredAt.span.id ? ' · recovered' : span.id === recovery?.regressionAt?.span.id ? ' · regression' : ''}`}
                      className="absolute top-1/2 h-[14px] -translate-y-1/2 overflow-hidden rounded-[2px] border-l-2 text-left transition-opacity"
                      style={{
                        left: `${left}%`,
                        width: `max(3px, ${width}%)`,
                        backgroundColor: `color-mix(in srgb, ${color} 24%, transparent)`,
                        borderLeftColor: color,
                        opacity: future ? 0.35 : 1,
                        boxShadow:
                          span.id === recovery?.recoveredAt.span.id
                            ? 'inset 0 0 0 1px var(--color-pass)'
                            : span.id === recovery?.regressionAt?.span.id
                              ? 'inset 0 0 0 1px var(--color-fail)'
                              : span.status === 'error'
                                ? 'inset 0 0 0 1px var(--color-fail)'
                                : hovered
                                  ? `inset 0 0 0 1px ${color}`
                                  : undefined,
                        outline: current ? '1px solid var(--color-accent)' : undefined,
                        outlineOffset: current ? '1px' : undefined,
                      }}
                    >
                      {showLabel ? (
                        <span className="block truncate px-1 font-mono text-[8px] leading-[12px] text-ink/90">
                          {span.name}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div className="pointer-events-none absolute inset-y-0 left-[64px] right-0 top-0">
          <div
            className="absolute inset-y-0 w-px bg-accent/90"
            style={{ left: `${playheadRatio * 100}%` }}
          >
            <span className="absolute -left-[3px] -top-0 h-1.5 w-1.5 rotate-45 bg-accent" />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line/70 px-1 pt-2">
        <span className="font-mono text-[9.5px] text-faint">
          click lane to seek · blocks are spans
        </span>
        <span className="font-mono text-[9.5px] text-faint">{formatClock(playheadMs)}</span>
      </div>

      <div className="mt-3 border-t border-line/70 pt-2">
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="eyebrow">Span log</span>
          <span className="font-mono text-[9px] text-faint">{spans.length} events</span>
        </div>
        <div>
          {spans.map((span) => {
            const current = span.id === currentSpanId
            const hovered = span.id === hoveredSpanId
            return (
              <button
                key={span.id}
                onClick={() => {
                  pause()
                  seekToSpan(span.id)
                }}
                onMouseEnter={() => setHovered(span.id)}
                onMouseLeave={() => setHovered(null)}
                className={clsx(
                  'grid w-full grid-cols-[36px_12px_minmax(0,1fr)_40px] items-center gap-1.5 rounded-xs px-1 py-1 text-left transition-colors',
                  current
                    ? 'bg-accent/[0.09]'
                    : hovered
                      ? 'bg-panel2'
                      : 'hover:bg-panel2/60',
                )}
              >
                <span className="font-mono text-[8.5px] text-faint">
                  {formatClock(span.startMs)}
                </span>
                <SpanIcon type={span.type} size={10} />
                <span
                  className={clsx(
                    'truncate text-[10px]',
                    current ? 'text-ink' : 'text-muted',
                  )}
                >
                  {span.name}
                </span>
                <span className="text-right font-mono text-[8.5px] text-faint">
                  {formatSpanDuration(span)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
