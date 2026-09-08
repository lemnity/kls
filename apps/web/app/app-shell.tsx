import type { ReactNode } from 'react';

import { LogoutButton } from './logout-button.js';
import { BellIcon, CalendarIcon, DashboardIcon, DocumentIcon, HelpIcon, LogoMark, SearchIcon } from './icons.js';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="icon-rail" aria-label="Разделы платформы">
        <a href="/" aria-current="page" title="Дашборд" className="rail-icon rail-icon--active">
          <DashboardIcon />
        </a>
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
          <a href="/" aria-current="page" className="tab tab--active">
            Дашборд
          </a>
          <span className="tab tab--soon" aria-disabled="true">
            Смета <sup>скоро</sup>
          </span>
          <span className="tab tab--soon" aria-disabled="true">
            Цеха <sup>скоро</sup>
          </span>
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
