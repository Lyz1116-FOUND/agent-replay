import { lazy, Suspense } from 'react'
import { Navigate, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { useT } from './i18n'
import { RunsPage } from './pages/RunsPage'
import { NotFoundPage } from './pages/NotFoundPage'

const ReplayPage = lazy(() =>
  import('./pages/ReplayPage').then((module) => ({ default: module.ReplayPage })),
)
const ComparePage = lazy(() =>
  import('./pages/ComparePage').then((module) => ({ default: module.ComparePage })),
)

function PageLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2.5 text-[11.5px] text-faint">
      <span className="h-3 w-3 animate-spin rounded-full border border-line-strong border-t-accent" />
      {label}
    </div>
  )
}

export default function App() {
  const t = useT()
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            import.meta.env.MODE === 'demo' ? (
              <Navigate to="/runs/run_lru_codex_9f2a?step=s06" replace />
            ) : (
              <RunsPage />
            )
          }
        />
        <Route path="runs" element={<RunsPage />} />
        <Route
          path="runs/:runId"
          element={
            <Suspense fallback={<PageLoading label={t('loading.replay')} />}>
              <ReplayPage />
            </Suspense>
          }
        />
        <Route
          path="compare"
          element={
            <Suspense fallback={<PageLoading label={t('loading.compare')} />}>
              <ComparePage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
