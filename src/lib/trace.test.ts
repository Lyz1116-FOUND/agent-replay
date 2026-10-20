import { describe, expect, it } from 'vitest'
import { lruCodexRun } from '../data/lru-codex'
import { lruClaudeRun } from '../data/lru-claude'
import { buildFileIndex, formatClock, formatDuration, isEstimatedTiming, leafSpans, spanAtTime } from './trace'

describe('trace helpers', () => {
  const spans = leafSpans(lruCodexRun)

  it('finds the span covering a playhead position', () => {
    expect(spanAtTime(spans, 0).id).toBe('s01')
    expect(spanAtTime(spans, 12_500).id).toBe('s06')
    expect(spanAtTime(spans, 59_199).id).toBe('s16')
  })

  it('formats clocks and durations', () => {
    expect(formatClock(12_400)).toBe('00:12.4')
    expect(formatClock(0)).toBe('00:00.0')
    expect(formatDuration(9600)).toBe('9.6s')
    expect(formatDuration(96_000)).toBe('1m 36s')
  })

  it('indexes file activity for the workspace view', () => {
    const files = buildFileIndex(lruCodexRun)
    const lru = files.find((file) => file.path === 'src/cachekit/lru.py')
    expect(lru).toBeDefined()
    expect(lru?.reads).toHaveLength(2)
    expect(lru?.edits).toHaveLength(2)
    expect(files.find((file) => file.path === 'README.md')?.reads).toHaveLength(1)
  })

  it('distinguishes recorded timing from estimated timing', () => {
    expect(isEstimatedTiming(lruCodexRun)).toBe(false)
    expect(isEstimatedTiming(lruClaudeRun)).toBe(false)
  })
})
