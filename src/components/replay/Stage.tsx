import { FileDiff, FolderTree } from 'lucide-react'
import { Segmented } from '../ui/primitives'
import { useReplayStore } from '../../store/replay'
import { useCurrentSpan } from '../../store/hooks'
import { SPAN_COLORS, SPAN_LABELS } from '../../lib/trace'
import { SpanIcon } from '../spanMeta'
import { ArtifactStage } from './ArtifactStage'
import { WorkspaceView } from './WorkspaceView'

export function Stage() {
  const span = useCurrentSpan()
  const spans = useReplayStore((state) => state.spans)
  const stageView = useReplayStore((state) => state.stageView)
  const setStageView = useReplayStore((state) => state.setStageView)

  if (!span) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center bg-panel text-[12px] text-faint">
        No step selected
      </section>
    )
  }

  const index = spans.findIndex((item) => item.id === span.id) + 1

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-panel">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-canvas px-4">
        <span className="shrink-0 font-mono text-[10px] text-faint">
          {String(index).padStart(2, '0')}
          <span className="text-line-strong">/{String(spans.length).padStart(2, '0')}</span>
        </span>
        <span
          className="flex shrink-0 items-center gap-1.5"
          style={{ color: SPAN_COLORS[span.type] }}
        >
          <SpanIcon type={span.type} size={12} />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em]">
            {SPAN_LABELS[span.type]}
          </span>
        </span>
        <span className="h-3 w-px shrink-0 bg-line" />
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[12.5px] font-medium text-ink">{span.name}</span>
          {span.summary ? (
            <span className="hidden truncate text-[11px] text-faint xl:inline">{span.summary}</span>
          ) : null}
        </div>
        <div className="ml-auto shrink-0">
          <Segmented
            value={stageView}
            onChange={setStageView}
            options={[
              {
                value: 'artifact',
                label: (
                  <>
                    <FileDiff size={11} />
                    Artifact
                  </>
                ),
              },
              {
                value: 'workspace',
                label: (
                  <>
                    <FolderTree size={11} />
                    Workspace
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {stageView === 'artifact' ? (
          <ArtifactStage key={span.id} span={span} />
        ) : (
          <WorkspaceView />
        )}
      </div>
    </section>
  )
}
