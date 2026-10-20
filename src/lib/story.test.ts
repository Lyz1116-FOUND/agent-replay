import { describe, expect, it } from 'vitest'
import { lruClaudeRun } from '../data/lru-claude'
import { lruCodexRun } from '../data/lru-codex'
import { lruCursorRun } from '../data/lru-cursor'
import { jsonFlagRun } from '../data/json-flag'
import recordedSample from '../../examples/recorded-sample.trace.json'
import recordedNativeSample from '../../examples/recorded-native-cursor.trace.json'
import { traceSchema } from '../schema/trace'
import {
  buildOutcomeSummary,
  buildStory,
  detectRecovery,
  storyHeadline,
  testResults,
} from './story'

describe('recovery detection', () => {
  it('detects the Codex regression and recovery', () => {
    const recovery = detectRecovery(lruCodexRun)
    expect(recovery).not.toBeNull()
    expect(recovery?.regression).toBe(true)
    expect(recovery?.failingRuns).toBe(2)
    expect(recovery?.recoveredAt.span.id).toBe('s14')
    expect(recovery?.summary).toContain('3 failed')
    expect(recovery?.summary).toContain('8 failed')
    expect(recovery?.summary).toContain('14 passed')
  })

  it('detects the Claude recovery without a regression', () => {
    const recovery = detectRecovery(lruClaudeRun)
    expect(recovery?.regression).toBe(false)
    expect(recovery?.recoveredAt.span.id).toBe('c10')
  })

  it('does not call a run recovered when it ends failing', () => {
    expect(detectRecovery(lruCursorRun)).toBeNull()
  })

  it('parses a real recorder output', () => {
    const trace = traceSchema.parse(recordedSample)
    expect(trace.metadata?.source).toBe('recorder')
    expect(trace.spans.filter((span) => span.type === 'test')).toHaveLength(3)
    expect(detectRecovery(trace)).not.toBeNull()
  })

  it('parses a native+workspace recorder output with real overlap', () => {
    const trace = traceSchema.parse(recordedNativeSample)
    expect(trace.capture).toMatchObject({
      fidelity: 'native+workspace',
      timing: 'observed',
      workspaceVerified: 2,
      unverifiedEdits: 0,
    })
    expect(testResults(trace).map((result) => result.failed)).toEqual([1, 0])
    expect(detectRecovery(trace)).not.toBeNull()
    const failing = trace.spans.find((span) => span.type === 'test' && span.status === 'error')
    const overlappingEdit = trace.spans.find(
      (span) =>
        span.type === 'edit' &&
        failing &&
        span.startMs > failing.startMs &&
        span.endMs < failing.endMs,
    )
    expect(overlappingEdit).toBeDefined()
  })

  it('parses test outcomes from every demo run', () => {
    expect(testResults(lruCodexRun).map((result) => result.failed)).toEqual([3, 8, 0])
    expect(testResults(lruClaudeRun).map((result) => result.failed)).toEqual([3, 0, 0])
    expect(testResults(lruCursorRun).map((result) => result.failed)).toEqual([8, 4])
    expect(testResults(jsonFlagRun).map((result) => result.failed)).toEqual([0])
    expect(storyHeadline(lruCodexRun)).toContain('14 passed')
  })
})

describe('overview story', () => {
  it('turns the Codex run into test/edit/test/edit/test cards', () => {
    const nodes = buildStory(lruCodexRun)
    expect(nodes.map((node) => node.kind)).toEqual(['test', 'edit', 'test', 'edit', 'test'])
    expect(nodes.map((node) => node.tone)).toEqual(['fail', 'edit', 'fail', 'edit', 'pass'])
    expect(nodes[2].regression).toBe(true)
    expect(nodes[4].recovered).toBe(true)
  })

  it('keeps the failing Cursor run as a non-recovered story', () => {
    const nodes = buildStory(lruCursorRun)
    expect(nodes.every((node) => !node.recovered)).toBe(true)
    expect(nodes.filter((node) => node.kind === 'test').every((node) => node.tone === 'fail')).toBe(true)
  })
})

describe('outcome summaries', () => {
  it('summarizes regression and recovery', () => {
    expect(buildOutcomeSummary(lruCodexRun)).toBe(
      'Tried a fix that made things worse, then recovered.',
    )
  })

  it('summarizes an unrecovered failure', () => {
    expect(buildOutcomeSummary(lruCursorRun)).toBe(
      '2 edits across 2 test runs, but never recovered.',
    )
  })

  it('summarizes a clean solve', () => {
    expect(buildOutcomeSummary(jsonFlagRun)).toBe('Solved it with 2 edits and 1 test run.')
  })

  it('recognizes a docs-first recovery', () => {
    expect(buildOutcomeSummary(lruClaudeRun)).toBe(
      'Read more upfront, then recovered with a focused edit.',
    )
  })
})
