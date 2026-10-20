import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
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
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<RunsPage />} />
        <Route
          path="runs/:runId"
          element={
            <Suspense fallback={<PageLoading label="Loading replay" />}>
              <ReplayPage />
            </Suspense>
          }
        />
        <Route
          path="compare"
          element={
            <Suspense fallback={<PageLoading label="Loading comparison" />}>
              <ComparePage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
