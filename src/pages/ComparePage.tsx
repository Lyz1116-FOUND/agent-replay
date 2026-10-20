import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, GitCompare } from 'lucide-react'
import { clsx } from 'clsx'
import type { Trace, SpanType } from '../schema/trace'
import { useAllRuns } from '../lib/runs'
import {
  SPAN_COLORS,
  formatDuration,
  isEstimatedTiming,
  leafSpans,
  spanDuration,
  traceFiles,
} from '../lib/trace'
import { AgentBadge, StatusPill } from '../components/ui/primitives'
import { buildOutcomeSummary } from '../lib/story'
import { formatNumber, spanLabel, tn, useT } from '../i18n'

const FINGERPRINT_ORDER: SpanType[] = [
  'read',
  'search',
  'edit',
  'test',
  'shell',
  'reasoning',
  'checkpoint',
  'final',
  'tool',
  'browser',
]

type TaskGroup = { taskId: string; title: string; runs: Trace[] }

export function ComparePage() {
  const t = useT()
  const runs = useAllRuns()
  const [params, setParams] = useSearchParams()
  const taskParam = params.get('task')

  const tasks = useMemo<TaskGroup[]>(() => {
    const map = new Map<string, TaskGroup>()
    for (const run of runs) {
      const group = map.get(run.task.id) ?? {
        taskId: run.task.id,
        title: run.task.title,
        runs: [],
      }
      group.runs.push(run)
      map.set(run.task.id, group)
    }
    return [...map.values()].sort((a, b) => b.runs.length - a.runs.length)
  }, [runs])

  const activeTask = tasks.find((task) => task.taskId === taskParam) ?? tasks[0]
  const [selection, setSelection] = useState<{ taskId: string; ids: string[] } | null>(null)
  const defaultIds = activeTask ? activeTask.runs.slice(0, 4).map((run) => run.id) : []
  const selectedIds =
    selection && activeTask && selection.taskId === activeTask.taskId
      ? selection.ids
      : defaultIds

  const selectedRuns = selectedIds
    .map((id) => activeTask?.runs.find((run) => run.id === id))
    .filter((run): run is Trace => Boolean(run))

  if (tasks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <GitCompare size={20} className="text-faint" />
        <p className="mt-3 text-[13px] text-ink">{t('compare.empty')}</p>
        <Link to="/" className="mt-3 text-[12px] text-accent hover:underline">
          {t('compare.back')}
        </Link>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1120px] px-6 py-9">
        <Link
          to="/"
          className="mb-5 inline-flex items-center gap-1.5 text-[11px] text-faint transition-colors hover:text-muted"
        >
          <ArrowLeft size={12} />
          {t('compare.back')}
        </Link>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="eyebrow">{t('compare.eyebrow')}</div>
            <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-ink">
              {t('compare.title')}
            </h1>
            <p className="mt-1.5 max-w-[560px] text-[12.5px] leading-relaxed text-muted">
              {t('compare.subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tasks.map((task) => (
              <button
                key={task.taskId}
                onClick={() => setParams({ task: task.taskId })}
                className={clsx(
                  'flex h-7 max-w-[260px] items-center gap-1.5 rounded-sm border px-2.5 text-[11px] transition-colors',
                  activeTask?.taskId === task.taskId
                    ? 'border-line-strong bg-panel2 text-ink'
                    : 'border-line/70 text-muted hover:border-line-strong hover:text-ink',
                )}
              >
                <span className="truncate">{task.title}</span>
                <span className="font-mono text-[9.5px] text-faint">{task.runs.length}</span>
              </button>
            ))}
          </div>
        </div>

        {activeTask ? (
          <>
            <div className="mt-7 flex flex-wrap items-center gap-2 border-y border-line py-3">
              <span className="eyebrow mr-1">{t('compare.runs')}</span>
              {activeTask.runs.map((run) => {
                const selected = selectedIds.includes(run.id)
                const disabled = !selected && selectedIds.length >= 4
                return (
                  <button
                    key={run.id}
                    disabled={disabled}
                    onClick={() => {
                      if (!activeTask) return
                      const next = selectedIds.includes(run.id)
                        ? selectedIds.length > 1
                          ? selectedIds.filter((id) => id !== run.id)
                          : selectedIds
                        : [...selectedIds, run.id]
                      setSelection({ taskId: activeTask.taskId, ids: next })
                    }}
                    className={clsx(
                      'flex h-8 items-center gap-2 rounded-sm border px-2.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                      selected
                        ? 'border-accent/45 bg-accent/[0.07] text-ink'
                        : 'border-line bg-panel text-muted hover:border-line-strong',
                    )}
                    title={disabled ? t('compare.limit') : t('compare.toggle')}
                  >
                    <span
                      className={clsx(
                        'flex h-3.5 w-3.5 items-center justify-center rounded-xs border',
                        selected ? 'border-accent bg-accent text-[#06101f]' : 'border-line-strong',
                      )}
                    >
                      {selected ? <Check size={9} strokeWidth={3} /> : null}
                    </span>
                    <span className="font-medium">{run.agent.name}</span>
                    <span className="font-mono text-[9.5px] text-faint">
                      {formatDuration(run.durationMs)}
                    </span>
                    <span
                      className={clsx(
                        'h-1.5 w-1.5 rounded-full',
                        run.status === 'pass'
                          ? 'bg-pass'
                          : run.status === 'fail'
                            ? 'bg-fail'
                            : 'bg-warn',
                      )}
                    />
                  </button>
                )
              })}
              <span className="ml-auto font-mono text-[9.5px] text-faint">
                {t('compare.selected', {
                  selected: selectedRuns.length,
                  total: activeTask.runs.length,
                })}
              </span>
            </div>

            <SummaryTable runs={selectedRuns} />

            <section className="mt-10">
              <div className="flex items-end justify-between">
                <div>
                  <div className="eyebrow">{t('compare.timeline')}</div>
                  <h2 className="mt-1.5 text-[15px] font-medium text-ink">
                    {t('compare.timelineTitle')}
                  </h2>
                </div>
                <span className="font-mono text-[9.5px] text-faint">
                  {t('compare.timelineHint')}
                </span>
              </div>
              <CompareTimeline runs={selectedRuns} />
            </section>

            <section className="mt-10 pb-6">
              <div className="eyebrow">{t('compare.fingerprint')}</div>
              <h2 className="mt-1.5 text-[15px] font-medium text-ink">
                {t('compare.fingerprintTitle')}
              </h2>
              <div className="mt-4 space-y-2">
                {selectedRuns.map((run) => (
                  <FingerprintRow key={run.id} run={run} />
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}

function metrics(run: Trace) {
  const spans = leafSpans(run)
  return {
    duration: run.durationMs,
    steps: spans.length,
    edits: spans.filter((span) => span.type === 'edit').length,
    testRuns: spans.filter((span) => span.type === 'test').length,
    files:
      run.result.filesChanged?.length ??
      (run.capture?.fidelity === 'otel' ? null : traceFiles(run).length),
    tests: run.result.tests,
    tokens: spans.reduce((total, span) => {
      const tokens = span.attributes?.tokens
      return total + (typeof tokens === 'number' ? tokens : 0)
    }, 0),
  }
}

function SummaryTable({ runs }: { runs: Trace[] }) {
  const t = useT()
  const metricsByRun = runs.map(metrics)
  const minDuration = Math.min(...metricsByRun.map((item) => item.duration))
  const minSteps = Math.min(...metricsByRun.map((item) => item.steps))
  const columns = `150px repeat(${runs.length}, minmax(0, 1fr))`

  return (
    <div className="mt-5 overflow-x-auto">
      <div className="min-w-[680px] overflow-hidden rounded-md border border-line">
        <div
          className="grid items-center gap-x-4 border-b border-line bg-panel px-4 py-2.5"
          style={{ gridTemplateColumns: columns }}
        >
          <span className="eyebrow">{t('compare.table.run')}</span>
          {runs.map((run) => (
            <div key={run.id} className="min-w-0">
              <div className="flex items-center gap-2">
                <AgentBadge name={run.agent.name} />
                <StatusPill status={run.status} />
                {isEstimatedTiming(run) ? (
                  <span className="rounded-xs border border-warn/30 px-1 font-mono text-[8px] uppercase text-warn">
                    {t('compare.est')}
                  </span>
                ) : null}
              </div>
              <Link
                to={`/runs/${run.id}`}
                className="mt-1 inline-block font-mono text-[9.5px] text-faint transition-colors hover:text-accent"
              >
                {t('compare.openReplay')}
              </Link>
            </div>
          ))}
        </div>

        <SummaryRow
          label={t('compare.table.duration')}
          columns={columns}
          values={metricsByRun.map((item, index) => ({
            key: runs[index].id,
            content: formatDuration(item.duration),
            tone: item.duration === minDuration && runs.length > 1 ? 'best' : 'default',
          }))}
        />
        <SummaryRow
          label={t('compare.table.steps')}
          columns={columns}
          values={metricsByRun.map((item, index) => ({
            key: runs[index].id,
            content: String(item.steps),
            tone: item.steps === minSteps && runs.length > 1 ? 'best' : 'default',
          }))}
        />
        <SummaryRow
          label={t('compare.table.edits')}
          columns={columns}
          values={metricsByRun.map((item, index) => ({
            key: runs[index].id,
            content: String(item.edits),
            tone: 'default',
          }))}
        />
        <SummaryRow
          label={t('compare.table.testRuns')}
          columns={columns}
          values={metricsByRun.map((item, index) => ({
            key: runs[index].id,
            content: String(item.testRuns),
            tone: 'default',
          }))}
        />
        <SummaryRow
          label={t('compare.table.tests')}
          columns={columns}
          values={metricsByRun.map((item, index) => ({
            key: runs[index].id,
            content: item.tests ? `${item.tests.passed}/${item.tests.total}` : '—',
            tone: !item.tests ? 'default' : item.tests.failed > 0 ? 'bad' : 'best',
          }))}
        />
        <SummaryRow
          label={t('compare.table.files')}
          columns={columns}
          values={metricsByRun.map((item, index) => ({
            key: runs[index].id,
            content: item.files === null ? '—' : String(item.files),
            tone: 'default',
          }))}
        />
        <SummaryRow
          label={t('compare.table.tokens')}
          columns={columns}
          values={metricsByRun.map((item, index) => ({
            key: runs[index].id,
            content: item.tokens > 0 ? formatNumber(item.tokens) : '—',
            tone: 'default',
          }))}
          last
        />
        <div
          className="grid gap-x-4 border-t border-line bg-panel2/25 px-4 py-3"
          style={{ gridTemplateColumns: columns }}
        >
          <span className="pt-0.5 text-[10.5px] text-faint">{t('compare.table.outcome')}</span>
          {runs.map((run) => (
            <p key={run.id} className="text-[11px] leading-relaxed text-muted">
              {buildOutcomeSummary(run)}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

function SummaryRow({
  label,
  values,
  columns,
  last = false,
}: {
  label: string
  values: { key: string; content: string; tone: 'default' | 'best' | 'bad' }[]
  columns: string
  last?: boolean
}) {
  return (
    <div
      className={clsx('grid items-center gap-x-4 px-4 py-2', !last && 'border-b border-line/70')}
      style={{ gridTemplateColumns: columns }}
    >
      <span className="text-[10.5px] text-faint">{label}</span>
      {values.map((value) => (
        <span
          key={value.key}
          className={clsx(
            'font-mono text-[11px]',
            value.tone === 'best' && 'text-pass',
            value.tone === 'bad' && 'text-fail',
            value.tone === 'default' && 'text-[#c4ccd7]',
          )}
        >
          {value.content}
        </span>
      ))}
    </div>
  )
}

function CompareTimeline({ runs }: { runs: Trace[] }) {
  const t = useT()
  const navigate = useNavigate()
  const maxDuration = Math.max(...runs.map((run) => run.durationMs), 1)
  const ticks = Array.from({ length: 5 }, (_, index) => (index / 4) * maxDuration)

  return (
    <div className="mt-4 overflow-x-auto">
      <div className="min-w-[680px] rounded-md border border-line bg-panel/50 px-4 py-4">
      <div className="mb-3 flex">
        <div className="w-[150px] shrink-0" />
        <div className="relative h-4 flex-1">
          {ticks.map((tick, index) => (
            <span
              key={tick}
              className={clsx(
                'absolute whitespace-nowrap font-mono text-[8.5px] text-faint',
                index === 0
                  ? 'left-0'
                  : index === ticks.length - 1
                    ? 'right-0'
                    : '-translate-x-1/2',
              )}
              style={
                index === ticks.length - 1
                  ? undefined
                  : { left: `${(tick / maxDuration) * 100}%` }
              }
            >
              {formatDuration(tick)}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {runs.map((run) => (
          <div key={run.id} className="flex items-center gap-3">
            <div className="w-[150px] shrink-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={clsx(
                    'h-1.5 w-1.5 rounded-full',
                    run.status === 'pass' ? 'bg-pass' : run.status === 'fail' ? 'bg-fail' : 'bg-warn',
                  )}
                />
                <span className="truncate text-[11px] text-ink">{run.agent.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[9px] text-faint">
                  {formatDuration(run.durationMs)}
                </span>
              </div>
            </div>
            <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-xs bg-panel2/60">
              <div className="pointer-events-none absolute inset-0 flex justify-between">
                {ticks.map((tick) => (
                  <span key={tick} className="h-full w-px bg-line/40" />
                ))}
              </div>
              {leafSpans(run).map((span) => (
                <button
                  key={span.id}
                  onClick={() => navigate(`/runs/${run.id}?step=${span.id}`)}
                  title={`${span.name} · ${formatDuration(spanDuration(span))}`}
                  aria-label={t('compare.openAria', { agent: run.agent.name, span: span.name })}
                  className="absolute top-[5px] h-[18px] overflow-hidden rounded-[2px] border-l-2 text-left transition-opacity hover:opacity-80"
                  style={{
                    left: `${(span.startMs / maxDuration) * 100}%`,
                    width: `max(2px, ${(spanDuration(span) / maxDuration) * 100}%)`,
                    backgroundColor: `color-mix(in srgb, ${SPAN_COLORS[span.type]} 26%, transparent)`,
                    borderLeftColor: SPAN_COLORS[span.type],
                    boxShadow:
                      span.status === 'error'
                        ? 'inset 0 0 0 1px var(--color-fail)'
                        : span.status === 'warning'
                          ? 'inset 0 0 0 1px var(--color-warn)'
                          : undefined,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/70 pt-2.5 pl-[162px]">
        {(['reasoning', 'read', 'search', 'edit', 'test', 'checkpoint', 'final'] as SpanType[]).map(
          (type) => (
            <span key={type} className="flex items-center gap-1 font-mono text-[9px] text-faint">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: SPAN_COLORS[type] }}
              />
              {spanLabel(type)}
            </span>
          ),
        )}
      </div>
      </div>
    </div>
  )
}

function FingerprintRow({ run }: { run: Trace }) {
  const spans = leafSpans(run)
  const counts = FINGERPRINT_ORDER.map((type) => ({
    type,
    count: spans.filter((span) => span.type === type).length,
  })).filter((item) => item.count > 0)
  const total = counts.reduce((sum, item) => sum + item.count, 0)

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-panel/40 px-3 py-2.5 lg:flex-row lg:items-center">
      <div className="flex w-[160px] shrink-0 items-center gap-2">
        <span
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            run.status === 'pass' ? 'bg-pass' : run.status === 'fail' ? 'bg-fail' : 'bg-warn',
          )}
        />
        <span className="truncate text-[11px] text-ink">{run.agent.name}</span>
        <span className="font-mono text-[9px] text-faint">{tn('compare.steps', total)}</span>
      </div>
      <div className="flex h-4 min-w-0 flex-1 overflow-hidden rounded-xs bg-panel2">
        {counts.map((item) => (
          <span
            key={item.type}
            title={`${spanLabel(item.type)} · ${item.count}`}
            className="h-full border-r border-canvas/50 last:border-r-0"
            style={{
              width: `${(item.count / total) * 100}%`,
              backgroundColor: `color-mix(in srgb, ${SPAN_COLORS[item.type]} 55%, transparent)`,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:w-[380px] lg:shrink-0 lg:justify-end">
        {counts.map((item) => (
          <span key={item.type} className="flex items-center gap-1 text-[9px] text-faint">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: SPAN_COLORS[item.type] }}
            />
            <span className="text-muted">{spanLabel(item.type)}</span>
            <span className="font-mono text-[9px] text-ink/80">{item.count}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
