import { describe, expect, it, vi } from 'vitest'
import { createOutputScanner, isTestCommand, parseTestOutput } from './testParser'

describe('test output parsing', () => {
  it('parses pytest failures', () => {
    const outcome = parseTestOutput(
      'FAILED tests/test_lru.py::test_capacity_one - AssertionError\n3 failed, 11 passed in 0.42s',
    )
    expect(outcome).toEqual({
      passed: 11,
      failed: 3,
      total: 14,
      failedTests: ['tests/test_lru.py::test_capacity_one'],
      framework: 'pytest',
    })
  })

  it('parses an all-pass pytest run', () => {
    expect(parseTestOutput('14 passed in 0.41s')).toMatchObject({ passed: 14, failed: 0, total: 14 })
  })

  it('parses jest totals', () => {
    expect(parseTestOutput('Tests:       2 failed, 10 passed, 12 total')).toMatchObject({
      passed: 10,
      failed: 2,
      total: 12,
      framework: 'jest',
    })
  })

  it('parses Node test reporter output', () => {
    const text = 'ℹ tests 3\nℹ pass 2\nℹ fail 1\n✖ bump 3 (0.4ms)'
    expect(parseTestOutput(text)).toMatchObject({
      passed: 2,
      failed: 1,
      total: 3,
      failedTests: ['bump 3'],
      framework: 'node:test',
    })
  })

  it('parses cargo test output', () => {
    expect(parseTestOutput('test result: FAILED. 12 passed; 2 failed; 0 ignored')).toMatchObject({
      passed: 12,
      failed: 2,
      framework: 'cargo test',
    })
  })

  it('ignores unrelated output', () => {
    expect(parseTestOutput('dev server listening on 5173')).toBeNull()
  })

  it('classifies test commands', () => {
    expect(isTestCommand('pytest -q')).toBe(true)
    expect(isTestCommand('npm test')).toBe(true)
    expect(isTestCommand('node --test test/a.test.mjs')).toBe(true)
    expect(isTestCommand('git status')).toBe(false)
  })
})

describe('streaming test detection', () => {
  it('waits for both TAP pass and fail lines before emitting one result', () => {
    vi.useFakeTimers()
    try {
      const summaries: unknown[] = []
      const scanner = createOutputScanner((outcome) => summaries.push(outcome))
      scanner.push('ℹ tests 3\nℹ pass 2\n')
      vi.advanceTimersByTime(100)
      expect(summaries).toHaveLength(0)
      scanner.push('ℹ fail 1\n')
      vi.advanceTimersByTime(400)
      expect(summaries).toHaveLength(1)
      expect(summaries[0]).toMatchObject({ passed: 2, failed: 1, total: 3 })
      scanner.flush()
      expect(summaries).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits separate results for separate runs', () => {
    vi.useFakeTimers()
    try {
      const summaries: Array<{ passed: number; failed: number }> = []
      const scanner = createOutputScanner((outcome) =>
        summaries.push({ passed: outcome.passed, failed: outcome.failed }),
      )
      scanner.push('1 failed, 2 passed in 0.1s\n')
      vi.advanceTimersByTime(400)
      scanner.push('3 passed in 0.1s\n')
      vi.advanceTimersByTime(400)
      expect(summaries).toEqual([
        { passed: 2, failed: 1 },
        { passed: 3, failed: 0 },
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})
