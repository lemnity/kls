'use client';

import { useRouter } from 'next/navigation';

import { LogoutIcon } from './icons.js';

export function LogoutButton({
  className = 'icon-chip icon-chip--logout',
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const router = useRouter();

  async function handleClick(): Promise<void> {
    await fetch('/api/session', { method: 'DELETE' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button type="button" className={className} onClick={handleClick} aria-label={showLabel ? undefined : 'Выйти'}>
      <LogoutIcon />
      {showLabel ? <span>Выйти</span> : <span className="sr-only">Выйти</span>}
    </button>
  );
}
