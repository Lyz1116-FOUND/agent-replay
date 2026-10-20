import { useSyncExternalStore } from 'react'
import { messages, type Locale, type MessageKey } from './messages'

const STORAGE_KEY = 'agent-replay:locale'
const listeners = new Set<() => void>()

function detect(): Locale {
  if (typeof window === 'undefined') return 'en'
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    // private mode: fall through to the browser language
  }
  const language = window.navigator.language?.toLowerCase() ?? ''
  return language.startsWith('zh') ? 'zh' : 'en'
}

function applyDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }
}

let current: Locale = detect()
applyDocumentLang(current)

export function getLocale(): Locale {
  return current
}

export function setLocale(locale: Locale): void {
  if (locale === current) return
  current = locale
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // storage is optional; the in-memory locale still works
  }
  applyDocumentLang(locale)
  for (const listener of listeners) listener()
}

export function toggleLocale(): void {
  setLocale(current === 'zh' ? 'en' : 'zh')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Re-renders the calling component whenever the locale changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale)
}

export function useT(): typeof t {
  useLocale()
  return t
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    params[key] === undefined ? match : String(params[key]),
  )
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = messages[current][key] ?? messages.en[key] ?? key
  return interpolate(template, params)
}

/** Plural-aware lookup: `tn('runs.steps', 2)` reads `runs.steps_other`. */
export function tn(
  base: string,
  count: number,
  params?: Record<string, string | number>,
): string {
  const key = `${base}_${count === 1 ? 'one' : 'other'}` as MessageKey
  return t(key, { count, ...params })
}

const PHASE_KEYS: Record<string, MessageKey> = {
  Discover: 'phase.discover',
  Reproduce: 'phase.reproduce',
  'Attempt 1': 'phase.attempt1',
  'Attempt 2': 'phase.attempt2',
  Diagnose: 'phase.diagnose',
  Implement: 'phase.implement',
  Fix: 'phase.fix',
  'Give up': 'phase.giveUp',
  Explore: 'phase.explore',
  Modify: 'phase.modify',
  Verify: 'phase.verify',
  Submit: 'phase.submit',
  Steps: 'phase.steps',
}

/** Recorded phase names stay in the data; only their display is translated. */
export function phaseLabel(phase: string): string {
  const key = PHASE_KEYS[phase]
  return key ? t(key) : phase
}

export function spanLabel(type: string): string {
  const key = `span.${type}` as MessageKey
  return messages[current][key] ?? type
}

export function spanStatusLabel(status: string): string {
  const key = `spanStatus.${status}` as MessageKey
  return messages[current][key] ?? status
}

export function formatNumber(value: number): string {
  return value.toLocaleString(current === 'zh' ? 'zh-CN' : 'en-US')
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(current === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export type { Locale, MessageKey }
