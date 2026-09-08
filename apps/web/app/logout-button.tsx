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
    <button type="button" className="btn-pill btn-pill--ghost logout-button" onClick={handleClick}>
      <LogoutIcon className="icon-inline" />
      Выйти
    </button>
  );
}
