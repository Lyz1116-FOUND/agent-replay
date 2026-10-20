import { Link, NavLink } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { clsx } from 'clsx'
import { Button, Logo } from '../ui/primitives'
import { useUiStore } from '../../store/ui'

const navItems = [
  { to: '/', label: 'Runs', end: true },
  { to: '/compare', label: 'Compare', end: false },
]

export function TopBar() {
  const setImportOpen = useUiStore((state) => state.setImportOpen)

  return (
    <header className="flex h-12 shrink-0 items-center gap-6 border-b border-line bg-canvas px-4">
      <Link to="/" className="flex items-center gap-2.5">
        <Logo />
        <span className="font-mono text-[12px] font-medium tracking-[0.16em] text-ink">
          AGENT <span className="text-faint">REPLAY</span>
        </span>
      </Link>

      <nav className="flex h-full items-center gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              clsx(
                'relative flex h-full items-center px-2.5 text-[12px] transition-colors',
                isActive
                  ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-accent'
                  : 'text-muted hover:text-ink',
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-faint lg:inline">
          Visual debugger for coding agents
        </span>
        <Button size="sm" variant="subtle" onClick={() => setImportOpen(true)}>
          <Upload size={13} />
          Import trace
        </Button>
        <span className="hidden rounded-xs border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint sm:inline">
          v0.3
        </span>
      </div>
    </header>
  )
}
