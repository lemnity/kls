import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '../../../app-shell.js';
import { apiFetch } from '../../../lib/api.js';
import { MOCK_BUDGETS, MOCK_PRODUCTIONS } from '../../../lib/mock-data.js';
import { getSessionToken } from '../../../lib/session.js';
import { BudgetGraphEditor } from './budget-graph-editor.js';

interface Budget {
  id: string;
  versionId: string;
}

interface Production {
  id: string;
  title: string;
}

export default async function BudgetGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [production, budget] = await Promise.all([loadProduction(id, token), loadBudget(id, token)]);

  if (!production) {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Постановка не найдена.</p>
        </div>
      </main>
    );
  }
  if (!budget) {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Смета для этой постановки ещё не создана.</p>
        </div>
      </main>
    );
  }

  return (
    <AppShell>
      <main className="dashboard-main">
        <p className="breadcrumb">
          <Link href={`/productions/${id}`} className="row-link">
            ← К постановке
          </Link>
        </p>

        <section className="page-intro">
          <p className="eyebrow">ВИЗУАЛЬНЫЙ КОНСТРУКТОР СМЕТЫ</p>
          <h1>{production.title}</h1>
        </section>

        <p className="budget-graph-notice muted">
          Это отдельный инструмент планирования: суммы узлов не связаны с табличной сметой постановки и считаются
          независимо — совпадения между ними нет и не подразумевается.
        </p>

        <BudgetGraphEditor budgetVersionId={budget.versionId} />
      </main>
    </AppShell>
  );
}

async function loadProduction(id: string, token: string): Promise<Production | null> {
  if (process.env.E2E_MOCK_PRODUCTIONS === '1') {
    return MOCK_PRODUCTIONS.find((production) => production.id === id) ?? null;
  }

  const response = await apiFetch(`/v1/productions/${id}`, { token });
  if (response.status === 401) redirect('/login');
  if (!response.ok) return null;

  return (await response.json()) as Production;
}

async function loadBudget(id: string, token: string): Promise<Budget | null> {
  if (process.env.E2E_MOCK_PRODUCTIONS === '1') {
    return MOCK_BUDGETS[id] ?? null;
  }

  const response = await apiFetch(`/v1/productions/${id}/budget`, { token });
  if (response.status === 401) redirect('/login');
  if (!response.ok) return null;

  return (await response.json()) as Budget;
}
