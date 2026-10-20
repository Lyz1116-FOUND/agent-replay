import path from 'node:path'
import type { SessionEvent, SessionMeta, Baseline, EditEvent, EditOperation } from './types'
import { fileAtHead, statusPorcelain } from './git'
import {
  hashText,
  isIgnoredPath,
  pathExists,
  readTextFile,
  truncate,
  MAX_FILE_BYTES,
} from './fsutil'
import { appendEvent, logWatcher } from './session'

function workRoot(meta: SessionMeta): string {
  return meta.repoRoot ?? meta.cwd
}

function readContent(root: string, relativePath: string): string | null {
  const file = path.join(root, relativePath)
  if (!pathExists(file)) return null
  const read = readTextFile(file, MAX_FILE_BYTES)
  return read ? read.content : null
}

function operationFor(before: string, after: string, rename: boolean): EditOperation {
  if (rename) return 'rename'
  if (!before && after) return 'create'
  if (before && !after) return 'delete'
  return 'modify'
}

export function captureBaseline(meta: SessionMeta, files: string[]): Baseline {
  const root = workRoot(meta)
  const contents: Record<string, string> = {}
  for (const file of files) {
    if (isIgnoredPath(file)) continue
    const content = readContent(root, file)
    if (content !== null) contents[file] = content
  }
  return { contents }
}

export class WorkspaceWatcher {
  private readonly root: string
  private readonly lastHashes = new Map<string, string>()
  private readonly contents = new Map<string, string>()
  private readonly baselineCache = new Map<string, string>()
  private readonly tracked = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private scanning = false
  private batch = 0

  constructor(
    private readonly cwd: string,
    private readonly meta: SessionMeta,
    baseline: Baseline,
    private readonly onEdit: (event: EditEvent) => void,
  ) {
    this.root = workRoot(meta)
    for (const [file, content] of Object.entries(baseline.contents)) {
      this.lastHashes.set(file, hashText(content))
      this.contents.set(file, content)
      this.baselineCache.set(file, content)
      this.tracked.add(file)
    }
  }

  baseContent(file: string): string {
    if (this.baselineCache.has(file)) return this.baselineCache.get(file) ?? ''
    const content = fileAtHead(this.root, file)
    this.baselineCache.set(file, content)
    return content
  }

  scan(): number {
    if (this.scanning) return 0
    this.scanning = true
    let emitted = 0
    try {
      const status = statusPorcelain(this.root)
      const changed = new Set(status.files)
      const renameByTo = new Map(
        status.renames
          .filter((rename) => rename.kind === 'rename')
          .map((rename) => [rename.to, rename.from]),
      )
      const renamedOld = new Set([...renameByTo.values()])
      const candidates = new Set<string>([...status.files, ...this.tracked])
      const now = Date.now()
      this.batch += 1
      const batchId = `${now}-${this.batch}`

      for (const file of candidates) {
        if (isIgnoredPath(file)) continue
        if (renamedOld.has(file) && !renameByTo.has(file)) {
          // The rename target produces a single rename event.
          this.tracked.delete(file)
          continue
        }
        const filePath = path.join(this.root, file)
        const exists = pathExists(filePath)
        const read = exists ? readTextFile(filePath, MAX_FILE_BYTES) : null
        if (exists && !read) {
          this.tracked.delete(file)
          continue
        }
        const content = read?.content ?? ''
        const hash = hashText(content)
        const previousHash = this.lastHashes.get(file)
        if (previousHash === hash) {
          if (!changed.has(file) && content === this.baseContent(file)) {
            this.tracked.delete(file)
          }
          continue
        }

        const fromPath = renameByTo.get(file)
        const before = fromPath
          ? this.contents.get(fromPath) ??
            this.baseContent(fromPath) ??
            this.baseContent(file)
          : this.contents.get(file) ?? this.baseContent(file)
        const beforeHash = hashText(before)
        if (beforeHash === hash) {
          this.lastHashes.set(file, hash)
          this.contents.set(file, content)
          if (fromPath) this.tracked.delete(fromPath)
          continue
        }

        if (!changed.has(file) && content === this.baseContent(file) && !fromPath) {
          this.lastHashes.set(file, hash)
          this.contents.set(file, content)
          this.tracked.delete(file)
          continue
        }

        const beforeLimited = truncate(before, MAX_FILE_BYTES)
        const afterLimited = truncate(content, MAX_FILE_BYTES)
        const event: EditEvent = {
          kind: 'edit',
          atMs: now - this.meta.startedAtMs,
          batch: batchId,
          path: file,
          fromPath,
          operation: operationFor(before, content, Boolean(fromPath)),
          before: beforeLimited.text,
          after: afterLimited.text,
          hashBefore: beforeHash,
          hashAfter: hash,
          truncated: beforeLimited.truncated || afterLimited.truncated || Boolean(read?.truncated),
        }
        appendEvent(this.cwd, event)
        this.onEdit(event)
        this.lastHashes.set(file, hash)
        this.contents.set(file, content)
        this.tracked.add(file)
        if (fromPath) {
          this.tracked.delete(fromPath)
          this.lastHashes.delete(fromPath)
        }
        emitted += 1
      }
    } catch (error) {
      logWatcher(this.cwd, `scan failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.scanning = false
    }
    return emitted
  }

  start(intervalMs = 650): void {
    this.scan()
    this.timer = setInterval(() => {
      this.scan()
    }, intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.scan()
  }
}

export function reconcileEdits(
  cwd: string,
  meta: SessionMeta,
  baseline: Baseline,
  events: SessionEvent[],
): number {
  const root = workRoot(meta)
  const latest = new Map<string, EditEvent>()
  for (const event of events) {
    if (event.kind !== 'edit') continue
    const previous = latest.get(event.path)
    if (!previous || previous.atMs <= event.atMs) latest.set(event.path, event)
  }

  const status = statusPorcelain(root)
  const handled = new Set<string>()
  let added = 0
  const now = Date.now()

  function emit(event: EditEvent): void {
    appendEvent(cwd, event)
    latest.set(event.path, event)
    added += 1
  }

  for (const rename of status.renames.filter((item) => item.kind === 'rename')) {
    if (isIgnoredPath(rename.to) || isIgnoredPath(rename.from)) continue
    const content = readContent(root, rename.to)
    if (content === null) continue
    const previous = latest.get(rename.to)
    const previousFrom = latest.get(rename.from)
    if (previous?.after === content) {
      handled.add(rename.to)
      handled.add(rename.from)
      continue
    }
    const expected =
      previousFrom?.after ?? baseline.contents[rename.from] ?? fileAtHead(root, rename.from)
    if (expected === content) {
      handled.add(rename.to)
      handled.add(rename.from)
      continue
    }
    const beforeLimited = truncate(expected, MAX_FILE_BYTES)
    const afterLimited = truncate(content, MAX_FILE_BYTES)
    emit({
      kind: 'edit',
      atMs: now - meta.startedAtMs,
      batch: `reconcile-${now}`,
      path: rename.to,
      fromPath: rename.from,
      operation: 'rename',
      before: beforeLimited.text,
      after: afterLimited.text,
      hashBefore: hashText(expected),
      hashAfter: hashText(content),
      truncated: beforeLimited.truncated || afterLimited.truncated,
    })
    handled.add(rename.to)
    handled.add(rename.from)
  }

  const paths = new Set<string>([...status.files, ...latest.keys()])
  for (const file of paths) {
    if (isIgnoredPath(file) || handled.has(file)) continue
    const filePath = path.join(root, file)
    const exists = pathExists(filePath)
    let content = ''
    if (exists) {
      const read = readTextFile(filePath, MAX_FILE_BYTES)
      if (!read) continue
      content = read.content
    }
    const previous = latest.get(file)
    const expected = previous?.after ?? baseline.contents[file] ?? fileAtHead(root, file)
    if (content === expected) continue
    const beforeLimited = truncate(expected, MAX_FILE_BYTES)
    const afterLimited = truncate(content, MAX_FILE_BYTES)
    emit({
      kind: 'edit',
      atMs: now - meta.startedAtMs,
      batch: `reconcile-${now}`,
      path: file,
      operation: operationFor(expected, content, false),
      before: beforeLimited.text,
      after: afterLimited.text,
      hashBefore: hashText(expected),
      hashAfter: hashText(content),
      truncated: beforeLimited.truncated || afterLimited.truncated,
    })
  }

  return added
}
