import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from './types'
import type { EditEvent, SessionMeta } from '../lib/types'
import { createOpenCodeAdapter } from './opencode'
import { mergeEvents } from '../lib/eventMerger'
import { buildTrace } from '../lib/traceBuilder'
import { traceSchema } from '../../src/schema/trace'

const meta: SessionMeta = {
  version: 1,
  id: 'rec_opencode',
  name: 'opencode-capture',
  cwd: '/repo',
  repoRoot: '/repo',
  repo: 'demo',
  baseCommit: 'abc1234',
  initialStatus: '',
  startedAt: '2026-10-20T10:00:00.000Z',
  startedAtMs: 1_000_000,
  agent: 'OpenCode',
  model: 'opencode/test-model',
  outputDir: 'replays',
  tracePath: '/repo/replays/opencode-capture.trace.json',
}

const adapter = createOpenCodeAdapter()

const events: AgentEvent[] = readFileSync(
  new URL('./fixtures/opencode-stream.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((line) => line.trim())
  .flatMap((line, index) => adapter.parseLine(line, 100 + index * 100))

const tools = events.filter(
  (event): event is Extract<AgentEvent, { kind: 'tool.completed' }> =>
    event.kind === 'tool.completed',
)

const edit: EditEvent = {
  kind: 'edit',
  atMs: 550,
  batch: 'b1',
  path: 'src/cache.ts',
  operation: 'modify',
  before: 'export function evict() { return 1 }\n',
  after: 'export function evict() { return 2 }\n',
  hashBefore: 'a',
  hashAfter: 'b',
  truncated: false,
}

describe('OpenCode stream adapter', () => {
  it('detects and builds the opencode run command', () => {
    expect(adapter.detect('opencode', ['run', '--format', 'json', 'fix'])).toBe(true)
    expect(adapter.buildCommand('fix it')).toEqual({
      command: 'opencode',
      args: ['run', '--format', 'json', 'fix it'],
    })
  })

  it('maps completed tool_use states to tools', () => {
    expect(tools.map((event) => event.tool)).toEqual(['read', 'edit', 'test', 'test'])
    expect(tools[0].file).toBe('src/cache.ts')
    expect(tools[0].output).toContain('export function evict')
    expect(tools[1].files).toEqual(['src/cache.ts'])
    expect(tools[1].patch).toContain('-export function evict() { return 1 }')
    expect(tools[2].test).toMatchObject({ passed: 2, failed: 1 })
    expect(tools[3].test).toMatchObject({ passed: 2, failed: 0 })
  })

  it('uses state.time for real tool starts and emits a final message', () => {
    expect(tools[0].startedAtMs).toBe(164)
    expect(tools[0].atMs).toBe(200)
    const final = events.find((event) => event.kind === 'final')
    expect(final).toMatchObject({ status: 'success', text: 'Fixed and passing.' })
  })

  it('merges native tool events with workspace verification', () => {
    const merged = mergeEvents({
      agentEvents: events,
      editEvents: [edit],
      commandEvents: [],
      meta,
      adapterId: 'opencode',
      sessionEndMs: 1500,
    })
    expect(merged.capture).toMatchObject({
      fidelity: 'native+workspace',
      timing: 'observed',
      workspaceVerified: 1,
      unverifiedEdits: 0,
    })
    const editSpan = merged.spans.find((item) => item.span.type === 'edit')?.span
    expect(editSpan?.attributes?.workspaceVerified).toBe(true)
    expect(editSpan?.artifacts?.some((artifact) => artifact.kind === 'diff')).toBe(true)
  })

  it('builds a schema-valid opencode trace', () => {
    const trace = buildTrace({
      meta,
      events: [edit],
      agentEvents: events,
      adapter: { id: 'opencode', name: 'OpenCode' },
      baseline: { contents: {} },
      git: {
        available: true,
        head: 'abc1234',
        statusShort: ' M src/cache.ts',
        diffStat: ' 1 file changed, 1 insertion(+), 1 deletion(-)',
        patch: 'diff --git a/src/cache.ts b/src/cache.ts',
      },
      nowMs: 1_001_500,
    })
    expect(() => traceSchema.parse(trace)).not.toThrow()
    expect(trace.status).toBe('pass')
    expect(trace.capture?.fidelity).toBe('native+workspace')
    expect(trace.result.tests).toEqual({ passed: 2, failed: 0, total: 2 })
    expect(trace.agent.model).toBe('opencode/test-model')
  })

  it('surfaces the provider error message instead of a generic stream error', () => {
    const adapter = createOpenCodeAdapter()
    const events = adapter.parseLine(
      JSON.stringify({
        type: 'error',
        error: { type: 'provider.auth', message: 'This model is not available in your country', status: 403 },
      }),
      10,
    )
    const error = events.find((event) => event.kind === 'error')
    expect(error).toMatchObject({
      message: 'This model is not available in your country (HTTP 403)',
    })
  })
})
