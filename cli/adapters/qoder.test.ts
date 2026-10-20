import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from './types'
import type { EditEvent, SessionMeta } from '../lib/types'
import { createQoderAdapter } from './qoder'
import { mergeEvents } from '../lib/eventMerger'

const meta: SessionMeta = {
  version: 1,
  id: 'rec_qoder',
  name: 'qoder-capture',
  cwd: '/repo',
  repoRoot: '/repo',
  repo: 'demo',
  baseCommit: 'abc1234',
  initialStatus: '',
  startedAt: '2026-10-20T10:00:00.000Z',
  startedAtMs: 1_000_000,
  agent: 'Qoder CLI',
  model: 'DeepSeek-Flash',
  outputDir: 'replays',
  tracePath: '/repo/replays/qoder-capture.trace.json',
}

const adapter = createQoderAdapter()
const events: AgentEvent[] = readFileSync(
  new URL('./fixtures/claude-stream.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((line) => line.trim())
  .flatMap((line, index) => adapter.parseLine(line, 100 + index * 100))

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

const edit2: EditEvent = {
  ...edit,
  atMs: 850,
  batch: 'b2',
  before: 'export function evict() { return 2 }\n',
  after: 'export function evict() { return 3 }\n',
  hashBefore: 'b',
  hashAfter: 'c',
}

describe('Qoder CLI adapter', () => {
  it('detects headless stream-json and builds the free DeepSeek command', () => {
    expect(adapter.detect('qodercli', ['-p', '--output-format', 'stream-json', 'fix'])).toBe(true)
    expect(adapter.buildCommand('fix it')).toEqual({
      command: 'qodercli',
      args: ['-p', '--output-format', 'stream-json', '--model', 'DeepSeek-Flash', 'fix it'],
    })
  })

  it('removes the Qoder Desktop SDK entrypoint from the child environment', () => {
    expect(adapter.env?.QODER_AGENT_SDK_ENTRYPOINT).toBeUndefined()
  })

  it('parses the Claude-compatible Qoder message stream', () => {
    const tools = events.filter(
      (event): event is Extract<AgentEvent, { kind: 'tool.completed' }> =>
        event.kind === 'tool.completed',
    )
    expect(tools.map((event) => event.tool)).toEqual(['read', 'edit', 'test', 'edit', 'test'])
    expect(tools[2].test).toMatchObject({ passed: 2, failed: 1 })
    expect(tools[4].test).toMatchObject({ passed: 3, failed: 0 })
    const session = events.find((event) => event.kind === 'session')
    expect(session).toMatchObject({ agent: 'qoder' })
  })

  it('merges Qoder tools with workspace verification', () => {
    const merged = mergeEvents({
      agentEvents: events,
      editEvents: [edit, edit2],
      commandEvents: [],
      meta,
      adapterId: 'qoder',
      sessionEndMs: 1500,
    })
    expect(merged.capture).toMatchObject({
      fidelity: 'native+workspace',
      timing: 'observed',
      workspaceVerified: 2,
      unverifiedEdits: 0,
    })
    const editSpan = merged.spans.find((item) => item.span.type === 'edit')?.span
    expect(editSpan?.attributes?.workspaceVerified).toBe(true)
  })
})
