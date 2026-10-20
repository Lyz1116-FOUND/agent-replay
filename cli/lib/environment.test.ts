import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { RECORDER_VERSION, sanitizePath } from './environment'
import pkg from '../../package.json'

describe('environment fingerprint', () => {
  it('keeps the recorder version in sync with package.json', () => {
    expect(RECORDER_VERSION).toBe(pkg.version)
  })

  it('never writes a real home directory into a trace', () => {
    const path = `${homedir()}/work/project`
    expect(sanitizePath(path)).toBe('~/work/project')
    expect(sanitizePath('/private/tmp/probe')).toBe('/private/tmp/probe')
    expect(sanitizePath(undefined)).toBeUndefined()
  })
})
