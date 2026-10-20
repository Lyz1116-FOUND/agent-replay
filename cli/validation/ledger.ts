import type { Availability, RunRecord } from './types.ts'

export function runKey(record: Pick<RunRecord, 'task' | 'agent' | 'run'>): string {
  return `${record.task}--${record.agent}--${record.run}`
}

/** A retry is a new attempt, not a replacement: the failed attempt stays visible. */
export function nextAttempt(records: RunRecord[], record: Pick<RunRecord, 'task' | 'agent' | 'run'>): number {
  const key = runKey(record)
  const attempts = records.filter((item) => runKey(item) === key).map((item) => item.attempt ?? 1)
  return attempts.length === 0 ? 1 : Math.max(...attempts) + 1
}

export function appendRun(records: RunRecord[], record: RunRecord): RunRecord[] {
  // The ledger decides the attempt number, so a retry can never silently
  // replace the run it is retrying.
  return [...records, { ...record, attempt: nextAttempt(records, record) }]
}

/** Only the newest attempt of each run counts towards the summary. */
export function latestPerKey(records: RunRecord[]): RunRecord[] {
  const best = new Map<string, RunRecord>()
  for (const record of records) {
    const key = runKey(record)
    const current = best.get(key)
    if (!current || (record.attempt ?? 1) >= (current.attempt ?? 1)) best.set(key, record)
  }
  return [...best.values()]
}

/** An agent that was unavailable in this invocation must not vanish from the record. */
export function mergeAvailability(
  previous: Record<string, Availability> | undefined,
  current: Record<string, Availability>,
): Record<string, Availability> {
  return { ...(previous ?? {}), ...current }
}
