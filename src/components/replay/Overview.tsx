import { Fragment } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Flag,
  FlaskConical,
  Info,
  Pencil,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { Trace } from '../../schema/trace'
import { formatClock, formatDuration, isEstimatedTiming } from '../../lib/trace'
import { runStats } from '../../lib/runs'
import { captureInfo, terminationLabel } from '../../lib/capture'
import {
  buildStory,
  detectRecovery,
  storyHeadline,
  testResults,
  type StoryNode,
} from '../../lib/story'
import { AgentBadge, Button, Kbd, StatusPill } from '../ui/primitives'

export function Overview({
  trace,
  onOpenDetail,
  onOpenSpan,
}: {
  trace: Trace
  onOpenDetail: () => void
  onOpenSpan: (spanId?: string) => void
}) {
  const stats = runStats(trace)
  const tests = testResults(trace)
  const recovery = detectRecovery(trace)
  const story = buildStory(trace)
  const estimated = isEstimatedTiming(trace)
  const recorded = trace.metadata?.source === 'recorder'
  const capture = captureInfo(trace)

  return (
    <div className="panel-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[960px] px-8 py-9">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="eyebrow">Replay overview</div>
            <h1 className="mt-2 max-w-[680px] text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {trace.task.title}
            </h1>
            <p className="mt-2 max-w-[620px] text-[12.5px] leading-relaxed text-muted">
              {trace.task.description ?? trace.result.summary}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <AgentBadge name={trace.agent.name} model={trace.agent.model} />
              <StatusPill status={trace.status} label={terminationLabel(trace.termination) ?? undefined} />
              {capture ? (
                <>
                  <span
                    title={capture.description}
                    className={clsx(
                      'rounded-xs border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide',
                      capture.tone === 'native' && 'border-accent/30 bg-accent/[0.05] text-accent/90',
                      capture.tone === 'wrapped' && 'border-warn/30 bg-warn/[0.04] text-warn/90',
                      capture.tone === 'otel' && 'border-line-strong bg-panel2 text-muted',
                      capture.tone === 'workspace' && 'border-line text-muted',
                    )}
                  >
                    {capture.label}
                  </span>
                  <span
                    title={capture.description}
                    className={clsx(
                      'rounded-xs border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide',
                      capture.timingLabel === 'OBSERVED TIMING' ||
                        capture.timingLabel === 'EXPORTER TIMING'
                        ? 'border-line text-faint'
                        : 'border-warn/35 text-warn',
                    )}
                  >
                    {capture.timingLabel}
                  </span>
                </>
              ) : estimated ? (
                <span className="rounded-xs border border-warn/35 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-warn">
                  estimated timing
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="subtle" onClick={onOpenDetail}>
              Open detailed replay
              <ArrowRight size={13} />
            </Button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 divide-x divide-line overflow-hidden rounded-md border border-line bg-panel sm:grid-cols-5">
          <Stat label="Duration" value={formatDuration(trace.durationMs)} />
          <Stat label="Steps" value={String(stats.steps)} />
          <Stat label="Edits" value={String(stats.edits)} />
          <Stat label="Test runs" value={String(stats.testRuns)} />
          <Stat label="Files changed" value={stats.files === null ? '—' : String(stats.files)} />
        </div>

        {recovery ? (
          <div className="mt-5 flex flex-col gap-3 rounded-sm border border-pass/30 bg-pass/[0.04] px-4 py-3 sm:flex-row sm:items-center">
            <CheckCircle2 size={17} className="shrink-0 text-pass" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-ink">
                Recovery detected
                {recovery.regression ? (
                  <span className="ml-2 rounded-xs border border-fail/30 px-1 font-mono text-[8.5px] uppercase tracking-wide text-fail">
                    regression first
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-muted">
                {recovery.summary}
              </div>
            </div>
            <button
              onClick={() => onOpenSpan(recovery.recoveredAt.span.id)}
              className="inline-flex shrink-0 items-center gap-1 self-start rounded-sm border border-pass/30 px-2 py-1 text-[10.5px] text-pass transition-colors hover:bg-pass/10 sm:self-auto"
            >
              Jump to recovery
              <ArrowRight size={11} />
            </button>
          </div>
        ) : tests.some((result) => result.failed > 0) ? (
          <div className="mt-5 flex items-center gap-2.5 rounded-sm border border-fail/25 bg-fail/[0.03] px-4 py-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-fail" />
            <span className="text-[11.5px] text-muted">
              No passing test run was recorded. {storyHeadline(trace)}
            </span>
          </div>
        ) : null}

        <div className="mt-9">
          <div className="flex items-end justify-between">
            <div>
              <div className="eyebrow">Story</div>
              <h2 className="mt-1.5 text-[15px] font-medium text-ink">
                The short version, step by step
              </h2>
            </div>
            <span className="font-mono text-[9.5px] text-faint">
              {story.length} beats · {trace.spans.length} steps · click a card to inspect
            </span>
          </div>

          <div className="mt-4 flex items-stretch overflow-x-auto pb-2">
            {story.map((node, index) => (
              <Fragment key={node.id}>
                {index > 0 ? (
                  <div className="flex w-5 shrink-0 items-center justify-center text-line-strong">
                    <ChevronRight size={14} />
                  </div>
                ) : null}
                <StoryCard node={node} onClick={() => onOpenSpan(node.spanId)} />
              </Fragment>
            ))}
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex items-center gap-2 text-[10.5px] text-faint">
            <Info size={12} className="text-faint" />
            {capture
              ? capture.sourceLine
              : recorded
                ? 'Recorded with agent-replay · normalized from git, workspace, and command output'
                : trace.metadata?.source === 'swe-agent'
                  ? 'Imported SWE-agent trajectory · timing is estimated'
                  : 'Trace data · all views share the same playhead'}
          </div>
          <span className="flex items-center gap-1.5 text-[9.5px] text-faint">
            <Kbd>enter</Kbd>
            detailed replay
          </span>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-mono text-[17px] text-ink">{value}</div>
    </div>
  )
}

function StoryCard({ node, onClick }: { node: StoryNode; onClick: () => void }) {
  const Icon = node.kind === 'test' ? FlaskConical : node.kind === 'edit' ? Pencil : Flag
  return (
    <button
      onClick={onClick}
      className={clsx(
        'group flex min-w-[142px] max-w-[200px] flex-1 flex-col rounded-sm border px-3 py-2.5 text-left transition-colors',
        node.tone === 'fail' && 'border-fail/30 bg-fail/[0.035] hover:border-fail/60',
        node.tone === 'pass' && 'border-pass/30 bg-pass/[0.03] hover:border-pass/60',
        node.tone === 'edit' && 'border-line bg-panel hover:border-edit/50',
        node.tone === 'neutral' && 'border-line bg-panel hover:border-line-strong',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[8.5px] text-faint">
          {String(node.step).padStart(2, '0')} · {formatClock(node.timeMs)}
        </span>
        {node.regression ? (
          <span className="rounded-xs border border-fail/30 px-1 font-mono text-[8px] uppercase tracking-wide text-fail">
            regression
          </span>
        ) : node.recovered ? (
          <span className="rounded-xs border border-pass/30 px-1 font-mono text-[8px] uppercase tracking-wide text-pass">
            recovered
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span
          className={clsx(
            'shrink-0',
            node.tone === 'fail' && 'text-fail',
            node.tone === 'pass' && 'text-pass',
            node.tone === 'edit' && 'text-edit',
            node.tone === 'neutral' && 'text-muted',
          )}
        >
          <Icon size={12} strokeWidth={1.75} />
        </span>
        <span className="truncate text-[11.5px] font-medium text-ink">{node.title}</span>
      </div>
      <div
        className={clsx(
          'mt-1 truncate font-mono text-[9.5px]',
          node.tone === 'fail' ? 'text-fail/85' : node.tone === 'pass' ? 'text-pass/85' : 'text-muted',
        )}
      >
        {node.detail}
      </div>
    </button>
  )
}
