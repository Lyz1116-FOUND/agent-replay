import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Trace } from '../../src/schema/trace.ts'
import { parseTestOutput } from '../lib/testParser.ts'
import { resolveTaskResult, resolveTermination, type EndReason, type VerifyResult } from './outcome.ts'
import type { CaptureIntegritySummary, RunRecord, ValidationTask } from './types.ts'
import type { ValidationAgent } from './agents.ts'

// The bundle lives in dist-cli/, so resolve from the working directory (the
// harness is always launched from the repo root) with an explicit override.
export const REPO_ROOT = path.resolve(process.env.AGENT_REPLAY_ROOT ?? process.cwd())

export function loadTasks(tasksDir: string, only: string[] = []): ValidationTask[] {
  const tasks: ValidationTask[] = []
  for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const metaPath = path.join(tasksDir, entry.name, 'task.json')
    if (!existsSync(metaPath)) continue
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Omit<ValidationTask, 'dir'>
    if (only.length > 0 && !only.includes(meta.id)) continue
    tasks.push({ ...meta, dir: path.join(tasksDir, entry.name) })
  }
  return tasks.sort((a, b) => a.id.localeCompare(b.id))
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

/**
 * A run must start from the same bytes every time: copy only the task's own
 * files, commit them, and refuse to continue if anything is left over.
 */
export function prepareRepo(task: ValidationTask, dest: string): void {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(task.dir, dest, {
    recursive: true,
    filter: (source) => {
      const base = path.basename(source)
      return base !== 'task.json' && base !== 'reference'
    },
  })
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'dev@example.com'],
    ['config', 'user.name', 'Dev'],
    ['add', '.'],
    ['commit', '-qm', 'initial'],
  ]) {
    const result = git(dest, args)
    if (!result.ok) throw new Error(`git ${args.join(' ')} failed in ${dest}: ${result.out}`)
  }
  const status = git(dest, ['status', '--porcelain'])
  if (status.out) throw new Error(`task ${task.id} left untracked state: ${status.out}`)
}

function runVerify(cwd: string, command: string): { ok: boolean; output: string } {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: 120_000 })
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

/**
 * The trusted verdict: run the task's own command in the final worktree and
 * read the result from that output. Agent-reported tests never decide this.
 */
export function trustedVerify(cwd: string, task: ValidationTask): VerifyResult | null {
  if (!existsSync(cwd)) return null
  const result = runVerify(cwd, task.verify)
  const parsed = parseTestOutput(result.output)
  if (!parsed) {
    return { command: task.verify, exitCode: result.ok ? 0 : 1, passed: 0, failed: 0, total: 0 }
  }
  return {
    command: task.verify,
    exitCode: result.ok ? 0 : 1,
    passed: parsed.passed,
    failed: parsed.failed,
    total: parsed.total,
  }
}

export type TaskCheck = { id: string; baselineFails: boolean; referencePasses: boolean; detail?: string }

/**
 * Proves the task is worth running: the baseline must fail and the reference
 * fix must go fully green. A task that passes at baseline measures nothing.
 */
export function verifyTask(task: ValidationTask, workRoot: string): TaskCheck {
  const baselineDir = path.join(workRoot, 'check-baseline', task.id)
  prepareRepo(task, baselineDir)
  const baseline = runVerify(baselineDir, task.verify)

  const referenceDir = path.join(workRoot, 'check-reference', task.id)
  prepareRepo(task, referenceDir)
  const referenceSource = path.join(task.dir, 'reference')
  if (!existsSync(referenceSource)) {
    return {
      id: task.id,
      baselineFails: !baseline.ok,
      referencePasses: false,
      detail: 'no reference/ directory',
    }
  }
  cpSync(referenceSource, referenceDir, { recursive: true })
  const reference = runVerify(referenceDir, task.verify)

  return {
    id: task.id,
    baselineFails: !baseline.ok,
    referencePasses: reference.ok,
    detail: reference.ok ? undefined : reference.output.slice(-400),
  }
}

function integrityOf(trace: Trace): CaptureIntegritySummary | null {
  const integrity = trace.capture?.integrity
  if (!integrity) return null
  return {
    nativeEditEvents: integrity.nativeEdits,
    workspaceEditEvents: integrity.workspaceEdits,
    matchedEdits: integrity.matchedEdits,
    confirmedEdits: integrity.confirmedEdits ?? integrity.matchedEdits,
    supersededEdits: integrity.supersededEdits ?? 0,
    unverifiedEdits: integrity.unverifiedEdits,
    outsideWorkspaceEdits: integrity.outsideWorkspaceEdits,
    nativeTestRuns: integrity.nativeTestRuns,
    capturedTestRuns: integrity.capturedTests,
  }
}

/** Isolation dirs outlive a run unless they are removed; they hold no results. */
export function cleanupIsolation(dir: string | undefined): void {
  if (!dir) return
  rmSync(dir, { recursive: true, force: true })
}

export type RunOptions = {
  task: ValidationTask
  agent: ValidationAgent
  run: number
  workRoot: string
  recorder: string
  timeoutMs: number
  env?: Record<string, string>
}

export function runTask(options: RunOptions): RunRecord {
  const { task, agent, run } = options
  const repo = path.join(options.workRoot, 'runs', `${task.id}--${agent.id}--${run}`)
  prepareRepo(task, repo)

  const name = `${task.id}-${agent.id}-${run}`
  const built = agent.buildCommand(task.prompt)
  const env: Record<string, string> = {
    ...process.env,
    ...options.env,
    PWD: repo,
    FORCE_COLOR: '0',
  }
  if (agent.pathPrefix) env.PATH = `${agent.pathPrefix}:${env.PATH ?? ''}`
  let isoDir: string | undefined
  if (agent.isolate) {
    const iso = path.join(options.workRoot, 'iso', `${task.id}--${agent.id}--${run}`)
    isoDir = iso
    for (const [key, sub] of [
      ['XDG_DATA_HOME', 'data'],
      ['XDG_CONFIG_HOME', 'config'],
      ['XDG_STATE_HOME', 'state'],
      ['XDG_CACHE_HOME', 'cache'],
    ] as const) {
      mkdirSync(path.join(iso, sub), { recursive: true })
      env[key] = path.join(iso, sub)
    }
  }

  const started = Date.now()
  const result = spawnSync(
    process.execPath,
    [
      options.recorder, 'record',
      '--adapter', agent.id,
      '--name', name,
      '--provider', agent.provider,
      ...(agent.harnessVersion ? ['--harness-version', agent.harnessVersion] : []),
      '--isolation', agent.isolate ? 'xdg' : 'none',
      '--',
      built.command, ...built.args,
    ],
    { cwd: repo, env, encoding: 'utf8', timeout: options.timeoutMs, maxBuffer: 32 * 1024 * 1024 },
  )
  const elapsedMs = Date.now() - started
  const timedOut = result.error !== undefined && /ETIMEDOUT|timed out/i.test(String(result.error.message))
  const end: EndReason = {
    exitCode: result.status,
    signal: result.signal ?? null,
    timedOut,
    spawnError: result.error && !timedOut ? result.error.message : undefined,
  }

  const tracePath = path.join(repo, 'replays', `${name}.trace.json`)
  let trace: Trace | null = null
  if (existsSync(tracePath)) trace = JSON.parse(readFileSync(tracePath, 'utf8')) as Trace

  // Judge the task in the final worktree, after the agent stopped touching it.
  const verify = trustedVerify(repo, task)

  const record: RunRecord = {
    task: task.id,
    taskKind: task.kind,
    agent: agent.id,
    run,
    attempt: 1,
    timedOut,
    elapsedMs,
    exit: result.status,
    taskResult: resolveTaskResult(verify),
    termination: resolveTermination(trace?.termination, end),
    verify,
    end,
    integrity: trace ? integrityOf(trace) : null,
    filesChanged: trace?.result.filesChanged ?? [],
    recovery: (trace?.metadata?.recoveryDetected as boolean | undefined) ?? null,
    fidelity: trace?.capture?.fidelity ?? null,
    environment: (trace?.environment as Record<string, unknown> | undefined) ?? null,
    trace: null,
  }

  if (trace) {
    const tracesDir = path.join(REPO_ROOT, 'examples', 'validation', 'traces')
    mkdirSync(tracesDir, { recursive: true })
    const dest = path.join(tracesDir, `${name}.trace.json`)
    writeFileSync(dest, JSON.stringify(trace, null, 2))
    record.trace = path.relative(REPO_ROOT, dest)
  }

  rmSync(repo, { recursive: true, force: true })
  cleanupIsolation(isoDir)
  return record
}
