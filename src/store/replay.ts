import { create } from 'zustand'
import type { Span, Trace } from '../schema/trace'
import { playbackSpans, spanAtTime, spanEnd } from '../lib/trace'

export type StageView = 'artifact' | 'workspace'

type ReplayState = {
  trace: Trace | null
  spans: Span[]
  playheadMs: number
  currentSpanId: string
  playing: boolean
  speed: number
  hoveredSpanId: string | null
  stageView: StageView
  workspaceFile: string | null
  setTrace: (trace: Trace) => void
  seek: (ms: number) => void
  seekToSpan: (id: string) => void
  step: (direction: 1 | -1) => void
  play: () => void
  pause: () => void
  toggle: () => void
  setSpeed: (speed: number) => void
  advance: (deltaMs: number) => void
  setHovered: (id: string | null) => void
  setStageView: (view: StageView) => void
  setWorkspaceFile: (path: string | null) => void
}

function idAt(spans: Span[], ms: number): string {
  return spans.length > 0 ? spanAtTime(spans, ms).id : ''
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  trace: null,
  spans: [],
  playheadMs: 0,
  currentSpanId: '',
  playing: false,
  speed: 1,
  hoveredSpanId: null,
  stageView: 'artifact',
  workspaceFile: null,

  setTrace: (trace) => {
    const spans = playbackSpans(trace)
    set({
      trace,
      spans,
      playheadMs: 0,
      currentSpanId: idAt(spans, 0),
      playing: false,
      hoveredSpanId: null,
      stageView: 'artifact',
      workspaceFile: null,
    })
  },

  seek: (ms) => {
    const { trace, spans } = get()
    if (!trace) return
    const next = Math.min(Math.max(ms, 0), spanEnd(trace))
    set({ playheadMs: next, currentSpanId: idAt(spans, next) })
  },

  seekToSpan: (id) => {
    const { spans } = get()
    const span = spans.find((item) => item.id === id)
    if (span) {
      set({ playheadMs: span.startMs, currentSpanId: span.id, hoveredSpanId: null })
    }
  },

  step: (direction) => {
    const { spans, playheadMs } = get()
    if (spans.length === 0) return
    const current = spanAtTime(spans, playheadMs)
    const index = spans.findIndex((span) => span.id === current.id)
    const nextIndex = Math.min(Math.max(index + direction, 0), spans.length - 1)
    const target = spans[nextIndex]
    set({ playheadMs: target.startMs, currentSpanId: target.id })
  },

  play: () => {
    const { trace, playheadMs, spans } = get()
    if (!trace) return
    const max = spanEnd(trace)
    const restart = playheadMs >= max - 10
    set({
      playing: true,
      playheadMs: restart ? 0 : playheadMs,
      currentSpanId: restart ? idAt(spans, 0) : get().currentSpanId,
    })
  },

  pause: () => set({ playing: false }),

  toggle: () => {
    if (get().playing) get().pause()
    else get().play()
  },

  setSpeed: (speed) => set({ speed }),

  advance: (deltaMs) => {
    const { trace, spans, playheadMs } = get()
    if (!trace) return
    const max = spanEnd(trace)
    const next = playheadMs + deltaMs
    if (next >= max) {
      set({
        playheadMs: max,
        currentSpanId: spans[spans.length - 1]?.id ?? '',
        playing: false,
      })
    } else {
      set({ playheadMs: next, currentSpanId: idAt(spans, next) })
    }
  },

  setHovered: (id) => set({ hoveredSpanId: id }),

  setStageView: (stageView) => set({ stageView }),

  setWorkspaceFile: (workspaceFile) => set({ workspaceFile }),
}))
