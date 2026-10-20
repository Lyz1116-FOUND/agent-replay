#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { formatDuration, plural } from './lib/fsutil.ts'
import {
  recordSession,
  runInSession,
  startSession,
  stopSession,
  watchSession,
  type StartOptions,
} from './lib/recorder.ts'
import { displayCommand } from './lib/testParser.ts'
import {
  createAgentAdapter,
  detectAgentAdapter,
  isAgentId,
} from './adapters/index.ts'
import { findTrace, listTraces } from './lib/traces.ts'
import { openTrace } from './lib/openServer.ts'
import type { SessionMeta } from './lib/types.ts'
import type { Trace } from '../src/schema/trace.ts'

const VERSION = '1.0.0-beta.1'

const supportsColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined
const paint = (code: string, text: string) => (supportsColor ? `\x1b[${code}m${text}\x1b[0m` : text)
const dim = (text: string) => paint('2', text)
const bold = (text: string) => paint('1', text)
const green = (text: string) => paint('32', text)
const red = (text: string) => paint('31', text)
const yellow = (text: string) => paint('33', text)
const blue = (text: string) => paint('34', text)

function help(): void {
  process.stdout.write(`${bold('agent-replay')} ${dim(`v${VERSION}`)}

Record a real coding-agent session from observable facts (git + workspace + commands),
then replay it in the browser.

${bold('USAGE')}
  agent-replay start [--name <name>] [--agent <name>] [--cwd <dir>]
  agent-replay stop [--cwd <dir>]
  agent-replay run -- <command...> [--cwd <dir>]
  agent-replay record <codex|cursor|claude|opencode|qoder|zcode> [--name <name>] -- "<prompt>"
  agent-replay record [--name <name>] [--adapter <id>] [--tty] -- <command...>
  agent-replay open [trace-name-or-path] [--port <port>]
  agent-replay list [--cwd <dir>]

${bold('EXAMPLES')}
  # Passive recording: start in one terminal, use your agent normally, stop here.
  agent-replay start --name codex-lru
  agent-replay stop

  # Native capture: the CLI builds the agent's structured-event command.
  agent-replay record cursor --name cursor-lru -- "fix the LRU cache bug"
  agent-replay record codex --name codex-lru -- "fix the LRU cache bug"
  agent-replay record claude --name claude-lru -- "fix the LRU cache bug"
  agent-replay record opencode --name opencode-lru -- "fix the LRU cache bug"
  agent-replay record qoder --name qoder-lru -- "fix the LRU cache bug"
  agent-replay record zcode --name zcode-lru -- "fix the LRU cache bug"

  # Stamp the run environment so a later regression can be explained.
  agent-replay record opencode --isolation xdg --provider opencode \
    --harness-version 2.0.32 -- "fix the LRU cache bug"

  # Wrap an existing command and force/auto-detect a native stream adapter.
  agent-replay record --adapter cursor -- node ./my-cursor-wrapper.mjs
  agent-replay record --name codex-lru -- codex exec --json "fix the LRU cache bug"

  # Capture a test command inside an active session.
  agent-replay run -- pytest -q

  # Open the result in the browser.
  agent-replay open codex-lru

${bold('NOTES')}
  - Recorder v1 observes the workspace only; it does not hook agent internals.
  - Requires a git worktree. Traces are written to ./replays/<name>.trace.json.
  - agent-replay open serves the built web app; run npm run build first.
  - A dirty worktree at start is supported, but the final patch may include
    pre-existing changes. Commit or stash first for the cleanest trace.
`)
}

function option(args: string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`))
  if (index === -1) return undefined
  const [entry] = args.splice(index, 1)
  if (entry.includes('=')) return entry.slice(name.length + 1)
  const value = args[index]
  if (value === undefined) throw new Error(`${name} requires a value.`)
  args.splice(index, 1)
  return value
}

function flag(args: string[], name: string): boolean {
  const index = args.indexOf(name)
  if (index === -1) return false
  args.splice(index, 1)
  return true
}

function parseIsolation(raw: string | undefined): 'none' | 'xdg' | 'host-config' | 'custom' | undefined {
  if (raw === undefined) return undefined
  if (raw === 'none' || raw === 'xdg' || raw === 'host-config' || raw === 'custom') return raw
  throw new Error('--isolation must be one of: none, xdg, host-config, custom.')
}

function resolveCwd(args: string[]): string {
  const raw = option(args, '--cwd') ?? process.cwd()
  const resolved = path.resolve(raw)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Working directory does not exist: ${resolved}`)
  }
  // macOS symlinks (/tmp -> /private/tmp) would otherwise split native agent
  // paths from git's realpath, so every edit looks unverified.
  try {
    return fs.realpathSync(resolved)
  } catch {
    return resolved
  }
}

function splitCommand(args: string[]): { command: string; args: string[]; display: string } {
  let after: string[] = []
  const separator = args.indexOf('--')
  if (separator >= 0) {
    after = args.slice(separator + 1)
    args.splice(separator)
  }
  if (after.length > 0) {
    return { command: after[0], args: after.slice(1), display: displayCommand(after[0], after.slice(1)) }
  }
  if (args.length === 1) {
    const display = args[0]
    return process.platform === 'win32'
      ? { command: 'cmd', args: ['/c', display], display }
      : { command: 'sh', args: ['-c', display], display }
  }
  if (args.length > 1) {
    return { command: args[0], args: args.slice(1), display: displayCommand(args[0], args.slice(1)) }
  }
  throw new Error('No command provided. Use `-- <command...>` or a quoted shell command.')
}

function printStart(meta: SessionMeta): void {
  const dirty = meta.initialStatus.split('\n').filter(Boolean).length
  process.stdout.write(`\n${green('●')} Recording ${bold(meta.name)}\n`)
  process.stdout.write(`  ${dim('workspace')} ${meta.repo ?? meta.repoRoot ?? meta.cwd}\n`)
  process.stdout.write(`  ${dim('base')}      ${meta.baseCommit ?? 'no commits yet'}\n`)
  process.stdout.write(
    `  ${dim('status')}    ${dirty === 0 ? 'clean worktree' : yellow(`${plural(dirty, 'pre-existing change')} (final patch may include them)`)}\n\n`,
  )
  process.stdout.write(`  Use your agent normally, then run ${bold('agent-replay stop')}.\n\n`)
}

function printStop(trace: Trace, tracePath: string, meta: SessionMeta): void {
  const edits = trace.spans.filter((span) => span.type === 'edit').length
  const tests = trace.spans.filter((span) => span.type === 'test').length
  const files = trace.result.filesChanged?.length ?? 0
  const statusColor = trace.status === 'pass' ? green : trace.status === 'fail' ? red : yellow
  process.stdout.write(`\n${statusColor('✓')} ${bold(meta.name)} · ${statusColor(trace.status.toUpperCase())}\n`)
  process.stdout.write(
    `  ${formatDuration(trace.durationMs)} · ${trace.spans.length} events · ${plural(tests, 'test run')} · ${plural(edits, 'edit')} · ${plural(files, 'file')} changed\n`,
  )
  process.stdout.write(`  Trace: ${path.relative(process.cwd(), tracePath)}\n`)
  process.stdout.write(`  Open:  ${blue(`agent-replay open ${path.basename(tracePath, '.trace.json')}`)}\n\n`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 0) {
    help()
    return
  }
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    help()
    return
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${VERSION}\n`)
    return
  }

  const command = argv.shift() as string

  if (command === 'start') {
    const cwd = resolveCwd(argv)
    const options: StartOptions = {
      cwd,
      name: option(argv, '--name'),
      agent: option(argv, '--agent'),
      model: option(argv, '--model'),
      outputDir: option(argv, '--out'),
    }
    const meta = startSession(options)
    printStart(meta)
    return
  }

  if (command === 'stop') {
    const cwd = resolveCwd(argv)
    const result = await stopSession(cwd)
    printStop(result.trace, result.path, result.meta)
    return
  }

  if (command === 'run') {
    const cwd = resolveCwd(argv)
    const child = splitCommand(argv)
    const exitCode = await runInSession({
      cwd,
      command: child.command,
      args: child.args,
      display: child.display,
    })
    process.exitCode = exitCode
    return
  }

  if (command === 'record') {
    const cwd = resolveCwd(argv)
    const name = option(argv, '--name')
    const agent = option(argv, '--agent')
    const model = option(argv, '--model')
    const outputDir = option(argv, '--out')
    const adapterOption = option(argv, '--adapter')
    const isolation = parseIsolation(option(argv, '--isolation'))
    const provider = option(argv, '--provider')
    const harnessVersion = option(argv, '--harness-version')
    const tty = flag(argv, '--tty')
    if (adapterOption && !isAgentId(adapterOption)) {
      throw new Error(`Unknown adapter "${adapterOption}". Use codex, cursor, claude, opencode, qoder, zcode, or generic.`)
    }

    let child: { command: string; args: string[]; display: string }
    let adapter = adapterOption && isAgentId(adapterOption) ? createAgentAdapter(adapterOption) : undefined

    const first = argv[0]
    if (first && (first === 'codex' || first === 'cursor' || first === 'claude' || first === 'opencode' || first === 'qoder' || first === 'zcode')) {
      argv.shift()
      const separator = argv.indexOf('--')
      const promptParts = separator >= 0 ? argv.slice(separator + 1) : argv
      const prompt = promptParts.join(' ').trim()
      if (!prompt) {
        throw new Error(`record ${first} requires a prompt, for example: agent-replay record ${first} -- "fix the bug"`)
      }
      adapter = createAgentAdapter(first)
      const built = adapter.buildCommand(prompt)
      child = {
        command: built.command,
        args: built.args,
        display: displayCommand(built.command, built.args),
      }
    } else {
      child = splitCommand(argv)
      adapter = adapter ?? detectAgentAdapter(child.command, child.args)
    }

    const exitCode = await recordSession({
      cwd,
      name,
      agent,
      model,
      outputDir,
      command: child.command,
      args: child.args,
      display: child.display,
      capture: !tty,
      adapter,
      isolation,
      provider,
      harnessVersion,
    })
    process.exitCode = exitCode
    return
  }

  if (command === 'open') {
    const cwd = resolveCwd(argv)
    const portRaw = option(argv, '--port')
    if (portRaw && !Number.isInteger(Number(portRaw))) throw new Error('--port must be a number.')
    const target = argv[0]
    const tracePath = findTrace(cwd, target)
    await openTrace({ tracePath, port: portRaw ? Number(portRaw) : undefined })
    return
  }

  if (command === 'list') {
    const cwd = resolveCwd(argv)
    const entries = listTraces(cwd)
    if (entries.length === 0) {
      process.stdout.write('No recorded traces yet. Try `agent-replay start` or `agent-replay record -- <command>`.\n')
      return
    }
    const statusColor = (status: string) =>
      status === 'pass' ? green(status.toUpperCase()) : status === 'fail' ? red(status.toUpperCase()) : yellow(status.toUpperCase())
    process.stdout.write(`\n${bold('REPLAYS')} ${dim(path.join(cwd, 'replays'))}\n\n`)
    for (const entry of entries) {
      process.stdout.write(
        `  ${statusColor(entry.status).padEnd(18)} ${entry.name}\n` +
          `  ${dim(`${formatDuration(entry.durationMs)} · ${entry.steps} steps · ${path.relative(cwd, entry.path)}`)}\n\n`,
      )
    }
    return
  }

  if (command === '__watch') {
    const cwd = resolveCwd(argv)
    watchSession(cwd)
    return
  }

  throw new Error(`Unknown command "${command}". Run \`agent-replay --help\`.`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`\n${red('error')} ${message}\n\n`)
  process.exitCode = 1
})
