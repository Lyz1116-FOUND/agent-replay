import { Link, NavLink } from 'react-router-dom'
import { Languages, Upload } from 'lucide-react'
import { clsx } from 'clsx'
import { Button, Logo } from '../ui/primitives'
import { useUiStore } from '../../store/ui'
import { toggleLocale, useLocale, useT } from '../../i18n'

const navItems = [
  { to: '/', key: 'nav.runs', end: true },
  { to: '/compare', key: 'nav.compare', end: false },
] as const

export function TopBar() {
  const setImportOpen = useUiStore((state) => state.setImportOpen)
  const locale = useLocale()
  const t = useT()

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
            {t(item.key)}
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-faint lg:inline">
          {t('app.tagline')}
        </span>
        <button
          onClick={toggleLocale}
          title={t('lang.switch')}
          aria-label={t('lang.switch')}
          className="flex h-6 items-center gap-1 rounded-xs border border-line px-1.5 font-mono text-[10px] text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          <Languages size={11} />
          {locale === 'zh' ? 'EN' : '中文'}
        </button>
        <Button size="sm" variant="subtle" onClick={() => setImportOpen(true)}>
          <Upload size={13} />
          {t('app.import')}
        </Button>
        <span className="hidden rounded-xs border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint sm:inline">
          v0.3
        </span>
      </div>
    </header>
  )
}
