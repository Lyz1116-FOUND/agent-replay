import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { summarize } from './aggregate.ts'
import { DEFAULT_AGENTS, VALIDATION_AGENTS } from './agents.ts'
import { REPO_ROOT, loadTasks, runTask, verifyTask } from './harness.ts'
import type { Availability, RunRecord } from './types.ts'

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

const agentsArg = arg('agents', DEFAULT_AGENTS.join(',')) ?? ''
const agentIds = agentsArg.split(',').map((value) => value.trim()).filter(Boolean)
const tasks = loadTasks(path.join(REPO_ROOT, 'examples', 'tasks'), (arg('tasks') ?? '').split(',').filter(Boolean))
const runs = Number(arg('runs', '3'))
const timeoutMs = Number(arg('timeout', '240')) * 1000
const workRoot = arg('work-dir', '/private/tmp/agent-replay-validation') ?? ''
const outDir = path.join(REPO_ROOT, 'examples', 'validation')
const recorder = path.join(REPO_ROOT, 'dist-cli', 'agent-replay.mjs')

mkdirSync(outDir, { recursive: true })
mkdirSync(workRoot, { recursive: true })

if (flag('reindex')) {
  // Rebuild the summary from the ledger without touching the agents.
  const ledger = path.join(outDir, 'runs.jsonl')
  const loaded: RunRecord[] = existsSync(ledger)
    ? readFileSync(ledger, 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as RunRecord)
    : []
  const availabilityNow: Record<string, Availability> = {}
  for (const id of new Set(loaded.map((record) => record.agent))) {
    availabilityNow[id] = VALIDATION_AGENTS[id]?.availability() ?? { status: 'error' }
  }
  const rebuilt = summarize(loaded, availabilityNow)
  writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(rebuilt, null, 2)}\n`)
  console.log(JSON.stringify(rebuilt.totals, null, 2))
  process.exit(0)
}

if (flag('verify-tasks')) {
  let failed = 0
  for (const task of tasks) {
    const check = verifyTask(task, workRoot)
    const ok = check.baselineFails && check.referencePasses
    if (!ok) failed += 1
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${task.id.padEnd(16)} baseline fails: ${check.baselineFails} · reference passes: ${check.referencePasses}${check.detail ? ` · ${check.detail}` : ''}`,
    )
  }
  process.exit(failed === 0 ? 0 : 1)
}

const availability: Record<string, Availability> = {}
const runnable: string[] = []
for (const id of agentIds) {
  const agent = VALIDATION_AGENTS[id]
  if (!agent) {
    console.log(`skip ${id}: unknown validation agent`)
    continue
  }
  if (agent.requiresConsent && !flag('allow-paid')) {
    availability[id] = { status: 'login_required', detail: 'requires explicit --allow-paid consent' }
    console.log(`skip ${id}: requires explicit consent (pass --allow-paid to run it)`)
    continue
  }
  const status = agent.availability()
  availability[id] = status
  if (status.status === 'ready') {
    runnable.push(id)
  } else {
    console.log(`skip ${id}: ${status.status}${status.detail ? ` (${status.detail})` : ''}`)
  }
}

if (runnable.length === 0) {
  console.log('no runnable agents; nothing to do')
  writeFileSync(
    path.join(outDir, 'summary.json'),
    `${JSON.stringify(summarize([], availability), null, 2)}\n`,
  )
  process.exit(0)
}

// Runs accumulate across invocations so a small wiring check does not erase a
// full matrix; a record replaces the previous one with the same key.
const ledgerPath = path.join(outDir, 'runs.jsonl')
const records: RunRecord[] = []
if (!flag('reset') && existsSync(ledgerPath)) {
  for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
    if (line.trim()) records.push(JSON.parse(line) as RunRecord)
  }
}
const keyOf = (record: RunRecord) => `${record.task}--${record.agent}--${record.run}`
for (const task of tasks) {
  for (const id of runnable) {
    for (let run = 1; run <= runs; run += 1) {
      const record = runTask({
        task,
        agent: VALIDATION_AGENTS[id],
        run,
        workRoot,
        recorder,
        timeoutMs,
        env: process.env.AGENT_MATRIX_PROXY
          ? {
              HTTPS_PROXY: process.env.AGENT_MATRIX_PROXY,
              HTTP_PROXY: process.env.AGENT_MATRIX_PROXY,
              ALL_PROXY: process.env.AGENT_MATRIX_PROXY,
            }
          : undefined,
      })
      const existing = records.findIndex((item) => keyOf(item) === keyOf(record))
      if (existing >= 0) records[existing] = record
      else records.push(record)
      writeFileSync(ledgerPath, records.map((item) => `${JSON.stringify(item)}\n`).join(''))
      const integrity = record.integrity
      console.log(
        `${task.id.padEnd(16)} ${id.padEnd(9)} r${run} ` +
          `task=${record.taskResult.status.padEnd(7)} term=${(record.termination.kind ?? '?').padEnd(20)} ` +
          `${Math.round(record.elapsedMs / 100) / 10}s ` +
          `tests=${record.taskResult.passedTests ?? 0}/${record.taskResult.totalTests ?? 0} ` +
          `recall=${integrity ? `${integrity.confirmedEdits}/${integrity.nativeEditEvents}` : '-'}`,
      )
    }
  }
}

const summary = summarize(records, availability)
writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary.totals, null, 2))
