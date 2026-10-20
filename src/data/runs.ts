import type { Trace } from '../schema/trace'
import { jsonFlagRun } from './json-flag'
import { lruClaudeRun } from './lru-claude'
import { lruCodexRun } from './lru-codex'
import { lruCursorRun } from './lru-cursor'

export const demoRuns: Trace[] = [lruCodexRun, lruClaudeRun, lruCursorRun, jsonFlagRun]

export const demoRunMap = new Map(demoRuns.map((run) => [run.id, run]))
