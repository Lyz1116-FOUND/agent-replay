import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">404</span>
      <h1 className="mt-3 text-[20px] font-semibold text-ink">This trace does not exist</h1>
      <p className="mt-1.5 text-[12.5px] text-muted">
        It may have been removed from local storage.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex items-center gap-1.5 rounded-sm border border-line bg-panel2 px-3 py-1.5 text-[12px] text-ink transition-colors hover:border-line-strong"
      >
        Back to runs
        <ArrowRight size={13} />
      </Link>
    </div>
  )
}
