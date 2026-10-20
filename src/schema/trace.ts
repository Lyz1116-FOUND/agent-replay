import { z } from 'zod'

export const SPAN_TYPES = [
  'agent',
  'reasoning',
  'read',
  'search',
  'edit',
  'shell',
  'test',
  'browser',
  'tool',
  'checkpoint',
  'final',
] as const

export const spanTypeSchema = z.enum(SPAN_TYPES)
export type SpanType = z.infer<typeof spanTypeSchema>

export const spanStatusSchema = z.enum(['ok', 'error', 'warning', 'running'])
export type SpanStatus = z.infer<typeof spanStatusSchema>

export const traceStatusSchema = z.enum(['pass', 'fail', 'partial', 'running'])
export type TraceStatus = z.infer<typeof traceStatusSchema>

export const TERMINATION_KINDS = [
  'completed',
  'task_failure',
  'provider_unavailable',
  'rate_limited',
  'permission_denied',
  'timeout',
  'agent_error',
  'recorder_error',
] as const

export const terminationSchema = z.object({
  kind: z.enum(TERMINATION_KINDS),
  message: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
})
export type Termination = z.infer<typeof terminationSchema>

/**
 * Enough context to explain "the same model worked yesterday" later on.
 * Nothing here is inferred; fields stay absent when the recorder was not told.
 * Paths are sanitized: the user's home directory is replaced with `~`.
 */
export const environmentSchema = z.object({
  isolation: z.enum(['none', 'xdg', 'host-config', 'custom']).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  harnessVersion: z.string().optional(),
  recorderVersion: z.string().optional(),
  platform: z.string().optional(),
  arch: z.string().optional(),
  nodeVersion: z.string().optional(),
  shell: z.string().optional(),
  cwdRealpath: z.string().optional(),
  agentCli: z
    .object({ name: z.string(), version: z.string().optional() })
    .optional(),
  network: z.object({ proxyConfigured: z.boolean() }).optional(),
})
export type Environment = z.infer<typeof environmentSchema>

/**
 * How much of what the agent claimed the workspace actually corroborates.
 * Recall is undefined when there was nothing to match, never 100% by default.
 */
export const captureIntegritySchema = z.object({
  nativeEdits: z.number().int().nonnegative(),
  workspaceEdits: z.number().int().nonnegative(),
  /** One-to-one: this exact call claimed a workspace diff. */
  matchedEdits: z.number().int().nonnegative(),
  /** File-level: the named file changed nearby, even if the diff was taken. */
  confirmedEdits: z.number().int().nonnegative().optional(),
  supersededEdits: z.number().int().nonnegative().optional(),
  unverifiedEdits: z.number().int().nonnegative(),
  outsideWorkspaceEdits: z.number().int().nonnegative(),
  nativeTestRuns: z.number().int().nonnegative(),
  parsedTestRuns: z.number().int().nonnegative(),
  capturedTests: z.number().int().nonnegative(),
})

const attributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
])

const codeArtifactSchema = z.object({
  kind: z.literal('code'),
  path: z.string(),
  language: z.string(),
  content: z.string(),
  startLine: z.number().int().positive().optional(),
})

const diffArtifactSchema = z.object({
  kind: z.literal('diff'),
  path: z.string(),
  before: z.string(),
  after: z.string(),
  language: z.string().optional(),
})

const terminalArtifactSchema = z.object({
  kind: z.literal('terminal'),
  command: z.string(),
  output: z.string(),
  exitCode: z.number().int(),
  cwd: z.string().optional(),
})

const testArtifactSchema = z.object({
  kind: z.literal('test'),
  command: z.string(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  output: z.string(),
  failedTests: z.array(z.string()).optional(),
})

const searchArtifactSchema = z.object({
  kind: z.literal('search'),
  query: z.string(),
  results: z.array(
    z.object({
      path: z.string(),
      line: z.number().int().positive(),
      preview: z.string(),
    }),
  ),
})

const reasoningArtifactSchema = z.object({
  kind: z.literal('reasoning'),
  content: z.string(),
})

const patchArtifactSchema = z.object({
  kind: z.literal('patch'),
  diff: z.string(),
})

const markdownArtifactSchema = z.object({
  kind: z.literal('markdown'),
  content: z.string(),
})

const browserArtifactSchema = z.object({
  kind: z.literal('browser'),
  url: z.string(),
  actions: z.array(z.string()),
  screenshot: z.string().optional(),
})

export const artifactSchema = z.discriminatedUnion('kind', [
  codeArtifactSchema,
  diffArtifactSchema,
  terminalArtifactSchema,
  testArtifactSchema,
  searchArtifactSchema,
  reasoningArtifactSchema,
  patchArtifactSchema,
  markdownArtifactSchema,
  browserArtifactSchema,
])

export type Artifact = z.infer<typeof artifactSchema>
export type ArtifactKind = Artifact['kind']

export const spanSchema = z
  .object({
    id: z.string().min(1),
    parentId: z.string().optional(),
    type: spanTypeSchema,
    name: z.string().min(1),
    summary: z.string().optional(),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
    status: spanStatusSchema,
    files: z.array(z.string()).optional(),
    attributes: z.record(z.string(), attributeValueSchema).optional(),
    artifacts: z.array(artifactSchema).optional(),
  })
  .refine((span) => span.endMs >= span.startMs, {
    message: 'endMs must be greater than or equal to startMs',
    path: ['endMs'],
  })

export type Span = z.infer<typeof spanSchema>

export const traceSchema = z
  .object({
    schemaVersion: z.literal('agent-replay/v1'),
    id: z.string().min(1),
    task: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
      repo: z.string().optional(),
      baseCommit: z.string().optional(),
    }),
    agent: z.object({
      name: z.string().min(1),
      version: z.string().optional(),
      model: z.string().optional(),
    }),
    status: traceStatusSchema,
    termination: terminationSchema.optional(),
    environment: environmentSchema.optional(),
    startedAt: z.string(),
    endedAt: z.string(),
    durationMs: z.number().nonnegative(),
    result: z.object({
      summary: z.string(),
      exitCode: z.number().int().optional(),
      tests: z
        .object({
          passed: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          total: z.number().int().nonnegative(),
        })
        .optional(),
      filesChanged: z.array(z.string()).optional(),
      patch: z.string().optional(),
    }),
    capture: z
      .object({
        fidelity: z.enum(['workspace', 'wrapped-output', 'native-events', 'native+workspace']),
        timing: z.enum(['observed', 'mixed', 'estimated']),
        adapter: z.string().optional(),
        sources: z.array(z.string()).optional(),
        workspaceVerified: z.number().int().nonnegative().optional(),
        unverifiedEdits: z.number().int().nonnegative().optional(),
        integrity: captureIntegritySchema.optional(),
      })
      .optional(),
    spans: z.array(spanSchema).min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((trace, ctx) => {
    const ids = new Set<string>()
    for (const [index, span] of trace.spans.entries()) {
      if (ids.has(span.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['spans', index, 'id'],
          message: `Duplicate span id "${span.id}".`,
        })
      }
      ids.add(span.id)
      if (span.endMs > trace.durationMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['spans', index, 'endMs'],
          message: `Span ends at ${span.endMs}ms, beyond trace duration ${trace.durationMs}ms.`,
        })
      }
    }

    const byId = new Map(trace.spans.map((span) => [span.id, span]))
    for (const [index, span] of trace.spans.entries()) {
      if (!span.parentId) continue
      if (span.parentId === span.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['spans', index, 'parentId'],
          message: 'A span cannot be its own parent.',
        })
        continue
      }
      const parent = byId.get(span.parentId)
      if (!parent) {
        ctx.addIssue({
          code: 'custom',
          path: ['spans', index, 'parentId'],
          message: `Parent span "${span.parentId}" does not exist.`,
        })
        continue
      }
      if (span.startMs < parent.startMs || span.endMs > parent.endMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['spans', index],
          message: `Child span "${span.id}" must fall within parent "${parent.id}".`,
        })
      }
    }

    if (trace.result.tests) {
      const { passed, failed, total } = trace.result.tests
      if (passed + failed !== total) {
        ctx.addIssue({
          code: 'custom',
          path: ['result', 'tests', 'total'],
          message: `tests.total (${total}) must equal passed + failed (${passed + failed}).`,
        })
      }
    }
  })

export type Trace = z.infer<typeof traceSchema>

export function parseNativeTrace(input: unknown): Trace {
  return traceSchema.parse(input)
}
