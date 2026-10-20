import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  GitCompare,
  Search,
  Upload,
  X,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { Trace } from '../schema/trace'
import { formatDuration } from '../lib/trace'
import { formatDateTime, tn, useT } from '../i18n'
import { runStats, useAllRuns } from '../lib/runs'
import { useRunsStore } from '../store/runs'
import { useUiStore } from '../store/ui'
import { AgentBadge, Button, Kbd, StatusPill } from '../components/ui/primitives'

type StatusFilter = 'all' | 'pass' | 'fail'

const FILTER_KEYS = {
  all: 'runs.filter.all',
  pass: 'runs.filter.pass',
  fail: 'runs.filter.fail',
} as const

export function RunsPage() {
  const runs = useAllRuns()
  const imported = useRunsStore((state) => state.imported)
  const transient = useRunsStore((state) => state.transient)
  const setImportOpen = useUiStore((state) => state.setImportOpen)
  const navigate = useNavigate()
  const t = useT()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
      if (event.key === '/' && document.activeElement !== inputRef.current) {
        const active = document.activeElement as HTMLElement | null
        if (
          active &&
          (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.tagName === 'SELECT' ||
            active.isContentEditable)
        ) {
          return
        }
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return runs.filter((run) => {
      if (filter === 'pass' && run.status !== 'pass') return false
      if (filter === 'fail' && run.status !== 'fail') return false
      if (!needle) return true
      const haystack = [
        run.task.title,
        run.task.id,
        run.task.repo,
        run.agent.name,
        run.agent.model,
        run.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [runs, query, filter])

  const tasks = new Set(runs.map((run) => run.task.id)).size
  const importedIds = new Set(imported.map((run) => run.id))
  const transientIds = new Set(transient.map((run) => run.id))
  const passCount = runs.filter((run) => run.status === 'pass').length
  const failCount = runs.filter((run) => run.status === 'fail').length

  const counts: Record<StatusFilter, number> = {
    all: runs.length,
    pass: passCount,
    fail: failCount,
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1120px] px-6 py-9">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="eyebrow">{t('runs.eyebrow')}</div>
            <div className="mt-2 flex items-baseline gap-3">
              <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">{t('runs.title')}</h1>
              <span className="font-mono text-[11px] text-faint">
                {tn('runs.count', runs.length, { tasks })}
              </span>
            </div>
            <p className="mt-1.5 max-w-[560px] text-[12.5px] leading-relaxed text-muted">
              {t('runs.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => navigate('/compare')}>
              <GitCompare size={13} />
              {t('runs.compare')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => setImportOpen(true)}>
              <Upload size={13} />
              {t('runs.import')}
            </Button>
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('runs.searchPlaceholder')}
              className="h-8 w-full rounded-sm border border-line bg-panel pl-8 pr-16 text-[12px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {query ? (
                <button
                  onClick={() => setQuery('')}
                  className="rounded-xs p-0.5 text-faint hover:text-ink"
                  aria-label={t('runs.clearSearch')}
                >
                  <X size={12} />
                </button>
              ) : (
                <Kbd>⌘K</Kbd>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {(['all', 'pass', 'fail'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={clsx(
                  'flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[11px] transition-colors',
                  filter === value
                    ? 'border-line-strong bg-panel2 text-ink'
                    : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {t(FILTER_KEYS[value])}
                <span className="font-mono text-[10px] text-faint">{counts[value]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hidden grid-cols-[minmax(0,1fr)_156px_74px_56px_52px_96px_16px] items-center gap-4 border-b border-line px-2 py-2 md:grid">
          <span className="eyebrow">{t('runs.table.task')}</span>
          <span className="eyebrow">{t('runs.table.agent')}</span>
          <span className="eyebrow">{t('runs.table.result')}</span>
          <span className="eyebrow text-right">{t('runs.table.time')}</span>
          <span className="eyebrow text-right">{t('runs.table.steps')}</span>
          <span className="eyebrow text-right">{t('runs.table.started')}</span>
          <span />
        </div>

        <div>
          {filtered.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              imported={importedIds.has(run.id)}
              transient={transientIds.has(run.id)}
              taskRunCount={runs.filter((item) => item.task.id === run.task.id).length}
            />
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="mt-10 flex flex-col items-center rounded-md border border-dashed border-line py-14">
            <Search size={18} className="text-faint" />
            <p className="mt-3 text-[13px] text-ink">{t('runs.empty.title')}</p>
            <p className="mt-1 text-[11.5px] text-muted">{t('runs.empty.body')}</p>
            <Button
              size="sm"
              variant="subtle"
              className="mt-4"
              onClick={() => {
                setQuery('')
                setFilter('all')
              }}
            >
              {t('runs.empty.clear')}
            </Button>
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-[11px] text-faint">
          <span>{t('runs.footer.showing', { shown: filtered.length, total: runs.length })}</span>
          <span className="flex items-center gap-2">
            <span className="font-mono">JSON</span>
            <span>{t('runs.footer.native')}</span>
            <span className="text-line-strong">·</span>
            <span className="font-mono">.traj</span>
            <span>{t('runs.footer.traj')}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function RunRow({
  run,
  imported,
  transient,
  taskRunCount,
}: {
  run: Trace
  imported: boolean
  transient: boolean
  taskRunCount: number
}) {
  const navigate = useNavigate()
  const t = useT()
  const stats = runStats(run)
  const tests = run.result.tests

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/runs/${run.id}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') navigate(`/runs/${run.id}`)
      }}
      className="row-focus group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-4 border-b border-line/70 px-2 py-3 hover:bg-panel2/60 md:grid-cols-[minmax(0,1fr)_156px_74px_56px_52px_96px_16px]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{run.task.title}</span>
          {run.metadata?.source === 'recorder' ? (
            <span className="shrink-0 rounded-xs border border-accent/30 px-1 font-mono text-[9px] uppercase tracking-wide text-accent/80">
              {t('runs.badge.recorded')}
            </span>
          ) : imported ? (
            <span className="shrink-0 rounded-xs border border-line px-1 font-mono text-[9px] uppercase tracking-wide text-faint">
              {t('runs.badge.imported')}
            </span>
          ) : transient ? (
            <span className="shrink-0 rounded-xs border border-line px-1 font-mono text-[9px] uppercase tracking-wide text-faint">
              {t('runs.badge.opened')}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 truncate font-mono text-[10.5px] text-faint">
          <span>{run.task.repo ?? run.task.id}</span>
          <span className="text-line-strong">·</span>
          <span>{run.task.id}</span>
          {tests ? (
            <>
              <span className="text-line-strong">·</span>
              <span className={tests.failed > 0 ? 'text-fail/80' : 'text-pass/80'}>
                {t('runs.tests', { passed: tests.passed, total: tests.total })}
              </span>
            </>
          ) : null}
          {taskRunCount > 1 ? (
            <button
              onClick={(event) => {
                event.stopPropagation()
                navigate(`/compare?task=${run.task.id}`)
              }}
              className="ml-1 inline-flex items-center gap-1 rounded-xs border border-line px-1.5 py-[1px] text-[9.5px] text-muted transition-colors hover:border-accent/50 hover:text-accent"
              title={t('runs.compareTask')}
            >
              <GitCompare size={9} />
              {tn('runs.taskRuns', taskRunCount)}
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex items-center gap-3 md:hidden">
          <StatusPill status={run.status} />
          <span className="font-mono text-[10.5px] text-muted">{formatDuration(run.durationMs)}</span>
          <span className="font-mono text-[10.5px] text-faint">{tn('runs.steps', stats.steps)}</span>
        </div>
      </div>

      <div className="hidden min-w-0 md:block">
        <AgentBadge name={run.agent.name} model={run.agent.model} />
      </div>

      <div className="hidden md:block">
        <StatusPill status={run.status} />
      </div>

      <span className="hidden text-right font-mono text-[11.5px] text-muted md:block">
        {formatDuration(run.durationMs)}
      </span>

      <span className="hidden text-right font-mono text-[11.5px] text-muted md:block">
        {stats.steps}
      </span>

      <span className="hidden text-right font-mono text-[10.5px] text-faint md:block">
        {formatDateTime(run.startedAt)}
      </span>

      <ChevronRight
        size={14}
        className="text-faint transition-colors group-hover:text-accent"
      />
    </div>
  )
}
