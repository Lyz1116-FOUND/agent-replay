import { describe, expect, it } from 'vitest'
import { mergeEvents } from './eventMerger'
import type { AgentEvent } from '../adapters/types'
import type { EditEvent, SessionMeta } from './types'

const meta: SessionMeta = {
  version: 1,
  id: 'rec_merge',
  name: 'merge-capture',
  cwd: '/private/tmp/ar-mx/demo',
  repoRoot: '/private/tmp/ar-mx/demo',
  repo: 'demo',
  baseCommit: 'abc1234',
  initialStatus: '',
  startedAt: '2026-10-20T10:00:00.000Z',
  startedAtMs: 1_000_000,
  agent: 'OpenCode',
  outputDir: 'replays',
  tracePath: '/private/tmp/ar-mx/demo/replays/merge.trace.json',
}

const edit: EditEvent = {
  kind: 'edit',
  atMs: 1_200,
  batch: 'b1',
  path: 'calc.mjs',
  operation: 'modify',
  before: 'return value\n',
  after: 'return value + 1\n',
  hashBefore: 'a',
  hashAfter: 'b',
  truncated: false,
}

function completed(file: string): AgentEvent {
  return {
    kind: 'tool.completed',
    atMs: 1_150,
    startedAtMs: 1_100,
    callId: 'call_1',
    tool: 'edit',
    name: 'Edit calc.mjs',
    file,
    status: 'ok',
    output: 'Edited calc.mjs',
  }
}

describe('event merger path normalization', () => {
  it('matches a native edit reported relative to the parent of the repo', () => {
    const merged = mergeEvents({
      agentEvents: [completed('demo/calc.mjs')],
      editEvents: [edit],
      commandEvents: [],
      meta,
      adapterId: 'opencode',
      sessionEndMs: 2_000,
    })
    expect(merged.capture.workspaceVerified).toBe(1)
    expect(merged.capture.unverifiedEdits).toBe(0)
  })

  it('still rejects a native edit that names an unrelated file', () => {
    const merged = mergeEvents({
      agentEvents: [completed('other/calc.mjs')],
      editEvents: [edit],
      commandEvents: [],
      meta,
      adapterId: 'opencode',
      sessionEndMs: 2_000,
    })
    expect(merged.capture.workspaceVerified).toBe(0)
    expect(merged.capture.unverifiedEdits).toBe(1)
  })

  it('counts repeated edits to one file as confirmed, not unverified', () => {
    const first = { ...completed('calc.mjs'), callId: 'call_1', atMs: 1_100, startedAtMs: 1_100 }
    const second = { ...completed('calc.mjs'), callId: 'call_2', atMs: 1_180, startedAtMs: 1_180 }
    const merged = mergeEvents({
      agentEvents: [first, second],
      editEvents: [edit],
      commandEvents: [],
      meta,
      adapterId: 'opencode',
      sessionEndMs: 2_000,
    })
    expect(merged.capture.integrity).toMatchObject({
      nativeEdits: 2,
      matchedEdits: 1,
      confirmedEdits: 2,
      supersededEdits: 1,
      unverifiedEdits: 0,
    })
  })

  it('marks an edit outside the workspace as outside, not verified', () => {
    const merged = mergeEvents({
      agentEvents: [completed('/somewhere/else/calc.mjs')],
      editEvents: [edit],
      commandEvents: [],
      meta,
      adapterId: 'opencode',
      sessionEndMs: 2_000,
    })
    expect(merged.capture.integrity).toMatchObject({
      nativeEdits: 1,
      matchedEdits: 0,
      confirmedEdits: 0,
      unverifiedEdits: 1,
      outsideWorkspaceEdits: 1,
    })
  })

  it('never reports more matched edits than the agent claimed', () => {
    // Two workspace facts, one native edit call: the call matched twice, which
    // must not push edit recall above 100%.
    const second: EditEvent = { ...edit, atMs: 1_260, batch: 'b2', before: 'x', after: 'y', hashBefore: 'c', hashAfter: 'd' }
    const merged = mergeEvents({
      agentEvents: [completed('calc.mjs')],
      editEvents: [edit, second],
      commandEvents: [],
      meta,
      adapterId: 'opencode',
      sessionEndMs: 2_000,
    })
    const integrity = merged.capture.integrity!
    expect(integrity.workspaceEdits).toBe(2)
    expect(integrity.nativeEdits).toBe(1)
    expect(integrity.matchedEdits).toBe(1)
    expect(integrity.confirmedEdits).toBeLessThanOrEqual(integrity.nativeEdits)
  })

  it('does not count a failed edit call as a claim', () => {
    const failed = {
      ...completed('calc.mjs'),
      status: 'error',
      output: 'oldString not found in calc.mjs',
    } as AgentEvent
    const merged = mergeEvents({
      agentEvents: [failed],
      editEvents: [],
      commandEvents: [],
      meta,
      adapterId: 'opencode',
      sessionEndMs: 2_000,
    })
    expect(merged.capture.integrity).toMatchObject({
      nativeEdits: 0,
      matchedEdits: 0,
      unverifiedEdits: 0,
      failedEdits: 1,
    })
  })
})
