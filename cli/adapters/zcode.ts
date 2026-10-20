import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentEvent,
  AgentStreamAdapter,
} from './types.ts'
import { OpenCodeAdapter } from './opencode.ts'
import { basename } from './helpers.ts'

/**
 * ZCode CLI (`zcode-app-cli`, the official Z.ai / BigModel harness) is an
 * OpenCode-lineage agent: its session parts use the same text/tool/step shapes.
 *
 * `zcode --json -p ...` only prints one pretty-printed summary object at the
 * end, so there is no live event stream to parse. We buffer stdout, take the
 * session id from the summary, and read the tool/message parts that ZCode
 * itself persisted, keyed by that session id. Timestamps come from ZCode's own
 * records, so they are observed execution times rather than recorder wall clock.
 */
type PartRow = {
  part: string
  message: string
  created: number
}

type ReadParts = (sessionId: string) => PartRow[]

const require_ = createRequire(import.meta.url)

function zcodeDbPath(): string {
  return process.env.ZCODE_DB_PATH ?? path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite')
}

const QUERY = `
  select p.data as part, m.data as message, p.time_created as created
  from part p join message m on m.id = p.message_id
  where p.session_id = ?
  order by p.time_created asc, p.sequence asc
`

function readPartsFromDb(sessionId: string): PartRow[] {
  try {
    const { DatabaseSync } = require_('node:sqlite') as {
      DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => {
        prepare(sql: string): { all(...params: unknown[]): unknown[] }
        close(): void
      }
    }
    const db = new DatabaseSync(zcodeDbPath(), { readOnly: true })
    try {
      return db.prepare(QUERY).all(sessionId) as PartRow[]
    } finally {
      db.close()
    }
  } catch {
    // Older Node builds lack node:sqlite; workspace capture still applies.
    return []
  }
}

const PART_TYPES: Record<string, string> = {
  text: 'text',
  tool: 'tool_use',
  'step-finish': 'step_finish',
}

function parseSummary(raw: string): { sessionId?: string; response?: string } | undefined {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined
    const response = typeof parsed.response === 'string' ? parsed.response : undefined
    return { sessionId, response }
  } catch {
    return undefined
  }
}

export class ZCodeAdapter implements AgentStreamAdapter {
  readonly id = 'zcode' as const
  readonly name = 'ZCode CLI'
  private readonly parser = new OpenCodeAdapter()
  private readonly readParts: ReadParts
  private readonly now: () => number
  private buffer = ''
  private clockOffset: number | undefined

  constructor(readParts: ReadParts = readPartsFromDb, now: () => number = () => Date.now()) {
    this.readParts = readParts
    this.now = now
  }

  detect(command: string, args: string[]): boolean {
    if ((basename(command) ?? command) !== 'zcode') return false
    const joined = args.join(' ')
    return /(?:^|\s)(?:-p|--prompt)(?:\s|$)/.test(joined) && /(?:^|\s)--json(?:\s|$)/.test(joined)
  }

  buildCommand(prompt: string): { command: string; args: string[] } {
    return { command: 'zcode', args: ['--json', '--no-color', '-p', prompt] }
  }

  parseLine(line: string, receivedAtMs: number): AgentEvent[] {
    this.buffer += `${line}\n`
    // The recorder reports elapsed ms, while ZCode persists absolute epoch ms.
    // `now() - receivedAtMs` recovers the session start and never drifts.
    if (this.clockOffset === undefined) this.clockOffset = this.now() - receivedAtMs
    return []
  }

  finalize(): AgentEvent[] {
    const summary = parseSummary(this.buffer)
    if (!summary?.sessionId) return []
    const rows = this.readParts(summary.sessionId)
    if (rows.length === 0) return []

    let model: string | undefined
    let firstAt = Number.POSITIVE_INFINITY
    let lastAt = 0
    const events: AgentEvent[] = []
    const offset = this.clockOffset ?? 0

    for (const row of rows) {
      const at = (Number(row.created) || 0) - offset
      const created = at > 0 ? at : 0
      if (created > 0 && created < firstAt) firstAt = created
      if (created > lastAt) lastAt = created

      let message: Record<string, unknown>
      let part: Record<string, unknown>
      try {
        message = JSON.parse(row.message) as Record<string, unknown>
        part = JSON.parse(row.part) as Record<string, unknown>
      } catch {
        continue
      }

      if (!model) {
        const selection = message.modelSelection as Record<string, unknown> | undefined
        const providerId = typeof selection?.providerId === 'string' ? selection.providerId : undefined
        const modelId =
          typeof message.modelId === 'string'
            ? message.modelId
            : typeof selection?.modelId === 'string'
              ? selection.modelId
              : undefined
        if (modelId) model = providerId ? `${providerId}/${modelId}` : modelId
      }

      // Prompts and hidden system reminders are not agent actions.
      if (message.role !== 'assistant') continue

      const type = typeof part.type === 'string' ? part.type : ''
      const mapped = PART_TYPES[type]
      if (!mapped) continue

      const shaped: Record<string, unknown> = { ...part }
      if (type === 'tool') {
        shaped.id = part.callID
        shaped.type = 'tool_use'
      } else {
        shaped.type = mapped
      }

      const parsed = this.parser
        .parseLine(JSON.stringify({ type: shaped.type, part: shaped }), created)
        .filter((event) => event.kind !== 'session')
        .map((event) => ({ ...event, atMs: created }) as AgentEvent)
      events.push(...parsed)
    }

    if (events.length === 0) return []
    const sessionAt = Number.isFinite(firstAt) ? firstAt : lastAt
    const hasFinal = events.some((event) => event.kind === 'final')
    if (!hasFinal) {
      events.push({
        kind: 'final',
        atMs: lastAt || sessionAt,
        text: summary.response,
        status: 'success',
      })
    }
    return [
      {
        kind: 'session',
        atMs: sessionAt,
        agent: 'zcode',
        model,
        sessionId: summary.sessionId,
      },
      ...events,
    ]
  }
}

export function createZCodeAdapter(readParts?: ReadParts, now?: () => number): AgentStreamAdapter {
  return new ZCodeAdapter(readParts, now)
}
