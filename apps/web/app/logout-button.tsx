'use client';

import { useRouter } from 'next/navigation';

import { LogoutIcon } from './icons.js';

export function LogoutButton() {
  const router = useRouter();

  async function handleClick(): Promise<void> {
    await fetch('/api/session', { method: 'DELETE' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button type="button" className="icon-chip icon-chip--logout" onClick={handleClick} aria-label="Выйти">
      <LogoutIcon />
    </button>
  );
}
