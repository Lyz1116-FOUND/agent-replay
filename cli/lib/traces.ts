import fs from 'node:fs'
import path from 'node:path'
import { pathExists } from './fsutil.ts'

export type TraceEntry = {
  path: string
  name: string
  status: string
  durationMs: number
  steps: number
  mtimeMs: number
}

function replaysDir(cwd: string): string {
  return path.join(cwd, 'replays')
}

export function listTraces(cwd: string): TraceEntry[] {
  const directory = replaysDir(cwd)
  if (!pathExists(directory)) return []
  const entries: TraceEntry[] = []
  for (const file of fs.readdirSync(directory)) {
    if (!file.endsWith('.trace.json')) continue
    const filePath = path.join(directory, file)
    try {
      const stat = fs.statSync(filePath)
      const trace = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        task?: { title?: string }
        status?: string
        durationMs?: number
        spans?: unknown[]
      }
      entries.push({
        path: filePath,
        name: trace.task?.title ?? file.replace(/\.trace\.json$/, ''),
        status: trace.status ?? 'unknown',
        durationMs: trace.durationMs ?? 0,
        steps: trace.spans?.length ?? 0,
        mtimeMs: stat.mtimeMs,
      })
    } catch {
      // Ignore unreadable or invalid traces in the list.
    }
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function findTrace(cwd: string, target?: string): string {
  if (target) {
    const candidates: string[] = []
    if (path.isAbsolute(target) || target.includes('/') || target.includes(path.sep)) {
      candidates.push(path.resolve(cwd, target))
    } else {
      candidates.push(path.join(replaysDir(cwd), target))
      candidates.push(path.join(replaysDir(cwd), `${target}.trace.json`))
      candidates.push(path.resolve(cwd, target))
    }
    for (const candidate of candidates) {
      if (pathExists(candidate)) return candidate
    }
    throw new Error(
      `Could not find trace "${target}". Try \`agent-replay list\` or pass a path to a .trace.json file.`,
    )
  }

  const entries = listTraces(cwd)
  if (entries.length === 0) {
    throw new Error('No recorded traces found. Run `agent-replay start` or `agent-replay record -- <command>` first.')
  }
  return entries[0].path
}
