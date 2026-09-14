'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { PlusIcon } from '../icons.js';
import { Modal } from '../lib/modal.js';
import type { Membership } from '../lib/mock-data.js';

export function CreateWorkshopButton({ memberships }: { memberships: Membership[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [managerMembershipId, setManagerMembershipId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeMemberships = memberships.filter((membership) => membership.status === 'ACTIVE');

  function reset(): void {
    setName('');
    setManagerMembershipId('');
    setError(null);
  }

  function close(): void {
    if (saving) return;
    setOpen(false);
    reset();
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!name || saving) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/proxy/organization/workshops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(managerMembershipId ? { managerMembershipId } : {}),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(
          response.status === 409
            ? 'Цех с таким названием уже существует.'
            : (payload?.message ?? 'Не удалось создать цех.'),
        );
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
        Добавить цех
      </button>

      <Modal open={open} onClose={close} ariaLabel="Новый цех">
        <div className="task-modal__header">
          <span className="task-modal__title">Новый цех</span>
          <button type="button" className="icon-btn icon-btn--ghost" aria-label="Закрыть" onClick={close}>
            ✕
          </button>
        </div>

        <form className="production-modal__body" onSubmit={handleSubmit}>
          <label className="task-modal__field">
            <span>Название</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например, «Пошивочный цех»"
              autoFocus
              required
            />
          </label>
          <label className="task-modal__field">
            <span>Руководитель</span>
            <select value={managerMembershipId} onChange={(event) => setManagerMembershipId(event.target.value)}>
              <option value="">Без руководителя</option>
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
            <button type="submit" className="btn-pill btn-pill--accent" disabled={!name || saving}>
              {saving ? 'Создаём…' : 'Создать цех'}
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
