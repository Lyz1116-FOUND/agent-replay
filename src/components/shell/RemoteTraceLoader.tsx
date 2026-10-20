import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { importTraceFile, TraceImportError } from '../../adapters/import'
import { useRunsStore } from '../../store/runs'
import { useT } from '../../i18n'

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; issues: string[] }

function fileName(src: string): string {
  return decodeURIComponent(src.split('/').pop() ?? src)
}

export function RemoteTraceLoader() {
  const t = useT()
  const location = useLocation()
  const navigate = useNavigate()
  const addTransient = useRunsStore((state) => state.addTransient)
  const [state, setState] = useState<LoadState>({ status: 'idle' })
  const loadedRef = useRef<string | null>(null)
  const src = new URLSearchParams(location.search).get('trace')

  useEffect(() => {
    if (!src || !src.startsWith('/')) return
    if (loadedRef.current === src) return
    loadedRef.current = src
    let cancelled = false
    setState({ status: 'loading' })

    fetch(src, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${src}`)
        return response.text()
      })
      .then((text) => {
        if (cancelled) return
        const { traces } = importTraceFile(text)
        for (const trace of traces) addTransient(trace)
        setState({ status: 'idle' })
        const first = traces[0]
        navigate({ pathname: `/runs/${first.id}`, search: location.search }, { replace: true })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof TraceImportError) {
          setState({ status: 'error', message: error.message, issues: error.issues })
        } else {
          setState({
            status: 'error',
            message: t('remote.failed'),
            issues: [error instanceof Error ? error.message : String(error)],
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [src, addTransient, navigate, location.search, t])

  if (state.status === 'idle') return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex justify-center px-4">
      <div
        className={`pointer-events-auto w-full max-w-[560px] rounded-sm border px-3 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.45)] ${
          state.status === 'error'
            ? 'border-fail/40 bg-[#1a1012]'
            : 'border-line-strong bg-panel'
        }`}
      >
        {state.status === 'loading' ? (
          <div className="flex items-center gap-2.5 text-[12px] text-muted">
            <Loader2 size={14} className="animate-spin text-accent" />
            {t('remote.loading', { file: fileName(src ?? '') })}
          </div>
        ) : (
          <div>
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-fail" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-fail">{state.message}</div>
                {state.issues.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {state.issues.slice(0, 4).map((issue) => (
                      <li key={issue} className="truncate font-mono text-[10px] text-fail/80">
                        {issue}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button
                onClick={() => setState({ status: 'idle' })}
                className="rounded-xs p-0.5 text-faint hover:text-ink"
                aria-label={t('remote.dismiss')}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
