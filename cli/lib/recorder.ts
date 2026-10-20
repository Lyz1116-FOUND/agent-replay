import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { traceSchema, type Trace } from '../../src/schema/trace.ts'
import { ZodError } from 'zod'
import { gitSnapshot, statusPorcelain } from './git.ts'
import {
  ensureDir,
  formatDuration,
  plural,
  sleep,
  truncate,
  writeJsonAtomic,
} from './fsutil.ts'
import {
  appendEvent,
  baselineFile,
  clearSession,
  createSessionMeta,
  eventsFile,
  logWatcher,
  readBaseline,
  readEvents,
  readSession,
  requestStop,
  stopRequested,
  writeBaseline,
  writeSession,
} from './session.ts'
import { captureBaseline, reconcileEdits, WorkspaceWatcher } from './workspace.ts'
import { buildTrace } from './traceBuilder.ts'
import { sanitizeTrace } from './sanitize.ts'
import { createOutputScanner, displayCommand, isTestCommand, parseTestOutput } from './testParser.ts'
import type { AgentEventRecord, CommandEvent, SessionMeta } from './types.ts'
import type { AgentEvent, AgentStreamAdapter } from '../adapters/types.ts'

export type StartOptions = {
  cwd: string
  name?: string
  agent?: string
  model?: string
  outputDir?: string
  isolation?: 'none' | 'xdg' | 'host-config' | 'custom'
  provider?: string
  harnessVersion?: string
}

/** `provider/model` strings name the provider; bare model names do not. */
function providerFromModel(model: string | undefined): string | undefined {
  if (!model) return undefined
  const [head, ...rest] = model.split('/')
  return rest.length > 0 && head ? head : undefined
}

function agentFromCommand(command: string | undefined, fallback: string): string {
  if (!command) return fallback
  const executable = path.basename(command.split(/\s+/)[0] ?? '').toLowerCase()
  if (executable.includes('codex')) return 'Codex'
  if (executable.includes('claude')) return 'Claude Code'
  if (executable.includes('cursor')) return 'Cursor'
  if (executable.includes('aider')) return 'Aider'
  if (executable.includes('gemini')) return 'Gemini CLI'
  return fallback
}

export function resolveAgent(command: string | undefined, explicit?: string): string {
  return explicit?.trim() || agentFromCommand(command, 'Recorded session')
}

function beginSession(options: StartOptions, command?: string): { meta: SessionMeta; baseline: ReturnType<typeof captureBaseline> } {
  const existing = readSession(options.cwd)
  if (existing) {
    throw new Error(
      `A recording is already active (${existing.name}). Run \`agent-replay stop\` before starting another session.`,
    )
  }
  const meta = createSessionMeta({
    cwd: options.cwd,
    name: options.name,
    agent: resolveAgent(command, options.agent),
    model: options.model,
    command,
    outputDir: options.outputDir,
    isolation: options.isolation,
    provider: options.provider ?? providerFromModel(options.model),
    harnessVersion: options.harnessVersion,
  })
  const root = meta.repoRoot ?? meta.cwd
  const status = statusPorcelain(root)
  const baseline = captureBaseline(meta, status.files)
  fs.rmSync(eventsFile(options.cwd), { force: true })
  ensureDir(path.dirname(meta.tracePath))
  writeBaseline(options.cwd, baseline)
  writeSession(options.cwd, meta)
  return { meta, baseline }
}

function adapterEnvironment(adapter?: AgentStreamAdapter): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(adapter?.env ?? {})) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}

function watcherEntrypoint(): string {
  const entry = process.argv[1]
  if (!entry) throw new Error('Cannot find the CLI entrypoint to start the workspace watcher.')
  return entry
}

export function startWatcher(meta: SessionMeta): number | undefined {
  try {
    const child = spawn(
      process.execPath,
      [watcherEntrypoint(), '__watch', '--cwd', meta.cwd],
      {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    )
    child.unref()
    return child.pid
  } catch {
    return undefined
  }
}

export function startSession(options: StartOptions): SessionMeta {
  const { meta } = beginSession(options)
  const pid = startWatcher(meta)
  const next = { ...meta, watcherPid: pid }
  writeSession(options.cwd, next)
  return next
}

export function watchSession(cwd: string): void {
  const meta = readSession(cwd)
  if (!meta) {
    console.error('No active recording found.')
    process.exit(1)
  }
  const baseline = readBaseline(cwd)
  const watcher = new WorkspaceWatcher(cwd, meta, baseline, () => {
    // Events are persisted by the watcher itself.
  })
  watcher.start()
  logWatcher(cwd, `watcher started for ${meta.name}`)

  let stopping = false
  function shutdown(): void {
    if (stopping) return
    stopping = true
    watcher.stop()
    logWatcher(cwd, 'watcher stopped')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  const timer = setInterval(() => {
    if (stopRequested(cwd) || !readSession(cwd)) {
      clearInterval(timer)
      shutdown()
    }
  }, 250)
}

function readTraceSource(cwd: string): { meta: SessionMeta; events: ReturnType<typeof readEvents>; baseline: ReturnType<typeof readBaseline> } {
  const meta = readSession(cwd)
  if (!meta) throw new Error('No active recording found. Nothing to stop.')
  return { meta, events: readEvents(cwd), baseline: readBaseline(cwd) }
}

function validateAndWrite(trace: Trace, meta: SessionMeta): void {
  // Sanitize before validating so the file on disk is the sanitized one.
  const clean = sanitizeTrace(trace)
  try {
    traceSchema.parse(clean)
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      throw new Error(`Recorded trace failed schema validation:\n${issues.join('\n')}`)
    }
    throw error
  }
  ensureDir(path.dirname(meta.tracePath))
  writeJsonAtomic(meta.tracePath, clean)
}

export async function stopSession(cwd: string): Promise<{ trace: Trace; path: string; meta: SessionMeta }> {
  const meta = readSession(cwd)
  if (!meta) throw new Error('No active recording found. Nothing to stop.')
  requestStop(cwd)

  if (meta.watcherPid) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        process.kill(meta.watcherPid, 0)
      } catch {
        break
      }
      await sleep(200)
    }
    try {
      process.kill(meta.watcherPid, 0)
      process.kill(meta.watcherPid, 'SIGTERM')
    } catch {
      // Already gone.
    }
    await sleep(200)
  }

  const initial = readTraceSource(cwd)
  const added = reconcileEdits(cwd, initial.meta, initial.baseline, initial.events)
  if (added > 0) logWatcher(cwd, `reconciled ${added} missed edit(s)`)
  const events = readEvents(cwd)
  const git = gitSnapshot(meta.repoRoot ?? meta.cwd)
  const trace = buildTrace({
    meta,
    events,
    baseline: initial.baseline,
    git,
    nowMs: Date.now(),
  })
  validateAndWrite(trace, meta)
  clearSession(cwd)
  return { trace: sanitizeTrace(trace), path: meta.tracePath, meta }
}

export async function recordSession(options: StartOptions & {
  command: string
  args: string[]
  capture: boolean
  display?: string
  adapter?: AgentStreamAdapter
}): Promise<number> {
  if (options.adapter && !options.capture) {
    throw new Error('Native capture requires piped stdout. Remove --tty.')
  }
  const display = options.display ?? displayCommand(options.command, options.args)
  const sessionOptions: StartOptions = {
    ...options,
    agent: options.agent ?? options.adapter?.name,
  }
  const { meta } = beginSession(sessionOptions, display)
  const baseline = readBaseline(options.cwd)
  const watcher = new WorkspaceWatcher(options.cwd, meta, baseline, () => {})
  watcher.start()
  let nativeBuffer = ''
  let nativeCount = 0

  const scanner = options.capture && !options.adapter
    ? createOutputScanner((outcome, output) => {
        const now = Date.now()
        const elapsed = now - meta.startedAtMs
        const event: CommandEvent = {
          kind: 'command',
          atMs: Math.max(0, elapsed - 650),
          endMs: elapsed,
          command: `detected: ${outcome.framework}`,
          displayCommand: `${outcome.framework} (detected)`,
          cwd: meta.cwd,
          exitCode: outcome.failed > 0 ? 1 : 0,
          stdout: truncate(output, 120_000).text,
          stderr: '',
          spanType: 'test',
          test: outcome,
          detectedFromOutput: true,
        }
        appendEvent(options.cwd, event)
        process.stderr.write(
          `\x1b[2m· detected ${outcome.framework}: ${outcome.passed} passed, ${outcome.failed} failed\x1b[0m\n`,
        )
      })
    : null

  function recordNativeLine(line: string): void {
    if (!options.adapter || !line.trim()) return
    const events = options.adapter.parseLine(line, Math.max(0, Date.now() - meta.startedAtMs))
    for (const event of events) {
      const record: AgentEventRecord = { kind: 'agent', event }
      appendEvent(options.cwd, record)
      nativeCount += 1
      logNativeEvent(event)
    }
  }

  function recordNativeChunk(chunk: string): void {
    nativeBuffer += chunk
    const lines = nativeBuffer.split('\n')
    nativeBuffer = lines.pop() ?? ''
    for (const line of lines) recordNativeLine(line)
  }

  const child = spawn(options.command, options.args, {
    cwd: meta.cwd,
    env: {
      ...adapterEnvironment(options.adapter),
      // Some agents resolve their workspace from $PWD instead of the real cwd.
      // A spawn that changes cwd does not update PWD, so set it explicitly.
      PWD: meta.cwd,
      FORCE_COLOR: process.env.FORCE_COLOR ?? (process.stdout.isTTY ? '1' : '0'),
    },
    stdio: options.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  })

  let exitCode = 0
  let interrupted = false
  const forwardInterrupt = () => {
    interrupted = true
    child.kill('SIGINT')
  }
  process.on('SIGINT', forwardInterrupt)
  process.on('SIGTERM', forwardInterrupt)

  if (options.capture && child.stdout && child.stderr) {
    child.stdout.on('data', (chunk: Buffer) => {
      if (options.adapter) {
        recordNativeChunk(chunk.toString('utf8'))
      } else {
        process.stdout.write(chunk)
        scanner?.push(chunk.toString('utf8'))
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      if (!options.adapter) scanner?.push(chunk.toString('utf8'))
    })
  }

  await new Promise<void>((resolve) => {
    child.on('error', (error) => {
      process.stderr.write(`Could not start command: ${error.message}\n`)
      exitCode = 127
      resolve()
    })
    child.on('close', (code) => {
      exitCode = code ?? (interrupted ? 130 : 1)
      resolve()
    })
  })

  process.off('SIGINT', forwardInterrupt)
  process.off('SIGTERM', forwardInterrupt)
  if (options.adapter) {
    if (nativeBuffer.trim()) recordNativeLine(nativeBuffer)
    nativeBuffer = ''
    for (const event of options.adapter.finalize?.() ?? []) {
      appendEvent(options.cwd, { kind: 'agent', event })
      nativeCount += 1
      logNativeEvent(event)
    }
    if (nativeCount === 0) {
      process.stderr.write(
        '\x1b[33mwarning: no native events were parsed. Check the CLI flags and output format.\x1b[0m\n',
      )
    }
  }
  scanner?.flush()
  watcher.stop()
  await sleep(120)

  const initial = readTraceSource(options.cwd)
  reconcileEdits(options.cwd, initial.meta, initial.baseline, initial.events)
  const events = readEvents(options.cwd)
  const agentEvents = events
    .filter((event): event is AgentEventRecord => event.kind === 'agent')
    .map((event) => event.event)
  const git = gitSnapshot(meta.repoRoot ?? meta.cwd)
  const trace = buildTrace({
    meta,
    events,
    agentEvents,
    adapter: options.adapter ? { id: options.adapter.id, name: options.adapter.name } : undefined,
    wrappedOutput: options.capture && !options.adapter,
    baseline: initial.baseline,
    git,
    commandExitCode: exitCode,
    nowMs: Date.now(),
  })
  validateAndWrite(trace, meta)
  clearSession(options.cwd)
  printRecordSummary(trace, meta.tracePath)
  return exitCode
}

function logNativeEvent(event: AgentEvent): void {
  if (event.kind === 'tool.completed') {
    const duration =
      event.startedAtMs !== undefined
        ? formatDuration(Math.max(0, event.atMs - event.startedAtMs))
        : ''
    const detail = event.test
      ? `${event.test.passed} passed · ${event.test.failed} failed`
      : event.status === 'error'
        ? 'error'
        : ''
    process.stderr.write(
      `\x1b[2m· ${event.name}${duration ? ` · ${duration}` : ''}${detail ? ` · ${detail}` : ''}\x1b[0m\n`,
    )
  } else if (event.kind === 'final' && event.text) {
    process.stderr.write(`\x1b[2m· final: ${event.text.split('\n')[0].slice(0, 120)}\x1b[0m\n`)
  } else if (event.kind === 'error') {
    process.stderr.write(`\x1b[31m· agent error: ${event.message.slice(0, 160)}\x1b[0m\n`)
  }
}

export async function runInSession(options: {
  cwd: string
  command: string
  args: string[]
  display?: string
}): Promise<number> {
  const meta = readSession(options.cwd)
  if (!meta) {
    throw new Error(
      'No active recording. Start one with `agent-replay start`, or use `agent-replay record -- <command>`.',
    )
  }
  const display = options.display ?? displayCommand(options.command, options.args)
  const testCommand = isTestCommand(display)
  const started = Date.now()
  const child = spawn(options.command, options.args, {
    cwd: meta.cwd,
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR ?? (process.stdout.isTTY ? '1' : '0'),
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    stdout = `${stdout}${text}`.slice(-200_000)
    process.stdout.write(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    stderr = `${stderr}${text}`.slice(-200_000)
    process.stderr.write(chunk)
  })

  const exitCode = await new Promise<number>((resolve) => {
    child.on('error', (error) => {
      stderr += `\n${error.message}`
      resolve(127)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })

  const ended = Date.now()
  const test = testCommand ? parseTestOutput(`${stdout}\n${stderr}`) ?? undefined : undefined
  const event: CommandEvent = {
    kind: 'command',
    atMs: Math.max(0, started - meta.startedAtMs),
    endMs: Math.max(1, ended - meta.startedAtMs),
    command: display,
    displayCommand: display,
    cwd: meta.cwd,
    exitCode,
    stdout: truncate(stdout, 120_000).text,
    stderr: truncate(stderr, 120_000).text,
    spanType: testCommand ? 'test' : 'shell',
    test,
    detectedFromOutput: false,
  }
  appendEvent(options.cwd, event)

  if (test) {
    process.stderr.write(
      `\x1b[2m· recorded ${plural(test.total, 'test')}: ${test.passed} passed, ${test.failed} failed\x1b[0m\n`,
    )
  } else {
    process.stderr.write(`\x1b[2m· recorded command (exit ${exitCode})\x1b[0m\n`)
  }
  return exitCode
}

function printRecordSummary(trace: Trace, tracePath: string): void {
  const edits = trace.spans.filter((span) => span.type === 'edit').length
  const tests = trace.spans.filter((span) => span.type === 'test').length
  const events = trace.spans.filter(
    (span) => span.type !== 'checkpoint' && span.type !== 'final',
  ).length
  const files = trace.result.filesChanged?.length ?? 0
  const capture = trace.capture
  const fidelity = capture
    ? capture.fidelity === 'native+workspace'
      ? 'NATIVE + WORKSPACE'
      : capture.fidelity === 'native-events'
        ? 'NATIVE EVENTS'
        : capture.fidelity === 'wrapped-output'
          ? 'WRAPPED OUTPUT'
          : 'WORKSPACE ONLY'
    : 'RECORDED'
  process.stdout.write(
    `\n✓ ${trace.status.toUpperCase()}  ${formatDuration(trace.durationMs)} · ${fidelity} · ${capture?.timing ?? 'observed'} timing\n`,
  )
  process.stdout.write(
    `  ${events} events · ${plural(tests, 'test run')} · ${plural(edits, 'edit')} · ${plural(files, 'file')} changed\n`,
  )
  if (capture && (capture.workspaceVerified || capture.unverifiedEdits)) {
    process.stdout.write(
      `  ${capture.workspaceVerified ?? 0} edits verified against workspace · ${capture.unverifiedEdits ?? 0} unverified\n`,
    )
  }
  process.stdout.write(`  Replay: ${path.relative(process.cwd(), tracePath)}\n`)
  process.stdout.write(`  Open:   agent-replay open ${path.basename(tracePath, '.trace.json')}\n`)
}

export { readSession, readEvents, readBaseline, eventsFile, baselineFile }
