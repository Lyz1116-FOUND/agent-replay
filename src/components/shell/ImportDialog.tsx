import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronRight, FileJson, Upload } from 'lucide-react'
import { clsx } from 'clsx'
import { importTraceFile, TraceImportError, type ImportResult } from '../../adapters/import'
import { sampleSweAgentText } from '../../data/sampleTraj'
import { Button, Modal, Segmented } from '../ui/primitives'
import { useRunsStore } from '../../store/runs'
import { useUiStore } from '../../store/ui'
import type { Trace } from '../../schema/trace'

type Mode = 'file' | 'paste'

export function ImportDialog() {
  const open = useUiStore((state) => state.importOpen)
  if (!open) return null
  return <ImportDialogContent />
}

function ImportDialogContent() {
  const setOpen = useUiStore((state) => state.setImportOpen)
  const addImported = useRunsStore((state) => state.addImported)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>('file')
  const [text, setText] = useState('')
  const [filename, setFilename] = useState<string | null>(null)
  const [error, setError] = useState<TraceImportError | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [dragging, setDragging] = useState(false)

  function openTrace(trace: Trace) {
    setOpen(false)
    navigate(`/runs/${trace.id}`)
  }

  function runImport(source: string) {
    setError(null)
    setResult(null)
    try {
      const imported = importTraceFile(source)
      for (const trace of imported.traces) addImported(trace)
      // A single trace still stays in the dialog when the import produced
      // diagnostics, otherwise orphan/precision warnings would never be seen.
      if (imported.traces.length === 1 && imported.diagnostics.length === 0) {
        openTrace(imported.traces[0])
      } else {
        setResult(imported)
      }
    } catch (caught) {
      if (caught instanceof TraceImportError) setError(caught)
      else
        setError(
          new TraceImportError('Unexpected error while importing.', [
            caught instanceof Error ? caught.message : String(caught),
          ]),
        )
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setResult(null)
    setFilename(file.name)
    setText(await file.text())
  }

  return (
    <Modal
      open
      onClose={() => setOpen(false)}
      title="Import trace"
      subtitle="Open a native Agent Replay trace, a SWE-agent .traj file, or an OTLP JSON trace export."
      width={600}
      footer={
        result ? (
          <>
            <span className="mr-auto font-mono text-[10px] text-faint">
              {result.traces.length} {result.traces.length === 1 ? 'run' : 'runs'} added
            </span>
            <Button size="sm" variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="mr-auto"
              onClick={() => {
                setText(sampleSweAgentText())
                setFilename('sample-swe-agent.traj')
                setMode('paste')
                setError(null)
                setResult(null)
              }}
            >
              Use sample .traj
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={!text} onClick={() => runImport(text)}>
              Import trace
            </Button>
          </>
        )
      }
    >
      <div className="mb-4 flex items-center justify-between">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'file', label: <><FileJson size={12} /> File</> },
            { value: 'paste', label: 'Paste JSON' },
          ]}
        />
        <span className="font-mono text-[10px] text-faint">agent-replay/v1 · .traj · OTLP JSON</span>
      </div>

      {result ? (
        <div className="rounded-sm border border-line bg-panel2/60 p-3">
          <div className="text-[12px] text-ink">
            {result.traces.length === 1
              ? 'Imported 1 trace with diagnostics'
              : `This file holds ${result.traces.length} traces`}
          </div>
          <p className="mt-0.5 text-[11px] text-faint">
            {result.traces.length === 1
              ? 'Review the notes below, then open the run.'
              : 'Each OTel traceId becomes its own run. Pick one to open.'}
          </p>
          <div className="mt-2.5 space-y-1">
            {result.traces.map((trace) => (
              <button
                key={trace.id}
                onClick={() => openTrace(trace)}
                className="flex w-full items-center gap-2 rounded-xs border border-line/70 bg-panel px-2 py-1.5 text-left transition-colors hover:border-line-strong hover:bg-panel3"
              >
                <span className="truncate text-[11.5px] text-ink">{trace.task.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[9.5px] text-faint">
                  {trace.spans.length} spans
                </span>
                <ChevronRight size={11} className="shrink-0 text-faint" />
              </button>
            ))}
          </div>
          {result.diagnostics.length > 0 ? (
            <ul className="mt-2.5 space-y-1 border-t border-line/70 pt-2">
              {result.diagnostics.slice(0, 6).map((diagnostic) => (
                <li
                  key={diagnostic.message}
                  className={clsx(
                    'font-mono text-[10px] leading-relaxed',
                    diagnostic.level === 'warning' ? 'text-warn/90' : 'text-faint',
                  )}
                >
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : mode === 'file' ? (
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void readFile(event.dataTransfer.files[0])
          }}
          onClick={() => inputRef.current?.click()}
          className={clsx(
            'flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed transition-colors',
            dragging
              ? 'border-accent bg-accent/5'
              : 'border-line-strong bg-panel2/40 hover:border-muted',
          )}
        >
          <Upload size={18} className="text-muted" />
          <p className="text-[13px] text-ink">Drop a .json or .traj file</p>
          <p className="text-[11px] text-faint">or click to browse</p>
          <input
            ref={inputRef}
            type="file"
            accept=".json,.traj,application/json"
            className="hidden"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setFilename(null)
            setError(null)
            setResult(null)
          }}
          spellCheck={false}
          placeholder='{ "schemaVersion": "agent-replay/v1", ... }'
          className="h-48 w-full resize-none rounded-sm border border-line bg-[#0b0e13] p-3 font-mono text-[11px] leading-relaxed text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
      )}

      {filename && text && !result ? (
        <div className="mt-3 flex items-center justify-between rounded-sm border border-line bg-panel2/60 px-3 py-2">
          <span className="truncate font-mono text-[11px] text-muted">{filename}</span>
          <span className="ml-3 shrink-0 font-mono text-[10px] text-faint">
            {text.length.toLocaleString()} chars
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-sm border border-fail/40 bg-fail/5 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12px] font-medium text-fail">
            <AlertTriangle size={13} />
            {error.message}
          </div>
          {error.issues.length > 0 ? (
            <ul className="mt-2 space-y-1 pl-5">
              {error.issues.slice(0, 6).map((issue) => (
                <li key={issue} className="list-disc font-mono text-[10.5px] leading-relaxed text-fail/85">
                  {issue}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        SWE-agent trajectories have no timestamps, so their durations are estimated and marked in
        the inspector. OTel imports keep exporter timestamps and hierarchy, but are never counted as
        workspace-verified. Nothing is uploaded — traces stay in your browser.
      </p>
    </Modal>
  )
}
