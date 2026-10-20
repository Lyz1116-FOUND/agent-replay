import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { Availability } from './types.ts'

export type ValidationAgent = {
  id: string
  provider: string
  harnessVersion?: string
  isolate: boolean
  /** Extra PATH entries the CLI needs. */
  pathPrefix?: string
  /** Paid or interactive: never run unless the caller opts in explicitly. */
  requiresConsent?: boolean
  buildCommand(prompt: string): { command: string; args: string[] }
  availability(): Availability
}

function probe(command: string, args: string[], pathPrefix?: string): string | null {
  const env = { ...process.env }
  if (pathPrefix) env.PATH = `${pathPrefix}:${env.PATH ?? ''}`
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 15_000,
    env,
  })
  if (result.error || result.status !== 0) return null
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

function cliAvailability(
  command: string,
  pathPrefix?: string,
  extra?: () => Availability | null,
): Availability {
  const version = probe(command, ['--version'], pathPrefix)
  if (version === null) return { status: 'cli_missing', detail: `${command} not found on PATH` }
  const extraResult = extra?.()
  if (extraResult) return extraResult
  return { status: 'ready', detail: version.split('\n')[0] }
}

const OPENCODE_MODEL = 'opencode/glm-5.3-flash-free'
const ZCODE_MODEL = 'bigmodel-standard-api-2/GLM-5.3-Flash'

export const VALIDATION_AGENTS: Record<string, ValidationAgent> = {
  opencode: {
    id: 'opencode',
    provider: 'opencode',
    harnessVersion: '2.0.32',
    isolate: true,
    pathPrefix: path.join(homedir(), '.opencode', 'bin'),
    buildCommand: (prompt) => ({
      command: 'opencode',
      args: [
        'run', '--standalone', '--format', 'json', '--auto',
        '--model', OPENCODE_MODEL, prompt,
      ],
    }),
    availability() {
      return cliAvailability('opencode', this.pathPrefix)
    },
  },

  codex: {
    id: 'codex',
    provider: 'openai',
    harnessVersion: '0.163.0',
    isolate: false,
    pathPrefix: path.join(homedir(), '.local', 'agent-clis', 'node_modules', '.bin'),
    buildCommand: (prompt) => ({
      command: 'codex',
      // The recorder already provides the outer boundary; the nested macOS
      // sandbox cannot apply inside it.
      args: ['exec', '--json', '-s', 'danger-full-access', '--skip-git-repo-check', prompt],
    }),
    availability() {
      return cliAvailability('codex', this.pathPrefix, () => {
        const auth = path.join(homedir(), '.codex', 'auth.json')
        return existsSync(auth)
          ? null
          : { status: 'login_required', detail: 'codex auth.json not found; run `codex login`' }
      })
    },
  },

  zcode: {
    id: 'zcode',
    provider: 'bigmodel-standard-api-2',
    harnessVersion: '3.15.3-37',
    isolate: false,
    buildCommand: (prompt) => ({
      command: 'zcode',
      args: ['--json', '--no-color', '-p', prompt, '--model', ZCODE_MODEL],
    }),
    availability() {
      return cliAvailability('zcode', undefined, () => {
        const config = path.join(homedir(), '.zcode', 'v2', 'provider_config.json')
        return existsSync(config)
          ? null
          : { status: 'login_required', detail: 'no ZCode provider configured' }
      })
    },
  },

  qoder: {
    id: 'qoder',
    provider: 'qoder',
    harnessVersion: '1.1.74',
    isolate: false,
    buildCommand: (prompt) => ({
      command: 'qodercli',
      args: [
        '-p', '-o', 'stream-json', '-m', 'DeepSeek-Flash',
        '--permission-mode', 'accept_edits',
        '--allowed-tools', 'Read,Edit,Write,Bash(node --test)', prompt,
      ],
    }),
    availability() {
      return cliAvailability('qodercli')
    },
  },

  claude: {
    id: 'claude',
    provider: 'anthropic',
    harnessVersion: '2.1.304',
    isolate: false,
    requiresConsent: true,
    buildCommand: (prompt) => ({
      command: 'claude',
      args: [
        '-p', '--output-format', 'stream-json', '--verbose',
        '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Read,Edit,Write,Bash(node --test)', prompt,
      ],
    }),
    availability() {
      return cliAvailability('claude')
    },
  },

  cursor: {
    id: 'cursor',
    provider: 'cursor',
    harnessVersion: '2026.10.19',
    isolate: false,
    requiresConsent: true,
    pathPrefix: path.join(homedir(), '.local', 'bin'),
    buildCommand: (prompt) => ({
      command: 'cursor-agent',
      args: ['-p', '--output-format', 'stream-json', prompt],
    }),
    availability() {
      return cliAvailability('cursor-agent', this.pathPrefix, () => {
        const status = probe('cursor-agent', ['status'], this.pathPrefix)
        if (status === null) {
          return { status: 'error', detail: 'cursor-agent status failed' }
        }
        if (/not logged in/i.test(status)) {
          return {
            status: 'login_required',
            detail: 'run `cursor-agent login` in a terminal; the recorder cannot do it for you',
          }
        }
        return null
      })
    },
  },
}

/** Agents this harness is allowed to run without extra consent. */
export const DEFAULT_AGENTS = ['opencode', 'codex', 'zcode', 'qoder']
