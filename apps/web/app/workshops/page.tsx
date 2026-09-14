import { redirect } from 'next/navigation';

import { AppShell } from '../app-shell.js';
import { apiFetch } from '../lib/api.js';
import { MOCK_MEMBERSHIPS, type Membership } from '../lib/mock-data.js';
import { getSessionToken } from '../lib/session.js';
import { CreateWorkshopButton } from './create-workshop-button.js';
import { WorkshopsGrid } from './workshops-grid.js';

interface Workshop {
  id: string;
  name: string;
  isActive: boolean;
  parentWorkshopId: string | null;
}

type LoadResult<T> = T | 'forbidden' | 'unavailable';

export default async function WorkshopsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [workshops, memberships] = await Promise.all([loadWorkshops(token), loadMemberships(token)]);
  if (workshops === 'forbidden') {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Недостаточно прав для просмотра цехов.</p>
        </div>
      </main>
    );
  }
  if (workshops === 'unavailable') {
    return (
      <main className="shell-message">
        <div className="message-card">
          <p role="alert">Не удалось загрузить цеха. Попробуйте позже.</p>
        </div>
      </main>
    );
  }

  // Sub-departments (a workshop with a parent — see "Отделы" on the
  // workshop detail page) aren't top-level entries here; listing them in
  // both places would make the same department look like two different
  // things depending on where you found it.
  const topLevelWorkshops = workshops.filter((workshop) => !workshop.parentWorkshopId);

  return (
    <AppShell active="workshops">
      <main className="dashboard-main">
        <section className="page-intro">
          <p className="eyebrow">ЦЕХА</p>
          <h1>Рабочая очередь</h1>
          <p className="muted">
            {topLevelWorkshops.length === 0 ? 'Цехов пока нет.' : `${topLevelWorkshops.length} цех(ов) в тенанте`}
          </p>
          <CreateWorkshopButton memberships={memberships} />
        </section>

        {topLevelWorkshops.length === 0 ? (
          <p className="empty-state">Цехов пока нет — создайте первый кнопкой выше.</p>
        ) : (
          <WorkshopsGrid workshops={topLevelWorkshops} />
        )}
      </main>
    </AppShell>
  );
}

async function loadWorkshops(token: string): Promise<Workshop[] | 'forbidden' | 'unavailable'> {
  const response = await apiFetch('/v1/organization/workshops', { token });
  if (response.status === 401) redirect('/login');
  if (response.status === 403) return 'forbidden';
  if (!response.ok) return 'unavailable';

  return (await response.json()) as Workshop[];
}

async function loadMemberships(token: string): Promise<Membership[]> {
  if (process.env.E2E_MOCK_PRODUCTIONS === '1') {
    return MOCK_MEMBERSHIPS;
  }

  const response = await apiFetch('/v1/organization/memberships', { token });
  if (!response.ok) return [];

  return (await response.json()) as Membership[];
}
