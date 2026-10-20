import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentStreamAdapter } from './types'
import type { SessionMeta, EditEvent } from '../lib/types'
import { createClaudeAdapter, createCodexAdapter, createCursorAdapter } from './index'
import { mergeEvents } from '../lib/eventMerger'
import { buildTrace } from '../lib/traceBuilder'
import { traceSchema } from '../../src/schema/trace'

const meta: SessionMeta = {
  version: 1,
  id: 'rec_native',
  name: 'native-capture',
  cwd: '/repo',
  repoRoot: '/repo',
  repo: 'demo',
  baseCommit: 'abc1234',
  initialStatus: '',
  startedAt: '2026-10-20T10:00:00.000Z',
  startedAtMs: 1_000_000,
  agent: 'Cursor',
  outputDir: 'replays',
  tracePath: '/repo/replays/native-capture.trace.json',
}

function fixture(name: string): string[] {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
}

function parseFixture(adapter: AgentStreamAdapter, name: string): AgentEvent[] {
  return fixture(name).flatMap((line, index) => adapter.parseLine(line, 100 + index * 100))
}

function editFact(
  atMs: number,
  before: string,
  after: string,
  batch: string,
): EditEvent {
  return {
    kind: 'edit',
    atMs,
    batch,
    path: 'src/cache.ts',
    operation: 'modify',
    before,
    after,
    hashBefore: `${batch}-before`,
    hashAfter: `${batch}-after`,
    truncated: false,
  }
}

describe('Cursor stream adapter', () => {
  const adapter = createCursorAdapter()
  const events = parseFixture(adapter, 'cursor-stream.jsonl')
  const tools = events.filter(
    (event): event is Extract<AgentEvent, { kind: 'tool.completed' }> =>
      event.kind === 'tool.completed',
  )

  it('detects the cursor-agent stream command', () => {
    expect(
      adapter.detect('cursor-agent', ['-p', '--output-format', 'stream-json', 'fix']),
    ).toBe(true)
    expect(adapter.detect('codex', ['exec', '--json', 'fix'])).toBe(false)
  })

  it('builds the documented cursor-agent command', () => {
    expect(adapter.buildCommand('fix it')).toEqual({
      command: 'cursor-agent',
      args: ['-p', '--output-format', 'stream-json', 'fix it'],
    })
  })

  it('maps tool variants and pairs call ids', () => {
    expect(tools.map((event) => event.tool)).toEqual(['read', 'edit', 'test', 'edit', 'test'])
    expect(tools[0].file).toBe('src/cache.ts')
    expect(tools[0].output).toContain('export function evict')
    expect(tools[0].startedAtMs).toBe(400)
    expect(tools[0].atMs).toBe(500)
  })

  it('parses test outcomes and the final result', () => {
    expect(tools[2].test).toMatchObject({ passed: 2, failed: 1, total: 3 })
    expect(tools[4].test).toMatchObject({ passed: 3, failed: 0 })
    const final = events.find((event) => event.kind === 'final')
    expect(final).toMatchObject({ status: 'success', text: 'Fixed the cache bug.' })
    const session = events.find((event) => event.kind === 'session')
    expect(session).toMatchObject({ model: 'Claude 4 Sonnet', sessionId: 'cursor-session-1' })
  })
})

describe('Codex exec adapter', () => {
  const adapter = createCodexAdapter()
  const events = parseFixture(adapter, 'codex-exec.jsonl')
  const tools = events.filter(
    (event): event is Extract<AgentEvent, { kind: 'tool.completed' }> =>
      event.kind === 'tool.completed',
  )

  it('detects codex exec --json', () => {
    expect(adapter.detect('codex', ['exec', '--json', 'fix'])).toBe(true)
    expect(adapter.detect('codex', ['chat'])).toBe(false)
  })

  it('builds codex exec --json', () => {
    expect(adapter.buildCommand('fix it')).toEqual({
      command: 'codex',
      args: ['exec', '--json', 'fix it'],
    })
  })

  it('maps command executions and file changes', () => {
    expect(tools.map((event) => event.tool)).toEqual(['test', 'edit', 'test'])
    expect(tools[0].command).toContain('npm test')
    expect(tools[0].test).toMatchObject({ passed: 2, failed: 1 })
    expect(tools[1].files).toEqual(['src/cache.ts'])
    expect(tools[1].operation).toBe('modify')
    expect(tools[2].test).toMatchObject({ passed: 3, failed: 0 })
  })

  it('ends with a native final event', () => {
    const final = events.find((event) => event.kind === 'final')
    expect(final).toMatchObject({ status: 'success', text: 'Fixed the cache bug.' })
  })

  it('classifies provider failures instead of a generic stream error', () => {
    const forbidden = adapter.parseLine(
      JSON.stringify({
        type: 'error',
        message: 'unexpected status 403 Forbidden: This model is not available in your country',
      }),
      10,
    )
    expect(forbidden.find((event) => event.kind === 'error')).toMatchObject({
      termination: 'provider_unavailable',
      code: 403,
    })

    const limited = adapter.parseLine(
      JSON.stringify({ type: 'error', message: 'rate limit exceeded, retry after 429' }),
      20,
    )
    expect(limited.find((event) => event.kind === 'error')).toMatchObject({
      termination: 'rate_limited',
      code: 429,
    })
  })

  it('classifies a failed turn, not just a stream error', () => {
    const failedTurn = adapter.parseLine(
      JSON.stringify({
        type: 'turn.failed',
        error: { message: '429 Too Many Requests: rate limit exceeded' },
      }),
      30,
    )
    expect(failedTurn.find((event) => event.kind === 'error')).toMatchObject({
      termination: 'rate_limited',
      code: 429,
    })
    expect(failedTurn.find((event) => event.kind === 'final')).toMatchObject({ status: 'error' })
  })
})

describe('Claude stream adapter', () => {
  const adapter = createClaudeAdapter()
  const events = parseFixture(adapter, 'claude-stream.jsonl')
  const tools = events.filter(
    (event): event is Extract<AgentEvent, { kind: 'tool.completed' }> =>
      event.kind === 'tool.completed',
  )

  it('detects claude stream-json', () => {
    expect(adapter.detect('claude', ['-p', '--output-format', 'stream-json', '--verbose', 'fix'])).toBe(
      true,
    )
    expect(adapter.detect('claude', ['-p', 'fix'])).toBe(false)
  })

  it('builds claude stream-json', () => {
    expect(adapter.buildCommand('fix it')).toEqual({
      command: 'claude',
      args: ['-p', '--output-format', 'stream-json', '--verbose', 'fix it'],
    })
  })

  it('pairs tool_use and tool_result messages', () => {
    expect(tools.map((event) => event.tool)).toEqual(['read', 'edit', 'test', 'edit', 'test'])
    expect(tools[0].file).toBe('src/cache.ts')
    expect(tools[0].output).toContain('export function evict')
    expect(tools[2].test).toMatchObject({ passed: 2, failed: 1 })
    expect(tools[4].test).toMatchObject({ passed: 3, failed: 0 })
  })

  it('captures the Claude model', () => {
    const session = events.find((event) => event.kind === 'session')
    expect(session).toMatchObject({ agent: 'claude', model: 'claude-sonnet-4-5' })
  })
})

describe('native event merge', () => {
  it('verifies native edit tools with workspace diffs and keeps real tool timings', () => {
    const adapter = createCursorAdapter()
    const events = parseFixture(adapter, 'cursor-stream.jsonl')
    const editEvents = [
      editFact(700, 'old cache\n', 'first fix\n', 'b1'),
      editFact(1100, 'first fix\n', 'second fix\n', 'b2'),
    ]
    const merged = mergeEvents({
      agentEvents: events,
      editEvents,
      commandEvents: [],
      meta,
      adapterId: 'cursor',
      sessionEndMs: 2000,
    })

    expect(merged.capture.fidelity).toBe('native+workspace')
    expect(merged.capture.timing).toBe('observed')
    expect(merged.capture.workspaceVerified).toBe(2)
    expect(merged.capture.unverifiedEdits).toBe(0)
    const editSpans = merged.spans.filter((item) => item.span.type === 'edit')
    expect(editSpans).toHaveLength(2)
    expect(editSpans.every((item) => item.span.attributes?.workspaceVerified === true)).toBe(true)
    expect(editSpans.every((item) => item.span.artifacts?.some((artifact) => artifact.kind === 'diff'))).toBe(
      true,
    )
    expect(editSpans[0].span.startMs).toBe(600)
    expect(editSpans[0].span.endMs).toBe(700)
    expect(editSpans[1].span.startMs).toBe(1000)
    expect(editSpans[1].span.endMs).toBe(1100)
    expect(merged.spans.filter((item) => item.span.type === 'test')).toHaveLength(2)
  })

  it('does not serialize overlapping native tool spans', () => {
    const events: AgentEvent[] = [
      {
        kind: 'tool.started',
        atMs: 1000,
        callId: 'test-1',
        tool: 'test',
        name: 'npm test',
        command: 'npm test',
      },
      {
        kind: 'tool.started',
        atMs: 1100,
        callId: 'edit-1',
        tool: 'edit',
        name: 'Edit cache.ts',
        file: '/repo/src/cache.ts',
      },
      {
        kind: 'tool.completed',
        atMs: 1200,
        callId: 'edit-1',
        tool: 'edit',
        name: 'Edit cache.ts',
        file: '/repo/src/cache.ts',
        status: 'ok',
      },
      {
        kind: 'tool.completed',
        atMs: 5000,
        callId: 'test-1',
        tool: 'test',
        name: 'npm test',
        command: 'npm test',
        status: 'error',
        output: '1 failed, 2 passed in 0.2s',
        test: { passed: 2, failed: 1, total: 3, failedTests: [], framework: 'jest' },
      },
    ]
    const merged = mergeEvents({
      agentEvents: events,
      editEvents: [editFact(1250, 'old\n', 'new\n', 'overlap')],
      commandEvents: [],
      meta,
      adapterId: 'cursor',
      sessionEndMs: 5200,
    })
    const testSpan = merged.spans.find((item) => item.span.type === 'test')?.span
    const editSpan = merged.spans.find((item) => item.span.type === 'edit')?.span
    expect(testSpan?.startMs).toBe(1000)
    expect(testSpan?.endMs).toBe(5000)
    expect(editSpan?.startMs).toBe(1100)
    expect(editSpan?.endMs).toBe(1200)
    expect(editSpan?.attributes?.workspaceVerified).toBe(true)
    expect(editSpan?.files).toEqual(['src/cache.ts'])
  })

  it('builds a native+workspace trace with recovery and observed timing', () => {
    const adapter = createCursorAdapter()
    const events = parseFixture(adapter, 'cursor-stream.jsonl')
    const editEvents = [
      editFact(700, 'old cache\n', 'first fix\n', 'b1'),
      editFact(1100, 'first fix\n', 'second fix\n', 'b2'),
    ]
    const trace = buildTrace({
      meta,
      events: editEvents,
      agentEvents: events,
      adapter: { id: 'cursor', name: 'Cursor' },
      baseline: { contents: {} },
      git: {
        available: true,
        head: 'abc1234',
        statusShort: ' M src/cache.ts',
        diffStat: ' 1 file changed, 1 insertion(+), 1 deletion(-)',
        patch: 'diff --git a/src/cache.ts b/src/cache.ts',
      },
      nowMs: 1_002_000,
    })

    expect(() => traceSchema.parse(trace)).not.toThrow()
    expect(trace.capture).toMatchObject({
      fidelity: 'native+workspace',
      timing: 'observed',
      adapter: 'cursor',
      workspaceVerified: 2,
      unverifiedEdits: 0,
    })
    expect(trace.status).toBe('pass')
    expect(trace.result.tests).toEqual({ passed: 3, failed: 0, total: 3 })
    expect(trace.agent.model).toBe('Claude 4 Sonnet')
    expect(trace.metadata?.adapter).toBe('cursor')
  })
})
