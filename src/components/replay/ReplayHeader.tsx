import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Clock, FileCode2, GitCompare, ListTree, Rows3 } from 'lucide-react'
import type { Trace } from '../../schema/trace'
import { formatDuration, isEstimatedTiming } from '../../lib/trace'
import { runStats } from '../../lib/runs'
import { detectRecovery } from '../../lib/story'
import { AgentBadge, StatusPill } from '../ui/primitives'

export function ReplayHeader({
  trace,
  onOverview,
}: {
  trace: Trace
  onOverview?: () => void
}) {
  const stats = runStats(trace)
  const estimated = isEstimatedTiming(trace)
  const recovery = detectRecovery(trace)

  return (
    <div className="flex h-[58px] shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
      <Link
        to="/"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-transparent text-muted transition-colors hover:border-line hover:bg-panel2 hover:text-ink"
        aria-label="Back to runs"
        title="Back to runs"
      >
        <ArrowLeft size={15} />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[13px] font-medium text-ink">{trace.task.title}</h1>
          <StatusPill status={trace.status} />
          {recovery && onOverview ? (
            <button
              onClick={onOverview}
              className="hidden shrink-0 items-center gap-1 rounded-xs border border-pass/30 bg-pass/[0.04] px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-pass transition-colors enabled:hover:bg-pass/10 sm:flex"
              title={recovery.summary}
            >
              <CheckCircle2 size={9} />
              recovery detected
            </button>
          ) : null}
          {estimated ? (
            <span className="hidden shrink-0 rounded-xs border border-warn/35 px-1 font-mono text-[8.5px] uppercase tracking-wide text-warn sm:inline">
              estimated timing
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[10px]">
          <span className="truncate font-mono text-faint">
            {trace.task.repo ?? trace.task.id}
            <span className="mx-1 text-line-strong">/</span>
            {trace.task.id}
          </span>
          <span className="hidden text-line-strong sm:inline">·</span>
          <span className="hidden sm:inline">
            <AgentBadge name={trace.agent.name} model={trace.agent.model} />
          </span>
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-4 md:flex">
        <HeaderStat icon={<Clock size={11} />} value={formatDuration(trace.durationMs)} />
        <HeaderStat icon={<ListTree size={11} />} value={`${stats.steps} steps`} />
        <HeaderStat icon={<FileCode2 size={11} />} value={stats.files === null ? 'files n/a' : `${stats.files} changed`} />
      </div>

      {onOverview ? (
        <button
          onClick={onOverview}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-line bg-panel px-2.5 text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink"
          title="Overview"
        >
          <Rows3 size={12} />
          <span className="hidden sm:inline">Overview</span>
        </button>
      ) : null}

      <Link
        to={`/compare?task=${encodeURIComponent(trace.task.id)}`}
        aria-label="Compare runs for this task"
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-line bg-panel px-2.5 text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink"
      >
        <GitCompare size={12} />
        <span className="hidden sm:inline">Compare</span>
      </Link>
    </div>
  )
}

function HeaderStat({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
      <span className="text-faint">{icon}</span>
      {value}
    </span>
  )
}
