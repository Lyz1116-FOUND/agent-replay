import type {
  AgentEvent,
  AgentStreamAdapter,
  AgentToolCompleted,
  AgentToolStarted,
  EditOperation,
  TestOutcome,
  ToolKind,
} from './types.ts'
import {
  asNumber,
  asRecord,
  asString,
  basename,
  cleanOutput,
  collectText,
  firstString,
  mapCommandToTool,
  outcomeFor,
  safeJson,
} from './helpers.ts'
import { classifyFailure } from '../lib/termination.ts'

function toolForName(name: string): ToolKind {
  if (/^(read|read_file|readfile|open)$/i.test(name)) return 'read'
  if (/^(edit|write|patch|multiedit|apply_patch|create)$/i.test(name)) return 'edit'
  if (/^(shell|bash|execute|terminal|run|exec)$/i.test(name)) return 'shell'
  if (/^(grep|glob|search|list|find|codesearch)$/i.test(name)) return 'search'
  if (/^(webfetch|websearch|fetch|browser)$/i.test(name)) return 'browser'
  return 'tool'
}

function operationForStatus(status: string | undefined): EditOperation | undefined {
  if (status === 'added' || status === 'created') return 'create'
  if (status === 'deleted' || status === 'removed') return 'delete'
  if (status === 'renamed') return 'rename'
  if (status === 'modified' || status === 'updated') return 'modify'
  return undefined
}

export class OpenCodeAdapter implements AgentStreamAdapter {
  readonly id = 'opencode' as const
  readonly name = 'OpenCode'
  private sessionId: string | undefined
  private emittedSession = false
  private lastText = ''
  /** Accumulated token usage across steps, reported in finalize(). */
  private usage: { input: number; output: number } | undefined
  private lastAtMs = 0

  detect(command: string, args: string[]): boolean {
    if ((basename(command) ?? command) !== 'opencode') return false
    const joined = args.join(' ')
    return /\brun\b/.test(joined) && /--format(?:=|\s+)json/.test(joined)
  }

  buildCommand(prompt: string): { command: string; args: string[] } {
    return { command: 'opencode', args: ['run', '--format', 'json', prompt] }
  }

  parseLine(line: string, receivedAtMs: number): AgentEvent[] {
    const event = safeJson(line)
    if (!event) return []
    this.lastAtMs = receivedAtMs
    const type = asString(event.type)
    const part = asRecord(event.part)
    const events: AgentEvent[] = []

    if (!this.emittedSession && type) {
      this.emittedSession = true
      this.sessionId = firstString(event.sessionID) ?? firstString(part.sessionID)
      events.push({
        kind: 'session',
        atMs: receivedAtMs,
        agent: 'opencode',
        sessionId: this.sessionId,
      })
    }

    if (type === 'text') {
      const text = firstString(part.text)
      if (text?.trim()) {
        this.lastText = text
        events.push({
          kind: 'message',
          atMs: receivedAtMs,
          role: 'assistant',
          text,
          reasoning: false,
        })
      }
      return events
    }

    if (type === 'tool_use') {
      events.push(...this.handleTool(part, receivedAtMs))
      return events
    }

    if (type === 'step_finish') {
      // In `--auto` mode the agent emits `reason: "tool-calls"` on every step
      // (never `"stop"`), so accumulate tokens here and report the total in
      // finalize() rather than relying on a terminal "stop" step.
      const tokens = asRecord(part.tokens)
      const input = asNumber(tokens.input)
      const output = asNumber(tokens.output)
      if (input !== undefined || output !== undefined) {
        this.usage = {
          input: (this.usage?.input ?? 0) + (input ?? 0),
          output: (this.usage?.output ?? 0) + (output ?? 0),
        }
      }
      if (asString(part.reason) === 'stop') {
        events.push({
          kind: 'final',
          atMs: receivedAtMs,
          text: this.lastText || undefined,
          status: 'success',
          usage: {
            ...(asNumber(tokens.input) !== undefined ? { input_tokens: asNumber(tokens.input)! } : {}),
            ...(asNumber(tokens.output) !== undefined ? { output_tokens: asNumber(tokens.output)! } : {}),
          },
        })
      }
      return events
    }

    if (type === 'error') {
      const error = asRecord(event.error)
      const message =
        firstString(event.message, error.message, part.message, 'OpenCode stream error') ??
        'OpenCode stream error'
      const status = asNumber(error.status)
      const detail = status !== undefined ? `${message} (HTTP ${status})` : message
      const termination = classifyFailure({
        message,
        status,
        type: firstString(error.type),
      })
      events.push({
        kind: 'error',
        atMs: receivedAtMs,
        message: detail,
        termination: termination.kind,
        code: status,
      })
    }

    return events
  }

  finalize(): AgentEvent[] {
    if (!this.usage) return []
    return [
      {
        kind: 'final',
        atMs: this.lastAtMs,
        usage: {
          input_tokens: this.usage.input,
          output_tokens: this.usage.output,
        },
      },
    ]
  }

  private handleTool(part: Record<string, unknown>, receivedAtMs: number): AgentEvent[] {
    const name = (firstString(part.tool) ?? 'tool').toLowerCase()
    const state = asRecord(part.state)
    const status = asString(state.status) ?? 'completed'
    const input = asRecord(state.input)
    const tool = mapCommandToTool(toolForName(name), firstString(input.command, input.cmd))
    const file = firstString(input.path, input.file_path, input.filePath, input.file)
    const command = firstString(input.command, input.cmd)
    const metadata = asRecord(state.metadata)
    const meta = asRecord(metadata.metadata)
    const content = metadata.content
    const output = cleanOutput(
      firstString(state.output, typeof content === 'string' ? content : collectText(content)),
    )
    const callId = firstString(part.id) ?? `opencode-${receivedAtMs}-${name}`
    const displayName =
      tool === 'read' && file
        ? `Read ${basename(file)}`
        : tool === 'edit' && file
          ? `Edit ${basename(file)}`
          : tool === 'shell' || tool === 'test'
            ? command ?? name
            : name
    const time = asRecord(state.time)
    const start = asNumber(time.start)
    const end = asNumber(time.end)
    const duration = start !== undefined && end !== undefined ? Math.max(0, end - start) : 0

    if (status === 'running') {
      const started: AgentToolStarted = {
        kind: 'tool.started',
        atMs: receivedAtMs,
        callId,
        tool,
        name: displayName,
        file,
        files: file ? [file] : undefined,
        command,
      }
      return [started]
    }

    const filesRecord = Array.isArray(meta.files) ? meta.files : []
    const changedFiles = filesRecord
      .map((item) => asRecord(item))
      .map((item) => firstString(item.file, item.path))
      .filter((value): value is string => Boolean(value))
    const patch = filesRecord
      .map((item) => asRecord(item))
      .map((item) => firstString(item.patch))
      .filter((value): value is string => Boolean(value))
      .join('\n')
    const operation =
      filesRecord.length === 1
        ? operationForStatus(firstString(asRecord(filesRecord[0]).status))
        : undefined
    const exitCode = asNumber(meta.exit) ?? asNumber(meta.exitCode) ?? asNumber(meta.exit_code)
    const test: TestOutcome | undefined =
      tool === 'shell' || tool === 'test'
        ? outcomeFor(command ?? '', output ?? '')
        : undefined
    const effectiveTool: ToolKind = test ? 'test' : tool
    const error = status === 'error' || exitCode !== undefined && exitCode !== 0
    const completed: AgentToolCompleted = {
      kind: 'tool.completed',
      atMs: receivedAtMs,
      startedAtMs: Math.max(0, receivedAtMs - duration),
      callId,
      tool: effectiveTool,
      name: displayName,
      file: file ?? (changedFiles.length === 1 ? changedFiles[0] : undefined),
      files: changedFiles.length > 0 ? changedFiles : file ? [file] : undefined,
      command,
      operation,
      status: error ? 'error' : 'ok',
      output,
      exitCode,
      test: test ?? undefined,
      patch: patch || undefined,
      errorMessage: error ? cleanOutput(firstString(meta.error, state.output)) : undefined,
    }
    return [completed]
  }
}

export function createOpenCodeAdapter(): AgentStreamAdapter {
  return new OpenCodeAdapter()
}
