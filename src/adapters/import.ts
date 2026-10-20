import { ZodError } from 'zod'
import { parseNativeTrace, type Trace } from '../schema/trace'
import { TraceImportError } from './errors'
import { adaptOtlpJson, isOtlpTraceJson } from './otel'
import { adaptSweAgent, isSweAgentTrajectory } from './sweAgent'

export { TraceImportError } from './errors'

export type ImportFormat = 'native' | 'swe-agent' | 'otlp'

export type ImportDiagnostic = {
  level: 'info' | 'warning'
  message: string
}

export type ImportResult = {
  format: ImportFormat
  /** One file can hold several OTel traceIds; native and SWE-agent yield exactly one. */
  traces: Trace[]
  diagnostics: ImportDiagnostic[]
}

const MAX_IMPORT_CHARS = 32 * 1024 * 1024

function zodIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    return `${path}: ${issue.message}`
  })
}

export function importTraceFile(text: string): ImportResult {
  if (text.length > MAX_IMPORT_CHARS) {
    throw new TraceImportError('This file is too large to import in the browser.', [
      `${text.length.toLocaleString()} characters exceed the ${MAX_IMPORT_CHARS.toLocaleString()} character limit.`,
    ])
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown parse error'
    throw new TraceImportError('File is not valid JSON.', [detail])
  }

  if (isSweAgentTrajectory(json)) {
    try {
      return { format: 'swe-agent', traces: [adaptSweAgent(json)], diagnostics: [] }
    } catch (error) {
      throw new TraceImportError(
        'Could not convert this SWE-agent trajectory.',
        [error instanceof Error ? error.message : 'Unknown adapter error'],
      )
    }
  }

  if (isOtlpTraceJson(json)) {
    const result = adaptOtlpJson(json)
    return { format: 'otlp', traces: result.traces, diagnostics: result.diagnostics }
  }

  try {
    return { format: 'native', traces: [parseNativeTrace(json)], diagnostics: [] }
  } catch (error) {
    if (error instanceof ZodError) {
      throw new TraceImportError(
        'Trace does not match the agent-replay/v1 schema.',
        zodIssues(error),
      )
    }
    throw error
  }
}
