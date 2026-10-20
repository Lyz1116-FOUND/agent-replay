import { describe, expect, it } from 'vitest'
import { classifyFailure, isUnavailable } from './termination'

describe('termination classification', () => {
  it('treats a region block as provider unavailability, not a task failure', () => {
    expect(
      classifyFailure({
        message: 'This model is not available in your country',
        status: 403,
        type: 'provider.auth',
      }),
    ).toMatchObject({ kind: 'provider_unavailable', code: 403 })
  })

  it('classifies rate limits and auth failures separately', () => {
    expect(classifyFailure({ message: 'Too many requests', status: 429 }).kind).toBe('rate_limited')
    expect(classifyFailure({ message: 'invalid api key', status: 401 }).kind).toBe('permission_denied')
  })

  it('classifies unroutable models and timeouts', () => {
    expect(classifyFailure({ type: 'provider.no-route', message: 'Model unavailable: x' }).kind).toBe(
      'provider_unavailable',
    )
    expect(classifyFailure({ message: 'request timed out after 120s' }).kind).toBe('timeout')
  })

  it('falls back to agent_error for anything unrecognised', () => {
    expect(classifyFailure({ message: 'OpenCode stream error' })).toMatchObject({
      kind: 'agent_error',
      message: 'OpenCode stream error',
    })
  })

  it('knows which kinds must be excluded from a capability denominator', () => {
    expect(isUnavailable('provider_unavailable')).toBe(true)
    expect(isUnavailable('rate_limited')).toBe(true)
    expect(isUnavailable('recorder_error')).toBe(true)
    expect(isUnavailable('task_failure')).toBe(false)
    expect(isUnavailable('completed')).toBe(false)
  })
})
