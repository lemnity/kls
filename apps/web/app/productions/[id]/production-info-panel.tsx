'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { LayersIcon } from '../../icons.js';
import {
  formatDateOnly,
  healthLabel,
  healthValueLabel,
  productionStatusTone,
} from '../../lib/format.js';
import type { Membership, Production } from '../../lib/mock-data.js';

export function ProductionInfoPanel({
  production,
  memberships,
}: {
  production: Production;
  memberships: Membership[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(production.title);
  const [status, setStatus] = useState(production.status);
  const [premiereDate, setPremiereDate] = useState(production.premiereDate ?? '');
  const [producerMembershipId, setProducerMembershipId] = useState(production.producerMembershipId ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const producer = memberships.find((membership) => membership.id === production.producerMembershipId);
  const activeMemberships = memberships.filter((membership) => membership.status === 'ACTIVE');

  function openEdit(): void {
    setTitle(production.title);
    setStatus(production.status);
    setPremiereDate(production.premiereDate ?? '');
    setProducerMembershipId(production.producerMembershipId ?? '');
    setSaveError(null);
    setEditing(true);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!title || !status || saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/proxy/productions/${production.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          status,
          premiereDate: premiereDate || null,
          producerMembershipId: producerMembershipId || null,
        }),
      });
      if (!response.ok) {
        setSaveError('Не удалось сохранить изменения.');
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="card">
      <div className="table-card__header">
        <div className="donut-card__header-text">
          <span className="stat-card__icon">
            <LayersIcon />
          </span>
          <h2>Сведения</h2>
        </div>
        <button type="button" className="details-link" onClick={openEdit}>
          Редактировать
        </button>
      </div>

      <dl className="meta-list">
        <div>
          <dt>Статус</dt>
          <dd>
            <span className="status-pill" data-tone={productionStatusTone(production.status)}>
              {production.status}
            </span>
          </dd>
        </div>
        <div>
          <dt>Здоровье</dt>
          <dd>
            <i
              className="health-dot"
              data-health={production.healthStatus}
              title={healthLabel(production.healthStatus)}
            />{' '}
            <span className="muted">{healthValueLabel(production.healthStatus)}</span>
            {production.healthReason && (
              <>
                <br />
                <span className="meta-list__note muted">{production.healthReason}</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Премьера</dt>
          <dd>{formatDateOnly(production.premiereDate)}</dd>
        </div>
        <div>
          <dt>Продюсер</dt>
          <dd>{producer ? producer.userEmail : 'Не назначен'}</dd>
        </div>
      </dl>

      {editing && (
        <div className="task-modal-backdrop" onClick={() => setEditing(false)}>
          <div
            className="production-modal"
            role="dialog"
            aria-label="Редактирование постановки"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="task-modal__header">
              <span className="task-modal__title">Редактировать постановку</span>
              <button
                type="button"
                className="icon-btn icon-btn--ghost"
                aria-label="Закрыть"
                onClick={() => setEditing(false)}
              >
                ✕
              </button>
            </div>

            <form className="production-modal__body" onSubmit={handleSubmit}>
              <label className="task-modal__field">
                <span>Название</span>
                <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} required />
              </label>
              <label className="task-modal__field">
                <span>Статус</span>
                <input type="text" value={status} onChange={(event) => setStatus(event.target.value)} required />
              </label>
              <label className="task-modal__field">
                <span>Дата премьеры</span>
                <input
                  type="date"
                  value={premiereDate}
                  onChange={(event) => setPremiereDate(event.target.value)}
                />
              </label>
              <label className="task-modal__field">
                <span>Продюсер</span>
                <select
                  value={producerMembershipId}
                  onChange={(event) => setProducerMembershipId(event.target.value)}
                >
                  <option value="">Без продюсера</option>
                  {activeMemberships.map((membership) => (
                    <option key={membership.id} value={membership.id}>
                      {membership.userEmail}
                    </option>
                  ))}
                </select>
              </label>
              {saveError && (
                <p role="alert" className="task-row__error">
                  {saveError}
                </p>
              )}

              <div className="production-modal__actions">
                <button type="submit" className="btn-pill btn-pill--accent" disabled={!title || !status || saving}>
                  {saving ? 'Сохраняем…' : 'Сохранить'}
                </button>
                <button type="button" className="btn-pill btn-pill--ghost" onClick={() => setEditing(false)}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </article>
  );
}
