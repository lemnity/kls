import Link from 'next/link';
import type { ReactNode } from 'react';

import { ProfileMenu } from './profile-menu.js';
import { BellIcon, LogoMark } from './icons.js';

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
          {/* No notification backend exists yet — marked "soon" rather than
              a live-looking control that does nothing on click, same as the
              upcoming nav tabs above. */}
          <span className="icon-chip icon-chip--soon" aria-disabled="true" title="Уведомления · скоро">
            <BellIcon />
          </span>

          <span className="topbar-divider" aria-hidden="true" />

          <ProfileMenu />
        </div>
      </header>

      {children}
    </div>
  );
}
