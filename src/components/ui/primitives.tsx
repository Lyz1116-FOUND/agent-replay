import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect } from 'react'
import { clsx } from 'clsx'
import { X } from 'lucide-react'
import type { TraceStatus } from '../../schema/trace'
import { STATUS_COLORS } from '../../lib/trace'
import { useT } from '../../i18n'

const STATUS_KEYS = {
  pass: 'status.pass',
  fail: 'status.fail',
  partial: 'status.partial',
  running: 'status.running',
} as const

type ButtonVariant = 'primary' | 'ghost' | 'subtle' | 'danger'
type ButtonSize = 'sm' | 'md'

export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  return (
    <button
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 rounded-sm border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' &&
          'border-accent bg-accent text-[#05101f] hover:border-[#6fafff] hover:bg-[#6fafff]',
        variant === 'ghost' &&
          'border-transparent text-muted hover:bg-panel2 hover:text-ink',
        variant === 'subtle' &&
          'border-line bg-panel2 text-ink hover:border-line-strong hover:bg-panel3',
        variant === 'danger' &&
          'border-transparent text-fail hover:bg-fail/10',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function StatusPill({
  status,
  label,
  className,
}: {
  status: TraceStatus
  label?: string
  className?: string
}) {
  const t = useT()
  const text = label ?? t(STATUS_KEYS[status])
  return (
    <span
      className={clsx(
        'inline-flex h-5 items-center gap-1.5 rounded-xs border px-1.5 font-mono text-[10px] font-medium tracking-[0.08em]',
        className,
      )}
      style={{
        color: STATUS_COLORS[status],
        borderColor: `color-mix(in srgb, ${STATUS_COLORS[status]} 35%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${STATUS_COLORS[status]} 9%, transparent)`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: STATUS_COLORS[status] }}
      />
      {text}
    </span>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: ReactNode; title?: string }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      className={clsx(
        'inline-flex h-7 items-center rounded-sm border border-line bg-panel p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={clsx(
            'inline-flex h-6 items-center gap-1.5 rounded-xs px-2 text-[11px] font-medium transition-colors',
            value === option.value
              ? 'bg-panel3 text-ink'
              : 'text-faint hover:text-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-panel px-1 font-mono text-[10px] text-faint">
      {children}
    </kbd>
  )
}

export function AgentBadge({ name, model }: { name: string; model?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border border-line bg-panel2 font-mono text-[9px] uppercase text-muted">
        {name.slice(0, 1)}
      </span>
      <span className="truncate text-ink">{name}</span>
      {model ? <span className="truncate font-mono text-[11px] text-faint">{model}</span> : null}
    </span>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 560,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const t = useT()
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full overflow-hidden rounded-md border border-line-strong bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-sm p-1 text-faint transition-colors hover:bg-panel2 hover:text-ink"
            aria-label={t('dialog.close')}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-panel px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="4.5" width="13" height="2.4" rx="1.2" fill="#4d9bff" />
      <rect x="2" y="10.8" width="9" height="2.4" rx="1.2" fill="#4d9bff" opacity="0.55" />
      <rect x="2" y="17.1" width="11" height="2.4" rx="1.2" fill="#4d9bff" opacity="0.28" />
      <path d="M16.5 7.2L22 12l-5.5 4.8V7.2z" fill="#e7eaf0" />
    </svg>
  )
}
