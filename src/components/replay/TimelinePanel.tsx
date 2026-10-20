import { useState } from 'react'
import { GanttChartSquare, List } from 'lucide-react'
import { Segmented } from '../ui/primitives'
import { useReplayStore } from '../../store/replay'
import { TimelineStory } from './TimelineStory'
import { TimelineFlame } from './TimelineFlame'

type View = 'story' | 'flame'

export function TimelinePanel() {
  const spans = useReplayStore((state) => state.spans)
  const [view, setView] = useState<View>('story')

  return (
    <aside className="flex w-[318px] shrink-0 flex-col border-r border-line bg-canvas">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="eyebrow">Timeline</span>
        <span className="font-mono text-[10px] text-faint">{spans.length} steps</span>
        <div className="ml-auto">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              {
                value: 'story',
                label: (
                  <>
                    <List size={11} />
                    Story
                  </>
                ),
                title: 'Narrative view',
              },
              {
                value: 'flame',
                label: (
                  <>
                    <GanttChartSquare size={11} />
                    Flame
                  </>
                ),
                title: 'Time-based view',
              },
            ]}
          />
        </div>
      </div>
      <div className="panel-scroll min-h-0 flex-1">
        {view === 'story' ? <TimelineStory spans={spans} /> : <TimelineFlame spans={spans} />}
      </div>
    </aside>
  )
}
