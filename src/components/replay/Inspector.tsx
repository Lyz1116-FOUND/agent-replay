import { clsx } from 'clsx'
import { ArrowDown, ArrowUp, CornerDownRight, FileCode2 } from 'lucide-react'
import {
  SPAN_LABELS,
  STATUS_COLORS,
  formatClock,
  formatSpanDuration,
} from '../../lib/trace'
import { artifactDetail, artifactLabel } from '../../lib/artifacts'
import { useReplayStore } from '../../store/replay'
import { useCurrentSpan } from '../../store/hooks'
import { SpanIcon } from '../spanMeta'

const HIDDEN_ATTRIBUTES = ['phase', 'tool', 'tokens', 'estimatedTiming']

export function Inspector() {
  const span = useCurrentSpan()
  const spans = useReplayStore((state) => state.spans)
  const trace = useReplayStore((state) => state.trace)
  const hoveredSpanId = useReplayStore((state) => state.hoveredSpanId)
  const seekToSpan = useReplayStore((state) => state.seekToSpan)
  const setStageView = useReplayStore((state) => state.setStageView)
  const setWorkspaceFile = useReplayStore((state) => state.setWorkspaceFile)

  if (!span) {
    return <aside className="w-[304px] shrink-0 border-l border-line bg-canvas" />
  }

  const index = spans.findIndex((item) => item.id === span.id)
  const previous = index > 0 ? spans[index - 1] : null
  const next = index < spans.length - 1 ? spans[index + 1] : null
  const hovered = spans.find((item) => item.id === hoveredSpanId)
  const preview = hovered && hovered.id !== span.id ? hovered : null
  const estimated = span.attributes?.estimatedTiming === true
  const parent = span.parentId ? spans.find((item) => item.id === span.parentId) : undefined
  const childCount = spans.filter((item) => item.parentId === span.id).length
  const visibleAttributes = Object.entries(span.attributes ?? {}).filter(
    ([key]) => !HIDDEN_ATTRIBUTES.includes(key),
  )

  return (
    <aside className="flex w-[304px] shrink-0 flex-col border-l border-line bg-canvas">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="eyebrow">Inspector</span>
        <span className="ml-auto font-mono text-[9.5px] text-faint">{span.id}</span>
      </div>

      <div className="panel-scroll min-h-0 flex-1">
        {preview ? (
          <button
            onClick={() => seekToSpan(preview.id)}
            className="flex w-full items-center gap-2 border-b border-accent/20 bg-accent/[0.05] px-3 py-2 text-left transition-colors hover:bg-accent/[0.08]"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="eyebrow text-accent/70">Preview</span>
            <span className="truncate text-[11px] text-muted">{preview.name}</span>
          </button>
        ) : null}

        <div className="border-b border-line px-3.5 py-4">
          <div className="flex items-center gap-2">
            <span
              className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em]"
              style={{ color: STATUS_COLORS[span.status] }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[span.status] }}
              />
              {span.status}
            </span>
            {estimated ? (
              <span className="rounded-xs border border-warn/35 bg-warn/[0.06] px-1 font-mono text-[8.5px] uppercase tracking-wide text-warn">
                estimated timing
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 flex items-start gap-2">
            <span className="mt-1 shrink-0">
              <SpanIcon type={span.type} size={14} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[13.5px] font-medium leading-snug text-ink">{span.name}</h2>
              <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">
                {SPAN_LABELS[span.type]}
              </div>
            </div>
          </div>

          {span.summary ? (
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted">{span.summary}</p>
          ) : null}
        </div>

        <FieldSection
          rows={[
            ['Start', formatClock(span.startMs)],
            ['Duration', formatSpanDuration(span)],
            [
              'Timing',
              typeof span.attributes?.timingKind === 'string'
                ? typeof span.attributes?.timingResolutionMs === 'number'
                  ? `${span.attributes.timingKind} · ${span.attributes.timingResolutionMs}ms polling`
                  : span.attributes.timingKind
                : '—',
            ],
            ['Phase', typeof span.attributes?.phase === 'string' ? span.attributes.phase : '—'],
            ['Tool', typeof span.attributes?.tool === 'string' ? span.attributes.tool : '—'],
            ['Tokens', typeof span.attributes?.tokens === 'number' ? span.attributes.tokens.toLocaleString() : '—'],
            [
              'Parent',
              parent
                ? parent.name
                : span.parentId
                  ? `${span.parentId} (not in export)`
                  : '—',
            ],
            ['Children', childCount > 0 ? String(childCount) : '—'],
            ['Status', span.status],
          ]}
        />

        {span.files && span.files.length > 0 ? (
          <div className="border-b border-line px-3.5 py-3">
            <div className="eyebrow mb-1.5">Files</div>
            <div className="space-y-0.5">
              {span.files.map((path) => (
                <button
                  key={path}
                  onClick={() => {
                    setWorkspaceFile(path)
                    setStageView('workspace')
                  }}
                  className="flex w-full items-center gap-1.5 rounded-xs px-1 py-1 text-left font-mono text-[10px] text-muted transition-colors hover:bg-panel2 hover:text-ink"
                  title="Show in workspace"
                >
                  <FileCode2 size={10} className="shrink-0 text-faint" />
                  <span className="truncate">{path}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="border-b border-line px-3.5 py-3">
          <div className="eyebrow mb-2">Causal chain</div>
          <CauseRow
            icon={<ArrowUp size={11} />}
            label="Why this step"
            text={previous ? previous.summary ?? previous.name : 'Run begins with this step.'}
            muted
          />
          <CauseRow
            icon={<CornerDownRight size={11} />}
            label="What followed"
            text={
              next
                ? `${next.name}${next.status === 'error' ? ' → error' : next.status === 'ok' ? '' : ` → ${next.status}`}`
                : trace?.result.summary ?? 'Run ends here.'
            }
          />
        </div>

        {visibleAttributes.length > 0 ? (
          <div className="border-b border-line px-3.5 py-3">
            <div className="eyebrow mb-2">Attributes</div>
            <div className="space-y-1">
              {visibleAttributes.map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-[10px] text-faint">{key}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted">
                    {Array.isArray(value)
                      ? value.join(', ')
                      : typeof value === 'boolean'
                        ? String(value)
                        : value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {span.artifacts && span.artifacts.length > 0 ? (
          <div className="border-b border-line px-3.5 py-3">
            <div className="eyebrow mb-2">Artifacts</div>
            <div className="space-y-1">
              {span.artifacts.map((artifact, artifactIndex) => (
                <div
                  key={`${artifact.kind}-${artifactIndex}`}
                  className="flex items-center gap-2 rounded-xs border border-line/70 bg-panel px-2 py-1.5"
                >
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-faint">
                    {artifact.kind}
                  </span>
                  <span className="truncate font-mono text-[10px] text-muted">
                    {artifactLabel(artifact)}
                  </span>
                  {artifactDetail(artifact) ? (
                    <span className="ml-auto shrink-0 font-mono text-[9px] text-faint">
                      {artifactDetail(artifact)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <details className="group px-3.5 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10.5px] text-faint transition-colors hover:text-muted">
            <ArrowDown size={10} className="transition-transform group-open:rotate-180" />
            Raw span JSON
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-sm border border-line bg-[#0b0e13] p-2 font-mono text-[9.5px] leading-relaxed text-muted">
            {JSON.stringify(span, null, 2)}
          </pre>
        </details>
      </div>
    </aside>
  )
}

function FieldSection({ rows }: { rows: [string, string][] }) {
  return (
    <div className="border-b border-line px-3.5 py-3">
      <div className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-[10.5px] text-faint">{label}</span>
            <span
              className={clsx(
                'truncate font-mono text-[10.5px]',
                value === '—' ? 'text-faint' : 'text-[#c4ccd7]',
              )}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CauseRow({
  icon,
  label,
  text,
  muted = false,
}: {
  icon: React.ReactNode
  label: string
  text: string
  muted?: boolean
}) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-center gap-1.5 text-[9.5px] text-faint">
        {icon}
        {label}
      </div>
      <p className={clsx('mt-1 pl-[17px] text-[11px] leading-relaxed', muted ? 'text-muted' : 'text-[#c4ccd7]')}>
        {text}
      </p>
    </div>
  )
}
