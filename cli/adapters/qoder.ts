import type {
  AgentEvent,
  AgentStreamAdapter,
} from './types.ts'
import { ClaudeAdapter } from './claude.ts'
import { basename } from './helpers.ts'

/**
 * Qoder CLI's stream-json protocol mirrors Claude Code's assistant/tool_use
 * messages, but it is a distinct vendor and model. Parse through the same
 * message parser while keeping a separate adapter identity.
 */
export class QoderAdapter implements AgentStreamAdapter {
  readonly id = 'qoder' as const
  readonly name = 'Qoder CLI'
  readonly env = { QODER_AGENT_SDK_ENTRYPOINT: undefined }
  private readonly parser = new ClaudeAdapter()

  detect(command: string, args: string[]): boolean {
    if ((basename(command) ?? command) !== 'qodercli') return false
    const joined = args.join(' ')
    return (
      /(?:^|\s)(?:-p|--print)(?:\s|$)/.test(joined) &&
      /(?:--output-format|-o)(?:=|\s+)stream-json/.test(joined)
    )
  }

  buildCommand(prompt: string): { command: string; args: string[] } {
    return {
      command: 'qodercli',
      args: ['-p', '--output-format', 'stream-json', '--model', 'DeepSeek-Flash', prompt],
    }
  }

  parseLine(line: string, receivedAtMs: number): AgentEvent[] {
    return this.parser.parseLine(line, receivedAtMs).map((event) =>
      event.kind === 'session' ? { ...event, agent: 'qoder' as const } : event,
    )
  }
}

export function createQoderAdapter(): AgentStreamAdapter {
  return new QoderAdapter()
}
