import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '../../app-shell.js';
import { TicketIcon } from '../../icons.js';
import { apiFetch } from '../../lib/api.js';
import { formatPremiereDate } from '../../lib/format.js';
import {
  MOCK_BUDGETS,
  MOCK_MEMBERSHIPS,
  MOCK_PRODUCTIONS,
  MOCK_WORKSHOP_TASKS,
  type Budget,
  type Membership,
  type Production,
  type WorkshopTask,
} from '../../lib/mock-data.js';
import { getSessionToken } from '../../lib/session.js';
import { BudgetEmptyState } from './budget-empty-state.js';
import { BudgetView } from './budget-view.js';
import { ProductionInfoPanel } from './production-info-panel.js';

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
  const [workshopTasks, memberships] = await Promise.all([
    budget ? loadWorkshopTasks(id, token) : Promise.resolve<WorkshopTask[]>([]),
    loadMemberships(token),
  ]);

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
          <ProductionInfoPanel production={production} memberships={memberships} />

          <article className="card budget-card">
            <div className="table-card__header">
              <div className="donut-card__header-text">
                <span className="stat-card__icon">
                  <TicketIcon />
                </span>
                <h2>Смета</h2>
              </div>
              {budget && (
                <Link href={`/productions/${id}/budget-graph`} className="details-link">
                  Конструктор узлов
                </Link>
              )}
            </div>
            {budget && (
              <p className="budget-graph-notice muted">
                Конструктор узлов — отдельный инструмент планирования; суммы в нём не связаны с этой сметой и
                считаются независимо.
              </p>
            )}
            {budget ? <BudgetView budget={budget} workshopTasks={workshopTasks} /> : <BudgetEmptyState productionId={id} />}
          </article>
        </div>
      </main>
    </AppShell>
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

async function loadWorkshopTasks(id: string, token: string): Promise<WorkshopTask[]> {
  if (process.env.E2E_MOCK_PRODUCTIONS === '1') {
    return MOCK_WORKSHOP_TASKS[id] ?? [];
  }

  const response = await apiFetch(`/v1/productions/${id}/workshop-tasks`, { token });
  if (!response.ok) return [];

  return (await response.json()) as WorkshopTask[];
}

async function loadMemberships(token: string): Promise<Membership[]> {
  if (process.env.E2E_MOCK_PRODUCTIONS === '1') {
    return MOCK_MEMBERSHIPS;
  }

  const response = await apiFetch('/v1/organization/memberships', { token });
  if (!response.ok) return [];

  return (await response.json()) as Membership[];
}
