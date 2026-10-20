import Editor, { DiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import '../../lib/monacoSetup'

const BASE_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  domReadOnly: true,
  minimap: { enabled: false },
  fontSize: 12,
  lineHeight: 19,
  fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
  fontLigatures: false,
  scrollBeyondLastLine: false,
  renderLineHighlight: 'none',
  padding: { top: 12, bottom: 24 },
  automaticLayout: true,
  wordWrap: 'off',
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: false,
  contextmenu: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  renderWhitespace: 'none',
  stickyScroll: { enabled: false },
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  bracketPairColorization: { enabled: false },
  guides: { indentation: false, bracketPairs: false },
}

const DIFF_OPTIONS: editor.IDiffEditorConstructionOptions = {
  ...BASE_OPTIONS,
  renderSideBySide: true,
  useInlineViewWhenSpaceIsLimited: true,
  renderOverviewRuler: false,
  originalEditable: false,
  diffWordWrap: 'off',
  renderMarginRevertIcon: false,
}

function EditorLoading() {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 bg-[#0d1015] px-6">
      {[72, 54, 63, 40, 58].map((width, index) => (
        <div
          key={index}
          className="h-2 animate-pulse rounded-xs bg-panel2"
          style={{ width: `${width}%`, animationDelay: `${index * 70}ms` }}
        />
      ))}
    </div>
  )
}

export function CodeViewer({ content, language }: { content: string; language: string }) {
  return (
    <div className="h-full min-h-0">
      <Editor
        height="100%"
        theme="agent-replay"
        language={language}
        value={content}
        options={BASE_OPTIONS}
        loading={<EditorLoading />}
      />
    </div>
  )
}

export function DiffViewer({
  before,
  after,
  language,
}: {
  before: string
  after: string
  language?: string
}) {
  return (
    <div className="h-full min-h-0">
      <DiffEditor
        height="100%"
        theme="agent-replay"
        language={language ?? 'plaintext'}
        original={before}
        modified={after}
        options={DIFF_OPTIONS}
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        loading={<EditorLoading />}
      />
    </div>
  )
}
