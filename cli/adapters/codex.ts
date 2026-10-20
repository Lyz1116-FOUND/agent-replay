import type {
  AgentEvent,
  AgentStreamAdapter,
  AgentToolCompleted,
  AgentToolStarted,
  EditOperation,
  ToolKind,
} from './types.ts'
import { classifyFailure, statusFromMessage } from '../lib/termination.ts'
import {
  asNumber,
  asRecord,
  asString,
  basename,
  cleanOutput,
  collectText,
  commandLabel,
  firstString,
  mapCommandToTool,
  outcomeFor,
  safeJson,
} from './helpers.ts'

type StartInfo = {
  atMs: number
  tool: ToolKind
  name: string
  file?: string
  files?: string[]
  command?: string
}

function operationForKind(kind: string | undefined): EditOperation | undefined {
  if (kind === 'add' || kind === 'create') return 'create'
  if (kind === 'delete' || kind === 'remove') return 'delete'
  if (kind === 'update' || kind === 'modify') return 'modify'
  return undefined
}

function fileChangeName(changes: Array<{ path?: string; kind?: string }>): string {
  if (changes.length === 1) {
    const change = changes[0]
    const name = basename(change.path) ?? 'file'
    if (change.kind === 'add' || change.kind === 'create') return `Create ${name}`
    if (change.kind === 'delete' || change.kind === 'remove') return `Delete ${name}`
    return `Edit ${name}`
  }
  return `${changes.length} files changed`
}

export class CodexAdapter implements AgentStreamAdapter {
  readonly id = 'codex' as const
  readonly name = 'Codex'
  private readonly started = new Map<string, StartInfo>()
  private lastMessage = ''

  detect(command: string, args: string[]): boolean {
    if ((basename(command) ?? command) !== 'codex') return false
    const joined = args.join(' ')
    return /\bexec\b/.test(joined) && /(?:^|\s)--json(?:\s|$)/.test(joined)
  }

  buildCommand(prompt: string): { command: string; args: string[] } {
    return { command: 'codex', args: ['exec', '--json', prompt] }
  }

  parseLine(line: string, receivedAtMs: number): AgentEvent[] {
    const event = safeJson(line)
    if (!event) return []
    const type = asString(event.type)

    if (type === 'thread.started') {
      return [
        {
          kind: 'session',
          atMs: receivedAtMs,
          agent: 'codex',
          sessionId: firstString(event.thread_id, event.threadId),
        },
      ]
    }

    if (type === 'item.started' || type === 'item.completed' || type === 'item.updated') {
      return this.handleItem(event, receivedAtMs)
    }

    if (type === 'turn.completed') {
      return [
        {
          kind: 'final',
          atMs: receivedAtMs,
          text: this.lastMessage || undefined,
          status: 'success',
          usage: asRecord(event.usage) as Record<string, string | number>,
        },
      ]
    }

    if (type === 'turn.failed') {
      const error = asRecord(event.error)
      return [
        {
          kind: 'final',
          atMs: receivedAtMs,
          status: 'error',
          text: firstString(error.message, event.message),
        },
      ]
    }

    if (type === 'error') {
      const message = firstString(event.message, 'Codex stream error') ?? 'Codex stream error'
      const code = statusFromMessage(message)
      return [
        {
          kind: 'error',
          atMs: receivedAtMs,
          message,
          termination: classifyFailure({ message, status: code }).kind,
          code,
        },
      ]
    }

    return []
  }

  private handleItem(event: Record<string, unknown>, atMs: number): AgentEvent[] {
    const item = asRecord(event.item)
    const itemId = firstString(item.id) ?? `codex-${atMs}`
    const itemType = asString(item.type)
    const phase = asString(event.type)

    if (itemType === 'command_execution') {
      const command = firstString(item.command) ?? ''
      const baseTool = mapCommandToTool('shell', command)
      const name = commandLabel(command)
      if (phase === 'item.started' || phase === 'item.updated') {
        this.started.set(itemId, { atMs, tool: baseTool, name, command })
        const started: AgentToolStarted = {
          kind: 'tool.started',
          atMs,
          callId: itemId,
          tool: baseTool,
          name,
          command,
        }
        return [started]
      }
      if (phase !== 'item.completed') return []
      const info = this.started.get(itemId)
      this.started.delete(itemId)
      const output = cleanOutput(firstString(item.aggregated_output, item.output))
      const exitCode = asNumber(item.exit_code) ?? asNumber(item.exitCode)
      const test = outcomeFor(command, output ?? '')
      const tool = test ? 'test' : info?.tool ?? baseTool
      const completed: AgentToolCompleted = {
        kind: 'tool.completed',
        atMs,
        startedAtMs: info?.atMs,
        callId: itemId,
        tool,
        name: info?.name ?? name,
        command,
        status: exitCode !== undefined && exitCode !== 0 ? 'error' : 'ok',
        output,
        exitCode,
        test: test ?? undefined,
      }
      return [completed]
    }

    if (itemType === 'file_change') {
      if (phase !== 'item.completed') return []
      const changes = (Array.isArray(item.changes) ? item.changes : []).map((raw) => {
        const change = asRecord(raw)
        return {
          path: firstString(change.path),
          kind: firstString(change.kind),
        }
      })
      const files = changes.flatMap((change) => (change.path ? [change.path] : []))
      const operation = changes.length === 1 ? operationForKind(changes[0].kind) : undefined
      const completed: AgentToolCompleted = {
        kind: 'tool.completed',
        atMs,
        startedAtMs: atMs,
        callId: itemId,
        tool: 'edit',
        name: fileChangeName(changes),
        file: files.length === 1 ? files[0] : undefined,
        files: files.length > 0 ? files : undefined,
        operation,
        status: 'ok',
        output: files.length > 0 ? `Reported file change: ${files.join(', ')}` : undefined,
      }
      return [completed]
    }

    if (itemType === 'mcp_tool_call') {
      const server = firstString(item.server) ?? 'mcp'
      const tool = firstString(item.tool) ?? 'tool'
      const name = `${server}.${tool}`
      const args = asRecord(item.arguments)
      if (phase === 'item.started' || phase === 'item.updated') {
        this.started.set(itemId, { atMs, tool: 'tool', name })
        return [
          {
            kind: 'tool.started',
            atMs,
            callId: itemId,
            tool: 'tool',
            name,
            argsSummary: firstString(args.query, args.q, args.path, args.command),
          },
        ]
      }
      if (phase !== 'item.completed') return []
      const info = this.started.get(itemId)
      this.started.delete(itemId)
      const error = asRecord(item.error)
      const output = cleanOutput(collectText(item.result))
      return [
        {
          kind: 'tool.completed',
          atMs,
          startedAtMs: info?.atMs,
          callId: itemId,
          tool: 'tool',
          name: info?.name ?? name,
          status: error.message ? 'error' : 'ok',
          output,
          errorMessage: firstString(error.message),
        },
      ]
    }

    if (itemType === 'agent_message') {
      const text = firstString(item.text)
      if (!text) return []
      this.lastMessage = text
      return [{ kind: 'message', atMs, role: 'assistant', text, reasoning: false }]
    }

    if (itemType === 'reasoning') {
      const text = firstString(item.text)
      if (!text) return []
      return [{ kind: 'message', atMs, role: 'assistant', text, reasoning: true }]
    }

    if (itemType === 'web_search') {
      return [
        {
          kind: 'tool.completed',
          atMs,
          startedAtMs: atMs,
          callId: itemId,
          tool: 'browser',
          name: 'Web search',
          status: 'ok',
          output: firstString(item.query),
        },
      ]
    }

    if (itemType === 'error') {
      const message = firstString(item.message, 'Codex item error') ?? 'Codex item error'
      const code = statusFromMessage(message)
      return [
        {
          kind: 'error',
          atMs,
          message,
          termination: classifyFailure({ message, status: code }).kind,
          code,
        },
      ]
    }

    return []
  }
}

export function createCodexAdapter(): AgentStreamAdapter {
  return new CodexAdapter()
}
