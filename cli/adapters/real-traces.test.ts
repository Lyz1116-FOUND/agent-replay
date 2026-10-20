import { describe, expect, it } from 'vitest'
import realClaude from '../../examples/real-claude.trace.json'
import realOpenCode from '../../examples/real-opencode.trace.json'
import realQoder from '../../examples/real-qoder.trace.json'
import realGlm from '../../examples/real-glm-flash.trace.json'
import realZCode from '../../examples/real-zcode.trace.json'
import realCodex from '../../examples/real-codex.trace.json'
import { traceSchema } from '../../src/schema/trace'

describe('real CLI recordings', () => {
  it.each([
    ['opencode', realOpenCode, 'opencode'],
    ['claude', realClaude, 'claude'],
    ['qoder', realQoder, 'qoder'],
    ['glm-flash', realGlm, 'opencode'],
    ['zcode', realZCode, 'zcode'],
    ['codex', realCodex, 'codex'],
  ] as const)('%s produced a native+workspace trace', (_label, sample, adapter) => {
    const trace = traceSchema.parse(sample)
    expect(trace.capture).toMatchObject({
      fidelity: 'native+workspace',
      timing: 'observed',
      adapter,
      workspaceVerified: 1,
      unverifiedEdits: 0,
    })
    expect(trace.status).toBe('pass')
    expect(trace.result.tests).toEqual({ passed: 3, failed: 0, total: 3 })
    const edit = trace.spans.find((span) => span.type === 'edit')
    expect(edit?.attributes?.workspaceVerified).toBe(true)
    expect(edit?.artifacts?.some((artifact) => artifact.kind === 'diff')).toBe(true)
    expect(trace.result.filesChanged).toEqual(['calc.mjs'])
  })
})
