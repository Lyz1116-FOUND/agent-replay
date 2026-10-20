import { describe, expect, it } from 'vitest'
import nativeSample from '../../examples/native-sample.trace.json'
import { importTraceText, TraceImportError } from './import'
import { adaptSweAgent } from './sweAgent'
import { sampleSweAgentTrajectory } from '../data/sampleTraj'
import { leafSpans, spanEnd } from '../lib/trace'

describe('SWE-agent adapter', () => {
  const trace = adaptSweAgent(sampleSweAgentTrajectory)

  it('maps steps onto the normalized span types', () => {
    expect(trace.spans.map((span) => span.type)).toEqual([
      'read',
      'search',
      'edit',
      'test',
      'edit',
      'test',
      'final',
    ])
    expect(trace.spans).toHaveLength(7)
  })

  it('marks synthesized durations as estimated', () => {
    expect(trace.metadata?.estimatedTiming).toBe(true)
    expect(trace.spans.every((span) => span.attributes?.estimatedTiming === true)).toBe(true)
    expect(trace.durationMs).toBe(spanEnd(trace))
  })

  it('tracks failures and the eventual passing run', () => {
    expect(trace.spans[3].status).toBe('error')
    expect(trace.spans[5].status).toBe('ok')
    expect(trace.spans[3].attributes?.failed).toBe(1)
    expect(trace.spans[5].attributes?.passed).toBe(14)
  })

  it('derives phases, changed files, and a partial status', () => {
    const phases = [...new Set(trace.spans.map((span) => span.attributes?.phase))]
    expect(phases).toContain('Modify')
    expect(phases).toContain('Verify')
    expect(phases).toContain('Submit')
    expect(trace.result.filesChanged).toEqual(['src/cachekit/lru.py'])
    expect(trace.status).toBe('partial')
  })

  it('produces a contiguous, ordered timeline', () => {
    const spans = leafSpans(trace)
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index].startMs).toBe(spans[index - 1].endMs)
    }
  })

  it('rejects an empty trajectory', () => {
    expect(() => adaptSweAgent({ trajectory: [] })).toThrow('no steps')
  })
})

describe('trace import', () => {
  it('detects a SWE-agent trajectory', () => {
    const result = importTraceText(JSON.stringify(sampleSweAgentTrajectory))
    expect(result.format).toBe('swe-agent')
    expect(result.trace.agent.name).toBe('SWE-agent')
  })

  it('imports the native example trace', () => {
    const result = importTraceText(JSON.stringify(nativeSample))
    expect(result.format).toBe('native')
    expect(result.trace.spans).toHaveLength(3)
    expect(result.trace.result.tests).toEqual({ passed: 14, failed: 0, total: 14 })
  })

  it('reports schema issues instead of throwing raw Zod errors', () => {
    let caught: unknown
    try {
      importTraceText('{"schemaVersion":"wrong"}')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(TraceImportError)
    if (caught instanceof TraceImportError) {
      expect(caught.message).toContain('schema')
      expect(caught.issues.length).toBeGreaterThan(0)
    }
  })

  it('reports invalid JSON', () => {
    expect(() => importTraceText('not json')).toThrow(TraceImportError)
  })
})
