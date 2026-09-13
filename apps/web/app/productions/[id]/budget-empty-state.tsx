'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { DocumentIcon } from '../../icons.js';

export function BudgetEmptyState({ productionId }: { productionId: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(): Promise<void> {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`/api/proxy/productions/${productionId}/budgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: [] }),
      });
      if (!response.ok) {
        setError('Не удалось создать смету.');
        return;
      }
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="budget-empty-state">
      <span className="budget-empty-state__icon" aria-hidden="true">
        <DocumentIcon />
      </span>
      <h3>Смета ещё не создана</h3>
      <p className="muted">Создайте черновик, чтобы начать добавлять разделы и позиции по цехам.</p>
      {error && (
        <p role="alert" className="task-row__error">
          {error}
        </p>
      )}
      <button type="button" className="btn-pill btn-pill--accent" disabled={creating} onClick={handleCreate}>
        {creating ? 'Создаём…' : 'Создать смету'}
      </button>
    </div>
  );
}
