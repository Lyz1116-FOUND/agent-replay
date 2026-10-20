import { useState } from 'react'
import { GanttChartSquare, List } from 'lucide-react'
import { Segmented } from '../ui/primitives'
import { useReplayStore } from '../../store/replay'
import { TimelineStory } from './TimelineStory'
import { TimelineFlame } from './TimelineFlame'
import { tn, useT } from '../../i18n'

type View = 'story' | 'flame'

export function TimelinePanel() {
  const spans = useReplayStore((state) => state.spans)
  const t = useT()
  const [view, setView] = useState<View>('story')

  return (
    <aside className="flex w-[318px] shrink-0 flex-col border-r border-line bg-canvas">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="eyebrow">{t('timeline.title')}</span>
        <span className="font-mono text-[10px] text-faint">{tn('timeline.spans', spans.length)}</span>
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
                    {t('timeline.story')}
                  </>
                ),
                title: t('timeline.storyTitle'),
              },
              {
                value: 'flame',
                label: (
                  <>
                    <GanttChartSquare size={11} />
                    {t('timeline.flame')}
                  </>
                ),
                title: t('timeline.flameTitle'),
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
