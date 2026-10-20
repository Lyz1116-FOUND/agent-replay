import { useState } from 'react'
import { clsx } from 'clsx'
import {
  ArrowUpRight,
  Brain,
  FileCode2,
  Flag,
  Globe,
  Search,
  Terminal as TerminalIcon,
} from 'lucide-react'
import type { Artifact, Span } from '../../schema/trace'
import { artifactDetail, artifactKey, artifactLabel, diffLineStats, patchStats, preferredArtifactIndex } from '../../lib/artifacts'
import { spanDuration } from '../../lib/trace'
import { CodeViewer, DiffViewer } from './CodeViews'
import { useReplayStore } from '../../store/replay'
import { SpanIcon } from '../spanMeta'
import { spanLabel, tn, useLocale, useT } from '../../i18n'

export function ArtifactStage({ span }: { span: Span }) {
  // Subscribes this subtree to locale changes for the tab labels below.
  useLocale()
  const artifacts = span.artifacts ?? []
  const [active, setActive] = useState(() => preferredArtifactIndex(span))

  if (artifacts.length === 0) return <EmptyArtifact span={span} />

  const artifact = artifacts[active] ?? artifacts[0]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {artifacts.length > 1 ? (
        <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-panel px-2">
          {artifacts.map((item, index) => (
            <button
              key={artifactKey(item, index)}
              onClick={() => setActive(index)}
              className={clsx(
                'flex h-6 shrink-0 items-center gap-1.5 rounded-xs px-2 font-mono text-[10.5px] transition-colors',
                index === active
                  ? 'bg-panel3 text-ink'
                  : 'text-faint hover:bg-panel2 hover:text-muted',
              )}
            >
              {artifactGlyph(item)}
              {artifactLabel(item)}
              {artifactDetail(item) ? (
                <span className="text-[9.5px] text-faint">{artifactDetail(item)}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <ArtifactView artifact={artifact} />
      </div>
    </div>
  )
}

function artifactGlyph(artifact: Artifact) {
  switch (artifact.kind) {
    case 'code':
    case 'diff':
      return <FileCode2 size={11} />
    case 'terminal':
      return <TerminalIcon size={11} />
    case 'test':
      return <SpanIcon type="test" size={11} />
    case 'search':
      return <Search size={11} />
    case 'reasoning':
      return <Brain size={11} />
    case 'patch':
      return <FileCode2 size={11} />
    case 'markdown':
      return <Flag size={11} />
    case 'browser':
      return <Globe size={11} />
  }
}

function ArtifactView({ artifact }: { artifact: Artifact }) {
  switch (artifact.kind) {
    case 'code':
      return <CodeArtifact artifact={artifact} />
    case 'diff':
      return <DiffArtifactView artifact={artifact} />
    case 'terminal':
      return <TerminalArtifact artifact={artifact} />
    case 'test':
      return <TestArtifact artifact={artifact} />
    case 'search':
      return <SearchArtifact artifact={artifact} />
    case 'reasoning':
      return <ReasoningArtifact artifact={artifact} />
    case 'patch':
      return <PatchArtifact artifact={artifact} />
    case 'markdown':
      return <MarkdownArtifact artifact={artifact} />
    case 'browser':
      return <BrowserArtifact artifact={artifact} />
  }
}

function FileBar({
  path,
  meta,
  extra,
}: {
  path: string
  meta?: React.ReactNode
  extra?: React.ReactNode
}) {
  const segments = path.split('/')
  const file = segments.pop()
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-3.5">
      <FileCode2 size={12} className="shrink-0 text-faint" />
      <span className="truncate font-mono text-[11px] text-faint">
        {segments.length > 0 ? `${segments.join('/')}/` : ''}
        <span className="text-ink">{file}</span>
      </span>
      {extra}
      <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">{meta}</span>
    </div>
  )
}

function CodeArtifact({ artifact }: { artifact: Extract<Artifact, { kind: 'code' }> }) {
  const t = useT()
  const lines = artifact.content.replace(/\n$/, '').split('\n').length
  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileBar
        path={artifact.path}
        meta={tn('artifact.lines', lines, { language: artifact.language })}
        extra={
          artifact.startLine ? (
            <span className="shrink-0 rounded-xs border border-line px-1 font-mono text-[9.5px] text-faint">
              {t('artifact.fromLine', { line: artifact.startLine })}
            </span>
          ) : null
        }
      />
      <div className="min-h-0 flex-1">
        <CodeViewer content={artifact.content} language={artifact.language} />
      </div>
    </div>
  )
}

function DiffArtifactView({ artifact }: { artifact: Extract<Artifact, { kind: 'diff' }> }) {
  const stats = diffLineStats(artifact.before, artifact.after)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <FileBar
        path={artifact.path}
        meta={artifact.language}
        extra={
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
            <span className="text-pass">+{stats.added}</span>
            <span className="text-fail">-{stats.removed}</span>
          </span>
        }
      />
      <div className="min-h-0 flex-1">
        <DiffViewer before={artifact.before} after={artifact.after} language={artifact.language} />
      </div>
    </div>
  )
}

function toneForTerminalLine(line: string): string {
  if (/^(FAILED|ERROR|Traceback|E\s)/.test(line) || /\bfailed\b/i.test(line)) return 'text-fail'
  if (/\bpassed\b/i.test(line)) return 'text-pass'
  if (/warning/i.test(line)) return 'text-warn'
  if (line.startsWith('===')) return 'text-faint'
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-pass'
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-fail'
  return 'text-[#b7c0cd]'
}

function TerminalArtifact({ artifact }: { artifact: Extract<Artifact, { kind: 'terminal' }> }) {
  const t = useT()
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0e13]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3.5 font-mono text-[11px]">
        <span className="text-pass">$</span>
        <span className="truncate text-ink">{artifact.command}</span>
        <span className="ml-auto shrink-0 text-[10px] text-faint">{artifact.cwd}</span>
      </div>
      <div className="panel-scroll min-h-0 flex-1 overflow-auto py-3">
        <pre className="min-w-max px-4 font-mono text-[11.5px] leading-[1.65]">
          {artifact.output.split('\n').map((line, index) => (
            <div key={index} className={toneForTerminalLine(line)}>
              {line || ' '}
            </div>
          ))}
        </pre>
      </div>
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-line px-3.5 font-mono text-[10px] text-faint">
        <span>{t('artifact.processExited')}</span>
        <span className={artifact.exitCode === 0 ? 'text-pass' : 'text-fail'}>
          {t('artifact.exit', { code: artifact.exitCode })}
        </span>
      </div>
    </div>
  )
}

function TestArtifact({ artifact }: { artifact: Extract<Artifact, { kind: 'test' }> }) {
  const t = useT()
  const total = Math.max(artifact.total, 1)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line bg-panel px-5 py-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="eyebrow">{t('artifact.testRun')}</div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono">
              <span className={artifact.failed > 0 ? 'text-[22px] text-fail' : 'text-[22px] text-pass'}>
                {artifact.passed}
              </span>
              <span className="text-[13px] text-faint">
                {t('artifact.passedOf', { total: artifact.total })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px]">
            <span className="text-faint">
              {t('artifact.cmd')} <span className="text-muted">{artifact.command}</span>
            </span>
            {artifact.failed > 0 ? (
              <span className="rounded-xs border border-fail/35 bg-fail/10 px-1.5 py-0.5 text-fail">
                {tn('artifact.failed', artifact.failed)}
              </span>
            ) : (
              <span className="rounded-xs border border-pass/35 bg-pass/10 px-1.5 py-0.5 text-pass">
                {t('artifact.allGreen')}
              </span>
            )}
          </div>
        </div>
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-xs bg-panel3">
          <div className="bg-pass" style={{ width: `${(artifact.passed / total) * 100}%` }} />
          <div className="bg-fail" style={{ width: `${(artifact.failed / total) * 100}%` }} />
        </div>
      </div>

      {artifact.failedTests && artifact.failedTests.length > 0 ? (
        <div className="shrink-0 border-b border-line bg-fail/[0.04] px-5 py-3">
          <div className="eyebrow text-fail/70">{t('artifact.failedTitle')}</div>
          <ul className="mt-1.5 space-y-1">
            {artifact.failedTests.map((test) => (
              <li key={test} className="flex items-center gap-2 font-mono text-[11px] text-fail/90">
                <span className="h-1 w-1 shrink-0 rounded-full bg-fail" />
                <span className="truncate">{test}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="panel-scroll min-h-0 flex-1 overflow-auto bg-[#0b0e13] py-3">
        <pre className="min-w-max px-4 font-mono text-[11px] leading-[1.7]">
          {artifact.output.split('\n').map((line, index) => (
            <div key={index} className={toneForTerminalLine(line)}>
              {line || ' '}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}

function SearchArtifact({ artifact }: { artifact: Extract<Artifact, { kind: 'search' }> }) {
  const t = useT()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-4">
        <Search size={13} className="text-faint" />
        <span className="font-mono text-[12px] text-ink">{artifact.query}</span>
        <span className="ml-auto font-mono text-[10px] text-faint">
          {tn('artifact.matches', artifact.results.length)}
        </span>
      </div>
      <div className="panel-scroll min-h-0 flex-1 py-2">
        {artifact.results.map((result, index) => {
          const segments = result.path.split('/')
          const file = segments.pop()
          return (
            <div
              key={`${result.path}-${result.line}-${index}`}
              className="group flex items-start gap-3 border-b border-line/50 px-4 py-2.5 transition-colors hover:bg-panel2/60"
            >
              <span className="mt-0.5 shrink-0 font-mono text-[10px] text-faint">
                {String(result.line).padStart(3, '0')}
              </span>
              <div className="min-w-0">
                <div className="truncate font-mono text-[10.5px] text-faint">
                  {segments.length > 0 ? `${segments.join('/')}/` : ''}
                  <span className="text-accent/80">{file}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[11.5px] text-[#c2cbd6]">
                  {result.preview}
                </div>
              </div>
              <ArrowUpRight
                size={12}
                className="ml-auto mt-1 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
              />
            </div>
          )
        })}
        {artifact.results.length === 0 ? (
          <div className="px-4 py-10 text-center font-mono text-[11px] text-faint">
            {t('artifact.noMatches')}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ReasoningArtifact({ artifact }: { artifact: Extract<Artifact, { kind: 'reasoning' }> }) {
  const t = useT()
  return (
    <div className="panel-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[620px] px-8 py-10">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-warn" />
          <span className="eyebrow">{t('artifact.reasoning')}</span>
        </div>
        <p className="mt-5 whitespace-pre-line text-[14.5px] leading-[1.8] text-[#d5dbe4]">
          {artifact.content}
        </p>
        <div className="mt-10 border-t border-line pt-3 text-[10.5px] leading-relaxed text-faint">
          {t('artifact.reasoningNote')}
        </div>
      </div>
    </div>
  )
}

function PatchArtifact({ artifact }: { artifact: Extract<Artifact, { kind: 'patch' }> }) {
  const t = useT()
  const stats = patchStats(artifact.diff)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-3.5">
        <FileCode2 size={12} className="text-faint" />
        <span className="font-mono text-[11px] text-ink">{t('artifact.unifiedPatch')}</span>
        <span className="ml-auto font-mono text-[10px]">
          <span className="text-pass">+{stats.added}</span>{' '}
          <span className="text-fail">-{stats.removed}</span>
        </span>
      </div>
      <div className="panel-scroll min-h-0 flex-1 overflow-auto bg-[#0b0e13] py-2">
        <pre className="min-w-max font-mono text-[11px] leading-[1.7]">
          {artifact.diff.split('\n').map((line, index) => {
            const header =
              line.startsWith('diff --git') ||
              line.startsWith('index ') ||
              line.startsWith('--- ') ||
              line.startsWith('+++ ')
            const hunk = line.startsWith('@@')
            const added = line.startsWith('+') && !header
            const removed = line.startsWith('-') && !header
            return (
              <div
                key={index}
                className={clsx(
                  'whitespace-pre px-4',
                  header && 'bg-panel2/70 text-faint',
                  hunk && 'mt-1 bg-accent/5 text-accent/80',
                  added && 'bg-pass/[0.06] text-pass',
                  removed && 'bg-fail/[0.06] text-fail',
                  !header && !hunk && !added && !removed && 'text-muted',
                )}
              >
                {line || ' '}
              </div>
            )
          })}
        </pre>
      </div>
    </div>
  )
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
          <code
            key={index}
            className="rounded-xs border border-line bg-panel2 px-1 py-[1px] font-mono text-[0.88em] text-[#c9d6e4]"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}

function Markdown({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <div>
      {lines.map((line, index) => {
        if (!line.trim()) return <div key={index} className="h-2" />
        if (line.startsWith('## ')) {
          return (
            <h2 key={index} className="mb-2 mt-5 text-[14px] font-semibold text-ink">
              <InlineMarkdown text={line.slice(3)} />
            </h2>
          )
        }
        if (line.startsWith('# ')) {
          return (
            <h1 key={index} className="mb-2 text-[17px] font-semibold text-ink">
              <InlineMarkdown text={line.slice(2)} />
            </h1>
          )
        }
        if (line.startsWith('- ')) {
          return (
            <div key={index} className="flex gap-2.5 py-1 text-[13px] leading-relaxed text-[#c4ccd8]">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" />
              <span>
                <InlineMarkdown text={line.slice(2)} />
              </span>
            </div>
          )
        }
        return (
          <p key={index} className="py-1 text-[13px] leading-relaxed text-[#c4ccd8]">
            <InlineMarkdown text={line} />
          </p>
        )
      })}
    </div>
  )
}

function MarkdownArtifact({ artifact }: { artifact: Extract<Artifact, { kind: 'markdown' }> }) {
  const t = useT()
  const trace = useReplayStore((state) => state.trace)
  const patch = trace?.result.patch
  const stats = patch ? patchStats(patch) : null
  return (
    <div className="panel-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-8 py-9">
        <div className="flex items-center gap-2">
          <Flag size={14} className="text-pass" />
          <span className="eyebrow">{t('artifact.finalReport')}</span>
        </div>
        <div className="mt-5">
          <Markdown content={artifact.content} />
        </div>
        <div className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-line bg-line">
          <div className="bg-panel px-3 py-2.5">
            <div className="eyebrow">{t('artifact.result')}</div>
            <div className="mt-1 font-mono text-[12px] text-pass">
              {trace?.status === 'pass' ? 'PASS' : trace?.status.toUpperCase()}
            </div>
          </div>
          <div className="bg-panel px-3 py-2.5">
            <div className="eyebrow">{t('artifact.tests')}</div>
            <div className="mt-1 font-mono text-[12px] text-ink">
              {trace?.result.tests
                ? `${trace.result.tests.passed}/${trace.result.tests.total}`
                : '—'}
            </div>
          </div>
          <div className="bg-panel px-3 py-2.5">
            <div className="eyebrow">{t('artifact.patchLabel')}</div>
            <div className="mt-1 font-mono text-[12px]">
              {stats ? (
                <>
                  <span className="text-pass">+{stats.added}</span>{' '}
                  <span className="text-fail">-{stats.removed}</span>
                </>
              ) : (
                <span className="text-faint">—</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BrowserArtifact({ artifact }: { artifact: Extract<Artifact, { kind: 'browser' }> }) {
  const t = useT()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-3.5">
        <Globe size={12} className="text-faint" />
        <span className="truncate font-mono text-[11px] text-ink">{artifact.url}</span>
      </div>
      <div className="panel-scroll min-h-0 flex-1 p-5">
        {artifact.screenshot ? (
          <img
            src={artifact.screenshot}
            alt={t('artifact.screenshotAlt', { url: artifact.url })}
            className="rounded-sm border border-line"
          />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-sm border border-dashed border-line bg-panel2/40 font-mono text-[11px] text-faint">
            {t('artifact.screenshotMissing')}
          </div>
        )}
        <div className="mt-5">
          <div className="eyebrow">{t('artifact.actions')}</div>
          <ol className="mt-2 space-y-1.5">
            {artifact.actions.map((action, index) => (
              <li key={index} className="flex gap-2 font-mono text-[11px] text-muted">
                <span className="text-faint">{String(index + 1).padStart(2, '0')}</span>
                {action}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

function EmptyArtifact({ span }: { span: Span }) {
  const t = useT()
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <SpanIcon type={span.type} size={20} />
      <p className="mt-3 text-[13px] text-ink">{t('artifact.empty.title')}</p>
      <p className="mt-1 max-w-[320px] text-[11.5px] leading-relaxed text-muted">
        {t('artifact.empty.body')}
      </p>
      <div className="mt-4 font-mono text-[10px] text-faint">
        {spanLabel(span.type)} · {spanDuration(span)}ms
      </div>
    </div>
  )
}
