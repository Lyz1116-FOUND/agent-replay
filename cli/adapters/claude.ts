import type {
  AgentEvent,
  AgentStreamAdapter,
  AgentToolCompleted,
  AgentToolStarted,
  ToolKind,
} from './types.ts'
import {
  asNumber,
  asRecord,
  asString,
  basename,
  cleanOutput,
  collectText,
  commandLabel,
  fileFromInput,
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
  command?: string
}

function toolForName(name: string): ToolKind {
  switch (name) {
    case 'Read':
    case 'NotebookRead':
      return 'read'
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'Write':
      return 'edit'
    case 'Bash':
    case 'BashOutput':
      return 'shell'
    case 'Glob':
    case 'Grep':
    case 'LS':
      return 'search'
    case 'WebFetch':
    case 'WebSearch':
      return 'browser'
    default:
      return 'tool'
  }
}

export class ClaudeAdapter implements AgentStreamAdapter {
  readonly id = 'claude' as const
  readonly name = 'Claude Code'
  private readonly started = new Map<string, StartInfo>()
  private callCounter = 0

  detect(command: string, args: string[]): boolean {
    return (basename(command) ?? command) === 'claude' && args.join(' ').includes('stream-json')
  }

  buildCommand(prompt: string): { command: string; args: string[] } {
    return {
      command: 'claude',
      args: ['-p', '--output-format', 'stream-json', '--verbose', prompt],
    }
  }

  parseLine(line: string, receivedAtMs: number): AgentEvent[] {
    const event = safeJson(line)
    if (!event) return []
    const type = asString(event.type)

    if (type === 'system') {
      return [
        {
          kind: 'session',
          atMs: receivedAtMs,
          agent: 'claude',
          model: firstString(event.model, asRecord(event.message).model),
          cwd: firstString(event.cwd, asRecord(event.message).cwd),
          sessionId: firstString(event.session_id),
        },
      ]
    }

    if (type === 'assistant') {
      return this.handleAssistant(event, receivedAtMs)
    }

    if (type === 'user') {
      return this.handleUser(event, receivedAtMs)
    }

    if (type === 'result') {
      const subtype = asString(event.subtype)
      return [
        {
          kind: 'final',
          atMs: receivedAtMs,
          text: firstString(event.result, event.text),
          status: subtype && /error|fail/i.test(subtype) ? 'error' : 'success',
          durationMs: asNumber(event.duration_ms),
          usage: asRecord(event.usage) as Record<string, string | number>,
        },
      ]
    }

    return []
  }

  private handleAssistant(event: Record<string, unknown>, atMs: number): AgentEvent[] {
    const message = asRecord(event.message)
    const content = message.content ?? event.content
    const blocks = Array.isArray(content) ? content : []
    const events: AgentEvent[] = []

    if (typeof content === 'string' && content.trim()) {
      events.push({
        kind: 'message',
        atMs,
        role: 'assistant',
        text: content,
        reasoning: false,
      })
    }

    for (const rawBlock of blocks) {
      const block = asRecord(rawBlock)
      const blockType = asString(block.type)
      if (blockType === 'text') {
        const text = asString(block.text)
        if (text?.trim()) {
          events.push({ kind: 'message', atMs, role: 'assistant', text, reasoning: false })
        }
        continue
      }
      if (blockType !== 'tool_use') continue

      const name = asString(block.name) ?? 'Tool'
      const callId = asString(block.id) ?? `claude-${atMs}-${this.callCounter++}`
      const input = asRecord(block.input)
      const baseTool = toolForName(name)
      const file = fileFromInput(input)
      const command = firstString(input.command, input.cmd)
      const tool = mapCommandToTool(baseTool, command)
      const theName =
        tool === 'read' && file
          ? `Read ${basename(file)}`
          : tool === 'edit' && file
            ? `Edit ${basename(file)}`
            : tool === 'shell' || tool === 'test'
              ? commandLabel(command) || name
              : name
      this.started.set(callId, { atMs, tool, name: theName, file, command })
      const started: AgentToolStarted = {
        kind: 'tool.started',
        atMs,
        callId,
        tool,
        name: theName,
        file,
        files: file ? [file] : undefined,
        command,
        argsSummary: firstString(input.pattern, input.query, input.url, input.description),
      }
      events.push(started)
    }

    return events
  }

  private handleUser(event: Record<string, unknown>, atMs: number): AgentEvent[] {
    const message = asRecord(event.message)
    const content = message.content
    if (!Array.isArray(content)) return []
    const events: AgentEvent[] = []

    for (const rawBlock of content) {
      const block = asRecord(rawBlock)
      if (asString(block.type) !== 'tool_result') continue
      const callId =
        firstString(block.tool_use_id, block.toolUseId) ??
        `claude-result-${atMs}-${this.callCounter++}`
      const info = this.started.get(callId)
      this.started.delete(callId)
      const rawOutput = block.content ?? block.output
      const output = cleanOutput(
        typeof rawOutput === 'string' ? rawOutput : collectText(rawOutput),
      )
      const isError = block.is_error === true || block.isError === true
      const tool = info?.tool ?? 'tool'
      const test = tool === 'test' || tool === 'shell'
        ? outcomeFor(info?.command ?? '', output ?? '')
        : undefined
      const completed: AgentToolCompleted = {
        kind: 'tool.completed',
        atMs,
        startedAtMs: info?.atMs,
        callId,
        tool: test ? 'test' : tool,
        name: info?.name ?? 'Tool result',
        file: info?.file,
        files: info?.file ? [info.file] : undefined,
        command: info?.command,
        status: isError ? 'error' : 'ok',
        output,
        exitCode: isError ? 1 : undefined,
        test: test ?? undefined,
        errorMessage: isError ? output : undefined,
      }
      events.push(completed)
    }

    return events
  }
}

export function createClaudeAdapter(): AgentStreamAdapter {
  return new ClaudeAdapter()
}
