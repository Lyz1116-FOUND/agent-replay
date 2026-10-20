import { describe, expect, it } from 'vitest'
import { lruCodexRun } from '../data/lru-codex'
import { lruClaudeRun } from '../data/lru-claude'
import type { Span, Trace } from '../schema/trace'
import {
  buildFileIndex,
  formatClock,
  formatDuration,
  isEstimatedTiming,
  leafSpans,
  packSpanRows,
  playbackSpans,
  spanAtTime,
  spanDepths,
} from './trace'

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

function span(overrides: Partial<Span> & Pick<Span, 'id' | 'startMs' | 'endMs'>): Span {
  return {
    type: 'tool',
    name: overrides.id,
    status: 'ok',
    ...overrides,
  }
}

describe('nested and parallel layout', () => {
  const nested: Trace = {
    ...lruCodexRun,
    durationMs: 1000,
    spans: [
      span({ id: 'root', type: 'agent', startMs: 0, endMs: 1000 }),
      span({ id: 'child', parentId: 'root', startMs: 100, endMs: 400 }),
      span({ id: 'grandchild', parentId: 'child', startMs: 150, endMs: 250 }),
    ],
  }

  it('keeps parent spans in the playback list but not in leaf statistics', () => {
    expect(playbackSpans(nested).map((item) => item.id)).toEqual(['root', 'child', 'grandchild'])
    expect(leafSpans(nested).map((item) => item.id)).toEqual(['grandchild'])
  })

  it('computes depth from the parent chain and tolerates dangling parents', () => {
    const depths = spanDepths([
      ...nested.spans,
      span({ id: 'orphan', parentId: 'missing', startMs: 500, endMs: 600 }),
    ])
    expect(depths.get('root')).toBe(0)
    expect(depths.get('child')).toBe(1)
    expect(depths.get('grandchild')).toBe(2)
    expect(depths.get('orphan')).toBe(0)
  })

  it('gives overlapping spans their own row without moving them', () => {
    const rows = packSpanRows([
      span({ id: 'a', startMs: 0, endMs: 2000 }),
      span({ id: 'b', startMs: 500, endMs: 1500 }),
      span({ id: 'c', startMs: 2000, endMs: 2500 }),
    ])
    expect(rows.map((row) => row.map((item) => item.id))).toEqual([['a', 'c'], ['b']])
    expect(rows.flat().find((item) => item.id === 'b')).toMatchObject({ startMs: 500, endMs: 1500 })
  })
})
