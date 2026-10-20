import { describe, expect, it } from 'vitest'
import type { AgentEvent } from './types'
import type { EditEvent, SessionMeta } from '../lib/types'
import { createZCodeAdapter } from './zcode'
import { mergeEvents } from '../lib/eventMerger'

const meta: SessionMeta = {
  version: 1,
  id: 'rec_zcode',
  name: 'zcode-capture',
  cwd: '/repo',
  repoRoot: '/repo',
  repo: 'demo',
  baseCommit: 'abc1234',
  initialStatus: '',
  startedAt: '2026-10-20T10:00:00.000Z',
  startedAtMs: 1_000_000,
  agent: 'ZCode CLI',
  model: 'bigmodel-standard-api/GLM-5.3-Flash',
  outputDir: 'replays',
  tracePath: '/repo/replays/zcode-capture.trace.json',
}

const T0 = 1_792_472_456_000

function row(part: Record<string, unknown>, role: string, created: number, model = true) {
  return {
    part: JSON.stringify(part),
    message: JSON.stringify({
      role,
      ...(model
        ? { modelId: 'GLM-5.3-Flash', modelSelection: { providerId: 'bigmodel-standard-api', modelId: 'GLM-5.3-Flash' } }
        : {}),
    }),
    created,
  }
}

const rows = [
  row({ type: 'text', text: 'fix calc.mjs' }, 'user', T0),
  row({ type: 'reasoning', text: 'internal chain of thought' }, 'assistant', T0 + 100, false),
  row({ type: 'step-start' }, 'assistant', T0 + 120, false),
  row(
    {
      type: 'tool',
      callID: 'call_shell',
      tool: 'Bash',
      state: {
        status: 'completed',
        input: { command: 'pwd', description: 'Print working directory' },
        output: '/repo',
        time: { start: T0 + 200, end: T0 + 260 },
      },
    },
    'assistant',
    T0 + 260,
    false,
  ),
  row(
    {
      type: 'tool',
      callID: 'call_edit',
      tool: 'Edit',
      state: {
        status: 'completed',
        input: { path: '/repo/calc.mjs', oldString: 'return value', newString: 'return value + 1' },
        output: 'Edited calc.mjs',
        time: { start: T0 + 300, end: T0 + 340 },
      },
    },
    'assistant',
    T0 + 340,
    false,
  ),
  row({ type: 'step-finish', reason: 'tool-calls', tokens: { input: 100, output: 20 } }, 'assistant', T0 + 350, false),
  row({ type: 'text', text: 'Done.' }, 'assistant', T0 + 400, false),
  row({ type: 'step-finish', reason: 'stop', tokens: { input: 120, output: 30 } }, 'assistant', T0 + 420, false),
]

function eventsFrom(parts: ReturnType<typeof row>[]): AgentEvent[] {
  const adapter = createZCodeAdapter(() => parts, () => 0)
  const summary = JSON.stringify({ sessionId: 'sess_test', response: 'Done.' }, null, 2)
  for (const line of summary.split('\n')) adapter.parseLine(line, 0)
  return adapter.finalize?.() ?? []
}

describe('ZCode CLI adapter', () => {
  it('detects headless json prompts and builds the command', () => {
    const adapter = createZCodeAdapter(() => [], () => 0)
    expect(adapter.detect('zcode', ['--json', '-p', 'fix it'])).toBe(true)
    expect(adapter.detect('zcode', ['-p', 'fix it'])).toBe(false)
    expect(adapter.buildCommand('fix it')).toEqual({
      command: 'zcode',
      args: ['--json', '--no-color', '-p', 'fix it'],
    })
  })

  it('buffers the pretty-printed summary instead of parsing it line by line', () => {
    const adapter = createZCodeAdapter(() => rows, () => 0)
    expect(adapter.parseLine('{', 0)).toEqual([])
    expect(adapter.parseLine('  "sessionId": "sess_test"', 0)).toEqual([])
  })

  it('replays persisted parts as native events with real timestamps', () => {
    const events = eventsFrom(rows)
    expect(events[0]).toMatchObject({
      kind: 'session',
      agent: 'zcode',
      sessionId: 'sess_test',
      model: 'bigmodel-standard-api/GLM-5.3-Flash',
      atMs: T0,
    })
    const tools = events.filter(
      (event): event is Extract<AgentEvent, { kind: 'tool.completed' }> => event.kind === 'tool.completed',
    )
    expect(tools.map((event) => event.tool)).toEqual(['shell', 'edit'])
    expect(tools[1].file).toBe('/repo/calc.mjs')
    expect(tools[1].atMs).toBe(T0 + 340)
    expect(tools[1].startedAtMs).toBe(T0 + 300)
    const text = events.filter((event) => event.kind === 'message')
    expect(text).toHaveLength(1)
    expect(text[0]).toMatchObject({ text: 'Done.', reasoning: false })
    expect(events.some((event) => event.kind === 'final')).toBe(true)
  })

  it('drops prompt and reasoning parts', () => {
    const events = eventsFrom(rows)
    const texts = events.filter((event) => event.kind === 'message').map((event) => event.text)
    expect(texts).not.toContain('fix calc.mjs')
    expect(texts).not.toContain('internal chain of thought')
  })

  it('returns nothing when the session store is unavailable', () => {
    expect(eventsFrom([])).toEqual([])
  })

  it('converts persisted epoch times into elapsed times from the session start', () => {
    const adapter = createZCodeAdapter(() => rows, () => 1_000_000)
    for (const line of JSON.stringify({ sessionId: 'sess_test', response: 'Done.' }, null, 2).split('\n')) {
      adapter.parseLine(line, 1_000)
    }
    const events = adapter.finalize?.() ?? []
    const session = events[0]
    expect(session.atMs).toBe(T0 - 999_000)
    const last = events[events.length - 1]
    expect(last.atMs).toBe(T0 + 420 - 999_000)
  })

  it('merges ZCode tools with workspace verification', () => {
    const edit: EditEvent = {
      kind: 'edit',
      atMs: T0 + 330,
      batch: 'b1',
      path: 'calc.mjs',
      operation: 'modify',
      before: 'export function bump(value) {\n  return value\n}\n',
      after: 'export function bump(value) {\n  return value + 1\n}\n',
      hashBefore: 'a',
      hashAfter: 'b',
      truncated: false,
    }
    const merged = mergeEvents({
      agentEvents: eventsFrom(rows),
      editEvents: [edit],
      commandEvents: [],
      meta,
      adapterId: 'zcode',
      sessionEndMs: T0 + 500,
    })
    expect(merged.capture).toMatchObject({
      fidelity: 'native+workspace',
      timing: 'observed',
      adapter: 'zcode',
      workspaceVerified: 1,
      unverifiedEdits: 0,
    })
  })
})
