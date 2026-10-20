import type { TestOutcome } from './types'

const ESCAPE = String.fromCharCode(27)
const ANSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;]*[A-Za-z]`, 'g')

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

type Candidate = {
  end: number
  passed: number
  failed: number
  framework: string
}

function lastMatch(text: string, pattern: RegExp): RegExpMatchArray | null {
  let last: RegExpMatchArray | null = null
  for (const match of text.matchAll(pattern)) last = match
  return last
}

function collectCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = []

  for (const match of text.matchAll(/(\d+)\s+failed,\s*(\d+)\s+passed/gi)) {
    candidates.push({
      end: (match.index ?? 0) + match[0].length,
      failed: Number(match[1]),
      passed: Number(match[2]),
      framework: 'pytest',
    })
  }
  for (const match of text.matchAll(/(\d+)\s+passed,\s*(\d+)\s+failed/gi)) {
    candidates.push({
      end: (match.index ?? 0) + match[0].length,
      passed: Number(match[1]),
      failed: Number(match[2]),
      framework: 'pytest',
    })
  }
  for (const match of text.matchAll(/(\d+)\s+passed\s+in\s+[\d.]+s/gi)) {
    candidates.push({
      end: (match.index ?? 0) + match[0].length,
      passed: Number(match[1]),
      failed: 0,
      framework: 'pytest',
    })
  }
  for (const match of text.matchAll(/(\d+)\s+failed\s+in\s+[\d.]+s/gi)) {
    candidates.push({
      end: (match.index ?? 0) + match[0].length,
      passed: 0,
      failed: Number(match[1]),
      framework: 'pytest',
    })
  }

  for (const match of text.matchAll(
    /Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/gi,
  )) {
    const failed = Number(match[1] ?? 0)
    const skipped = Number(match[2] ?? 0)
    const total = Number(match[4])
    const passed = match[3] ? Number(match[3]) : Math.max(total - failed - skipped, 0)
    candidates.push({
      end: (match.index ?? 0) + match[0].length,
      passed,
      failed,
      framework: 'jest',
    })
  }

  for (const match of text.matchAll(/test result: (?:ok|FAILED)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;/gi)) {
    candidates.push({
      end: (match.index ?? 0) + match[0].length,
      passed: Number(match[1]),
      failed: Number(match[2]),
      framework: 'cargo test',
    })
  }

  const passing = lastMatch(text, /(\d+)\s+passing/gi)
  const failing = lastMatch(text, /(\d+)\s+failing/gi)
  if (passing || failing) {
    candidates.push({
      end: Math.max(
        (passing?.index ?? 0) + (passing?.[0].length ?? 0),
        (failing?.index ?? 0) + (failing?.[0].length ?? 0),
      ),
      passed: Number(passing?.[1] ?? 0),
      failed: Number(failing?.[1] ?? 0),
      framework: 'mocha',
    })
  }

  const tapPass = lastMatch(text, /(?:#|ℹ)\s*pass\s+(\d+)/gi)
  const tapFail = lastMatch(text, /(?:#|ℹ)\s*fail\s+(\d+)/gi)
  if (tapPass || tapFail) {
    candidates.push({
      end: Math.max(
        (tapPass?.index ?? 0) + (tapPass?.[0].length ?? 0),
        (tapFail?.index ?? 0) + (tapFail?.[0].length ?? 0),
      ),
      passed: Number(tapPass?.[1] ?? 0),
      failed: Number(tapFail?.[1] ?? 0),
      framework: 'node:test',
    })
  }

  const phpunit = lastMatch(text, /OK \((\d+) tests?/gi)
  if (phpunit) {
    candidates.push({
      end: (phpunit.index ?? 0) + phpunit[0].length,
      passed: Number(phpunit[1]),
      failed: 0,
      framework: 'phpunit',
    })
  }
  const phpunitFailures = lastMatch(
    text,
    /Tests:\s+(\d+),\s+Assertions:\s*\d+(?:,\s+Errors:\s*\d+)?(?:,\s+Failures:\s*(\d+))?/gi,
  )
  if (phpunitFailures) {
    const failed = Number(phpunitFailures[2] ?? 0)
    const total = Number(phpunitFailures[1])
    candidates.push({
      end: (phpunitFailures.index ?? 0) + phpunitFailures[0].length,
      passed: Math.max(total - failed, 0),
      failed,
      framework: 'phpunit',
    })
  }

  return candidates
}

function extractFailedTests(text: string): string[] {
  const names = new Set<string>()
  for (const match of text.matchAll(/^FAILED\s+(\S+)(?:\s+-.*)?$/gm)) {
    names.add(match[1])
  }
  for (const match of text.matchAll(/^\s*✕\s+(.+)$/gm)) {
    names.add(match[1].trim())
  }
  for (const match of text.matchAll(/^--- FAIL: (\S+)/gm)) {
    names.add(match[1])
  }
  for (const match of text.matchAll(/^\s*●\s+(.+)$/gm)) {
    names.add(match[1].trim())
  }
  for (const match of text.matchAll(/^\s*✖\s+(.+?)(?:\s+\(\d+(?:\.\d+)?ms\))?$/gm)) {
    const name = match[1].trim()
    if (!name.endsWith(':')) names.add(name)
  }
  return [...names].slice(0, 20)
}

export function parseTestOutput(rawText: string): TestOutcome | null {
  const text = stripAnsi(rawText)
  const candidates = collectCandidates(text)
  if (candidates.length === 0) return null

  const lastCandidate = candidates.reduce((current, candidate) =>
    candidate.end > current.end ? candidate : current,
  )
  // A line such as "1 failed, 2 passed in 0.1s" also matches the
  // all-pass pattern. Prefer a candidate on the same summary line that
  // carries more information.
  const best = candidates
    .filter((candidate) => candidate.end >= lastCandidate.end - 40)
    .reduce((current, candidate) => {
      if (candidate.passed + candidate.failed > current.passed + current.failed) return candidate
      if (candidate.passed + candidate.failed === current.passed + current.failed && candidate.end > current.end) {
        return candidate
      }
      return current
    }, lastCandidate)

  const passed = Math.max(best.passed, 0)
  const failed = Math.max(best.failed, 0)
  return {
    passed,
    failed,
    total: passed + failed,
    failedTests: extractFailedTests(text),
    framework: best.framework,
  }
}

// Boundaries include quotes and parentheses: agents rarely run a bare command,
// they run `sh -lc 'node --test test.mjs'` or `bash -c "npm test"`.
const TEST_COMMAND_PATTERN =
  /(?:^|[\s;&|'"`(])(?:pytest|py\.test|python\s+-m\s+(?:pytest|unittest)|npm\s+(?:run\s+)?test|yarn\s+test|pnpm\s+test|npx\s+(?:vitest|jest)|vitest|jest|mocha|cargo\s+test|go\s+test|make\s+test|tox|phpunit|rspec|dotnet\s+test|node\s+--test|bun\s+test)(?:$|[\s;&|'"`),])/i

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND_PATTERN.test(` ${command} `)
}

export function displayCommand(command: string, args: string[]): string {
  const quote = (part: string) => (/\s/.test(part) ? JSON.stringify(part) : part)
  return [command, ...args].map(quote).join(' ')
}

export type OutputScanner = {
  push: (chunk: string) => void
  flush: () => void
}

export function createOutputScanner(
  onSummary: (outcome: TestOutcome, output: string) => void,
  onLine?: (line: string) => void,
): OutputScanner {
  let pendingLine = ''
  let rolling = ''
  let pending: { outcome: TestOutcome; output: string } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSignature = ''
  let lastAt = 0

  function emit(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const { outcome, output } = pending
    pending = null
    const now = Date.now()
    const signature = `${outcome.framework}:${outcome.passed}:${outcome.failed}`
    if (signature === lastSignature && now - lastAt < 500) {
      rolling = ''
      return
    }
    lastSignature = signature
    lastAt = now
    onSummary(outcome, output)
    rolling = ''
  }

  function schedule(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(emit, 350)
  }

  function processLine(line: string): void {
    rolling = `${rolling}${line}\n`.slice(-40_000)
    onLine?.(line)
    const lineOutcome = parseTestOutput(line)
    if (!lineOutcome) return
    const enriched = parseTestOutput(rolling) ?? lineOutcome
    pending = { outcome: enriched, output: rolling }
    schedule()
  }

  function push(chunk: string): void {
    pendingLine += stripAnsi(chunk)
    const lines = pendingLine.split('\n')
    pendingLine = lines.pop() ?? ''
    for (const line of lines) processLine(line)
  }

  function flush(): void {
    if (pendingLine.trim()) {
      processLine(pendingLine)
      pendingLine = ''
    }
    emit()
  }

  return { push, flush }
}
