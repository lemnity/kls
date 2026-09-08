'use client';

import { useMemo, useState } from 'react';

import { SortIcon } from '../../icons.js';
import { pluralize } from '../../lib/format.js';
import type { Budget } from '../../lib/mock-data.js';

const BUDGET_STATUS_LABEL: Record<string, string> = {
  PRELIMINARY: 'Предварительная',
  DETAILED: 'Подробная',
  APPROVED: 'Утверждённая',
};

export function BudgetView({ budget }: { budget: Budget }) {
  const [workshopFilter, setWorkshopFilter] = useState('');

  const workshopOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const section of budget.sections) {
      if (!seen.has(section.workshopId)) seen.set(section.workshopId, section.title);
    }
    return [...seen.entries()];
  }, [budget.sections]);

  const visibleSections = workshopFilter
    ? budget.sections.filter((section) => section.workshopId === workshopFilter)
    : budget.sections;

  const isPreliminary = budget.status === 'PRELIMINARY';

  return (
    <div className="budget-view">
      <div className="budget-total">
        <div className="budget-total__meta">
          <span
            className="status-pill"
            data-testid="budget-status"
            data-budget-status={budget.status}
          >
            {BUDGET_STATUS_LABEL[budget.status] ?? budget.status}
          </span>
          <span className="muted">Ревизия {budget.revision}</span>
        </div>
        <div>
          <span className="muted">Итого по смете</span> <strong>{budget.total} ₽</strong>
        </div>
      </div>

      {workshopOptions.length > 1 && (
        <label className="budget-filter">
          <span className="sr-only">Фильтр по цеху</span>
          <select
            data-testid="budget-workshop-filter"
            value={workshopFilter}
            onChange={(event) => setWorkshopFilter(event.target.value)}
          >
            <option value="">Все цеха</option>
            {workshopOptions.map(([workshopId, title]) => (
              <option key={workshopId} value={workshopId}>
                {title}
              </option>
            ))}
          </select>
        </label>
      )}

      {visibleSections.length === 0 ? (
        <p className="empty-state">
          {budget.sections.length === 0 ? 'В смете пока нет разделов.' : 'Нет разделов для выбранного цеха.'}
        </p>
      ) : (
        visibleSections.map((section) => (
          <section key={section.id} className="budget-section" data-testid="budget-section">
            <div className="budget-section__header">
              <h3>{section.title}</h3>
              <span className="muted">{section.subtotal} ₽</span>
            </div>
            {isPreliminary ? (
              <p className="muted budget-section__summary">
                {section.items.length} {pluralize(section.items.length, 'позиция', 'позиции', 'позиций')}
              </p>
            ) : (
              <table className="budget-items-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="th-label">
                        Описание <SortIcon className="sort-caret" />
                      </span>
                    </th>
                    <th scope="col">Кол-во</th>
                    <th scope="col">Цена</th>
                    <th scope="col">
                      <span className="th-label">
                        Сумма <SortIcon className="sort-caret" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td className="muted">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="muted">{item.unitPrice} ₽</td>
                      <td>{item.total} ₽</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))
      )}

      {budget.status === 'APPROVED' && (
        <p className="budget-approved-note">Смета утверждена и больше не редактируется.</p>
      )}
    </div>
  );
}
