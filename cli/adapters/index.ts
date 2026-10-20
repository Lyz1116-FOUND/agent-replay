import type {
  AgentEvent,
  AgentId,
  AgentStreamAdapter,
} from './types.ts'
import { createCodexAdapter } from './codex.ts'
import { createCursorAdapter } from './cursor.ts'
import { createClaudeAdapter } from './claude.ts'
import { createOpenCodeAdapter } from './opencode.ts'
import { createQoderAdapter } from './qoder.ts'
import { createZCodeAdapter } from './zcode.ts'

/**
 * A deliberately small adapter for wrappers that already speak Agent Replay's
 * normalized event protocol. The generic stdout scanner remains the fallback
 * for unmodified CLIs.
 */
class GenericAdapter implements AgentStreamAdapter {
  readonly id = 'generic' as const
  readonly name = 'Generic stream'

  detect(): boolean {
    return false
  }

  buildCommand(prompt: string): { command: string; args: string[] } {
    return { command: 'sh', args: ['-c', prompt] }
  }

  parseLine(line: string, receivedAtMs: number): AgentEvent[] {
    try {
      const parsed = JSON.parse(line) as unknown
      if (typeof parsed !== 'object' || parsed === null) return []
      const event = parsed as Record<string, unknown>
      if (typeof event.kind !== 'string') return []
      if (!('atMs' in event)) event.atMs = receivedAtMs
      return [event as unknown as AgentEvent]
    } catch {
      return []
    }
  }
}

const factories: Record<AgentId, () => AgentStreamAdapter> = {
  codex: createCodexAdapter,
  cursor: createCursorAdapter,
  claude: createClaudeAdapter,
  opencode: createOpenCodeAdapter,
  qoder: createQoderAdapter,
  zcode: createZCodeAdapter,
  generic: () => new GenericAdapter(),
}

export function isAgentId(value: string): value is AgentId {
  return value in factories
}

export function createAgentAdapter(id: AgentId): AgentStreamAdapter {
  return factories[id]()
}

export function detectAgentAdapter(
  command: string,
  args: string[],
): AgentStreamAdapter | undefined {
  for (const id of ['cursor', 'codex', 'claude', 'opencode', 'qoder', 'zcode'] as const) {
    const adapter = factories[id]()
    if (adapter.detect(command, args)) return adapter
  }
  return undefined
}

export {
  createCodexAdapter,
  createCursorAdapter,
  createClaudeAdapter,
  createOpenCodeAdapter,
  createQoderAdapter,
  createZCodeAdapter,
  GenericAdapter,
}
export type { AgentStreamAdapter, AgentEvent, AgentId }
