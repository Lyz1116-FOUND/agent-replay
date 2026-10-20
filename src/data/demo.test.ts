import { describe, expect, it } from 'vitest'
import { demoRuns } from './runs'
import { traceSchema } from '../schema/trace'
import { leafSpans, spanEnd } from '../lib/trace'

const runsWithNames = demoRuns.map((run) => [run.id, run] as const)

describe('demo traces', () => {
  it.each(runsWithNames)('%s validates against the schema', (_id, run) => {
    expect(() => traceSchema.parse(run)).not.toThrow()
  })

  it.each(runsWithNames)('%s has a contiguous timeline', (_id, run) => {
    const spans = leafSpans(run)
    expect(spans[0].startMs).toBe(0)
    expect(run.durationMs).toBe(spanEnd(run))
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index].startMs).toBe(spans[index - 1].endMs)
      expect(spans[index].endMs).toBeGreaterThan(spans[index].startMs)
    }
  })

  it.each(runsWithNames)('%s reports the last test outcome', (_id, run) => {
    if (!run.result.tests) return
    const artifacts = leafSpans(run)
      .filter((span) => span.type === 'test')
      .flatMap((span) => span.artifacts ?? [])
      .filter((artifact) => artifact.kind === 'test')
    const last = artifacts[artifacts.length - 1]
    expect(last?.kind).toBe('test')
    if (last?.kind !== 'test') return
    expect(last.passed).toBe(run.result.tests.passed)
    expect(last.failed).toBe(run.result.tests.failed)
    expect(last.total).toBe(run.result.tests.total)
  })

  it.each(runsWithNames)('%s changed exactly the files it edited', (_id, run) => {
    const edited = [
      ...new Set(
        leafSpans(run)
          .filter((span) => span.type === 'edit')
          .flatMap((span) => span.files ?? []),
      ),
    ].sort()
    expect([...(run.result.filesChanged ?? [])].sort()).toEqual(edited)
  })

  it('keeps the failure -> recovery story in the Codex run', () => {
    const run = demoRuns.find((item) => item.id === 'run_lru_codex_9f2a')
    expect(run).toBeDefined()
    const outcomes = leafSpans(run!)
      .filter((span) => span.type === 'test')
      .map((span) => span.artifacts?.find((artifact) => artifact.kind === 'test'))
      .filter((artifact) => artifact?.kind === 'test')
      .map((artifact) => {
        if (artifact?.kind !== 'test') return null
        return { passed: artifact.passed, failed: artifact.failed }
      })
    expect(outcomes).toEqual([
      { passed: 11, failed: 3 },
      { passed: 6, failed: 8 },
      { passed: 14, failed: 0 },
    ])
  })

  it('keeps every edit artifact as a real diff', () => {
    for (const run of demoRuns) {
      for (const span of leafSpans(run).filter((item) => item.type === 'edit')) {
        const diff = span.artifacts?.find((artifact) => artifact.kind === 'diff')
        expect(diff?.kind).toBe('diff')
        if (diff?.kind !== 'diff') continue
        expect(diff.before).not.toBe(diff.after)
      }
    }
  })
})
