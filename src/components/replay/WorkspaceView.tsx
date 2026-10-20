import { useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import { FileCode2, FolderTree } from 'lucide-react'
import type { Span } from '../../schema/trace'
import { buildFileIndex, formatClock, formatSpanDuration, spanEnd } from '../../lib/trace'
import { useReplayStore } from '../../store/replay'
import { SpanIcon } from '../spanMeta'

export function WorkspaceView() {
  const trace = useReplayStore((state) => state.trace)
  const playheadMs = useReplayStore((state) => state.playheadMs)
  const currentSpanId = useReplayStore((state) => state.currentSpanId)
  const hoveredSpanId = useReplayStore((state) => state.hoveredSpanId)
  const workspaceFile = useReplayStore((state) => state.workspaceFile)
  const setWorkspaceFile = useReplayStore((state) => state.setWorkspaceFile)
  const seekToSpan = useReplayStore((state) => state.seekToSpan)
  const setHovered = useReplayStore((state) => state.setHovered)

  const files = useMemo(() => (trace ? buildFileIndex(trace) : []), [trace])
  const duration = trace ? spanEnd(trace) : 1
  const selected = files.find((file) => file.path === workspaceFile) ?? files[0]
  const currentSpan = trace?.spans.find((span) => span.id === currentSpanId)

  useEffect(() => {
    const path = currentSpan?.files?.[0]
    if (path && files.some((file) => file.path === path)) setWorkspaceFile(path)
  }, [currentSpanId, currentSpan, files, setWorkspaceFile])

  if (!trace || files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <FolderTree size={20} className="text-faint" />
        <p className="mt-3 text-[13px] text-ink">No files recorded in this trace</p>
        <p className="mt-1 max-w-[320px] text-[11.5px] leading-relaxed text-muted">
          Steps in this run did not declare file paths, so there is no workspace activity to show.
        </p>
      </div>
    )
  }

  const groups = new Map<string, typeof files>()
  for (const file of files) {
    const segments = file.path.split('/')
    const directory = segments.length > 1 ? segments.slice(0, -1).join('/') : 'repository root'
    const bucket = groups.get(directory) ?? []
    bucket.push(file)
    groups.set(directory, bucket)
  }

  const totalReads = files.reduce((total, file) => total + file.reads.length, 0)
  const totalEdits = files.reduce((total, file) => total + file.edits.length, 0)

  return (
    <div className="panel-scroll h-full overflow-y-auto">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="eyebrow">Workspace activity</span>
          <span className="font-mono text-[10px] text-faint">
            {files.length} files · {totalReads} reads · {totalEdits} edits
          </span>
        </div>
        <span className="font-mono text-[10px] text-faint">{formatClock(playheadMs)}</span>
      </div>

      <div className="px-4 py-3">
        {[...groups.entries()].map(([directory, directoryFiles]) => (
          <div key={directory} className="mb-2">
            <div className="flex items-center gap-1.5 px-1 py-1 font-mono text-[10px] text-faint">
              <FolderTree size={10} />
              {directory}
            </div>
            {directoryFiles.map((file) => {
              const name = file.path.split('/').pop()
              const state = fileState(file.edits, file.reads, playheadMs, currentSpan, file.path)
              const isSelected = selected?.path === file.path
              const touchedByCurrent = currentSpan?.files?.includes(file.path)
              return (
                <button
                  key={file.path}
                  onClick={() => setWorkspaceFile(file.path)}
                  className={clsx(
                    'relative flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left transition-colors',
                    isSelected
                      ? 'bg-panel2 text-ink'
                      : 'text-muted hover:bg-panel2/60 hover:text-ink',
                    touchedByCurrent && 'ring-1 ring-inset ring-accent/30',
                  )}
                >
                  {isSelected ? (
                    <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-accent" />
                  ) : null}
                  <FileCode2 size={12} className="shrink-0 text-faint" />
                  <span className="w-[150px] shrink-0 truncate font-mono text-[11px]">{name}</span>
                  <StateBadge state={state} />
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[9px] text-faint">
                    {file.reads.length > 0 ? <span>{file.reads.length}R</span> : null}
                    {file.edits.length > 0 ? (
                      <span className="text-edit/80">{file.edits.length}E</span>
                    ) : null}
                  </span>
                  <div className="relative h-4 w-[34%] shrink-0 overflow-hidden rounded-xs bg-panel3/60">
                    {file.spans.map((span) => (
                      <span
                        key={span.id}
                        title={`${span.name} · ${formatClock(span.startMs)}`}
                        className={clsx(
                          'absolute top-[3px] h-2.5 w-[2px] rounded-full',
                          span.id === currentSpanId && 'z-10 outline outline-1 outline-accent',
                        )}
                        style={{
                          left: `${(span.startMs / duration) * 100}%`,
                          backgroundColor:
                            span.type === 'edit'
                              ? 'var(--color-edit)'
                              : span.type === 'test'
                                ? 'var(--color-pass)'
                                : 'var(--color-accent)',
                          opacity: span.startMs > playheadMs ? 0.35 : 1,
                        }}
                      />
                    ))}
                    <span
                      className="absolute inset-y-0 w-px bg-accent/80"
                      style={{ left: `${(playheadMs / duration) * 100}%` }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {selected ? (
        <div className="mt-1 border-t border-line bg-panel/40">
          <div className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-mono text-[11px] text-ink">{selected.path}</div>
              <div className="mt-0.5 text-[10px] text-faint">
                first touched at {formatClock(selected.firstTouchMs)} ·{" "}
                {selected.reads.length} {selected.reads.length === 1 ? 'read' : 'reads'} ·{" "}
                {selected.edits.length} {selected.edits.length === 1 ? 'edit' : 'edits'}
              </div>
            </div>
            <StateBadge state={fileState(selected.edits, selected.reads, playheadMs, currentSpan, selected.path)} />
          </div>
          <div className="px-2 pb-3">
            {selected.spans
              .slice()
              .sort((a, b) => a.startMs - b.startMs)
              .map((span) => (
                <ActivityRow
                  key={span.id}
                  span={span}
                  current={span.id === currentSpanId}
                  hovered={span.id === hoveredSpanId}
                  onClick={() => seekToSpan(span.id)}
                  onHover={(id) => setHovered(id)}
                />
              ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

type FileState = 'untouched' | 'read' | 'editing' | 'modified'

function fileState(
  edits: Span[],
  reads: Span[],
  playheadMs: number,
  currentSpan: Span | undefined,
  path: string,
): FileState {
  if (currentSpan?.files?.includes(path) && currentSpan.type === 'edit') return 'editing'
  if (edits.some((span) => span.endMs <= playheadMs)) return 'modified'
  if (reads.some((span) => span.endMs <= playheadMs)) return 'read'
  return 'untouched'
}

function StateBadge({ state }: { state: FileState }) {
  const config = {
    untouched: { label: 'not touched', color: 'var(--color-faint)' },
    read: { label: 'read', color: 'var(--color-accent)' },
    editing: { label: 'editing', color: 'var(--color-edit)' },
    modified: { label: 'modified', color: 'var(--color-warn)' },
  }[state]
  return (
    <span
      className="shrink-0 rounded-xs border px-1 py-[1px] font-mono text-[8.5px] uppercase tracking-wide"
      style={{
        color: config.color,
        borderColor: `color-mix(in srgb, ${config.color} 35%, transparent)`,
      }}
    >
      {config.label}
    </span>
  )
}

function ActivityRow({
  span,
  current,
  hovered,
  onClick,
  onHover,
}: {
  span: Span
  current: boolean
  hovered: boolean
  onClick: () => void
  onHover: (id: string | null) => void
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover(span.id)}
      onMouseLeave={() => onHover(null)}
      className={clsx(
        'flex w-full items-center gap-2 rounded-xs px-2 py-1 text-left transition-colors',
        current ? 'bg-accent/[0.08]' : hovered ? 'bg-panel2' : 'hover:bg-panel2/60',
      )}
    >
      <SpanIcon type={span.type} size={11} />
      <span className={clsx('truncate text-[11px]', current ? 'text-ink' : 'text-muted')}>
        {span.name}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[9px] text-faint">
        {formatClock(span.startMs)}
      </span>
      <span className="w-10 shrink-0 text-right font-mono text-[9px] text-faint">
        {formatSpanDuration(span)}
      </span>
    </button>
  )
}
