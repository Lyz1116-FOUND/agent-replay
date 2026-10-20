import { ZodError } from 'zod'
import { parseNativeTrace, type Trace } from '../schema/trace'
import { adaptSweAgent, isSweAgentTrajectory } from './sweAgent'

export class TraceImportError extends Error {
  issues: string[]

  constructor(message: string, issues: string[] = []) {
    super(message)
    this.name = 'TraceImportError'
    this.issues = issues
  }
}

export type ImportFormat = 'native' | 'swe-agent'

export function importTraceText(text: string): { trace: Trace; format: ImportFormat } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown parse error'
    throw new TraceImportError('File is not valid JSON.', [detail])
  }

  if (isSweAgentTrajectory(json)) {
    try {
      return { trace: adaptSweAgent(json), format: 'swe-agent' }
    } catch (error) {
      throw new TraceImportError(
        'Could not convert this SWE-agent trajectory.',
        [error instanceof Error ? error.message : 'Unknown adapter error'],
      )
    }
  }

  try {
    return { trace: parseNativeTrace(json), format: 'native' }
  } catch (error) {
    if (error instanceof ZodError) {
      throw new TraceImportError(
        'Trace does not match the agent-replay/v1 schema.',
        error.issues.map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
          return `${path}: ${issue.message}`
        }),
      )
    }
    throw error
  }
}
