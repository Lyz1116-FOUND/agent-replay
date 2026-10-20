import { afterEach, describe, expect, it } from 'vitest'
import { en, messages, zh } from './messages'
import {
  getLocale,
  phaseLabel,
  setLocale,
  spanLabel,
  spanStatusLabel,
  t,
  tn,
} from './index'

afterEach(() => {
  setLocale('en')
})

describe('message catalog', () => {
  it('has the same keys in both locales', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('has no empty translations', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('only uses placeholders that exist in both locales', () => {
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]))
    }
  })
})

describe('translation runtime', () => {
  it('defaults to English without a browser locale', () => {
    expect(getLocale()).toBe('en')
    expect(t('nav.runs')).toBe('Runs')
  })

  it('interpolates parameters', () => {
    expect(t('runs.footer.showing', { shown: 3, total: 9 })).toBe(
      'Showing 3 of 9 runs · traces stay in your browser',
    )
  })

  it('picks plural keys', () => {
    expect(tn('runs.steps', 1)).toBe('1 step')
    expect(tn('runs.steps', 4)).toBe('4 steps')
  })

  it('switches to Chinese and keeps technical labels stable', () => {
    setLocale('zh')
    expect(getLocale()).toBe('zh')
    expect(t('nav.runs')).toBe('运行记录')
    expect(t('runs.footer.showing', { shown: 3, total: 9 })).toBe(
      '显示 3/9 条运行 · trace 只留在你的浏览器里',
    )
    expect(tn('runs.steps', 2)).toBe('2 步')
    expect(spanLabel('generation')).toBe('大模型')
    expect(spanStatusLabel('unset')).toBe('未声明')
    expect(phaseLabel('Explore')).toBe('探索')
    expect(phaseLabel('Custom')).toBe('Custom')
    expect(messages.zh['capture.otel']).toBe('OTEL TRACE')
  })
})
