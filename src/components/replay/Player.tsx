import { useEffect, useRef, useState } from 'react'
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { clsx } from 'clsx'
import type { Span } from '../../schema/trace'
import { formatClock, isEstimatedTiming, spanAtTime, spanEnd } from '../../lib/trace'
import { useReplayStore } from '../../store/replay'
import { Kbd } from '../ui/primitives'
import { SpanIcon } from '../spanMeta'

const SPEEDS = [1, 2, 4, 8]

export function Player() {
  const trace = useReplayStore((state) => state.trace)
  const spans = useReplayStore((state) => state.spans)
  const playing = useReplayStore((state) => state.playing)
  const speed = useReplayStore((state) => state.speed)
  const playheadMs = useReplayStore((state) => state.playheadMs)
  const hoveredSpanId = useReplayStore((state) => state.hoveredSpanId)
  const toggle = useReplayStore((state) => state.toggle)
  const step = useReplayStore((state) => state.step)
  const setSpeed = useReplayStore((state) => state.setSpeed)
  const advance = useReplayStore((state) => state.advance)

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const loop = (now: number) => {
      const delta = Math.min(now - last, 100)
      last = now
      advance(delta * speed)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, advance])

  if (!trace) return null

  const duration = spanEnd(trace)
  const hoveredSpan = spans.find((span) => span.id === hoveredSpanId)
  const estimated = isEstimatedTiming(trace)

  return (
    <div className="flex h-[62px] shrink-0 items-center gap-4 border-t border-line bg-canvas px-4">
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => step(-1)}
          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-panel2 hover:text-ink"
          aria-label="Previous step"
          title="Previous step (←)"
        >
          <SkipBack size={14} />
        </button>
        <button
          onClick={toggle}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[#05101f] transition-colors hover:bg-[#6fafff]"
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          title="Play / pause (space)"
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
        </button>
        <button
          onClick={() => step(1)}
          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-panel2 hover:text-ink"
          aria-label="Next step"
          title="Next step (→)"
        >
          <SkipForward size={14} />
        </button>
      </div>

      <div className="w-[104px] shrink-0 font-mono text-[10.5px] text-muted">
        <span className="text-ink">{formatClock(playheadMs)}</span>
        <span className="text-faint"> / {formatClock(duration)}</span>
      </div>

      <Scrubber duration={duration} spans={spans} playheadMs={playheadMs} hoveredSpan={hoveredSpan} />

      <button
        onClick={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
          setSpeed(next)
        }}
        className="h-6 w-9 shrink-0 rounded-xs border border-line bg-panel font-mono text-[10px] text-muted transition-colors hover:border-line-strong hover:text-ink"
        title="Playback speed"
      >
        {speed}×
      </button>

      {estimated ? (
        <span
          className="hidden shrink-0 items-center gap-1 font-mono text-[9px] text-warn/80 lg:flex"
          title="This trace has no timestamps; durations were estimated by the adapter."
        >
          <span className="h-1 w-1 rounded-full bg-warn" />
          estimated
        </span>
      ) : null}

      <div className="hidden shrink-0 items-center gap-2 xl:flex">
        <span className="flex items-center gap-1 text-[9.5px] text-faint">
          <Kbd>space</Kbd> play
        </span>
        <span className="flex items-center gap-1 text-[9.5px] text-faint">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> step
        </span>
      </div>
    </div>
  )
}

function Scrubber({
  duration,
  spans,
  playheadMs,
  hoveredSpan,
}: {
  duration: number
  spans: Span[]
  playheadMs: number
  hoveredSpan: Span | undefined
}) {
  const seek = useReplayStore((state) => state.seek)
  const pause = useReplayStore((state) => state.pause)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const [hoverMs, setHoverMs] = useState<number | null>(null)

  const ratio = duration > 0 ? Math.min(playheadMs / duration, 1) : 0

  function positionFor(clientX: number): { ratio: number; x: number } {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { ratio: 0, x: 0 }
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width)
    return { ratio: rect.width > 0 ? x / rect.width : 0, x }
  }

  function updateFrom(clientX: number) {
    const { ratio: nextRatio } = positionFor(clientX)
    seek(nextRatio * duration)
  }

  const tooltipSpan = hoverMs !== null ? spanAtTime(spans, hoverMs) : null

  return (
    <div
      ref={containerRef}
      role="slider"
      aria-label="Replay position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(playheadMs)}
      tabIndex={0}
      className="relative h-8 min-w-0 flex-1 cursor-pointer touch-none select-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        pause()
        updateFrom(event.clientX)
        setHoverRatio(positionFor(event.clientX).ratio)
      }}
      onPointerMove={(event) => {
        const { ratio: nextRatio } = positionFor(event.clientX)
        setHoverRatio(nextRatio)
        setHoverMs(nextRatio * duration)
        if (dragging) updateFrom(event.clientX)
      }}
      onPointerUp={() => setDragging(false)}
      onPointerLeave={() => {
        if (!dragging) {
          setHoverRatio(null)
          setHoverMs(null)
        }
      }}
    >
      <div className="absolute inset-x-0 top-[17px] h-[3px] rounded-full bg-panel3" />
      <div
        className="absolute top-[17px] h-[3px] rounded-full bg-accent/55"
        style={{ width: `${ratio * 100}%` }}
      />

      {hoveredSpan ? (
        <div
          className="pointer-events-none absolute top-[12px] h-[13px] rounded-xs border-x border-accent/40 bg-accent/[0.09]"
          style={{
            left: `${(hoveredSpan.startMs / Math.max(duration, 1)) * 100}%`,
            width: `max(2px, ${((hoveredSpan.endMs - hoveredSpan.startMs) / Math.max(duration, 1)) * 100}%)`,
          }}
        />
      ) : null}

      {spans.map((span) => (
        <span
          key={span.id}
          className="absolute top-[11px] h-[9px] w-px rounded-full"
          style={{
            left: `${(span.startMs / Math.max(duration, 1)) * 100}%`,
            backgroundColor:
              span.type === 'edit'
                ? 'var(--color-edit)'
                : span.type === 'test'
                  ? span.status === 'error'
                    ? 'var(--color-fail)'
                    : 'var(--color-pass)'
                  : 'var(--color-muted)',
            opacity: span.startMs > playheadMs ? 0.45 : 0.9,
          }}
        />
      ))}

      <div
        className="absolute top-[7px] h-[22px] w-[2px] -translate-x-1/2 rounded-full bg-accent"
        style={{ left: `${ratio * 100}%` }}
      >
        <span className="absolute -left-[3px] -top-[1px] h-2 w-2 rounded-full border border-canvas bg-accent" />
      </div>

      {hoverRatio !== null && tooltipSpan ? (
        <div
          className="pointer-events-none absolute bottom-[34px] z-20 w-[220px] -translate-x-1/2 rounded-sm border border-line-strong bg-panel px-2.5 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          style={{
            left: `clamp(110px, ${hoverRatio * 100}%, calc(100% - 110px))`,
          }}
        >
          <div className="flex items-center gap-1.5">
            <SpanIcon type={tooltipSpan.type} size={11} />
            <span className="truncate text-[11px] text-ink">{tooltipSpan.name}</span>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-faint">
            <span>{formatClock(hoverMs ?? 0)}</span>
            <span className={clsx(tooltipSpan.status === 'error' && 'text-fail')}>
              {tooltipSpan.status}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
