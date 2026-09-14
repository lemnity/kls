'use client';

import { useEffect } from 'react';

/**
 * Closes the caller's dialog/menu/panel on Escape while `active` is true.
 * Shared by every overlay (production edit modal, task modal, budget-graph
 * side panel, profile menu) so "Esc always exits" is a platform-wide
 * guarantee instead of something each one has to remember to wire.
 */
export function useEscapeToClose(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, onClose]);
}
