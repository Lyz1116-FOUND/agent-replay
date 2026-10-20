import type { Artifact, ArtifactKind, SpanType } from '../schema/trace'

export const PREFERRED_ARTIFACTS: Record<SpanType, ArtifactKind[]> = {
  agent: ['markdown', 'reasoning', 'terminal'],
  generation: ['markdown', 'reasoning'],
  reasoning: ['reasoning', 'markdown'],
  read: ['code', 'markdown', 'terminal'],
  search: ['search', 'terminal'],
  edit: ['diff', 'patch', 'terminal'],
  shell: ['terminal', 'markdown'],
  test: ['test', 'terminal'],
  browser: ['browser', 'markdown'],
  tool: ['terminal', 'code', 'markdown'],
  unknown: ['terminal', 'markdown'],
  checkpoint: ['patch', 'terminal', 'diff'],
  final: ['markdown', 'patch', 'test'],
}

export function preferredArtifactIndex(span: { type: SpanType; artifacts?: Artifact[] }): number {
  const artifacts = span.artifacts ?? []
  const preference = PREFERRED_ARTIFACTS[span.type] ?? []
  const index = artifacts.findIndex((artifact) => preference.includes(artifact.kind))
  return index >= 0 ? index : 0
}

export function artifactLabel(artifact: Artifact): string {
  switch (artifact.kind) {
    case 'code':
      return artifact.path.split('/').pop() ?? artifact.path
    case 'diff':
      return artifact.path.split('/').pop() ?? artifact.path
    case 'terminal':
      return 'Terminal'
    case 'test':
      return 'Test results'
    case 'search':
      return `Search "${artifact.query}"`
    case 'reasoning':
      return 'Reasoning summary'
    case 'patch':
      return 'Patch'
    case 'markdown':
      return 'Summary'
    case 'browser':
      return 'Browser'
  }
}

export function artifactDetail(artifact: Artifact): string | undefined {
  switch (artifact.kind) {
    case 'code':
      return artifact.language
    case 'diff': {
      const { added } = diffLineStats(artifact.before, artifact.after)
      return `${added} ${added === 1 ? 'addition' : 'additions'}`
    }
    case 'terminal':
      return `exit ${artifact.exitCode}`
    case 'test':
      return `${artifact.passed}/${artifact.total} passed`
    case 'search':
      return `${artifact.results.length} results`
    case 'patch': {
      const { added } = patchStats(artifact.diff)
      return `${added} ${added === 1 ? 'addition' : 'additions'}`
    }
    default:
      return undefined
  }
}

export function diffLineStats(before: string, after: string) {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const beforeSet = new Set(beforeLines)
  const afterSet = new Set(afterLines)
  const added = afterLines.filter((line) => !beforeSet.has(line)).length
  const removed = beforeLines.filter((line) => !afterSet.has(line)).length
  return { added, removed }
}

export function patchStats(diff: string) {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1
    if (line.startsWith('-') && !line.startsWith('---')) removed += 1
  }
  return { added, removed }
}

export function artifactKey(artifact: Artifact, index: number): string {
  return `${artifact.kind}-${index}`
}
