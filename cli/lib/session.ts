import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  ensureDir,
  pathExists,
  readJson,
  readJsonLines,
  slugify,
  timeStampName,
  writeJsonAtomic,
  appendJsonLine,
} from './fsutil'
import { headCommit, repoName, repoRoot, statusShort } from './git'
import type { Baseline, SessionEvent, SessionMeta } from './types'

export const STATE_DIR = '.agent-replay'

export function stateDir(cwd: string): string {
  return path.join(cwd, STATE_DIR)
}

export function sessionDir(cwd: string): string {
  return path.join(stateDir(cwd), 'session')
}

export function sessionFile(cwd: string): string {
  return path.join(sessionDir(cwd), 'session.json')
}

export function eventsFile(cwd: string): string {
  return path.join(sessionDir(cwd), 'events.jsonl')
}

export function baselineFile(cwd: string): string {
  return path.join(sessionDir(cwd), 'baseline.json')
}

export function stopFlagFile(cwd: string): string {
  return path.join(sessionDir(cwd), 'stop')
}

export function watcherLogFile(cwd: string): string {
  return path.join(sessionDir(cwd), 'watcher.log')
}

export function readSession(cwd: string): SessionMeta | null {
  const meta = readJson<SessionMeta>(sessionFile(cwd))
  return meta?.version === 1 ? meta : null
}

export function writeSession(cwd: string, meta: SessionMeta): void {
  ensureDir(sessionDir(cwd))
  writeJsonAtomic(sessionFile(cwd), meta)
}

export function appendEvent(cwd: string, event: SessionEvent): void {
  appendJsonLine(eventsFile(cwd), event)
}

export function readEvents(cwd: string): SessionEvent[] {
  return readJsonLines<SessionEvent>(eventsFile(cwd))
}

export function writeBaseline(cwd: string, baseline: Baseline): void {
  writeJsonAtomic(baselineFile(cwd), baseline)
}

export function readBaseline(cwd: string): Baseline {
  const baseline = readJson<Baseline>(baselineFile(cwd))
  return baseline?.contents ? baseline : { contents: {} }
}

export function clearSession(cwd: string): void {
  fs.rmSync(sessionDir(cwd), { recursive: true, force: true })
}

export function requestStop(cwd: string): void {
  ensureDir(sessionDir(cwd))
  fs.writeFileSync(stopFlagFile(cwd), 'stop\n', 'utf8')
}

export function stopRequested(cwd: string): boolean {
  return pathExists(stopFlagFile(cwd))
}

export function logWatcher(cwd: string, message: string): void {
  try {
    const line = `${new Date().toISOString()} ${message}\n`
    fs.appendFileSync(watcherLogFile(cwd), line, 'utf8')
  } catch {
    // Logging must never take the watcher down.
  }
}

export function uniqueTracePath(cwd: string, outputDir: string, name: string): string {
  const directory = path.resolve(cwd, outputDir)
  ensureDir(directory)
  const base = slugify(name)
  let candidate = path.join(directory, `${base}.trace.json`)
  let counter = 2
  while (pathExists(candidate)) {
    candidate = path.join(directory, `${base}-${counter}.trace.json`)
    counter += 1
  }
  return candidate
}

export function createSessionMeta(options: {
  cwd: string
  name?: string
  agent: string
  model?: string
  command?: string
  outputDir?: string
  isolation?: 'xdg' | 'host-config' | 'none'
  provider?: string
  harnessVersion?: string
}): SessionMeta {
  const root = repoRoot(options.cwd)
  if (!root) {
    throw new Error(
      'Agent Replay recorder needs a git worktree. Run `git init` (or open an existing repository) first.',
    )
  }
  const defaultName = `${path.basename(root)}-${timeStampName()}`
  const name = options.name?.trim() || defaultName
  const outputDir = options.outputDir?.trim() || 'replays'
  const now = new Date()
  return {
    version: 1,
    id: `rec_${now.getTime().toString(36)}_${randomBytes(3).toString('hex')}`,
    name,
    cwd: options.cwd,
    repoRoot: root,
    repo: repoName(root),
    baseCommit: headCommit(root),
    initialStatus: statusShort(root),
    startedAt: now.toISOString(),
    startedAtMs: now.getTime(),
    agent: options.agent,
    model: options.model,
    command: options.command,
    outputDir,
    tracePath: uniqueTracePath(options.cwd, outputDir, name),
    isolation: options.isolation,
    provider: options.provider,
    harnessVersion: options.harnessVersion,
  }
}
