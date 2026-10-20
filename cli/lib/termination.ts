/**
 * Why a recorded run ended the way it did.
 *
 * `status` answers "did the task's own tests pass", which is the only thing a
 * benchmark should count as capability. `termination` answers "did the run even
 * get a fair chance". A provider 403 is not a failed task, and averaging it into
 * a success rate silently punishes the model for someone else's infrastructure.
 */
export type TerminationKind =
  | 'completed'
  | 'task_failure'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'permission_denied'
  | 'timeout'
  | 'agent_error'
  | 'recorder_error'

export type Termination = {
  kind: TerminationKind
  message?: string
  code?: string | number
}

/** Kinds where the model never got to attempt the task. */
const UNAVAILABLE: ReadonlySet<TerminationKind> = new Set([
  'provider_unavailable',
  'rate_limited',
  'permission_denied',
  'recorder_error',
])

export function isUnavailable(kind: TerminationKind): boolean {
  return UNAVAILABLE.has(kind)
}

const RULES: Array<{ kind: TerminationKind; pattern: RegExp }> = [
  // A region block arrives as 403, so it has to outrank generic permission rules.
  {
    kind: 'provider_unavailable',
    pattern:
      /not available in your country|regionerror|model unavailable|no-route|provider\.no-route|no available provider|model_not_found/i,
  },
  { kind: 'rate_limited', pattern: /rate.?limit|too many requests|quota exceeded|\b429\b/i },
  {
    kind: 'permission_denied',
    pattern: /unauthorized|forbidden|invalid api key|authentication|not logged in|\b401\b|\b403\b/i,
  },
  { kind: 'timeout', pattern: /timed out|timeout|etimedout|deadline exceeded/i },
  { kind: 'provider_unavailable', pattern: /\b50[0234]\b|service unavailable|overloaded|connection reset/i },
]

export function classifyFailure(input: {
  message?: string
  status?: number
  type?: string
}): Termination {
  const message = input.message?.trim()
  const haystack = [input.type, message, input.status !== undefined ? String(input.status) : '']
    .filter(Boolean)
    .join(' ')

  const code = input.status
  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) {
      return { kind: rule.kind, message, code }
    }
  }
  return { kind: 'agent_error', message, code }
}

export function completed(): Termination {
  return { kind: 'completed' }
}

export function taskFailure(message?: string): Termination {
  return { kind: 'task_failure', message }
}

export function timeout(message?: string): Termination {
  return { kind: 'timeout', message }
}

export function recorderError(message?: string): Termination {
  return { kind: 'recorder_error', message }
}
