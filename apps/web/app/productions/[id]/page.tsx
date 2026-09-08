import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '../../app-shell.js';
import { apiFetch } from '../../lib/api.js';
import { formatPremiereDate, healthLabel } from '../../lib/format.js';
import { MOCK_BUDGETS, MOCK_PRODUCTIONS, type Budget, type Production } from '../../lib/mock-data.js';
import { getSessionToken } from '../../lib/session.js';

type LoadResult<T> = T | 'not-found' | 'forbidden' | 'unavailable';

export default async function ProductionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const production = await loadProduction(id, token);
  if (production === 'not-found') return renderMessage('Постановка не найдена.');
  if (production === 'forbidden') return renderMessage('Недостаточно прав для просмотра этой постановки.');
  if (production === 'unavailable') return renderMessage('Не удалось загрузить постановку. Попробуйте позже.');

  const budgetResult = await loadBudget(id, token);
  const budget = budgetResult === 'not-found' || budgetResult === 'forbidden' || budgetResult === 'unavailable'
    ? null
    : budgetResult;

  return (
    <AppShell>
      <main className="dashboard-main">
        <p className="breadcrumb">
          <Link href="/" className="row-link">
            ← К дашборду
          </Link>
        </p>

        <section className="page-intro">
          <p className="eyebrow">ПОСТАНОВКА</p>
          <h1>{production.title}</h1>
          <p className="muted">{formatPremiereDate(production.premiereDate)}</p>
        </section>

        <div className="detail-grid">
          <article className="card">
            <div className="table-card__header">
              <h2>Сведения</h2>
            </div>
            <dl className="meta-list">
              <div>
                <dt>Статус</dt>
                <dd>
                  <span className="status-pill">{production.status}</span>
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
                  <span className="muted">{healthLabel(production.healthStatus)}</span>
                </dd>
              </div>
              <div>
                <dt>Премьера</dt>
                <dd>{formatPremiereDate(production.premiereDate)}</dd>
              </div>
            </dl>
          </article>

          <article className="card">
            <div className="table-card__header">
              <h2>Смета</h2>
            </div>
            {budget ? (
              <BudgetView budget={budget} />
            ) : (
              <p className="empty-state">Смета для этой постановки ещё не создана.</p>
            )}
          </article>
        </div>
      </main>
    </AppShell>
  );
}

function BudgetView({ budget }: { budget: Budget }) {
  return (
    <div className="budget-view">
      <div className="budget-total">
        <span className="muted">Итого по смете</span>
        <strong>{budget.total} ₽</strong>
      </div>
      {budget.sections.length === 0 ? (
        <p className="empty-state">В смете пока нет разделов.</p>
      ) : (
        budget.sections.map((section) => (
          <section key={section.id} className="budget-section">
            <div className="budget-section__header">
              <h3>{section.title}</h3>
              <span className="muted">{section.subtotal} ₽</span>
            </div>
            <table className="budget-items-table">
              <thead>
                <tr>
                  <th scope="col">Описание</th>
                  <th scope="col">Кол-во</th>
                  <th scope="col">Цена</th>
                  <th scope="col">Сумма</th>
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
          </section>
        ))
      )}
    </div>
  );
}

function renderMessage(message: string) {
  return (
    <main className="shell-message">
      <div className="message-card">
        <p role="alert">{message}</p>
      </div>
    </main>
  );
}

async function loadProduction(id: string, token: string): Promise<LoadResult<Production>> {
  if (process.env.E2E_MOCK_PRODUCTIONS === '1') {
    return MOCK_PRODUCTIONS.find((production) => production.id === id) ?? 'not-found';
  }

  const response = await apiFetch(`/v1/productions/${id}`, { token });
  if (response.status === 401) redirect('/login');
  if (response.status === 404) return 'not-found';
  if (response.status === 403) return 'forbidden';
  if (!response.ok) return 'unavailable';

  return (await response.json()) as Production;
}

async function loadBudget(id: string, token: string): Promise<LoadResult<Budget>> {
  if (process.env.E2E_MOCK_PRODUCTIONS === '1') {
    return MOCK_BUDGETS[id] ?? 'not-found';
  }

  const response = await apiFetch(`/v1/productions/${id}/budget`, { token });
  if (response.status === 401) redirect('/login');
  if (response.status === 404) return 'not-found';
  if (response.status === 403) return 'forbidden';
  if (!response.ok) return 'unavailable';

  return (await response.json()) as Budget;
}
