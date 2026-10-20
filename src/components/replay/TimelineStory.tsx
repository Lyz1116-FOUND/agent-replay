import { useEffect, useRef } from 'react'
import type { Span } from '../../schema/trace'
import { formatSpanDuration, groupSpansByPhase, spanProgress } from '../../lib/trace'
import { detectRecovery } from '../../lib/story'
import { useReplayStore } from '../../store/replay'
import { SpanIcon } from '../spanMeta'
import { clsx } from 'clsx'
import { phaseLabel, spanLabel, useT } from '../../i18n'

export function TimelineStory({ spans }: { spans: Span[] }) {
  const t = useT()
  const currentSpanId = useReplayStore((state) => state.currentSpanId)
  const hoveredSpanId = useReplayStore((state) => state.hoveredSpanId)
  const seekToSpan = useReplayStore((state) => state.seekToSpan)
  const setHovered = useReplayStore((state) => state.setHovered)
  const trace = useReplayStore((state) => state.trace)
  const recovery = trace ? detectRecovery(trace) : null
  const groups = groupSpansByPhase(spans)
  const indexById = new Map(spans.map((span, index) => [span.id, index + 1]))
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-span-id="${currentSpanId}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [currentSpanId])

  return (
    <div ref={listRef} className="px-2 pb-4">
      {groups.map((group, groupIndex) => (
        <div key={`${group.phase}-${groupIndex}`}>
          <div className="flex items-center gap-2 px-2 pb-1 pt-3">
            <span className="eyebrow">{phaseLabel(group.phase)}</span>
            <span className="h-px flex-1 bg-line/70" />
            <span className="font-mono text-[9.5px] text-faint">{group.spans.length}</span>
          </div>
          {group.spans.map((span) => {
            const index = indexById.get(span.id) ?? 0
            const current = span.id === currentSpanId
            const hovered = span.id === hoveredSpanId
            return (
              <button
                key={span.id}
                data-span-id={span.id}
                onMouseEnter={() => setHovered(span.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => seekToSpan(span.id)}
                className={clsx(
                  'relative flex w-full items-start gap-2 rounded-xs px-2 py-1.5 text-left transition-colors',
                  current
                    ? 'bg-accent/[0.09]'
                    : hovered
                      ? 'bg-panel2 ring-1 ring-inset ring-accent/25'
                      : 'hover:bg-panel2/70',
                )}
              >
                {current ? (
                  <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-accent" />
                ) : null}
                <span className="mt-[3px] w-4 shrink-0 text-right font-mono text-[9.5px] text-faint">
                  {String(index).padStart(2, '0')}
                </span>
                <span className="mt-[1px] shrink-0">
                  <SpanIcon type={span.type} size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={clsx(
                        'truncate text-[12px]',
                        current ? 'text-ink' : 'text-[#c3cbd7]',
                      )}
                    >
                      {span.name}
                    </span>
                    {recovery?.regressionAt?.span.id === span.id ? (
                      <span className="shrink-0 rounded-xs border border-fail/30 px-1 font-mono text-[7.5px] uppercase tracking-wide text-fail">
                        {t('overview.story.regression')}
                      </span>
                    ) : null}
                    {recovery?.recoveredAt.span.id === span.id ? (
                      <span className="shrink-0 rounded-xs border border-pass/30 px-1 font-mono text-[7.5px] uppercase tracking-wide text-pass">
                        {t('overview.story.recovered')}
                      </span>
                    ) : null}
                    {span.status === 'error' ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fail" />
                    ) : span.status === 'warning' ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] leading-[1.4] text-faint">
                    {span.summary ?? spanLabel(span.type)}
                  </span>
                  {current ? <StepProgress span={span} /> : null}
                </span>
                <span className="mt-[2px] shrink-0 font-mono text-[9.5px] text-faint">
                  {formatSpanDuration(span)}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function StepProgress({ span }: { span: Span }) {
  const playheadMs = useReplayStore((state) => state.playheadMs)
  const progress = spanProgress(span, playheadMs)
  return (
    <span className="mt-1.5 block h-[2px] overflow-hidden rounded-full bg-panel3">
      <span
        className="block h-full bg-accent/70"
        style={{ width: `${progress * 100}%` }}
      />
    </span>
  )
}
