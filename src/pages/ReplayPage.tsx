import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useRunById } from '../lib/runs'
import { spanEnd } from '../lib/trace'
import { useReplayStore } from '../store/replay'
import { ReplayHeader } from '../components/replay/ReplayHeader'
import { Overview } from '../components/replay/Overview'
import { TimelinePanel } from '../components/replay/TimelinePanel'
import { Stage } from '../components/replay/Stage'
import { Inspector } from '../components/replay/Inspector'
import { Player } from '../components/replay/Player'
import { NotFoundPage } from './NotFoundPage'

type Mode = 'overview' | 'detail'

export function ReplayPage() {
  const { runId } = useParams()
  const [searchParams] = useSearchParams()
  const run = useRunById(runId)
  const setTrace = useReplayStore((state) => state.setTrace)
  const stepId = searchParams.get('step')
  const viewKey = `${runId ?? ''}:${stepId ?? ''}`
  const [viewOverride, setViewOverride] = useState<{ key: string; mode: Mode } | null>(null)
  const mode: Mode =
    viewOverride?.key === viewKey ? viewOverride.mode : stepId ? 'detail' : 'overview'
  const setMode = (next: Mode) => setViewOverride({ key: viewKey, mode: next })

  useEffect(() => {
    if (!run) return
    setTrace(run)
    if (stepId) useReplayStore.getState().seekToSpan(stepId)
  }, [run, setTrace, stepId])

  useEffect(() => {
    if (import.meta.env.MODE === 'demo' && runId === 'run_lru_codex_9f2a') {
      useReplayStore.getState().setSpeed(4)
    }
  }, [runId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
      if (target?.isContentEditable) return

      const state = useReplayStore.getState()
      if (mode === 'overview') {
        if (event.key === 'Enter') {
          event.preventDefault()
          setViewOverride({ key: viewKey, mode: 'detail' })
        }
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        state.pause()
        setViewOverride({ key: viewKey, mode: 'overview' })
      } else if (event.code === 'Space') {
        event.preventDefault()
        state.toggle()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        state.pause()
        state.step(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        state.pause()
        state.step(-1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        state.seek(0)
      } else if (event.key === 'End' && state.trace) {
        event.preventDefault()
        state.seek(spanEnd(state.trace))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, viewKey])

  if (!run) return <NotFoundPage />

  function openSpan(spanId?: string) {
    const state = useReplayStore.getState()
    state.pause()
    if (spanId) state.seekToSpan(spanId)
    setMode('detail')
  }

  function openOverview() {
    useReplayStore.getState().pause()
    setMode('overview')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReplayHeader trace={run} onOverview={mode === 'detail' ? openOverview : undefined} />
      {mode === 'overview' ? (
        <Overview trace={run} onOpenDetail={() => setMode('detail')} onOpenSpan={openSpan} />
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            <TimelinePanel />
            <Stage />
            <Inspector />
          </div>
          <Player />
        </>
      )}
    </div>
  )
}
