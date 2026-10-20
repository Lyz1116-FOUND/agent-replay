import { isTestCommand, parseTestOutput, stripAnsi } from '../lib/testParser.ts'
import type { TestOutcome, ToolKind } from './types.ts'

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

export function collectText(value: unknown, depth = 0): string {
  if (depth > 5) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((item) => collectText(item, depth + 1))
      .filter(Boolean)
      .join('\n')
  }
  const record = asRecord(value)
  for (const key of ['text', 'content', 'output', 'stdout', 'result', 'message', 'error']) {
    if (key in record) {
      const text = collectText(record[key], depth + 1)
      if (text) return text
    }
  }
  return ''
}

export function basename(file: string | undefined): string | undefined {
  return file?.split('/').pop()
}

export function commandName(command: string | undefined): string {
  if (!command) return 'Command'
  const first = command.trim().split(/\s+/)[0] ?? ''
  return first.split('/').pop() ?? first
}

export function commandLabel(command: string | undefined): string {
  if (!command) return 'Command'
  const line = command.trim().split('\n')[0] ?? command
  return line.length > 48 ? `${line.slice(0, 47)}…` : line
}

export function classifyCommand(command: string): ToolKind {
  return isTestCommand(command) ? 'test' : 'shell'
}

export function outcomeFor(command: string, output: string): TestOutcome | undefined {
  if (!isTestCommand(command) && !/(?:\d+)\s+(?:passed|failed)/i.test(output)) return undefined
  return parseTestOutput(output) ?? undefined
}

export function cleanOutput(text: string | undefined): string | undefined {
  if (!text) return undefined
  return stripAnsi(text).trim() || undefined
}

export function safeJson(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return asRecord(parsed)
  } catch {
    return null
  }
}

export function readToolInput(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(input[key])
    if (value) return value
  }
  return undefined
}

export function toolNameFor(tool: ToolKind, file: string | undefined, fallback: string): string {
  if (tool === 'read' && file) return `Read ${basename(file)}`
  if (tool === 'edit' && file) return `Edit ${basename(file)}`
  return fallback
}

export function mapCommandToTool(tool: ToolKind, command: string | undefined): ToolKind {
  if (!command) return tool
  if (isTestCommand(command)) return 'test'
  if (tool === 'shell' || tool === 'test') return classifyCommand(command)
  return tool
}

export function fileFromInput(input: Record<string, unknown>): string | undefined {
  return readToolInput(input, 'file_path', 'path', 'file', 'notebook_path')
}
