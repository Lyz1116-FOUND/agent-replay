import { ZodError } from 'zod'
import { traceSchema, type Span, type SpanStatus, type SpanType, type Trace } from '../schema/trace'
import { TraceImportError } from './errors'

/**
 * OTLP/JSON import.
 *
 * Contract (see docs/M5_OTEL_CONTRACTS.md):
 * - input is an `ExportTraceServiceRequest`-shaped JSON document, camelCase or
 *   snake_case, with `resourceSpans -> scopeSpans -> spans`;
 * - one file may hold several traceIds; each becomes one Trace;
 * - nanoseconds stay exact (BigInt) and are only converted at display time;
 * - anything the normalized model cannot express is kept verbatim in
 *   `span.raw.otlp` / `trace.metadata.otel` instead of being stringified away;
 * - no task verdict is inferred from span status.
 */

type Json = Record<string, unknown>

export type OtelDiagnostic = {
  level: 'info' | 'warning'
  message: string
}

export type OtelImportResult = {
  traces: Trace[]
  diagnostics: OtelDiagnostic[]
}

const MAX_SPANS = 20_000
/** 2^53 ns ≈ 104 days; beyond this, nanosecond differences stop being exact in a double. */
const MAX_EXACT_RANGE_NS = 2n ** 53n

const STATUS_BY_CODE: Record<string, SpanStatus> = {
  '0': 'unset',
  '1': 'ok',
  '2': 'error',
  STATUS_CODE_UNSET: 'unset',
  STATUS_CODE_OK: 'ok',
  STATUS_CODE_ERROR: 'error',
}

const KIND_BY_CODE: Record<string, string> = {
  '0': 'unspecified',
  '1': 'internal',
  '2': 'server',
  '3': 'client',
  '4': 'producer',
  '5': 'consumer',
  SPAN_KIND_UNSPECIFIED: 'unspecified',
  SPAN_KIND_INTERNAL: 'internal',
  SPAN_KIND_SERVER: 'server',
  SPAN_KIND_CLIENT: 'client',
  SPAN_KIND_PRODUCER: 'producer',
  SPAN_KIND_CONSUMER: 'consumer',
}

const GENERATION_OPERATIONS = new Set([
  'chat',
  'text_completion',
  'completion',
  'generate_content',
  'generate_text',
])
const AGENT_OPERATIONS = new Set(['invoke_agent', 'create_agent', 'agent'])
const TOOL_OPERATIONS = new Set(['execute_tool', 'tool_call', 'tool'])

/**
 * Exact tool names only. No substring heuristics: a span called
 * "run_shell_thing" is not proof that a shell ran.
 */
const TOOL_TYPES: Record<string, SpanType> = {
  bash: 'shell',
  shell: 'shell',
  terminal: 'shell',
  exec: 'shell',
  execute: 'shell',
  run_command: 'shell',
  execute_command: 'shell',
  command: 'shell',
  read_file: 'read',
  read: 'read',
  view_file: 'read',
  open_file: 'read',
  cat: 'read',
  edit_file: 'edit',
  write_file: 'edit',
  str_replace: 'edit',
  str_replace_editor: 'edit',
  apply_patch: 'edit',
  create_file: 'edit',
  edit: 'edit',
  write: 'edit',
  grep: 'search',
  search: 'search',
  glob: 'search',
  find_files: 'search',
  search_files: 'search',
  web_search: 'search',
  run_tests: 'test',
  run_test: 'test',
  test: 'test',
  pytest: 'test',
  browser: 'browser',
}

const FILE_ATTRIBUTE_KEYS = ['file.path', 'code.filepath', 'file_path', 'code.file.path']

type DisplayValue = string | number | boolean | string[] | number[] | boolean[]

type AttrRead = {
  scalar?: DisplayValue
  kind: string
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function field(source: Json, camel: string, snake: string): unknown {
  return source[camel] ?? source[snake]
}

function arrayField(source: Json, camel: string, snake: string): unknown[] | undefined {
  const value = field(source, camel, snake)
  return Array.isArray(value) ? value : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

type NanoParse =
  | { ns: bigint }
  /** JSON.parse already rounded this value; precision cannot be recovered. */
  | { error: 'unsafe-number' }
  | { error: 'invalid' }

function parseNanos(value: unknown): NanoParse {
  if (typeof value === 'string' && /^\d+$/.test(value)) return { ns: BigInt(value) }
  // OTLP/JSON encodes 64-bit integers as decimal strings. A bare number has
  // already lost nanosecond precision inside JSON.parse, so accepting it would
  // silently claim precision we no longer have.
  if (typeof value === 'number') return { error: 'unsafe-number' }
  return { error: 'invalid' }
}

function isHexId(value: string, length: number): boolean {
  return new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value)
}

function isZeroId(value: string): boolean {
  return /^0+$/.test(value)
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function anyValueField(source: Json, camel: string, snake: string): unknown {
  return source[camel] ?? source[snake]
}

function readAnyValue(value: unknown): AttrRead | null {
  if (!isRecord(value)) return null
  const stringValue = anyValueField(value, 'stringValue', 'string_value')
  if (typeof stringValue === 'string') return { scalar: stringValue, kind: 'string' }
  const boolValue = anyValueField(value, 'boolValue', 'bool_value')
  if (typeof boolValue === 'boolean') return { scalar: boolValue, kind: 'bool' }
  const intValue = anyValueField(value, 'intValue', 'int_value')
  if (intValue !== undefined) {
    // A JSON number beyond 2^53 was already rounded before we saw it; keep it
    // out of the flat channel and let the caller report it.
    if (typeof intValue === 'number' && !Number.isSafeInteger(intValue)) return { kind: 'int-unsafe' }
    const raw = String(intValue)
    if (!/^-?\d+$/.test(raw)) return { kind: 'int' }
    const numeric = Number(raw)
    // int64 beyond 2^53 keeps its exact decimal text rather than a rounded double.
    return Number.isSafeInteger(numeric)
      ? { scalar: numeric, kind: 'int' }
      : { scalar: raw, kind: 'int64' }
  }
  const doubleValue = anyValueField(value, 'doubleValue', 'double_value')
  if (typeof doubleValue === 'number') return { scalar: doubleValue, kind: 'double' }
  const arrayValue = anyValueField(value, 'arrayValue', 'array_value')
  if (isRecord(arrayValue)) {
    const values = Array.isArray(arrayValue.values) ? arrayValue.values : []
    if (values.length === 0) return { scalar: [], kind: 'array' }
    const reads = values.map((item) => readAnyValue(item))
    // Nested arrays and maps stay raw: only a homogeneous primitive array can
    // be represented by the flat attribute schema.
    if (!reads.every((item) => item && isPrimitive(item.scalar))) return { kind: 'array' }
    const primitiveKinds = new Set(reads.map((item) => typeof item?.scalar))
    if (primitiveKinds.size !== 1) return { kind: 'array' }
    return { scalar: reads.map((item) => item?.scalar) as DisplayValue, kind: 'array' }
  }
  if (anyValueField(value, 'kvlistValue', 'kvlist_value') !== undefined) return { kind: 'kvlist' }
  if (anyValueField(value, 'bytesValue', 'bytes_value') !== undefined) return { kind: 'bytes' }
  return null
}

type AttributeRead = {
  scalars: Record<string, DisplayValue>
  nested: number
  bytes: number
  unsafeNumbers: number
}

function readAttributes(value: unknown): AttributeRead {
  const scalars: Record<string, DisplayValue> = {}
  let nested = 0
  let bytes = 0
  let unsafeNumbers = 0
  if (!Array.isArray(value)) return { scalars, nested, bytes, unsafeNumbers }
  for (const item of value) {
    if (!isRecord(item)) continue
    const key = text(item.key)
    if (!key) continue
    const read = readAnyValue(item.value)
    if (!read) continue
    if (read.kind === 'kvlist' || (read.kind === 'array' && read.scalar === undefined)) nested += 1
    else if (read.kind === 'bytes') bytes += 1
    else if (read.kind === 'int-unsafe') unsafeNumbers += 1
    if (read.scalar !== undefined) scalars[key] = read.scalar
  }
  return { scalars, nested, bytes, unsafeNumbers }
}

function statusOf(value: unknown): { status: SpanStatus; code: string; message?: string } {
  if (!isRecord(value)) return { status: 'unset', code: 'unset' }
  const rawCode = value.code
  const key = typeof rawCode === 'number' ? String(rawCode) : typeof rawCode === 'string' ? rawCode : '0'
  const status = STATUS_BY_CODE[key] ?? 'unset'
  return { status, code: status, message: text(value.message) }
}

function kindOf(value: unknown): string {
  const key = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '0'
  return KIND_BY_CODE[key] ?? 'unspecified'
}

function mapType(scalars: Record<string, DisplayValue>): { type: SpanType; source: string } {
  const operation = text(scalars['gen_ai.operation.name'])
  const normalizedOperation = operation?.toLowerCase()
  if (normalizedOperation) {
    if (GENERATION_OPERATIONS.has(normalizedOperation)) {
      return { type: 'generation', source: 'gen_ai.operation.name' }
    }
    if (AGENT_OPERATIONS.has(normalizedOperation)) {
      return { type: 'agent', source: 'gen_ai.operation.name' }
    }
    if (!TOOL_OPERATIONS.has(normalizedOperation)) {
      return { type: 'unknown', source: 'gen_ai.operation.name (unmapped)' }
    }
  }

  const toolName =
    text(scalars['gen_ai.tool.name']) ?? text(scalars['tool.name']) ?? text(scalars['tool_name'])
  if (toolName) {
    const mapped = TOOL_TYPES[toolName.toLowerCase()]
    return mapped
      ? { type: mapped, source: 'tool.name' }
      : { type: 'tool', source: 'tool.name (unmapped)' }
  }

  // An explicit tool operation without a tool name is still a tool call; the
  // provider/model attributes that may sit next to it do not make it an LLM span.
  if (normalizedOperation && TOOL_OPERATIONS.has(normalizedOperation)) {
    return { type: 'tool', source: 'gen_ai.operation.name (tool without name)' }
  }

  // `gen_ai.system` / `gen_ai.request.model` alone do not prove a generation:
  // they appear on tool spans too. Stay generic instead of guessing.
  if (
    text(scalars['gen_ai.system']) ||
    text(scalars['gen_ai.provider.name']) ||
    text(scalars['gen_ai.request.model'])
  ) {
    return { type: 'unknown', source: 'gen_ai.* (no operation)' }
  }

  return { type: 'unknown', source: 'fallback' }
}

function filesOf(scalars: Record<string, DisplayValue>): string[] | undefined {
  const files = new Set<string>()
  for (const key of FILE_ATTRIBUTE_KEYS) {
    const value = scalars[key]
    if (typeof value === 'string' && value.length > 0) files.add(value)
  }
  return files.size > 0 ? [...files] : undefined
}

function nsToMs(diff: bigint): number {
  const whole = diff / 1_000_000n
  const remainder = diff % 1_000_000n
  return Number(whole) + Number(remainder) / 1e6
}

type CollectedSpan = {
  span: Json
  traceId: string
  spanId: string
  parentId?: string
  startNs: bigint
  endNs: bigint
  resourceIndex: number
  scopeIndex: number
  attributes: AttributeRead
  kind: string
  status: { status: SpanStatus; code: string; message?: string }
  name: string
}

type ScopeRecord = {
  /** Position inside its resource, i.e. the `scopeSpans` index in the export. */
  index: number
  name?: string
  version?: string
  schemaUrl?: string
  attributes: unknown[]
  droppedAttributesCount: number
  spanCount: number
  /** Verbatim `scope` object, including fields this model does not interpret. */
  scope: Json
}

type ResourceRecord = {
  /** Position in the export's `resourceSpans` array. */
  index: number
  schemaUrl?: string
  attributes: unknown[]
  droppedAttributesCount: number
  /** Verbatim `resource` object, including fields this model does not interpret. */
  resource: Json
  scopes: ScopeRecord[]
}

function readTimestamp(value: unknown, location: string, issues: string[]): bigint | null {
  const parsed = parseNanos(value)
  if ('error' in parsed) {
    if (parsed.error === 'unsafe-number') {
      issues.push(
        `${location} uses a numeric timestamp; OTLP/JSON encodes 64-bit nanoseconds as decimal strings, and JSON.parse already rounded this value. Re-export with string timestamps.`,
      )
    } else {
      issues.push(`${location} has missing or non-numeric start/end timestamps.`)
    }
    return null
  }
  return parsed.ns
}

export function isOtlpTraceJson(value: unknown): boolean {
  if (!isRecord(value)) return false
  return Array.isArray(field(value, 'resourceSpans', 'resource_spans'))
}

export function adaptOtlpJson(input: unknown): OtelImportResult {
  if (!isOtlpTraceJson(input) || !isRecord(input)) {
    throw new TraceImportError('Not an OTLP JSON trace export.', [
      'Expected a top-level "resourceSpans" array (ExportTraceServiceRequest).',
    ])
  }

  const resourceSpans = arrayField(input, 'resourceSpans', 'resource_spans') ?? []
  const issues: string[] = []
  const diagnostics: OtelDiagnostic[] = []
  const collected: CollectedSpan[] = []
  const resources: ResourceRecord[] = []

  resourceSpans.forEach((resourceEntry, resourceIndex) => {
    if (!isRecord(resourceEntry)) {
      issues.push(`resourceSpans[${resourceIndex}] is not an object.`)
      return
    }
    const resource = isRecord(resourceEntry.resource) ? resourceEntry.resource : {}
    const resourceAttributes = Array.isArray(resource.attributes) ? resource.attributes : []
    const scopes: ScopeRecord[] = []
    const scopeEntries = arrayField(resourceEntry, 'scopeSpans', 'scope_spans') ?? []
    scopeEntries.forEach((scopeEntry, scopeIndex) => {
      if (!isRecord(scopeEntry)) {
        issues.push(`resourceSpans[${resourceIndex}].scopeSpans[${scopeIndex}] is not an object.`)
        return
      }
      const scope = isRecord(scopeEntry.scope) ? scopeEntry.scope : {}
      const spans = Array.isArray(scopeEntry.spans) ? scopeEntry.spans : []
      scopes.push({
        index: scopeIndex,
        name: text(scope.name),
        version: text(scope.version),
        schemaUrl: text(scopeEntry.schemaUrl ?? scopeEntry.schema_url),
        attributes: Array.isArray(scope.attributes) ? scope.attributes : [],
        droppedAttributesCount: Number(
          scope.droppedAttributesCount ?? scope.dropped_attributes_count ?? 0,
        ),
        spanCount: spans.length,
        scope,
      })
      spans.forEach((spanValue, spanIndex) => {
        const location = `resourceSpans[${resourceIndex}].scopeSpans[${scopeIndex}].spans[${spanIndex}]`
        if (!isRecord(spanValue)) {
          issues.push(`${location} is not an object.`)
          return
        }
        // OTLP hex ids are case-insensitive; normalize before grouping, parent
        // lookup and duplicate checks. The raw span keeps the original casing.
        const traceId = text(spanValue.traceId ?? spanValue.trace_id)?.toLowerCase()
        const spanId = text(spanValue.spanId ?? spanValue.span_id)?.toLowerCase()
        if (!traceId || !isHexId(traceId, 32) || isZeroId(traceId)) {
          issues.push(`${location} has an invalid traceId (expected 32 hex chars, not all zero).`)
          return
        }
        if (!spanId || !isHexId(spanId, 16) || isZeroId(spanId)) {
          issues.push(`${location} has an invalid spanId (expected 16 hex chars, not all zero).`)
          return
        }
        const rawParent = text(spanValue.parentSpanId ?? spanValue.parent_span_id)
        const parentId =
          rawParent && isHexId(rawParent, 16) && !isZeroId(rawParent)
            ? rawParent.toLowerCase()
            : undefined
        if (rawParent && !parentId) {
          issues.push(`${location} has an invalid parentSpanId "${rawParent}".`)
          return
        }
        const startNs = readTimestamp(
          spanValue.startTimeUnixNano ?? spanValue.start_time_unix_nano,
          location,
          issues,
        )
        const endNs = readTimestamp(
          spanValue.endTimeUnixNano ?? spanValue.end_time_unix_nano,
          location,
          issues,
        )
        if (startNs === null || endNs === null) return
        if (endNs < startNs) {
          issues.push(`${location} ends before it starts (${endNs} < ${startNs}).`)
          return
        }
        if (parentId === spanId) {
          issues.push(`${location} is its own parent.`)
          return
        }
        const attributes = readAttributes(spanValue.attributes)
        collected.push({
          span: spanValue,
          traceId,
          spanId,
          parentId,
          startNs,
          endNs,
          resourceIndex,
          scopeIndex,
          attributes,
          kind: kindOf(spanValue.kind),
          status: statusOf(spanValue.status),
          name: text(spanValue.name) ?? '(unnamed span)',
        })
      })
    })
    resources.push({
      index: resourceIndex,
      schemaUrl: text(resourceEntry.schemaUrl ?? resourceEntry.schema_url),
      attributes: resourceAttributes,
      droppedAttributesCount: Number(
        resource.droppedAttributesCount ?? resource.dropped_attributes_count ?? 0,
      ),
      resource,
      scopes,
    })
  })

  if (issues.length > 0) {
    throw new TraceImportError('This OTLP export contains invalid spans.', issues.slice(0, 12))
  }
  if (collected.length === 0) {
    throw new TraceImportError('This OTLP export contains no spans.', [
      'resourceSpans was present but no span could be read from it.',
    ])
  }
  if (collected.length > MAX_SPANS) {
    throw new TraceImportError('This OTLP export is too large for the browser importer.', [
      `${collected.length} spans exceed the ${MAX_SPANS} span limit.`,
    ])
  }

  const byTrace = new Map<string, CollectedSpan[]>()
  for (const span of collected) {
    const group = byTrace.get(span.traceId)
    if (group) group.push(span)
    else byTrace.set(span.traceId, [span])
  }

  const traces: Trace[] = []
  for (const [traceId, group] of byTrace) {
    traces.push(buildTrace(traceId, group, resources, diagnostics))
  }
  traces.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id))

  return { traces, diagnostics }
}

function buildTrace(
  traceId: string,
  group: CollectedSpan[],
  resources: ResourceRecord[],
  diagnostics: OtelDiagnostic[],
): Trace {
  const baseNs = group.reduce(
    (min, item) => (item.startNs < min ? item.startNs : min),
    group[0].startNs,
  )
  const maxEndNs = group.reduce((max, item) => (item.endNs > max ? item.endNs : max), group[0].endNs)
  const rangeNs = maxEndNs - baseNs
  if (rangeNs > MAX_EXACT_RANGE_NS) {
    diagnostics.push({
      level: 'warning',
      message: `Trace ${traceId.slice(0, 8)} spans ${Number(rangeNs / 3_600_000_000_000n)}h; sub-millisecond precision is not guaranteed beyond 104 days.`,
    })
  }

  const seenIds = new Set<string>()
  const idByOriginal = new Map<string, string>()
  const duplicateIds: string[] = []
  const orphanIds: string[] = []
  const ordered = [...group].sort(
    (a, b) =>
      (a.startNs < b.startNs ? -1 : a.startNs > b.startNs ? 1 : 0) || a.spanId.localeCompare(b.spanId),
  )
  // Each trace keeps only the resources it actually used, and span pointers are
  // remapped into that local array so `resources[raw.resourceIndex]` always
  // resolves. `index` keeps the original position for provenance.
  const usedResourceIndexes = [...new Set(group.map((item) => item.resourceIndex))].sort(
    (a, b) => a - b,
  )
  const localResourceIndex = new Map(
    usedResourceIndexes.map((original, local) => [original, local] as const),
  )
  const traceResources = usedResourceIndexes.map((original) => resources[original])
  // A trace can span services; the earliest span decides which one is shown.
  const primaryResource = resources[ordered[0].resourceIndex]
  const primaryService = resourceAttribute([primaryResource], 'service.name')
  const services = [
    ...new Set(
      traceResources
        .map((entry) => resourceAttribute([entry], 'service.name'))
        .filter((name): name is string => Boolean(name)),
    ),
  ]

  let nestedAttributes = 0
  let bytesValues = 0
  let unsafeNumbers = 0
  let eventCount = 0
  let linkCount = 0
  let droppedAttributes = 0

  const spans: Span[] = ordered.map((item) => {
    let id = item.spanId
    if (seenIds.has(id)) {
      let suffix = 2
      while (seenIds.has(`${item.spanId}~${suffix}`)) suffix += 1
      id = `${item.spanId}~${suffix}`
      duplicateIds.push(item.spanId)
    }
    seenIds.add(id)
    if (!idByOriginal.has(item.spanId)) idByOriginal.set(item.spanId, id)

    const parentId = item.parentId ? idByOriginal.get(item.parentId) ?? item.parentId : undefined
    if (item.parentId && !idByOriginal.has(item.parentId)) {
      const exported = group.some((candidate) => candidate.spanId === item.parentId)
      if (!exported && !orphanIds.includes(item.parentId)) orphanIds.push(item.parentId)
    }

    const mapping = mapType(item.attributes.scalars)
    const events = Array.isArray(item.span.events) ? item.span.events : []
    const links = Array.isArray(item.span.links) ? item.span.links : []
    nestedAttributes += item.attributes.nested
    bytesValues += item.attributes.bytes
    unsafeNumbers += item.attributes.unsafeNumbers
    eventCount += events.length
    linkCount += links.length
    droppedAttributes += Number(item.span.droppedAttributesCount ?? item.span.dropped_attributes_count ?? 0)

    const attributes: Record<string, DisplayValue> = { ...item.attributes.scalars }
    attributes['otel.kind'] = item.kind
    attributes['otel.typeSource'] = mapping.source
    attributes['otel.statusCode'] = item.status.code
    if (item.status.message) attributes['otel.statusMessage'] = item.status.message
    if (events.length > 0) attributes['otel.eventCount'] = events.length
    if (links.length > 0) attributes['otel.linkCount'] = links.length

    const startMs = nsToMs(item.startNs - baseNs)
    const endMs = nsToMs(item.endNs - baseNs)

    return {
      id,
      parentId,
      type: mapping.type,
      name: item.name,
      startMs,
      endMs,
      status: item.status.status,
      files: filesOf(item.attributes.scalars),
      attributes,
      raw: {
        otlp: item.span,
        resourceIndex: localResourceIndex.get(item.resourceIndex) ?? 0,
        scopeIndex: item.scopeIndex,
      },
    }
  })

  if (duplicateIds.length > 0) {
    diagnostics.push({
      level: 'warning',
      message: `Trace ${traceId.slice(0, 8)} repeats spanId ${[...new Set(duplicateIds)].join(', ')}; later spans were suffixed so ids stay unique.`,
    })
  }
  if (orphanIds.length > 0) {
    diagnostics.push({
      level: 'warning',
      message: `Trace ${traceId.slice(0, 8)} references ${orphanIds.length} parent span(s) missing from the export; they are kept as dangling parents, not re-parented.`,
    })
  }
  if (nestedAttributes > 0 || bytesValues > 0) {
    diagnostics.push({
      level: 'info',
      message: `Trace ${traceId.slice(0, 8)} keeps ${nestedAttributes} nested/array attribute value(s) and ${bytesValues} byte value(s) in raw only; they are not shown as flat attributes.`,
    })
  }
  if (unsafeNumbers > 0) {
    diagnostics.push({
      level: 'warning',
      message: `Trace ${traceId.slice(0, 8)} has ${unsafeNumbers} intValue(s) encoded as unsafe JSON numbers; JSON.parse already rounded them, so they are kept raw and excluded from flat attributes.`,
    })
  }

  const startMs = Number(baseNs / 1_000_000n)
  const durationMs = nsToMs(rangeNs)
  const startedAt = new Date(startMs).toISOString()
  const endedAt = new Date(startMs + durationMs).toISOString()

  const provider = firstScalar(group, ['gen_ai.provider.name', 'gen_ai.system'])
  const model = firstScalar(group, ['gen_ai.request.model'])
  const rootName = spans.find((span) => !span.parentId)?.name
  const spanCount = spans.length

  const trace: Trace = {
    schemaVersion: 'agent-replay/v1',
    id: `otel_${traceId}`,
    task: {
      id: traceId,
      title: rootName ?? primaryService ?? `OTel trace ${traceId.slice(0, 8)}`,
      description: `${spanCount} spans · imported from OTLP JSON · task outcome not evaluated`,
    },
    agent: {
      name: primaryService ?? provider ?? 'OpenTelemetry',
      model,
    },
    status: 'partial',
    startedAt,
    endedAt,
    durationMs,
    result: {
      summary:
        'Imported OpenTelemetry trace. Span status is what the exporter reported, not a task verdict.',
    },
    capture: {
      fidelity: 'otel',
      timing: 'observed',
      adapter: 'otlp-json',
      sources: ['otlp'],
      workspaceVerification: 'unavailable',
    },
    spans,
    metadata: {
      source: 'otlp',
      otel: {
        traceId,
        spec: 'ExportTraceServiceRequest (OTLP JSON)',
        timing: {
          baseUnixNano: baseNs.toString(),
          unit: 'nanoseconds',
          source: 'exporter',
        },
        resources: traceResources,
        services,
        orphanParentIds: orphanIds,
        duplicateSpanIds: [...new Set(duplicateIds)],
        unsupported: {
          nestedAttributeValues: nestedAttributes,
          bytesValues,
          unsafeNumericValues: unsafeNumbers,
          events: eventCount,
          links: linkCount,
          droppedAttributes,
        },
      },
    },
  }

  try {
    return traceSchema.parse(trace)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new TraceImportError('OTLP trace could not be normalized into agent-replay/v1.', [
        ...error.issues.slice(0, 12).map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
          return `${path}: ${issue.message}`
        }),
      ])
    }
    throw error
  }
}

function firstScalar(group: CollectedSpan[], keys: string[]): string | undefined {
  for (const item of group) {
    for (const key of keys) {
      const value = item.attributes.scalars[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
  }
  return undefined
}

function resourceAttribute(resources: ResourceRecord[], key: string): string | undefined {
  for (const resource of resources) {
    for (const attribute of resource.attributes) {
      if (!isRecord(attribute) || attribute.key !== key) continue
      const value = readAnyValue(attribute.value)
      if (typeof value?.scalar === 'string' && value.scalar.length > 0) return value.scalar
    }
  }
  return undefined
}
