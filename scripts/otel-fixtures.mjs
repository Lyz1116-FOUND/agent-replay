// Deterministic OTLP/JSON fixtures for the M5 import contract.
// Run: node scripts/otel-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'examples', 'otel')
mkdirSync(outDir, { recursive: true })

const BASE = 1760864400000000000n // 2025-10-19T09:00:00Z
const NS_PER_MS = 1000000n
const at = (offsetMs, extraNs = 0n) => String(BASE + BigInt(Math.round(offsetMs * 1000)) * 1000n + extraNs)

const str = (key, value) => ({ key, value: { stringValue: value } })
const int = (key, value) => ({ key, value: { intValue: String(value) } })
const dbl = (key, value) => ({ key, value: { doubleValue: value } })
const bool = (key, value) => ({ key, value: { boolValue: value } })
const arr = (key, values) => ({ key, value: { arrayValue: { values } } })
const kv = (key, values) => ({ key, value: { kvlistValue: { values } } })

function span({
  traceId,
  spanId,
  parentSpanId,
  name,
  startMs,
  endMs,
  startNs,
  endNs,
  kind = 1,
  attributes = [],
  status,
  events,
  links,
  droppedAttributesCount,
}) {
  return {
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name,
    kind,
    startTimeUnixNano: startNs ?? at(startMs),
    endTimeUnixNano: endNs ?? at(endMs),
    attributes,
    ...(status ? { status } : {}),
    ...(events ? { events } : {}),
    ...(links ? { links } : {}),
    ...(droppedAttributesCount ? { droppedAttributesCount } : {}),
  }
}

function payload(resourceSpans) {
  return { resourceSpans }
}

function resource({ service = 'demo-agent', attributes = [], scopes }) {
  return {
    resource: {
      attributes: [str('service.name', service), ...attributes],
    },
    scopeSpans: scopes.map(({ name, version = '1.0.0', spans }) => ({
      scope: { name, version },
      spans,
    })),
  }
}

const T1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const T2 = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'

const write = (file, data) => {
  writeFileSync(join(outDir, file), `${JSON.stringify(data, null, 2)}\n`)
}

// 1. Generic: agent root + one tool child.
write(
  'generic.json',
  payload([
    resource({
      scopes: [
        {
          name: 'agent-sdk',
          spans: [
            span({
              traceId: T1,
              spanId: '1111111111111111',
              name: 'agent.run',
              startMs: 0,
              endMs: 4200,
              attributes: [str('agent.name', 'demo-agent')],
              status: { code: 0 },
            }),
            span({
              traceId: T1,
              spanId: '2222222222222222',
              parentSpanId: '1111111111111111',
              name: 'tool.call',
              startMs: 300,
              endMs: 1800,
              attributes: [str('tool.name', 'bash'), str('tool.input', 'npm test')],
              status: { code: 1 },
            }),
          ],
        },
      ],
    }),
  ]),
)

// 2. Nested: agent -> generation -> tool -> shell, plus a read.
write(
  'nested.json',
  payload([
    resource({
      scopes: [
        {
          name: 'agent-sdk',
          spans: [
            span({
              traceId: T1,
              spanId: 'aaaaaaaaaaaaaaa1',
              name: 'invoke_agent',
              startMs: 0,
              endMs: 5000,
              attributes: [
                str('gen_ai.operation.name', 'invoke_agent'),
                str('gen_ai.provider.name', 'openai'),
                str('gen_ai.request.model', 'gpt-5-mini'),
              ],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'aaaaaaaaaaaaaaa2',
              parentSpanId: 'aaaaaaaaaaaaaaa1',
              name: 'chat gpt-5-mini',
              startMs: 100,
              endMs: 1200,
              attributes: [
                str('gen_ai.operation.name', 'chat'),
                str('gen_ai.request.model', 'gpt-5-mini'),
                int('gen_ai.usage.input_tokens', 812),
                int('gen_ai.usage.output_tokens', 64),
              ],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'aaaaaaaaaaaaaaa3',
              parentSpanId: 'aaaaaaaaaaaaaaa1',
              name: 'execute_tool bash',
              startMs: 1300,
              endMs: 2600,
              attributes: [
                str('gen_ai.operation.name', 'execute_tool'),
                str('gen_ai.tool.name', 'bash'),
              ],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'aaaaaaaaaaaaaaa4',
              parentSpanId: 'aaaaaaaaaaaaaaa3',
              name: 'bash -lc "node --test"',
              startMs: 1400,
              endMs: 2400,
              attributes: [str('tool.name', 'run_tests'), int('process.exit_code', 1)],
              status: { code: 2, message: 'tests failed' },
            }),
            span({
              traceId: T1,
              spanId: 'aaaaaaaaaaaaaaa5',
              parentSpanId: 'aaaaaaaaaaaaaaa1',
              name: 'read_file',
              startMs: 2700,
              endMs: 3100,
              attributes: [str('tool.name', 'read_file'), str('file.path', 'src/lru.py')],
              status: { code: 1 },
            }),
          ],
        },
      ],
    }),
  ]),
)

// 3. Parallel: overlapping siblings of the same type.
write(
  'parallel.json',
  payload([
    resource({
      scopes: [
        {
          name: 'agent-sdk',
          spans: [
            span({
              traceId: T1,
              spanId: 'bbbbbbbbbbbbbbb1',
              name: 'agent.run',
              startMs: 0,
              endMs: 4000,
              attributes: [str('gen_ai.operation.name', 'invoke_agent')],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'bbbbbbbbbbbbbbb2',
              parentSpanId: 'bbbbbbbbbbbbbbb1',
              name: 'bash A',
              startMs: 100,
              endMs: 2100,
              attributes: [str('tool.name', 'bash')],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'bbbbbbbbbbbbbbb3',
              parentSpanId: 'bbbbbbbbbbbbbbb1',
              name: 'bash B',
              startMs: 600,
              endMs: 3200,
              attributes: [str('tool.name', 'bash')],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'bbbbbbbbbbbbbbb4',
              parentSpanId: 'bbbbbbbbbbbbbbb1',
              name: 'grep TODO',
              startMs: 200,
              endMs: 900,
              attributes: [str('tool.name', 'grep')],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'bbbbbbbbbbbbbbb5',
              parentSpanId: 'bbbbbbbbbbbbbbb1',
              name: 'chat',
              startMs: 700,
              endMs: 1500,
              attributes: [str('gen_ai.operation.name', 'chat')],
              status: { code: 1 },
            }),
          ],
        },
      ],
    }),
  ]),
)

// 4. Error: tool error with an exception event, then a later success.
write(
  'error.json',
  payload([
    resource({
      scopes: [
        {
          name: 'agent-sdk',
          spans: [
            span({
              traceId: T1,
              spanId: 'ccccccccccccccc1',
              name: 'agent.run',
              startMs: 0,
              endMs: 3000,
              attributes: [str('gen_ai.operation.name', 'invoke_agent')],
              status: { code: 0 },
            }),
            span({
              traceId: T1,
              spanId: 'ccccccccccccccc2',
              parentSpanId: 'ccccccccccccccc1',
              name: 'run_tests',
              startMs: 100,
              endMs: 1200,
              attributes: [str('tool.name', 'run_tests')],
              status: { code: 2, message: 'Command failed with exit code 1' },
              events: [
                {
                  timeUnixNano: at(1150),
                  name: 'exception',
                  attributes: [
                    str('exception.type', 'CommandError'),
                    str('exception.message', '1 failing'),
                  ],
                },
              ],
            }),
            span({
              traceId: T1,
              spanId: 'ccccccccccccccc3',
              parentSpanId: 'ccccccccccccccc1',
              name: 'run_tests',
              startMs: 1500,
              endMs: 2600,
              attributes: [str('tool.name', 'run_tests')],
              status: { code: 1 },
            }),
          ],
        },
      ],
    }),
  ]),
)

// 5. AI trace: generation -> tool -> generation.
write(
  'ai-trace.json',
  payload([
    resource({
      service: 'openai-agents',
      attributes: [str('service.version', '0.4.2')],
      scopes: [
        {
          name: 'openinference.instrumentation.openai_agents',
          version: '0.1.0',
          spans: [
            span({
              traceId: T1,
              spanId: 'ddddddddddddddd1',
              name: 'Agent workflow',
              startMs: 0,
              endMs: 6000,
              attributes: [str('gen_ai.operation.name', 'invoke_agent')],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'ddddddddddddddd2',
              parentSpanId: 'ddddddddddddddd1',
              name: 'chat',
              startMs: 50,
              endMs: 900,
              attributes: [
                str('gen_ai.operation.name', 'chat'),
                str('gen_ai.provider.name', 'openai'),
                str('gen_ai.request.model', 'gpt-5'),
                dbl('gen_ai.usage.cost', 0.0123),
              ],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'ddddddddddddddd3',
              parentSpanId: 'ddddddddddddddd1',
              name: 'execute_tool shell',
              startMs: 1000,
              endMs: 2600,
              attributes: [
                str('gen_ai.operation.name', 'execute_tool'),
                str('gen_ai.tool.name', 'shell'),
              ],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'ddddddddddddddd4',
              parentSpanId: 'ddddddddddddddd1',
              name: 'chat',
              startMs: 2700,
              endMs: 4200,
              attributes: [
                str('gen_ai.operation.name', 'chat'),
                str('gen_ai.request.model', 'gpt-5'),
              ],
              status: { code: 1 },
            }),
          ],
        },
      ],
    }),
  ]),
)

// 6. Two traces, two resources, two scopes, a repeated spanId across traces.
write(
  'multi-trace.json',
  payload([
    resource({
      service: 'agent-a',
      scopes: [
        {
          name: 'agent-sdk',
          spans: [
            span({
              traceId: T1,
              spanId: 'eeeeeeeeeeeeeee1',
              name: 'agent A',
              startMs: 0,
              endMs: 2000,
              attributes: [str('gen_ai.operation.name', 'invoke_agent')],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'eeeeeeeeeeeeeee2',
              parentSpanId: 'eeeeeeeeeeeeeee1',
              name: 'bash',
              startMs: 100,
              endMs: 900,
              attributes: [str('tool.name', 'bash')],
              status: { code: 1 },
            }),
          ],
        },
      ],
    }),
    resource({
      service: 'agent-b',
      scopes: [
        {
          name: 'agent-sdk',
          spans: [
            span({
              traceId: T2,
              spanId: 'eeeeeeeeeeeeeee1',
              name: 'agent B',
              startMs: 3000,
              endMs: 5000,
              attributes: [str('gen_ai.operation.name', 'invoke_agent')],
              status: { code: 0 },
            }),
          ],
        },
        {
          name: 'custom.instrumentation',
          spans: [
            span({
              traceId: T2,
              spanId: 'eeeeeeeeeeeeeee3',
              parentSpanId: 'eeeeeeeeeeeeeee1',
              name: 'custom step',
              startMs: 3200,
              endMs: 3600,
              attributes: [str('custom.kind', 'evaluation')],
              status: { code: 0 },
            }),
          ],
        },
      ],
    }),
  ]),
)

// 7. Nanosecond precision: 1ns apart, an int64 beyond 2^53, a zero-duration span.
write(
  'timing-precision.json',
  payload([
    resource({
      scopes: [
        {
          name: 'precision',
          spans: [
            span({
              traceId: T1,
              spanId: 'fffffffffffffff1',
              name: 'instant',
              startMs: 0,
              endMs: 0,
              startNs: String(BASE),
              endNs: String(BASE),
              attributes: [str('tool.name', 'bash')],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: 'fffffffffffffff2',
              name: 'one nanosecond later',
              startMs: 0,
              endMs: 0,
              startNs: String(BASE + 1n),
              endNs: String(BASE + 1n + 1000n * NS_PER_MS),
              attributes: [
                int('big.counter', '9007199254740993'),
                str('tool.name', 'bash'),
              ],
              status: { code: 1 },
            }),
          ],
        },
      ],
    }),
  ]),
)

// 8. Async child: parent ends before its child, plus an orphan parent.
write(
  'async-child.json',
  payload([
    resource({
      scopes: [
        {
          name: 'async',
          spans: [
            span({
              traceId: T1,
              spanId: '9999999999999991',
              name: 'enqueue',
              startMs: 0,
              endMs: 100,
              attributes: [str('tool.name', 'bash')],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: '9999999999999992',
              parentSpanId: '9999999999999991',
              name: 'background job',
              startMs: 50,
              endMs: 900,
              attributes: [str('tool.name', 'bash')],
              status: { code: 1 },
            }),
            span({
              traceId: T1,
              spanId: '9999999999999993',
              parentSpanId: '99999999999999ff',
              name: 'orphan child',
              startMs: 200,
              endMs: 400,
              attributes: [str('tool.name', 'grep')],
              status: { code: 1 },
            }),
          ],
        },
      ],
    }),
  ]),
)

// 9. Attributes the flat model cannot hold, plus a resource/span key collision.
write(
  'attributes-nested.json',
  payload([
    resource({
      service: 'resource-name',
      attributes: [str('deployment.environment', 'staging')],
      scopes: [
        {
          name: 'attributes',
          spans: [
            span({
              traceId: T1,
              spanId: '8888888888888881',
              name: 'chat',
              startMs: 0,
              endMs: 800,
              attributes: [
                str('gen_ai.operation.name', 'chat'),
                str('service.name', 'span-name'),
                bool('feature.enabled', false),
                int('retry.count', 0),
                arr('empty.list', []),
                arr('tags', [{ stringValue: 'a' }, { stringValue: 'b' }]),
                arr('mixed', [{ stringValue: 'a' }, { intValue: '1' }]),
                kv('request.meta', [
                  { key: 'nested', value: { kvlistValue: { values: [{ key: 'deep', value: { boolValue: true } }] } } },
                ]),
                { key: 'payload.bytes', value: { bytesValue: 'aGVsbG8=' } },
              ],
              status: { code: 0 },
            }),
          ],
        },
      ],
    }),
  ]),
)

// 10. Status semantics: unset is not success; error is not a task verdict.
write(
  'status-unset.json',
  payload([
    resource({
      scopes: [
        {
          name: 'status',
          spans: [
            span({
              traceId: T1,
              spanId: '7777777777777771',
              name: 'unset root',
              startMs: 0,
              endMs: 1500,
              attributes: [str('gen_ai.operation.name', 'invoke_agent')],
            }),
            span({
              traceId: T1,
              spanId: '7777777777777772',
              parentSpanId: '7777777777777771',
              name: 'bash',
              startMs: 100,
              endMs: 600,
              attributes: [str('tool.name', 'bash')],
              status: { code: 2, message: 'exit 1' },
            }),
            span({
              traceId: T1,
              spanId: '7777777777777773',
              parentSpanId: '7777777777777771',
              name: 'bash',
              startMs: 700,
              endMs: 1400,
              attributes: [str('tool.name', 'bash')],
              status: { code: 1 },
            }),
          ],
        },
      ],
    }),
  ]),
)

// 11. snake_case field names (older exporters / hand-written payloads).
write(
  'snake-case.json',
  payload([
    {
      resource: { attributes: [str('service.name', 'snake')] },
      scope_spans: [
        {
          scope: { name: 'snake' },
          spans: [
            {
              trace_id: T1,
              span_id: '6666666666666661',
              name: 'root',
              kind: 1,
              start_time_unix_nano: String(BASE),
              end_time_unix_nano: String(BASE + 2000n * NS_PER_MS),
              attributes: [str('gen_ai.operation.name', 'invoke_agent')],
              status: { code: 1 },
            },
            {
              trace_id: T1,
              span_id: '6666666666666662',
              parent_span_id: '6666666666666661',
              name: 'bash',
              kind: 1,
              start_time_unix_nano: String(BASE + 100n * NS_PER_MS),
              end_time_unix_nano: String(BASE + 900n * NS_PER_MS),
              attributes: [str('tool.name', 'bash')],
              status: { code: 1 },
            },
          ],
        },
      ],
    },
  ]),
)

console.log(`wrote fixtures to ${outDir}`)
