import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const MAX_FILE_BYTES = 200_000

const IGNORED_SEGMENTS = new Set([
  '.git',
  '.agent-replay',
  'replays',
  'node_modules',
  'dist',
  'dist-cli',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  '.idea',
  '.vscode',
])

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function pathExists(target: string): boolean {
  try {
    fs.accessSync(target)
    return true
  } catch {
    return false
  }
}

export function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

export function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

export function isIgnoredPath(relativePath: string): boolean {
  const segments = toPosix(relativePath).split('/')
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return true
  const name = segments[segments.length - 1] ?? ''
  return name === '.DS_Store' || name.endsWith('.lock')
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8000)
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === 0) return true
  }
  return false
}

export function readTextFile(
  absolutePath: string,
  maxBytes = MAX_FILE_BYTES,
): { content: string; truncated: boolean } | null {
  try {
    const stat = fs.statSync(absolutePath)
    if (!stat.isFile()) return null
    const buffer = fs.readFileSync(absolutePath)
    if (looksBinary(buffer)) return null
    const truncated = buffer.length > maxBytes
    return {
      content: buffer.subarray(0, maxBytes).toString('utf8'),
      truncated,
    }
  } catch {
    return null
  }
}

export function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

export function truncate(text: string, max = MAX_FILE_BYTES): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return {
    text: `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`,
    truncated: true,
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(path.dirname(file))
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, file)
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

export function appendJsonLine(file: string, value: unknown): void {
  ensureDir(path.dirname(file))
  const line = `${JSON.stringify(value)}\n`
  const descriptor = fs.openSync(file, 'a')
  try {
    fs.writeSync(descriptor, line)
  } finally {
    fs.closeSync(descriptor)
  }
}

export function readJsonLines<T>(file: string): T[] {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const values: T[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      values.push(JSON.parse(line) as T)
    } catch {
      // A partially written line can exist if a writer was killed.
    }
  }
  return values
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug || 'session'
}

export function timeStampName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function truncateLine(text: string, max = 72): string {
  const line = text.split('\n').find((item) => item.trim())?.trim() ?? text.trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function relativeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
