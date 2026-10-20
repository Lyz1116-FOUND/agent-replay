import type { Artifact, ArtifactKind, SpanType } from '../schema/trace'
import { t, tn } from '../i18n'

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
      return t('artifact.terminal')
    case 'test':
      return t('artifact.test')
    case 'search':
      return t('artifact.search', { query: artifact.query })
    case 'reasoning':
      return t('artifact.reasoning')
    case 'patch':
      return t('artifact.patch')
    case 'markdown':
      return t('artifact.markdown')
    case 'browser':
      return t('artifact.browser')
  }
}

export function artifactDetail(artifact: Artifact): string | undefined {
  switch (artifact.kind) {
    case 'code':
      return artifact.language
    case 'diff': {
      const { added } = diffLineStats(artifact.before, artifact.after)
      return tn('artifact.additions', added)
    }
    case 'terminal':
      return t('artifact.exit', { code: artifact.exitCode })
    case 'test':
      return t('artifact.testSummary', {
        passed: artifact.passed,
        total: artifact.total,
      })
    case 'search':
      return tn('artifact.results', artifact.results.length)
    case 'patch': {
      const { added } = patchStats(artifact.diff)
      return tn('artifact.additions', added)
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
