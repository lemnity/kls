import Link from 'next/link';
import type { ReactNode } from 'react';

import { LogoutButton } from './logout-button.js';
import { BellIcon, CalendarIcon, DashboardIcon, DocumentIcon, HelpIcon, LayersIcon, LogoMark, SearchIcon } from './icons.js';

type ActiveSection = 'dashboard' | 'workshops';

export function AppShell({ children, active = 'dashboard' }: { children: ReactNode; active?: ActiveSection }) {
  return (
    <div className="app-shell">
      <aside className="icon-rail" aria-label="Разделы платформы">
        <Link
          href="/"
          aria-current={active === 'dashboard' ? 'page' : undefined}
          title="Дашборд"
          className={`rail-icon${active === 'dashboard' ? ' rail-icon--active' : ''}`}
        >
          <DashboardIcon />
        </Link>
        <Link
          href="/workshops"
          aria-current={active === 'workshops' ? 'page' : undefined}
          title="Цеха"
          className={`rail-icon${active === 'workshops' ? ' rail-icon--active' : ''}`}
        >
          <LayersIcon />
        </Link>
        <span className="rail-icon" aria-disabled="true" title="Репетиции — скоро">
          <CalendarIcon />
        </span>
        <span className="rail-icon" aria-disabled="true" title="Паспорт спектакля — скоро">
          <DocumentIcon />
        </span>
        <span className="rail-icon rail-icon--bottom" aria-disabled="true" title="Помощь — скоро">
          <HelpIcon />
        </span>
      </aside>

      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <span className="brand-name">КУЛИСА</span>
        </div>

        <nav className="tabs" aria-label="Модули платформы">
          <Link href="/" aria-current={active === 'dashboard' ? 'page' : undefined} className={`tab${active === 'dashboard' ? ' tab--active' : ''}`}>
            Дашборд
          </Link>
          <span className="tab tab--soon" aria-disabled="true">
            Смета <sup>скоро</sup>
          </span>
          <Link href="/workshops" aria-current={active === 'workshops' ? 'page' : undefined} className={`tab${active === 'workshops' ? ' tab--active' : ''}`}>
            Цеха
          </Link>
          <span className="tab tab--soon" aria-disabled="true">
            Прокат <sup>скоро</sup>
          </span>
        </nav>

        <div className="topbar-actions">
          <span className="icon-chip" aria-hidden="true">
            <SearchIcon />
          </span>
          <span className="icon-chip" aria-hidden="true">
            <BellIcon />
          </span>
          <LogoutButton />
        </div>
      </header>

      {children}
    </div>
  );
}
