import type { Artifact } from '../../src/schema/trace.ts'
import type { TestOutcome } from './types.ts'
import { normalizeEol, truncate } from './fsutil.ts'

export function languageFor(file: string): string {
  const extension = file.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    py: 'python',
    pyi: 'python',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'shell',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    hpp: 'cpp',
    html: 'html',
    css: 'css',
    toml: 'ini',
    ini: 'ini',
  }
  return extension ? (map[extension] ?? 'plaintext') : 'plaintext'
}

export function terminalArtifact(
  command: string,
  cwd: string,
  output: string | undefined,
  exitCode: number | undefined,
): Artifact {
  return {
    kind: 'terminal',
    command,
    output: truncate(output ?? '', 120_000).text,
    exitCode: exitCode ?? 0,
    cwd,
  }
}

export function testArtifact(
  command: string,
  test: TestOutcome,
  output: string | undefined,
): Artifact {
  return {
    kind: 'test',
    command,
    passed: test.passed,
    failed: test.failed,
    total: test.total,
    output: truncate(output ?? '', 120_000).text,
    failedTests: test.failedTests.length > 0 ? test.failedTests : undefined,
  }
}

export function codeArtifact(file: string, output: string): Artifact {
  return {
    kind: 'code',
    path: file,
    language: languageFor(file),
    content: truncate(output, 200_000).text,
  }
}

export function diffArtifact(
  file: string,
  before: string,
  after: string,
): Artifact {
  return {
    kind: 'diff',
    path: file,
    before: normalizeEol(before),
    after: normalizeEol(after),
    language: languageFor(file),
  }
}

export function patchArtifact(patch: string): Artifact {
  return { kind: 'patch', diff: normalizeEol(truncate(patch, 300_000).text) }
}
