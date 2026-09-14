'use client';

import { useEffect, useRef, useState } from 'react';

import { LogoutButton } from './logout-button.js';
import { ChevronDownIcon, MoonIcon, SunIcon } from './icons.js';
import { useEscapeToClose } from './lib/use-escape-to-close.js';
import { useTheme } from './lib/use-theme.js';

/**
 * The profile button previously carried a chevron with no menu behind it —
 * a dead affordance. This wires it to an actual dropdown (theme + sign out)
 * so the chevron stops promising something the UI doesn't deliver.
 */
export function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();

  useEscapeToClose(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div className="profile-menu" ref={containerRef}>
      <button
        type="button"
        className="profile"
        aria-label="Профиль: Кулиса, Постановочная часть"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="profile-avatar" aria-hidden="true">
          К
        </span>
        <span className="profile-meta">
          <strong>Кулиса</strong>
          <span className="muted">Постановочная часть</span>
        </span>
        <ChevronDownIcon className={`profile-chevron${open ? ' profile-chevron--open' : ''}`} />
      </button>

      {open && (
        <div className="profile-menu__panel" role="menu" aria-label="Меню профиля">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={theme === 'dark'}
            className="profile-menu__row"
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <MoonIcon className="icon-inline" /> : <SunIcon className="icon-inline" />}
            <span>Тёмная тема</span>
            <span className={`profile-menu__switch${theme === 'dark' ? ' profile-menu__switch--on' : ''}`} aria-hidden="true">
              <span className="profile-menu__switch-knob" />
            </span>
          </button>

          <div className="profile-menu__divider" role="separator" />

          <LogoutButton className="profile-menu__row profile-menu__row--danger" showLabel />
        </div>
      )}
    </div>
  );
}
