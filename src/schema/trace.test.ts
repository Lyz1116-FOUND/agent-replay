import { describe, expect, it } from 'vitest'
import { lruCodexRun } from '../data/lru-codex'
import { traceSchema, type Span } from './trace'

function baseSpan(overrides: Partial<Span> = {}): Span {
  return {
    id: 's1',
    type: 'final',
    name: 'Done',
    startMs: 0,
    endMs: 1000,
    status: 'ok',
    ...overrides,
  }
}

function withSpans(spans: Span[], overrides: Record<string, unknown> = {}) {
  return {
    ...lruCodexRun,
    durationMs: Math.max(...spans.map((span) => span.endMs), 1),
    spans,
    ...overrides,
  }
}

describe('trace schema invariants', () => {
  it('accepts the full demo trace', () => {
    expect(() => traceSchema.parse(lruCodexRun)).not.toThrow()
  })

  it('accepts array attribute values', () => {
    const trace = withSpans([
      baseSpan({ attributes: { files: ['a.py', 'b.py'], counts: [1, 2], flags: [true, false] } }),
    ])
    expect(() => traceSchema.parse(trace)).not.toThrow()
  })

  it('rejects duplicate span ids', () => {
    const trace = withSpans([baseSpan(), baseSpan()])
    expect(() => traceSchema.parse(trace)).toThrow(/Duplicate span id/)
  })

  it('rejects missing parents and self-parenting', () => {
    const missing = withSpans([baseSpan({ parentId: 'nope' })])
    expect(() => traceSchema.parse(missing)).toThrow(/does not exist/)
    const self = withSpans([baseSpan({ parentId: 's1' })])
    expect(() => traceSchema.parse(self)).toThrow(/own parent/)
  })

  it('rejects children outside their parent', () => {
    const trace = withSpans([
      baseSpan({ id: 'parent', endMs: 1000 }),
      baseSpan({ id: 'child', parentId: 'parent', startMs: 500, endMs: 1500 }),
    ])
    expect(() => traceSchema.parse(trace)).toThrow(/within parent/)
  })

  it('rejects spans beyond the trace duration', () => {
    const trace = withSpans([baseSpan()], { durationMs: 500 })
    expect(() => traceSchema.parse(trace)).toThrow(/beyond trace duration/)
  })

  it('accepts capture fidelity metadata', () => {
    const trace = withSpans([baseSpan()], {
      capture: {
        fidelity: 'native+workspace',
        timing: 'observed',
        adapter: 'cursor',
        workspaceVerified: 1,
        unverifiedEdits: 0,
      },
    })
    expect(() => traceSchema.parse(trace)).not.toThrow()
  })

  it('rejects unknown capture fidelity', () => {
    const trace = withSpans([baseSpan()], {
      capture: { fidelity: 'guessed', timing: 'observed' },
    })
    expect(() => traceSchema.parse(trace)).toThrow()
  })

  it('rejects inconsistent test totals', () => {
    const trace = withSpans([baseSpan()], {
      result: { summary: 'x', tests: { passed: 3, failed: 2, total: 4 } },
    })
    expect(() => traceSchema.parse(trace)).toThrow(/must equal passed \+ failed/)
  })
})
