import type {
  AgentEvent,
  AgentStreamAdapter,
  AgentToolCompleted,
  AgentToolStarted,
  EditOperation,
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
  operation?: EditOperation
}

function toolFromVariant(variant: string): ToolKind {
  if (/read/i.test(variant)) return 'read'
  if (/write|edit/i.test(variant)) return 'edit'
  if (/delete/i.test(variant)) return 'edit'
  if (/shell|bash|terminal/i.test(variant)) return 'shell'
  if (/grep|search|glob|list|find/i.test(variant)) return 'search'
  if (/web|fetch/i.test(variant)) return 'browser'
  return 'tool'
}

export class CursorAdapter implements AgentStreamAdapter {
  readonly id = 'cursor' as const
  readonly name = 'Cursor'
  private readonly started = new Map<string, StartInfo>()

  detect(command: string, args: string[]): boolean {
    const executable = basename(command) ?? command
    if (!/^(cursor-agent|cursor)$/.test(executable)) return false
    const joined = args.join(' ')
    return /stream-json/.test(joined) && /(?:^|\s)(?:-p|--print)(?:\s|$)/.test(joined)
  }

  buildCommand(prompt: string): { command: string; args: string[] } {
    return {
      command: 'cursor-agent',
      args: ['-p', '--output-format', 'stream-json', prompt],
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
          agent: 'cursor',
          model: firstString(event.model, asRecord(event.message).model),
          cwd: firstString(event.cwd, asRecord(event.message).cwd),
          sessionId: firstString(event.session_id, event.sessionId),
        },
      ]
    }

    if (type === 'assistant') {
      const message = asRecord(event.message)
      const content = message.content ?? event.content
      const text = firstString(event.text, typeof content === 'string' ? content : collectText(content))
      if (!text) return []
      return [
        {
          kind: 'message',
          atMs: receivedAtMs,
          role: 'assistant',
          text,
          reasoning: false,
        },
      ]
    }

    if (type === 'tool_call') {
      return this.handleToolCall(event, receivedAtMs)
    }

    if (type === 'result') {
      const subtype = asString(event.subtype) ?? asString(event.status)
      return [
        {
          kind: 'final',
          atMs: receivedAtMs,
          text: firstString(event.result, event.text),
          status: subtype && /error|fail/i.test(subtype) ? 'error' : 'success',
          durationMs: asNumber(event.duration_ms) ?? asNumber(event.durationMs),
          usage: asRecord(event.usage) as Record<string, string | number>,
        },
      ]
    }

    return []
  }

  private handleToolCall(
    event: Record<string, unknown>,
    receivedAtMs: number,
  ): AgentEvent[] {
    const subtype = asString(event.subtype)
    const callId =
      firstString(event.call_id, event.callId) ?? `cursor-${receivedAtMs}-${this.started.size}`
    const toolCall = asRecord(event.tool_call)
    const variant = Object.keys(toolCall)[0] ?? 'unknownToolCall'
    const descriptor = asRecord(toolCall[variant])
    const args = asRecord(descriptor.args)
    const baseTool = toolFromVariant(variant)
    const file =
      firstString(args.path, args.file_path, args.file) ??
      firstString(descriptor.path, descriptor.file_path)
    const command = firstString(args.command, descriptor.command)
    const tool = mapCommandToTool(baseTool, command)
    const operation: EditOperation | undefined =
      baseTool === 'edit' && /delete/i.test(variant) ? 'delete' : undefined
    const fallback = variant.replace(/ToolCall$/, '') || 'Tool'
    const name =
      tool === 'read' && file
        ? `Read ${basename(file)}`
        : tool === 'edit' && file
          ? `Edit ${basename(file)}`
          : tool === 'shell' || tool === 'test'
            ? commandLabel(command) || fallback
            : fallback

    if (subtype === 'started') {
      const info: StartInfo = { atMs: receivedAtMs, tool, name, file, command, operation }
      this.started.set(callId, info)
      const started: AgentToolStarted = {
        kind: 'tool.started',
        atMs: receivedAtMs,
        callId,
        tool,
        name,
        file,
        files: file ? [file] : undefined,
        command,
        operation,
      }
      return [started]
    }

    if (subtype !== 'completed') return []

    const info = this.started.get(callId)
    this.started.delete(callId)
    const result = asRecord(descriptor.result)
    const success = asRecord(result.success)
    const error = asRecord(result.error)
    const output = cleanOutput(
      firstString(
        success.content,
        success.stdout,
        success.output,
        success.text,
        typeof result.success === 'string' ? result.success : undefined,
        error.message,
        collectText(success),
      ),
    )
    const exitCode =
      asNumber(success.exitCode) ??
      asNumber(success.exit_code) ??
      asNumber(error.exitCode) ??
      asNumber(error.exit_code)
    const status =
      error.message || (exitCode !== undefined && exitCode !== 0) ? 'error' : 'ok'
    const test = info?.tool === 'test' || tool === 'test'
      ? outcomeFor(info?.command ?? command ?? '', output ?? '')
      : undefined
    const effectiveFile = info?.file ?? file
    const completed: AgentToolCompleted = {
      kind: 'tool.completed',
      atMs: receivedAtMs,
      startedAtMs: info?.atMs,
      callId,
      tool: test ? 'test' : info?.tool ?? tool,
      name: info?.name ?? name,
      file: effectiveFile,
      files: effectiveFile ? [effectiveFile] : undefined,
      command: info?.command ?? command,
      operation: info?.operation ?? operation,
      status,
      output,
      exitCode,
      test: test ?? undefined,
      patch: firstString(success.diff, success.patch, descriptor.diff),
      errorMessage: firstString(error.message, error.error),
    }
    return [completed]
  }
}

export function createCursorAdapter(): AgentStreamAdapter {
  return new CursorAdapter()
}
