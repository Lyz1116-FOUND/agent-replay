import { describe, expect, it } from 'vitest'
import aiTrace from '../../examples/otel/ai-trace.json'
import asyncChild from '../../examples/otel/async-child.json'
import attributesNested from '../../examples/otel/attributes-nested.json'
import errorTrace from '../../examples/otel/error.json'
import generic from '../../examples/otel/generic.json'
import multiTrace from '../../examples/otel/multi-trace.json'
import nested from '../../examples/otel/nested.json'
import parallel from '../../examples/otel/parallel.json'
import realExporter from '../../examples/otel/real-exporter-node.json'
import snakeCase from '../../examples/otel/snake-case.json'
import statusUnset from '../../examples/otel/status-unset.json'
import timingPrecision from '../../examples/otel/timing-precision.json'
import { importTraceFile, TraceImportError } from './import'
import { adaptOtlpJson, isOtlpTraceJson } from './otel'
import { leafSpans, playbackSpans } from '../lib/trace'
import { parseNativeTrace } from '../schema/trace'
import { buildStory, detectRecovery, testResults } from '../lib/story'

function adapt(fixture: unknown) {
  const result = adaptOtlpJson(fixture)
  return { ...result, trace: result.traces[0] }
}

function issuesOf(fixture: unknown): string {
  try {
    adaptOtlpJson(fixture)
  } catch (error) {
    if (error instanceof TraceImportError) return [error.message, ...error.issues].join('\n')
    throw error
  }
  return ''
}

function invalidTrace(spans: unknown[]) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [{ scope: { name: 'test' }, spans }],
      },
    ],
  }
}

describe('OTLP import contract', () => {
  it('detects OTLP JSON and keeps the native formats working', () => {
    expect(isOtlpTraceJson(generic)).toBe(true)
    expect(isOtlpTraceJson({ schemaVersion: 'agent-replay/v1' })).toBe(false)

    const result = importTraceFile(JSON.stringify(generic))
    expect(result.format).toBe('otlp')
    expect(result.traces).toHaveLength(1)
    expect(result.diagnostics).toEqual([])
  })

  it('maps a parent/child pair without inventing a task verdict', () => {
    const { trace, diagnostics } = adapt(generic)
    expect(diagnostics).toEqual([])
    expect(trace.spans).toHaveLength(2)
    expect(trace.spans[0].parentId).toBeUndefined()
    expect(trace.spans[1].parentId).toBe(trace.spans[0].id)
    expect(trace.status).toBe('partial')
    expect(trace.result.tests).toBeUndefined()
    expect(trace.termination).toBeUndefined()
    expect(trace.capture).toMatchObject({
      fidelity: 'otel',
      timing: 'observed',
      workspaceVerification: 'unavailable',
      adapter: 'otlp-json',
    })
  })

  it('maps GenAI operations and exact tool names, and keeps unknown spans generic', () => {
    const { trace } = adapt(nested)
    const byName = new Map(trace.spans.map((span) => [span.name, span]))
    expect(byName.get('invoke_agent')?.type).toBe('agent')
    expect(byName.get('chat gpt-5-mini')?.type).toBe('generation')
    expect(byName.get('execute_tool bash')?.type).toBe('shell')
    expect(byName.get('bash -lc "node --test"')?.type).toBe('test')
    expect(byName.get('read_file')?.type).toBe('read')
    expect(byName.get('read_file')?.files).toEqual(['src/lru.py'])
  })

  it('keeps a span generic when no semantic convention matches', () => {
    const { trace } = adapt(generic)
    const root = trace.spans.find((span) => span.name === 'agent.run')
    expect(root?.type).toBe('unknown')
    expect(root?.attributes?.['otel.typeSource']).toBe('fallback')
    const tool = trace.spans.find((span) => span.name === 'tool.call')
    expect(tool?.type).toBe('shell')
    expect(tool?.attributes?.['otel.typeSource']).toBe('tool.name')
  })

  it('preserves hierarchy depth and playback includes parents', () => {
    const { trace } = adapt(nested)
    const root = trace.spans.find((span) => !span.parentId)
    expect(root?.name).toBe('invoke_agent')
    const children = trace.spans.filter((span) => span.parentId === root?.id)
    expect(children).toHaveLength(3)
    // leafSpans still answers "what did the work"; playback keeps containers.
    expect(leafSpans(trace).length).toBeLessThan(trace.spans.length)
    expect(playbackSpans(trace)).toHaveLength(trace.spans.length)
  })

  it('keeps parallel siblings at their exported times', () => {
    const { trace } = adapt(parallel)
    const bashSpans = trace.spans.filter((span) => span.name.startsWith('bash'))
    expect(bashSpans).toHaveLength(2)
    const [first, second] = bashSpans
    expect(first.startMs).toBe(100)
    expect(first.endMs).toBe(2100)
    expect(second.startMs).toBe(600)
    expect(second.endMs).toBe(3200)
    // Overlap survives: the second span starts before the first ends.
    expect(second.startMs).toBeLessThan(first.endMs)
    const generation = trace.spans.find((span) => span.type === 'generation')
    expect(generation?.startMs).toBe(700)
  })

  it('keeps span errors and exception events without promoting them to task failure', () => {
    const { trace } = adapt(errorTrace)
    const failing = trace.spans.find((span) => span.name === 'run_tests' && span.status === 'error')
    expect(failing).toBeDefined()
    expect(failing?.attributes?.['otel.statusMessage']).toBe('Command failed with exit code 1')
    expect(failing?.attributes?.['otel.eventCount']).toBe(1)
    const raw = failing?.raw?.otlp as { events?: unknown[] }
    expect(raw.events).toHaveLength(1)
    expect(trace.status).toBe('partial')
    expect(trace.result.tests).toBeUndefined()
  })

  it('treats unset status as unknown, not success', () => {
    const { trace } = adapt(statusUnset)
    expect(trace.spans[0].status).toBe('unset')
    expect(trace.spans[0].attributes?.['otel.statusCode']).toBe('unset')
    expect(trace.spans[1].status).toBe('error')
    expect(trace.spans[2].status).toBe('ok')
    expect(trace.status).toBe('partial')
    expect(trace.termination).toBeUndefined()
  })

  it('maps AI traces to generation spans instead of reasoning', () => {
    const { trace } = adapt(aiTrace)
    expect(trace.spans.filter((span) => span.type === 'generation')).toHaveLength(2)
    expect(trace.spans.some((span) => span.type === 'reasoning')).toBe(false)
    expect(trace.agent.name).toBe('openai-agents')
    expect(trace.agent.model).toBe('gpt-5')
  })

  it('splits a multi-trace file by traceId and keeps resources apart', () => {
    const { traces, diagnostics } = adaptOtlpJson(multiTrace)
    expect(diagnostics).toEqual([])
    expect(traces).toHaveLength(2)
    expect(traces.map((trace) => trace.spans.length)).toEqual([2, 2])
    expect(traces[0].id).not.toBe(traces[1].id)
    for (const trace of traces) {
      const otel = trace.metadata?.otel as { resources: unknown[] }
      expect(otel.resources).toHaveLength(1)
    }
    // Same spanId in two different traces is legal.
    expect(traces[0].spans[0].id).toBe(traces[1].spans[0].id)
  })

  it('keeps nanosecond precision and int64 attributes exact', () => {
    const { trace } = adapt(timingPrecision)
    const [instant, later] = trace.spans
    expect(instant.startMs).toBe(0)
    expect(instant.endMs).toBe(0)
    expect(later.startMs).toBeCloseTo(0.000001, 10)
    expect(later.endMs - later.startMs).toBeCloseTo(1000, 6)
    const raw = later.raw?.otlp as { startTimeUnixNano: string }
    expect(raw.startTimeUnixNano).toBe('1760864400000000001')
    // Beyond 2^53 the exact decimal is kept instead of a rounded double.
    expect(later.attributes?.['big.counter']).toBe('9007199254740993')
  })

  it('accepts a child that outlives its parent and keeps missing parents dangling', () => {
    const { trace, diagnostics } = adapt(asyncChild)
    const parent = trace.spans.find((span) => span.name === 'enqueue')
    const child = trace.spans.find((span) => span.name === 'background job')
    expect(parent?.endMs).toBe(100)
    expect(child?.startMs).toBe(50)
    expect(child?.endMs).toBe(900)
    expect(child?.endMs).toBeGreaterThan(parent?.endMs ?? 0)

    const orphan = trace.spans.find((span) => span.name === 'orphan child')
    expect(orphan?.parentId).toBe('99999999999999ff')
    const otel = trace.metadata?.otel as { orphanParentIds: string[] }
    expect(otel.orphanParentIds).toEqual(['99999999999999ff'])
    expect(diagnostics.some((item) => item.message.includes('missing from the export'))).toBe(true)
  })

  it('keeps nested attributes in raw while flat attributes stay scalar', () => {
    const { trace, diagnostics } = adapt(attributesNested)
    const span = trace.spans[0]
    expect(span.attributes?.['feature.enabled']).toBe(false)
    expect(span.attributes?.['retry.count']).toBe(0)
    expect(span.attributes?.['empty.list']).toEqual([])
    expect(span.attributes?.['tags']).toEqual(['a', 'b'])
    // Nested map, mixed array and bytes are not flattened away.
    expect(span.attributes?.['request.meta']).toBeUndefined()
    expect(span.attributes?.['mixed']).toBeUndefined()
    expect(span.attributes?.['payload.bytes']).toBeUndefined()
    const raw = span.raw?.otlp as { attributes: { key: string }[] }
    expect(raw.attributes.map((attribute) => attribute.key)).toContain('request.meta')
    expect(raw.attributes.map((attribute) => attribute.key)).toContain('payload.bytes')
    expect(diagnostics.some((item) => item.message.includes('raw only'))).toBe(true)
    // Resource and span attributes stay separate even with the same key.
    expect(trace.agent.name).toBe('resource-name')
    expect(span.attributes?.['service.name']).toBe('span-name')
  })

  it('accepts snake_case OTLP field names', () => {
    const { trace } = adapt(snakeCase)
    expect(trace.spans).toHaveLength(2)
    expect(trace.spans[1].parentId).toBe(trace.spans[0].id)
    expect(trace.spans[1].startMs).toBe(100)
  })

  it('imports a payload captured from a real OTLP/HTTP exporter', () => {
    const { trace, diagnostics } = adapt(realExporter)
    expect(diagnostics).toEqual([])
    expect(trace.spans).toHaveLength(3)
    const root = trace.spans.find((span) => span.name === 'invoke_agent')
    const generation = trace.spans.find((span) => span.name === 'chat gpt-5-mini')
    const tool = trace.spans.find((span) => span.name === 'execute_tool bash')
    expect(root?.type).toBe('agent')
    expect(generation?.type).toBe('generation')
    expect(tool?.type).toBe('shell')
    expect(generation?.parentId).toBe(root?.id)
    expect(tool?.parentId).toBe(generation?.id)
    // Exporter order was child-first; the timeline is still chronological.
    // The Node SDK clock has millisecond granularity, so all three share t=0.
    expect(root!.startMs).toBe(0)
    expect(root!.endMs).toBeGreaterThan(tool!.endMs)
    expect(generation!.endMs).toBeGreaterThan(tool!.endMs)
    expect(tool?.status).toBe('error')
    expect(root?.status).toBe('unset')
    expect(trace.agent.name).toBe('otel-export-smoke')
    expect(trace.status).toBe('partial')
  })

  it('produces stable ids for repeated imports of the same file', () => {
    const first = adaptOtlpJson(generic).traces[0]
    const second = adaptOtlpJson(generic).traces[0]
    expect(second.id).toBe(first.id)
    expect(second.spans.map((span) => span.id)).toEqual(first.spans.map((span) => span.id))
  })
})

describe('OTLP import counterexamples', () => {
  it('rejects invalid and all-zero ids', () => {
    const badTrace = invalidTrace([
      {
        traceId: 'zzz',
        spanId: '1111111111111111',
        name: 'bad trace id',
        startTimeUnixNano: '1',
        endTimeUnixNano: '2',
      },
      {
        traceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        spanId: '0000000000000000',
        name: 'zero span id',
        startTimeUnixNano: '1',
        endTimeUnixNano: '2',
      },
    ])
    expect(() => adaptOtlpJson(badTrace)).toThrow(TraceImportError)
  })

  it('rejects spans that end before they start', () => {
    const badTrace = invalidTrace([
      {
        traceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        spanId: '1111111111111111',
        name: 'backwards',
        startTimeUnixNano: '2000',
        endTimeUnixNano: '1000',
      },
    ])
    expect(issuesOf(badTrace)).toMatch(/ends before it starts/)
  })

  it('rejects a parent cycle instead of hanging the hierarchy', () => {
    const cyclic = invalidTrace([
      {
        traceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        spanId: '1111111111111111',
        parentSpanId: '2222222222222222',
        name: 'a',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '2000000000',
      },
      {
        traceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        spanId: '2222222222222222',
        parentSpanId: '1111111111111111',
        name: 'b',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '2000000000',
      },
    ])
    expect(issuesOf(cyclic)).toMatch(/cycle/)
  })

  it('rejects a self-parenting span', () => {
    const selfParent = invalidTrace([
      {
        traceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        spanId: '1111111111111111',
        parentSpanId: '1111111111111111',
        name: 'self',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '2000000000',
      },
    ])
    expect(issuesOf(selfParent)).toMatch(/own parent/)
  })

  it('rejects a file that is not an OTLP export', () => {
    expect(() => adaptOtlpJson({ spans: [] })).toThrow(/Not an OTLP JSON trace export/)
  })
})

describe('M5 review regressions', () => {
  const TRACE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  const int = (key: string, value: number) => ({ key, value: { intValue: String(value) } })

  it('attributes each trace to the resources it actually used', () => {
    const { traces } = adaptOtlpJson(multiTrace)
    const [agentA, agentB] = traces
    expect(agentA.agent.name).toBe('agent-a')
    expect(agentB.agent.name).toBe('agent-b')

    for (const trace of traces) {
      const otel = trace.metadata?.otel as {
        resources: { index: number; scopes: { index: number }[] }[]
        services: string[]
      }
      expect(otel.resources).toHaveLength(1)
      expect(otel.services).toHaveLength(1)
      for (const span of trace.spans) {
        const raw = span.raw as { resourceIndex: number; scopeIndex: number }
        const resource = otel.resources[raw.resourceIndex]
        expect(resource).toBeDefined()
        expect(resource.scopes.some((scope) => scope.index === raw.scopeIndex)).toBe(true)
      }
    }
    const agentBMetadata = agentB.metadata?.otel as { resources: { index: number }[] }
    expect(agentBMetadata.resources[0].index).toBe(1)
  })

  it('normalizes hex id casing before grouping, parent lookup and orphan detection', () => {
    const payload = invalidTrace([
      {
        traceId: TRACE.toUpperCase(),
        spanId: 'AAAAAAAAAAAAAAA1',
        name: 'root',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '3000000000',
      },
      {
        traceId: TRACE,
        spanId: 'aaaaaaaaaaaaaaa2',
        parentSpanId: 'AAAAAAAAAAAAAAA1',
        name: 'child',
        startTimeUnixNano: '1500000000',
        endTimeUnixNano: '2500000000',
      },
    ])
    const { traces, diagnostics } = adaptOtlpJson(payload)
    expect(traces).toHaveLength(1)
    expect(traces[0].spans).toHaveLength(2)
    expect(traces[0].spans[1].parentId).toBe(traces[0].spans[0].id)
    expect(diagnostics.some((item) => item.message.includes('missing from the export'))).toBe(false)
    const otel = traces[0].metadata?.otel as { orphanParentIds: string[] }
    expect(otel.orphanParentIds).toEqual([])
    // Raw keeps the casing that was in the file.
    const rawSpan = traces[0].spans[0].raw?.otlp as { traceId: string }
    expect(rawSpan.traceId).toBe(TRACE.toUpperCase())
  })

  it('keeps resource and scope context verbatim, including dropped counts', () => {
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'ctx' } }],
            droppedAttributesCount: 3,
          },
          scopeSpans: [
            {
              scope: {
                name: 'ctx-scope',
                attributes: [{ key: 'scope.attr', value: { stringValue: 'keep' } }],
                droppedAttributesCount: 4,
              },
              spans: [
                {
                  traceId: TRACE,
                  spanId: 'bbbbbbbbbbbbbbb1',
                  name: 'root',
                  startTimeUnixNano: '1000000000',
                  endTimeUnixNano: '2000000000',
                },
              ],
            },
          ],
        },
      ],
    }
    const { trace } = adapt(payload)
    const otel = trace.metadata?.otel as {
      resources: {
        droppedAttributesCount: number
        resource: { droppedAttributesCount: number }
        scopes: {
          droppedAttributesCount: number
          attributes: { key: string }[]
          scope: { name: string }
        }[]
      }[]
    }
    expect(otel.resources[0].droppedAttributesCount).toBe(3)
    expect(otel.resources[0].resource.droppedAttributesCount).toBe(3)
    expect(otel.resources[0].scopes[0].droppedAttributesCount).toBe(4)
    expect(otel.resources[0].scopes[0].attributes[0].key).toBe('scope.attr')
    expect(otel.resources[0].scopes[0].scope.name).toBe('ctx-scope')

    // Serializing the normalized trace and parsing it back keeps the raw context.
    const roundTripped = parseNativeTrace(JSON.parse(JSON.stringify(trace)))
    expect(roundTripped.metadata).toEqual(trace.metadata)
    expect(roundTripped.spans[0].raw).toEqual(trace.spans[0].raw)
  })

  it('keeps nested arrays in raw instead of rejecting the trace', () => {
    const payload = invalidTrace([
      {
        traceId: TRACE,
        spanId: 'ccccccccccccccc1',
        name: 'root',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '2000000000',
        attributes: [
          {
            key: 'nested',
            value: {
              arrayValue: {
                values: [
                  { arrayValue: { values: [{ stringValue: 'a' }] } },
                  { arrayValue: { values: [{ stringValue: 'b' }] } },
                ],
              },
            },
          },
          {
            key: 'flat',
            value: { arrayValue: { values: [{ stringValue: 'x' }, { stringValue: 'y' }] } },
          },
        ],
      },
    ])
    const { trace } = adapt(payload)
    expect(trace.spans[0].attributes?.nested).toBeUndefined()
    expect(trace.spans[0].attributes?.flat).toEqual(['x', 'y'])
    const raw = trace.spans[0].raw?.otlp as { attributes: { key: string }[] }
    expect(raw.attributes.map((attribute) => attribute.key)).toContain('nested')
  })

  it('rejects numeric nanosecond timestamps instead of silently rounding', () => {
    const payload = invalidTrace([
      {
        traceId: TRACE,
        spanId: 'ddddddddddddddd1',
        name: 'numeric',
        // Deliberately unsafe numbers: JSON.parse has already rounded them.
        startTimeUnixNano: Number('1760864400000000001'),
        endTimeUnixNano: Number('1760864400000000002'),
      },
    ])
    expect(issuesOf(payload)).toMatch(/numeric timestamp/)
    expect(() => importTraceFile(JSON.stringify(payload))).toThrow(TraceImportError)
  })

  it('keeps an explicit tool operation generic even when a provider is present', () => {
    const payload = invalidTrace([
      {
        traceId: TRACE,
        spanId: 'eeeeeeeeeeeeeee1',
        name: 'execute_tool',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '2000000000',
        attributes: [
          { key: 'gen_ai.operation.name', value: { stringValue: 'execute_tool' } },
          { key: 'gen_ai.provider.name', value: { stringValue: 'openai' } },
        ],
      },
    ])
    const { trace } = adapt(payload)
    expect(trace.spans[0].type).toBe('tool')
    expect(trace.spans[0].attributes?.['otel.typeSource']).toBe(
      'gen_ai.operation.name (tool without name)',
    )
  })

  it('does not infer generation from provider or model attributes alone', () => {
    const payload = invalidTrace([
      {
        traceId: TRACE,
        spanId: 'eeeeeeeeeeeeeee2',
        name: 'model-ish',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '2000000000',
        attributes: [
          { key: 'gen_ai.provider.name', value: { stringValue: 'openai' } },
          { key: 'gen_ai.request.model', value: { stringValue: 'gpt-5' } },
        ],
      },
    ])
    const { trace } = adapt(payload)
    expect(trace.spans[0].type).toBe('unknown')
    expect(trace.spans[0].attributes?.['otel.typeSource']).toBe('gen_ai.* (no operation)')
  })

  it('does not build a recovery story from generic passed/failed attributes', () => {
    const payload = invalidTrace([
      {
        traceId: TRACE,
        spanId: 'fffffffffffffff1',
        name: 'run_tests',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '2000000000',
        attributes: [
          { key: 'tool.name', value: { stringValue: 'run_tests' } },
          int('passed', 1),
          int('failed', 2),
        ],
      },
      {
        traceId: TRACE,
        spanId: 'fffffffffffffff2',
        name: 'run_tests',
        startTimeUnixNano: '2500000000',
        endTimeUnixNano: '3000000000',
        attributes: [
          { key: 'tool.name', value: { stringValue: 'run_tests' } },
          int('passed', 3),
          int('failed', 0),
        ],
      },
    ])
    const { trace } = adapt(payload)
    expect(trace.spans.map((span) => span.type)).toEqual(['test', 'test'])
    expect(testResults(trace)).toEqual([])
    expect(detectRecovery(trace)).toBeNull()
    expect(buildStory(trace).some((node) => node.kind === 'test')).toBe(false)
  })

  it('does not turn a lone total attribute into a green test story', () => {
    const payload = invalidTrace([
      {
        traceId: TRACE,
        spanId: '7777777777777771',
        name: 'run_tests',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '2000000000',
        attributes: [
          { key: 'tool.name', value: { stringValue: 'run_tests' } },
          int('total', 7),
        ],
      },
    ])
    const { trace } = adapt(payload)
    expect(trace.spans[0].type).toBe('test')
    expect(trace.spans[0].attributes?.total).toBe(7)
    expect(testResults(trace)).toEqual([])
    expect(detectRecovery(trace)).toBeNull()
    const story = buildStory(trace)
    expect(story.some((node) => node.kind === 'test')).toBe(false)
    expect(story).toHaveLength(1)
    expect(story[0]).toMatchObject({ title: 'Outcome not evaluated', tone: 'neutral' })
  })

  it('still honours an explicit test artifact on an exported span', () => {
    const payload = invalidTrace([
      {
        traceId: TRACE,
        spanId: '7777777777777772',
        name: 'run_tests',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '2000000000',
        attributes: [{ key: 'tool.name', value: { stringValue: 'run_tests' } }],
      },
    ])
    const { trace } = adapt(payload)
    trace.spans[0].artifacts = [
      {
        kind: 'test',
        command: 'node --test',
        passed: 4,
        failed: 0,
        total: 4,
        output: '4 passing',
      },
    ]
    const results = testResults(trace)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ passed: 4, failed: 0, total: 4 })
  })

  it('reads snake_case AnyValue field names', () => {
    const payload = invalidTrace([
      {
        traceId: TRACE,
        spanId: '9999999999999991',
        name: 'snake values',
        startTimeUnixNano: '1000000000',
        endTimeUnixNano: '2000000000',
        attributes: [
          { key: 'note', value: { string_value: 'kept' } },
          { key: 'count', value: { int_value: '7' } },
          { key: 'ok', value: { bool_value: true } },
        ],
      },
    ])
    const { trace } = adapt(payload)
    expect(trace.spans[0].attributes?.note).toBe('kept')
    expect(trace.spans[0].attributes?.count).toBe(7)
    expect(trace.spans[0].attributes?.ok).toBe(true)
  })
})
