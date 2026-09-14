'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { PlusIcon } from './icons.js';
import { Modal } from './lib/modal.js';
import type { Membership } from './lib/mock-data.js';

export function CreateProductionButton({ memberships }: { memberships: Membership[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('draft');
  const [premiereDate, setPremiereDate] = useState('');
  const [producerMembershipId, setProducerMembershipId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeMemberships = memberships.filter((membership) => membership.status === 'ACTIVE');

  function reset(): void {
    setTitle('');
    setStatus('draft');
    setPremiereDate('');
    setProducerMembershipId('');
    setError(null);
  }

  function close(): void {
    if (saving) return;
    setOpen(false);
    reset();
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title || !status || saving) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/proxy/productions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          status,
          premiereDate: premiereDate || null,
          producerMembershipId: producerMembershipId || null,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(payload?.message ?? 'Не удалось создать постановку.');
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-pill btn-pill--accent page-intro__action" onClick={() => setOpen(true)}>
        <PlusIcon className="icon-inline" />
        Добавить постановку
      </button>

      <Modal open={open} onClose={close} ariaLabel="Новая постановка">
        <div className="task-modal__header">
          <span className="task-modal__title">Новая постановка</span>
          <button type="button" className="icon-btn icon-btn--ghost" aria-label="Закрыть" onClick={close}>
            ✕
          </button>
        </div>

        <form className="production-modal__body" onSubmit={handleSubmit}>
          <label className="task-modal__field">
            <span>Название</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Например, «Ревизор»"
              autoFocus
              required
            />
          </label>
          <label className="task-modal__field">
            <span>Статус</span>
            <input type="text" value={status} onChange={(event) => setStatus(event.target.value)} required />
          </label>
          <label className="task-modal__field">
            <span>Дата премьеры</span>
            <input type="date" value={premiereDate} onChange={(event) => setPremiereDate(event.target.value)} />
          </label>
          <label className="task-modal__field">
            <span>Продюсер</span>
            <select value={producerMembershipId} onChange={(event) => setProducerMembershipId(event.target.value)}>
              <option value="">Без продюсера</option>
              {activeMemberships.map((membership) => (
                <option key={membership.id} value={membership.id}>
                  {membership.userEmail}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="task-row__error">
              {error}
            </p>
          )}

          <div className="production-modal__actions">
            <button type="submit" className="btn-pill btn-pill--accent" disabled={!title || !status || saving}>
              {saving ? 'Создаём…' : 'Создать постановку'}
            </button>
            <button type="button" className="btn-pill btn-pill--ghost" onClick={close}>
              Отмена
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
