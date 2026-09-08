import Link from 'next/link';
import type { ReactNode } from 'react';

import { LogoutButton } from './logout-button.js';
import { BellIcon, ChevronDownIcon, LogoMark, SearchIcon } from './icons.js';

type ActiveSection = 'dashboard' | 'workshops';

export function AppShell({ children, active = 'dashboard' }: { children: ReactNode; active?: ActiveSection }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <span className="brand-name">КУЛИСА</span>
        </div>

        <nav className="tabs" aria-label="Модули платформы">
          <Link
            href="/"
            aria-current={active === 'dashboard' ? 'page' : undefined}
            className={`tab${active === 'dashboard' ? ' tab--active' : ''}`}
          >
            Дашборд
          </Link>
          <Link
            href="/workshops"
            aria-current={active === 'workshops' ? 'page' : undefined}
            className={`tab${active === 'workshops' ? ' tab--active' : ''}`}
          >
            Цеха
          </Link>
          <span className="tab tab--soon" aria-disabled="true">
            Смета <sup>скоро</sup>
          </span>
          <span className="tab tab--soon" aria-disabled="true">
            Репетиции <sup>скоро</sup>
          </span>
          <span className="tab tab--soon" aria-disabled="true">
            Прокат <sup>скоро</sup>
          </span>
        </nav>

        <div className="topbar-actions">
          <button type="button" className="icon-chip" aria-label="Поиск">
            <SearchIcon />
          </button>
          <button type="button" className="icon-chip" aria-label="Уведомления">
            <BellIcon />
            <i className="icon-chip__badge" aria-hidden="true" />
          </button>

          <span className="topbar-divider" aria-hidden="true" />

          <button type="button" className="profile" aria-label="Профиль: Кулиса, Постановочная часть">
            <span className="profile-avatar" aria-hidden="true">
              К
            </span>
            <span className="profile-meta">
              <strong>Кулиса</strong>
              <span className="muted">Постановочная часть</span>
            </span>
            <ChevronDownIcon className="profile-chevron" />
          </button>

          <LogoutButton />
        </div>
      </header>

      {children}
    </div>
  );
}
