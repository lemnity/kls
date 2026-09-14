'use client';

import type { ReactNode } from 'react';

import { useEscapeToClose } from './use-escape-to-close.js';

/**
 * Thin shell around the `.task-modal-backdrop` / `.production-modal`
 * pattern already used by the production-edit and task-detail dialogs —
 * reused here rather than copied a third+ time. Existing hand-rolled
 * dialogs are left as-is (each has its own multi-view shape); this is for
 * new, simple "form in a box" dialogs (create production/workshop/…).
 */
export function Modal({
  open,
  onClose,
  ariaLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  useEscapeToClose(open, onClose);

  if (!open) return null;

  return (
    <div className="task-modal-backdrop" onClick={onClose}>
      <div className="production-modal" role="dialog" aria-label={ariaLabel} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
